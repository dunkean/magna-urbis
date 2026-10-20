"""Retained Magna surfaces using Neural Earth's actual sub-native refiner.

Dependency/provenance: sibling infinite_map main 73d80e7, imported unchanged
backend/terrain_refinement.py, decoder-v12-nyquist-notch. No copied neural or
noise algorithms. Decoder level 1 needs a retained WorldPipeline/latents;
without them we explicitly expose native-roughness sparse convolution only.
Only the reference's detail residual is added to the retained Magna surface.
"""
from __future__ import annotations

import base64
from collections import OrderedDict
import hashlib
import json
import math
from pathlib import Path
from types import SimpleNamespace
import threading
import uuid

import numpy as np
import torch
import terrain_refinement as reference

_EXPECTED = 'decoder-v12-nyquist-notch'
_FINGERPRINT = hashlib.sha256(Path(reference.__file__).read_bytes()).hexdigest()[:12]
_ADAPTER_FINGERPRINT = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]
VERSION = f'{reference.VERSION}:magna-retained-v1:{_FINGERPRINT}:{_ADAPTER_FINGERPRINT}'
_LOCK = threading.RLock()
_WORLDS = OrderedDict()
_SOURCES = OrderedDict()
_MAX_WORLDS, _MAX_SOURCES = 2, 3


def _finite(value, name, low, high):
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'Invalid refinement {name}')
    return value


def _close(world):
    close = getattr(world, 'close', None)
    if close is not None:
        close()


def retain_world(world, origin=6304):
    """Transfer lifetime ownership of a generated neural world to this module."""
    token = uuid.uuid4().hex
    with _LOCK:
        _WORLDS[token] = (world, int(origin))
        while len(_WORLDS) > _MAX_WORLDS:
            old, (discarded, _) = _WORLDS.popitem(last=False)
            for key in list(_SOURCES):
                if _SOURCES[key].token == old:
                    del _SOURCES[key]
            _close(discarded)
    return token


class _ZeroDetail:
    """Absent decoder octave, explicitly reported by decoderUsed=False."""
    def __init__(self, device):
        self.device = device

    def __getitem__(self, key):
        _, rows, cols = key
        shape = (rows.stop - rows.start, cols.stop - cols.start)
        return torch.stack((torch.zeros(shape, device=self.device), torch.ones(shape, device=self.device)))


