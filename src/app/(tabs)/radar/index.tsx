import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RadarMap } from '@/components/radar-map';
import { spacing, useAppTheme } from '@/constants/theme';
import { useNowcast } from '@/hooks/use-nowcast';
import { useSelectedPlace } from '@/hooks/use-selected-place';
import { fetchRadarManifest } from '@/services/radar';

export default function RadarScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const selected = useSelectedPlace();
  const nowcast = useNowcast(selected.place);
  const radar = useQuery({ queryKey: ['radar-manifest'], queryFn: ({ signal }) => fetchRadarManifest(signal), staleTime: 2 * 60_000 });

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: selected.place?.name ?? 'Radar' }} />
      {selected.place ? (
        <RadarMap place={selected.place} manifest={radar.data} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
          <Text selectable style={{ color: theme.text, fontSize: 22, fontWeight: '700' }}>Choose a place to open the map</Text>
        </View>
      )}
      <View style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: Math.max(insets.bottom, 12),
        backgroundColor: theme.surface,
        borderRadius: 16,
        borderCurve: 'continuous',
        padding: 16,
        gap: 6,
        boxShadow: '0 4px 8px rgba(0,0,0,0.16)',
      }}>
        <Text selectable style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
          {nowcast.data?.headline ?? 'Rain layer unavailable'}
        </Text>
        <Text selectable style={{ color: theme.secondaryText, lineHeight: 20 }}>
          {radar.data
            ? 'Licensed radar layer · latest frame shown'
            : 'No licensed radar feed is configured here. Point guidance remains available; no synthetic radar is shown.'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/place-search')} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '700' }}>Change place</Text>
        </Pressable>
      </View>
    </View>
  );
}
