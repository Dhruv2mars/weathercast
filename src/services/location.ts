import * as Location from 'expo-location';

import {
  hasLocationPermissionWith,
  readCurrentPlaceWith,
  requestCurrentPlaceWith,
  type LocationAdapter,
} from '@/services/location-core';

const adapter: LocationAdapter = {
  async requestForegroundPermission() {
    return (await Location.requestForegroundPermissionsAsync()).granted;
  },
  async hasForegroundPermission() {
    return (await Location.getForegroundPermissionsAsync()).granted;
  },
  hasServicesEnabled: Location.hasServicesEnabledAsync,
  async getRecentPosition() {
    const position = await Location.getLastKnownPositionAsync({
      maxAge: 2 * 60_000,
      requiredAccuracy: 500,
    });
    return position ? {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: position.timestamp,
    } : undefined;
  },
  async getCurrentPosition() {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: position.timestamp,
    };
  },
  async reverseGeocode(coordinates) {
    return (await Location.reverseGeocodeAsync(coordinates))[0];
  },
};

export function requestCurrentPlace() {
  return requestCurrentPlaceWith(adapter);
}

export function readCurrentPlace() {
  return readCurrentPlaceWith(adapter);
}

export function hasLocationPermission() {
  return hasLocationPermissionWith(adapter);
}
