import { describe, expect, mock, test } from 'bun:test';

const getJson = mock((): Promise<unknown> => Promise.resolve({
  timezone: 'Asia/Kolkata',
  minutely_15: {
    time: Array.from({ length: 8 }, (_, index) => 1_720_598_400 + index * 900),
    precipitation: [null, 0, 0, 0, 0, 0, 0, 0],
    rain: [null, 0, 0, 0, 0, 0, 0, 0],
    showers: [null, 0, 0, 0, 0, 0, 0, 0],
    weather_code: [null, 1, 1, 1, 1, 1, 1, 1],
  },
  hourly: {
    time: [1_720_598_400],
    precipitation_probability: [null],
  },
}));

mock.module('@/services/http', () => ({ getJson }));

const { fetchOpenMeteoForecast } = await import('@/services/open-meteo');

describe('fetchOpenMeteoForecast', () => {
  test('accepts complete bounded measurements', async () => {
    getJson.mockImplementationOnce(() => Promise.resolve({
      timezone: 'Asia/Kolkata',
      minutely_15: {
        time: Array.from({ length: 8 }, (_, index) => 1_720_598_400 + index * 900),
        precipitation: [0, 0, 0, 0, 0, 0, 0, 0],
        rain: [0, 0, 0, 0, 0, 0, 0, 0],
        showers: [0, 0, 0, 0, 0, 0, 0, 0],
        weather_code: [0, 1, 1, 1, 1, 1, 1, 1],
      },
      hourly: { time: [1_720_598_400], precipitation_probability: [0] },
    }));
    const forecast = await fetchOpenMeteoForecast({ latitude: 28.6139, longitude: 77.209 });

    expect(forecast.intervals).toHaveLength(8);
    expect(forecast.intervals[0]).toMatchObject({ precipitationMm: 0, rainMm: 0, showersMm: 0, probability: 0, weatherCode: 0 });
  });

  test('rejects incomplete nullable measurements instead of reporting dry weather', async () => {
    getJson.mockImplementationOnce(() => Promise.resolve({
      timezone: 'Asia/Kolkata',
      minutely_15: {
        time: Array.from({ length: 8 }, (_, index) => 1_720_598_400 + index * 900),
        precipitation: [null, 0, 0, 0, 0, 0, 0, 0],
        rain: [0, 0, 0, 0, 0, 0, 0, 0],
        showers: [0, 0, 0, 0, 0, 0, 0, 0],
        weather_code: [0, 1, 1, 1, 1, 1, 1, 1],
      },
      hourly: { time: [1_720_598_400], precipitation_probability: [0] },
    }));

    await expect(fetchOpenMeteoForecast({ latitude: 28.6139, longitude: 77.209 })).rejects.toThrow('unsupported response');
  });

  test('rejects mismatched upstream arrays', async () => {
    getJson.mockImplementationOnce(() => Promise.resolve({
      timezone: 'Asia/Kolkata',
      minutely_15: {
        time: Array.from({ length: 8 }, (_, index) => 1_720_598_400 + index * 900),
        precipitation: [0, 0, 0, 0, 0, 0, 0, 0],
        rain: [0, 0, 0, 0, 0, 0, 0],
        showers: [0, 0, 0, 0, 0, 0, 0, 0],
        weather_code: [0, 0, 0, 0, 0, 0, 0, 0],
      },
      hourly: { time: [1_720_598_400], precipitation_probability: [0] },
    }));

    await expect(fetchOpenMeteoForecast({ latitude: 28.6139, longitude: 77.209 })).rejects.toThrow('unsupported response');
  });
});
