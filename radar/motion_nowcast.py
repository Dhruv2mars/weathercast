"""Deterministic, uncalibrated MRMS translation-ensemble point nowcasting."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import numpy as np
from numpy.typing import NDArray

RAIN_THRESHOLD_MM_HOUR = 0.1
MAX_RATE_MM_HOUR = 300.0
ALGORITHM_VERSION = "translation-ensemble-v1"


def utc_string(instant: datetime) -> str:
    return instant.isoformat().replace("+00:00", "Z")


class MrmsMotionError(ValueError):
    """Raised when radar frames cannot support an honest motion nowcast."""


@dataclass(frozen=True)
class Frame:
    observedAt: datetime
    rainRate: NDArray[np.float64]


@dataclass(frozen=True)
class Translation:
    rowPixels: float
    columnPixels: float
    signal: float


def _subpixel_offset(left: float, center: float, right: float) -> float:
    denominator = left - 2 * center + right
    if abs(denominator) < 1e-12:
        return 0.0
    return float(np.clip(0.5 * (left - right) / denominator, -0.5, 0.5))


def _overlap_for_shift(
    previous: NDArray[np.float64], current: NDArray[np.float64], row: int, column: int
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    previous_rows = slice(max(0, -row), min(previous.shape[0], previous.shape[0] - row))
    current_rows = slice(max(0, row), min(current.shape[0], current.shape[0] + row))
    previous_columns = slice(max(0, -column), min(previous.shape[1], previous.shape[1] - column))
    current_columns = slice(max(0, column), min(current.shape[1], current.shape[1] + column))
    return previous[previous_rows, previous_columns], current[current_rows, current_columns]


def estimate_translation(previous: NDArray[np.float64], current: NDArray[np.float64]) -> Translation:
    if previous.shape != current.shape or previous.ndim != 2:
        raise MrmsMotionError("Radar motion requires same-shaped two-dimensional frames.")
    valid = np.isfinite(previous) & np.isfinite(current)
    if np.mean(valid) < 0.6:
        raise MrmsMotionError("Radar motion has insufficient overlapping coverage.")
    echo = valid & ((previous >= RAIN_THRESHOLD_MM_HOUR) | (current >= RAIN_THRESHOLD_MM_HOUR))
    if np.count_nonzero(echo) < 16:
        raise MrmsMotionError("Radar motion has insufficient precipitation echo.")

    first = np.where(valid, np.log1p(np.maximum(previous, 0)), 0.0)
    second = np.where(valid, np.log1p(np.maximum(current, 0)), 0.0)
    window = np.outer(np.hanning(previous.shape[0]), np.hanning(previous.shape[1]))
    first = (first - np.mean(first[valid])) * window
    second = (second - np.mean(second[valid])) * window
    cross_power = np.fft.fft2(second) * np.conj(np.fft.fft2(first))
    magnitude = np.abs(cross_power)
    cross_power /= np.where(magnitude > 1e-12, magnitude, 1.0)
    correlation = np.abs(np.fft.ifft2(cross_power))
    peak_row, peak_column = np.unravel_index(np.argmax(correlation), correlation.shape)

    row = float(peak_row if peak_row <= previous.shape[0] // 2 else peak_row - previous.shape[0])
    column = float(
        peak_column if peak_column <= previous.shape[1] // 2 else peak_column - previous.shape[1]
    )
    row += _subpixel_offset(
        correlation[(peak_row - 1) % correlation.shape[0], peak_column],
        correlation[peak_row, peak_column],
        correlation[(peak_row + 1) % correlation.shape[0], peak_column],
    )
    column += _subpixel_offset(
        correlation[peak_row, (peak_column - 1) % correlation.shape[1]],
        correlation[peak_row, peak_column],
        correlation[peak_row, (peak_column + 1) % correlation.shape[1]],
    )
    aligned_previous, aligned_current = _overlap_for_shift(
        previous, current, int(round(row)), int(round(column))
    )
    aligned_valid = np.isfinite(aligned_previous) & np.isfinite(aligned_current)
    aligned_echo = aligned_valid & (
        (aligned_previous >= RAIN_THRESHOLD_MM_HOUR) | (aligned_current >= RAIN_THRESHOLD_MM_HOUR)
    )
    if np.count_nonzero(aligned_echo) < 16:
        signal = 0.0
    else:
        previous_echo = np.log1p(np.maximum(aligned_previous[aligned_echo], 0))
        current_echo = np.log1p(np.maximum(aligned_current[aligned_echo], 0))
        if np.std(previous_echo) < 1e-9 or np.std(current_echo) < 1e-9:
            signal = 0.0
        else:
            signal = float(np.clip(np.corrcoef(previous_echo, current_echo)[0, 1], 0, 1))
    return Translation(rowPixels=row, columnPixels=column, signal=signal)


def bilinear_sample(field: NDArray[np.float64], row: float, column: float) -> float | None:
    if row < 0 or column < 0 or row > field.shape[0] - 1 or column > field.shape[1] - 1:
        return None
    low_row = int(math.floor(row))
    low_column = int(math.floor(column))
    high_row = min(low_row + 1, field.shape[0] - 1)
    high_column = min(low_column + 1, field.shape[1] - 1)
    values = np.array(
        [
            field[low_row, low_column],
            field[low_row, high_column],
            field[high_row, low_column],
            field[high_row, high_column],
        ],
        dtype=float,
    )
    if not np.all(np.isfinite(values)):
        return None
    row_fraction = row - low_row
    column_fraction = column - low_column
    top = values[0] * (1 - column_fraction) + values[1] * column_fraction
    bottom = values[2] * (1 - column_fraction) + values[3] * column_fraction
    return float(top * (1 - row_fraction) + bottom * row_fraction)


def _validate_frames(frames: list[Frame], center: tuple[int, int]) -> list[float]:
    if len(frames) < 3:
        raise MrmsMotionError("At least three chronological radar frames are required.")
    if any(frame.observedAt.utcoffset() is None for frame in frames):
        raise MrmsMotionError("Radar frame timestamps must be timezone-aware.")
    shape = frames[0].rainRate.shape
    if len(shape) != 2 or any(frame.rainRate.shape != shape for frame in frames):
        raise MrmsMotionError("Radar frames must use one consistent two-dimensional tile.")
    if not 0 <= center[0] < shape[0] or not 0 <= center[1] < shape[1]:
        raise MrmsMotionError("Nowcast centre is outside the radar tile.")
    neighborhood = frames[-1].rainRate[
        max(0, center[0] - 2) : center[0] + 3,
        max(0, center[1] - 2) : center[1] + 3,
    ]
    if not np.any(np.isfinite(neighborhood)):
        raise MrmsMotionError("Radar coverage is unavailable at the target.")
    spacing: list[float] = []
    for previous, current in zip(frames[:-1], frames[1:], strict=True):
        minutes = (current.observedAt - previous.observedAt).total_seconds() / 60
        if minutes < 1 or minutes > 5:
            raise MrmsMotionError("Radar frame spacing must be from one through five minutes.")
        spacing.append(minutes)
    return spacing


def _growth_rate(frames: list[Frame], spacing: list[float]) -> float:
    estimates: list[float] = []
    for previous, current, minutes in zip(frames[:-1], frames[1:], spacing, strict=True):
        previous_mass = float(np.nansum(np.maximum(previous.rainRate, 0)))
        current_mass = float(np.nansum(np.maximum(current.rainRate, 0)))
        if previous_mass > 1 and current_mass > 1:
            estimates.append(math.log(current_mass / previous_mass) / minutes)
    return float(np.clip(np.median(estimates) if estimates else 0, -0.015, 0.015))


def point_nowcast(
    frames: list[Frame],
    center: tuple[int, int],
    seed: int,
    members: int = 24,
) -> dict[str, Any]:
    if members < 12 or members > 96:
        raise MrmsMotionError("Ensemble size must be from 12 through 96 members.")
    if seed < 0 or seed >= 2**64:
        raise MrmsMotionError("Ensemble seed must be an unsigned 64-bit integer.")
    spacing = _validate_frames(frames, center)
    translation_samples: list[tuple[Translation, float]] = []
    for previous, current, minutes in zip(frames[:-1], frames[1:], spacing, strict=True):
        try:
            translation = estimate_translation(previous.rainRate, current.rainRate)
            if translation.signal >= 0.2:
                translation_samples.append((translation, minutes))
        except MrmsMotionError as error:
            if "echo" not in str(error):
                raise

    if translation_samples:
        row_velocity_samples = np.array(
            [translation.rowPixels / minutes for translation, minutes in translation_samples]
        )
        column_velocity_samples = np.array(
            [translation.columnPixels / minutes for translation, minutes in translation_samples]
        )
        row_velocity = float(np.median(row_velocity_samples))
        column_velocity = float(np.median(column_velocity_samples))
        motion_signal = float(np.mean([translation.signal for translation, _ in translation_samples]))
        row_mad = float(np.median(np.abs(row_velocity_samples - row_velocity))) * 1.4826
        column_mad = float(np.median(np.abs(column_velocity_samples - column_velocity))) * 1.4826
        minimum_spread = 0.2 if len(translation_samples) == 1 else 0.08
        spread = max(minimum_spread, row_mad, column_mad, math.hypot(row_velocity, column_velocity) * 0.2)
        motion_status = "estimated"
    else:
        row_velocity = 0.0
        column_velocity = 0.0
        motion_signal = 0.0
        spread = 0.08
        motion_status = "insufficient_echo"

    if math.hypot(row_velocity, column_velocity) > 2.0:
        raise MrmsMotionError("Estimated radar motion exceeds 120 km/h and is rejected.")
    latest = frames[-1].rainRate
    finite = np.isfinite(latest)
    background_probability = float(
        np.count_nonzero(finite & (latest >= RAIN_THRESHOLD_MM_HOUR)) / max(1, np.count_nonzero(finite))
    )
    growth = _growth_rate(frames, spacing)
    rng = np.random.default_rng(seed)
    member_rows = rng.normal(row_velocity, spread, size=members)
    member_columns = rng.normal(column_velocity, spread, size=members)
    member_growth = rng.normal(growth, 0.003, size=members)
    member_offsets = rng.normal(0, 0.35, size=(members, 2))

    intervals: list[dict[str, Any]] = []
    source_time = frames[-1].observedAt
    for index in range(8):
        lead_start = index * 15
        lead_end = lead_start + 15
        lead = lead_start + 7.5
        rates: list[float] = []
        for member in range(members):
            source_row = center[0] - member_rows[member] * lead + member_offsets[member, 0]
            source_column = center[1] - member_columns[member] * lead + member_offsets[member, 1]
            sampled = bilinear_sample(latest, source_row, source_column)
            if sampled is not None:
                rates.append(float(np.clip(sampled * math.exp(member_growth[member] * lead), 0, MAX_RATE_MM_HOUR)))
        if len(rates) < math.ceil(members * 0.5):
            intervals.append(
                {
                    "leadStartMinutes": lead_start,
                    "leadEndMinutes": lead_end,
                    "validAt": utc_string(source_time + timedelta(minutes=lead)),
                    "status": "no_coverage",
                    "probability": None,
                    "rainRateMmPerHour": None,
                }
            )
            continue
        ensemble_probability = float(np.mean(np.asarray(rates) >= RAIN_THRESHOLD_MM_HOUR))
        loss_of_skill = min(0.55, lead / 120 * 0.55)
        probability = ensemble_probability * (1 - loss_of_skill) + background_probability * loss_of_skill
        rainy_rates = [rate for rate in rates if rate >= RAIN_THRESHOLD_MM_HOUR]
        representative_rate = float(np.median(rainy_rates)) if rainy_rates else 0.0
        intervals.append(
            {
                "leadStartMinutes": lead_start,
                "leadEndMinutes": lead_end,
                "validAt": utc_string(source_time + timedelta(minutes=lead)),
                "status": "valid",
                "probability": int(round(np.clip(probability, 0, 1) * 100)),
                "rainRateMmPerHour": round(representative_rate, 3),
            }
        )

    return {
        "schemaVersion": 1,
        "algorithmVersion": ALGORITHM_VERSION,
        "source": "noaa-mrms-nodd",
        "product": "PrecipRate_00.00",
        "sourceDataTime": utc_string(source_time),
        "horizonMinutes": 120,
        "calibrationStatus": "uncalibrated",
        "motion": {
            "status": motion_status,
            "rowPixelsPerMinute": round(row_velocity, 4),
            "columnPixelsPerMinute": round(column_velocity, 4),
            "spreadPixelsPerMinute": round(spread, 4),
            "signal": round(motion_signal, 4),
        },
        "ensembleMembers": members,
        "seed": f"{seed:016x}",
        "intervals": intervals,
    }
