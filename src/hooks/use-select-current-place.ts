import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { currentPlaceQueryKey } from '@/lib/current-place-query';
import { storage } from '@/lib/storage';
import { requestCurrentPlace } from '@/services/location';
import type { Place } from '@/types/weather';

export type CurrentPlaceSelection = {
  place: Place;
  committed: boolean;
};

type IsActive = () => boolean;

export async function selectCurrentPlace(queryClient: QueryClient, isActive: IsActive = () => true): Promise<CurrentPlaceSelection> {
  const initialPreferences = storage.getPreferences();
  const place = await requestCurrentPlace();
  if (!isActive()) return { place, committed: false };

  const latestPreferences = storage.getPreferences();
  if (
    latestPreferences.selectedPlaceId !== initialPreferences.selectedPlaceId
    || latestPreferences.onboardingComplete !== initialPreferences.onboardingComplete
  ) {
    return { place, committed: false };
  }

  queryClient.setQueryData(currentPlaceQueryKey, place);
  storage.setPreferences({
    ...latestPreferences,
    selectedPlaceId: 'current',
    onboardingComplete: true,
  });
  return { place, committed: true };
}

export function useSelectCurrentPlace() {
  const queryClient = useQueryClient();
  const requestId = useRef(0);

  useEffect(() => () => {
    requestId.current += 1;
  }, []);

  return useCallback(() => {
    const id = ++requestId.current;
    return selectCurrentPlace(queryClient, () => requestId.current === id);
  }, [queryClient]);
}
