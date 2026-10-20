"""Identical CPU feature construction for dataset loading and evaluation."""
from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as F

from distill.common import bootstrap
bootstrap()

COND_MEANS = np.array([14.99, 11.65, 15.87, 619.26, 833.12, 69.40], np.float32)
COND_STDS = np.array([21.72, 21.78, 10.40, 452.29, 738.09, 34.59], np.float32)


def noise(seed, y, x, h, w, channels, tile=64):
    from terrain_diffusion.inference.world_pipeline import gaussian_noise_patch
    return torch.from_numpy(gaussian_noise_patch(
        int(seed), int(y), int(x), h, w, channels=channels, tile_h=tile, tile_w=tile))


def pad_channels(value, channels):
    if value.shape[0] > channels:
        raise ValueError('Feature schema exceeds the model input size.')
    return torch.cat([value, value.new_zeros(channels-value.shape[0], *value.shape[-2:])])


def phase(y, x, h, w, period=64):
    yy = torch.arange(y, y+h, dtype=torch.float32)[:, None].expand(h, w)
    xx = torch.arange(x, x+w, dtype=torch.float32)[None, :].expand(h, w)
    return torch.stack([torch.sin(yy*(2*np.pi/period)), torch.cos(yy*(2*np.pi/period)),
                        torch.sin(xx*(2*np.pi/period)), torch.cos(xx*(2*np.pi/period))])


def base_features(coarse, coarse_y, coarse_x, seed, y, x, size, histogram, *, include_noise=True):
    if y % 32 or x % 32 or size % 32:
        raise ValueError('Base inputs must align to the 32-latent coarse grid.')
    cy, cx = y//32-int(coarse_y), x//32-int(coarse_x)
    field = torch.as_tensor(coarse, dtype=torch.float32)[:, cy:cy+size//32, cx:cx+size//32]
    if field.shape != (6, size//32, size//32):
        raise ValueError('Stored conditioning does not cover the requested halo.')
    field = (field-torch.from_numpy(COND_MEANS)[:, None, None]) / torch.from_numpy(COND_STDS)[:, None, None]
    field = F.interpolate(field[None], size=(size, size), mode='nearest')[0]
    # The upstream mask in the 58-value vector is constant ones, not a land mask.
    mask = field.new_full((1, size, size), (1-.66)/.47)
    scalars = torch.as_tensor(histogram, dtype=torch.float32)[:, None, None].expand(-1, size, size)
    first = noise(seed+5819, y, x, size, size, 5) if include_noise else field.new_zeros(5, size, size)
    second = noise(seed+5820, y, x, size, size, 5) if include_noise else field.new_zeros(5, size, size)
    return pad_channels(torch.cat([first, second,
                                  field, mask, phase(y, x, size, size), scalars]), 32)


def coarse_features(condition, labels, seed, y, x):
    condition = torch.as_tensor(condition, dtype=torch.float32)
    h, w = condition.shape[-2:]
    scalars = torch.as_tensor(labels, dtype=torch.float32)[:, None, None].expand(-1, h, w)
    return torch.cat([noise(seed+1, y, x, h, w, 6), condition, scalars])


def decoder_features(latents, seed, y, x, size=512, *, noise_tile=None):
    field = F.interpolate(torch.as_tensor(latents, dtype=torch.float32)[None],
                          size=(size, size), mode='nearest')[0]
    # Noise coordinates retain their training-time512px lattice even when a
    # finite tile is decoded in one call. The default preserves legacy callers.
    return pad_channels(torch.cat([noise(seed+5819, y, x, size, size, 1,
                                        tile=size if noise_tile is None else noise_tile), field]), 16)
