#!/usr/bin/env python3
"""Decode NOAA MRMS rain-rate samples without converting unknowns to dry weather."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import eccodes

EXPECTED_DISCIPLINE = 209
EXPECTED_CATEGORY = 6
EXPECTED_PARAMETER = 1
EXPECTED_NI = 7000
EXPECTED_NJ = 3500
EXPECTED_INCREMENT_DEGREES = 0.01


class MrmsDecodeError(ValueError):
    """Raised when an input is not the supported operational MRMS product."""


@dataclass(frozen=True)
class Point:
    id: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class Sample:
    id: str
    requestedLatitude: float
    requestedLongitude: float
    gridLatitude: float
    gridLongitude: float
    distanceKm: float
    status: Literal["valid", "missing", "no_coverage"]
    valueMmPerHour: float | None


def classify_rain_rate(value: float) -> tuple[str, float | None]:
    if math.isclose(value, -1.0, abs_tol=1e-6):
        return "missing", None
    if math.isclose(value, -3.0, abs_tol=1e-6):
        return "no_coverage", None
    if not math.isfinite(value) or value < 0:
        raise MrmsDecodeError(f"Unsupported MRMS precipitation-rate value: {value!r}.")
    return "valid", value


def observed_at(data_date: int, data_time: int) -> str:
    raw_time = f"{data_time:04d}"
    instant = datetime.strptime(f"{data_date}{raw_time}", "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
    return instant.isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_metadata(metadata: dict[str, int | float]) -> None:
    exact = {
        "discipline": EXPECTED_DISCIPLINE,
        "parameterCategory": EXPECTED_CATEGORY,
        "parameterNumber": EXPECTED_PARAMETER,
        "Ni": EXPECTED_NI,
        "Nj": EXPECTED_NJ,
    }
    for key, expected in exact.items():
        if metadata[key] != expected:
            raise MrmsDecodeError(f"Unexpected {key}: {metadata[key]!r}; expected {expected!r}.")
    for key in ("iDirectionIncrementInDegrees", "jDirectionIncrementInDegrees"):
        actual = float(metadata[key])
        if not math.isclose(actual, EXPECTED_INCREMENT_DEGREES, abs_tol=1e-9):
            raise MrmsDecodeError(
                f"Unexpected {key}: {actual!r}; expected {EXPECTED_INCREMENT_DEGREES!r}."
            )


def parse_points(payload: Any) -> list[Point]:
    if not isinstance(payload, list) or not payload:
        raise MrmsDecodeError("Points must be a non-empty JSON array.")
    if len(payload) > 500:
        raise MrmsDecodeError("At most 500 points can be sampled per request.")
    points: list[Point] = []
    seen: set[str] = set()
    for index, raw in enumerate(payload):
        if not isinstance(raw, dict):
            raise MrmsDecodeError(f"Point {index} must be an object.")
        identifier = raw.get("id")
        latitude = raw.get("latitude")
        longitude = raw.get("longitude")
        if not isinstance(identifier, str) or not identifier or len(identifier) > 128:
            raise MrmsDecodeError(f"Point {index} has an invalid id.")
        if identifier in seen:
            raise MrmsDecodeError(f"Point id is duplicated: {identifier!r}.")
        if isinstance(latitude, bool) or not isinstance(latitude, (int, float)) or not math.isfinite(latitude):
            raise MrmsDecodeError(f"Point {identifier!r} has an invalid latitude.")
        if isinstance(longitude, bool) or not isinstance(longitude, (int, float)) or not math.isfinite(longitude):
            raise MrmsDecodeError(f"Point {identifier!r} has an invalid longitude.")
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise MrmsDecodeError(f"Point {identifier!r} is outside valid coordinates.")
        seen.add(identifier)
        points.append(Point(identifier, float(latitude), float(longitude)))
    return points


def sample_grib(grib_path: Path, points: list[Point]) -> dict[str, Any]:
    with grib_path.open("rb") as source:
        handle = eccodes.codes_grib_new_from_file(source)
        if handle is None:
            raise MrmsDecodeError("Input does not contain a GRIB message.")
        try:
            metadata = {
                key: eccodes.codes_get(handle, key)
                for key in (
                    "discipline",
                    "parameterCategory",
                    "parameterNumber",
                    "Ni",
                    "Nj",
                    "iDirectionIncrementInDegrees",
                    "jDirectionIncrementInDegrees",
                )
            }
            validate_metadata(metadata)
            samples: list[Sample] = []
            for point in points:
                nearest = eccodes.codes_grib_find_nearest(handle, point.latitude, point.longitude)[0]
                status, rain_rate = classify_rain_rate(float(nearest.value))
                grid_longitude = float(nearest.lon)
                if grid_longitude > 180:
                    grid_longitude -= 360
                samples.append(
                    Sample(
                        id=point.id,
                        requestedLatitude=point.latitude,
                        requestedLongitude=point.longitude,
                        gridLatitude=float(nearest.lat),
                        gridLongitude=grid_longitude,
                        distanceKm=float(nearest.distance),
                        status=status,
                        valueMmPerHour=rain_rate,
                    )
                )
            return {
                "schemaVersion": 1,
                "source": "noaa-mrms-nodd",
                "domain": "CONUS",
                "product": "PrecipRate_00.00",
                "unit": "mm/h",
                "observedAt": observed_at(
                    int(eccodes.codes_get(handle, "dataDate")),
                    int(eccodes.codes_get(handle, "dataTime")),
                ),
                "grid": {
                    "columns": int(metadata["Ni"]),
                    "rows": int(metadata["Nj"]),
                    "resolutionDegrees": EXPECTED_INCREMENT_DEGREES,
                },
                "samples": [asdict(sample) for sample in samples],
            }
        finally:
            eccodes.codes_release(handle)


def decode_gzip(input_path: Path, output_path: Path) -> None:
    if input_path.stat().st_size > 10_000_000:
        raise MrmsDecodeError("Compressed MRMS frame exceeds 10 MB.")
    total = 0
    with gzip.open(input_path, "rb") as source, output_path.open("wb") as destination:
        while chunk := source.read(1024 * 1024):
            total += len(chunk)
            if total > 100_000_000:
                raise MrmsDecodeError("Decoded MRMS frame exceeds 100 MB.")
            destination.write(chunk)
    with output_path.open("rb") as decoded:
        if decoded.read(4) != b"GRIB":
            raise MrmsDecodeError("Decoded payload is not GRIB data.")


def load_points(argument: str) -> list[Point]:
    raw = sys.stdin.read() if argument == "-" else Path(argument).read_text(encoding="utf-8")
    try:
        return parse_points(json.loads(raw))
    except json.JSONDecodeError as error:
        raise MrmsDecodeError("Points payload is not valid JSON.") from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frame", type=Path, help="Path to an MRMS .grib2.gz frame")
    parser.add_argument("--points", required=True, help="Points JSON path, or - for stdin")
    args = parser.parse_args()
    try:
        points = load_points(args.points)
        with tempfile.TemporaryDirectory(prefix="weathercast-mrms-") as temporary:
            decoded = Path(temporary) / "frame.grib2"
            decode_gzip(args.frame, decoded)
            json.dump(sample_grib(decoded, points), sys.stdout, separators=(",", ":"), allow_nan=False)
            sys.stdout.write("\n")
        return 0
    except (MrmsDecodeError, OSError, eccodes.CodesInternalError) as error:
        print(f"MRMS decode failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
