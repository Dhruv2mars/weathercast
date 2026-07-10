import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useAppTheme } from '@/constants/theme';

export default function AppTabs() {
  const theme = useAppTheme();
  return (
    <NativeTabs tintColor={theme.accent} backgroundColor={theme.surface} indicatorColor={theme.accentSoft}>
      <NativeTabs.Trigger name="(now)">
        <NativeTabs.Trigger.Icon sf={{ default: 'cloud.rain', selected: 'cloud.rain.fill' }} md="rainy" />
        <NativeTabs.Trigger.Label>Now</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="radar">
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
        <NativeTabs.Trigger.Label>Radar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="places">
        <NativeTabs.Trigger.Icon sf={{ default: 'mappin', selected: 'mappin.circle.fill' }} md="location_on" />
        <NativeTabs.Trigger.Label>Places</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="accuracy">
        <NativeTabs.Trigger.Icon sf={{ default: 'checkmark.seal', selected: 'checkmark.seal.fill' }} md="verified" />
        <NativeTabs.Trigger.Label>Accuracy</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
