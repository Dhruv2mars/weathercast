import { buildNowcast } from '@/domain/nowcast';
import { getJson } from '@/services/http';
import { parseNowcastResponse } from '@/services/nowcast-contract';
import { fetchOpenMeteoForecast } from '@/services/open-meteo';
import type { Coordinates, Nowcast } from '@/types/weather';

export async function fetchNowcast(location: Coordinates, signal?: AbortSignal): Promise<Nowcast> {
  const backend = process.env.EXPO_PUBLIC_NOWCAST_API_URL;
  if (backend) {
    const params = new URLSearchParams({
      latitude: location.latitude.toFixed(5),
      longitude: location.longitude.toFixed(5),
    });
    const raw = await getJson(`${backend.replace(/\/$/, '')}/v1/nowcast?${params}`, signal);
    return parseNowcastResponse(raw);
  }

  const forecast = await fetchOpenMeteoForecast(location, signal);
  return buildNowcast(forecast);
}
