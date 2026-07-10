import { describe, expect, test } from 'bun:test';

import { parseCanonicalUtcTimestamp } from './canonical-time';

describe('canonical UTC operations timestamps', () => {
  test('accepts exact UTC ISO and rejects local or normalized variants', () => {
    expect(parseCanonicalUtcTimestamp('2026-07-25T01:00:00.000Z', 'Fit time'))
      .toBe('2026-07-25T01:00:00.000Z');
    expect(() => parseCanonicalUtcTimestamp('2026-07-25T01:00:00', 'Fit time'))
      .toThrow('canonical UTC ISO');
    expect(() => parseCanonicalUtcTimestamp('2026-07-25T01:00:00+05:30', 'Fit time'))
      .toThrow('canonical UTC ISO');
  });
});
