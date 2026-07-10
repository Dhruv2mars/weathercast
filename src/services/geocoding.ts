import { z } from 'zod';

import { getJson } from '@/services/http';
import type { Place } from '@/types/weather';

const resultSchema = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  admin1: z.string().optional(),
  country: z.string().optional(),
});
const responseSchema = z.object({ results: z.array(resultSchema).optional() });

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  if (query.trim().length < 2) return [];
  const params = new URLSearchParams({ name: query.trim(), count: '12', language: 'en', format: 'json' });
  const raw = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`, signal);
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Place search returned an unsupported response.');
  return (parsed.data.results ?? []).map((result) => ({
    id: `place-${result.id}`,
    name: result.name,
    latitude: result.latitude,
    longitude: result.longitude,
    admin: result.admin1,
    country: result.country,
    source: 'search',
  }));
}
