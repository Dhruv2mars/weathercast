import { describe, expect, test } from 'bun:test';

import type { NormalizedForecast } from '@/types/weather';
import { parseNowcastResponse } from '@/services/nowcast-contract';

import { ForecastArchive } from './archive';
import { createHandler } from './app';
import { loadConfig } from './config';
import type { ForecastProvider, ProviderResult } from './providers';

const now = new Date('2026-07-10T10:00:00.000Z');

function forecast(): NormalizedForecast {
  return {
    issuedAt: '2026-07-10T09:55:00.000Z',
    timezone: 'Asia/Kolkata',
    source: 'Fixture numerical guidance',
    intervals: Array.from({ length: 8 }, (_, index) => ({
      time: new Date(now.getTime() + index * 15 * 60_000).toISOString(),
      precipitationMm: index >= 2 && index <= 4 ? 0.8 : 0,
      rainMm: index >= 2 && index <= 4 ? 0.8 : 0,
      showersMm: 0,
      probability: index >= 2 && index <= 4 ? 80 : 10,
      weatherCode: index >= 2 && index <= 4 ? 61 : 0,
    })),
  };
}

class FixtureProvider implements ForecastProvider {
  calls = 0;

  async fetch(): Promise<ProviderResult> {
    this.calls += 1;
    await Promise.resolve();
    return {
      forecast: forecast(),
      provider: 'fixture',
      dataTier: 'standard',
      calibrationStatus: 'uncalibrated',
      spatialResolutionKm: 9,
      coverageReason: 'Model-only test coverage.',
    };
  }
}

function setup(overrides: Record<string, string> = {}) {
  const archive = new ForecastArchive(':memory:');
  const provider = new FixtureProvider();
  const config = loadConfig({ NODE_ENV: 'test', RATE_LIMIT_PER_MINUTE: '10', ...overrides });
  const handler = createHandler({ config, archive, provider, now: () => now });
  return { archive, provider, handler };
}

describe('Weathercast API', () => {
  test('serves liveness and rejects malformed coordinates', async () => {
    const { archive, handler } = setup();
    expect((await handler(new Request('http://api/healthz'))).status).toBe(200);
    const response = await handler(new Request('http://api/v1/nowcast?latitude=91&longitude=bad'));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_COORDINATES');
    expect((await handler(new Request('http://api/v1/nowcast'))).status).toBe(400);
    archive.close();
  });

  test('accepts coordinates in a POST body so production URLs do not expose location', async () => {
    const { archive, handler } = setup();
    const response = await handler(new Request('http://api/v1/nowcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: 28.6139, longitude: 77.209 }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).forecastId).toBeString();
    archive.close();
  });

  test('archives before returning and reuses a fresh immutable issue', async () => {
    const { archive, provider, handler } = setup();
    const url = 'http://api/v1/nowcast?latitude=28.6139&longitude=77.2090';
    const first = await handler(new Request(url));
    const firstBody = await first.json();
    const second = await handler(new Request(url));
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(first.headers.get('X-Weathercast-Cache')).toBe('MISS');
    expect(first.headers.get('ETag')).toBe(`"${firstBody.forecastId}"`);
    expect(second.headers.get('X-Weathercast-Cache')).toBe('HIT');
    expect(firstBody.forecastId).toBe(secondBody.forecastId);
    expect(firstBody.intervals).toHaveLength(8);
    expect(parseNowcastResponse(firstBody).forecastId).toBe(firstBody.forecastId);
    expect(firstBody.confidence).toEqual({
      score: 0,
      label: 'low',
      explanation: 'Timing confidence is not yet calibrated for this coverage tier.',
    });
    expect(provider.calls).toBe(1);
    expect(archive.countForecasts()).toBe(1);
    archive.close();
  });

  test('supports conditional reads without changing the archived issue', async () => {
    const { archive, handler } = setup();
    const url = 'http://api/v1/nowcast?latitude=28.6139&longitude=77.2090';
    const first = await handler(new Request(url));
    const etag = first.headers.get('ETag')!;
    const unchanged = await handler(new Request(url, { headers: { 'If-None-Match': etag } }));
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get('ETag')).toBe(etag);
    expect(archive.countForecasts()).toBe(1);
    archive.close();
  });

  test('deduplicates simultaneous requests for one location cell', async () => {
    const { archive, provider, handler } = setup();
    const url = 'http://api/v1/nowcast?latitude=28.6139&longitude=77.2090';
    const responses = await Promise.all(Array.from({ length: 50 }, () => handler(new Request(url, {
      headers: { 'x-forwarded-for': crypto.randomUUID() },
    }))));
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(new Set(bodies.map((body) => body.forecastId)).size).toBe(1);
    expect(provider.calls).toBe(1);
    expect(archive.countForecasts()).toBe(1);
    archive.close();
  });

  test('rate limits abusive callers and redacts provider errors', async () => {
    const { archive, handler } = setup({ RATE_LIMIT_PER_MINUTE: '1' });
    const url = 'http://api/v1/nowcast?latitude=28.6&longitude=77.2';
    expect((await handler(new Request(url))).status).toBe(200);
    const limited = await handler(new Request(url));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).not.toBeNull();
    archive.close();

    const failingArchive = new ForecastArchive(':memory:');
    const failingProvider: ForecastProvider = { fetch: async () => { throw new Error('secret upstream detail'); } };
    const config = loadConfig({ NODE_ENV: 'test' });
    const failingHandler = createHandler({ config, archive: failingArchive, provider: failingProvider, now: () => now });
    const failed = await failingHandler(new Request(url));
    const body = await failed.text();
    expect(failed.status).toBe(502);
    expect(body).not.toContain('secret upstream detail');
    failingArchive.close();
  });

  test('never returns success when the immutable archive write fails', async () => {
    const { archive, handler } = setup();
    archive.save = () => { throw new Error('disk full'); };
    const response = await handler(new Request('http://api/v1/nowcast?latitude=28.6&longitude=77.2'));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('ARCHIVE_UNAVAILABLE');
    archive.close();
  });
});
