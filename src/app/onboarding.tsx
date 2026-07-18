import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/app-button';
import { spacing, useAppTheme } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { requestCurrentPlace } from '@/services/location';

export default function OnboardingScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [preferences, setPreferences] = usePreferences();
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState<string>();

  const useLocation = async () => {
    setIsLocating(true);
    setError(undefined);
    try {
      await requestCurrentPlace();
      setPreferences({ ...preferences, selectedPlaceId: 'current', onboardingComplete: true });
      router.replace('/');
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : '';
      setError(code === 'LOCATION_SERVICES_OFF'
        ? 'Location services are off. Turn them on in system settings, or choose a place.'
        : 'Location access was not granted. You can still choose any place manually.');
    } finally {
      setIsLocating(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: spacing.lg }}>
      <View style={{ flex: 1, maxWidth: 640, width: '100%', alignSelf: 'center', justifyContent: 'center', gap: spacing.lg }}>
        <View accessible accessibilityLabel="Weathercast rain mark" style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Image accessible={false} source={require('../../assets/images/icon.png')} style={{ width: 72, height: 72 }} />
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text selectable accessibilityRole="header" style={{ color: theme.text, fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -0.8 }}>
            Know when rain reaches you.
          </Text>
          <Text selectable style={{ color: theme.secondaryText, fontSize: 19, lineHeight: 28 }}>
            Start time, intensity, duration, and confidence for the next 120 minutes—without the clutter of a general weather app.
          </Text>
        </View>
        {error && <Text selectable accessibilityRole="alert" style={{ color: theme.destructive, fontSize: 16, lineHeight: 23 }}>{error}</Text>}
        <View style={{ gap: 10 }}>
          <AppButton disabled={isLocating} onPress={useLocation} accessibilityHint="Requests foreground location permission">
            {isLocating ? <ActivityIndicator color="#FFFFFF" /> : 'Use my location'}
          </AppButton>
          <AppButton variant="secondary" onPress={() => router.push({ pathname: '/place-search', params: { onboarding: '1' } })}>
            Choose a place
          </AppButton>
        </View>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 13, lineHeight: 19 }}>
          No account. No background tracking. Coordinates are used to request the selected forecast and saved places stay on this device.
        </Text>
      </View>
    </View>
  );
}
