import { describe, expect, test } from 'bun:test';

import { isCachedNowcast, parseStoredPlaces } from '@/lib/storage-validation';

const validPlace = {
  id: 'delhi',
  name: 'New Delhi',
  admin: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  source: 'saved' as const,
};

const validNowcast = {
  issuedAt: '2026-07-10T10:00:00.000Z',
  validUntil: '2026-07-10T10:04:00.000Z',
  status: 'clear' as const,
  headline: 'No rain expected for 2 hours',
  detail: 'No rain signal detected near this location.',
  clearMinutes: 120,
  intervals: Array.from({ length: 8 }, (_, index) => ({
    time: new Date(Date.parse('2026-07-10T10:00:00.000Z') + index * 15 * 60_000).toISOString(),
    precipitationMm: 0,
    rainMm: 0,
    showersMm: 0,
    probability: 0,
    weatherCode: 0,
  })),
  confidence: { score: 20, label: 'low' as const, explanation: 'Uncertain.' },
  dataTier: 'standard' as const,
  source: 'Open-Meteo',
  event: null,
};

describe('storage validation', () => {
  test('filters malformed and out-of-range places while retaining valid records', () => {
    expect(parseStoredPlaces([
      validPlace,
      null,
      { ...validPlace, id: 'bad-null', latitude: null },
      { ...validPlace, id: 'bad-source', source: 'unknown' },
      { ...validPlace, id: 'bad-range', longitude: 181 },
    ])).toEqual([validPlace]);
  });

  test('rejects malformed nowcast cache roots and partial records', () => {
    expect(isCachedNowcast(null)).toBe(false);
    expect(isCachedNowcast({ headline: 'partial' })).toBe(false);
    expect(isCachedNowcast(validNowcast)).toBe(true);
  });

  test('rejects malformed intervals instead of treating them as clear weather', () => {
    expect(isCachedNowcast({
      ...validNowcast,
      intervals: [{ ...validNowcast.intervals[0], precipitationMm: null }],
    })).toBe(false);
  });
});
