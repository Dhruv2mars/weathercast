import { z } from 'zod';

const validInterval = z.object({
  leadStartMinutes: z.number().int().min(0).max(105),
  leadEndMinutes: z.number().int().min(15).max(120),
  validAt: z.iso.datetime(),
  status: z.literal('valid'),
  probability: z.number().int().min(0).max(100),
  rainRateMmPerHour: z.number().finite().nonnegative().max(300),
});

const unavailableInterval = z.object({
  leadStartMinutes: z.number().int().min(0).max(105),
  leadEndMinutes: z.number().int().min(15).max(120),
  validAt: z.iso.datetime(),
  status: z.literal('no_coverage'),
  probability: z.null(),
  rainRateMmPerHour: z.null(),
});

export const radarNowcastSchema = z.object({
  schemaVersion: z.literal(1),
  algorithmVersion: z.literal('translation-ensemble-v1'),
  source: z.literal('noaa-mrms-nodd'),
  product: z.literal('PrecipRate_00.00'),
  sourceDataTime: z.iso.datetime(),
  horizonMinutes: z.literal(120),
  calibrationStatus: z.literal('uncalibrated'),
  motion: z.object({
    status: z.enum(['estimated', 'insufficient_echo']),
    rowPixelsPerMinute: z.number().finite().min(-2).max(2),
    columnPixelsPerMinute: z.number().finite().min(-2).max(2),
    spreadPixelsPerMinute: z.number().finite().nonnegative().max(2),
    signal: z.number().finite().min(0).max(1),
  }),
  ensembleMembers: z.number().int().min(12).max(96),
  seed: z.string().regex(/^[a-f0-9]{16}$/),
  intervals: z.array(z.discriminatedUnion('status', [validInterval, unavailableInterval])).length(8),
  location: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }),
  inputSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(3).max(12),
  coverage: z.object({
    tier: z.literal('shadow'),
    minimumTileFraction: z.number().finite().min(0).max(1),
    spatialResolutionKm: z.literal(1),
    reason: z.string().min(1),
  }),
}).superRefine((value, context) => {
  value.intervals.forEach((interval, index) => {
    if (interval.leadStartMinutes !== index * 15 || interval.leadEndMinutes !== (index + 1) * 15) {
      context.addIssue({
        code: 'custom',
        path: ['intervals', index],
        message: 'Radar intervals must cover eight consecutive 15-minute periods.',
      });
    }
    const expectedTime = new Date(
      new Date(value.sourceDataTime).getTime() + (index * 15 + 7.5) * 60_000,
    ).getTime();
    if (new Date(interval.validAt).getTime() !== expectedTime) {
      context.addIssue({
        code: 'custom',
        path: ['intervals', index, 'validAt'],
        message: 'Radar interval validity must use the centre of its 15-minute period.',
      });
    }
  });
});

export type RadarNowcast = z.infer<typeof radarNowcastSchema>;
