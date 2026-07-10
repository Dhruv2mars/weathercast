import type { ExpoConfig } from 'expo/config';

import { validateProductionClientConfig } from './config/production';

export default (): ExpoConfig => {
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const isProductionBuild = process.env.EAS_BUILD_PROFILE === 'production';

  if (isProductionBuild) {
    validateProductionClientConfig(process.env);
  }

  return {
    name: 'Weathercast',
    slug: 'weathercast',
    owner: 'dhruv2mars',
    version: '1.0.0',
    orientation: 'default',
    icon: './assets/images/icon.png',
    scheme: 'weathercast',
    userInterfaceStyle: 'automatic',
    runtimeVersion: { policy: 'appVersion' },
    updates: { fallbackToCacheTimeout: 0 },
    ios: {
      icon: './assets/expo.icon',
      bundleIdentifier: 'com.dhruv2mars.weathercast',
      supportsTablet: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: 'Weathercast uses your location while the app is open to calculate rain timing for where you are.',
      },
    },
    android: {
      package: 'com.dhruv2mars.weathercast',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: true,
      ...(googleMapsApiKey ? { config: { googleMaps: { apiKey: googleMapsApiKey } } } : {}),
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      ['expo-splash-screen', {
        backgroundColor: '#07101D',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      }],
      ['expo-location', {
        locationWhenInUsePermission: 'Weathercast uses your location while the app is open to calculate rain timing for where you are.',
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
      }],
      ['expo-notifications', {
        color: '#1768E5',
        defaultChannel: 'rain-alerts',
      }],
      'expo-sqlite',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: { projectId: 'caf9584b-fccf-4cee-8098-ee3e11c4e5c6' },
    },
  };
};
