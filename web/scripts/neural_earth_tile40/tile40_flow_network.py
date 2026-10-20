"""Finite-tile latent generator with explicit time modulation at every scale.

The Gaussian bridge is analytic; the network learns its conditional correction.
No original-decoder weights, reference tiles, or teacher latents are embedded.
"""
import math

import torch
from torch import nn
from torch.nn import functional as F

from distill.student import PixelNorm, StudentConfig


ARCHITECTURE = 'tile40-time-film-flow-v1'


class TimeBlock(nn.Module):
    def __init__(self, cin, cout, embedding):
        super().__init__()
        self.norm1, self.norm2 = PixelNorm(), PixelNorm()
        self.conv1 = nn.Conv2d(cin, cout, 3, padding=1)
        self.conv2 = nn.Conv2d(cout, cout, 3, padding=1)
        self.skip = nn.Conv2d(cin, cout, 1) if cin != cout else nn.Identity()
        self.modulation = nn.Linear(embedding, 2*cout)
        nn.init.zeros_(self.modulation.weight)
        nn.init.zeros_(self.modulation.bias)

    def forward(self, x, embedding):
        scale, shift = self.modulation(embedding).chunk(2, dim=1)
        hidden = self.conv1(F.silu(self.norm1(x)))
        hidden = self.norm2(hidden)*(1+scale[:, :, None, None])+shift[:, :, None, None]
        return (self.skip(x)+self.conv2(F.silu(hidden)))*2**-.5


class TimeFlow(nn.Module):
    def __init__(self, config=None):
        super().__init__()
        self.config = config or StudentConfig(stage='base', width=48, depth=4)
        if self.config.stage != 'base' or self.config.depth != 4:
            raise ValueError('This finite-tile architecture has four latent scales.')
        width = self.config.width
        if width < 16 or width % 16:
            raise ValueError('Width must be a positive multiple of16.')
        widths = [width*i for i in (1, 2, 3, 4)]
        embedding = width*4
        self.register_buffer('frequencies', 2*math.pi*2**torch.arange(8, dtype=torch.float32))
        self.embedding = nn.Sequential(nn.Linear(23, embedding), nn.SiLU(), nn.Linear(embedding, embedding))
        self.stem = nn.Conv2d(32, widths[0], 3, padding=1)
        self.encoders = nn.ModuleList(TimeBlock(w, w, embedding) for w in widths)
        self.down = nn.ModuleList(nn.Conv2d(a, b, 3, stride=2, padding=1) for a,b in zip(widths, widths[1:]))
        self.middle = nn.ModuleList(TimeBlock(widths[-1], widths[-1], embedding) for _ in range(2))
        self.decoders = nn.ModuleList(TimeBlock(a+b, b, embedding) for a,b in zip(reversed(widths[1:]), reversed(widths[:-1])))
        self.head = nn.Conv2d(width, 5, 3, padding=1)
        nn.init.zeros_(self.head.weight)
        nn.init.zeros_(self.head.bias)

    @property
    def halo(self):
        # A fixed finite tile is the model domain, not a crop of an infinite field.
        return 0

    def forward(self, inputs):
        if inputs.shape[-1] % 8 or inputs.shape[-2] % 8:
            raise ValueError('Finite-tile input must align to8 latent cells.')
        t = inputs[:, 5, 0, 0].float()
        frequencies = t[:, None]*self.frequencies[None]
        climate = inputs[:, 10:16].float().mean(dim=(-2, -1))
        embedding = self.embedding(torch.cat((t[:, None], frequencies.sin(), frequencies.cos(), climate), dim=1))
        x, skips = self.stem(inputs), []
        for level, block in enumerate(self.encoders):
            x = block(x, embedding)
            if level < len(self.down):
                skips.append(x)
                x = self.down[level](x)
        for block in self.middle:
            x = block(x, embedding)
        for skip, block in zip(reversed(skips), self.decoders):
            x = block(torch.cat((F.interpolate(x, scale_factor=2, mode='nearest'), skip), dim=1), embedding)
        with torch.autocast(device_type=x.device.type, enabled=False):
            correction = self.head(x.float())
            time = t[:, None, None, None]
            gaussian_velocity = (2*time-1)/((1-time).square()+time.square())
            return correction+gaussian_velocity*inputs[:, :5].float()


@torch.no_grad()
def widen_time_flow(source, target, split_noise=.05):
    """Double channel capacity while retaining the learned floating-point map.

    Balanced perturbations within duplicated input pairs sum to zero. They keep
    the initial function, but allow the two copies to learn different features.
    """
    if target.config.width != 2*source.config.width:
        raise ValueError('Only an explicit twofold TimeFlow widening is supported.')
    state={}
    for name,expected in target.state_dict().items():
        original=source.state_dict()[name]
        value=original.clone()
        if value.shape==expected.shape:
            state[name]=value
            continue
        if value.ndim not in (1,2,4):raise ValueError(f'Unexpected widening tensor:{name}')
        if expected.shape[0]==2*value.shape[0]:
            value=value.repeat_interleave(2,dim=0)
        elif expected.shape[0]!=value.shape[0]:raise ValueError(f'Unmapped output dimension:{name}')
        if value.ndim>1 and expected.shape[1]==2*value.shape[1]:
            value=value.repeat_interleave(2,dim=1)*.5
            noise=torch.randn_like(value[:,0::2])*original.float().std(unbiased=False)*split_noise
            value[:,0::2]+=noise
            value[:,1::2]-=noise
        if value.shape!=expected.shape:raise ValueError(f'Unmapped widening shape:{name}')
        state[name]=value
    target.load_state_dict(state)
    return target
