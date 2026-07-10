import { describe, expect, test } from 'bun:test';

import type { RadarNowcast } from './radar-nowcast-contract';
import { studyDefinitionSchema } from './study-contract';
import { computeVerificationStudyReport, type StudyVerificationRun } from './study-verification';

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

function nowcast(sourceDataTime: string, probabilities = [80, 20]) {
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

describe('prospective study report', () => {
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
});
