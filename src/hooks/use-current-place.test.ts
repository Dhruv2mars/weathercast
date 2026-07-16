import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { cacheCurrentPlace, currentPlaceQueryKey } from '@/lib/current-place-cache';
import type { Place } from '@/types/weather';

const place: Place = {
  id: 'current',
  name: 'Delhi',
  admin: 'National Capital Territory of Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  source: 'current',
};

describe('cacheCurrentPlace', () => {
  test('keeps a successful location available across navigation', () => {
    const queryClient = new QueryClient();

    cacheCurrentPlace(queryClient, place);

    expect(queryClient.getQueryData<Place>(currentPlaceQueryKey)).toEqual(place);
  });
});
