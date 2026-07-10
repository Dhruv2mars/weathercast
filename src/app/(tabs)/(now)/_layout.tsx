import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/constants/theme';

export default function NowLayout() {
  const theme = useAppTheme();
  return (
    <Stack screenOptions={{
      headerLargeTitle: true,
      headerTransparent: true,
      headerShadowVisible: false,
      headerLargeStyle: { backgroundColor: 'transparent' },
      headerTitleStyle: { color: theme.text },
      headerBackButtonDisplayMode: 'minimal',
    }} />
  );
}
