import type { Place } from '@/types/weather';

type Position = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

export type LocationTimeouts = {
  permissionRequestMs: number;
  permissionStatusMs: number;
  servicesMs: number;
  recentPositionMs: number;
  currentPositionMs: number;
  reverseGeocodeMs: number;
  recentPositionMaxAgeMs: number;
};

export const DEFAULT_LOCATION_TIMEOUTS: LocationTimeouts = {
  permissionRequestMs: 10_000,
  permissionStatusMs: 3_000,
  servicesMs: 3_000,
  recentPositionMs: 3_000,
  currentPositionMs: 8_000,
  reverseGeocodeMs: 3_000,
  recentPositionMaxAgeMs: 2 * 60_000,
};

type Address = {
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
  country?: string | null;
};

export type LocationAdapter = {
  requestForegroundPermission(): Promise<boolean>;
  hasForegroundPermission(): Promise<boolean>;
  hasServicesEnabled(): Promise<boolean>;
  getRecentPosition(): Promise<Position | undefined>;
  getCurrentPosition(): Promise<Position>;
  reverseGeocode(coordinates: { latitude: number; longitude: number }): Promise<Address | undefined>;
  timeouts?: Partial<LocationTimeouts>;
  now?: () => number;
};

function timeoutFor(adapter: LocationAdapter, key: keyof LocationTimeouts) {
  return adapter.timeouts?.[key] ?? DEFAULT_LOCATION_TIMEOUTS[key];
}

function withTimeout<T>(operation: () => Promise<T> | T, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('LOCATION_OPERATION_TIMEOUT'));
    }, timeoutMs);

    const finish = (callback: typeof resolve | typeof reject, value: T | unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value as never);
    };

    let result: Promise<T>;
    try {
      result = Promise.resolve(operation());
    } catch (error) {
      finish(reject, error);
      return;
    }

    result.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function isValidPosition(position: Position | undefined): position is Position {
  if (!position) return false;
  return Number.isFinite(position.latitude)
    && Number.isFinite(position.longitude)
    && Number.isFinite(position.timestamp);
}

function isRecentPosition(adapter: LocationAdapter, position: Position | undefined) {
  if (!isValidPosition(position)) return false;
  const age = (adapter.now?.() ?? Date.now()) - position.timestamp;
  return age >= 0 && age <= timeoutFor(adapter, 'recentPositionMaxAgeMs');
}

async function readRecentPosition(adapter: LocationAdapter) {
  try {
    const position = await withTimeout(
      () => adapter.getRecentPosition(),
      timeoutFor(adapter, 'recentPositionMs'),
    );
    return isRecentPosition(adapter, position) ? position : undefined;
  } catch {
    return undefined;
  }
}

async function readAddress(adapter: LocationAdapter, coordinates: { latitude: number; longitude: number }) {
  try {
    return await withTimeout(
      () => adapter.reverseGeocode(coordinates),
      timeoutFor(adapter, 'reverseGeocodeMs'),
    );
  } catch {
    return undefined;
  }
}

export async function requestCurrentPlaceWith(adapter: LocationAdapter): Promise<Place> {
  let granted: boolean;
  try {
    granted = await withTimeout(
      () => adapter.requestForegroundPermission(),
      timeoutFor(adapter, 'permissionRequestMs'),
    );
  } catch {
    throw new Error('LOCATION_UNAVAILABLE');
  }
  if (!granted) throw new Error('LOCATION_DENIED');
  return readCurrentPlaceWith(adapter);
}

export async function hasLocationPermissionWith(adapter: LocationAdapter) {
  try {
    return await withTimeout(
      () => adapter.hasForegroundPermission(),
      timeoutFor(adapter, 'permissionStatusMs'),
    );
  } catch {
    return false;
  }
}

export async function readCurrentPlaceWith(adapter: LocationAdapter): Promise<Place> {
  let servicesEnabled: boolean;
  try {
    servicesEnabled = await withTimeout(
      () => adapter.hasServicesEnabled(),
      timeoutFor(adapter, 'servicesMs'),
    );
  } catch {
    throw new Error('LOCATION_UNAVAILABLE');
  }
  if (!servicesEnabled) throw new Error('LOCATION_SERVICES_OFF');

  let position: Position | undefined;
  let locationSource: Place['locationSource'] = 'live';
  try {
    const freshPosition = await withTimeout(
      () => adapter.getCurrentPosition(),
      timeoutFor(adapter, 'currentPositionMs'),
    );
    position = isValidPosition(freshPosition) ? freshPosition : undefined;
  } catch {
    position = undefined;
  }

  if (!position) {
    position = await readRecentPosition(adapter);
    locationSource = 'recent';
  }

  if (!position) throw new Error('LOCATION_UNAVAILABLE');

  const { latitude, longitude } = position;
  const address = await readAddress(adapter, { latitude, longitude });
  return {
    id: 'current',
    name: address?.city ?? address?.district ?? address?.subregion ?? 'Current location',
    admin: address?.region ?? undefined,
    country: address?.country ?? undefined,
    latitude,
    longitude,
    source: 'current',
    locationSource,
    locationTimestamp: new Date(position.timestamp).toISOString(),
  };
}
