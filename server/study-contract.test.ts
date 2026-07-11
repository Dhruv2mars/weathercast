import { describe, expect, test } from 'bun:test';

import { parseStoredStudyDefinition, studyDefinitionSchema } from './study-contract';

function definition() {
  return {
    id: 'mrms-metar-conus-2026q3-v1',
    title: 'Prospective CONUS MRMS rain occurrence study',
    startsAt: '2026-07-11T00:00:00.000Z',
    endsAt: '2026-10-01T00:00:00.000Z',
    algorithmVersion: 'translation-ensemble-v1',
    domain: 'CONUS',
    product: 'PrecipRate_00.00',
    inputFrameCount: 4,
    ensembleMembers: 24,
    stationIds: ['KHSV', 'KJFK', 'KSEA', 'KSFO'],
    issueCadenceMinutes: 15,
    horizonsMinutes: [0, 15, 30, 45, 60, 75, 90, 105],
    primaryMetric: 'brier_rain_occurrence_point',
    minimumObservationCountPerHorizon: 5_000,
    minimumIssuanceCompleteness: 0.95,
    observationSamplingPolicy: 'one nearest verified METAR observation per run and horizon; ties use earliest observation',
    validTimePolicy: 'observation must be at or after issuance and before study end',
    exclusionPolicy: 'verified prospective observations only; no post-registration cohort changes',
  };
}

describe('prospective study definition', () => {
  test('accepts a fixed cohort, period, metric, horizons, and sample gate', () => {
    expect(studyDefinitionSchema.safeParse(definition()).success).toBe(true);
  });

  test('requires bounded runtime parameters in every new definition', () => {
    const { inputFrameCount: _inputFrameCount, ...withoutFrames } = definition();
    expect(studyDefinitionSchema.safeParse(withoutFrames).success).toBe(false);
    const { ensembleMembers: _ensembleMembers, ...withoutMembers } = definition();
    expect(studyDefinitionSchema.safeParse(withoutMembers).success).toBe(false);
    expect(studyDefinitionSchema.safeParse({ ...definition(), inputFrameCount: 2 }).success).toBe(false);
    expect(studyDefinitionSchema.safeParse({ ...definition(), ensembleMembers: 97 }).success).toBe(false);
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
    expect(studyDefinitionSchema.safeParse({
      ...definition(),
      startsAt: '2026-07-11T00:00:00Z',
    }).success).toBe(false);
    expect(studyDefinitionSchema.safeParse({
      ...definition(),
      minimumIssuanceCompleteness: 0.8,
    }).success).toBe(false);
    expect(() => studyDefinitionSchema.safeParse({
      ...definition(),
      startsAt: '2026-02-30T00:00:00.000Z',
    })).not.toThrow();
  });

  test('reads legacy studies diagnostically without pretending report rules were preregistered', () => {
    const legacy = definition();
    const {
      inputFrameCount: _inputFrameCount,
      ensembleMembers: _ensembleMembers,
      minimumIssuanceCompleteness: _minimumIssuanceCompleteness,
      observationSamplingPolicy: _observationSamplingPolicy,
      validTimePolicy: _validTimePolicy,
      ...legacyDefinition
    } = legacy;
    const parsed = parseStoredStudyDefinition({ schemaVersion: 1, ...legacyDefinition });
    expect(parsed).toEqual(expect.objectContaining({
      schemaVersion: 1,
      reportPolicyPreregistered: false,
      runtimeParametersPreregistered: false,
      definition: expect.objectContaining({
        minimumIssuanceCompleteness: 0.95,
        inputFrameCount: 4,
        ensembleMembers: 24,
      }),
    }));
    const v2 = parseStoredStudyDefinition({
      schemaVersion: 2,
      ...legacyDefinition,
      minimumIssuanceCompleteness: 0.95,
      observationSamplingPolicy: definition().observationSamplingPolicy,
      validTimePolicy: definition().validTimePolicy,
    });
    expect(v2).toEqual(expect.objectContaining({
      reportPolicyPreregistered: true,
      runtimeParametersPreregistered: false,
    }));
    expect(parseStoredStudyDefinition({ schemaVersion: 3, ...definition() })).toEqual(expect.objectContaining({
      reportPolicyPreregistered: true,
      runtimeParametersPreregistered: true,
    }));
  });
});
