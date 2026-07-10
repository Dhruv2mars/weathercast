import { describe, expect, test } from 'bun:test';

import { parseNowcastResponse } from '@/services/nowcast-contract';

const valid = {
  issuedAt: '2026-07-10T08:00:00.000Z',
  status: 'clear' as const,
  headline: 'No rain expected for 2 hours',
  detail: 'No rain signal detected near this location.',
  clearMinutes: 120,
  intervals: [{
    time: '2026-07-10T08:00:00.000Z',
    precipitationMm: 0,
    rainMm: 0,
    showersMm: 0,
    probability: 10,
    weatherCode: 1,
  }],
  confidence: { score: 78, label: 'high' as const, explanation: 'Guidance agrees.' },
  dataTier: 'precision' as const,
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
});
