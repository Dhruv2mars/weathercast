# Weathercast radar worker

This worker turns three to twelve chronological NOAA MRMS `PrecipRate_00.00` GRIB2 frames into a deterministic, uncalibrated 0–120-minute point nowcast.

## Current shadow algorithm

1. Validate the operational MRMS parameter, grid, scan direction, timestamps, and source checksums.
2. Decode a 513 × 513 local context tile at approximately 1 km spacing without converting missing (`-1`) or no-coverage (`-3`) values to dry weather.
3. Estimate frame-to-frame translation with phase correlation over log rain rates.
4. Use the robust median motion and median-absolute-deviation spread across pairs.
5. Perturb velocity, position, and bounded growth/decay in a deterministic 12–96-member ensemble.
6. Sample the upstream location for each 15-minute period and gradually blend probability toward the observed tile rain frequency as extrapolation skill decays.

The result is always `shadow` and `uncalibrated`. It cannot enable the client’s Precision tier. Phase-correlation translation is a reproducible baseline, not the final model: it cannot fully model storm initiation, dissipation, splitting, merging, rotation, or terrain effects. Promotion requires held-out verification and a stronger multi-scale optical-flow/perturbation ensemble.

## Run

```bash
uv sync --project radar --locked
bun run radar:nowcast \
  frame-1.grib2.gz frame-2.grib2.gz frame-3.grib2.gz frame-4.grib2.gz \
  --latitude 34.6441 --longitude -86.7862 --members 48
```

The command sorts frames by embedded observation time. Its output includes the exact SHA-256 of each input, a deterministic seed, motion diagnostics, explicit coverage status, and eight consecutive 15-minute intervals.

The deployable worker image uses the same lockfile and runs as a non-root user:

```bash
docker build -f Dockerfile.radar -t weathercast-radar .
docker run --rm -v "$PWD/frames:/frames:ro" weathercast-radar \
  /frames/1.grib2.gz /frames/2.grib2.gz /frames/3.grib2.gz \
  --latitude 34.6441 --longitude -86.7862
```
