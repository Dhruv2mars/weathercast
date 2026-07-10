# Weathercast

Weathercast is a rain-only nowcasting app for iOS, Android, and web. It answers one question for a selected location: **when will rain reach me during the next 120 minutes?**

The client is intentionally honest about data quality. It shows timing, intensity, duration, confidence, freshness, and a regional coverage tier. It does not claim street-level precision when only numerical guidance is available.

## Product surface

- Native Expo Router navigation with Now, Radar, Places, and Accuracy tabs
- Foreground location or manual place search; no account or background tracking
- 15-minute rain timeline, onset window, event duration, intensity, and confidence
- Offline display of the most recent successful nowcast
- Local rain alerts in development and production builds
- Licensed radar tile integration point with an explicit unavailable state
- Accessible light/dark UI adapted to iOS, Android, tablet, and web
- Provider-independent `/v1/nowcast` contract for a calibrated production backend

## Run locally

Requirements: Bun, Xcode for iOS, and Android Studio for Android.

```bash
bun install
bun start
```

Expo Go can exercise forecast and navigation flows. Android notifications require a development build:

```bash
bunx expo run:android
bunx expo run:ios
```

## Configuration

Copy `.env.example` to `.env.local` when using owned services.

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_NOWCAST_API_URL` | Base URL for the production nowcast API |
| `EXPO_PUBLIC_RADAR_MANIFEST_URL` | Licensed radar-frame manifest URL |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Android-restricted Google Maps SDK key |
| `EXPO_PUBLIC_OPEN_METEO_HOST` | Evaluation fallback host override |

If no nowcast API is configured, the app uses Open-Meteo's 15-minute numerical forecast as a **Standard** coverage evaluation fallback. That path is not radar nowcasting and its free/open-access terms are not a substitute for a commercial data agreement. Production distribution must configure an owned backend and licensed providers. Android safely shows a no-map state when no Maps key is configured instead of initializing the native Google Maps SDK.

## Quality gates

```bash
bun run check
bunx expo-doctor
bun run export
```

Tests cover rain-event extraction, confidence behavior, alert decisions, and persisted preference validation. See [release checklist](docs/release-checklist.md) for store and operational gates.

## Architecture

The mobile app never contains provider credentials. A production deployment uses:

```text
radar / satellite / stations / NWP
                  ↓
        ingestion + immutable archive
                  ↓
       QC + ensemble nowcast + calibration
                  ↓
          Weathercast point API / tile CDN
                  ↓
             Expo mobile client
```

Read [architecture](docs/architecture.md), [API contract](docs/nowcast-api.md), and [data sourcing](docs/data-sourcing.md).

## Accuracy policy

“Most accurate” is a measured result, not UI copy. Every issued forecast must be archived and verified against independent observations. Public comparisons require a defined region, period, horizon, sample size, and metric. The client therefore shows no fabricated benchmark or uncalibrated numeric confidence score.

## License

MIT. Weather data and map layers retain their own licenses and attribution requirements.
