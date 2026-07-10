import { z } from 'zod';

const coordinate = (minimum: number, maximum: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  z.number().finite().min(minimum).max(maximum),
);

export const coordinatesSchema = z.object({
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
});

const intervalSchema = z.object({
  time: z.iso.datetime(),
  precipitationMm: z.number().nonnegative(),
  rainMm: z.number().nonnegative(),
  showersMm: z.number().nonnegative(),
  probability: z.number().min(0).max(100),
  weatherCode: z.number().int(),
});

export const normalizedUpstreamSchema = z.object({
  issuedAt: z.iso.datetime(),
  timezone: z.string().min(1),
  source: z.string().min(1),
  upstreamRunId: z.string().min(1).optional(),
  dataTier: z.enum(['precision', 'enhanced', 'standard']),
  calibrationStatus: z.enum(['uncalibrated', 'provisional', 'calibrated']),
  spatialResolutionKm: z.number().positive().nullable(),
  coverageReason: z.string().min(1),
  intervals: z.array(intervalSchema).length(8),
}).superRefine((value, context) => {
  value.intervals.forEach((interval, index) => {
    if (index === 0) return;
    const previous = new Date(value.intervals[index - 1].time).getTime();
    const current = new Date(interval.time).getTime();
    if (current - previous !== 15 * 60_000) {
      context.addIssue({
        code: 'custom',
        path: ['intervals', index, 'time'],
        message: 'Intervals must be unique, chronological, and exactly 15 minutes apart.',
      });
    }
  });
});

export type NormalizedUpstream = z.infer<typeof normalizedUpstreamSchema>;
