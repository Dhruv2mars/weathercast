import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { spacing, useAppTheme } from '@/constants/theme';
import { usePlaces } from '@/hooks/use-places';
import { usePreferences } from '@/hooks/use-preferences';
import { searchPlaces } from '@/services/geocoding';
import type { Place } from '@/types/weather';

export default function PlaceSearchScreen() {
  const theme = useAppTheme();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const [query, setQuery] = useState('');
  const { save } = usePlaces();
  const [preferences, setPreferences] = usePreferences();
  const results = useQuery({
    queryKey: ['place-search', query],
    queryFn: ({ signal }) => searchPlaces(query, signal),
    enabled: query.trim().length >= 2,
    staleTime: 10 * 60_000,
  });

  const choose = (place: Place) => {
    save({ ...place, source: 'saved' });
    setPreferences({ ...preferences, selectedPlaceId: place.id, onboardingComplete: onboarding === '1' ? true : preferences.onboardingComplete });
    router.replace('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.md, gap: 2 }}
      >
          <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
            <TextInput
              autoFocus
              accessibilityLabel="Search for a city or place"
              value={query}
              onChangeText={setQuery}
              placeholder="City or place"
              placeholderTextColor={theme.secondaryText}
              autoCorrect={false}
              returnKeyType="search"
              style={{ minHeight: 48, backgroundColor: theme.elevated, color: theme.text, borderRadius: 12, paddingHorizontal: 16, fontSize: 17 }}
            />
            {results.isFetching && <ActivityIndicator accessibilityLabel="Searching places" color={theme.accent} />}
            {results.isError && <Text selectable accessibilityRole="alert" style={{ color: theme.destructive }}>Place search failed. Check your connection and try again.</Text>}
            {!results.isFetching && query.length >= 2 && results.data?.length === 0 && (
              <Text selectable style={{ color: theme.secondaryText }}>No matching places found.</Text>
            )}
          </View>
        {(results.data ?? []).map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => choose(item)}
            style={({ pressed }) => ({ minHeight: 56, paddingVertical: 10, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: pressed ? theme.elevated : 'transparent', borderRadius: 10 })}
          >
            <Text selectable style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>{item.name}</Text>
            <Text selectable style={{ color: theme.secondaryText, fontSize: 14 }}>{[item.admin, item.country].filter(Boolean).join(', ')}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
