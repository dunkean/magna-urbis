"""Physical area sampling of a 30 m neural field with bounded working memory."""
from __future__ import annotations

import math

import numpy as np
from scipy.sparse import csr_matrix


def assert_finite_conditioning_coverage(origin: int, start: int, size: int,
                                        window_start: int = -48, window_end: int = 64) -> None:
    """Require every Tile40 coarse sample and both interpolation neighbours."""
    if size < 2 or window_end <= window_start:
        raise ValueError('Invalid finite neural conditioning bounds')
    shift = origin / 256. - start
    first = window_start + shift
    last = window_end - 1 + shift
    if first < 0 or last > size - 1:
        raise ValueError('Finite neural conditioning misses a trained coarse window; rebuild the neural WASM assets.')


def resample_native(native, extent_m: float, output_n: int, native_m: float = 30.) -> np.ndarray:
    native = np.asarray(native, dtype=np.float32)
    if native.ndim != 2 or native.shape[0] != native.shape[1] or not 2 <= output_n <= native.shape[0]:
        raise ValueError('Invalid native neural raster or output resolution')
    native_n = native.shape[0]
    if not math.isfinite(extent_m) or extent_m <= 0 or extent_m > native_n * native_m:
        raise ValueError('Invalid physical extent for native neural raster')
    if output_n == native_n and extent_m == native_n * native_m:
        return native.astype('<f4', copy=False)

    output_cell = extent_m / output_n
    result = np.empty((output_n, output_n), dtype='<f4')
    # Sparse area weights average the physical footprint of each output cell.
    # Only 64 intermediate rows are held at a time; no full-size temporary.
    ratio = output_cell / native_m
    rows, columns, values = [], [], []
    for i in range(output_n):
        left, right = i * ratio, (i + 1) * ratio
        for j in range(math.floor(left), min(math.ceil(right), native_n)):
            overlap = max(0., min(right, j + 1) - max(left, j))
            if overlap:
                rows.append(i)
                columns.append(j)
                values.append(overlap / ratio)
    weights = csr_matrix((np.asarray(values, np.float32), (rows, columns)), shape=(output_n, native_n))
    for y0 in range(0, output_n, 64):
        y1 = min(y0 + 64, output_n)
        strip = weights[y0:y1] @ native
        result[y0:y1] = (weights @ strip.T).T
    return result
