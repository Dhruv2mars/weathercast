import { describe, expect, mock, test } from 'bun:test';

import {
  requestCurrentPlaceWith,
  type LocationAdapter,
} from '@/services/location-core';

const timestamp = Date.parse('2026-07-16T12:00:00.000Z');
const now = timestamp + 60_000;
const recentPosition = {
  latitude: 28.6139,
  longitude: 77.209,
  timestamp,
};

function locationAdapter(overrides: Partial<LocationAdapter> = {}): LocationAdapter {
  return {
    requestForegroundPermission: mock(() => Promise.resolve(true)),
    hasForegroundPermission: mock(() => Promise.resolve(true)),
    hasServicesEnabled: mock(() => Promise.resolve(true)),
    getRecentPosition: mock(() => Promise.resolve(undefined)),
    getCurrentPosition: mock(() => Promise.reject(new Error('Location request timed out'))),
    reverseGeocode: mock(() => Promise.resolve(undefined)),
    now: () => now,
    ...overrides,
  };
}

describe('requestCurrentPlaceWith', () => {
  test('classifies a denied permission separately from an unavailable fix', async () => {
    await expect(requestCurrentPlaceWith(locationAdapter({
      requestForegroundPermission: mock(() => Promise.resolve(false)),
    }))).rejects.toThrow('LOCATION_DENIED');
  });

  test('classifies disabled location services separately from an unavailable fix', async () => {
    await expect(requestCurrentPlaceWith(locationAdapter({
      hasServicesEnabled: mock(() => Promise.resolve(false)),
    }))).rejects.toThrow('LOCATION_SERVICES_OFF');
  });

  test('uses a fresh fix and labels it live', async () => {
    const place = await requestCurrentPlaceWith(locationAdapter({
      getCurrentPosition: mock(() => Promise.resolve({
        latitude: 28.614,
        longitude: 77.2091,
        timestamp: now,
      })),
    }));

    expect(place.locationSource).toBe('live');
    expect(place.locationTimestamp).toBe('2026-07-16T12:01:00.000Z');
  });

  test('uses a bounded recent fix after a fresh-fix failure', async () => {
    const place = await requestCurrentPlaceWith(locationAdapter({
      getRecentPosition: mock(() => Promise.resolve(recentPosition)),
    }));

    expect(place.locationSource).toBe('recent');
    expect(place.locationTimestamp).toBe('2026-07-16T12:00:00.000Z');
  });

  test('accepts a recent fix exactly at the two-minute boundary', async () => {
    const place = await requestCurrentPlaceWith(locationAdapter({
      now: () => timestamp + 2 * 60_000,
      getRecentPosition: mock(() => Promise.resolve(recentPosition)),
    }));

    expect(place.locationSource).toBe('recent');
  });

  test('rejects a recent fix older than two minutes', async () => {
    await expect(requestCurrentPlaceWith(locationAdapter({
      now: () => timestamp + 2 * 60_000 + 1,
      getRecentPosition: mock(() => Promise.resolve(recentPosition)),
    }))).rejects.toThrow('LOCATION_UNAVAILABLE');
  });

  test('returns unavailable when neither live nor recent location exists', async () => {
    await expect(requestCurrentPlaceWith(locationAdapter())).rejects.toThrow('LOCATION_UNAVAILABLE');
  });

  test('does not hang when the permission request never settles', async () => {
    await expect(requestCurrentPlaceWith(locationAdapter({
      requestForegroundPermission: mock(() => new Promise<boolean>(() => undefined)),
      timeouts: { permissionRequestMs: 5 },
    }))).rejects.toThrow('LOCATION_UNAVAILABLE');
  });

  test('does not hang when the services check never settles', async () => {
    await expect(requestCurrentPlaceWith(locationAdapter({
      hasServicesEnabled: mock(() => new Promise<boolean>(() => undefined)),
      timeouts: { servicesMs: 5 },
    }))).rejects.toThrow('LOCATION_UNAVAILABLE');
  });

  test('does not hang when fresh location never settles and recent fallback is available', async () => {
    const place = await requestCurrentPlaceWith(locationAdapter({
      getCurrentPosition: mock(() => new Promise<never>(() => undefined)),
      getRecentPosition: mock(() => Promise.resolve(recentPosition)),
      timeouts: { currentPositionMs: 5 },
    }));

    expect(place.locationSource).toBe('recent');
  });

  test('returns unavailable when recent location never settles after a fresh timeout', async () => {
    await expect(requestCurrentPlaceWith(locationAdapter({
      getCurrentPosition: mock(() => new Promise<never>(() => undefined)),
      getRecentPosition: mock(() => new Promise<undefined>(() => undefined)),
      timeouts: { currentPositionMs: 5, recentPositionMs: 5 },
    }))).rejects.toThrow('LOCATION_UNAVAILABLE');
  });

  test('does not block selection when reverse geocoding never settles', async () => {
    const place = await requestCurrentPlaceWith(locationAdapter({
      getRecentPosition: mock(() => Promise.resolve(recentPosition)),
      reverseGeocode: mock(() => new Promise<undefined>(() => undefined)),
      timeouts: { reverseGeocodeMs: 5 },
    }));

    expect(place.name).toBe('Current location');
  });

  test('falls back when reverse geocoding rejects or throws synchronously', async () => {
    const rejected = await requestCurrentPlaceWith(locationAdapter({
      getRecentPosition: mock(() => Promise.resolve(recentPosition)),
      reverseGeocode: mock(() => Promise.reject(new Error('geocoder unavailable'))),
    }));
    const thrown = await requestCurrentPlaceWith(locationAdapter({
      getRecentPosition: mock(() => Promise.resolve(recentPosition)),
      reverseGeocode: mock(() => {
        throw new Error('geocoder unavailable');
      }),
    }));

    expect(rejected.name).toBe('Current location');
    expect(thrown.name).toBe('Current location');
  });
});
