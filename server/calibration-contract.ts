import { z } from 'zod';

const registeredId = z.string().regex(/^[a-z0-9][a-z0-9-]{5,63}$/);

export const CALIBRATION_POLICY = {
  minimumSamplesPerHorizon: 100,
  maximumValidationBrierDegradation: 0,
  minimumAggregateValidationBrierImprovement: 0.001,
  maximumHoldoutBrierDegradation: 0,
  minimumAggregateHoldoutBrierImprovement: 0.001,
} as const;

export const calibrationPlanSchema = z.object({
  id: registeredId,
  title: z.string().min(10).max(160),
  algorithmVersion: z.literal('translation-ensemble-v1'),
  domain: z.literal('CONUS'),
  product: z.literal('PrecipRate_00.00'),
  method: z.literal('isotonic-pav-v1'),
  trainingStudyIds: z.array(registeredId).min(1).max(20),
  validationStudyIds: z.array(registeredId).min(1).max(20),
  evaluationStudyId: registeredId,
  horizonsMinutes: z.array(z.number().int().min(0).max(105).multipleOf(15)).min(1).max(8),
  minimumSamplesPerHorizon: z.literal(CALIBRATION_POLICY.minimumSamplesPerHorizon),
  maximumValidationBrierDegradation: z.literal(CALIBRATION_POLICY.maximumValidationBrierDegradation),
  minimumAggregateValidationBrierImprovement:
    z.literal(CALIBRATION_POLICY.minimumAggregateValidationBrierImprovement),
  maximumHoldoutBrierDegradation: z.literal(CALIBRATION_POLICY.maximumHoldoutBrierDegradation),
  minimumAggregateHoldoutBrierImprovement:
    z.literal(CALIBRATION_POLICY.minimumAggregateHoldoutBrierImprovement),
}).superRefine((value, context) => {
  const training = new Set(value.trainingStudyIds);
  const validation = new Set(value.validationStudyIds);
  if (
    training.size !== value.trainingStudyIds.length
    || validation.size !== value.validationStudyIds.length
    || value.trainingStudyIds.some((id) => validation.has(id))
    || training.has(value.evaluationStudyId)
    || validation.has(value.evaluationStudyId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['trainingStudyIds'],
      message: 'Calibration training, validation, and evaluation partitions must be disjoint.',
    });
  }
  if (
    new Set(value.horizonsMinutes).size !== value.horizonsMinutes.length
    || !value.horizonsMinutes.every((horizon, index) => (
      index === 0 || horizon > value.horizonsMinutes[index - 1]!
    ))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['horizonsMinutes'],
      message: 'Calibration horizons must be unique and sorted.',
    });
  }
});

export type CalibrationPlan = z.infer<typeof calibrationPlanSchema>;
