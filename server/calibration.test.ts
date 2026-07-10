import { describe, expect, test } from 'bun:test';

import type { RadarNowcast } from './radar-nowcast-contract';
import {
  applyCalibrationArtifact,
  fitIsotonicCalibrationArtifact,
  type CalibrationSample,
} from './calibration';

function sample(
  partition: 'training' | 'validation',
  probability: number,
  observedRain: boolean,
  sequence: number,
): CalibrationSample {
  return {
    partition,
    studyId: partition === 'training' ? 'training-study' : 'validation-study',
    runId: `${partition}-${sequence}`,
    targetId: 'KHSV',
    horizonMinutes: 0,
    probability,
    observedRain,
    observedAt: `2026-07-01T00:${String(sequence).padStart(2, '0')}:00.000Z`,
  };
}

function nowcast(probability: number, allIntervalsValid = false): RadarNowcast {
  const sourceDataTime = '2026-07-01T00:00:00.000Z';
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
    intervals: Array.from({ length: 8 }, (_, index) => {
      const base = {
        leadStartMinutes: index * 15,
        leadEndMinutes: (index + 1) * 15,
        validAt: new Date(Date.parse(sourceDataTime) + (index * 15 + 7.5) * 60_000).toISOString(),
      };
      return index === 0 || allIntervalsValid
        ? { ...base, status: 'valid' as const, probability, rainRateMmPerHour: 1 }
        : { ...base, status: 'no_coverage' as const, probability: null, rainRateMmPerHour: null };
    }),
    location: { latitude: 34.6441, longitude: -86.7862 },
    inputSha256: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
    coverage: {
      tier: 'shadow',
      minimumTileFraction: 1,
      spatialResolutionKm: 1,
      reason: 'Uncalibrated shadow evaluation.',
    },
  };
}

describe('isotonic rain-probability calibration', () => {
  test('fits monotonic training probabilities and admits only validation-safe artifacts', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, index) => sample('training', 20, index < 1, index)),
      ...Array.from({ length: 10 }, (_, index) => sample('training', 50, index < 4, index + 10)),
      ...Array.from({ length: 10 }, (_, index) => sample('training', 80, index < 7, index + 20)),
      ...Array.from({ length: 10 }, (_, index) => sample('validation', 20, index < 1, index + 30)),
      ...Array.from({ length: 10 }, (_, index) => sample('validation', 50, index < 4, index + 40)),
      ...Array.from({ length: 10 }, (_, index) => sample('validation', 80, index < 7, index + 50)),
    ];
    const artifact = fitIsotonicCalibrationArtifact({
      planId: 'calibration-plan-test',
      planSha256: 'a'.repeat(64),
      artifactVersion: 'isotonic-v1',
      fittedAt: '2026-07-02T00:00:00.000Z',
      algorithmVersion: 'translation-ensemble-v1',
      domain: 'CONUS',
      product: 'PrecipRate_00.00',
      evaluationStudyId: 'evaluation-study',
      evaluationStudySha256: 'b'.repeat(64),
      horizonsMinutes: [0],
      minimumSamplesPerHorizon: 10,
      maximumValidationBrierDegradation: 0,
      minimumAggregateValidationBrierImprovement: 0.01,
      samples,
    });

    expect(artifact.eligibleForShadowApplication).toBe(true);
    expect(artifact.gateFailures).toEqual([]);
    expect(artifact.horizons[0]).toEqual(expect.objectContaining({
      horizonMinutes: 0,
      trainingSampleCount: 30,
      validationSampleCount: 30,
      rawValidationBrierScore: 0.19,
      calibratedValidationBrierScore: 0.18,
    }));
    expect(artifact.horizons[0]!.blocks.map((block) => block.calibratedProbability)).toEqual([10, 40, 70]);

    const calibrated = applyCalibrationArtifact(nowcast(50), artifact);
    expect(calibrated.calibrationStatus).toBe('provisional');
    expect(calibrated.intervals[0]!.probability).toBe(40);
    expect(calibrated.coverage.reason).toBe(
      'Validation-gated calibration active; independent prospective holdout pending.',
    );
    expect(calibrated.calibration).toEqual({
      artifactId: artifact.id,
      artifactSha256: artifact.sha256,
      method: 'isotonic-pav-v1',
      rawProbabilities: [50, null, null, null, null, null, null, null],
    });
  });

  test('refuses partial probability calibration for a valid nowcast', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, index) => sample('training', 50, index < 4, index)),
      ...Array.from({ length: 10 }, (_, index) => sample('validation', 50, index < 4, index + 10)),
    ];
    const artifact = fitIsotonicCalibrationArtifact({
      planId: 'calibration-plan-test',
      planSha256: 'a'.repeat(64),
      artifactVersion: 'isotonic-v1',
      fittedAt: '2026-07-02T00:00:00.000Z',
      algorithmVersion: 'translation-ensemble-v1',
      domain: 'CONUS',
      product: 'PrecipRate_00.00',
      evaluationStudyId: 'evaluation-study',
      evaluationStudySha256: 'b'.repeat(64),
      horizonsMinutes: [0],
      minimumSamplesPerHorizon: 10,
      maximumValidationBrierDegradation: 0,
      minimumAggregateValidationBrierImprovement: 0.01,
      samples,
    });
    expect(() => applyCalibrationArtifact(nowcast(50, true), artifact))
      .toThrow('every valid radar interval');
  });

  test('rejects degraded validation artifacts and checksum tampering', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, index) => sample('training', 20, false, index)),
      ...Array.from({ length: 10 }, (_, index) => sample('validation', 20, true, index + 10)),
    ];
    const artifact = fitIsotonicCalibrationArtifact({
      planId: 'calibration-plan-test',
      planSha256: 'a'.repeat(64),
      artifactVersion: 'rejected-v1',
      fittedAt: '2026-07-02T00:00:00.000Z',
      algorithmVersion: 'translation-ensemble-v1',
      domain: 'CONUS',
      product: 'PrecipRate_00.00',
      evaluationStudyId: 'evaluation-study',
      evaluationStudySha256: 'b'.repeat(64),
      horizonsMinutes: [0],
      minimumSamplesPerHorizon: 10,
      maximumValidationBrierDegradation: 0,
      minimumAggregateValidationBrierImprovement: 0.01,
      samples,
    });
    expect(artifact.eligibleForShadowApplication).toBe(false);
    expect(artifact.gateFailures).toContain('validation_brier_degraded:0');
    expect(() => applyCalibrationArtifact(nowcast(20), artifact))
      .toThrow('did not pass validation gates');
    expect(() => applyCalibrationArtifact(nowcast(50), {
      ...artifact,
      eligibleForShadowApplication: true,
    })).toThrow('checksum is invalid');
  });
});
