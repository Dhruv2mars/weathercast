import { describe, expect, test } from 'bun:test';

import { getAlertPlan } from '@/domain/alerts';
import type { Nowcast } from '@/types/weather';

const now = new Date('2026-07-10T10:00:00.000Z');

const base: Nowcast = {
  issuedAt: now.toISOString(),
  status: 'incoming',
  headline: 'Rain likely in 25–35 minutes',
  detail: 'Moderate rain may last 30 minutes.',
  clearMinutes: 30,
  intervals: [],
  confidence: { score: 82, label: 'high', explanation: 'Sources agree.' },
  dataTier: 'standard',
  source: 'Test provider',
  event: {
    startTime: '2026-07-10T10:30:00.000Z',
    endTime: '2026-07-10T11:00:00.000Z',
    onsetWindowStart: '2026-07-10T10:25:00.000Z',
    onsetWindowEnd: '2026-07-10T10:35:00.000Z',
    peakIntensity: 'moderate',
    peakMm: 1.2,
    durationMinutes: 30,
  },
};

describe('getAlertPlan', () => {
  test('schedules before onset using requested lead time', () => {
    const plan = getAlertPlan(base, { enabled: true, leadMinutes: 10, significantOnly: false }, now);

    expect(plan?.triggerAt.toISOString()).toBe('2026-07-10T10:20:00.000Z');
    expect(plan?.title).toBe('Rain in about 10 minutes');
  });

  test('skips light rain when significant-only is enabled', () => {
    const light: Nowcast = { ...base, event: { ...base.event!, peakIntensity: 'light' } };

    expect(getAlertPlan(light, { enabled: true, leadMinutes: 10, significantOnly: true }, now)).toBeNull();
  });

  test('skips alerts whose trigger time already passed', () => {
    expect(getAlertPlan(base, { enabled: true, leadMinutes: 30, significantOnly: false }, now)).toBeNull();
  });

  test('does not schedule an alert beyond the forecast validity window', () => {
    const expiring = {
      ...base,
      validUntil: '2026-07-10T10:04:00.000Z',
    };
    expect(getAlertPlan(expiring, { enabled: true, leadMinutes: 10, significantOnly: false }, now)).toBeNull();
  });
});
