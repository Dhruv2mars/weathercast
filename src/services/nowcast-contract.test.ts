import { describe, expect, test } from 'bun:test';

import { parseNowcastResponse } from '@/services/nowcast-contract';

const valid = {
  schemaVersion: 1 as const,
  forecastId: 'forecast-1',
  issuedAt: '2026-07-10T08:00:00.000Z',
  generatedAt: '2026-07-10T08:00:04.000Z',
  validUntil: '2026-07-10T08:04:04.000Z',
  timezone: 'Asia/Kolkata',
  sourceDataTime: '2026-07-10T07:55:00.000Z',
  status: 'clear' as const,
  headline: 'No rain expected for 2 hours',
  detail: 'No rain signal detected near this location.',
  clearMinutes: 120,
  intervals: Array.from({ length: 8 }, (_, index) => ({
    time: new Date(new Date('2026-07-10T08:00:00.000Z').getTime() + index * 15 * 60_000).toISOString(),
    precipitationMm: 0,
    rainMm: 0,
    showersMm: 0,
    probability: 10,
    weatherCode: 1,
  })),
  confidence: { score: 78, label: 'high' as const, explanation: 'Guidance agrees.' },
  dataTier: 'precision' as const,
  calibrationStatus: 'calibrated' as const,
  coverage: { reason: 'Current radar and verified calibration.', spatialResolutionKm: 1 },
  source: 'Weathercast ensemble',
  event: null,
};

describe('parseNowcastResponse', () => {
  test('accepts a complete normalized response', () => {
    expect(parseNowcastResponse(valid)).toEqual(valid);
  });

  test('rejects impossible probabilities and partial events', () => {
    expect(() => parseNowcastResponse({ ...valid, intervals: [{ ...valid.intervals[0], probability: 101 }] })).toThrow();
    expect(() => parseNowcastResponse({ ...valid, event: { startTime: valid.issuedAt } })).toThrow();
  });

  test('rejects interval gaps and unsupported precision claims', () => {
    const gapped = { ...valid, intervals: valid.intervals.map((interval) => ({ ...interval })) };
    gapped.intervals[2].time = gapped.intervals[1].time;
    expect(() => parseNowcastResponse(gapped)).toThrow();
    expect(() => parseNowcastResponse({ ...valid, calibrationStatus: 'uncalibrated' })).toThrow();
  });
});
