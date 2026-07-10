import { Stack } from 'expo-router/stack';
import { Platform } from 'react-native';

import { useAppTheme } from '@/constants/theme';

export default function PlacesLayout() {
  const theme = useAppTheme();
  const usesIosLargeTitle = Platform.OS === 'ios';
  return <Stack screenOptions={{
    headerLargeTitle: usesIosLargeTitle,
    headerTransparent: usesIosLargeTitle,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: theme.background },
    headerLargeStyle: { backgroundColor: usesIosLargeTitle ? 'transparent' : theme.background },
  }} />;
}
