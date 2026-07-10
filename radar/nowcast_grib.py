#!/usr/bin/env python3
"""Create an uncalibrated 0–120 minute point nowcast from chronological MRMS frames."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import eccodes
import numpy as np

from motion_nowcast import Frame, MrmsMotionError, point_nowcast
from sample_grib import MrmsDecodeError, decode_gzip, observed_at, validate_metadata

TILE_HALF_SIZE = 256


def grid_index(latitude: float, longitude: float, metadata: dict[str, int | float]) -> tuple[int, int]:
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise MrmsDecodeError("Target is outside valid coordinates.")
    if any(
        int(metadata[key]) != expected
        for key, expected in (
            ("iScansNegatively", 0),
            ("jScansPositively", 0),
            ("jPointsAreConsecutive", 0),
            ("alternativeRowScanning", 0),
        )
    ):
        raise MrmsDecodeError("MRMS scanning mode is unsupported.")
    longitude_360 = longitude % 360
    first_latitude = float(metadata["latitudeOfFirstGridPointInDegrees"])
    first_longitude = float(metadata["longitudeOfFirstGridPointInDegrees"])
    latitude_increment = float(metadata["jDirectionIncrementInDegrees"])
    longitude_increment = float(metadata["iDirectionIncrementInDegrees"])
    row = int(round((first_latitude - latitude) / latitude_increment))
    column = int(round((longitude_360 - first_longitude) / longitude_increment))
    if not 0 <= row < int(metadata["Nj"]) or not 0 <= column < int(metadata["Ni"]):
        raise MrmsDecodeError("Target is outside the MRMS CONUS grid.")
    return row, column


def normalize_tile(tile: np.ndarray) -> np.ndarray:
    normalized = tile.astype(np.float64, copy=True)
    unknown = np.isclose(normalized, -1, atol=1e-6) | np.isclose(normalized, -3, atol=1e-6)
    normalized[unknown] = np.nan
    invalid = np.isfinite(normalized) & (normalized < 0)
    if np.any(invalid):
        raise MrmsDecodeError("MRMS tile contains an unsupported negative rain rate.")
    return normalized


def extract_frame(path: Path, latitude: float, longitude: float, half_size: int) -> tuple[Frame, str, float]:
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix="weathercast-motion-") as temporary:
        decoded = Path(temporary) / "frame.grib2"
        decode_gzip(path, decoded)
        with decoded.open("rb") as source:
            handle = eccodes.codes_grib_new_from_file(source)
            if handle is None:
                raise MrmsDecodeError("Input does not contain a GRIB message.")
            try:
                keys = (
                    "discipline",
                    "parameterCategory",
                    "parameterNumber",
                    "Ni",
                    "Nj",
                    "iDirectionIncrementInDegrees",
                    "jDirectionIncrementInDegrees",
                    "iScansNegatively",
                    "jScansPositively",
                    "jPointsAreConsecutive",
                    "alternativeRowScanning",
                    "latitudeOfFirstGridPointInDegrees",
                    "longitudeOfFirstGridPointInDegrees",
                )
                metadata = {key: eccodes.codes_get(handle, key) for key in keys}
                validate_metadata(metadata)
                row, column = grid_index(latitude, longitude, metadata)
                if (
                    row - half_size < 0
                    or column - half_size < 0
                    or row + half_size >= int(metadata["Nj"])
                    or column + half_size >= int(metadata["Ni"])
                ):
                    raise MrmsDecodeError("Target lacks the full radar context tile required for 120 minutes.")
                values = eccodes.codes_get_values(handle).reshape(int(metadata["Nj"]), int(metadata["Ni"]))
                tile = normalize_tile(
                    values[
                        row - half_size : row + half_size + 1,
                        column - half_size : column + half_size + 1,
                    ]
                )
                coverage = float(np.mean(np.isfinite(tile)))
                timestamp = observed_at(
                    int(eccodes.codes_get(handle, "dataDate")),
                    int(eccodes.codes_get(handle, "dataTime")),
                )
                return Frame(datetime.fromisoformat(timestamp.replace("Z", "+00:00")), tile), checksum, coverage
            finally:
                eccodes.codes_release(handle)


def build_grib_nowcast(
    paths: list[Path],
    latitude: float,
    longitude: float,
    members: int,
    half_size: int = TILE_HALF_SIZE,
) -> dict[str, Any]:
    if len(paths) < 3 or len(paths) > 12:
        raise MrmsDecodeError("From three through twelve MRMS frames are required.")
    extracted = [extract_frame(path, latitude, longitude, half_size) for path in paths]
    ordered = sorted(extracted, key=lambda item: item[0].observedAt)
    if len({item[0].observedAt for item in ordered}) != len(ordered):
        raise MrmsDecodeError("MRMS frame timestamps must be unique.")
    checksums = [item[1] for item in ordered]
    seed_material = json.dumps(
        {"checksums": checksums, "latitude": round(latitude, 4), "longitude": round(longitude, 4)},
        separators=(",", ":"),
    )
    seed = int(hashlib.sha256(seed_material.encode()).hexdigest()[:16], 16)
    result = point_nowcast(
        [item[0] for item in ordered],
        center=(half_size, half_size),
        seed=seed,
        members=members,
    )
    result.update(
        {
            "location": {"latitude": round(latitude, 4), "longitude": round(longitude, 4)},
            "inputSha256": checksums,
            "coverage": {
                "tier": "shadow",
                "minimumTileFraction": round(min(item[2] for item in ordered), 6),
                "spatialResolutionKm": 1,
                "reason": "Uncalibrated MRMS translation ensemble; not eligible for public Precision coverage.",
            },
        }
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", nargs="+", type=Path, help="Three to twelve .grib2.gz paths")
    parser.add_argument("--latitude", required=True, type=float)
    parser.add_argument("--longitude", required=True, type=float)
    parser.add_argument("--members", type=int, default=24)
    args = parser.parse_args()
    try:
        result = build_grib_nowcast(args.frames, args.latitude, args.longitude, args.members)
        json.dump(result, sys.stdout, separators=(",", ":"), allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except (MrmsDecodeError, MrmsMotionError, OSError, eccodes.CodesInternalError) as error:
        print(f"MRMS nowcast failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
