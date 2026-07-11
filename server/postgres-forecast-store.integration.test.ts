import { expect, test } from 'bun:test';
import { SQL } from 'bun';

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
    issuedAt: generatedAt,
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
