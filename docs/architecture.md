# Architecture

## Mobile client

Expo Router provides native navigation. TanStack Query manages server state, retries, cancellation, and offline cache behavior. Expo Location supplies explicit foreground location. SQLite-backed local storage persists preferences, saved places, and the most recent successful nowcast. Local notifications schedule an onset reminder from the latest accepted forecast.

## Forecast boundary

`NowcastProvider` is the stable seam. The bundled `OpenMeteoNowcastProvider` supplies worldwide 15-minute numerical guidance without a client secret. Provider output is normalized before product logic derives events, confidence, copy, and alert decisions. A commercial deployment can replace or blend providers without changing screens.

## Production accuracy platform

The repository includes a Bun `/v1/nowcast` boundary. It validates and rate-limits requests, deduplicates simultaneous requests for a location cell, normalizes provider output, and archives the exact response before returning success. Development uses explicitly uncalibrated Open-Meteo evaluation guidance. Production refuses that adapter and requires a server-authenticated normalized upstream.

The archive also freezes prospective radar-study definitions, coordinates, cadence slots, source-frame links, and versioned evidence reports. Reports score only full-cohort issues against one deterministic verified METAR observation per run and horizon. Publication eligibility requires the study to end, at least 95% complete issuance, and every registered sample gate. This evaluates Weathercast's own shadow model; it cannot promote Precision or establish superiority over another provider.

The included SQLite archive is the single-instance tracer bullet. Global operation still requires Postgres/PostGIS, content-addressed raw-input object storage, licensed radar/satellite/station feeds, provider freshness alarms, a scalable verification worker, distributed cache/rate limiting, and region-aware deployment. No Precision tier or superiority claim is permitted until those inputs, an independent calibration holdout, and a lawful paired comparison pass their respective gates.

## Privacy

Precise coordinates are requested only after user action. In the bundled provider path they are sent directly to the weather provider to retrieve a forecast. Saved places and preferences remain on-device. No account, advertising identifier, contact list, background location, or continuous location tracking is used.
