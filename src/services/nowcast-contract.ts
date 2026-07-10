import type { Nowcast } from '@/types/weather';
import { z } from 'zod';

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

const nowcastSchema: z.ZodType<Nowcast> = z.object({
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
});

export function parseNowcastResponse(value: unknown): Nowcast {
  const parsed = nowcastSchema.safeParse(value);
  if (!parsed.success) throw new Error('Nowcast service returned an unsupported response.');
  return parsed.data;
}
