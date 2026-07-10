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
