"""Physical sketch/climate inputs for paired40km teacher references."""
from dataclasses import dataclass

import numpy as np
import torch
from scipy.interpolate import PchipInterpolator


SIDE_M = 40000.
COARSE_M = 7680.
CLIMATES = {
    'arid': (24., 700., 150., 90.),
    'cold': (-2., 1100., 500., 60.),
    'tropical': (27., 100., 2200., 40.),
    'temperate': (14., 600., 900., 55.),
    'oceanic': (11., 250., 1500., 35.),
}
RELIEFS = ('mountains', 'hills', 'plain')
SPLIT_SEEDS = {'train': 8100000, 'val': 9100000, 'test': 10100000}


def sketch(seed, relief, size=16):
    if relief not in RELIEFS or size < 4:
        raise ValueError('Known relief class and at least4x4 sketch required.')
    rng = np.random.default_rng(seed)
    y, x = np.meshgrid(np.linspace(0., 1., size), np.linspace(0., 1., size), indexing='ij')
    field = np.zeros((size, size), np.float64)
    for _ in range(5):
        cx, cy = rng.uniform(.15, .85, 2)
        angle = rng.uniform(-np.pi, np.pi)
        along = (x-cx)*np.cos(angle)+(y-cy)*np.sin(angle)
        across = -(x-cx)*np.sin(angle)+(y-cy)*np.cos(angle)
        widths = rng.uniform([.12, .045], [.35, .14])
        field += rng.uniform(.5, 1.)*np.exp(-.5*((along/widths[0])**2+(across/widths[1])**2))
    field /= max(float(field.max()), 1e-12)
    level, amplitude = {'mountains':(350., 3400.), 'hills':(150., 600.), 'plain':(80., 25.)}[relief]
    return (level+amplitude*field).astype(np.float32)


def sample_sketch(values, xs, ys, side_m=SIDE_M):
    values = np.asarray(values, np.float32)
    xs, ys = np.asarray(xs, np.float64), np.asarray(ys, np.float64)
    if values.ndim != 2 or min(values.shape) < 2 or not np.isfinite(values).all() or side_m <= 0:
        raise ValueError('A finite2D sketch with positive extent is required.')
    if xs.ndim != 1 or ys.ndim != 1 or not np.isfinite(xs).all() or not np.isfinite(ys).all():
        raise ValueError('Finite1D physical coordinates required.')
    x = np.clip(xs/side_m, 0., 1.)*(values.shape[1]-1)
    y = np.clip(ys/side_m, 0., 1.)*(values.shape[0]-1)
    if not len(xs) or not len(ys):
        return np.empty((len(ys), len(xs)), np.float32)
    # Shape-preservingC1 interpolation avoids visible rectangular slope breaks
    # from bilinear macro relief,without overshooting the sketch's height range.
    across = PchipInterpolator(np.arange(values.shape[1]), values, axis=1)(x)
    return PchipInterpolator(np.arange(values.shape[0]), across, axis=0)(y).astype(np.float32)


@dataclass
class SketchConditioning:
    elevation: np.ndarray
    climate: str
    side_m: float = SIDE_M

    def __post_init__(self):
        if self.climate not in CLIMATES:
            raise ValueError('Unknown climate prototype.')
        self.elevation = np.asarray(self.elevation, np.float32).copy()
        sample_sketch(self.elevation, np.array([0.]), np.array([0.]), self.side_m)

    def sample(self, xs, ys):
        elevation = sample_sketch(self.elevation, xs, ys, self.side_m)
        temperature, seasonality, precipitation, precipitation_cv = CLIMATES[self.climate]
        # PhysicalBIO4 units match the teacher's internal degC*100 interface.
        fields = [elevation, temperature-.0065*np.maximum(elevation, 0.)]
        fields.extend(np.full_like(elevation, value) for value in (seasonality, precipitation, precipitation_cv))
        return np.stack(fields).astype(np.float32)

    def sample_raw(self, cj0, ci0, cj1, ci1):
        xs = (np.arange(cj0, cj1, dtype=np.float64)+.5)*COARSE_M
        ys = (np.arange(ci0, ci1, dtype=np.float64)+.5)*COARSE_M
        return self.sample(xs, ys)

    @staticmethod
    def finalize(raw):
        return np.asarray(raw, np.float32).copy()

    def __call__(self, cj0, ci0, cj1, ci1):
        fields = self.sample_raw(cj0, ci0, cj1, ci1)
        fields[0] = np.sign(fields[0])*np.sqrt(np.abs(fields[0]))
        return torch.from_numpy(fields)


def cases(train_per_relief=8, val_per_relief=2, test_per_relief=2):
    rows = []
    for split, count in zip(SPLIT_SEEDS, (train_per_relief, val_per_relief, test_per_relief), strict=True):
        for index in range(count):
            for ri, relief in enumerate(RELIEFS):
                seed = SPLIT_SEEDS[split]+index*10+ri
                for climate in CLIMATES:
                    rows.append(dict(split=split, seed=seed, relief=relief, climate=climate,
                        file=f'{split}-{seed}-{relief}-{climate}.npz'))
    return rows
