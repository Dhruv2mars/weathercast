import math
import unittest

from sample_grib import MrmsDecodeError, classify_rain_rate, observed_at, parse_points, validate_metadata


class RainRateTest(unittest.TestCase):
    def test_preserves_mrms_unknown_sentinels(self):
        self.assertEqual(classify_rain_rate(-1), ("missing", None))
        self.assertEqual(classify_rain_rate(-3), ("no_coverage", None))

    def test_accepts_nonnegative_rate_and_rejects_other_negative_values(self):
        self.assertEqual(classify_rain_rate(0), ("valid", 0))
        self.assertEqual(classify_rain_rate(12.5), ("valid", 12.5))
        with self.assertRaises(MrmsDecodeError):
            classify_rain_rate(-2)
        with self.assertRaises(MrmsDecodeError):
            classify_rain_rate(math.nan)

    def test_formats_mrms_observation_time_as_utc(self):
        self.assertEqual(observed_at(20260710, 1528), "2026-07-10T15:28:00Z")

    def test_validates_product_and_operational_grid(self):
        metadata = {
            "discipline": 209,
            "parameterCategory": 6,
            "parameterNumber": 1,
            "Ni": 7000,
            "Nj": 3500,
            "iDirectionIncrementInDegrees": 0.01,
            "jDirectionIncrementInDegrees": 0.01,
        }
        validate_metadata(metadata)
        with self.assertRaisesRegex(MrmsDecodeError, "parameterNumber"):
            validate_metadata({**metadata, "parameterNumber": 2})


class PointsTest(unittest.TestCase):
    def test_parses_unique_bounded_points(self):
        self.assertEqual(
            parse_points([{"id": "nyc", "latitude": 40.71, "longitude": -74.01}])[0].id,
            "nyc",
        )

    def test_rejects_duplicate_or_invalid_points(self):
        with self.assertRaisesRegex(MrmsDecodeError, "duplicated"):
            parse_points(
                [
                    {"id": "x", "latitude": 40, "longitude": -74},
                    {"id": "x", "latitude": 41, "longitude": -75},
                ]
            )
        with self.assertRaisesRegex(MrmsDecodeError, "outside"):
            parse_points([{"id": "x", "latitude": 91, "longitude": 0}])


if __name__ == "__main__":
    unittest.main()
