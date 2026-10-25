import unittest
import numpy as np
from prepare_surface_water import wave_texture, water_field


class SurfaceWaterTest(unittest.TestCase):
    def test_wave_channels_are_deterministic_and_not_flat(self):
        a = wave_texture(n=64)
        np.testing.assert_array_equal(a, wave_texture(n=64))
        self.assertFalse(np.array_equal(a, wave_texture(seed=81913, n=64)))
        self.assertGreater(float(a[:, :, :2].std()), 20)
        self.assertTrue((a[:, :, 3] == 255).all())

    def test_flow_banks_and_real_optical_depth(self):
        n = 8
        index = np.arange(n*n).reshape(n, n)
        h = np.full((n, n), -10, np.float32)
        sea = np.zeros((n, n), np.uint8)
        sea[:, 4:] = 1
        hydro = {'receiver': np.minimum(index+1, n*n-1), 'sea': sea,
                 'lake': sea*0, 'lakeLevel': h*0}
        image = water_field(h, hydro, 30)
        self.assertEqual(int(image[3, 2, 0]), 255)
        self.assertEqual(int(image[3, 2, 1]), 128)
        self.assertGreater(int(image[3, 7, 2]), int(image[3, 4, 2]))
        self.assertEqual(int(image[3, 7, 3]), 51)
        self.assertEqual(int(image[3, 2, 3]), 0)
        hydro['sea'][:] = 0
        hydro['lake'][:, 4:] = 1
        hydro['lakeLevel'][:] = -5
        image = water_field(h, hydro, 30)
        self.assertEqual(int(image[3, 7, 3]), 26)


if __name__ == '__main__':
    unittest.main()
