import { Stack } from 'expo-router/stack';

export default function PlacesLayout() {
  return <Stack screenOptions={{ headerLargeTitle: true, headerTransparent: true, headerShadowVisible: false }} />;
}
