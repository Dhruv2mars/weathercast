import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ForecastArchive } from './archive';
import { applyCalibrationArtifact } from './calibration';
import { CALIBRATION_POLICY, calibrationPlanSchema } from './calibration-contract';
import type { RadarNowcast } from './radar-nowcast-contract';
import { createRadarEnsembleSeed } from './radar-nowcast-runner';
import { STUDY_REPORT_POLICY, studyDefinitionSchema } from './study-contract';

const target = { id: 'KHSV', latitude: 34.6441, longitude: -86.7862 };

function study(
  id: string,
  startsAt: string,
  endsAt: string,
  overrides: Record<string, unknown> = {},
) {
  return studyDefinitionSchema.parse({
    id,
    title: `Prospective calibration partition ${id}`,
    startsAt,
    endsAt,
    algorithmVersion: 'translation-ensemble-v1',
    domain: 'CONUS',
    product: 'PrecipRate_00.00',
    inputFrameCount: 3,
    ensembleMembers: 24,
    stationIds: [target.id],
    issueCadenceMinutes: 15,
    horizonsMinutes: [0],
    primaryMetric: 'brier_rain_occurrence_point',
    minimumObservationCountPerHorizon: 100,
    ...STUDY_REPORT_POLICY,
    exclusionPolicy: 'verified prospective observations only; no post-registration cohort changes',
    ...overrides,
  });
}

function plan() {
  return calibrationPlanSchema.parse({
    id: 'conus-calibration-plan-2026',
    title: 'Leakage-safe CONUS rain calibration plan',
    algorithmVersion: 'translation-ensemble-v1',
    domain: 'CONUS',
    product: 'PrecipRate_00.00',
    method: 'isotonic-pav-v1',
    trainingStudyIds: ['training-study-2026'],
    validationStudyIds: ['validation-study-2026'],
    evaluationStudyId: 'evaluation-study-2026',
    horizonsMinutes: [0],
    ...CALIBRATION_POLICY,
  });
}

function registerStudies(archive: ForecastArchive, evaluationInputFrameCount = 3) {
  const registeredAt = '2026-07-10T22:00:00.000Z';
  archive.registerVerificationStudy({
    definition: study('training-study-2026', '2026-07-11T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
    registeredAt,
    targets: [target],
  });
  archive.registerVerificationStudy({
    definition: study('validation-study-2026', '2026-07-18T00:00:00.000Z', '2026-07-25T00:00:00.000Z'),
    registeredAt,
    targets: [target],
  });
  archive.registerVerificationStudy({
    definition: study(
      'evaluation-study-2026',
      '2026-07-26T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
      { inputFrameCount: evaluationInputFrameCount },
    ),
    registeredAt,
    targets: [target],
  });
}

function nowcast(
  sourceDataTime: string,
  probability: number,
  inputSha256: string[],
  onlyFirstValid = false,
): RadarNowcast {
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
    seed: createRadarEnsembleSeed({
      inputSha256,
      latitude: target.latitude,
      longitude: target.longitude,
    }),
    intervals: Array.from({ length: 8 }, (_, index) => {
      const base = {
        leadStartMinutes: index * 15,
        leadEndMinutes: (index + 1) * 15,
        validAt: new Date(Date.parse(sourceDataTime) + (index * 15 + 7.5) * 60_000).toISOString(),
      };
      return !onlyFirstValid || index === 0
        ? { ...base, status: 'valid' as const, probability, rainRateMmPerHour: 1 }
        : { ...base, status: 'no_coverage' as const, probability: null, rainRateMmPerHour: null };
    }),
    location: { latitude: target.latitude, longitude: target.longitude },
    inputSha256,
    coverage: {
      tier: 'shadow',
      minimumTileFraction: 1,
      spatialResolutionKm: 1,
      reason: 'Uncalibrated shadow evaluation.',
    },
  };
}

function issuePartition(
  archive: ForecastArchive,
  studyId: string,
  startsAt: string,
  count = 7 * 24 * 4,
) {
  for (let index = 0; index < count; index += 1) {
    const scheduledTime = Date.parse(startsAt) + index * 15 * 60_000;
    const scheduledAt = new Date(scheduledTime).toISOString();
    const inputs = [-4, -2, 0].map((offset, frameIndex) => {
      const observedAt = new Date(scheduledTime + offset * 60_000).toISOString();
      const asset = archive.saveSourceAsset({
        provider: 'noaa-mrms',
        upstreamKey: `${studyId}:${index}:${frameIndex}`,
        retrievedAt: new Date(scheduledTime + 60_000).toISOString(),
        mediaType: 'application/gzip',
        bytes: new TextEncoder().encode(`${studyId}:${index}:${frameIndex}`),
      });
      return { id: archive.saveRadarFrame({
        domain: 'CONUS',
        product: 'PrecipRate_00.00',
        observedAt,
        retrievedAt: new Date(scheduledTime + 60_000).toISOString(),
        objectKey: `${studyId}:${index}:${frameIndex}`,
        sourceAssetId: asset.id,
      }), sha256: asset.sha256 };
    });
    const inputFrameIds = inputs.map((input) => input.id);
    const inputSha256 = inputs.map((input) => input.sha256);
    archive.saveVerificationStudyRadarBatch({
      studyId,
      scheduledAt,
      issuedAt: new Date(scheduledTime + 60_000).toISOString(),
      runs: [{
        targetId: target.id,
        run: {
          sourceDataTime: scheduledAt,
          latitude: target.latitude,
          longitude: target.longitude,
          domain: 'CONUS',
          product: 'PrecipRate_00.00',
          algorithmVersion: 'translation-ensemble-v1',
          inputFrameIds,
          response: nowcast(scheduledAt, 80, inputSha256),
        },
      }],
    });
    archive.saveObservation({
      source: 'aviation-weather-metar',
      sourceEventId: `${studyId}:${index}`,
      observedAt: new Date(scheduledTime + 7 * 60_000).toISOString(),
      latitude: target.latitude,
      longitude: target.longitude,
      rainObserved: index % 5 < 2,
      quality: 'verified',
      payload: { icaoId: target.id },
    });
  }
}

