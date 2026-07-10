import type { ExpoConfig } from 'expo/config';

export type ProductionClientConfig = {
  nowcastApiUrl: string;
  radarManifestUrl: string;
  googleMapsApiKey: string;
};

function httpsUrl(name: string, value: string | undefined) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.example')) {
    throw new Error(`${name} must use a deployed production host.`);
  }
  return url.toString().replace(/\/$/, '');
}

export function validateProductionClientConfig(environment: Record<string, string | undefined>): ProductionClientConfig {
  const googleMapsApiKey = environment.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (!googleMapsApiKey || googleMapsApiKey.length < 20 || /replace|example/i.test(googleMapsApiKey)) {
    throw new Error('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY must be a restricted production Android key.');
  }
  return {
    nowcastApiUrl: httpsUrl('EXPO_PUBLIC_NOWCAST_API_URL', environment.EXPO_PUBLIC_NOWCAST_API_URL),
    radarManifestUrl: httpsUrl('EXPO_PUBLIC_RADAR_MANIFEST_URL', environment.EXPO_PUBLIC_RADAR_MANIFEST_URL),
    googleMapsApiKey,
  };
}

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
