import { describe, expect, test } from 'bun:test';

import { validateRadarDecoderOutput } from './radar-nowcast-runner';

const checksums = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];

function output(overrides: Record<string, unknown> = {}) {
  const sourceDataTime = '2026-07-10T15:38:00Z';
  return JSON.stringify({
    schemaVersion: 1,
    algorithmVersion: 'translation-ensemble-v1',
    source: 'noaa-mrms-nodd',
    product: 'PrecipRate_00.00',
    sourceDataTime,
    horizonMinutes: 120,
    calibrationStatus: 'uncalibrated',
    motion: {
      status: 'estimated',
      rowPixelsPerMinute: 0,
      columnPixelsPerMinute: 0,
      spreadPixelsPerMinute: 0.08,
      signal: 0.8,
    },
    ensembleMembers: 24,
    seed: '0123456789abcdef',
    intervals: Array.from({ length: 8 }, (_, index) => ({
      leadStartMinutes: index * 15,
      leadEndMinutes: (index + 1) * 15,
      validAt: new Date(Date.parse(sourceDataTime) + (index * 15 + 7.5) * 60_000).toISOString(),
      status: 'valid',
      probability: 50,
      rainRateMmPerHour: 2,
    })),
    location: { latitude: 35.005, longitude: -87.115 },
    inputSha256: checksums,
    coverage: {
      tier: 'shadow',
      minimumTileFraction: 1,
      spatialResolutionKm: 1,
      reason: 'Uncalibrated shadow run.',
    },
    ...overrides,
  });
}

const expected = {
  latitude: 35.005,
  longitude: -87.115,
  sourceDataTime: '2026-07-10T15:38:00.000Z',
  inputSha256: checksums,
};

describe('radar decoder boundary', () => {
  test('accepts output tied to the archived coordinate, time, and exact inputs', () => {
    expect(validateRadarDecoderOutput({ output: output(), ...expected }).inputSha256).toEqual(checksums);
  });

  test('rejects substituted, omitted, or reordered source assets', () => {
    expect(() => validateRadarDecoderOutput({
      output: output({ inputSha256: checksums.slice(0, 3) }),
      ...expected,
    })).toThrow('checksums do not match');
    expect(() => validateRadarDecoderOutput({
      output: output({ inputSha256: [...checksums].reverse() }),
      ...expected,
    })).toThrow('checksums do not match');
  });

  test('rejects a substituted target or source time', () => {
    expect(() => validateRadarDecoderOutput({
      output: output({ location: { latitude: 36, longitude: -87.115 } }),
      ...expected,
    })).toThrow('different location');
    expect(() => validateRadarDecoderOutput({
      output: output({ sourceDataTime: '2026-07-10T15:36:00Z' }),
      ...expected,
    })).toThrow();
  });
});
