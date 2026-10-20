"""Complete40km generator from physical sketch,climate and seed only.

Python is the numerical reference for the browser port. Native timings are
explicitly NOT browser acceptance evidence. Hidden coarse/latent fields never
need teacher inference;the three deployed models compute them from the inputs.
"""
import math
import time

import numpy as np
import torch

from .features import base_features, coarse_features, decoder_features, noise
from .tile40_conditioning import SketchConditioning
from .tile40_height import guided_reference,resample_tile

COARSE_ORIGIN = -8
COARSE_SIZE = 24
LATENT_ORIGIN = -64
LATENT_SIZE = 320
ROOT_ORIGIN = -256
ROOT_SIZE = 1856


def window_origins(start, end, size, stride):
    if end <= start or size < stride or stride <= 0:
        raise ValueError('A nonempty region and an overlapping positive window stride are required.')
    first = math.floor((start-size)/stride)+1
    last = math.ceil(end/stride)
    return [index*stride for index in range(first, last)]


def add_window(canvas, weights, prediction, weight, y, x, origin):
    size = prediction.shape[-1]
    y0, x0 = max(y, origin), max(x, origin)
    y1, x1 = min(y+size, origin+canvas.shape[-2]), min(x+size, origin+canvas.shape[-1])
    if y1 <= y0 or x1 <= x0:
        return
    sy, sx = slice(y0-y, y1-y), slice(x0-x, x1-x)
    dy, dx = slice(y0-origin, y1-origin), slice(x0-origin, x1-origin)
    w = weight[sy, sx]
    canvas[:, dy, dx] += prediction[:, sy, sx]*w
    weights[dy, dx] += w


def normalized_canvas(canvas, weights):
    if not torch.isfinite(canvas).all() or not torch.isfinite(weights).all() or not torch.all(weights > 0):
        raise ValueError('The final tile has incomplete or nonfinite internal window coverage.')
    return canvas/weights[None]


def coarse_input(factory, parameters, seed, y, x):
    means = torch.tensor(parameters['coarse_means'], dtype=torch.float32)
    stds = torch.tensor(parameters['coarse_stds'], dtype=torch.float32)
    selected = [0, 2, 3, 4, 5]
    raw = factory(x, y, x+64, y+64)
    synthetic = ((raw-means[selected, None, None])/stds[selected, None, None]).to(torch.bfloat16)
    theta = torch.atan(torch.tensor(parameters['cond_snr'])).to(torch.bfloat16)
    conditional_noise = noise(seed, y, x, 64, 64, 5).to(torch.bfloat16)
    condition = torch.cos(theta[:, None, None])*synthetic+torch.sin(theta[:, None, None])*conditional_noise
    labels = torch.log(torch.tan(theta)/8.)
    return coarse_features(condition.float(), labels.float(), seed, y, x)[None]


