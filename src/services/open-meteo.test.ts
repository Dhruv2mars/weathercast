import { describe, expect, mock, test } from 'bun:test';

const SLOT_SECONDS = 15 * 60;

function horizonPayload(
  now: Date,
  options?: {
    farPastNullSlots?: number;
    farFutureNullSlots?: number;
    incompleteHorizon?: boolean;
    mismatchRain?: boolean;
  },
) {
  const farPastNullSlots = options?.farPastNullSlots ?? 8;
  const farFutureNullSlots = options?.farFutureNullSlots ?? 8;
  const nowSec = Math.floor(now.getTime() / 1000);
  const alignedNow = Math.floor(nowSec / SLOT_SECONDS) * SLOT_SECONDS;
  // Complete window large enough for any selection start in [now-15m, now].
  const completeStart = alignedNow - 2 * SLOT_SECONDS;
  const completeSlots = 12;
  const start = completeStart - farPastNullSlots * SLOT_SECONDS;
  const total = farPastNullSlots + completeSlots + farFutureNullSlots;
  const times = Array.from({ length: total }, (_, index) => start + index * SLOT_SECONDS);
  const values = Array.from({ length: total }, (_, index) => {
    const time = times[index]!;
    const inCompleteWindow = time >= completeStart && time < completeStart + completeSlots * SLOT_SECONDS;
    if (!inCompleteWindow) return null;
    if (options?.incompleteHorizon && time === alignedNow) return null;
    return 0;
  });
  const weatherCodes = values.map((value) => (value === null ? null : 1));
  const rain = options?.mismatchRain ? values.slice(0, total - 1) : values;

  return {
    timezone: 'Asia/Kolkata',
    minutely_15: {
      time: times,
      precipitation: values,
      rain,
      showers: values,
      weather_code: weatherCodes,
    },
    hourly: {
      time: [alignedNow - 3600, alignedNow, alignedNow + 3600, alignedNow + 7200, alignedNow + 10_800],
      precipitation_probability: [5, 10, 20, 30, null],
    },
  };
}

const getJson = mock((): Promise<unknown> => Promise.resolve(horizonPayload(new Date())));

mock.module('@/services/http', () => ({ getJson }));

const { fetchOpenMeteoForecast } = await import('@/services/open-meteo');

describe('fetchOpenMeteoForecast', () => {
  test('selects the next 8 intervals relative to now', async () => {
    const now = new Date();
    getJson.mockImplementationOnce(() => Promise.resolve(horizonPayload(now, { farPastNullSlots: 10, farFutureNullSlots: 10 })));
    const forecast = await fetchOpenMeteoForecast({ latitude: 28.6139, longitude: 77.209 }, undefined, now);

    expect(forecast.intervals).toHaveLength(8);
    const first = new Date(forecast.intervals[0]!.time).getTime();
    expect(first).toBeGreaterThanOrEqual(now.getTime() - SLOT_SECONDS * 1000);
    expect(first).toBeLessThanOrEqual(now.getTime() + SLOT_SECONDS * 2 * 1000);
    expect(forecast.intervals[0]).toMatchObject({ precipitationMm: 0, rainMm: 0, showersMm: 0, weatherCode: 1 });
  });

  test('rejects incomplete measurements inside the required horizon', async () => {
    const now = new Date();
    getJson.mockImplementationOnce(() => Promise.resolve(horizonPayload(now, { incompleteHorizon: true })));

    await expect(fetchOpenMeteoForecast({ latitude: 28.6139, longitude: 77.209 }, undefined, now)).rejects.toThrow('unsupported response');
  });

  test('ignores nulls outside the required horizon window', async () => {
    const now = new Date();
    getJson.mockImplementationOnce(() => Promise.resolve(horizonPayload(now, { farPastNullSlots: 12, farFutureNullSlots: 12 })));

    const forecast = await fetchOpenMeteoForecast({ latitude: 28.6139, longitude: 77.209 }, undefined, now);
    expect(forecast.intervals).toHaveLength(8);
    expect(forecast.intervals.every((interval) => interval.precipitationMm === 0)).toBe(true);
  });

  test('rejects mismatched upstream arrays', async () => {
    const now = new Date();
    getJson.mockImplementationOnce(() => Promise.resolve(horizonPayload(now, { mismatchRain: true })));

    await expect(fetchOpenMeteoForecast({ latitude: 28.6139, longitude: 77.209 }, undefined, now)).rejects.toThrow('unsupported response');
  });
});
