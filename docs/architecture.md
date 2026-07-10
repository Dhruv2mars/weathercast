# Architecture

## Mobile client

Expo Router provides native navigation. TanStack Query manages server state, retries, cancellation, and offline cache behavior. Expo Location supplies explicit foreground location. SQLite-backed local storage persists preferences, saved places, and the most recent successful nowcast. Local notifications schedule an onset reminder from the latest accepted forecast.

## Forecast boundary

`NowcastProvider` is the stable seam. The bundled `OpenMeteoNowcastProvider` supplies worldwide 15-minute numerical guidance without a client secret. Provider output is normalized before product logic derives events, confidence, copy, and alert decisions. A commercial deployment can replace or blend providers without changing screens.

## Production accuracy platform

The client is ready for a `/v1/nowcast` backend. That service should ingest licensed radar, satellite, station, lightning, and numerical-model feeds; archive every issued forecast; verify it against observations; calibrate by location, season, regime, and lead time; and return the same normalized contract. Raw provider credentials must never ship in the app.

## Privacy

Precise coordinates are requested only after user action. In the bundled provider path they are sent directly to the weather provider to retrieve a forecast. Saved places and preferences remain on-device. No account, advertising identifier, contact list, background location, or continuous location tracking is used.