class _Source:
    def __init__(self, body, values, neural):
        self.n = int(body['n'])
        self.width = float(body['width'])
        self.seed = int(body['seed'])
        self.token = body.get('neuralToken')
        self.decoder = neural is not None
        original, self.origin = neural if neural is not None else (None, 0)
        self.device = original.device if original is not None else torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        window = body.get('neuralWindow') or {}
        self.window_x = _finite(window.get('x', 0), 'window x', -100000, 100000)
        self.window_y = _finite(window.get('y', 0), 'window y', -100000, 100000)
        self.window_width = _finite(window.get('width', self.width), 'window width', 1, 200000)
        self.height_scale = _finite(window.get('heightScale', 1), 'height scale', .0001, 10000)
        self.display_scale = self.width / self.window_width
        self.native_cell = 30 * self.display_scale
        self.values = torch.from_numpy(values.copy()).to(self.device, dtype=torch.float64)
        self.cache = OrderedDict()
        self.world = SimpleNamespace(device=self.device, seed=self.seed, get=self.get,
                                     kwargs={'residual_std': 1.1678}, _terrain_refinement_fields={})
        if original is not None:
            self.world.kwargs = dict(original.kwargs)
            for name in ('latents', 'decoder_tile_size', 'decoder_tile_stride', 'latent_compression',
                         '_terrain_profile', '_dtype', 'decoder_model'):
                setattr(self.world, name, getattr(original, name))
            self.world.tile_store = None
            student = original.__dict__.get('_terrain_decoder_windows')
            if student is not None:
                self.world._terrain_decoder_windows = student
        else:
            self.world._terrain_refinement_fields[1] = _ZeroDetail(self.device)

    def sample(self, xs, ys):
        """Same cell-centred cubic B-spline as the retained terrain renderer."""
        def taps(axis):
            g = axis * (self.n / self.width) - .5
            floor = torch.floor(g)
            t = g - floor
            index = floor.long()
            return [((index + k - 1).clamp(0, self.n - 1), weight) for k, weight in enumerate(
                ((1-t)**3/6, (3*t**3-6*t*t+4)/6, (-3*t**3+3*t*t+3*t+1)/6, t**3/6))]
        out = None
        for row, wy in taps(ys):
            value = None
            for col, wx in taps(xs):
                term = self.values[row[:, None], col[None, :]] * wx[None, :]
                value = term if value is None else value + term
            term = value * wy[:, None]
            out = term if out is None else out + term
        return out

    def get(self, i1, j1, i2, j2, *, with_climate=False):
        if with_climate:
            raise ValueError('Retained refinement has no climate output')
        xs = ((torch.arange(j1, j2, device=self.device, dtype=torch.float64) + .5 - self.origin) * 30 - self.window_x) * self.display_scale
        ys = ((torch.arange(i1, i2, device=self.device, dtype=torch.float64) + .5 - self.origin) * 30 - self.window_y) * self.display_scale
        return {'elev': (self.sample(xs, ys) / self.height_scale).float()}

    def residual(self, level, i1, j1, i2, j2):
        key = (level, i1, j1, i2, j2)
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        refined = reference.sample_refined(self.world, level, i1, j1, i2, j2)
        lo, left, hi, right = reference._base_bounds(level, i1, j1, i2, j2)
        margin = reference.SPLINE_RADIUS
        native = reference._NativeWindow(self.world, lo-margin, left-margin, hi+margin, right+margin)
        bare, coast = reference._coastal_base(native, level, i1, j1, i2, j2)
        if level > reference.COAST_LAG and bool((coast > 0).any()):
            bare = bare + coast * reference._coast_offset(self.world, level, i1, j1, i2, j2)
        bare = (bare * bare.abs()).float()
        value = (refined - bare).double() * self.height_scale
        self.cache[key] = value
        while len(self.cache) > 12:
            self.cache.popitem(last=False)
        return value

    def piece(self, xs, ys, level):
        macro = self.sample(xs, ys)
        if level == 0:
            return macro
        scale = 2**level
        gx = ((xs / self.display_scale + self.window_x) / 30 + self.origin) * scale - .5
        gy = ((ys / self.display_scale + self.window_y) / 30 + self.origin) * scale - .5
        ix, iy = torch.floor(gx).long(), torch.floor(gy).long()
        j1, i1, j2, i2 = int(ix[0]) - 1, int(iy[0]) - 1, int(ix[-1]) + 3, int(iy[-1]) + 3
        radius = reference.PREFILTER_RADIUS
        delta = self.residual(level, i1-radius, j1-radius, i2+radius, j2+radius)
        # Interpolating C2 coefficients from the reference's exact inverse FIR.
        # Its global halo prevents any tile-local boundary condition or lattice.
        coefficients = reference._filter(delta, reference._PREFILTER)
        fx, fy = gx - ix, gy - iy
        ix, iy = ix - j1, iy - i1
        detail = reference._evaluate(coefficients, reference._cubic_taps(iy, fy), reference._cubic_taps(ix, fx))
        # Retain the original land/sea classification after residual composition.
        magnitude = macro.abs()
        gain = magnitude / torch.hypot(magnitude, 2*detail).clamp_min(torch.finfo(torch.float64).tiny)
        return macro + detail * gain


