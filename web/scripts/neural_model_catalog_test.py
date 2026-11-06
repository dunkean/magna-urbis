"""CPU-only checks for the two Python neural profile extent contracts."""
import unittest
import math

import neural_model_catalog as models


class NeuralProfileBoundsTest(unittest.TestCase):
    def test_conventional_and_finite_bounds_are_distinct(self):
        profiles = {row['id']: row for row in models.catalog()['base']}
        self.assertEqual((profiles['original']['extentMin'], profiles['original']['extentMax']), (500, 200000))
        self.assertEqual(profiles['original']['nativeCellM'], 30)
        self.assertEqual((profiles['residual8k']['extentMin'], profiles['residual8k']['extentMax']), (40000, 40000))
        self.assertEqual(profiles['residual8k']['outputResolution'], 1024)
        # Tile40's trained coarse domain [-8, 16) intersects two 64-cell
        # windows of stride 48 on each axis: four network windows in total.
        first = math.floor((-8 - 64) / 48) + 1
        end = math.ceil(16 / 48)
        self.assertEqual(profiles['residual8k']['coarseWindowCount'], (end - first) ** 2)
        self.assertEqual(profiles['residual8k']['coarseWindowCount'], 4)

    def test_finite_model_rejects_other_extent_before_loading_weights(self):
        with self.assertRaisesRegex(ValueError, 'exactly 40 km'):
            models.generate_finite({}, {'extent': '200000'}, 42)


if __name__ == '__main__':
    unittest.main()
