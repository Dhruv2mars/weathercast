import { describe, expect, test } from 'bun:test';

import { ForecastArchive, locationCell, type NowcastEnvelope } from './archive';

const start = new Date('2026-07-10T10:00:00.000Z');

function envelope(): NowcastEnvelope {
  return {
    schemaVersion: 1,
    forecastId: 'forecast-1',
    issuedAt: '2026-07-10T09:55:00.000Z',
    generatedAt: start.toISOString(),
    validUntil: '2026-07-10T10:04:00.000Z',
    timezone: 'Asia/Kolkata',
    sourceDataTime: null,
    status: 'incoming',
    headline: 'Rain likely in 10–20 minutes',
    detail: 'Moderate rain may last about 15 minutes.',
    clearMinutes: 15,
    intervals: Array.from({ length: 8 }, (_, index) => ({
      time: new Date(start.getTime() + index * 15 * 60_000).toISOString(),
      precipitationMm: index === 1 ? 0.8 : 0,
      rainMm: index === 1 ? 0.8 : 0,
      showersMm: 0,
      probability: index === 1 ? 80 : 10,
      weatherCode: index === 1 ? 61 : 0,
    })),
    confidence: { score: 0, label: 'low', explanation: 'Uncalibrated.' },
    calibrationStatus: 'uncalibrated',
    dataTier: 'standard',
    source: 'Fixture',
    coverage: { reason: 'Model only.', spatialResolutionKm: 9 },
    event: {
      startTime: '2026-07-10T10:15:00.000Z',
      endTime: '2026-07-10T10:30:00.000Z',
      onsetWindowStart: '2026-07-10T10:10:00.000Z',
      onsetWindowEnd: '2026-07-10T10:20:00.000Z',
      peakIntensity: 'moderate',
      peakMm: 0.8,
      durationMinutes: 15,
    },
  };
}

describe('verification archive', () => {
  test('computes reproducible Brier scores from independent verified observations', () => {
    const archive = new ForecastArchive(':memory:');
    const forecast = envelope();
    archive.save({
      envelope: forecast,
      cell: locationCell(28.6139, 77.209),
      latitude: 28.6139,
      longitude: 77.209,
      provider: 'fixture',
    });
    archive.saveObservation({
      source: 'station-fixture',
      sourceEventId: 'observation-1',
      observedAt: '2026-07-10T10:20:00.000Z',
      latitude: 28.6139,
      longitude: 77.209,
      rainObserved: true,
      accumulationMm: 0.7,
      quality: 'verified',
      payload: { rain: true },
    });

    expect(archive.verifyBrier('v1', new Date('2026-07-10T10:30:00.000Z'))).toEqual({
      observationsMatched: 1,
      scoresWritten: 1,
    });
    const [score] = archive.listScores();
    expect(score.metric).toBe('brier');
    expect(score.horizon_minutes).toBe(15);
    expect(score.value).toBeCloseTo(0.04, 8);
    expect(archive.verifyBrier('v1', new Date('2026-07-10T10:30:00.000Z')).scoresWritten).toBe(0);
    expect(archive.verifyBrier('v2', new Date('2026-07-10T10:30:00.000Z')).scoresWritten).toBe(1);
    archive.close();
  });

  test('excludes provisional and rejected observations', () => {
    const archive = new ForecastArchive(':memory:');
    const forecast = envelope();
    archive.save({ envelope: forecast, cell: locationCell(28.6139, 77.209), latitude: 28.6139, longitude: 77.209, provider: 'fixture' });
    archive.saveObservation({
      source: 'station-fixture',
      sourceEventId: 'observation-rejected',
      observedAt: '2026-07-10T10:20:00.000Z',
      latitude: 28.6139,
      longitude: 77.209,
      rainObserved: true,
      quality: 'rejected',
      payload: {},
    });
    expect(archive.verifyBrier('v1', new Date('2026-07-10T10:30:00.000Z'))).toEqual({ observationsMatched: 0, scoresWritten: 0 });
    archive.close();
  });
});
