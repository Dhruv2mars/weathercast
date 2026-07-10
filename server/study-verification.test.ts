import { describe, expect, test } from 'bun:test';

import type { RadarNowcast } from './radar-nowcast-contract';
import { studyDefinitionSchema } from './study-contract';
import {
  computeVerificationStudyEvidence,
  computeVerificationStudyReport,
  type StudyVerificationRun,
} from './study-verification';

function definition(overrides: Record<string, unknown> = {}) {
  return studyDefinitionSchema.parse({
    id: 'study-verification-test',
    title: 'Deterministic study verification test',
    startsAt: '2026-07-11T00:00:00.000Z',
    endsAt: '2026-07-18T00:00:00.000Z',
    algorithmVersion: 'translation-ensemble-v1',
    domain: 'CONUS',
    product: 'PrecipRate_00.00',
    stationIds: ['KHSV'],
    issueCadenceMinutes: 15,
    horizonsMinutes: [0, 15],
    primaryMetric: 'brier_rain_occurrence_point',
    minimumObservationCountPerHorizon: 100,
    minimumIssuanceCompleteness: 0.95,
    observationSamplingPolicy: 'one nearest verified METAR observation per run and horizon; ties use earliest observation',
    validTimePolicy: 'observation must be at or after issuance and before study end',
    exclusionPolicy: 'verified prospective observations only; no post-registration cohort changes',
    ...overrides,
  });
}

function nowcast(sourceDataTime: string, probabilities = [80, 20]): RadarNowcast {
  return {
    schemaVersion: 1,
    algorithmVersion: 'translation-ensemble-v1',
    source: 'noaa-mrms-nodd',
    product: 'PrecipRate_00.00',
    sourceDataTime,
    horizonMinutes: 120,
    calibrationStatus: 'uncalibrated',
    motion: {
      status: 'estimated',
      rowPixelsPerMinute: 0,
      columnPixelsPerMinute: 0,
      spreadPixelsPerMinute: 0.1,
      signal: 0.8,
    },
    ensembleMembers: 24,
    seed: '0123456789abcdef',
    intervals: Array.from({ length: 8 }, (_, index) => ({
      leadStartMinutes: index * 15,
      leadEndMinutes: (index + 1) * 15,
      validAt: new Date(Date.parse(sourceDataTime) + (index * 15 + 7.5) * 60_000).toISOString(),
      status: 'valid',
      probability: probabilities[index] ?? 0,
      rainRateMmPerHour: 1,
    })),
    location: { latitude: 34.6441, longitude: -86.7862 },
    inputSha256: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
    coverage: {
      tier: 'shadow',
      minimumTileFraction: 1,
      spatialResolutionKm: 1,
      reason: 'Uncalibrated shadow evaluation.',
    },
  } satisfies RadarNowcast;
}

function provisionalNowcast(sourceDataTime: string): RadarNowcast {
  const response = nowcast(sourceDataTime, [40]);
  response.calibrationStatus = 'provisional';
  response.calibration = {
    artifactId: 'c'.repeat(24),
    artifactSha256: 'd'.repeat(64),
    method: 'isotonic-pav-v1',
    rawProbabilities: [80, 20, 0, 0, 0, 0, 0, 0],
  };
  return response;
}

