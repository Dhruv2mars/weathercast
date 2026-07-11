import { describe, expect, test } from 'bun:test';

import { loadConfig } from './config';

describe('loadConfig', () => {
  test('allows the evaluation provider only outside production', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).NOWCAST_PROVIDER_MODE).toBe('open-meteo-evaluation');
    expect(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://weathercast.app' }))
      .toThrow('Production cannot use');
  });

  test('requires licensed upstream credentials and an explicit production origin', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      NOWCAST_PROVIDER_MODE: 'normalized-upstream',
      NORMALIZED_UPSTREAM_URL: 'https://weather.example/v1/point',
      NORMALIZED_UPSTREAM_TOKEN: '1234567890123456',
    })).toThrow('explicit CORS_ORIGIN');

    const production = loadConfig({
      NODE_ENV: 'production',
      NOWCAST_PROVIDER_MODE: 'normalized-upstream',
      NORMALIZED_UPSTREAM_URL: 'https://weather.example/v1/point',
      NORMALIZED_UPSTREAM_TOKEN: '1234567890123456',
      CORS_ORIGIN: 'https://weathercast.app',
      READINESS_REQUIRE_PRECISION_DATA: 'true',
    });
    expect(production.PORT).toBe(8787);
    expect(production.READINESS_MIN_RADAR_FRAMES).toBe(4);
    expect(production.READINESS_MIN_OBSERVATION_STATIONS).toBe(10);
    expect(() => loadConfig({
      NODE_ENV: 'production',
      NOWCAST_PROVIDER_MODE: 'normalized-upstream',
      NORMALIZED_UPSTREAM_URL: 'https://weather.example/v1/point',
      NORMALIZED_UPSTREAM_TOKEN: '1234567890123456',
      CORS_ORIGIN: 'https://weathercast.app',
    })).toThrow('precision readiness');
  });

  test('rejects insecure and evaluation upstream hosts in production', () => {
    const base = {
      NODE_ENV: 'production',
      NOWCAST_PROVIDER_MODE: 'normalized-upstream',
      NORMALIZED_UPSTREAM_TOKEN: '1234567890123456',
      CORS_ORIGIN: 'https://weathercast.app',
      READINESS_REQUIRE_PRECISION_DATA: 'true',
    };
    expect(() => loadConfig({ ...base, NORMALIZED_UPSTREAM_URL: 'http://provider.example/v1/point' }))
      .toThrow('must use HTTPS');
    expect(() => loadConfig({ ...base, NORMALIZED_UPSTREAM_URL: 'https://api.open-meteo.com/v1/forecast' }))
      .toThrow('cannot route through');
  });
});
