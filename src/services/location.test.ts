import { describe, expect, mock, test } from 'bun:test';

const requestForegroundPermissionsAsync = mock(() => Promise.resolve({ granted: true }));
const hasServicesEnabledAsync = mock(() => Promise.resolve(true));
const getCurrentPositionAsync = mock(() => Promise.reject(new Error('Location request timed out')));
const getLastKnownPositionAsync = mock(() => Promise.resolve({
  coords: { latitude: 28.6139, longitude: 77.209 },
  timestamp: Date.now() - 30_000,
}));
const reverseGeocodeAsync = mock(() => Promise.resolve([{
  city: 'Delhi',
  region: 'National Capital Territory of Delhi',
  country: 'India',
}]));

mock.module('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync,
  hasServicesEnabledAsync,
  getCurrentPositionAsync,
  getLastKnownPositionAsync,
  reverseGeocodeAsync,
}));

const { requestCurrentPlace } = await import('@/services/location');

describe('requestCurrentPlace', () => {
  test('falls back to a recent known position when a fresh fix is temporarily unavailable', async () => {
    const place = await requestCurrentPlace();

    expect(getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expect(getLastKnownPositionAsync).toHaveBeenCalledTimes(1);
    expect(place).toEqual({
      id: 'current',
      name: 'Delhi',
      admin: 'National Capital Territory of Delhi',
      country: 'India',
      latitude: 28.6139,
      longitude: 77.209,
      source: 'current',
    });
  });
});
