import { buildNowcast } from '@/domain/nowcast';
import { nowcastApiUrl } from '@/lib/client-config';
import { postJson } from '@/services/http';
import { parseNowcastResponse } from '@/services/nowcast-contract';
import { fetchOpenMeteoForecast } from '@/services/open-meteo';
import type { Coordinates, Nowcast } from '@/types/weather';

export async function fetchNowcast(location: Coordinates, signal?: AbortSignal): Promise<Nowcast> {
  if (nowcastApiUrl) {
    const raw = await postJson(`${nowcastApiUrl}/v1/nowcast`, {
      latitude: Number(location.latitude.toFixed(5)),
      longitude: Number(location.longitude.toFixed(5)),
    }, signal);
    return parseNowcastResponse(raw);
  }

  const forecast = await fetchOpenMeteoForecast(location, signal);
  const nowcast = buildNowcast(forecast);
  return {
    ...nowcast,
    confidence: {
      score: 0,
      label: 'low',
      explanation: 'This fallback guidance is uncalibrated, so timing is uncertain.',
    },
    calibrationStatus: 'uncalibrated',
    validUntil: new Date(Date.now() + 4 * 60_000).toISOString(),
  };
}
