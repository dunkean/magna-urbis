"""Portable inference wrappers; no training data or research runtime required."""
import copy
import torch


class EncoderRegion(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model, self.halo = model, model.halo

    def forward(self, inputs):
        return self.model(inputs)[..., self.halo:self.halo+320, self.halo:self.halo+320]

def compact_decoder_input(model):
    """Drop the11 identically-zero inputs before both external convolutions."""
    target = copy.deepcopy(model)
    for name in ('stem', 'direct'):
        old = getattr(target, name)
        layer = torch.nn.Conv2d(5, old.out_channels, old.kernel_size, stride=old.stride,
                               padding=old.padding, bias=old.bias is not None)
        with torch.no_grad():
            layer.weight.copy_(old.weight[:, :5])
            if old.bias is not None:
                layer.bias.copy_(old.bias)
        setattr(target, name, layer)
    return target.eval().requires_grad_(False)

class ExportCoarse(torch.nn.Module):
    """CPU FP32 equivalent without the training-only functional parameter cast."""
    def __init__(self, solver):
        super().__init__()
        self.net = solver.net
        self.steps, self.delta_ratio = solver.steps, solver.delta_ratio

    def forward(self, features):
        from terrain_diffusion.scheduler.dpmsolver import EDMDPMSolverMultistepScheduler
        scheduler = EDMDPMSolverMultistepScheduler(sigma_min=.002, sigma_max=80, sigma_data=.5)
        scheduler.set_timesteps(self.steps)
        sample = features[:, :6]*scheduler.sigmas[0]
        labels = [features[:, i, 0, 0] for i in range(11, 16)]
        for index in range(self.steps):
            sigma = scheduler.sigmas[index]
            inputs = torch.cat((scheduler.precondition_inputs(sample, sigma), features[:, 6:11]), dim=1)
            noise_labels = scheduler.trigflow_precondition_noise(sigma.to(features.device).view(-1)).expand(features.shape[0])
            velocity = self.net(inputs, noise_labels=noise_labels, conditional_inputs=labels)
            sample = scheduler.step(velocity, scheduler.timesteps[index], sample).prev_sample
        output = sample/scheduler.config.sigma_data
        return torch.cat((output[:, :1], output[:, :1]-output[:, 1:2]*self.delta_ratio, output[:, 2:]), dim=1)
