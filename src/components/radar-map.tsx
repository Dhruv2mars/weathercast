import MapView, { Circle, Marker, UrlTile } from 'react-native-maps';
import { Platform, Text, useColorScheme, View } from 'react-native';

import { spacing, useAppTheme } from '@/constants/theme';
import type { Place, RadarManifest } from '@/types/weather';

export function RadarMap({ place, manifest }: { place: Place; manifest: RadarManifest | null | undefined }) {
  const scheme = useColorScheme();
  const theme = useAppTheme();
  const frame = manifest?.frames.at(-1);
  const hasAndroidMapKey = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);

  if (Platform.OS === 'android' && !hasAndroidMapKey) {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={`Map service is not configured. Selected place: ${place.name}`}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: theme.elevated }}
      >
        <View style={{ width: 188, height: 188, borderRadius: 94, borderWidth: 2, borderColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 112, height: 112, borderRadius: 56, borderWidth: 2, borderColor: theme.accent, opacity: 0.72, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: theme.accent }} />
          </View>
        </View>
        <Text selectable style={{ marginTop: spacing.lg, color: theme.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>
          {place.name}
        </Text>
        <Text selectable style={{ marginTop: spacing.xs, color: theme.secondaryText, lineHeight: 21, textAlign: 'center' }}>
          Add a restricted Android Maps key to enable the geographic base map.
        </Text>
      </View>
    );
  }

  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={{
        latitude: place.latitude,
        longitude: place.longitude,
        latitudeDelta: 0.18,
        longitudeDelta: 0.18,
      }}
      userInterfaceStyle={scheme === 'dark' ? 'dark' : 'light'}
      showsCompass
      showsScale
      accessibilityLabel={`Rain map centered on ${place.name}`}
    >
      {manifest && frame && (
        <UrlTile
          urlTemplate={`${manifest.host.replace(/\/$/, '')}${frame.path}/{z}/{x}/{y}.png`}
          maximumZ={12}
          opacity={0.72}
          zIndex={2}
        />
      )}
      <Circle
        center={{ latitude: place.latitude, longitude: place.longitude }}
        radius={1200}
        fillColor="rgba(23,104,229,0.12)"
        strokeColor="rgba(23,104,229,0.72)"
        strokeWidth={2}
      />
      <Marker coordinate={{ latitude: place.latitude, longitude: place.longitude }} title={place.name} />
    </MapView>
  );
}
