import { useSyncExternalStore } from 'react';

import { storage } from '@/lib/storage';
import type { Preferences } from '@/types/weather';

let snapshot = storage.getPreferences();

export function usePreferences(): [Preferences, (next: Preferences) => void] {
  const preferences = useSyncExternalStore(
    (onChange) => {
      snapshot = storage.getPreferences();
      return storage.subscribePreferences(() => {
        snapshot = storage.getPreferences();
        onChange();
      });
    },
    () => snapshot,
    () => snapshot,
  );
  return [preferences, storage.setPreferences];
}
