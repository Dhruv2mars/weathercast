from datetime import datetime, timedelta, timezone
import unittest

import numpy as np

from motion_nowcast import (
    Frame,
    MrmsMotionError,
    bilinear_sample,
    estimate_translation,
    point_nowcast,
)


def gaussian(size: int, row: float, column: float, sigma: float = 3.0) -> np.ndarray:
    rows, columns = np.mgrid[:size, :size]
    return 12 * np.exp(-((rows - row) ** 2 + (columns - column) ** 2) / (2 * sigma**2))


class MotionEstimationTest(unittest.TestCase):
    def test_recovers_translation_between_radar_frames(self):
        previous = gaussian(96, 48, 48)
        current = np.roll(previous, shift=(3, -4), axis=(0, 1))
        estimate = estimate_translation(previous, current)
        self.assertAlmostEqual(estimate.rowPixels, 3, delta=0.2)
        self.assertAlmostEqual(estimate.columnPixels, -4, delta=0.2)
        self.assertGreater(estimate.signal, 0.5)

    def test_rejects_frames_without_enough_echo(self):
        with self.assertRaisesRegex(MrmsMotionError, "echo"):
            estimate_translation(np.zeros((64, 64)), np.zeros((64, 64)))

    def test_bilinear_sample_preserves_unknown_and_interpolates(self):
        field = np.array([[0.0, 10.0], [20.0, 30.0]])
        self.assertEqual(bilinear_sample(field, 0.5, 0.5), 15.0)
        field[1, 1] = np.nan
        self.assertIsNone(bilinear_sample(field, 0.5, 0.5))
        self.assertIsNone(bilinear_sample(field, -1, 0))


class PointNowcastTest(unittest.TestCase):
    def test_emits_deterministic_eight_interval_probabilistic_nowcast(self):
        start = datetime(2026, 7, 10, 15, 30, tzinfo=timezone.utc)
        frames = []
        for index in range(4):
            # A compact rain cell moves east toward the centre point.
            frames.append(
                Frame(
                    observedAt=start + timedelta(minutes=index * 2),
                    rainRate=gaussian(385, 192, 80 + index * 3, sigma=8),
                )
            )
        first = point_nowcast(frames, center=(192, 192), seed=42, members=48)
        second = point_nowcast(frames, center=(192, 192), seed=42, members=48)
        self.assertEqual(first, second)
        self.assertEqual(first["schemaVersion"], 1)
        self.assertEqual(first["algorithmVersion"], "translation-ensemble-v1")
        self.assertEqual(first["calibrationStatus"], "uncalibrated")
        self.assertEqual(len(first["intervals"]), 8)
        self.assertEqual(first["intervals"][-1]["leadEndMinutes"], 120)
        self.assertGreater(max(interval["probability"] for interval in first["intervals"]), 0)
        for interval in first["intervals"]:
            self.assertGreaterEqual(interval["probability"], 0)
            self.assertLessEqual(interval["probability"], 100)
            self.assertGreaterEqual(interval["rainRateMmPerHour"], 0)

    def test_never_converts_unknown_target_coverage_to_dry(self):
        start = datetime(2026, 7, 10, 15, 30, tzinfo=timezone.utc)
        frames = [
            Frame(
                observedAt=start + timedelta(minutes=index * 2),
                rainRate=np.full((65, 65), np.nan),
            )
            for index in range(4)
        ]
        with self.assertRaisesRegex(MrmsMotionError, "coverage"):
            point_nowcast(frames, center=(32, 32), seed=42, members=24)

    def test_rejects_nonchronological_or_gapped_frames(self):
        start = datetime(2026, 7, 10, 15, 30, tzinfo=timezone.utc)
        field = gaussian(65, 32, 32)
        frames = [
            Frame(observedAt=start, rainRate=field),
            Frame(observedAt=start + timedelta(minutes=8), rainRate=field),
            Frame(observedAt=start + timedelta(minutes=10), rainRate=field),
        ]
        with self.assertRaisesRegex(MrmsMotionError, "spacing"):
            point_nowcast(frames, center=(32, 32), seed=42, members=24)

    def test_rejects_ambiguous_time_and_seed_inputs(self):
        field = gaussian(65, 32, 32)
        naive_start = datetime(2026, 7, 10, 15, 30)
        naive_frames = [
            Frame(observedAt=naive_start + timedelta(minutes=index * 2), rainRate=field)
            for index in range(3)
        ]
        with self.assertRaisesRegex(MrmsMotionError, "timezone-aware"):
            point_nowcast(naive_frames, center=(32, 32), seed=42, members=24)

        aware_start = naive_start.replace(tzinfo=timezone.utc)
        aware_frames = [
            Frame(observedAt=aware_start + timedelta(minutes=index * 2), rainRate=field)
            for index in range(3)
        ]
        with self.assertRaisesRegex(MrmsMotionError, "unsigned"):
            point_nowcast(aware_frames, center=(32, 32), seed=-1, members=24)


if __name__ == "__main__":
    unittest.main()
