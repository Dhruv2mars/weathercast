import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Nowcast } from '@/types/weather';

export type NowcastEnvelope = Nowcast & {
  schemaVersion: 1;
  forecastId: string;
  generatedAt: string;
  validUntil: string;
  timezone: string;
  sourceDataTime: string | null;
  calibrationStatus: 'uncalibrated' | 'provisional' | 'calibrated';
  coverage: {
    reason: string;
    spatialResolutionKm: number | null;
  };
};

type StoredForecast = {
  id: string;
  response_json: string;
};

type VerificationRow = {
  forecast_id: string;
  response_json: string;
  observed_at: string;
  rain_observed: number;
};

export type RainObservationInput = {
  source: string;
  sourceEventId: string;
  observedAt: string;
  latitude: number;
  longitude: number;
  rainObserved: boolean;
  rainRateMmHour?: number;
  accumulationMm?: number;
  quality: 'provisional' | 'verified' | 'rejected';
  truthResolutionSeconds?: number;
  onsetPublishable?: boolean;
  sourceAssetId?: string;
  payload: unknown;
};

export type SourceAssetInput = {
  provider: string;
  upstreamKey: string;
  retrievedAt: string;
  mediaType: string;
  bytes: Uint8Array;
};

export type RadarFrameInput = {
  domain: string;
  product: string;
  observedAt: string;
  retrievedAt: string;
  objectKey: string;
  sourceAssetId: string;
};

