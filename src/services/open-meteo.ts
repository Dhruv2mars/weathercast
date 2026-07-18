import { z } from 'zod';

import { getJson } from '@/services/http';
import type { Coordinates, NormalizedForecast } from '@/types/weather';

const REQUIRED_INTERVALS = 8;

const nullableMeasurements = z.array(z.number().nonnegative().nullable()).min(REQUIRED_INTERVALS);
const nullableWeatherCodes = z.array(z.number().int().nullable()).min(REQUIRED_INTERVALS);
const nullableProbabilities = z.array(z.number().min(0).max(100).nullable()).min(1);
const responseSchema = z.object({
  timezone: z.string(),
  minutely_15: z.object({
    time: z.array(z.number()).min(REQUIRED_INTERVALS),
    precipitation: nullableMeasurements,
    rain: nullableMeasurements,
    showers: nullableMeasurements,
    weather_code: nullableWeatherCodes,
  }),
  hourly: z.object({
    time: z.array(z.number()).min(1),
    precipitation_probability: nullableProbabilities,
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

  for (let index = 0; index < REQUIRED_INTERVALS; index += 1) {
    const incomplete = [
      value.minutely_15.precipitation[index],
      value.minutely_15.rain[index],
      value.minutely_15.showers[index],
      value.minutely_15.weather_code[index],
    ].some((measurement) => measurement === null || measurement === undefined);
    if (incomplete) {
      context.addIssue({ code: 'custom', path: ['minutely_15'], message: 'Forecast measurements must be complete for the required horizon.' });
      break;
    }
  }
});

function nearestProbability(time: number, hourlyTimes: number[], probabilities: (number | null)[]) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  hourlyTimes.forEach((hourlyTime, index) => {
    const distance = Math.abs(time - hourlyTime);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  const probability = probabilities[bestIndex];
  if (probability === null || probability === undefined) throw new Error('Weather service returned incomplete measurements.');
  return Math.round(probability);
}

function requiredMeasurement(value: number | null | undefined) {
  if (value === null || value === undefined) throw new Error('Weather service returned incomplete measurements.');
  return value;
}

export async function fetchOpenMeteoForecast(location: Coordinates, signal?: AbortSignal): Promise<NormalizedForecast> {
  const host = process.env.EXPO_PUBLIC_OPEN_METEO_HOST ?? 'https://api.open-meteo.com';
  const params = new URLSearchParams({
    latitude: location.latitude.toFixed(5),
    longitude: location.longitude.toFixed(5),
    minutely_15: 'precipitation,rain,showers,weather_code',
    hourly: 'precipitation_probability',
    forecast_days: '2',
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
    intervals: minuteData.time.slice(0, REQUIRED_INTERVALS).map((time, index) => ({
      time: new Date(time * 1000).toISOString(),
      precipitationMm: requiredMeasurement(minuteData.precipitation[index]),
      rainMm: requiredMeasurement(minuteData.rain[index]),
      showersMm: requiredMeasurement(minuteData.showers[index]),
      probability: nearestProbability(time, hourly.time, hourly.precipitation_probability),
      weatherCode: requiredMeasurement(minuteData.weather_code[index]),
    })),
  };
}
