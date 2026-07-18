import { z } from 'zod';

import { getJson } from '@/services/http';
import type { Coordinates, NormalizedForecast } from '@/types/weather';

const responseSchema = z.object({
  timezone: z.string(),
  minutely_15: z.object({
    time: z.array(z.number()).min(8),
    precipitation: z.array(z.number().nonnegative()).min(8),
    rain: z.array(z.number().nonnegative()).min(8),
    showers: z.array(z.number().nonnegative()).min(8),
    weather_code: z.array(z.number().int()).min(8),
  }),
  hourly: z.object({
    time: z.array(z.number()).min(1),
    precipitation_probability: z.array(z.number().min(0).max(100)).min(1),
  }),
}).superRefine((value, context) => {
  const minuteLengths = [
    value.minutely_15.time.length,
    value.minutely_15.precipitation.length,
    value.minutely_15.rain.length,
    value.minutely_15.showers.length,
    value.minutely_15.weather_code.length,
  ];
  if (new Set(minuteLengths).size !== 1) {
    context.addIssue({ code: 'custom', path: ['minutely_15'], message: 'Minutely forecast arrays must have equal lengths.' });
  }
  if (value.hourly.time.length !== value.hourly.precipitation_probability.length) {
    context.addIssue({ code: 'custom', path: ['hourly'], message: 'Hourly forecast arrays must have equal lengths.' });
  }
});

function nearestProbability(time: number, hourlyTimes: number[], probabilities: number[]) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  hourlyTimes.forEach((hourlyTime, index) => {
    const distance = Math.abs(time - hourlyTime);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return Math.round(probabilities[bestIndex] ?? 0);
}

export async function fetchOpenMeteoForecast(location: Coordinates, signal?: AbortSignal): Promise<NormalizedForecast> {
  const host = process.env.EXPO_PUBLIC_OPEN_METEO_HOST ?? 'https://api.open-meteo.com';
  const params = new URLSearchParams({
    latitude: location.latitude.toFixed(5),
    longitude: location.longitude.toFixed(5),
    minutely_15: 'precipitation,rain,showers,weather_code',
    hourly: 'precipitation_probability',
    forecast_days: '1',
    timezone: 'auto',
    timeformat: 'unixtime',
  });
  const raw = await getJson(`${host}/v1/forecast?${params}`, signal);
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Weather service returned an unsupported response.');

  const { minutely_15: minuteData, hourly } = parsed.data;
  return {
    issuedAt: new Date().toISOString(),
    timezone: parsed.data.timezone,
    source: 'Open-Meteo numerical guidance',
    intervals: minuteData.time.map((time, index) => ({
      time: new Date(time * 1000).toISOString(),
      precipitationMm: minuteData.precipitation[index] ?? 0,
      rainMm: minuteData.rain[index] ?? 0,
      showersMm: minuteData.showers[index] ?? 0,
      probability: nearestProbability(time, hourly.time, hourly.precipitation_probability),
      weatherCode: minuteData.weather_code[index] ?? 0,
    })),
  };
}
