import { z } from 'zod';

import type { Nowcast } from '@/types/weather';

const intervalSchema = z.object({
  time: z.iso.datetime(),
  precipitationMm: z.number().nonnegative(),
  rainMm: z.number().nonnegative(),
  showersMm: z.number().nonnegative(),
  probability: z.number().min(0).max(100),
  weatherCode: z.number().int(),
});

const eventSchema = z.object({
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime(),
  onsetWindowStart: z.iso.datetime(),
  onsetWindowEnd: z.iso.datetime(),
  peakIntensity: z.enum(['none', 'trace', 'light', 'moderate', 'heavy', 'extreme']),
  peakMm: z.number().nonnegative(),
  durationMinutes: z.number().int().nonnegative(),
});

const nowcastSchema = z.object({
  issuedAt: z.iso.datetime(),
  status: z.enum(['clear', 'incoming', 'raining']),
  headline: z.string().min(1),
  detail: z.string().min(1),
  clearMinutes: z.number().nonnegative(),
  intervals: z.array(intervalSchema).min(1),
  confidence: z.object({
    score: z.number().min(0).max(100),
    label: z.enum(['low', 'medium', 'high']),
    explanation: z.string().min(1),
  }),
  dataTier: z.enum(['precision', 'enhanced', 'standard']),
  source: z.string().min(1),
  event: eventSchema.nullable(),
  schemaVersion: z.literal(1),
  forecastId: z.string().min(1),
  generatedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  timezone: z.string().min(1),
  sourceDataTime: z.iso.datetime().nullable(),
  calibrationStatus: z.enum(['uncalibrated', 'provisional', 'calibrated']),
  coverage: z.object({
    reason: z.string().min(1),
    spatialResolutionKm: z.number().positive().nullable(),
  }),
}).superRefine((value, context) => {
  if (new Date(value.generatedAt).getTime() > new Date(value.validUntil).getTime()) {
    context.addIssue({ code: 'custom', path: ['validUntil'], message: 'Forecast validity must follow generation.' });
  }
  if (value.intervals.length !== 8) {
    context.addIssue({ code: 'custom', path: ['intervals'], message: 'A v1 nowcast must contain eight intervals.' });
  }
  value.intervals.forEach((interval, index) => {
    if (index === 0) return;
    const previous = new Date(value.intervals[index - 1].time).getTime();
    if (new Date(interval.time).getTime() - previous !== 15 * 60_000) {
      context.addIssue({ code: 'custom', path: ['intervals', index, 'time'], message: 'Intervals must be 15 minutes apart.' });
    }
  });
  if (value.status === 'clear' && value.event !== null) {
    context.addIssue({ code: 'custom', path: ['event'], message: 'A clear nowcast cannot contain a rain event.' });
  }
  if (value.status !== 'clear' && value.event === null) {
    context.addIssue({ code: 'custom', path: ['event'], message: 'An active or incoming nowcast requires a rain event.' });
  }
  if (value.calibrationStatus === 'uncalibrated'
      && (value.confidence.label !== 'low' || value.confidence.score !== 0)) {
    context.addIssue({ code: 'custom', path: ['confidence'], message: 'Uncalibrated guidance must use the zero/Low compatibility value.' });
  }
  if (value.dataTier === 'precision' && value.calibrationStatus !== 'calibrated') {
    context.addIssue({ code: 'custom', path: ['dataTier'], message: 'Precision requires calibrated coverage.' });
  }
});

export function parseNowcastResponse(value: unknown): Nowcast {
  const parsed = nowcastSchema.safeParse(value);
  if (!parsed.success) throw new Error('Nowcast service returned an unsupported response.');
  return parsed.data as Nowcast;
}