def register(body):
    if reference.VERSION != _EXPECTED:
        raise RuntimeError(f'Unsupported Neural Earth refinement version: {reference.VERSION}')
    n = int(body['n'])
    if not 8 <= n <= 4096 or n != body['n']:
        raise ValueError('Invalid refinement raster resolution')
    _finite(body['width'], 'width', 1, 200000)
    seed = int(body['seed'])
    if not 0 <= seed < 2**64:
        raise ValueError('Invalid refinement seed')
    heights = body['heights']
    values = np.frombuffer(base64.b64decode(heights, validate=True), dtype='<f4') if isinstance(heights, str) else np.asarray(heights, dtype=np.float32)
    if values.size != n*n or not np.isfinite(values).all():
        raise ValueError('Invalid retained height values')
    values = np.ascontiguousarray(values.reshape(n, n), dtype='<f4')
    identity = dict(seed=seed, n=n, width=float(body['width']), neuralToken=body.get('neuralToken'), neuralWindow=body.get('neuralWindow'), version=VERSION)
    identifier = hashlib.sha256(json.dumps(identity, sort_keys=True).encode() + values.tobytes()).hexdigest()[:32]
    with _LOCK:
        token = body.get('neuralToken')
        if token and token not in _WORLDS:
            raise ValueError('Neural refinement token expired or unknown; regenerate the neural source')
        neural = _WORLDS.get(token) if token else None
        if neural is not None and int(neural[0].seed) != seed:
            raise ValueError('Neural refinement token belongs to another seed')
        source = _SOURCES.get(identifier)
        if source is None:
            source = _Source(body, values, neural)
            _SOURCES[identifier] = source
        _SOURCES.move_to_end(identifier)
        while len(_SOURCES) > _MAX_SOURCES:
            _SOURCES.popitem(last=False)
        return dict(id=identifier, version=VERSION, minMpp=source.native_cell/64, nativeMpp=source.native_cell,
                    retainedSourceCell=source.width/source.n, decoderUsed=source.decoder)


@torch.inference_mode()
def tile(body):
    with _LOCK:
        identifier = str(body['id'])
        if identifier not in _SOURCES:
            raise ValueError('Refinement source expired or unknown; register it again')
        source = _SOURCES[identifier]
        _SOURCES.move_to_end(identifier)
        x = _finite(body['x'], 'tile x', -400000, 400000)
        y = _finite(body['y'], 'tile y', -400000, 400000)
        width = _finite(body['width'], 'tile width', .001, 400000)
        n = int(body['resolution'])
        if not 2 <= n <= 1024 or n != body['resolution']:
            raise ValueError('Invalid refinement tile resolution')
        step = width/n
        level = max(0, min(6, math.ceil(math.log2(source.native_cell/step))))
        xs = x + (torch.arange(n, device=source.device, dtype=torch.float64) + .5) * step
        ys = y + (torch.arange(n, device=source.device, dtype=torch.float64) + .5) * step
        result = torch.empty((n, n), device=source.device, dtype=torch.float32)
        # Bound every reference read below its 1024² budget, including taps.
        for row in range(0, n, 256):
            for col in range(0, n, 256):
                result[row:row+256, col:col+256] = source.piece(xs[col:col+256], ys[row:row+256], level).float()
        if not bool(torch.isfinite(result).all()):
            raise RuntimeError('Non-finite Neural Earth refinement')
        meta = dict(id=identifier, x=x, y=y, width=width, n=n, sourceCell=source.native_cell/2**level,
                    sampleCell=step, retainedSourceCell=source.width/source.n, version=VERSION, lod=-level,
                    decoderUsed=source.decoder and level > 0,
                    method='decoder+sparse-convolution' if source.decoder else 'native-roughness+sparse-convolution')
        return result.cpu().numpy().astype('<f4', copy=False).tobytes(), meta


def status():
    with _LOCK:
        return dict(version=VERSION, minNativeMpp=30/64, sources=len(_SOURCES), neuralWorlds=len(_WORLDS),
                    retainedBytes=sum(s.values.numel()*s.values.element_size() for s in _SOURCES.values()))


def release(body=None):
    with _LOCK:
        body = body or {}
        if body.get('id'):
            _SOURCES.pop(str(body['id']), None)
        elif body.get('neuralToken'):
            token = str(body['neuralToken'])
            for key in list(_SOURCES):
                if _SOURCES[key].token == token:
                    del _SOURCES[key]
            item = _WORLDS.pop(token, None)
            if item is not None:
                _close(item[0])
        else:
            _SOURCES.clear()
            while _WORLDS:
                _, (world, _) = _WORLDS.popitem(last=False)
                _close(world)
        return dict(released=True, **status())
