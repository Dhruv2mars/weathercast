import { describe, expect, test } from 'bun:test';

import { archiveMetarBatch, AviationWeatherMetarAdapter, metarReportsRain, parseMetarBytes, parseMetarObservations, validateMetarUserAgent } from './aviation-weather';
import { ForecastArchive } from './archive';

const base = {
  icaoId: 'VIDP',
  receiptTime: '2026-07-10T15:02:36.706Z',
  obsTime: 1_783_695_600,
  reportTime: '2026-07-10T15:00:00.000Z',
  rawOb: 'METAR VIDP 101500Z 25010KT 4500 -RA SCT030 30/24 Q1000',
  lat: 28.567,
  lon: 77.117,
};

describe('AviationWeather METAR adapter', () => {
  test('recognizes rain and drizzle but not vicinity showers or haze', () => {
    expect(metarReportsRain('-RA')).toBe(true);
    expect(metarReportsRain('+TSRA BR')).toBe(true);
    expect(metarReportsRain('FZDZ')).toBe(true);
    expect(metarReportsRain('VCSH HZ')).toBe(false);
    expect(metarReportsRain('HZ')).toBe(false);
  });

  test('normalizes coarse station truth without claiming onset precision', () => {
    const [observation] = parseMetarObservations([{ ...base, wxString: '-RA', precip: 0.01 }]);
    expect(observation.rainObserved).toBe(true);
    expect(observation.accumulationMm).toBeCloseTo(0.254, 8);
    expect(observation.truthResolutionSeconds).toBe(3_600);
    expect(observation.onsetPublishable).toBe(false);
    expect(observation.quality).toBe('verified');
  });

  test('rejects malformed station coordinates and timestamps', () => {
    expect(() => parseMetarObservations([{ ...base, lat: 100 }])).toThrow();
    expect(() => parseMetarObservations([{ ...base, obsTime: -1 }])).toThrow();
  });

  test('parses archived bytes and treats an official 204 payload as no observations', () => {
    const bytes = new TextEncoder().encode(JSON.stringify([{ ...base, wxString: 'HZ' }]));
    expect(parseMetarBytes(bytes)).toHaveLength(1);
    expect(parseMetarBytes(new Uint8Array())).toEqual([]);
    expect(() => parseMetarBytes(new TextEncoder().encode('{broken'))).toThrow();
  });

  test('archives raw bytes before parsing so malformed upstream data remains diagnosable', () => {
    const archive = new ForecastArchive(':memory:');
    expect(() => archiveMetarBatch(archive, {
      stationIds: ['VIDP'],
      retrievedAt: '2026-07-10T15:00:00.000Z',
      raw: new TextEncoder().encode('{broken'),
    })).toThrow();
    expect(archive.countSourceAssets()).toBe(1);
    expect(archive.listObservationPoints()).toEqual([]);
    archive.close();
  });

  test('requires a monitored production contact in the official API User-Agent', () => {
    expect(validateMetarUserAgent('Weathercast/1.0 contact=ops@weathercast.app', true)).toContain('Weathercast');
    expect(() => validateMetarUserAgent('Weathercast-Development/1.0 contact=dev@weathercast.invalid', true)).toThrow();
    expect(() => validateMetarUserAgent('Weathercast/1.0', true)).toThrow();
  });

  test('rejects invalid station identifiers before making a network request', async () => {
    const adapter = new AviationWeatherMetarAdapter('Weathercast/1.0 contact=ops@weathercast.app');
    await expect(adapter.fetchRaw(['../../'], new AbortController().signal)).rejects.toThrow('four-character ICAO');
  });
});
