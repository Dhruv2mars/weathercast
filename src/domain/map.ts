export function canRenderNativeMap(platform: string, googleMapsApiKey: string | undefined) {
  return platform !== 'android' || Boolean(googleMapsApiKey?.trim());
}
