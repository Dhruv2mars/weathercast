import { describe, expect, test } from 'bun:test';

import { studyDefinitionSchema } from './study-contract';

function definition() {
  return {
    id: 'mrms-metar-conus-2026q3-v1',
    title: 'Prospective CONUS MRMS rain occurrence study',
    startsAt: '2026-07-11T00:00:00.000Z',
    endsAt: '2026-10-01T00:00:00.000Z',
    algorithmVersion: 'translation-ensemble-v1',
    domain: 'CONUS',
    product: 'PrecipRate_00.00',
    stationIds: ['KHSV', 'KJFK', 'KSEA', 'KSFO'],
    issueCadenceMinutes: 15,
    horizonsMinutes: [0, 15, 30, 45, 60, 75, 90, 105],
    primaryMetric: 'brier_rain_occurrence_point',
    minimumObservationCountPerHorizon: 5_000,
    exclusionPolicy: 'verified prospective observations only; no post-registration cohort changes',
  };
}

describe('prospective study definition', () => {
  test('accepts a fixed cohort, period, metric, horizons, and sample gate', () => {
    expect(studyDefinitionSchema.safeParse(definition()).success).toBe(true);
  });

  test('rejects short studies, duplicate stations, and cherry-picked horizon order', () => {
    const short = definition();
    short.endsAt = '2026-07-12T00:00:00.000Z';
    expect(studyDefinitionSchema.safeParse(short).success).toBe(false);
    const duplicates = definition();
    duplicates.stationIds = ['KHSV', 'KHSV'];
    expect(studyDefinitionSchema.safeParse(duplicates).success).toBe(false);
    const reordered = definition();
    reordered.horizonsMinutes = [15, 0];
    expect(studyDefinitionSchema.safeParse(reordered).success).toBe(false);
    const impossible = definition();
    impossible.minimumObservationCountPerHorizon = 1_000_000;
    expect(studyDefinitionSchema.safeParse(impossible).success).toBe(false);
    const misaligned = definition();
    misaligned.startsAt = '2026-07-11T00:01:00.000Z';
    expect(studyDefinitionSchema.safeParse(misaligned).success).toBe(false);
  });
});
