"""Regional Terrain Diffusion service: real PyTorch/CUDA inference, no Rust server."""
from __future__ import annotations

import argparse
import gc
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import sys
import threading
import time
from types import MethodType
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
EARTH = Path(os.environ.get('MAGNA_NEURAL_EARTH', ROOT.parent / 'infinite_map')).resolve()
for key, value in {'MPLBACKEND': 'Agg', 'TERRAIN_CUDA_GRAPHS': '0',
                   'TERRAIN_COARSE_STREAMS': '1', 'TERRAIN_DISTILL_LIVE': '0'}.items():
    os.environ[key] = value
sys.path[:0] = [str(EARTH), str(EARTH / 'backend'), str(EARTH / 'terrain-diffusion')]

import numpy as np
import torch
from scipy.ndimage import map_coordinates
import terrain_app
from terrain_app import load_pipeline
from terrain_diffusion.inference.world_pipeline import WorldPipeline
from terrain_inference import configure_world
from distill.inference import install
import neural_model_catalog as model_catalog
import neural_refinement as refinement

LOCK = threading.Lock()
STATE = {'state': 'ready', 'message': 'Python/CUDA pret ; poids charges au premier calcul',
         'backend': 'python-cuda', 'generated': 0, 'loaded': False, 'resolution': 1024, 'extent': 40000,
         'zoneConditioning': 1, 'modelCatalog': 1}
MODELS = None
MODELS_KEY = None


def number(params, name, default, low, high):
    value = float(params.get(name, default))
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'Invalid {name}')
    return value


def models(seed, params):
    global MODELS, MODELS_KEY
    selected = model_catalog.selection(params)
    key = tuple(selected.items())
    if MODELS is None or MODELS_KEY != key:
        STATE.update(state='loading', message='Python : chargement des modeles PyTorch sur CUDA')
        loaded = load_pipeline(seed)
        config = {k: v for k, v in dict(loaded.config).items() if not k.startswith('_')}
        coarse = model_catalog.load_student(selected['coarseModel'], 'cuda')[0] if selected['coarseModel'] != 'original' else None
        decoder = model_catalog.load_student(selected['decoderModel'], 'cuda')[0] if selected['decoderModel'] != 'original' else None
        MODELS = loaded, config, coarse, decoder, selected
        MODELS_KEY = key
        STATE['loaded'] = True
    return MODELS


