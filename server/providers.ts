import type { Coordinates, NormalizedForecast } from '@/types/weather';
import { z } from 'zod';

import { normalizedUpstreamSchema } from './contracts';

const numberArray = z.array(z.number().nullable()).transform((values) => values.map((value) => value ?? 0));
const openMeteoSchema = z.object({
  timezone: z.string(),
  minutely_15: z.object({
    time: z.array(z.number()),
    precipitation: numberArray,
    rain: numberArray,
    showers: numberArray,
    weather_code: numberArray,
  }),
  hourly: z.object({
    time: z.array(z.number()),
    precipitation_probability: numberArray,
  }),
});

export type ProviderResult = {
  forecast: NormalizedForecast;
  provider: string;
  upstreamRunId?: string;
  dataTier: 'precision' | 'enhanced' | 'standard';
  calibrationStatus: 'uncalibrated' | 'provisional' | 'calibrated';
  spatialResolutionKm: number | null;
  coverageReason: string;
};

export interface ForecastProvider {
  checkHealth(signal: AbortSignal): Promise<boolean>;
  fetch(location: Coordinates, signal: AbortSignal): Promise<ProviderResult>;
}

function nearestProbability(time: number, times: number[], probabilities: number[]) {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  times.forEach((candidate, index) => {
    const nextDistance = Math.abs(candidate - time);
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  });
  return Math.round(probabilities[nearest] ?? 0);
}

async function getJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Upstream returned ${response.status}.`);
  return response.json();
}

export class OpenMeteoEvaluationProvider implements ForecastProvider {
  constructor(private readonly host: string) {}

  async checkHealth(): Promise<boolean> {
    return true;
  }

  async fetch(location: Coordinates, signal: AbortSignal): Promise<ProviderResult> {
    const params = new URLSearchParams({
      latitude: location.latitude.toFixed(5),
      longitude: location.longitude.toFixed(5),
      minutely_15: 'precipitation,rain,showers,weather_code',
      hourly: 'precipitation_probability',
      forecast_days: '1',
      timezone: 'auto',
      timeformat: 'unixtime',
    });
    const parsed = openMeteoSchema.parse(await getJson(`${this.host.replace(/\/$/, '')}/v1/forecast?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Weathercast-Evaluation/1.0' },
      signal,
    }));
    const issuedAt = new Date().toISOString();
    return {
      provider: 'open-meteo-evaluation',
      dataTier: 'standard',
      calibrationStatus: 'uncalibrated',
      spatialResolutionKm: null,
      coverageReason: 'Numerical guidance only; licensed radar and local observations are not configured.',
      forecast: {
        issuedAt,
        timezone: parsed.timezone,
        source: 'Open-Meteo numerical guidance (evaluation)',
        intervals: parsed.minutely_15.time.map((time, index) => ({
          time: new Date(time * 1000).toISOString(),
          precipitationMm: parsed.minutely_15.precipitation[index] ?? 0,
          rainMm: parsed.minutely_15.rain[index] ?? 0,
          showersMm: parsed.minutely_15.showers[index] ?? 0,
          probability: nearestProbability(time, parsed.hourly.time, parsed.hourly.precipitation_probability),
          weatherCode: parsed.minutely_15.weather_code[index] ?? 0,
        })),
      },
    };
  }
}

export class NormalizedHttpProvider implements ForecastProvider {
  constructor(
    private readonly url: string,
    private readonly healthUrl: string,
    private readonly token: string,
  ) {}

  async checkHealth(signal: AbortSignal): Promise<boolean> {
    const response = await fetch(this.healthUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
        'Cache-Control': 'no-store',
      },
      redirect: 'error',
      signal,
    });
    return response.ok;
  }

  async fetch(location: Coordinates, signal: AbortSignal): Promise<ProviderResult> {
    const params = new URLSearchParams({
      latitude: location.latitude.toFixed(5),
      longitude: location.longitude.toFixed(5),
      horizonMinutes: '120',
    });
    const raw = await getJson(`${this.url.replace(/\/$/, '')}?${params}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}` },
      signal,
    });
    const parsed = normalizedUpstreamSchema.parse(raw);
    return {
      provider: 'normalized-upstream',
      upstreamRunId: parsed.upstreamRunId,
      dataTier: parsed.dataTier,
      calibrationStatus: parsed.calibrationStatus,
      spatialResolutionKm: parsed.spatialResolutionKm,
      coverageReason: parsed.coverageReason,
      forecast: {
        issuedAt: parsed.issuedAt,
        timezone: parsed.timezone,
        source: parsed.source,
        intervals: parsed.intervals,
      },
    };
  }
}
