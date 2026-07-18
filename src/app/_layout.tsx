import '@/lib/storage';

import NetInfo from '@react-native-community/netinfo';
import { focusManager, QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { configureNotifications } from '@/services/notifications';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const scheme = useColorScheme();
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60_000,
        gcTime: 30 * 60_000,
        retry: 2,
      },
    },
  }));

  useEffect(() => {
    configureNotifications().finally(() => SplashScreen.hideAsync());
  }, []);

  useEffect(() => {
    onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected))));
    focusManager.setEventListener((handleFocus) => {
      const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
      return () => subscription.remove();
    });
    return () => {
      onlineManager.setEventListener(() => undefined);
      focusManager.setEventListener(() => undefined);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="place-search" options={{ title: 'Choose a place', presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'formSheet', sheetGrabberVisible: true }} />
          <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
          <Stack.Screen name="terms" options={{ title: 'Terms' }} />
          <Stack.Screen name="support" options={{ title: 'Support' }} />
          <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
