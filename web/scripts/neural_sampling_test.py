"""CPU-only physical resampling checks."""
import unittest

import numpy as np

from neural_sampling import assert_finite_conditioning_coverage, resample_native


class NeuralSamplingTest(unittest.TestCase):
    def test_checkerboard_area_average_and_repeatability(self):
        checker = np.indices((8, 8)).sum(axis=0).astype(np.float32) % 2
        down = resample_native(checker, 240, 2)
        np.testing.assert_allclose(down, .5, rtol=0, atol=1e-6)
        np.testing.assert_array_equal(down, resample_native(checker, 240, 2))
        self.assertIs(resample_native(checker, 240, 8), checker)

    def test_ramp_and_cropped_extent(self):
        ramp = np.broadcast_to(np.arange(8, dtype=np.float32), (8, 8))
        down = resample_native(ramp, 240, 4)
        np.testing.assert_allclose(down, [[.5, 2.5, 4.5, 6.5]] * 4, rtol=0, atol=1e-6)
        cropped = resample_native(ramp, 225, 3)
        self.assertEqual(cropped.shape, (3, 3))
        self.assertTrue(np.isfinite(cropped).all())

    def test_tile40_requires_both_coarse_windows_and_interpolation_neighbours(self):
        with self.assertRaisesRegex(ValueError, 'misses a trained coarse window'):
            assert_finite_conditioning_coverage(6304, 0, 64)
        assert_finite_conditioning_coverage(6304, -24, 113)
        with self.assertRaisesRegex(ValueError, 'misses a trained coarse window'):
            assert_finite_conditioning_coverage(6304, -23, 113)
        with self.assertRaisesRegex(ValueError, 'misses a trained coarse window'):
            assert_finite_conditioning_coverage(6304, -24, 112)


if __name__ == '__main__':
    unittest.main()
