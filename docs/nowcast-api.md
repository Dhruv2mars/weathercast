# Nowcast API contract

The app calls `GET /v1/nowcast?latitude={decimal}&longitude={decimal}`. The service must authenticate clients at the gateway, rate-limit abuse, keep upstream secrets server-side, and respond with JSON matching this contract.

```json
{
  "issuedAt": "2026-07-10T08:00:00.000Z",
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
- Intervals cover now through 120 minutes and remain chronological.
- `probability` is calibrated rain occurrence probability from 0–100.
- `confidence.score` is internal calibration output. The client displays the label until reliability curves are independently verified.
- `dataTier` is `precision` for radar + dense observations, `enhanced` for satellite/regional data, or `standard` for global/numerical guidance.
- `event` is null when no qualifying rain event is found.
- Responses are immutable by issue time and archived server-side for verification.

Invalid or partial responses are rejected by the client. Use standard HTTP status codes, a stable error code, and a non-sensitive message for failures.