describe('calibration archive', () => {
  test('immutably registers a chronological plan before any source partition starts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-calibration-plan-'));
    const path = join(directory, 'archive.sqlite');
    try {
      const archive = new ForecastArchive(path);
      registerStudies(archive);
      const first = archive.registerCalibrationPlan({
        definition: plan(),
        registeredAt: '2026-07-10T23:00:00.000Z',
      });
      expect(first.inserted).toBe(true);
      expect(archive.registerCalibrationPlan({
        definition: plan(),
        registeredAt: '2026-07-10T23:30:00.000Z',
      })).toEqual({ ...first, inserted: false });
      expect(archive.getCalibrationPlan(plan().id)).toEqual(expect.objectContaining({
        definition_sha256: first.definitionSha256,
        definition: plan(),
      }));
      expect(() => archive.registerCalibrationPlan({
        definition: calibrationPlanSchema.parse({ ...plan(), id: 'second-conus-calibration-plan' }),
        registeredAt: '2026-07-10T23:30:00.000Z',
      })).toThrow('already claimed by calibration plan');
      archive.close();

      const database = new Database(path);
      expect(() => database.query('DELETE FROM calibration_plans WHERE id = ?').run(plan().id))
        .toThrow('calibration plans are immutable');
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects post-start registration and non-chronological partitions', () => {
    const archive = new ForecastArchive(':memory:');
    registerStudies(archive);
    expect(() => archive.registerCalibrationPlan({
      definition: plan(),
      registeredAt: '2026-07-11T00:00:00.000Z',
    })).toThrow('before the training partition starts');
    const reversed = calibrationPlanSchema.parse({
      ...plan(),
      id: 'reversed-calibration-plan',
      trainingStudyIds: ['validation-study-2026'],
      validationStudyIds: ['training-study-2026'],
    });
    expect(() => archive.registerCalibrationPlan({
      definition: reversed,
      registeredAt: '2026-07-10T23:00:00.000Z',
    })).toThrow('training, validation, then evaluation');
    archive.close();
    const mismatched = new ForecastArchive(':memory:');
    registerStudies(mismatched, 4);
    expect(() => mismatched.registerCalibrationPlan({
      definition: plan(),
      registeredAt: '2026-07-10T23:00:00.000Z',
    })).toThrow('runtime parameters differ across partitions');
    mismatched.close();
  });

  test('fits and archives a validation-gated artifact before evaluation begins', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-calibration-fit-'));
    const path = join(directory, 'archive.sqlite');
    try {
      const archive = new ForecastArchive(path);
      registerStudies(archive);
      archive.registerCalibrationPlan({
        definition: plan(),
        registeredAt: '2026-07-10T23:00:00.000Z',
      });
      issuePartition(archive, 'training-study-2026', '2026-07-11T00:00:00.000Z');
      issuePartition(archive, 'validation-study-2026', '2026-07-18T00:00:00.000Z');

      const fitted = archive.fitCalibrationPlan({
        planId: plan().id,
        artifactVersion: 'isotonic-v1',
        fittedAt: '2026-07-25T01:00:00.000Z',
      });
      expect(fitted.inserted).toBe(true);
      expect(fitted.artifact).toEqual(expect.objectContaining({
        eligibleForShadowApplication: true,
        trainingSampleCount: 672,
        validationSampleCount: 672,
        rawValidationBrierScore: 0.398929,
        calibratedValidationBrierScore: 0.240354,
      }));
      expect(archive.getCalibrationArtifact(fitted.artifact.id)).toEqual(fitted.artifact);
      expect(archive.fitCalibrationPlan({
        planId: plan().id,
        artifactVersion: 'isotonic-v1',
        fittedAt: '2026-07-25T01:00:00.000Z',
      })).toEqual({ ...fitted, inserted: false });
      expect(() => archive.fitCalibrationPlan({
        planId: plan().id,
        artifactVersion: 'late-fit',
        fittedAt: '2026-07-26T00:00:00.000Z',
      })).toThrow('before evaluation starts');
      const binding = archive.activateCalibrationArtifact({
        artifactId: fitted.artifact.id,
        activatedAt: '2026-07-25T02:00:00.000Z',
      });
      expect(binding.inserted).toBe(true);
      expect(archive.activateCalibrationArtifact({
        artifactId: fitted.artifact.id,
        activatedAt: '2026-07-25T03:00:00.000Z',
      })).toEqual({ ...binding, inserted: false });
      expect(archive.getEvaluationCalibrationArtifact('evaluation-study-2026'))
        .toEqual(fitted.artifact);

      const evaluationTime = Date.parse('2026-07-26T00:00:00.000Z');
      const evaluationInputs = [-4, -2, 0].map((offset, index) => {
        const observedAt = new Date(evaluationTime + offset * 60_000).toISOString();
        const asset = archive.saveSourceAsset({
          provider: 'noaa-mrms',
          upstreamKey: `evaluation:${index}`,
          retrievedAt: '2026-07-26T00:01:00.000Z',
          mediaType: 'application/gzip',
          bytes: new TextEncoder().encode(`evaluation:${index}`),
        });
        return { id: archive.saveRadarFrame({
          domain: 'CONUS',
          product: 'PrecipRate_00.00',
          observedAt,
          retrievedAt: '2026-07-26T00:01:00.000Z',
          objectKey: `evaluation:${index}`,
          sourceAssetId: asset.id,
        }), sha256: asset.sha256 };
      });
      const evaluationFrames = evaluationInputs.map((input) => input.id);
      const evaluationSha256 = evaluationInputs.map((input) => input.sha256);
      const rawEvaluationNowcast = nowcast(
        '2026-07-26T00:00:00.000Z',
        80,
        evaluationSha256,
        true,
      );
      const evaluationBatch = (response: RadarNowcast) => ({
        studyId: 'evaluation-study-2026',
        scheduledAt: '2026-07-26T00:00:00.000Z',
        issuedAt: '2026-07-26T00:01:00.000Z',
        runs: [{
          targetId: target.id,
          run: {
            sourceDataTime: '2026-07-26T00:00:00.000Z',
            latitude: target.latitude,
            longitude: target.longitude,
            domain: 'CONUS',
            product: 'PrecipRate_00.00',
            algorithmVersion: 'translation-ensemble-v1',
            inputFrameIds: evaluationFrames,
            response,
          },
        }],
      });
      expect(() => archive.saveVerificationStudyRadarBatch(evaluationBatch(rawEvaluationNowcast)))
        .toThrow('bound calibration artifact');
      const calibratedEvaluationNowcast = applyCalibrationArtifact(rawEvaluationNowcast, fitted.artifact);
      const forgedEvaluationNowcast: RadarNowcast = {
        ...calibratedEvaluationNowcast,
        intervals: calibratedEvaluationNowcast.intervals.map((interval, index) => (
          index === 0 && interval.status === 'valid'
            ? { ...interval, probability: interval.probability + 1 }
            : interval
        )),
      };
      expect(() => archive.saveVerificationStudyRadarBatch(evaluationBatch(forgedEvaluationNowcast)))
        .toThrow('does not match its bound artifact');
      expect(() => archive.saveVerificationStudyRadarBatch(evaluationBatch({
        ...calibratedEvaluationNowcast,
        location: { ...calibratedEvaluationNowcast.location, latitude: 35 },
      }))).toThrow('different location');
      expect(() => archive.saveVerificationStudyRadarBatch(evaluationBatch({
        ...calibratedEvaluationNowcast,
        inputSha256: calibratedEvaluationNowcast.inputSha256.toReversed(),
      }))).toThrow('checksums do not match');
      expect(archive.saveVerificationStudyRadarBatch(
        evaluationBatch(calibratedEvaluationNowcast),
      ).runs[0]!.linked).toBe(true);
      archive.saveObservation({
        source: 'aviation-weather-metar',
        sourceEventId: 'evaluation:truth:0',
        observedAt: '2026-07-26T00:07:00.000Z',
        latitude: target.latitude,
        longitude: target.longitude,
        rainObserved: false,
        quality: 'verified',
        payload: { icaoId: target.id },
      });
      const preliminaryEvaluation = archive.buildVerificationStudyReport(
        'evaluation-study-2026',
        new Date('2026-07-26T00:15:00.000Z'),
      );
      expect(preliminaryEvaluation.calibrationEvidence.status).toBe('provisional_holdout');
      expect(preliminaryEvaluation.precisionPromotionGateFailures)
        .not.toContain('calibration_evaluation_policy_not_preregistered');
      archive.close();

      const database = new Database(path);
      expect(() => database.query('DELETE FROM calibration_artifacts WHERE id = ?').run(fitted.artifact.id))
        .toThrow('calibration artifacts are immutable');
      expect(() => database.query('DELETE FROM calibration_evaluation_bindings WHERE artifact_id = ?')
        .run(fitted.artifact.id)).toThrow('calibration evaluation bindings are immutable');
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
