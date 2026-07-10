import { useQuery } from '@tanstack/react-query';

import { locationKey, storage } from '@/lib/storage';
import { ApiError } from '@/services/http';
import { fetchNowcast } from '@/services/nowcast-provider';
import type { Nowcast, Place } from '@/types/weather';

export function useNowcast(place: Place | undefined) {
  const key = place ? locationKey(place.latitude, place.longitude) : 'unselected';
  return useQuery<Nowcast>({
    queryKey: ['nowcast', key],
    queryFn: ({ signal }) => fetchNowcast(place!, signal),
    enabled: Boolean(place),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnReconnect: true,
    retry: (failureCount, error) => {
      if (failureCount >= 2) return false;
      if (!(error instanceof ApiError)) return false;
      return error.status === 0 || error.status === 429 || error.status >= 500;
    },
    placeholderData: place ? storage.getNowcast(key) : undefined,
    meta: { persistKey: key },
    select: (nowcast) => {
      storage.setNowcast(key, nowcast);
      return nowcast;
    },
  });
}
