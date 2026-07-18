import { Tabs } from 'expo-router';
import { Image, Text } from 'react-native';

import { useAppTheme } from '@/constants/theme';

const tabs = [
  { name: '(now)', title: 'Now', icon: 'brand' },
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
            tabBarIcon: ({ color }) => tab.icon === 'brand'
              ? <Image accessible={false} source={require('../../assets/images/ui-mark.png')} style={{ width: 22, height: 22, borderRadius: 6, opacity: color === theme.accent ? 1 : 0.62 }} />
              : <Text style={{ color, fontSize: 20, lineHeight: 22 }}>{tab.icon}</Text>,
          }}
        />
      ))}
    </Tabs>
  );
}
