import { router, Stack } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Screen } from '@/components/screen';
import { Divider, Group, Section } from '@/components/section';
import { spacing, useAppTheme } from '@/constants/theme';
import { usePlaces } from '@/hooks/use-places';
import { usePreferences } from '@/hooks/use-preferences';
import { requestCurrentPlace } from '@/services/location';
import type { Place } from '@/types/weather';

export default function PlacesScreen() {
  const theme = useAppTheme();
  const { places, remove } = usePlaces();
  const [preferences, setPreferences] = usePreferences();

  const select = (place: Place) => {
    setPreferences({ ...preferences, selectedPlaceId: place.id });
    router.navigate('/');
  };

  const selectCurrent = async () => {
    try {
      const place = await requestCurrentPlace();
      setPreferences({ ...preferences, selectedPlaceId: 'current', onboardingComplete: true });
      router.navigate('/');
      return place;
    } catch {
      Alert.alert('Location unavailable', 'Allow foreground location access in system settings, or add a place manually.');
    }
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: preferences.selectedPlaceId === place.id }}
                    onPress={() => select(place)}
                    onLongPress={() => Alert.alert(place.name, 'Remove this saved place?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => remove(place.id) },
                    ])}
                    style={({ pressed }) => ({ minHeight: 64, padding: 16, justifyContent: 'center', backgroundColor: pressed ? theme.elevated : 'transparent' })}
                  >
                    <Text selectable style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>{place.name}</Text>
                    <Text selectable style={{ color: theme.secondaryText }}>{[place.admin, place.country].filter(Boolean).join(', ')}</Text>
                  </Pressable>
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
