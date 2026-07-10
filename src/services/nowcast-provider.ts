import { buildNowcast } from '@/domain/nowcast';
import { postJson } from '@/services/http';
import { parseNowcastResponse } from '@/services/nowcast-contract';
import { fetchOpenMeteoForecast } from '@/services/open-meteo';
import type { Coordinates, Nowcast } from '@/types/weather';

export async function fetchNowcast(location: Coordinates, signal?: AbortSignal): Promise<Nowcast> {
  const backend = process.env.EXPO_PUBLIC_NOWCAST_API_URL;
  if (backend) {
    const raw = await postJson(`${backend.replace(/\/$/, '')}/v1/nowcast`, {
      latitude: Number(location.latitude.toFixed(5)),
      longitude: Number(location.longitude.toFixed(5)),
    }, signal);
    return parseNowcastResponse(raw);
  }

  const forecast = await fetchOpenMeteoForecast(location, signal);
  return buildNowcast(forecast);
}
