# Architecture

## Mobile client

Expo Router provides native navigation. TanStack Query manages server state, retries, cancellation, and offline cache behavior. Expo Location supplies explicit foreground location. SQLite-backed local storage persists preferences, saved places, and the most recent successful nowcast. Local notifications schedule an onset reminder from the latest accepted forecast.

## Forecast boundary

`NowcastProvider` is the stable seam. The bundled `OpenMeteoNowcastProvider` supplies worldwide 15-minute numerical guidance without a client secret. Provider output is normalized before product logic derives events, confidence, copy, and alert decisions. A commercial deployment can replace or blend providers without changing screens.

## Production accuracy platform

The repository includes a Bun `/v1/nowcast` boundary. It validates and rate-limits requests, deduplicates simultaneous requests for a location cell, normalizes provider output, and archives the exact response before returning success. Development uses explicitly uncalibrated Open-Meteo evaluation guidance. Production refuses that adapter and requires a server-authenticated normalized upstream.

The service separates liveness from readiness. Readiness proves the archive is writable, validates a contiguous fresh MRMS input sequence, requires a configurable breadth of fresh verified METAR stations, and actively probes the normalized forecast upstream. The authenticated probe is same-origin, timeout-bounded, concurrency-deduplicated, and briefly cached. Production configuration cannot disable precision-data checks or omit this upstream contract. Failures return only component-level pass/fail states and remove the instance from traffic without exposing source timestamps.

The archive also freezes prospective radar-study definitions, coordinates, frame counts, ensemble sizes, cadence slots, source-frame links, versioned evidence reports, calibration plans, isotonic artifacts, and evaluation bindings. Study workers load runtime parameters from that immutable definition, and the archive rejects any response or input sequence that drifts. Reports score only full-cohort issues against one deterministic verified METAR observation per run and horizon. Publication eligibility requires preregistered runtime and report policies, the study to end, at least 95% complete issuance, and every registered sample gate.

Calibration plans freeze disjoint chronological training, validation, and untouched evaluation studies before training starts. Training pairs fit deterministic per-horizon isotonic blocks. Validation pairs gate the immutable artifact. One passing artifact is bound before evaluation begins. Evaluation issues retain both raw and calibrated probabilities, so the final report performs a paired holdout comparison. Model-evidence promotion requires complete raw counterfactual coverage, no per-horizon Brier degradation, and the preregistered aggregate improvement. It does not establish superiority over another provider or satisfy operational and licensing release gates.

The HTTP serving hot path supports a pooled PostgreSQL archive in production, with atomic idempotent forecast writes, immutable records, indexed freshness reads, and a real PostgreSQL CI test. SQLite remains the local default and the scientific study/calibration ledger. Global operation still requires porting ingestion and evidence workers to shared persistence, PostGIS, content-addressed raw-input object storage, licensed radar/satellite/station feeds, provider freshness alarms, distributed cache/rate limiting, and region-aware deployment. No production Precision tier or superiority claim is permitted until those inputs, an independent calibration holdout, and a lawful paired comparison pass their respective gates.

## Privacy

Precise coordinates are requested only after user action. In the bundled provider path they are sent directly to the weather provider to retrieve a forecast. Saved places and preferences remain on-device. No account, advertising identifier, contact list, background location, or continuous location tracking is used.
