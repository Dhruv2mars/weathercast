import { useQuery } from '@tanstack/react-query';

import { hasLocationPermission, readCurrentPlace } from '@/services/location';

export function useCurrentPlace(enabled: boolean) {
  return useQuery({
    queryKey: ['current-place'],
    queryFn: async () => {
      if (!await hasLocationPermission()) throw new Error('LOCATION_PERMISSION_REQUIRED');
      return readCurrentPlace();
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
