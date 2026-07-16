import { describe, expect, test } from 'bun:test';

import getExpoConfig, { validateProductionClientConfig } from './app.config';

const valid = {
  EXPO_PUBLIC_NOWCAST_API_URL: 'https://api.weathercast.app',
  EXPO_PUBLIC_RADAR_MANIFEST_URL: 'https://radar.weathercast.app/v1/manifest.json',
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'restricted-key-at-least-twenty-characters',
  EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://weathercast.app/privacy',
  EXPO_PUBLIC_TERMS_URL: 'https://weathercast.app/terms',
  EXPO_PUBLIC_SUPPORT_URL: 'https://weathercast.app/support',
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

  test('hardens Android local data and configures production updates', () => {
    const config = getExpoConfig();

    expect(config.android?.allowBackup).toBe(false);
    expect(config.android?.blockedPermissions).toEqual([
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ]);
    expect(config.updates?.url).toBe('https://u.expo.dev/caf9584b-fccf-4cee-8098-ee3e11c4e5c6');
  });
});
