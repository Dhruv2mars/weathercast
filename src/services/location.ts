import * as Location from 'expo-location';

import type { Place } from '@/types/weather';

export async function requestCurrentPlace(): Promise<Place> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('LOCATION_DENIED');
  return readCurrentPlace();
}

export async function readCurrentPlace(): Promise<Place> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) throw new Error('LOCATION_SERVICES_OFF');
  let position;
  try {
    position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
  } catch {
    position = await Location.getLastKnownPositionAsync({
      maxAge: 5 * 60_000,
      requiredAccuracy: 1_000,
    });
    if (!position) throw new Error('LOCATION_UNAVAILABLE');
  }
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  let name = 'Current location';
  let admin: string | undefined;
  let country: string | undefined;
  try {
    const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
    name = address?.city ?? address?.district ?? address?.subregion ?? name;
    admin = address?.region ?? undefined;
    country = address?.country ?? undefined;
  } catch {
    // Keep the coordinate-based fallback name when reverse geocoding is unavailable.
  }
  return { id: 'current', name, admin, country, latitude, longitude, source: 'current' };
}

export async function hasLocationPermission() {
  const permission = await Location.getForegroundPermissionsAsync();
  return permission.granted;
}