class Tile40:
    def __init__(self, coarse, encoder, decoder, parameters, device='cpu', *, whole_decoder=False):
        self.coarse = coarse.eval().requires_grad_(False)
        self.encoder = encoder.eval().requires_grad_(False)
        self.decoder = decoder.eval().requires_grad_(False)
        self.parameters, self.device = parameters, torch.device(device)
        self.whole_decoder = whole_decoder
        self.coarse_origin = min(COARSE_ORIGIN, math.floor((LATENT_ORIGIN-encoder.halo)/32))
        self.coarse_end = max(COARSE_ORIGIN+COARSE_SIZE, math.ceil((LATENT_ORIGIN+LATENT_SIZE+encoder.halo)/32))
        self.coarse_size = self.coarse_end-self.coarse_origin
        for model in (coarse, encoder, decoder):
            model.to(self.device)
        if encoder.config.stage != 'base' or decoder.config.stage != 'decoder':
            raise ValueError('The two final model interfaces changed.')
        if parameters['coarse_pooling'] != 1 or parameters['residual_mean'] != 0. or parameters['residual_std'] != .7:
            raise ValueError('Only the pinned physical scaling is supported.')

    def synchronize(self):
        if self.device.type == 'cuda':
            torch.cuda.synchronize(self.device)

    @torch.no_grad()
    def coarse_fields(self, factory, seed):
        from terrain_diffusion.inference.world_pipeline import linear_weight_window
        canvas = torch.zeros(6, self.coarse_size, self.coarse_size, device=self.device)
        weights = torch.zeros(self.coarse_size, self.coarse_size, device=self.device)
        weight = linear_weight_window(64, self.device, torch.float32)
        means = np.asarray(self.parameters['coarse_means'], np.float32).copy()
        stds = np.asarray(self.parameters['coarse_stds'], np.float32).copy()
        means[1], stds[1] = means[0]-means[1], stds[0]
        means = torch.from_numpy(means).to(self.device)[:, None, None]
        stds = torch.from_numpy(stds).to(self.device)[:, None, None]
        origins = window_origins(self.coarse_origin, self.coarse_end, 64, 48)
        for y in origins:
            for x in origins:
                inputs = coarse_input(factory, self.parameters, seed, y, x).to(self.device)
                with torch.autocast(self.device.type, enabled=False):
                    prediction = self.coarse(inputs)[0].float()*stds+means
                add_window(canvas, weights, prediction, weight, y, x, self.coarse_origin)
        return normalized_canvas(canvas, weights).cpu().numpy()

    @torch.no_grad()
    def encode_fields(self, coarse, seed):
        halo = self.encoder.halo
        size = LATENT_SIZE+2*halo
        inputs = base_features(coarse, self.coarse_origin, self.coarse_origin, seed,
            LATENT_ORIGIN-halo, LATENT_ORIGIN-halo, size, self.parameters['histogram_raw'])[None].to(self.device)
        with torch.autocast(self.device.type, enabled=False):
            return self.encoder(inputs)[0, :, halo:halo+LATENT_SIZE, halo:halo+LATENT_SIZE].float()

    @torch.no_grad()
    def decode_latents(self, latents, seed):
        """Decoder component;provided teacher latents would be an explicit oracle."""
        from terrain_diffusion.inference.world_pipeline import linear_weight_window
        from terrain_diffusion.data.laplacian_encoder import laplacian_decode, laplacian_denoise
        if latents.shape != (5, LATENT_SIZE, LATENT_SIZE):
            raise ValueError('Full320-square latent and decoder-halo coverage required.')
        start = ROOT_ORIGIN//8-LATENT_ORIGIN
        if self.whole_decoder:
            fields = latents[:4, start:start+ROOT_SIZE//8, start:start+ROOT_SIZE//8].cpu()
            inputs = decoder_features(fields, seed, ROOT_ORIGIN, ROOT_ORIGIN,
                                      ROOT_SIZE, noise_tile=512)[None].to(self.device)
            with torch.autocast(self.device.type, enabled=False):
                residual = self.decoder(inputs).float()*.7*getattr(self, 'detail_gain', 1.)
        else:
            canvas = torch.zeros(1, ROOT_SIZE, ROOT_SIZE, device=self.device)
            weights = torch.zeros(ROOT_SIZE, ROOT_SIZE, device=self.device)
            weight = linear_weight_window(512, self.device, torch.float32)
            origins = window_origins(ROOT_ORIGIN, ROOT_ORIGIN+ROOT_SIZE, 512, 384)
            for y in origins:
                for x in origins:
                    ly, lx = y//8-LATENT_ORIGIN, x//8-LATENT_ORIGIN
                    fields = latents[:4, ly:ly+64, lx:lx+64].cpu()
                    if fields.shape != (4, 64, 64):
                        raise ValueError('A decoder window exceeded the generated latent halo.')
                    inputs = decoder_features(fields, seed, y, x)[None].to(self.device)
                    with torch.autocast(self.device.type, enabled=False):
                        prediction = self.decoder(inputs)[0].float()
                    add_window(canvas, weights, prediction, weight, y, x, ROOT_ORIGIN)
            residual = normalized_canvas(canvas, weights)[None]*.7*getattr(self, 'detail_gain', 1.)
        low = latents[4:5, start:start+ROOT_SIZE//8, start:start+ROOT_SIZE//8][None]*38.6-31.4
        # The final tile sits7680m inside this reconstruction boundary. This
        # avoids extra512px windows for a48px outer strip. Measure its effect
        # against full teacher acquisition;do not call this exact upstream edge handling.
        residual, low = laplacian_denoise(residual, low, sigma=5)
        root = laplacian_decode(residual, low)[0, 0]
        return (root.sign()*root.square()).cpu().numpy()

    @torch.no_grad()
    def generate(self, sketch_m, climate, seed, trace=False):
        factory = SketchConditioning(sketch_m, climate)
        self.synchronize()
        started = time.perf_counter()
        coarse = self.coarse_fields(factory, seed)
        self.synchronize()
        coarse_finished = time.perf_counter()
        latents = self.encode_fields(coarse, seed)
        self.synchronize()
        encoder_finished = time.perf_counter()
        native = self.decode_latents(latents, seed)
        decoder_finished = time.perf_counter()
        guided = guided_reference(native, factory.elevation)
        height = resample_tile(guided['native_height'])
        finished = time.perf_counter()
        result = dict(height_m=height, timing=dict(coarse_seconds=coarse_finished-started,
            encoder_seconds=encoder_finished-coarse_finished, decoder_seconds=decoder_finished-encoder_finished,
            reconstruction_seconds=finished-decoder_finished, native_total_seconds=finished-started,
            scope='Python numerical reference only;not browser latency.'), side_m=40000., spacing_m=40000./1334)
        if trace:
            result.update(coarse=coarse, latents=latents.cpu().numpy(), native_height_m=native,
                          root_detail=guided['root_detail'])
        return result
