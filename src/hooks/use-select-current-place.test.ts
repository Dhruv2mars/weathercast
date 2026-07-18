import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import type { Place, Preferences } from '@/types/weather';

const place: Place = {
  id: 'current',
  name: 'New Delhi',
  admin: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  source: 'current',
};
const initialPreferences: Preferences = {
  alerts: { enabled: true, leadMinutes: 10, significantOnly: true },
  onboardingComplete: false,
  selectedPlaceId: 'saved-delhi',
};
let currentPreferences = { ...initialPreferences };
let requestCurrentPlaceImpl: () => Promise<Place> = () => Promise.resolve(place);
const setPreferences = mock((next: Preferences) => {
  currentPreferences = next;
});

mock.module('@/services/location', () => ({
  requestCurrentPlace: mock(() => requestCurrentPlaceImpl()),
}));
mock.module('@/lib/storage', () => ({
  storage: {
    getPreferences: () => currentPreferences,
    setPreferences,
  },
}));

const { selectCurrentPlace } = await import('@/hooks/use-select-current-place');

describe('selectCurrentPlace', () => {
  beforeEach(() => {
    currentPreferences = { ...initialPreferences };
    requestCurrentPlaceImpl = () => Promise.resolve(place);
    setPreferences.mockClear();
  });

  test('updates cache and current selection without overwriting alert preferences', async () => {
    const queryClient = new QueryClient();

    const result = await selectCurrentPlace(queryClient);

    expect(result.committed).toBe(true);
    expect(queryClient.getQueryData<Place>(['current-place'])).toEqual(place);
    expect(setPreferences).toHaveBeenCalledWith({
      ...initialPreferences,
      selectedPlaceId: 'current',
      onboardingComplete: true,
    });
  });

  test('discards a late result after manual selection changes preferences', async () => {
    let resolveLocation!: (value: Place) => void;
    requestCurrentPlaceImpl = () => new Promise<Place>((resolve) => {
      resolveLocation = resolve;
    });
    const queryClient = new QueryClient();
    const selection = selectCurrentPlace(queryClient);

    currentPreferences = {
      ...initialPreferences,
      selectedPlaceId: 'manual-place',
      onboardingComplete: true,
    };
    resolveLocation(place);

    const result = await selection;

    expect(result.committed).toBe(false);
    expect(queryClient.getQueryData<Place>(['current-place'])).toBeUndefined();
    expect(setPreferences).not.toHaveBeenCalled();
  });

  test('discards a result when the caller marks the request inactive', async () => {
    const queryClient = new QueryClient();

    const result = await selectCurrentPlace(queryClient, () => false);

    expect(result.committed).toBe(false);
    expect(queryClient.getQueryData<Place>(['current-place'])).toBeUndefined();
    expect(setPreferences).not.toHaveBeenCalled();
  });
});