export function locationCell(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

export function createForecastId(cell: string, provider: string, issuedAt: string, response: Nowcast) {
  return createHash('sha256')
    .update(JSON.stringify({ cell, provider, issuedAt, response }))
    .digest('hex')
    .slice(0, 24);
}

export class ForecastArchive {
  private readonly database: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true, strict: true });
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS source_assets (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        upstream_key TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        media_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
        payload BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, upstream_key, sha256)
      );
      CREATE TABLE IF NOT EXISTS forecast_issues (
        id TEXT PRIMARY KEY,
        issued_at TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        location_cell TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        provider TEXT NOT NULL,
        upstream_run_id TEXT,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS radar_frames (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        product TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        object_key TEXT NOT NULL,
        source_asset_id TEXT NOT NULL REFERENCES source_assets(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(domain, product, observed_at)
      );
      CREATE INDEX IF NOT EXISTS radar_frames_product_time
        ON radar_frames(domain, product, observed_at DESC);
      CREATE INDEX IF NOT EXISTS forecast_issues_cell_fresh
        ON forecast_issues(location_cell, valid_until DESC);
      CREATE TABLE IF NOT EXISTS rain_observations (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        location_cell TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        source_asset_id TEXT REFERENCES source_assets(id),
        rain_observed INTEGER NOT NULL CHECK (rain_observed IN (0, 1)),
        rain_rate_mm_hour REAL,
        accumulation_mm REAL,
        quality TEXT NOT NULL CHECK (quality IN ('provisional', 'verified', 'rejected')),
        truth_resolution_seconds INTEGER NOT NULL CHECK (truth_resolution_seconds > 0),
        onset_publishable INTEGER NOT NULL CHECK (onset_publishable IN (0, 1)),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source, source_event_id)
      );
      CREATE INDEX IF NOT EXISTS rain_observations_cell_time
        ON rain_observations(location_cell, observed_at);
      CREATE TABLE IF NOT EXISTS forecast_scores (
        forecast_id TEXT NOT NULL REFERENCES forecast_issues(id),
        metric TEXT NOT NULL,
        horizon_minutes INTEGER NOT NULL,
        verification_version TEXT NOT NULL,
        value REAL NOT NULL,
        observation_count INTEGER NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY(forecast_id, metric, horizon_minutes, verification_version)
      );
      CREATE TRIGGER IF NOT EXISTS forecast_issues_no_update
        BEFORE UPDATE ON forecast_issues BEGIN SELECT RAISE(ABORT, 'forecast issues are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS forecast_issues_no_delete
        BEFORE DELETE ON forecast_issues BEGIN SELECT RAISE(ABORT, 'forecast issues are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS rain_observations_no_update
        BEFORE UPDATE ON rain_observations BEGIN SELECT RAISE(ABORT, 'rain observations are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS rain_observations_no_delete
        BEFORE DELETE ON rain_observations BEGIN SELECT RAISE(ABORT, 'rain observations are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS forecast_scores_no_update
        BEFORE UPDATE ON forecast_scores BEGIN SELECT RAISE(ABORT, 'forecast scores are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS forecast_scores_no_delete
        BEFORE DELETE ON forecast_scores BEGIN SELECT RAISE(ABORT, 'forecast scores are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS source_assets_no_update
        BEFORE UPDATE ON source_assets BEGIN SELECT RAISE(ABORT, 'source assets are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS source_assets_no_delete
        BEFORE DELETE ON source_assets BEGIN SELECT RAISE(ABORT, 'source assets are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_frames_no_update
        BEFORE UPDATE ON radar_frames BEGIN SELECT RAISE(ABORT, 'radar frames are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_frames_no_delete
        BEFORE DELETE ON radar_frames BEGIN SELECT RAISE(ABORT, 'radar frames are immutable'); END;
    `);
    this.ensureColumn('rain_observations', 'source_asset_id', 'TEXT REFERENCES source_assets(id)');
    this.ensureColumn('rain_observations', 'truth_resolution_seconds', 'INTEGER NOT NULL DEFAULT 3600 CHECK (truth_resolution_seconds > 0)');
    this.ensureColumn('rain_observations', 'onset_publishable', 'INTEGER NOT NULL DEFAULT 0 CHECK (onset_publishable IN (0, 1))');
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.database.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
    if (!columns.some((candidate) => candidate.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  isReady() {
    return this.database.query('SELECT 1 AS ready').get() !== null;
  }

  findFresh(cell: string, now: Date): NowcastEnvelope | null {
    const row = this.database.query<StoredForecast, [string, string]>(`
      SELECT id, response_json
      FROM forecast_issues
      WHERE location_cell = ? AND valid_until > ?
      ORDER BY generated_at DESC
      LIMIT 1
    `).get(cell, now.toISOString());
    return row ? JSON.parse(row.response_json) as NowcastEnvelope : null;
  }

  save(input: {
    envelope: NowcastEnvelope;
    cell: string;
    latitude: number;
    longitude: number;
    provider: string;
    upstreamRunId?: string;
  }) {
    this.database.query(`
      INSERT OR IGNORE INTO forecast_issues (
        id, issued_at, generated_at, valid_until, location_cell, latitude, longitude,
        provider, upstream_run_id, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.envelope.forecastId,
      input.envelope.issuedAt,
      input.envelope.generatedAt,
      input.envelope.validUntil,
      input.cell,
      input.latitude,
      input.longitude,
      input.provider,
      input.upstreamRunId ?? null,
      JSON.stringify(input.envelope),
    );
  }

  countForecasts() {
    const row = this.database.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM forecast_issues').get();
    return row?.count ?? 0;
  }

  saveObservation(input: RainObservationInput) {
    const cell = locationCell(input.latitude, input.longitude);
    const id = createHash('sha256')
      .update(JSON.stringify({ source: input.source, sourceEventId: input.sourceEventId }))
      .digest('hex')
      .slice(0, 24);
    this.database.query(`
      INSERT OR IGNORE INTO rain_observations (
        id, source, source_event_id, observed_at, location_cell, latitude, longitude,
        source_asset_id, rain_observed, rain_rate_mm_hour, accumulation_mm, quality,
        truth_resolution_seconds, onset_publishable, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.source,
      input.sourceEventId,
      input.observedAt,
      cell,
      Number(input.latitude.toFixed(4)),
      Number(input.longitude.toFixed(4)),
      input.sourceAssetId ?? null,
      input.rainObserved ? 1 : 0,
      input.rainRateMmHour ?? null,
      input.accumulationMm ?? null,
      input.quality,
      input.truthResolutionSeconds ?? 3_600,
      input.onsetPublishable ? 1 : 0,
      JSON.stringify(input.payload),
    );
    return id;
  }

  saveSourceAsset(input: SourceAssetInput) {
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const id = sha256.slice(0, 24);
    this.database.query(`
      INSERT OR IGNORE INTO source_assets (
        id, provider, upstream_key, retrieved_at, sha256, media_type, byte_length, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.provider,
      input.upstreamKey,
      input.retrievedAt,
      sha256,
      input.mediaType,
      input.bytes.byteLength,
      input.bytes,
    );
    return { id, sha256 };
  }

  countSourceAssets() {
    const row = this.database.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM source_assets').get();
    return row?.count ?? 0;
  }

  listObservationPoints(limit = 50) {
    return this.database.query<{ latitude: number; longitude: number }, [number]>(`
      SELECT latitude, longitude
      FROM rain_observations
      WHERE quality != 'rejected'
      GROUP BY location_cell
      ORDER BY MAX(observed_at) DESC
      LIMIT ?
    `).all(limit);
  }

  saveRadarFrame(input: RadarFrameInput) {
    const id = createHash('sha256')
      .update(JSON.stringify({ domain: input.domain, product: input.product, observedAt: input.observedAt }))
      .digest('hex')
      .slice(0, 24);
    this.database.query(`
      INSERT OR IGNORE INTO radar_frames (
        id, domain, product, observed_at, retrieved_at, object_key, source_asset_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.domain,
      input.product,
      input.observedAt,
      input.retrievedAt,
      input.objectKey,
      input.sourceAssetId,
    );
    return id;
  }

  listRadarFrames(domain: string, product: string, limit = 30) {
    return this.database.query<{
      id: string;
      observed_at: string;
      retrieved_at: string;
      object_key: string;
      source_asset_id: string;
    }, [string, string, number]>(`
      SELECT id, observed_at, retrieved_at, object_key, source_asset_id
      FROM radar_frames
      WHERE domain = ? AND product = ?
      ORDER BY observed_at DESC
      LIMIT ?
    `).all(domain, product, limit);
  }

  verifyBrier(verificationVersion: string, through: Date) {
    const rows = this.database.query<VerificationRow, [string]>(`
      SELECT f.id AS forecast_id, f.response_json, o.observed_at, o.rain_observed
      FROM forecast_issues f
      JOIN rain_observations o ON o.location_cell = f.location_cell
      WHERE o.quality = 'verified' AND o.observed_at <= ?
    `).all(through.toISOString());
    let scoresWritten = 0;
    let observationsMatched = 0;

    for (const row of rows) {
      const forecast = JSON.parse(row.response_json) as NowcastEnvelope;
      const observedAt = new Date(row.observed_at).getTime();
      const intervalIndex = forecast.intervals.findIndex((interval) => {
        const start = new Date(interval.time).getTime();
        return observedAt >= start && observedAt < start + 15 * 60_000;
      });
      if (intervalIndex < 0) continue;
      observationsMatched += 1;
      const probability = forecast.intervals[intervalIndex].probability / 100;
      const observed = row.rain_observed === 1 ? 1 : 0;
      const brier = (probability - observed) ** 2;
      const result = this.database.query(`
        INSERT OR IGNORE INTO forecast_scores (
          forecast_id, metric, horizon_minutes, verification_version,
          value, observation_count, computed_at
        ) VALUES (?, 'brier_rain_occurrence_point', ?, ?, ?, 1, ?)
      `).run(
        row.forecast_id,
        intervalIndex * 15,
        verificationVersion,
        brier,
        through.toISOString(),
      );
      scoresWritten += result.changes;
    }
    return { observationsMatched, scoresWritten };
  }

  listScores() {
    return this.database.query<{
      forecast_id: string;
      metric: string;
      horizon_minutes: number;
      verification_version: string;
      value: number;
      observation_count: number;
    }, []>('SELECT forecast_id, metric, horizon_minutes, verification_version, value, observation_count FROM forecast_scores ORDER BY forecast_id, horizon_minutes').all();
  }

  close() {
    this.database.close();
  }
}
