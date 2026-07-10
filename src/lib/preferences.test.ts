import { describe, expect, test } from 'bun:test';

import { parsePreferences } from '@/lib/preferences';

describe('parsePreferences', () => {
  test('returns safe defaults for missing or invalid storage', () => {
    expect(parsePreferences(null)).toEqual({
      alerts: { enabled: false, leadMinutes: 15, significantOnly: false },
      onboardingComplete: false,
      selectedPlaceId: 'current',
    });
    expect(parsePreferences('{broken')).toEqual(parsePreferences(null));
  });

  test('rejects out-of-range lead times while preserving valid values', () => {
    const parsed = parsePreferences(JSON.stringify({
      alerts: { enabled: true, leadMinutes: 99, significantOnly: true },
      onboardingComplete: true,
      selectedPlaceId: 'delhi',
    }));

    expect(parsed.alerts).toEqual({ enabled: true, leadMinutes: 15, significantOnly: true });
    expect(parsed.selectedPlaceId).toBe('delhi');
  });
});
