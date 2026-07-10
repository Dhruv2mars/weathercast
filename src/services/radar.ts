import { z } from 'zod';

import { getJson } from '@/services/http';
import type { RadarManifest } from '@/types/weather';

const schema = z.object({
  generated: z.number(),
  host: z.string().url(),
  frames: z.array(z.object({ time: z.number(), path: z.string() })),
});

export async function fetchRadarManifest(signal?: AbortSignal): Promise<RadarManifest | null> {
  const endpoint = process.env.EXPO_PUBLIC_RADAR_MANIFEST_URL;
  if (!endpoint) return null;
  const parsed = schema.safeParse(await getJson(endpoint, signal));
  if (!parsed.success) throw new Error('Radar service returned an unsupported response.');
  return parsed.data;
}
