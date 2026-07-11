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
| `READINESS_REQUIRE_PRECISION_DATA` | Must be `true` in production; gates readiness on local precision inputs |
| `READINESS_RADAR_MAX_AGE_SECONDS` | Maximum age of the newest contiguous MRMS sequence; defaults to `600` |
| `READINESS_OBSERVATION_MAX_AGE_SECONDS` | Maximum age of verified METAR truth; defaults to `7200` |
| `READINESS_MIN_RADAR_FRAMES` | Required contiguous fresh MRMS frames; defaults to `4` |
| `READINESS_MIN_OBSERVATION_STATIONS` | Required distinct fresh verified METAR stations; defaults to `10` |

The upstream must return eight chronological 15-minute intervals plus explicit tier, calibration, resolution, and coverage-reason fields. See [the contract](../docs/nowcast-api.md).

`GET /healthz` is process liveness only. `GET /readyz` performs a database write/delete probe. In production it also requires a fresh, gap-free MRMS sequence and the configured number of distinct recently verified METAR stations. The response exposes only pass/fail component names; source timestamps and infrastructure details remain private. A failed check returns `503` so the orchestrator can stop routing traffic.

## Verification tracer

Independent observations are ingested from a validated JSON array and scored separately from forecast generation:

```bash
DATABASE_PATH=.data/weathercast.sqlite bun run api:ingest-observations server/fixtures/observations.example.json
DATABASE_PATH=.data/weathercast.sqlite bun run api:verify 2026-07-10T12:00:00.000Z brier-v1
```

The first live adapter uses the official AviationWeather Data API for worldwide METAR terminal observations:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
METAR_STATION_IDS=VIDP,VECC,VABB \
WEATHERCAST_USER_AGENT='Weathercast/1.0 contact=ops@weathercast.app' \
bun run api:ingest-metar

DATABASE_PATH=.data/weathercast.sqlite \
NOWCAST_API_URL=http://localhost:8787 \
bun run api:issue-verification-points
```

Run METAR ingestion no more than once per minute. The adapter stores the exact response bytes with a SHA-256 checksum before inserting normalized observations. It uses present-weather rain/drizzle tokens for occurrence truth and converts reported one-hour precipitation from inches to millimetres. METAR truth is explicitly stored at 3,600-second resolution with onset publication disabled, so it can score rain occurrence/Brier reliability but cannot validate minute-scale start or stop claims.

Only observations marked `verified` enter the point-occurrence Brier calculation. This is not silently treated as interval accumulation or onset truth. Repeated source event IDs and repeated verification versions are idempotent. Forecasts, observations, and score versions have SQLite triggers that reject updates and deletes; corrections must be new records. This tracer proves the archive/verification loop but is not yet a publishable accuracy study.

SQLite is a deployable single-instance tracer bullet, not the global production datastore. Multi-region rollout requires Postgres/PostGIS, a content-addressed raw-input object archive, gateway/app attestation, distributed rate limiting, source freshness monitoring, and a verification worker. Precision remains disabled until licensed radar and held-out calibration pass the release gates.

## NOAA MRMS radar tracer

The first authoritative radar adapter ingests NOAA's public operational MRMS CONUS precipitation-rate frames from the Registry of Open Data on AWS. It archives the exact compressed GRIB2 source bytes and immutable frame metadata before downstream decoding:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
MRMS_DOMAIN=CONUS \
MRMS_PRODUCT=PrecipRate_00.00 \
MRMS_FRAME_COUNT=8 \
WEATHERCAST_USER_AGENT='Weathercast/1.0 contact=ops@weathercast.app' \
bun run api:ingest-mrms
```

The job exits non-zero if the newest frame is more than ten minutes old. The strict ecCodes worker validates the operational 7,000 × 3,500, 0.01-degree precipitation-rate grid (discipline 209, category 6, parameter 1) and samples up to 500 coordinates per invocation:

```bash
bun run radar:sample frame.grib2.gz --points points.json
```

`points.json` is a non-empty array of `{ "id", "latitude", "longitude" }` objects. The output unit is `mm/h`. Official MRMS sentinel `-1` is returned as `missing`, and `-3` as `no_coverage`; neither is allowed to become a zero-rain observation. Raw ingestion and point decoding alone do not make a motion nowcast; the shadow worker below adds that baseline while Precision remains gated.

Create and archive a deterministic shadow motion ensemble at an exact CONUS coordinate after at least three fresh frames have been ingested:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
MRMS_NOWCAST_FRAME_COUNT=4 \
MRMS_NOWCAST_MEMBERS=48 \
bun run api:issue-radar-nowcast 34.6441 -86.7862
```

The Bun boundary revalidates the Python output, coordinate, newest source time, interval semantics, and every archived source SHA-256 before saving it. Runs and their relational frame links are append-only. They remain `shadow` and `uncalibrated` and are never served as Precision forecasts.

Score eligible run intervals against later independent verified point observations:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
bun run api:verify-radar 2026-07-10T18:00:00.000Z radar-brier-v1
```

Scores aggregate all matching point observations per run and horizon, exclude provisional/rejected observations, and are immutable per verification version. Observations timestamped before the forecast was issued are excluded even when they follow the newest source frame, preventing retrospective runs from leaking into reported skill. A live pipeline match or a small sample is not an accuracy claim; promotion requires a pre-registered held-out study across seasons, regimes, regions, and dry/wet base rates.

## Prospective radar verification study

