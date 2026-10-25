"""Local deterministic water maps; no downloads, no change to hydraulic levels.

Two periodic slope textures are sampled at incommensurate world scales and
advected independently. Native hydro supplies flow, optical depth and banks.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
from surface_context import load_hydrology

ROOT = Path(__file__).resolve().parents[1]


def wave_texture(seed=43189, n=512):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[:n, :n] * (2 * np.pi / n)
    value = np.zeros((n, n), np.float64)
    sx, sy = value.copy(), value.copy()
    for _ in range(72):
        kx, ky = rng.integers(-24, 25, 2)
        length = np.hypot(kx, ky)
        if length < 2:
            continue
        phase = kx*x + ky*y + rng.uniform(0, 2*np.pi)
        amplitude = np.exp(-length/11) / length**1.6
        value += np.sin(phase)*amplitude
        sx += np.cos(phase)*amplitude*kx
        sy += np.cos(phase)*amplitude*ky
    slopes = np.stack((sx, sy), -1)
    slopes /= max(float(np.max(np.abs(slopes))), 1.e-6)
    foam = (value-value.min()) / (value.max()-value.min())
    return np.uint8(np.rint(np.clip(np.dstack((slopes*.5+.5, foam, np.ones_like(foam))), 0, 1)*255))


def water_field(height, hydro, cell):
    n = height.shape[0]
    index = np.arange(n*n).reshape(n, n)
    receiver = hydro['receiver'].astype(np.int64)
    valid = (receiver >= 0) & (receiver < n*n) & (receiver != index)
    dx = np.where(valid, receiver % n-index % n, 0)
    dz = np.where(valid, receiver // n-index // n, 1)
    length = np.maximum(np.hypot(dx, dz), 1)
    standing = (hydro['sea'] > 0) | (hydro['lake'] > 0)
    shore = distance_transform_edt(standing, sampling=cell) if standing.any() else np.zeros_like(height)
    depth = np.where(hydro['sea'] > 0, np.maximum(-height, 0),
                     np.where(hydro['lake'] > 0, np.maximum(hydro['lakeLevel']-height, 0), 0))
    # RG unit downstream direction, B inward shore distance / 256 m, A depth / 50 m.
    return np.uint8(np.rint(np.clip(np.dstack((dx/length*.5+.5, dz/length*.5+.5, shore/256, depth/50)), 0, 1)*255))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tile')
    args = parser.parse_args()
    directory = ROOT / 'materials/water'
    directory.mkdir(parents=True, exist_ok=True)
    files = []
    for name, seed in [('ripples', 43189), ('capillary', 81913)]:
        file = name+'.png'
        Image.fromarray(wave_texture(seed)).save(directory/file)
        files.append({'file': file, 'sha256': hashlib.sha256((directory/file).read_bytes()).hexdigest()})
    (directory/'water.json').write_text(json.dumps({'version': 1, 'source': 'procedural Fourier slopes',
        'files': files, 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, indent=2), encoding='utf-8')
    catalogue = json.loads((ROOT/'tiles/catalog.json').read_text(encoding='utf-8'))
    for entry in catalogue['tiles']:
        if args.tile and args.tile != entry['id']:
            continue
        tile = ROOT/'tiles'/Path(entry['file']).parent
        meta = json.loads((tile/'tile.json').read_text(encoding='utf-8'))
        height = np.fromfile(tile/meta['height'], '<f4').reshape(meta['n'], meta['n'])
        image = water_field(height, load_hydrology(tile, meta), meta['width']/meta['n'])
        file = tile/'surface-water-detail.png'
        Image.fromarray(image).save(file)
        (tile/'surface-water-detail.json').write_text(json.dumps({'version': 1,
            'heightSha256': meta['heightSha256'], 'file': file.name,
            'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
            'channels': ['downstream X', 'downstream Z', 'shore distance / 256m', 'optical depth / 50m'],
            'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, indent=2), encoding='utf-8')
        print('WATER', entry['id'], flush=True)


if __name__ == '__main__':
    main()
