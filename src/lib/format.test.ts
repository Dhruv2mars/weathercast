import { describe, expect, test } from 'bun:test';

import { formatForecastFreshness } from '@/lib/format';

const issuedAt = '2026-07-16T12:00:00.000Z';
const now = new Date('2026-07-16T12:00:20.000Z');

describe('forecast freshness', () => {
  test('formats recent online forecasts normally', () => {
    expect(formatForecastFreshness(issuedAt, true, now)).toBe('Updated now');
  });

  test('labels offline data as cached even when it was generated recently', () => {
    expect(formatForecastFreshness(issuedAt, false, now)).toBe('Cached forecast · Updated now');
  });
});