The prospective runner freezes the study window, exact ordered station cohort and coordinates, algorithm version, source product, input-frame count, ensemble-member count, 15-minute issuance cadence, scored horizons, primary metric, exclusion policy, and per-horizon sample gate before the first eligible forecast. Start and end times must align to the cadence. The supplied CONUS definition is an example that must be reviewed and registered before its start time:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
METAR_STATION_IDS=KATL,KBOS,KCLT,KDEN,KDFW,KHSV,KIAD,KIAH,KJFK,KLAX,KMCI,KMIA,KMSP,KMSY,KORD,KPHX,KSEA,KSFO,KSLC,KSTL \
WEATHERCAST_USER_AGENT='Weathercast/1.0 contact=ops@weathercast.app' \
bun run api:ingest-metar

for definition in \
  server/fixtures/study.calibration-training.example.json \
  server/fixtures/study.calibration-validation.example.json \
  server/fixtures/study.example.json
do
  DATABASE_PATH=.data/weathercast.sqlite bun run api:register-study "$definition"
done

DATABASE_PATH=.data/weathercast.sqlite \
bun run api:register-calibration server/fixtures/calibration.example.json
```

Keep MRMS ingestion running at its source cadence. Invoke the study runner once in every registered 15-minute window:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
bun run api:issue-radar-study mrms-metar-conus-calibration-training-2026-v1
```

The worker takes frame and ensemble counts only from the immutable registered definition; environment variables cannot change an experiment after registration. It decodes each compressed grid once for the complete cohort, validates the exact target order and source checksums at the Bun boundary, then archives every run and study link in one transaction. It rejects missing targets, changed locations, runtime-parameter drift, mixed source times, stale or gapped frames, late completion, and attempts outside the registered window. Repeating a completed slot is idempotent. Study definitions, coordinates, runs, inputs, and links are protected by append-only database triggers. Legacy schema-v1/v2 studies remain readable for diagnosis, but cannot issue new runs and are permanently ineligible for publication or precision promotion because their runtime parameters were not preregistered. Their report runtime fields are `null`, never inferred defaults.

Registration and issuance establish prospective provenance; they do not by themselves establish accuracy. A public result remains prohibited until the study has ended, the pre-registered sample gate is met at every reported horizon, independent verified observations have been scored, and calibration/reliability results are reported alongside Brier score and base rate.

Create a versioned evidence report at any cutoff:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
bun run api:report-study \
  mrms-metar-conus-calibration-training-2026-v1 \
  2026-08-08T00:00:00.000Z \
  preliminary-week-1
```

Each report uses only study-linked runs and verified `aviation-weather-metar` observations whose `icaoId` belongs to the frozen cohort. For each run and registered horizon it selects at most one observation: the report nearest the interval midpoint, with an earlier timestamp winning a tie. Observations before issuance and at or after the registered study end are excluded. Provisional, rejected, wrong-source, and off-cohort rows never enter the calculation.

Issuance completeness counts only cadence slots containing the entire target cohort. Partial slots are disclosed but cannot contribute forecasts, observations, or completeness. The report includes ten fixed reliability bins, forecast and observation counts, missing-truth counts, mean probability, observed rain rate, and point-occurrence Brier score for every registered horizon. Reports are content-hashed and append-only by version; attempting to reuse a version after evidence changes fails.

`eligibleForPublication` remains false until the study has ended, at least 95% of complete cohort issues exist, and every horizon reaches its pre-registered observation count. Eligibility covers only the model's own point rain-occurrence evidence. It is not a competitor-superiority result and does not promote the uncalibrated shadow model to Precision.

Stored study definitions are versioned. Definitions registered before the report policy existed remain readable and may generate diagnostic output, but always carry `report_policy_not_preregistered` and can never become publication-eligible. The system does not retroactively insert sampling or completeness rules into an older experiment.

## Leakage-safe probability calibration

Calibration uses three disjoint prospective study partitions: training, validation, and untouched evaluation. The calibration plan must be registered before the training partition starts. The archive rejects overlapping or reordered partitions, changed horizons, mismatched algorithms or products, and any plan that references a legacy study without preregistered report rules.

After both training and validation studies end and pass their own publication gates, fit a deterministic per-horizon pool-adjacent-violators isotonic artifact:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
bun run api:fit-calibration \
  mrms-metar-conus-calibration-2026-v1 \
  isotonic-v1 \
  2026-09-29T01:00:00.000Z
```

Fitting uses the exact observation/forecast pairs selected by the evidence-report path. Training data determines monotonic probability blocks. Validation data is not fitted; it gates the artifact. Every horizon needs at least 100 training and 100 validation pairs, no horizon may worsen Brier score, and aggregate validation Brier must improve by at least 0.001. Input samples, plan, evaluation study, artifact, and checksums are content-addressed and immutable.

Bind exactly one passing artifact to the untouched evaluation study before that study starts:

```bash
DATABASE_PATH=.data/weathercast.sqlite \
bun run api:activate-calibration <artifact-id> 2026-09-29T02:00:00.000Z
```

The evaluation runner automatically applies the bound artifact. The archive rejects raw evaluation runs, a different artifact, post-start activation, and provisional calibration in any unbound study. Each provisional interval retains its raw issuance-time probability beside the calibrated probability, allowing a final report to calculate paired raw-versus-calibrated Brier scores without retrospective reconstruction.

Run the evaluation cohort through its full registered period, then create its final report. `eligibleForPrecisionPromotion` opens only when publication gates pass, every calibrated observation has a raw counterfactual, no horizon worsens against raw, and aggregate untouched-holdout Brier improves by the threshold preregistered in the calibration plan. This field covers calibration evidence only. Data rights, production reliability, regional coverage, and store-release gates remain separate requirements.

For ad hoc shadow issuance outside a study, `CALIBRATION_ARTIFACT_ID=<artifact-id>` applies a passing archived artifact. Omit it to retain the uncalibrated baseline.
