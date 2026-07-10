import { describe, expect, test } from 'bun:test';

import { validateProductionClientConfig } from './app.config';

const valid = {
  EXPO_PUBLIC_NOWCAST_API_URL: 'https://api.weathercast.app',
  EXPO_PUBLIC_RADAR_MANIFEST_URL: 'https://radar.weathercast.app/v1/manifest.json',
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'restricted-key-at-least-twenty-characters',
};

describe('validateProductionClientConfig', () => {
  test('accepts deployed HTTPS endpoints and a non-placeholder key', () => {
    expect(validateProductionClientConfig(valid).nowcastApiUrl).toBe('https://api.weathercast.app');
  });

  test('rejects placeholders, local hosts, HTTP, and weak map keys', () => {
    expect(() => validateProductionClientConfig({ ...valid, EXPO_PUBLIC_NOWCAST_API_URL: 'https://api.weathercast.example' })).toThrow();
    expect(() => validateProductionClientConfig({ ...valid, EXPO_PUBLIC_RADAR_MANIFEST_URL: 'http://radar.weathercast.app' })).toThrow();
    expect(() => validateProductionClientConfig({ ...valid, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'replace-me' })).toThrow();
  });
});
