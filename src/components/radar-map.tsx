import MapView, { Circle, Marker, UrlTile } from 'react-native-maps';
import { useColorScheme } from 'react-native';

import type { Place, RadarManifest } from '@/types/weather';

export function RadarMap({ place, manifest }: { place: Place; manifest: RadarManifest | null | undefined }) {
  const scheme = useColorScheme();
  const frame = manifest?.frames.at(-1);
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
