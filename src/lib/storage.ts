import 'expo-sqlite/localStorage/install';

import { parsePreferences, DEFAULT_PREFERENCES } from '@/lib/preferences';
import { isCachedNowcast, parseStoredPlaces } from '@/lib/storage-validation';
import type { Nowcast, Place, Preferences } from '@/types/weather';

const KEYS = {
  preferences: 'weathercast.preferences.v1',
  places: 'weathercast.places.v1',
  nowcast: 'weathercast.nowcast.v1',
};

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export const storage = {
  getPreferences(): Preferences {
    return parsePreferences(localStorage.getItem(KEYS.preferences));
  },
  setPreferences(preferences: Preferences) {
    localStorage.setItem(KEYS.preferences, JSON.stringify(preferences));
    notify(KEYS.preferences);
  },
  subscribePreferences(listener: Listener) {
    const set = listeners.get(KEYS.preferences) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(KEYS.preferences, set);
    return () => set.delete(listener);
  },
  getPlaces(): Place[] {
    return parseStoredPlaces(readJson<unknown>(KEYS.places, []));
  },
  setPlaces(places: Place[]) {
    localStorage.setItem(KEYS.places, JSON.stringify(places));
    notify(KEYS.places);
  },
  subscribePlaces(listener: Listener) {
    const set = listeners.get(KEYS.places) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(KEYS.places, set);
    return () => set.delete(listener);
  },
  getNowcast(locationKey: string): Nowcast | undefined {
    const cache = readJson<unknown>(KEYS.nowcast, {});
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return undefined;
    const nowcast = (cache as Record<string, unknown>)[locationKey];
    if (!isCachedNowcast(nowcast)) return undefined;
    return nowcast.validUntil && new Date(nowcast.validUntil).getTime() <= Date.now()
      ? { ...nowcast, expired: true }
      : nowcast;
  },
  setNowcast(locationKey: string, nowcast: Nowcast) {
    const cache = readJson<Record<string, Nowcast>>(KEYS.nowcast, {});
    localStorage.setItem(KEYS.nowcast, JSON.stringify({ ...cache, [locationKey]: nowcast }));
  },
  clearAll() {
    Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
    storage.setPreferences(DEFAULT_PREFERENCES);
    storage.setPlaces([]);
  },
};

export function locationKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}
