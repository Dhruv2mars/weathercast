import { describe, expect, test } from 'bun:test';

import { getScheduledIssueTime, selectStudyRadarFrames } from './study-issuance';

describe('prospective study issuance', () => {
  test('assigns wall-clock execution to the fixed registered cadence slot', () => {
    expect(getScheduledIssueTime({
      now: new Date('2026-07-11T00:29:59.999Z'),
      startsAt: '2026-07-11T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
      cadenceMinutes: 15,
    })).toBe('2026-07-11T00:15:00.000Z');
    expect(() => getScheduledIssueTime({
      now: new Date('2026-07-10T23:59:59.999Z'),
      startsAt: '2026-07-11T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
      cadenceMinutes: 15,
    })).toThrow('registered issuance period');
  });

  test('requires a fresh chronological sequence without radar frame gaps', () => {
    const frame = (minute: string) => ({
      id: minute,
      observed_at: `2026-07-11T00:${minute}:00.000Z`,
      retrieved_at: '2026-07-11T00:07:00.000Z',
      object_key: minute,
      source_asset_id: minute,
    });
    expect(selectStudyRadarFrames({
      newestFirst: [frame('06'), frame('04'), frame('02'), frame('00')],
      expectedCount: 4,
      now: new Date('2026-07-11T00:07:00.000Z'),
    }).map((candidate) => candidate.id)).toEqual(['00', '02', '04', '06']);
    expect(() => selectStudyRadarFrames({
      newestFirst: [frame('06'), frame('04'), frame('02'), frame('00')],
      expectedCount: 4,
      now: new Date('2026-07-11T00:17:00.001Z'),
    })).toThrow('freshness limit');
    expect(() => selectStudyRadarFrames({
      newestFirst: [frame('08'), frame('02'), frame('00')],
      expectedCount: 3,
      now: new Date('2026-07-11T00:09:00.000Z'),
    })).toThrow('spacing is invalid');
    expect(() => selectStudyRadarFrames({
      newestFirst: [frame('06'), frame('04'), frame('invalid'), frame('00')],
      expectedCount: 4,
      now: new Date('2026-07-11T00:07:00.000Z'),
    })).toThrow('invalid observation time');
  });
});
