import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ForecastArchive } from './archive';

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('ForecastArchive', () => {
  test('creates durable append-only forecast tables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-archive-'));
    directories.push(directory);
    const path = join(directory, 'archive.sqlite');
    const archive = new ForecastArchive(path);
    archive.close();

    const database = new Database(path);
    database.query(`
      INSERT INTO forecast_issues (
        id, issued_at, generated_at, valid_until, location_cell, latitude, longitude,
        provider, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id-1', '2026-07-10T10:00:00.000Z', '2026-07-10T10:00:00.000Z',
      '2026-07-10T10:04:00.000Z', '28.6000,77.2000', 28.6, 77.2, 'fixture', '{}');

    expect(() => database.query('UPDATE forecast_issues SET provider = ? WHERE id = ?').run('mutated', 'id-1'))
      .toThrow('forecast issues are immutable');
    expect(() => database.query('DELETE FROM forecast_issues WHERE id = ?').run('id-1'))
      .toThrow('forecast issues are immutable');
    database.close();
  });

  test('migrates the prior observation schema without losing rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-migration-'));
    directories.push(directory);
    const path = join(directory, 'archive.sqlite');
    const legacy = new Database(path, { create: true });
    legacy.exec(`
      CREATE TABLE rain_observations (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        location_cell TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        rain_observed INTEGER NOT NULL,
        rain_rate_mm_hour REAL,
        accumulation_mm REAL,
        quality TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source, source_event_id)
      );
      INSERT INTO rain_observations (
        id, source, source_event_id, observed_at, location_cell, latitude, longitude,
        rain_observed, quality, payload_json
      ) VALUES ('legacy-1', 'legacy', 'event-1', '2026-07-10T10:00:00.000Z',
        '28.6000,77.2000', 28.6, 77.2, 0, 'verified', '{}');
    `);
    legacy.close();

    const migrated = new ForecastArchive(path);
    expect(migrated.listObservationPoints()).toEqual([{ latitude: 28.6, longitude: 77.2 }]);
    migrated.saveObservation({
      source: 'new',
      sourceEventId: 'event-2',
      observedAt: '2026-07-10T11:00:00.000Z',
      latitude: 28.6,
      longitude: 77.2,
      rainObserved: true,
      quality: 'verified',
      truthResolutionSeconds: 3_600,
      onsetPublishable: false,
      payload: {},
    });
    migrated.close();
  });

  test('content-addresses raw source bytes and rejects mutation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-source-'));
    directories.push(directory);
    const path = join(directory, 'archive.sqlite');
    const archive = new ForecastArchive(path);
    const bytes = new TextEncoder().encode('[{"icaoId":"VIDP"}]');
    const first = archive.saveSourceAsset({
      provider: 'aviation-weather-metar',
      upstreamKey: 'metar:VIDP:1',
      retrievedAt: '2026-07-10T10:00:00.000Z',
      mediaType: 'application/json',
      bytes,
    });
    const second = archive.saveSourceAsset({
      provider: 'aviation-weather-metar',
      upstreamKey: 'metar:VIDP:2',
      retrievedAt: '2026-07-10T10:01:00.000Z',
      mediaType: 'application/json',
      bytes,
    });
    expect(second.id).toBe(first.id);
    expect(archive.countSourceAssets()).toBe(1);
    archive.close();

    const database = new Database(path);
    expect(() => database.query('DELETE FROM source_assets WHERE id = ?').run(first.id))
      .toThrow('source assets are immutable');
    database.close();
  });

  test('archives derived radar runs with immutable frame provenance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-radar-run-'));
    directories.push(directory);
    const path = join(directory, 'archive.sqlite');
    const archive = new ForecastArchive(path);
    const frameIds = Array.from({ length: 3 }, (_, index) => {
      const asset = archive.saveSourceAsset({
        provider: 'noaa-mrms-nodd',
        upstreamKey: `frame-${index}`,
        retrievedAt: '2026-07-10T15:40:00.000Z',
        mediaType: 'application/gzip',
        bytes: new Uint8Array([index]),
      });
      return archive.saveRadarFrame({
        domain: 'CONUS',
        product: 'PrecipRate_00.00',
        observedAt: new Date(Date.parse('2026-07-10T15:30:00.000Z') + index * 120_000).toISOString(),
        retrievedAt: '2026-07-10T15:40:00.000Z',
        objectKey: `frame-${index}`,
        sourceAssetId: asset.id,
      });
    });
    const input = {
      issuedAt: '2026-07-10T15:40:00.000Z',
      sourceDataTime: '2026-07-10T15:34:00.000Z',
      latitude: 35.005,
      longitude: -87.115,
      domain: 'CONUS',
      product: 'PrecipRate_00.00',
      algorithmVersion: 'translation-ensemble-v1',
      inputFrameIds: frameIds,
      response: { schemaVersion: 1 },
    };
    const saved = archive.saveRadarNowcastRun(input);
    expect(saved.inserted).toBe(true);
    expect(archive.saveRadarNowcastRun({ ...input, issuedAt: '2026-07-10T15:41:00.000Z' }))
      .toEqual({ ...saved, inserted: false });
    expect(() => archive.saveRadarNowcastRun({ ...input, response: { schemaVersion: 2 } }))
      .toThrow('not reproducible');
    expect(() => archive.saveRadarNowcastRun({
      ...input,
      latitude: 36,
      inputFrameIds: frameIds.toReversed(),
    })).toThrow('chronological');
    expect(() => archive.saveRadarNowcastRun({
      ...input,
      latitude: 36,
      sourceDataTime: '2026-07-10T15:33:00.000Z',
    })).toThrow('newest input frame');
    expect(() => archive.saveRadarNowcastRun({
      ...input,
      latitude: 36,
      issuedAt: '2026-07-10T15:45:00.001Z',
    })).toThrow('fresh radar inputs');
    expect(archive.listRadarNowcastRuns()).toEqual([expect.objectContaining({ id: saved.id, input_count: 3 })]);
    archive.close();

    const database = new Database(path);
    expect(() => database.query('UPDATE radar_nowcast_runs SET algorithm_version = ? WHERE id = ?')
      .run('mutated', saved.id)).toThrow('radar nowcast runs are immutable');
    expect(() => database.query('DELETE FROM radar_nowcast_inputs WHERE run_id = ?').run(saved.id))
      .toThrow('radar nowcast inputs are immutable');
    database.close();
  });
});
