import { useSyncExternalStore } from 'react';

import { storage } from '@/lib/storage';
import type { Place } from '@/types/weather';

let snapshot = storage.getPlaces();

export function usePlaces() {
  const places = useSyncExternalStore(
    (onChange) => storage.subscribePlaces(() => {
      snapshot = storage.getPlaces();
      onChange();
    }),
    () => snapshot,
    () => snapshot,
  );
  const save = (place: Place) => {
    const next = [place, ...places.filter((item) => item.id !== place.id)].slice(0, 20);
    snapshot = next;
    storage.setPlaces(next);
  };
  const remove = (id: string) => {
    const next = places.filter((place) => place.id !== id);
    snapshot = next;
    storage.setPlaces(next);
  };
  return { places, save, remove };
}
