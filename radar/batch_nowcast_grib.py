#!/usr/bin/env python3
"""Create shadow MRMS nowcasts for up to twenty pre-registered targets in one decode pass."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import eccodes

from motion_nowcast import MrmsMotionError
from nowcast_grib import Target, build_grib_nowcasts
from sample_grib import MrmsDecodeError


def load_targets(path: Path) -> list[Target]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise MrmsDecodeError("Batch target file is not valid JSON.") from error
    if not isinstance(payload, list):
        raise MrmsDecodeError("Batch target file must be a JSON array.")
    targets: list[Target] = []
    for index, value in enumerate(payload):
        if not isinstance(value, dict):
            raise MrmsDecodeError(f"Batch target {index} must be an object.")
        identifier = value.get("id")
        latitude = value.get("latitude")
        longitude = value.get("longitude")
        if not isinstance(identifier, str):
            raise MrmsDecodeError(f"Batch target {index} has an invalid id.")
        if isinstance(latitude, bool) or not isinstance(latitude, (int, float)):
            raise MrmsDecodeError(f"Batch target {identifier!r} has an invalid latitude.")
        if isinstance(longitude, bool) or not isinstance(longitude, (int, float)):
            raise MrmsDecodeError(f"Batch target {identifier!r} has an invalid longitude.")
        targets.append(Target(identifier, float(latitude), float(longitude)))
    return targets


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", nargs="+", type=Path, help="Three to twelve .grib2.gz paths")
    parser.add_argument("--targets", required=True, type=Path)
    parser.add_argument("--members", type=int, default=24)
    args = parser.parse_args()
    try:
        runs = build_grib_nowcasts(args.frames, load_targets(args.targets), args.members)
        json.dump({"schemaVersion": 1, "runs": runs}, sys.stdout, separators=(",", ":"), allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except (MrmsDecodeError, MrmsMotionError, OSError, eccodes.CodesInternalError) as error:
        print(f"MRMS batch nowcast failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
