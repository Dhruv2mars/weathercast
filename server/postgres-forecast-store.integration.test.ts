import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createHash } from 'node:crypto';

import type { NowcastEnvelope } from './archive';
import { PostgresForecastStore } from './postgres-forecast-store';

const databaseUrl = process.env.POSTGRES_TEST_URL;
const postgresTest = databaseUrl ? test : test.skip;

function envelope(id: string, generatedAt: string): NowcastEnvelope {
  return {
    schemaVersion: 1,
    forecastId: id,
    generatedAt,
    validUntil: '2099-01-01T01:00:00.000Z',
    timezone: 'UTC',
    sourceDataTime: '2099-01-01T00:00:00.000Z',
    calibrationStatus: 'uncalibrated',
    coverage: { reason: 'integration-test', spatialResolutionKm: 1 },
    issuedAt: '2098-12-31T23:59:30.000Z',
    status: 'clear',
    headline: 'No rain expected',
    detail: 'Integration test forecast.',
    clearMinutes: 120,
    intervals: [],
    confidence: { score: 0.8, label: 'high', explanation: 'Integration test.' },
    dataTier: 'precision',
    source: 'integration-test',
    event: null,
  };
}

postgresTest('PostgresForecastStore atomically preserves a race winner and rejects mutation', async () => {
  const store = await PostgresForecastStore.create(databaseUrl!);
  const sql = new SQL(databaseUrl!);
  const id = `integration-${crypto.randomUUID()}`;
  const cell = `integration-${crypto.randomUUID()}`;
  const first = envelope(id, '2099-01-01T00:00:00.000Z');
  const loser = envelope(id, '2099-01-01T00:01:00.000Z');

  try {
    expect(await store.isReady()).toBe(true);
    expect(await store.save({
      envelope: first,
      cell,
      latitude: 28.6139,
      longitude: 77.209,
      provider: 'integration-test',
    })).toEqual(first);
    expect(await store.save({
      envelope: loser,
      cell,
      latitude: 28.6139,
      longitude: 77.209,
      provider: 'integration-test',
    })).toEqual(first);
    expect(await store.findFresh(cell, new Date('2099-01-01T00:10:00.000Z'))).toEqual(first);
    const issuedRows = await sql<Array<{ issued_at: Date }>>`
      SELECT issued_at FROM forecast_issues WHERE id = ${id}
    `;
    expect(issuedRows[0]?.issued_at.toISOString()).toBe(first.issuedAt);

    const radarBytes = new TextEncoder().encode(`radar-${id}`);
    const radar = await store.archiveRadarFrame({
      asset: {
        provider: 'noaa-mrms-nodd',
        upstreamKey: `${id}.grib2.gz`,
        retrievedAt: '2099-01-01T00:04:30.000Z',
        mediaType: 'application/gzip',
        bytes: radarBytes,
      },
      frame: {
        domain: 'CONUS',
        product: 'PrecipRate_00.00',
        observedAt: '2099-01-01T00:04:00.000Z',
        retrievedAt: '2099-01-01T00:04:30.000Z',
        objectKey: `${id}.grib2.gz`,
      },
    });
    expect((await store.listRadarFrames('CONUS', 'PrecipRate_00.00', 1))[0]?.id).toBe(radar.frameId);

    const metarBytes = new TextEncoder().encode(JSON.stringify({ icaoId: 'VIDP', id }));
    const observationBatch = await store.archiveObservationBatch({
      asset: {
        provider: 'aviation-weather-metar',
        upstreamKey: `metar:${id}`,
        retrievedAt: '2099-01-01T00:05:30.000Z',
        mediaType: 'application/json',
        bytes: metarBytes,
      },
      observations: [{
        source: 'aviation-weather-metar',
        sourceEventId: `VIDP:${id}`,
        observedAt: '2099-01-01T00:05:00.000Z',
        latitude: 28.5665,
        longitude: 77.1031,
        rainObserved: true,
        accumulationMm: 1.2,
        quality: 'verified',
        truthResolutionSeconds: 3600,
        onsetPublishable: false,
        payload: { icaoId: 'VIDP', id },
      }],
    });
    expect(observationBatch.observationsAccepted).toBe(1);
    expect(await store.countRecentVerifiedObservationStations(
      'aviation-weather-metar',
      '2099-01-01T00:00:00.000Z',
      '2099-01-01T00:10:00.000Z',
    )).toBe(1);
    const sourceRows = await sql<Array<{ payload: Uint8Array }>>`
      SELECT payload FROM source_assets WHERE id = ${observationBatch.asset.id}
    `;
    expect(new TextDecoder().decode(sourceRows[0]?.payload)).toBe(new TextDecoder().decode(metarBytes));

    const rejectedBytes = new TextEncoder().encode(`rejected-${id}`);
    await expect(store.archiveObservationBatch({
      asset: {
        provider: 'integration-test',
        upstreamKey: `rejected:${id}`,
        retrievedAt: '2099-01-01T00:06:00.000Z',
        mediaType: 'application/json',
        bytes: rejectedBytes,
      },
      observations: [{
        source: 'integration-test',
        sourceEventId: `invalid:${id}`,
        observedAt: '2099-01-01T00:06:00.000Z',
        latitude: 999,
        longitude: 0,
        rainObserved: false,
        quality: 'verified',
        payload: { icaoId: 'FAIL' },
      }],
    })).rejects.toThrow();
    const rejectedId = createHash('sha256').update(rejectedBytes).digest('hex').slice(0, 24);
    const rejectedRows = await sql<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM source_assets WHERE id = ${rejectedId}
    `;
    expect(rejectedRows[0]?.count).toBe(0);
    let mutationError = '';
    try {
      await sql`UPDATE forecast_issues SET provider = 'mutated' WHERE id = ${id}`;
    } catch (error) {
      mutationError = String(error);
    }
    expect(mutationError).toContain('immutable');
  } finally {
    await sql.close({ timeout: 0 });
    await store.close();
  }
}, 15_000);
