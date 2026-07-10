import { DEFAULT_PREFERENCES, parsePreferences } from '@/lib/preferences';
import type { Nowcast, Place, Preferences } from '@/types/weather';

const KEYS = {
  preferences: 'weathercast.preferences.v1',
  places: 'weathercast.places.v1',
  nowcast: 'weathercast.nowcast.v1',
};

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const serverMemory = new Map<string, string>();

const adapter = {
  getItem(key: string) {
    if (typeof window === 'undefined') return serverMemory.get(key) ?? null;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === 'undefined') serverMemory.set(key, value);
    else window.localStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (typeof window === 'undefined') serverMemory.delete(key);
    else window.localStorage.removeItem(key);
  },
};

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = adapter.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export const storage = {
  getPreferences(): Preferences {
    return parsePreferences(adapter.getItem(KEYS.preferences));
  },
  setPreferences(preferences: Preferences) {
    adapter.setItem(KEYS.preferences, JSON.stringify(preferences));
    notify(KEYS.preferences);
  },
  subscribePreferences(listener: Listener) {
    const set = listeners.get(KEYS.preferences) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(KEYS.preferences, set);
    return () => set.delete(listener);
  },
  getPlaces(): Place[] {
    const places = readJson<Place[]>(KEYS.places, []);
    return Array.isArray(places) ? places : [];
  },
  setPlaces(places: Place[]) {
    adapter.setItem(KEYS.places, JSON.stringify(places));
    notify(KEYS.places);
  },
  subscribePlaces(listener: Listener) {
    const set = listeners.get(KEYS.places) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(KEYS.places, set);
    return () => set.delete(listener);
  },
  getNowcast(locationKey: string): Nowcast | undefined {
    return readJson<Record<string, Nowcast>>(KEYS.nowcast, {})[locationKey];
  },
  setNowcast(locationKey: string, nowcast: Nowcast) {
    const cache = readJson<Record<string, Nowcast>>(KEYS.nowcast, {});
    adapter.setItem(KEYS.nowcast, JSON.stringify({ ...cache, [locationKey]: nowcast }));
  },
  clearAll() {
    Object.values(KEYS).forEach((key) => adapter.removeItem(key));
    storage.setPreferences(DEFAULT_PREFERENCES);
    storage.setPlaces([]);
  },
};

export function locationKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}
