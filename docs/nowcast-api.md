# Nowcast API contract

The app calls `POST /v1/nowcast` with `{ "latitude": 28.6139, "longitude": 77.209 }`. Keeping coordinates in the JSON body prevents normal proxy access logs from recording a user's exact location in a URL. Development retains GET compatibility; production rejects GET with `405`. The owned Bun service validates coordinates, rate-limits abuse, keeps upstream secrets server-side, archives every successful payload, and responds with JSON matching this v1 compatibility contract.

```json
{
  "schemaVersion": 1,
  "forecastId": "cad9158cfc5f1ad2bda34707",
  "issuedAt": "2026-07-10T08:00:00.000Z",
  "generatedAt": "2026-07-10T08:00:04.000Z",
  "validUntil": "2026-07-10T08:04:04.000Z",
  "timezone": "Asia/Kolkata",
  "sourceDataTime": null,
  "status": "incoming",
  "headline": "Rain likely in 15–25 minutes",
  "detail": "Moderate rain may last about 45 minutes.",
  "clearMinutes": 20,
  "intervals": [
    {
      "time": "2026-07-10T08:00:00.000Z",
      "precipitationMm": 0,
      "rainMm": 0,
      "showersMm": 0,
      "probability": 20,
      "weatherCode": 2
    }
  ],
  "confidence": {
    "score": 82,
    "label": "high",
    "explanation": "Radar and ensemble members agree on arrival timing."
  },
  "dataTier": "precision",
  "calibrationStatus": "calibrated",
  "coverage": {
    "reason": "Current radar and verified regional calibration are available.",
    "spatialResolutionKm": 1
  },
  "source": "Weathercast calibrated radar ensemble",
  "event": {
    "startTime": "2026-07-10T08:20:00.000Z",
    "endTime": "2026-07-10T09:05:00.000Z",
    "onsetWindowStart": "2026-07-10T08:15:00.000Z",
    "onsetWindowEnd": "2026-07-10T08:25:00.000Z",
    "peakIntensity": "moderate",
    "peakMm": 1.2,
    "durationMinutes": 45
  }
}
```

## Semantics

- Times are ISO 8601 UTC instants.
- Exactly eight half-open 15-minute intervals cover 0–120 minutes. Intervals are unique and chronological.
- `probability` is calibrated rain occurrence probability from 0–100.
- `confidence.score` is internal calibration output. The client displays the label until reliability curves are independently verified.
- `dataTier` is `precision` for radar + dense observations, `enhanced` for satellite/regional data, or `standard` for global/numerical guidance.
- `calibrationStatus` is explicit. Evaluation/model-only output is `uncalibrated`, is forced to Low confidence, and never claims Precision.
- `sourceDataTime: null` means the provider did not expose a trustworthy model/source issue timestamp. `generatedAt` must not be represented as source freshness.
- `event` is null when no qualifying rain event is found.
- Responses are immutable by issue time and archived server-side for verification.

Successful responses include `ETag`, `X-Forecast-ID`, `X-Data-Tier`, `X-Issued-At`, and `X-Request-ID`. `If-None-Match` returns `304` for an unchanged issue. The service returns `200` only after the exact response has been committed to its archive.

## Production upstream contract

`NOWCAST_PROVIDER_MODE=normalized-upstream` requires a server-only URL and bearer token. The upstream returns the normalized forecast fields plus:

```json
{
  "upstreamRunId": "model-run-20260710T0755Z",
  "dataTier": "standard",
  "calibrationStatus": "uncalibrated",
  "spatialResolutionKm": 9,
  "coverageReason": "Numerical guidance only."
}
```

The process refuses to boot in production with the Open-Meteo evaluation adapter or wildcard CORS. Precision remains a release-gated tier; the contract alone cannot create accuracy.

Invalid or partial responses are rejected by the client. Use standard HTTP status codes, a stable error code, and a non-sensitive message for failures.
