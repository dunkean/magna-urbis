"""Finite conditional-flow inference; independent of research data and trainers."""
import torch

def coarse_altitude_guide(inputs):
    """Available coarse mean in the original latent-altitude units.

    Bilinear interpolation is fixed, not learned or fitted to validation. Input
    origins and sides align to32 cells, just like the deployable feature grid.
    """
    import torch.nn.functional as F
    from .features import COND_MEANS, COND_STDS
    coarse=F.avg_pool2d(inputs[:,10:11].float(),32)*float(COND_STDS[0])+float(COND_MEANS[0])
    return (F.interpolate(coarse,size=inputs.shape[-2:],mode='bilinear',align_corners=False)+31.4)/38.6

def colored_prior(initial):
    """Fixed TRAIN-inspired spatial covariance;white detail channels are retained."""
    import math
    import torch.nn.functional as F
    result=initial.clone()
    for channel,sigma in ((0,.55),(4,4.)):
        radius=math.ceil(3*sigma)
        axis=torch.arange(-radius,radius+1,device=initial.device,dtype=torch.float32)
        kernel=torch.exp(-.5*(axis/sigma).square());kernel=kernel/kernel.sum()
        field=initial[:,channel:channel+1]
        field=F.conv2d(F.pad(field,(radius,radius,0,0),mode='reflect'),kernel.view(1,1,1,-1))
        field=F.conv2d(F.pad(field,(0,0,radius,radius),mode='reflect'),kernel.view(1,1,-1,1))
        # Analytic interior variance of the separable filter;no per-tile rescaling.
        result[:,channel:channel+1]=field/kernel.square().sum()
    return result

def velocity(model, state, time_value, conditioning):
    inputs = conditioning.clone()
    inputs[:, :5] = state
    inputs[:, 5] = time_value
    with torch.autocast(state.device.type, dtype=torch.bfloat16, enabled=state.device.type=='cuda'):
        return model(inputs)

def midpoint(model, initial, conditioning, steps=2, schedule=None):
    if steps < 1:
        raise ValueError('At least one flow interval required.')
    grid = list(schedule) if schedule is not None else [index/steps for index in range(steps+1)]
    if grid[0] != 0. or grid[-1] != 1. or any(b <= a for a,b in zip(grid, grid[1:])):
        raise ValueError('An increasing flow schedule from0 to1 is required.')
    state = initial
    for t, end in zip(grid, grid[1:]):
        dt = end-t
        first = velocity(model, state, t, conditioning)
        middle = state+first*(dt*.5)
        state = state+velocity(model, middle, t+dt*.5, conditioning)*dt
    return state

class FiniteFlowEncoder(torch.nn.Module):
    """A single finite tile with its own padded boundary at every flow step."""
    def __init__(self,model,contract,steps=8,split=.5):
        super().__init__()
        self.model,self.steps,self.config=model,steps,model.config
        self.halo=0
        self.colored=bool(contract.get('colored_prior'))
        self.residual_altitude=bool(contract.get('residual_altitude'))
        self.schedule=(0.,split,1.) if steps==2 else None
        self.register_buffer('mean',torch.tensor(contract['latent_mean'])[None,:,None,None])
        self.register_buffer('std',torch.tensor(contract['latent_std'])[None,:,None,None])

    def forward(self, inputs):
        initial = inputs[:, :5].clone()
        if self.colored:
            initial = colored_prior(initial)
        conditioning = inputs.clone()
        conditioning[:, :10].zero_()
        latent=midpoint(self.model, initial, conditioning, self.steps, self.schedule)*self.std+self.mean
        if self.residual_altitude:
            latent=torch.cat((latent[:,:4],latent[:,4:5]+coarse_altitude_guide(conditioning)),dim=1)
        return latent
