import { useQuery } from '@tanstack/react-query';

import { currentPlaceQueryKey } from '@/lib/current-place-query';
import { hasLocationPermission, readCurrentPlace } from '@/services/location';

export function useCurrentPlace(enabled: boolean) {
  return useQuery({
    queryKey: currentPlaceQueryKey,
    queryFn: async () => {
      if (!await hasLocationPermission()) throw new Error('LOCATION_PERMISSION_REQUIRED');
      return readCurrentPlace();
    },
    enabled,
    staleTime: 2 * 60_000,
    refetchInterval: enabled ? 2 * 60_000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
