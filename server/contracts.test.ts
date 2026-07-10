import { describe, expect, test } from 'bun:test';

import { normalizedUpstreamSchema } from './contracts';

function payload() {
  const start = new Date('2026-07-10T10:00:00.000Z');
  return {
    issuedAt: '2026-07-10T09:55:00.000Z',
    timezone: 'Asia/Kolkata',
    source: 'Licensed fixture',
    upstreamRunId: 'run-42',
    dataTier: 'standard' as const,
    calibrationStatus: 'uncalibrated' as const,
    spatialResolutionKm: 9,
    coverageReason: 'Model-only coverage.',
    intervals: Array.from({ length: 8 }, (_, index) => ({
      time: new Date(start.getTime() + index * 15 * 60_000).toISOString(),
      precipitationMm: 0,
      rainMm: 0,
      showersMm: 0,
      probability: 10,
      weatherCode: 0,
    })),
  };
}

describe('normalized upstream contract', () => {
  test('accepts exactly eight chronological 15-minute intervals', () => {
    expect(normalizedUpstreamSchema.safeParse(payload()).success).toBe(true);
  });

  test('rejects gaps, duplicates, and a horizon longer than 120 minutes', () => {
    const gapped = payload();
    gapped.intervals[3].time = gapped.intervals[2].time;
    expect(normalizedUpstreamSchema.safeParse(gapped).success).toBe(false);

    const tooLong = payload();
    tooLong.intervals.push({ ...tooLong.intervals[7], time: '2026-07-10T12:00:00.000Z' });
    expect(normalizedUpstreamSchema.safeParse(tooLong).success).toBe(false);
  });
});
