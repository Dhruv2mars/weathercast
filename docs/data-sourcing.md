# Production data sourcing

Weathercast's accuracy comes from owned calibration and verification, not from renaming a consumer forecast API.

## Required platform

1. Ingest licensed radar, satellite, stations, lightning, and numerical guidance.
2. Preserve raw inputs and every issued forecast immutably.
3. Quality-control observations and radar artifacts.
4. Run a probabilistic extrapolation ensemble, then blend into NWP as lead time grows.
5. Calibrate occurrence and timing by radar, locality, season, regime, and horizon.
6. Verify forecasts against independent observations before making accuracy claims.

## Candidate authoritative sources

- India: [IMD API reference](https://api.imd.gov.in/public/api_reference.html), [IMD API portal](https://mausam.imd.gov.in/responsive/apis.php), and licensed Doppler radar products
- United States: [NOAA MRMS](https://registry.opendata.aws/noaa-mrms-pds/), [NEXRAD Level II](https://registry.opendata.aws/noaa-nexrad/), and [GOES](https://registry.opendata.aws/noaa-goes/)
- Germany: [DWD open radar](https://opendata.dwd.de/weather/radar/) under the [DWD legal notice](https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html)
- United Kingdom: [Met Office Weather DataHub](https://datahub.metoffice.gov.uk/support/faqs)
- Global numerical guidance: [ECMWF open real-time catalogue](https://www.ecmwf.int/en/about/media-centre/news/2025/ecmwf-makes-its-entire-real-time-catalogue-open-all)
- Surface observations: [Aviation Weather Center Data API](https://aviationweather.gov/data/api/). Weathercast ingests worldwide METAR JSON through a server-side adapter, content-addresses the raw bytes, and uses the reports only for coarse rain-occurrence verification. The documented API limit is 100 requests/minute, callers should use a custom User-Agent, and bulk queries should prefer the routinely updated cache files.

Coverage and redistribution rights vary by product. Legal review, written commercial rights, attribution, retention rules, service-level objectives, and outage fallbacks are release gates for each region.

METAR is not hyperlocal truth: stations are sparse, normal reporting is commonly hourly, and present-weather reports cannot validate a ±5-minute onset claim. Precision calibration still requires radar and denser independent gauges with known measurement periods and quality flags.

## Explicit exclusions

- RainViewer's free API is not a commercial production foundation and does not provide the required future nowcast path.
- Google Weather data cannot be archived or used to recreate a competing weather service under its published API restrictions.
- Public numerical guidance alone must be labeled Standard coverage; it cannot support a hyperlocal radar claim.

## Initial model baseline

Use radar QC, optical flow, and a 24–48 member STEPS-style ensemble for 0–120 minutes, blending toward regional NWP as extrapolation skill falls. Train neural models only after the immutable regional archive and verification pipeline are large enough to support reproducible evaluation.
