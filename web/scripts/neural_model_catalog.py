"""Verified local model choices and Neural Earth's finite residual tile path."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'rust/models/neural-earth'
TEACHER_REVISION = '9ef8030cb805b433b98ec25c5dddefbac07a9e26'
_inventory = json.loads((ASSETS / 'model-inventory.json').read_text())
_catalog = json.loads((ASSETS / 'catalog.json').read_text())
_verified = set()
_finite = None
_finite_key = None


def catalog():
    return _catalog | {'inventory': _inventory, 'bundledBytes': sum(v['bytes'] for v in _inventory['models'].values())}


def selection(params):
    result = {key: params.get(key, value) for key, value in _catalog['defaults'].items()}
    for stage in ('coarse', 'base', 'decoder'):
        if result[stage + 'Model'] not in {row['id'] for row in _catalog[stage]}:
            raise ValueError(f'Unknown {stage} model: {result[stage + "Model"]}')
    if result['baseModel'] == 'residual8k':
        if result['coarseModel'] != 'coarse2' or result['decoderModel'] not in ('decoder16', 'decoder64'):
            raise ValueError('Residual8k requires its pinned Coarse2 weights and Decoder16 or Decoder64.')
    return result


def verified_model(key):
    entry = _inventory['models'][key]
    path = ASSETS / entry['file']
    if key not in _verified:
        with path.open('rb') as handle:
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        if path.stat().st_size != entry['bytes'] or entry['bytes'] >= 100000000 or digest != entry['sha256']:
            raise RuntimeError(f'Neural model integrity failed: {key}')
        _verified.add(key)
    return path


def model_info(selected):
    identities = []
    for stage, key in selected.items():
        entry = _inventory['models'].get(key if key != 'original' else 'coarse_original' if stage == 'coarseModel' else '')
        identities.append(entry['sha256'] if entry else f'{stage}:{key}:{TEACHER_REVISION}')
    return {'selectedModels': selected, 'modelIdentity': ':'.join(identities),
            'modelRevision': _catalog['sourceRevision'], 'experimental': selected['baseModel'] == 'residual8k'}


def load_student(key, device='cuda'):
    """Build the pinned architecture without fetching parent checkpoint weights."""
    import torch
    from distill.student import Student, StudentConfig
    saved = torch.load(verified_model(key), map_location='cpu', weights_only=True)
    config = saved['config'].copy()
    config['dilations'] = tuple(config['dilations'])
    config = StudentConfig(**config)
    if saved.get('flow_architecture'):
        from neural_earth_tile40.tile40_flow_network import ARCHITECTURE, TimeFlow
        if saved['flow_architecture'] != ARCHITECTURE:
            raise ValueError('Unknown residual model architecture.')
        model = TimeFlow(config)
    elif config.solver_steps:
        from distill.coarse_solver import CoarseSolver
        from terrain_diffusion.models.edm_unet import EDMUnet2D
        # Student.__init__ would reload the original model before replacing all
        # its tensors. Only the small, bundled architecture is needed here.
        model = Student.__new__(Student)
        torch.nn.Module.__init__(model)
        model.config = config
        solver = CoarseSolver.__new__(CoarseSolver)
        torch.nn.Module.__init__(solver)
        solver.net = EDMUnet2D.from_config(json.loads((ASSETS / 'coarse-config.json').read_text()))
        parameters = json.loads((ASSETS / 'pipeline-config.json').read_text())
        solver.steps, solver.delta_ratio = config.solver_steps, parameters['coarse_stds'][1] / parameters['coarse_stds'][0]
        model.solver = solver
    else:
        model = Student(config)
    model.load_state_dict(saved['model'], strict=True)
    return model.to(device).eval().requires_grad_(False), saved


def load_original_coarse(device='cuda'):
    from safetensors.torch import load_file
    from terrain_diffusion.models.edm_unet import EDMUnet2D
    import torch
    model = EDMUnet2D.from_config(json.loads((ASSETS / 'coarse-config.json').read_text()))
    model.load_state_dict(load_file(str(verified_model('coarse_original'))), strict=True)
    return model.to(device=device, dtype=torch.bfloat16).eval().requires_grad_(False)


def release():
    global _finite, _finite_key
    _finite = _finite_key = None


def finite_generator(decoder, device='cuda'):
    global _finite, _finite_key
    if _finite is None or _finite_key != (decoder, device):
        from neural_earth_tile40.tile40_export_utils import ExportCoarse
        from neural_earth_tile40.tile40_flow_runtime import FiniteFlowEncoder
        from neural_earth_tile40.tile40_runtime import Tile40
        coarse, _ = load_student('coarse2', device)
        base, saved = load_student('residual8k', device)
        if saved['contract']['coarse_sha256'] != _inventory['models']['coarse2']['sha256']:
            raise RuntimeError('The residual base requires a different Coarse2 artifact.')
        decoder_net, _ = load_student(decoder, device)
        parameters = json.loads((ASSETS / 'pipeline-config.json').read_text())
        parameters['histogram_raw'] = parameters['histogram_raw'] or [0.] * 5
        _finite = Tile40(ExportCoarse(coarse.solver), FiniteFlowEncoder(base, saved['contract'], steps=4),
                         decoder_net, parameters, device, whole_decoder=decoder == 'decoder16')
        _finite_key = (decoder, device)
    return _finite


def generate_finite(condition, params, seed, device='cuda'):
    """Execute the actual finite flow; no original base or teacher latents."""
    import numpy as np
    import torch
    from scipy.ndimage import map_coordinates
    from neural_earth_tile40.tile40_height import guided_reference, resample_tile
    selected = selection(params)
    generator = finite_generator(selected['decoderModel'], device)
    size, start, origin = int(condition['size']), int(condition['start']), int(condition['origin'])
    fields = np.asarray(condition['fields'], np.float32).reshape(5, size, size)
    offset = origin / 256. - start

    def sample(values, xs, ys):
        yy, xx = np.meshgrid(np.asarray(ys) + offset, np.asarray(xs) + offset, indexing='ij')
        return map_coordinates(values, (yy, xx), order=1, mode='nearest', prefilter=False)

    class Conditioning:
        def __call__(self, x0, y0, x1, y1):
            return torch.from_numpy(np.stack([sample(field, np.arange(x0, x1), np.arange(y0, y1)) for field in fields]))

    factory = Conditioning()
    axis = np.linspace(0., 40000., 16) / 7680. - .5
    root = sample(fields[0], axis, axis)
    factory.elevation = np.sign(root) * np.square(root)
    generator.parameters['cond_snr'] = [float(params.get('noise', .05))] + [float(params.get(key, .5)) for key in
        ('noiseTemperature', 'noiseTemperatureStd', 'noisePrecipitation', 'noisePrecipitationCv')]
    generator.parameters['histogram_raw'] = [float(v) for v in params.get('histogram', '0,0,0,0,0').split(',')]
    generator.detail_gain = float(params.get('detail', 1.))
    generator.synchronize()
    began = time.perf_counter()
    with torch.inference_mode():
        coarse = generator.coarse_fields(factory, seed)
        mean = np.sign(coarse[0]) * np.square(coarse[0])
        p5 = np.sign(coarse[1]) * np.square(coarse[1])
        desired = np.maximum(0., mean - p5) * float(params.get('reliefScale', 1.))
        if 'reliefFixed' in params:
            desired.fill(float(params['reliefFixed']))
        coords = np.arange(generator.coarse_origin, generator.coarse_end)
        local = np.asarray(condition.get('localRelief', np.zeros(size * size)), np.float32).reshape(size, size)
        strength = np.asarray(condition.get('localReliefWeight', np.zeros(size * size)), np.float32).reshape(size, size)
        mask = np.clip(sample(strength, coords, coords), 0., 1.)
        desired = desired * (1 - mask) + sample(local, coords, coords) * mask
        p5 = mean - desired
        coarse[1] = np.sign(p5) * np.sqrt(np.abs(p5))
        generator.synchronize()
        coarse_done = time.perf_counter()
        latents = generator.encode_fields(coarse, seed)
        generator.synchronize()
        base_done = time.perf_counter()
        native = generator.decode_latents(latents, seed)
        generator.synchronize()
        decoder_done = time.perf_counter()
        guided = guided_reference(native, factory.elevation)
        heights = resample_tile(guided['native_height'], pixels=1024).astype('<f4')
    done = time.perf_counter()
    if not np.isfinite(heights).all():
        raise RuntimeError('The residual model produced non-finite elevations.')
    from neural_earth_tile40.tile40_runtime import ROOT_ORIGIN, ROOT_SIZE, window_origins
    evaluations = [len(window_origins(generator.coarse_origin, generator.coarse_end, 64, 48))**2 * generator.coarse.steps,
                   generator.encoder.steps * 2,
                   1 if generator.whole_decoder else len(window_origins(ROOT_ORIGIN, ROOT_ORIGIN + ROOT_SIZE, 512, 384))**2]
    meta = dict(backend='python-cuda' if str(device).startswith('cuda') else 'python-cpu', precision='fp32-mixed-bf16',
                profile=f'coarse2-residual48-8k-midpoint4-{selected["decoderModel"]}',
                totalMs=(done-began)*1000, coarseMs=(coarse_done-began)*1000,
                baseMs=(base_done-coarse_done)*1000, decoderMs=(decoder_done-base_done)*1000,
                reconstructionMs=(done-decoder_done)*1000, evaluations=evaluations,
                land=float(np.mean(heights > 0)), edited=bool(condition.get('edited')),
                sketchRegion=True, zoneConditioning=1, refinementDecoder=False, neuralSeed=str(seed),
                refinementReason='Finite residual flow has a separate latent domain; close LOD uses deterministic sparse detail.',
                **model_info(selected))
    return heights.tobytes(), meta
