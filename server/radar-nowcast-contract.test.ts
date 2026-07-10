import { describe, expect, test } from 'bun:test';

import { radarNowcastSchema } from './radar-nowcast-contract';

function payload() {
  return {
    schemaVersion: 1,
    algorithmVersion: 'translation-ensemble-v1',
    source: 'noaa-mrms-nodd',
    product: 'PrecipRate_00.00',
    sourceDataTime: '2026-07-10T15:38:00Z',
    horizonMinutes: 120,
    calibrationStatus: 'uncalibrated',
    motion: {
      status: 'estimated',
      rowPixelsPerMinute: 0.1,
      columnPixelsPerMinute: -0.2,
      spreadPixelsPerMinute: 0.08,
      signal: 0.8,
    },
    ensembleMembers: 24,
    seed: '0123456789abcdef',
    intervals: Array.from({ length: 8 }, (_, index) => ({
      leadStartMinutes: index * 15,
      leadEndMinutes: (index + 1) * 15,
      validAt: new Date(Date.parse('2026-07-10T15:38:00Z') + (index * 15 + 7.5) * 60_000).toISOString(),
      status: 'valid' as const,
      probability: 50,
      rainRateMmPerHour: 2.5,
    })),
    location: { latitude: 35.005, longitude: -87.115 },
    inputSha256: Array.from({ length: 4 }, (_, index) => index.toString(16).repeat(64)),
    coverage: {
      tier: 'shadow',
      minimumTileFraction: 1,
      spatialResolutionKm: 1,
      reason: 'Uncalibrated shadow run.',
    },
  };
}

describe('radar nowcast contract', () => {
  test('accepts a complete shadow ensemble', () => {
    expect(radarNowcastSchema.safeParse(payload()).success).toBe(true);
  });

  test('rejects gaps and fake dry values where radar coverage is absent', () => {
    const gapped = payload();
    gapped.intervals[2].leadStartMinutes = 31;
    expect(radarNowcastSchema.safeParse(gapped).success).toBe(false);

    const unavailable = payload();
    unavailable.intervals[0] = {
      ...unavailable.intervals[0],
      status: 'no_coverage' as 'valid',
      probability: 0,
      rainRateMmPerHour: 0,
    };
    expect(radarNowcastSchema.safeParse(unavailable).success).toBe(false);
  });
});
