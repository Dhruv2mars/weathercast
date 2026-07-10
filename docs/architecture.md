# Architecture

## Mobile client

Expo Router provides native navigation. TanStack Query manages server state, retries, cancellation, and offline cache behavior. Expo Location supplies explicit foreground location. SQLite-backed local storage persists preferences, saved places, and the most recent successful nowcast. Local notifications schedule an onset reminder from the latest accepted forecast.

## Forecast boundary

`NowcastProvider` is the stable seam. The bundled `OpenMeteoNowcastProvider` supplies worldwide 15-minute numerical guidance without a client secret. Provider output is normalized before product logic derives events, confidence, copy, and alert decisions. A commercial deployment can replace or blend providers without changing screens.

## Production accuracy platform

The repository includes a Bun `/v1/nowcast` boundary. It validates and rate-limits requests, deduplicates simultaneous requests for a location cell, normalizes provider output, and archives the exact response before returning success. Development uses explicitly uncalibrated Open-Meteo evaluation guidance. Production refuses that adapter and requires a server-authenticated normalized upstream.

The included SQLite archive is the single-instance tracer bullet. Global operation still requires Postgres/PostGIS, content-addressed raw-input object storage, licensed radar/satellite/station feeds, provider freshness alarms, a verification worker, distributed cache/rate limiting, and region-aware deployment. No Precision tier or superiority claim is permitted until those inputs and held-out calibration gates pass.

## Privacy

Precise coordinates are requested only after user action. In the bundled provider path they are sent directly to the weather provider to retrieve a forecast. Saved places and preferences remain on-device. No account, advertising identifier, contact list, background location, or continuous location tracking is used.
