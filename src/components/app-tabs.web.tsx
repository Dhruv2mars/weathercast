import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useAppTheme } from '@/constants/theme';

const tabs = [
  { name: '(now)', title: 'Now', icon: '☂' },
  { name: 'radar', title: 'Radar', icon: '⌖' },
  { name: 'places', title: 'Places', icon: '●' },
  { name: 'accuracy', title: 'Accuracy', icon: '✓' },
] as const;

export default function WebAppTabs() {
  const theme = useAppTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.secondaryText,
        tabBarStyle: {
          height: 66,
          paddingTop: 6,
          paddingBottom: 8,
          backgroundColor: theme.surface,
          borderTopColor: theme.separator,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: `${tab.title} tab`,
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20, lineHeight: 22 }}>{tab.icon}</Text>,
          }}
        />
      ))}
    </Tabs>
  );
}
