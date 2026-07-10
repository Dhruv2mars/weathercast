import { z } from 'zod';

const studyId = z.string().regex(/^[a-z0-9][a-z0-9-]{5,63}$/);
const stationId = z.string().regex(/^[A-Z0-9]{4}$/);

export const studyDefinitionSchema = z.object({
  id: studyId,
  title: z.string().min(10).max(160),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  algorithmVersion: z.literal('translation-ensemble-v1'),
  domain: z.literal('CONUS'),
  product: z.literal('PrecipRate_00.00'),
  stationIds: z.array(stationId).min(1).max(20),
  issueCadenceMinutes: z.literal(15),
  horizonsMinutes: z.array(z.number().int().min(0).max(105).multipleOf(15)).min(1).max(8),
  primaryMetric: z.literal('brier_rain_occurrence_point'),
  minimumObservationCountPerHorizon: z.number().int().min(100).max(10_000_000),
  exclusionPolicy: z.literal('verified prospective observations only; no post-registration cohort changes'),
}).superRefine((value, context) => {
  const starts = new Date(value.startsAt).getTime();
  const ends = new Date(value.endsAt).getTime();
  const durationDays = (ends - starts) / 86_400_000;
  if (durationDays < 7 || durationDays > 366) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Study duration must be from 7 through 366 days.',
    });
  }
  if (starts % (15 * 60_000) !== 0 || ends % (15 * 60_000) !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['startsAt'],
      message: 'Study boundaries must align to the 15-minute issuance cadence.',
    });
  }
  if (new Set(value.stationIds).size !== value.stationIds.length) {
    context.addIssue({ code: 'custom', path: ['stationIds'], message: 'Station IDs must be unique.' });
  }
  if (new Set(value.horizonsMinutes).size !== value.horizonsMinutes.length) {
    context.addIssue({ code: 'custom', path: ['horizonsMinutes'], message: 'Horizons must be unique.' });
  }
  if (!value.horizonsMinutes.every((horizon, index) => index === 0 || horizon > value.horizonsMinutes[index - 1])) {
    context.addIssue({ code: 'custom', path: ['horizonsMinutes'], message: 'Horizons must be sorted.' });
  }
  const hourlyCapacityPerHorizon = Math.floor(durationDays * 24) * value.stationIds.length;
  if (value.minimumObservationCountPerHorizon > hourlyCapacityPerHorizon) {
    context.addIssue({
      code: 'custom',
      path: ['minimumObservationCountPerHorizon'],
      message: 'The sample gate exceeds the cohort’s nominal hourly observation capacity.',
    });
  }
});

export type StudyDefinition = z.infer<typeof studyDefinitionSchema>;

export type StudyTarget = {
  id: string;
  latitude: number;
  longitude: number;
};
