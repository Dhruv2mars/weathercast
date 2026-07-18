import { router, Stack } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Screen } from '@/components/screen';
import { Divider, Group, Section } from '@/components/section';
import { spacing, useAppTheme } from '@/constants/theme';
import { usePlaces } from '@/hooks/use-places';
import { usePreferences } from '@/hooks/use-preferences';
import { useSelectCurrentPlace } from '@/hooks/use-select-current-place';
import { DEFAULT_PREFERENCES } from '@/lib/preferences';
import { syncScheduledAlert } from '@/services/notifications';
import type { Place } from '@/types/weather';

const locationErrorMessages: Record<string, string> = {
  LOCATION_DENIED: 'Allow foreground location access in system settings, or add a place manually.',
  LOCATION_SERVICES_OFF: 'Turn on device location services, then try again.',
};
const locationUnavailableMessage = 'Weathercast could not get a location fix. Move near a window or add a place manually.';

export default function PlacesScreen() {
  const theme = useAppTheme();
  const { places, remove } = usePlaces();
  const selectCurrentPlace = useSelectCurrentPlace();
  const [preferences, setPreferences] = usePreferences();

  const select = (place: Place) => {
    setPreferences({ ...preferences, selectedPlaceId: place.id });
    router.navigate('/');
  };

  const selectCurrent = async () => {
    try {
      const result = await selectCurrentPlace();
      if (result.committed) router.navigate('/');
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      Alert.alert('Location unavailable', locationErrorMessages[code] ?? locationUnavailableMessage);
    }
  };

  const removePlace = async (place: Place) => {
    if (preferences.selectedPlaceId === place.id) {
      try {
        await syncScheduledAlert(null);
      } catch {
        Alert.alert('Could not remove place', 'Weathercast could not cancel the existing rain alert. Try again.');
        return;
      }
      const nextPlace = places.find((item) => item.id !== place.id);
      setPreferences({ ...preferences, selectedPlaceId: nextPlace?.id ?? DEFAULT_PREFERENCES.selectedPlaceId });
    }
    remove(place.id);
  };

  const confirmRemove = (place: Place) => {
    Alert.alert(place.name, 'Remove this saved place?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removePlace(place) },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Places' }} />
      <Screen>
        <Section title="Current">
          <Group>
            <Pressable accessibilityRole="button" onPress={selectCurrent} style={{ minHeight: 60, padding: 16, justifyContent: 'center' }}>
              <Text selectable style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Use current location</Text>
              <Text selectable style={{ color: theme.secondaryText }}>Only while Weathercast is open</Text>
            </Pressable>
          </Group>
        </Section>

        <Section title="Saved places">
          {places.length === 0 ? (
            <View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
              <Text selectable style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>Save places you care about</Text>
              <Text selectable style={{ color: theme.secondaryText, fontSize: 16, lineHeight: 23 }}>Check rain at home, work, or anywhere you travel.</Text>
            </View>
          ) : (
            <Group>
              {places.map((place, index) => (
                <View key={place.id}>
                  {index > 0 && <Divider />}
                  <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'stretch' }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: preferences.selectedPlaceId === place.id }}
                      onPress={() => select(place)}
                      style={({ pressed }) => ({ flex: 1, padding: 16, justifyContent: 'center', backgroundColor: pressed ? theme.elevated : 'transparent' })}
                    >
                      <Text selectable style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>{place.name}</Text>
                      <Text selectable style={{ color: theme.secondaryText }}>{[place.admin, place.country].filter(Boolean).join(', ')}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${place.name}`}
                      accessibilityHint="Removes this place from Weathercast"
                      onPress={() => confirmRemove(place)}
                      hitSlop={4}
                      style={({ pressed }) => ({ minWidth: 72, minHeight: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? theme.elevated : 'transparent' })}
                    >
                      <Text style={{ color: theme.destructive, fontSize: 15, fontWeight: '700' }}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Group>
          )}
          <AppButton onPress={() => router.push('/place-search')}>Add a place</AppButton>
        </Section>
      </Screen>
    </>
  );
}
