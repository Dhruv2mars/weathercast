import type { QueryClient } from '@tanstack/react-query';

import type { Place } from '@/types/weather';

export const currentPlaceQueryKey = ['current-place'] as const;

export function cacheCurrentPlace(queryClient: QueryClient, place: Place) {
  queryClient.setQueryData(currentPlaceQueryKey, place);
}
