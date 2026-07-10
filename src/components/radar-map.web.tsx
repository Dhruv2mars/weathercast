import { Text, View } from 'react-native';

import { useAppTheme } from '@/constants/theme';
import type { Place, RadarManifest } from '@/types/weather';

export function RadarMap({ place }: { place: Place; manifest: RadarManifest | null | undefined }) {
  const theme = useAppTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.elevated }}>
      <Text selectable style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>Map preview is available in the iOS and Android app.</Text>
      <Text selectable style={{ color: theme.secondaryText, paddingTop: 8 }}>{place.name} · {place.latitude.toFixed(3)}, {place.longitude.toFixed(3)}</Text>
    </View>
  );
}
