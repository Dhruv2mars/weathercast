import { describe, expect, test } from 'bun:test';

import { buildNowcast } from '@/domain/nowcast';
import type { NormalizedForecast } from '@/types/weather';

const issuedAt = new Date('2026-07-10T10:00:00.000Z');

function forecast(amounts: number[], probabilities: number[] = amounts.map(() => 70)): NormalizedForecast {
  const paddedAmounts = [...amounts, ...Array(8 - amounts.length).fill(0)].slice(0, 8);
  const paddedProbabilities = [...probabilities, ...Array(8 - probabilities.length).fill(0)].slice(0, 8);
  return {
    issuedAt: issuedAt.toISOString(),
    timezone: 'UTC',
    source: 'Test provider',
    intervals: paddedAmounts.map((precipitationMm, index) => ({
      time: new Date(issuedAt.getTime() + index * 15 * 60_000).toISOString(),
      precipitationMm,
      rainMm: precipitationMm,
      showersMm: 0,
      probability: paddedProbabilities[index] ?? 0,
      weatherCode: precipitationMm > 0 ? 61 : 0,
    })),
  };
}

describe('buildNowcast', () => {
  test('reports a clear 120-minute window when all intervals are dry', () => {
    const result = buildNowcast(forecast([0, 0, 0, 0, 0, 0, 0, 0]), issuedAt);

    expect(result.status).toBe('clear');
    expect(result.event).toBeNull();
    expect(result.clearMinutes).toBe(120);
    expect(result.headline).toBe('No rain expected for 2 hours');
  });

  test('finds onset, end, peak intensity, and timing window', () => {
    const result = buildNowcast(forecast([0, 0, 0.2, 0.8, 2.6, 0.4, 0, 0]), issuedAt);

    expect(result.status).toBe('incoming');
    expect(result.event?.startTime).toBe('2026-07-10T10:30:00.000Z');
    expect(result.event?.endTime).toBe('2026-07-10T11:30:00.000Z');
    expect(result.event?.peakIntensity).toBe('heavy');
    expect(result.headline).toBe('Rain likely in 25–35 minutes');
  });

  test('treats a one-interval dry gap as the same rain event', () => {
    const result = buildNowcast(forecast([0.2, 0, 0.6, 0, 0, 0, 0, 0]), issuedAt);

    expect(result.status).toBe('raining');
    expect(result.event?.endTime).toBe('2026-07-10T10:45:00.000Z');
  });

  test('lowers confidence when provider probability disagrees with rain amount', () => {
    const aligned = buildNowcast(forecast([0, 0.3, 0.4, 0], [10, 90, 90, 10]), issuedAt);
    const conflicting = buildNowcast(forecast([0, 0.3, 0.4, 0], [90, 15, 10, 90]), issuedAt);

    expect(aligned.confidence.score).toBeGreaterThan(conflicting.confidence.score);
  });

  test('rejects incomplete or distant forecast horizons', () => {
    expect(() => buildNowcast({ ...forecast([0, 0]), intervals: forecast([0, 0]).intervals.slice(0, 2) }, issuedAt)).toThrow('FORECAST_HORIZON_UNAVAILABLE');
    expect(() => buildNowcast(forecast([0, 0, 0, 0, 0, 0, 0, 0]), new Date('2026-07-09T10:00:00.000Z'))).toThrow('FORECAST_HORIZON_UNAVAILABLE');
  });
});