describe('prospective study report', () => {
  test('exposes the exact scored pairs without changing report accounting', () => {
    const study = definition({ horizonsMinutes: [0] });
    const evidence = computeVerificationStudyEvidence({
      definition: study,
      definitionSha256: '9'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs: [{
        runId: 'run-for-calibration',
        targetId: 'KHSV',
        scheduledAt: study.startsAt,
        issuedAt: '2026-07-11T00:02:00.000Z',
        response: nowcast(study.startsAt, [80]),
      }],
      observations: [{
        id: 'selected-observation',
        targetId: 'KHSV',
        observedAt: '2026-07-11T00:07:00.000Z',
        rainObserved: true,
      }],
      asOf: new Date('2026-07-11T00:15:00.000Z'),
    });
    expect(evidence.report.horizons[0]!.observationCount).toBe(1);
    expect(evidence.pairs).toEqual([{
      studyId: study.id,
      runId: 'run-for-calibration',
      targetId: 'KHSV',
      horizonMinutes: 0,
      probability: 80,
      observedRain: true,
      observedAt: '2026-07-11T00:07:00.000Z',
    }]);
  });

  test('scores archived raw counterfactual probabilities beside provisional calibration', () => {
    const study = definition({ horizonsMinutes: [0] });
    const response = provisionalNowcast(study.startsAt);
    const report = computeVerificationStudyReport({
      definition: study,
      definitionSha256: '8'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs: [{
        runId: 'provisional-run',
        targetId: 'KHSV',
        scheduledAt: study.startsAt,
        issuedAt: '2026-07-11T00:01:00.000Z',
        response,
      }],
      observations: [{
        id: 'dry-observation',
        targetId: 'KHSV',
        observedAt: '2026-07-11T00:07:00.000Z',
        rainObserved: false,
      }],
      asOf: new Date('2026-07-11T00:15:00.000Z'),
    });
    expect(report.calibrationEvidence).toEqual({
      status: 'provisional_holdout',
      artifactIds: ['c'.repeat(24)],
      provisionalRunCount: 1,
      uncalibratedRunCount: 0,
    });
    expect(report.horizons[0]).toEqual(expect.objectContaining({
      brierScore: 0.16,
      uncalibratedCounterfactualCount: 1,
      uncalibratedCounterfactualBrierScore: 0.64,
    }));
  });

  test('opens model promotion only after a preregistered calibration holdout improves paired Brier', () => {
    const study = definition({ horizonsMinutes: [0] });
    const runs = Array.from({ length: 7 * 24 * 4 }, (_, index): StudyVerificationRun => {
      const scheduledAt = Date.parse(study.startsAt) + index * 15 * 60_000;
      return {
        runId: `calibrated-run-${index}`,
        targetId: 'KHSV',
        scheduledAt: new Date(scheduledAt).toISOString(),
        issuedAt: new Date(scheduledAt + 60_000).toISOString(),
        response: provisionalNowcast(new Date(scheduledAt).toISOString()),
      };
    });
    const observations = runs.map((run, index) => ({
      id: `holdout-observation-${index}`,
      targetId: 'KHSV',
      observedAt: new Date(Date.parse(run.scheduledAt) + 7 * 60_000).toISOString(),
      rainObserved: index % 5 < 2,
    }));
    const report = computeVerificationStudyReport({
      definition: study,
      definitionSha256: '7'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs,
      observations,
      asOf: new Date(study.endsAt),
      calibrationEvaluationPolicy: {
        artifactId: 'c'.repeat(24),
        artifactSha256: 'd'.repeat(64),
        maximumHoldoutBrierDegradation: 0,
        minimumAggregateHoldoutBrierImprovement: 0.001,
      },
    });
    expect(report.eligibleForPublication).toBe(true);
    expect(report.eligibleForPrecisionPromotion).toBe(true);
    expect(report.precisionPromotionGateFailures).toEqual([]);
    expect(report.calibrationHoldout).toEqual({
      observationCount: 672,
      rawBrierScore: 0.398929,
      calibratedBrierScore: 0.240357,
      brierImprovement: 0.158571,
    });
  });

  test('rejects malformed holdout policy instead of weakening promotion gates', () => {
    const study = definition({ horizonsMinutes: [0] });
    expect(() => computeVerificationStudyReport({
      definition: study,
      definitionSha256: '6'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs: [],
      observations: [],
      asOf: new Date(study.startsAt),
      calibrationEvaluationPolicy: {
        artifactId: 'c'.repeat(24),
        artifactSha256: 'd'.repeat(64),
        maximumHoldoutBrierDegradation: -1,
        minimumAggregateHoldoutBrierImprovement: 0.001,
      },
    })).toThrow('Calibration holdout policy is invalid');
  });

  test('reports a registered holdout with no runs as not started, not unregistered', () => {
    const study = definition({ horizonsMinutes: [0] });
    const report = computeVerificationStudyReport({
      definition: study,
      definitionSha256: '5'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs: [],
      observations: [],
      asOf: new Date(study.startsAt),
      calibrationEvaluationPolicy: {
        artifactId: 'c'.repeat(24),
        artifactSha256: 'd'.repeat(64),
        maximumHoldoutBrierDegradation: 0,
        minimumAggregateHoldoutBrierImprovement: 0.001,
      },
    });
    expect(report.precisionPromotionGateFailures)
      .toContain('independent_calibration_holdout_has_no_provisional_runs');
    expect(report.precisionPromotionGateFailures)
      .not.toContain('independent_calibration_holdout_not_registered');
  });

  test('uses one nearest observation per run and horizon with prospective time boundaries', () => {
    const run: StudyVerificationRun = {
      runId: 'run-1',
      targetId: 'KHSV',
      scheduledAt: '2026-07-11T00:00:00.000Z',
      issuedAt: '2026-07-11T00:02:00.000Z',
      response: nowcast('2026-07-11T00:00:00.000Z'),
    };
    const report = computeVerificationStudyReport({
      definition: definition(),
      definitionSha256: 'd'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs: [run],
      observations: [
        { id: 'before-issuance', targetId: 'KHSV', observedAt: '2026-07-11T00:01:00.000Z', rainObserved: false },
        { id: 'earlier-tie', targetId: 'KHSV', observedAt: '2026-07-11T00:06:00.000Z', rainObserved: true },
        { id: 'later-tie', targetId: 'KHSV', observedAt: '2026-07-11T00:09:00.000Z', rainObserved: false },
        { id: 'second-horizon', targetId: 'KHSV', observedAt: '2026-07-11T00:22:00.000Z', rainObserved: false },
      ],
      asOf: new Date('2026-07-11T00:30:00.000Z'),
    });
    expect(report.eligibleForPublication).toBe(false);
    expect(report.gateFailures).toContain('study_in_progress');
    expect(report.horizons.map((horizon) => ({
      horizon: horizon.horizonMinutes,
      count: horizon.observationCount,
      brier: horizon.brierScore,
    }))).toEqual([
      { horizon: 0, count: 1, brier: 0.04 },
      { horizon: 15, count: 1, brier: 0.04 },
    ]);
    expect(report.horizons[0]!.reliabilityBins[8]!.count).toBe(1);
  });

  test('opens publication only after the fixed completeness and sample gates pass', () => {
    const study = definition({ horizonsMinutes: [0] });
    const runs = Array.from({ length: 7 * 24 * 4 }, (_, index): StudyVerificationRun => {
      const scheduledAt = Date.parse(study.startsAt) + index * 15 * 60_000;
      return {
        runId: `run-${index}`,
        targetId: 'KHSV',
        scheduledAt: new Date(scheduledAt).toISOString(),
        issuedAt: new Date(scheduledAt + 60_000).toISOString(),
        response: nowcast(new Date(scheduledAt).toISOString(), [40]),
      };
    });
    const observations = runs.map((run, index) => ({
      id: `observation-${index}`,
      targetId: 'KHSV',
      observedAt: new Date(Date.parse(run.scheduledAt) + 7 * 60_000).toISOString(),
      rainObserved: index % 2 === 0,
    }));
    const report = computeVerificationStudyReport({
      definition: study,
      definitionSha256: 'e'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs,
      observations,
      asOf: new Date(study.endsAt),
    });
    expect(report).toEqual(expect.objectContaining({
      expectedRunCount: 672,
      issuedIssueCount: 672,
      issuedRunCount: 672,
      issuanceCompleteness: 1,
      eligibleForPublication: true,
      gateFailures: [],
      eligibleForPrecisionPromotion: false,
    }));
    expect(report.horizons[0]).toEqual(expect.objectContaining({
      observationCount: 672,
      observedRainRate: 0.5,
      brierScore: 0.26,
    }));
  });

  test('does not score or credit an incomplete cohort issue', () => {
    const study = definition({ stationIds: ['KHSV', 'KJFK'], horizonsMinutes: [0] });
    const report = computeVerificationStudyReport({
      definition: study,
      definitionSha256: 'f'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV', 'KJFK'],
      runs: [{
        runId: 'partial-run',
        targetId: 'KHSV',
        scheduledAt: study.startsAt,
        issuedAt: '2026-07-11T00:01:00.000Z',
        response: nowcast(study.startsAt),
      }],
      observations: [{
        id: 'would-have-scored',
        targetId: 'KHSV',
        observedAt: '2026-07-11T00:07:00.000Z',
        rainObserved: true,
      }],
      asOf: new Date('2026-07-11T00:15:00.000Z'),
    });
    expect(report).toEqual(expect.objectContaining({
      archivedRunCount: 1,
      issuedIssueCount: 0,
      issuedRunCount: 0,
      partialIssueCount: 1,
      issuanceCompleteness: 0,
    }));
    expect(report.horizons[0]!.observationCount).toBe(0);
  });

  test('does not count the currently open cadence slot', () => {
    const study = definition({ horizonsMinutes: [0] });
    const report = computeVerificationStudyReport({
      definition: study,
      definitionSha256: '0'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs: [{
        runId: 'open-slot-run',
        targetId: 'KHSV',
        scheduledAt: study.startsAt,
        issuedAt: '2026-07-11T00:01:00.000Z',
        response: nowcast(study.startsAt),
      }],
      observations: [],
      asOf: new Date('2026-07-11T00:07:00.000Z'),
    });
    expect(report).toEqual(expect.objectContaining({
      evaluationEndsAt: study.startsAt,
      expectedIssueCount: 0,
      archivedRunCount: 0,
      issuedIssueCount: 0,
      issuanceCompleteness: null,
    }));
  });

  test('scores truth after a late issuance and ignores an already expired interval', () => {
    const study = definition({ horizonsMinutes: [0] });
    const baseInput = {
      definition: study,
      definitionSha256: '1'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      observations: [
        {
          id: 'excluded-before-late-issuance',
          targetId: 'KHSV',
          observedAt: '2026-07-11T00:08:00.000Z',
          rainObserved: false,
        },
        {
          id: 'after-late-issuance',
          targetId: 'KHSV',
          observedAt: '2026-07-11T00:12:00.000Z',
          rainObserved: true,
        },
      ],
      asOf: new Date('2026-07-11T00:30:00.000Z'),
    };
    const scorable = computeVerificationStudyReport({
      ...baseInput,
      runs: [{
        runId: 'late-but-scorable',
        targetId: 'KHSV',
        scheduledAt: study.startsAt,
        issuedAt: '2026-07-11T00:10:00.000Z',
        response: nowcast(study.startsAt),
      }],
    });
    expect(scorable.horizons[0]).toEqual(expect.objectContaining({
      forecastCount: 1,
      observationCount: 1,
    }));
    const expired = computeVerificationStudyReport({
      ...baseInput,
      runs: [{
        runId: 'expired-before-issuance',
        targetId: 'KHSV',
        scheduledAt: study.startsAt,
        issuedAt: '2026-07-11T00:16:00.000Z',
        response: nowcast(study.startsAt),
      }],
    });
    expect(expired.horizons[0]).toEqual(expect.objectContaining({
      forecastCount: 0,
      observationCount: 0,
      missingObservationCount: 0,
    }));
  });

  test('permanently blocks publication when report rules were not preregistered', () => {
    const study = definition({ horizonsMinutes: [0] });
    const report = computeVerificationStudyReport({
      definition: study,
      definitionSha256: '2'.repeat(64),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targetIds: ['KHSV'],
      runs: [],
      observations: [],
      asOf: new Date(study.endsAt),
      reportPolicyPreregistered: false,
    });
    expect(report.reportPolicyPreregistered).toBe(false);
    expect(report.gateFailures).toContain('report_policy_not_preregistered');
    expect(report.eligibleForPublication).toBe(false);
  });
});
