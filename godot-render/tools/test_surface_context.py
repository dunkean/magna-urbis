"""Small analytic checks for the environmental compiler, independent of 42 assets."""
import unittest
import numpy as np
from numba import set_num_threads
from surface_context import geomorphons, geology, route_context, form_class


class ContextTests(unittest.TestCase):
    def test_landform_horizons(self):
        n, cell = 25, 30.
        y, x = np.mgrid[:n, :n].astype(np.float32)
        radii = np.array([60., 150., 300.])
        flat = geomorphons(np.full((n, n), 100, np.float32), cell, radii)
        self.assertTrue(np.all(flat == 1))
        peak = 1000 - ((x - 12) ** 2 + (y - 12) ** 2)
        self.assertTrue(np.all(geomorphons(peak, cell, radii)[:, 12, 12] == 2))
        self.assertTrue(np.all(geomorphons(-peak, cell, radii)[:, 12, 12] == 10))
        ridge = 1000 - (x - 12) ** 2
        self.assertTrue(np.all(geomorphons(ridge, cell, radii)[:, 12, 12] == 3))
        self.assertTrue(np.all(geomorphons(-ridge, cell, radii)[:, 12, 12] == 9))
        slope = x * 4
        self.assertTrue(np.all(geomorphons(slope, cell, radii)[:, 12, 12] == 6))
        for down in range(9):
            for up in range(9 - down):
                self.assertIn(form_class(down, up), range(1, 11))
        self.assertEqual(form_class(1, 2), 8)
        self.assertEqual(form_class(2, 1), 4)
        self.assertEqual(form_class(2, 4), 7)
        self.assertEqual(form_class(4, 2), 5)

    def test_graph_hand_sources_and_geometric_area(self):
        receiver = np.array([1, 2, -1, 4, 5, -1, 7, 8, -1], np.int32)
        height = np.array([10, 7, 2, 100, 95, 90, 20, 15, 12], np.float32)
        rock = np.array([1, 2, 2, 3, 3, 3, 5, 5, 5], np.uint8)
        z = np.zeros(9, np.uint8)
        accumulation = np.zeros(9, np.float32)
        accumulation[[2, 5]] = 100
        gravity_source = np.zeros(9, np.float32)
        gravity_source[0] = 1
        area, mix, gravity, clipped, channel, reference, kind = route_context(
            receiver, z, z, height, height, height, np.eye(5, dtype=np.float32)[rock-1], np.ones(9, np.float32),
            gravity_source, accumulation, 50, 3, 30.)
        np.testing.assert_allclose(area[[2, 5, 8]], [2700] * 3)
        np.testing.assert_allclose(mix[2], [1 / 3, 2 / 3, 0, 0, 0])
        np.testing.assert_allclose(mix[5], [0, 0, 1, 0, 0])
        self.assertEqual(reference[0], 2)
        self.assertEqual(reference[3], 90)  # Does not jump to a nearby lower river.
        self.assertEqual(kind[0], 1)
        self.assertEqual(kind[6], 4)  # No channel before the edge: HAND undefined.
        self.assertGreater(gravity[2], 0)
        self.assertEqual(gravity[5], 0)  # No leakage to a disconnected slope.
        np.testing.assert_allclose(mix.sum(axis=1), 1)

    def test_internal_closed_sink_and_lake_reference(self):
        n = 5
        receiver = np.full(n * n, -1, np.int32)
        receiver[7] = 12
        height = np.arange(n * n, dtype=np.float32)
        z = np.zeros(n * n, np.uint8)
        lake = z.copy()
        lake[16] = 1
        receiver[11] = 16
        level = np.full(n * n, np.nan, np.float32)
        level[16] = 20
        result = route_context(receiver, z, lake, level, height, height,
                               np.tile(np.array([1, 0, 0, 0, 0], np.float32), (n*n, 1)), np.ones(n * n, np.float32),
                               np.zeros(n * n, np.float32), np.zeros(n * n, np.float32), 1000, n, 30.)
        self.assertEqual(result[-1][7], 5)
        self.assertEqual(result[-1][11], 2)
        self.assertEqual(result[-2][11], 20)
        receiver[12] = 7
        with self.assertRaises(ValueError):
            route_context(receiver, z, lake, level, height, height, np.tile(np.array([1, 0, 0, 0, 0], np.float32), (n*n, 1)),
                          np.ones(n * n, np.float32), np.zeros(n * n, np.float32),
                          np.zeros(n * n, np.float32), 1000, n, 30.)

    def test_geology_reproducibility_and_declared_scenario(self):
        first = geology(128, 40000, "test-seed")
        second = geology(128, 40000, "test-seed")
        for a, b in zip(first, second):
            np.testing.assert_array_equal(a, b)
        self.assertGreaterEqual(len(np.unique(first[0])), 4)
        self.assertFalse(np.array_equal(first[0], geology(128, 40000, "other-seed")[0]))
        self.assertTrue(np.all(geology(32, 40000, "test-seed", "basalt")[0] == 5))

    def test_composition_continuity_and_weighted_properties(self):
        # The retained DEM grid is ~30 m, so assess visible steps at that spacing.
        rock, hard, weather, _, weights, variation = geology(1334, 40000, "tile40-mountains-20261024")
        np.testing.assert_allclose(weights.sum(axis=-1), 1, atol=2.e-6)
        self.assertTrue(np.all((weights >= 0) & (weights <= 1)))
        np.testing.assert_allclose(hard, (weights @ np.array([.85,.57,.67,.24,.91])) * (.94+.12*variation), rtol=2.e-6)
        # Material properties remain continuous where the dominant label flips.
        boundary = rock[:, 1:] != rock[:, :-1]
        jump = np.abs(np.diff(hard, axis=1))[boundary]
        self.assertGreater(len(jump), 100)
        self.assertLess(np.mean(jump), .03)
        self.assertLess(np.percentile(jump, 99), .10)
        mixed = np.max(weights, axis=-1) < .95
        self.assertGreater(np.mean(mixed), .25)
        self.assertLess(np.mean(mixed), .90)

    def test_routing_transports_fractional_rock_source(self):
        n = 3
        receiver = np.full(9, -1, np.int32);receiver[0]=1
        z = np.zeros(9, np.uint8);h=np.zeros(9,np.float32)
        source = np.tile(np.array([0,1,0,0,0],np.float32),(9,1))
        source[0]=[.25,0,0,0,.75]
        out=route_context(receiver,z,z,h,h,h,source,np.ones(9,np.float32),h,h,100,n,30.)
        np.testing.assert_allclose(out[1][1],[.125,.5,0,0,.375])


if __name__ == "__main__":
    set_num_threads(4)
    unittest.main()
