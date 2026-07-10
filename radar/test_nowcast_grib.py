import unittest

import numpy as np

from nowcast_grib import grid_index, normalize_tile
from sample_grib import MrmsDecodeError


class GridExtractionTest(unittest.TestCase):
    def setUp(self):
        self.metadata = {
            "Ni": 7000,
            "Nj": 3500,
            "iScansNegatively": 0,
            "jScansPositively": 0,
            "jPointsAreConsecutive": 0,
            "alternativeRowScanning": 0,
            "latitudeOfFirstGridPointInDegrees": 54.995,
            "longitudeOfFirstGridPointInDegrees": 230.005,
            "iDirectionIncrementInDegrees": 0.01,
            "jDirectionIncrementInDegrees": 0.01,
        }

    def test_maps_longitude_to_operational_mrms_array_index(self):
        self.assertEqual(grid_index(40.715, -74.005, self.metadata), (1428, 5599))

    def test_rejects_points_outside_the_conus_grid(self):
        with self.assertRaisesRegex(MrmsDecodeError, "outside"):
            grid_index(28.6139, 77.209, self.metadata)

    def test_normalizes_only_documented_unknown_sentinels(self):
        normalized = normalize_tile(np.array([[0.0, 2.5, -1.0, -3.0]]))
        self.assertEqual(normalized[0, 0], 0)
        self.assertEqual(normalized[0, 1], 2.5)
        self.assertTrue(np.isnan(normalized[0, 2]))
        self.assertTrue(np.isnan(normalized[0, 3]))
        with self.assertRaisesRegex(MrmsDecodeError, "negative"):
            normalize_tile(np.array([[-2.0]]))


if __name__ == "__main__":
    unittest.main()
