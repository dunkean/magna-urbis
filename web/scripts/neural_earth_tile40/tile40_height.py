"""Physical reconstruction and resampling for the finite40km inference path."""
import numpy as np
import torch
from scipy.ndimage import map_coordinates,gaussian_filter
from .tile40_conditioning import SIDE_M,sample_sketch


def resample_tile(height, pixels=1334, native_m=30., side_m=SIDE_M):
    height = np.asarray(height, np.float32)
    if height.ndim != 2 or not np.isfinite(height).all() or pixels < 32 or native_m <= 0:
        raise ValueError('Finite native height field and valid physical resolution required.')
    coords = (np.arange(pixels, dtype=np.float64)+.5)*(side_m/pixels)/native_m-.5
    if coords[-1] >= min(height.shape):
        raise ValueError('Native reference does not cover the full requested40km.')
    yy, xx = np.meshgrid(coords, coords, indexing='ij')
    return map_coordinates(height, (yy, xx), order=1, mode='nearest', prefilter=False).astype(np.float32)

def guided_reference(native_padded, sketch_m, margin=256, pixels=1344):
    """Preserve sketch's physical structure and original decoder's fine root detail.

    Lowpass is evaluated on a240m grid with sigma1920m. The source padding
    covers four sigma,so the kept tile does not depend on reflected crop edges.
    This is an explicit new training target,not an unmodified teacher output.
    """
    source = np.asarray(native_padded, np.float32)
    if source.shape != (pixels+2*margin, pixels+2*margin) or source.shape[0] % 8:
        raise ValueError('Aligned native reference and complete lowpass halo required.')
    if margin < 256 or not np.isfinite(source).all():
        raise ValueError('Finite source with the full1920m lowpass support required.')
    root = np.sign(source)*np.sqrt(np.abs(source))
    low = root.reshape(source.shape[0]//8, 8, source.shape[1]//8, 8).mean(axis=(1, 3))
    low = gaussian_filter(low, sigma=8., mode='reflect')
    low = torch.nn.functional.interpolate(torch.from_numpy(low)[None, None], size=source.shape,
                                          mode='bilinear', align_corners=False)[0, 0].numpy()
    detail = (root-low)[margin:margin+pixels, margin:margin+pixels].copy()
    coordinates = (np.arange(pixels, dtype=np.float64)+.5)*30.
    background = sample_sketch(sketch_m, coordinates, coordinates)
    guided_root = np.sign(background)*np.sqrt(np.abs(background))+detail
    return dict(native_height=np.sign(guided_root)*np.square(guided_root), root_detail=detail,
                teacher_native=source[margin:margin+pixels, margin:margin+pixels].copy())
