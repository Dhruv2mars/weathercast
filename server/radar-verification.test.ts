import { describe, expect, test } from 'bun:test';

import { ForecastArchive } from './archive';

describe('radar shadow verification', () => {
  test('aggregates immutable point Brier scores from independent verified observations', () => {
    const archive = new ForecastArchive(':memory:');
    const frameIds = Array.from({ length: 3 }, (_, index) => {
      const source = archive.saveSourceAsset({
        provider: 'noaa-mrms-nodd',
        upstreamKey: `frame-${index}`,
        retrievedAt: '2026-07-10T15:40:00.000Z',
        mediaType: 'application/gzip',
        bytes: new Uint8Array([index]),
      });
      return archive.saveRadarFrame({
        domain: 'CONUS',
        product: 'PrecipRate_00.00',
        observedAt: new Date(Date.parse('2026-07-10T15:30:00Z') + index * 120_000).toISOString(),
        retrievedAt: '2026-07-10T15:40:00.000Z',
        objectKey: `frame-${index}`,
        sourceAssetId: source.id,
      });
    });
    const response = {
      sourceDataTime: '2026-07-10T15:34:00.000Z',
      intervals: Array.from({ length: 8 }, (_, index) => ({
        leadStartMinutes: index * 15,
        leadEndMinutes: (index + 1) * 15,
        status: 'valid',
        probability: index === 0 ? 80 : 20,
      })),
    };
    const runId = archive.saveRadarNowcastRun({
      issuedAt: '2026-07-10T15:35:00.000Z',
      sourceDataTime: response.sourceDataTime,
      latitude: 34.6372,
      longitude: -86.7751,
      domain: 'CONUS',
      product: 'PrecipRate_00.00',
      algorithmVersion: 'translation-ensemble-v1',
      inputFrameIds: frameIds,
      response,
    }).id;
    archive.saveObservation({
      source: 'fixture-retrospective-leak',
      sourceEventId: 'must-be-excluded',
      observedAt: '2026-07-10T15:34:30.000Z',
      latitude: 34.6372,
      longitude: -86.7751,
      rainObserved: false,
      quality: 'verified',
      payload: {},
    });
    archive.saveObservation({
      source: 'fixture-independent-gauge',
      sourceEventId: 'wet',
      observedAt: '2026-07-10T15:39:00.000Z',
      latitude: 34.6372,
      longitude: -86.7751,
      rainObserved: true,
      quality: 'verified',
      payload: {},
    });
    archive.saveObservation({
      source: 'fixture-independent-gauge',
      sourceEventId: 'dry',
      observedAt: '2026-07-10T15:44:00.000Z',
      latitude: 34.6372,
      longitude: -86.7751,
      rainObserved: false,
      quality: 'verified',
      payload: {},
    });
    archive.saveObservation({
      source: 'fixture-provisional',
      sourceEventId: 'excluded',
      observedAt: '2026-07-10T15:39:00.000Z',
      latitude: 34.6372,
      longitude: -86.7751,
      rainObserved: false,
      quality: 'provisional',
      payload: {},
    });

    expect(archive.verifyRadarBrier('radar-brier-v1', new Date('2026-07-10T18:00:00.000Z')))
      .toEqual({ observationsMatched: 2, scoresWritten: 1 });
    const scores = archive.listRadarScores();
    expect(scores).toEqual([expect.objectContaining({
      run_id: runId,
      metric: 'brier_rain_occurrence_point',
      horizon_minutes: 0,
      verification_version: 'radar-brier-v1',
      observation_count: 2,
    })]);
    expect(scores[0].value).toBeCloseTo(0.34);
    expect(archive.verifyRadarBrier('radar-brier-v1', new Date('2026-07-10T18:00:00.000Z')))
      .toEqual({ observationsMatched: 2, scoresWritten: 0 });
    archive.close();
  });
});
