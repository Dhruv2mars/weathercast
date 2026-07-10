import { z } from 'zod';

export const observationInputSchema = z.object({
  source: z.string().min(1),
  sourceEventId: z.string().min(1),
  observedAt: z.iso.datetime(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  rainObserved: z.boolean(),
  rainRateMmHour: z.number().nonnegative().optional(),
  accumulationMm: z.number().nonnegative().optional(),
  quality: z.enum(['provisional', 'verified', 'rejected']),
  truthResolutionSeconds: z.number().int().positive().optional(),
  onsetPublishable: z.boolean().optional(),
  sourceAssetId: z.string().min(1).optional(),
  payload: z.unknown(),
});

export const observationBatchSchema = z.array(observationInputSchema).min(1);
