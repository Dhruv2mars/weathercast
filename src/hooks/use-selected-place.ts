import { useCurrentPlace } from '@/hooks/use-current-place';
import { usePlaces } from '@/hooks/use-places';
import { usePreferences } from '@/hooks/use-preferences';

export function useSelectedPlace() {
  const [preferences] = usePreferences();
  const { places } = usePlaces();
  const current = useCurrentPlace(preferences.selectedPlaceId === 'current');
  const saved = places.find((place) => place.id === preferences.selectedPlaceId);
  return {
    place: preferences.selectedPlaceId === 'current' ? current.data : saved,
    isLoading: preferences.selectedPlaceId === 'current' && current.isLoading,
    error: preferences.selectedPlaceId === 'current' ? current.error : undefined,
    refetch: current.refetch,
  };
}