def generate(body):
    params, condition = body['params'], body['conditioning']
    seed = int(condition['seed'])
    if not 0 <= seed < 2**64:
        raise ValueError('Invalid seed')
    origin, start, size = int(condition['origin']), int(condition['start']), int(condition['size'])
    if origin != 6304 or not 64 <= size <= 256 or not -256 <= start <= 256:
        raise ValueError('Invalid regional conditioning bounds')
    fields = np.asarray(condition['fields'], dtype=np.float32)
    if fields.size != 5 * size * size or not np.isfinite(fields).all():
        raise ValueError('Invalid conditioning values')
    fields = fields.reshape(5, size, size)
    local_relief = np.asarray(condition.get('localRelief', np.zeros(size * size)), dtype=np.float32).reshape(size, size)
    local_weight = np.asarray(condition.get('localReliefWeight', np.zeros(size * size)), dtype=np.float32).reshape(size, size)
    if not np.isfinite(local_relief).all() or not np.isfinite(local_weight).all() or np.any(local_relief < 0) or np.any((local_weight < 0) | (local_weight > 1)):
        raise ValueError('Invalid local relief masks')
    steps = int(number(params, 'steps', 4, 1, 32))
    noise = [number(params, 'noise', .05, .001, 2)] + [number(params, key, .5, .001, 10) for key in
             ('noiseTemperature', 'noiseTemperatureStd', 'noisePrecipitation', 'noisePrecipitationCv')]
    histogram = [float(v) for v in params.get('histogram', '0,0,0,0,0').split(',')]
    if len(histogram) != 5 or not all(math.isfinite(v) for v in histogram):
        raise ValueError('Invalid histogram')
    detail = number(params, 'detail', 1, 0, 5)
    relief_scale = number(params, 'reliefScale', 1, 0, 5)
    relief_fixed = number(params, 'reliefFixed', 0, 0, 5000) if 'reliefFixed' in params else None
    selected = model_catalog.selection(params)
    if selected['baseModel'] == 'residual8k':
        STATE.update(state='generating', message='Python : Coarse2 -> flow résiduel 8k -> décodeur')
        return model_catalog.generate_finite(condition | {'edited': bool(body.get('edited'))}, params, seed)
    loaded, config, coarse, decoder, selected = models(seed, params)
    if coarse is not None:
        coarse.solver.steps = steps
        coarse.config = replace(coarse.config, solver_steps=steps)
    world = WorldPipeline(**(config | dict(seed=seed, dtype='bf16', T=2, latents_batch_size=16,
                          torch_compile=False, onestep_latent=True, cache_limit=512 * 1024**2, log_mode='silent')))
    world.coarse_model, world.base_model, world.decoder_model = loaded.coarse_model, loaded.base_model, loaded.decoder_model
    configure_world(world, replace(loaded._terrain_profile, cuda_graphs=False, decoder_graphs=False,
                    coarse_solver_graphs=False, coarse_streams=1), world_profile='natural')
    world.kwargs['cond_snr'] = noise
    world.kwargs['histogram_raw'] = histogram
    world.kwargs['residual_std'] *= detail

    def factory(x0, y0, x1, y1):
        a, b, c, d = x0 - start, y0 - start, x1 - start, y1 - start
        if min(a, b) < 0 or max(c, d) > size:
            raise ValueError(f'Conditioning window outside supplied field: {(x0, y0, x1, y1)}')
        return torch.from_numpy(fields[:, b:d, a:c].copy())

    def init_conditioning(self):
        self.synthetic_map_factory = factory

    world._init_conditioning = MethodType(init_conditioning, world)
    install(world, {key: value for key, value in {'coarse': coarse, 'decoder': decoder}.items() if value is not None})
    original_build = world._build_coarse_stage

    def build_coarse(self):
        tensor = original_build()
        original = tensor._f

        def tuned(*args, **kwargs):
            outputs = original(*args, **kwargs)
            for ctx, output in zip(args[0], outputs):
                weight = output[-1:].clamp_min(1e-12)
                mean_root, p5_root = output[0:1] / weight, output[1:2] / weight
                mean = mean_root.sign() * mean_root.square()
                spread = mean - p5_root.sign() * p5_root.square()
                desired = spread * relief_scale if relief_fixed is None else torch.full_like(spread, relief_fixed)
                _, tile_y, tile_x = ctx
                yy, xx = tile_y * 48 - start, tile_x * 48 - start
                h, w = output.shape[-2:]
                if yy < 0 or xx < 0 or yy + h > size or xx + w > size:
                    raise ValueError('Local relief window outside conditioning')
                mask = torch.as_tensor(local_weight[yy:yy+h, xx:xx+w].copy(), device=desired.device, dtype=desired.dtype)[None]
                target = torch.as_tensor(local_relief[yy:yy+h, xx:xx+w].copy(), device=desired.device, dtype=desired.dtype)[None]
                desired = desired * (1 - mask) + target * mask
                p5 = mean - desired
                output[1:2] = p5.sign() * p5.abs().sqrt() * weight
            return outputs

        tensor._f = tuned
        return tensor

    world._build_coarse_stage = MethodType(build_coarse, world)
    counts, timings, hooks = [0, 0, 0], [0.0, 0.0, 0.0], []
    for i, model in enumerate((coarse.solver.net if coarse is not None else loaded.coarse_model,
                               loaded.base_model, decoder if decoder is not None else loaded.decoder_model)):
        events = []

        def before(module, args, i=i, events=events):
            if not args[0].is_cuda:
                raise RuntimeError('Neural inference must execute on CUDA')
            counts[i] += args[0].shape[0]
            event = torch.cuda.Event(enable_timing=True)
            event.record()
            events.append(event)

        def after(module, args, output, i=i, events=events):
            event = torch.cuda.Event(enable_timing=True)
            event.record()
            # Read after completion of this map; retain events without synchronizing each layer.
            timings[i] = timings[i] if isinstance(timings[i], list) else []
            timings[i].append((events.pop(), event))

        hooks += [model.register_forward_pre_hook(before), model.register_forward_hook(after)]
    retained_world = False
    try:
        world.bind()
        STATE.update(state='generating', message='Python : coarse -> base -> decoder sur CUDA')
        torch.cuda.synchronize()
        began = time.perf_counter()
        native_size = math.ceil(40000 / 30)
        with torch.inference_mode():
            heights = world.get(origin, origin, origin + native_size, origin + native_size, with_climate=False)['elev'].float().cpu().numpy()
        torch.cuda.synchronize()
        coordinates = (np.arange(1024, dtype=np.float64) + .5) * 40000 / 1024 / 30 - .5
        yy, xx = np.meshgrid(coordinates, coordinates, indexing='ij')
        heights = map_coordinates(heights, [yy, xx], order=1, mode='nearest').astype('<f4')
        if not np.isfinite(heights).all():
            raise RuntimeError('Python produced non-finite heights')
        stage_ms = [sum(a.elapsed_time(b) for a, b in pairs) if isinstance(pairs, list) else 0 for pairs in timings]
        total_ms = (time.perf_counter() - began) * 1000
        profile = 'coarse4-original-base-t1-decoder' if selected == model_catalog.catalog()['defaults'] else '-'.join(selected.values())
        meta = dict(backend='python-cuda', precision='bf16', profile=profile,
                    totalMs=total_ms, coarseMs=stage_ms[0], baseMs=stage_ms[1], decoderMs=stage_ms[2],
                    reconstructionMs=max(0, total_ms - sum(stage_ms)), evaluations=counts,
                    land=float(np.mean(heights > 0)), edited=bool(body.get('edited')), sketchRegion=True, zoneConditioning=1,
                    **model_catalog.model_info(selected))
        meta['neuralSeed'] = str(seed)
        meta['neuralToken'] = refinement.retain_world(world, origin)
        retained_world = True
        return heights.tobytes(), meta
    finally:
        for hook in hooks:
            hook.remove()
        if not retained_world:
            world.close()


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body, content_type='application/json', meta=None):
        self.send_response(code)
        self.send_header('Content-Type', content_type + '; charset=utf-8' if content_type == 'application/json' else content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Expose-Headers', 'X-Neural-Meta')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        if meta is not None:
            self.send_header('X-Neural-Meta', json.dumps(meta, separators=(',', ':')))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(200, b'{}')

    def do_GET(self):
        if urlparse(self.path).path == '/status':
            self.reply(200, json.dumps(dict(STATE, refinement=refinement.status())).encode())
        elif urlparse(self.path).path == '/models':
            self.reply(200, json.dumps(model_catalog.catalog()).encode())
        else:
            self.reply(404, b'{"error":"Not found"}')

    def do_POST(self):
        global MODELS, MODELS_KEY
        if urlparse(self.path).path == '/release':
            with LOCK:
                refinement.release()
                MODELS = None
                MODELS_KEY = None
                model_catalog.release()
                for device in list(terrain_app.pipelines):
                    terrain_app.release_pipeline(device)
                gc.collect()
                torch.cuda.empty_cache()
                STATE.update(state='ready', loaded=False, message='Python/CUDA pret ; GPU libere')
            self.reply(200, b'{"released":true}')
            return
        path = urlparse(self.path).path
        if path not in ('/generate', '/refinement/register', '/refinement/tile', '/refinement/release'):
            self.reply(404, b'{"error":"Not found"}')
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 12 * 1024**2:
                raise ValueError('Invalid request size')
            body = json.loads(self.rfile.read(length))
            with LOCK:
                if path == '/refinement/register':
                    self.reply(200, json.dumps(refinement.register(body)).encode())
                elif path == '/refinement/release':
                    self.reply(200, json.dumps(refinement.release(body)).encode())
                elif path == '/refinement/tile':
                    data, meta = refinement.tile(body)
                    self.reply(200, data, 'application/octet-stream', meta)
                else:
                    data, meta = generate(body)
                    STATE.update(state='ready', message='Python/CUDA pret', generated=STATE['generated'] + 1)
                    self.reply(200, data, 'application/octet-stream', meta)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            STATE.update(state='ready', message=f'Python : dernier calcul en echec : {exc}')
            self.reply(400 if isinstance(exc, (ValueError, KeyError)) else 500, json.dumps({'error': str(exc)}).encode())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8793)
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise SystemExit('CUDA unavailable: Neuronal Python requires an NVIDIA GPU.')
    torch.set_num_threads(4)
    torch.backends.cudnn.benchmark = False
    print(f'Neuronal Python/CUDA : http://127.0.0.1:{args.port} ; {torch.cuda.get_device_name()}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
