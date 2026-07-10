import { Stack } from 'expo-router/stack';
import { Platform } from 'react-native';

import { useAppTheme } from '@/constants/theme';

export default function RadarLayout() {
  const theme = useAppTheme();
  return <Stack screenOptions={{
    headerTransparent: Platform.OS === 'ios',
    headerShadowVisible: false,
    headerStyle: { backgroundColor: theme.background },
  }} />;
}
