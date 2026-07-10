import { Tabs } from 'expo-router';

import { useAppTheme } from '@/constants/theme';

export default function AppTabs() {
  const theme = useAppTheme();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: theme.accent, tabBarStyle: { backgroundColor: theme.surface } }}>
      <Tabs.Screen name="(now)" options={{ title: 'Now' }} />
      <Tabs.Screen name="radar" options={{ title: 'Radar' }} />
      <Tabs.Screen name="places" options={{ title: 'Places' }} />
      <Tabs.Screen name="accuracy" options={{ title: 'Accuracy' }} />
    </Tabs>
  );
}
