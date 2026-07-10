# Weathercast API

The Bun service is the owned forecast boundary used by the Expo client. It validates coordinates, deduplicates concurrent requests by a roughly 11-metre location cell, rate-limits callers, derives the v1 rain event, and writes the exact response to an append-only SQLite archive before returning `200`.

## Local evaluation

```bash
bun run api
curl -H 'Content-Type: application/json' \
  -d '{"latitude":28.6139,"longitude":77.2090}' \
  http://localhost:8787/v1/nowcast
```

The default adapter is Open-Meteo evaluation guidance. It is always marked `standard` and `uncalibrated`; the API forces a low-confidence label. The process refuses to start in production with this adapter.

Production accepts location only in a POST body, so ordinary access logs do not capture exact coordinates in query strings. The archive stores only a four-decimal forecast cell, not an account or request history.

## Production configuration

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | Must be `production` in production |
| `PORT` | HTTP port; defaults to `8787` |
| `DATABASE_PATH` | Forecast archive path; mount durable storage |
| `NOWCAST_PROVIDER_MODE` | `normalized-upstream` in production |
| `NORMALIZED_UPSTREAM_URL` | HTTPS licensed/provider blender endpoint |
| `NORMALIZED_UPSTREAM_TOKEN` | Server-only bearer credential |
| `CORS_ORIGIN` | Explicit web-app origin in production |
| `RATE_LIMIT_PER_MINUTE` | Per gateway-supplied client IP |
| `FORECAST_CACHE_SECONDS` | Immutable issue reuse window |
| `UPSTREAM_TIMEOUT_MS` | Source deadline |

The upstream must return eight chronological 15-minute intervals plus explicit tier, calibration, resolution, and coverage-reason fields. See [the contract](../docs/nowcast-api.md).

## Verification tracer

Independent observations are ingested from a validated JSON array and scored separately from forecast generation:

```bash
DATABASE_PATH=.data/weathercast.sqlite bun run api:ingest-observations server/fixtures/observations.example.json
DATABASE_PATH=.data/weathercast.sqlite bun run api:verify 2026-07-10T12:00:00.000Z brier-v1
```

Only observations marked `verified` enter the Brier calculation. Repeated source event IDs and repeated verification versions are idempotent. Forecasts, observations, and score versions have SQLite triggers that reject updates and deletes; corrections must be new records. This tracer proves the archive/verification loop but is not yet a publishable accuracy study.

SQLite is a deployable single-instance tracer bullet, not the global production datastore. Multi-region rollout requires Postgres/PostGIS, a content-addressed raw-input object archive, gateway/app attestation, distributed rate limiting, source freshness monitoring, and a verification worker. Precision remains disabled until licensed radar and held-out calibration pass the release gates.
