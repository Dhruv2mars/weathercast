import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { CALIBRATION_POLICY, calibrationPlanSchema } from './calibration-contract';
import { studyDefinitionSchema } from './study-contract';

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conus-rain-calibration-2026',
    title: 'CONUS rain occurrence isotonic calibration plan',
    algorithmVersion: 'translation-ensemble-v1' as const,
    domain: 'CONUS' as const,
    product: 'PrecipRate_00.00' as const,
    method: 'isotonic-pav-v1' as const,
    trainingStudyIds: ['training-study-2026'],
    validationStudyIds: ['validation-study-2026'],
    evaluationStudyId: 'evaluation-study-2026',
    horizonsMinutes: [0, 15, 30, 45, 60, 75, 90, 105],
    minimumSamplesPerHorizon: CALIBRATION_POLICY.minimumSamplesPerHorizon,
    maximumValidationBrierDegradation: CALIBRATION_POLICY.maximumValidationBrierDegradation,
    minimumAggregateValidationBrierImprovement:
      CALIBRATION_POLICY.minimumAggregateValidationBrierImprovement,
    maximumHoldoutBrierDegradation: CALIBRATION_POLICY.maximumHoldoutBrierDegradation,
    minimumAggregateHoldoutBrierImprovement:
      CALIBRATION_POLICY.minimumAggregateHoldoutBrierImprovement,
    ...overrides,
  };
}

describe('calibration plan contract', () => {
  test('freezes disjoint training, validation, and evaluation partitions', () => {
    expect(calibrationPlanSchema.parse(plan())).toEqual(plan());
    expect(() => calibrationPlanSchema.parse(plan({
      validationStudyIds: ['training-study-2026'],
    }))).toThrow('partitions must be disjoint');
    expect(() => calibrationPlanSchema.parse(plan({
      evaluationStudyId: 'validation-study-2026',
    }))).toThrow('partitions must be disjoint');
  });

  test('rejects reordered horizons and weakened validation gates', () => {
    expect(() => calibrationPlanSchema.parse(plan({ horizonsMinutes: [15, 0] })))
      .toThrow('sorted');
    expect(() => calibrationPlanSchema.parse(plan({ maximumValidationBrierDegradation: 0.01 })))
      .toThrow();
    expect(() => calibrationPlanSchema.parse(plan({ minimumSamplesPerHorizon: 10 })))
      .toThrow();
  });

  test('ships a complete chronological three-part calibration example', async () => {
    const fixture = (name: string) => Bun.file(join(import.meta.dir, 'fixtures', name)).json();
    const training = studyDefinitionSchema.parse(
      await fixture('study.calibration-training.example.json'),
    );
    const validation = studyDefinitionSchema.parse(
      await fixture('study.calibration-validation.example.json'),
    );
    const evaluation = studyDefinitionSchema.parse(await fixture('study.example.json'));
    const examplePlan = calibrationPlanSchema.parse(await fixture('calibration.example.json'));
    expect(examplePlan.trainingStudyIds).toEqual([training.id]);
    expect(examplePlan.validationStudyIds).toEqual([validation.id]);
    expect(examplePlan.evaluationStudyId).toBe(evaluation.id);
    expect(Date.parse(training.endsAt)).toBeLessThanOrEqual(Date.parse(validation.startsAt));
    expect(Date.parse(validation.endsAt)).toBeLessThanOrEqual(Date.parse(evaluation.startsAt));
  });
});
