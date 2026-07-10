from datetime import datetime, timedelta, timezone
import unittest

import numpy as np

from nowcast_grib import ExtractedFrame, Target, build_extracted_nowcasts


def gaussian(size: int, row: float, column: float) -> np.ndarray:
    rows, columns = np.mgrid[:size, :size]
    return 8 * np.exp(-((rows - row) ** 2 + (columns - column) ** 2) / 30)


class BatchNowcastTest(unittest.TestCase):
    def test_builds_multiple_deterministic_targets_from_one_extraction_pass(self):
        start = datetime(2026, 7, 10, 16, 0, tzinfo=timezone.utc)
        targets = [
            Target("wet", 34.6441, -86.7862),
            Target("dry", 40.7128, -74.006),
        ]
        extracted = [
            ExtractedFrame(
                observedAt=start + timedelta(minutes=index * 2),
                checksum=f"{index:x}" * 64,
                tiles=[gaussian(129, 64, 42 + index * 2), np.zeros((129, 129))],
                coverageFractions=[1.0, 1.0],
            )
            for index in range(4)
        ]
        first = build_extracted_nowcasts(extracted, targets, members=24, half_size=64)
        second = build_extracted_nowcasts(extracted, targets, members=24, half_size=64)
        self.assertEqual(first, second)
        self.assertEqual([run["targetId"] for run in first], ["wet", "dry"])
        self.assertEqual(first[0]["inputSha256"], [frame.checksum for frame in extracted])
        self.assertEqual(first[1]["intervals"][0]["probability"], 0)

    def test_rejects_duplicate_targets_or_inconsistent_tile_counts(self):
        target = Target("same", 34.6441, -86.7862)
        with self.assertRaisesRegex(ValueError, "unique"):
            build_extracted_nowcasts([], [target, target], members=24, half_size=64)

        extracted = [
            ExtractedFrame(
                observedAt=datetime(2026, 7, 10, 16, index * 2, tzinfo=timezone.utc),
                checksum=f"{index:x}" * 64,
                tiles=[np.zeros((129, 129))],
                coverageFractions=[1.0],
            )
            for index in range(3)
        ]
        with self.assertRaisesRegex(ValueError, "tile"):
            build_extracted_nowcasts(extracted, [target, Target("other", 40, -74)], members=24, half_size=64)


if __name__ == "__main__":
    unittest.main()
