---
license: mit
base_model: xandergos/terrain-diffusion-30m
tags:
- terrain-generation
- diffusion
- distillation
- pytorch
- magna-urbis
- infinite-generation
- neural-earth
---

# Neural Earth — distilled Infinite Generation

Neural Earth — distilled Infinite Generation (*Infinite Generation distillé*) is a collection of eight PyTorch inference checkpoints from [Neural Earth](https://github.com/dunkean/neural-earth), distilled from the [Terrain Diffusion 30m](https://huggingface.co/xandergos/terrain-diffusion-30m) teacher's terrain-generation pipeline. These learned student components are distinct from the original teacher checkpoints; they are not a renamed copy of the original model. They run within the Neural Earth and Magna Urbis **Python** runtime, not as a standalone Diffusers pipeline or in the browser WASM model format. The checkpoints contain selected inference weights rather than optimizer states.

The upstream Neural Earth revision is [`919550498b3fd7c9d4c53e575f6a2d5475f9be2d`](https://github.com/dunkean/neural-earth/tree/919550498b3fd7c9d4c53e575f6a2d5475f9be2d); the teacher revision is [`9ef8030cb805b433b98ec25c5dddefbac07a9e26`](https://huggingface.co/xandergos/terrain-diffusion-30m/tree/9ef8030cb805b433b98ec25c5dddefbac07a9e26). Individual source revisions, model configuration, selected raw or EMA weights and training steps are recorded in `model-inventory.json`.

## Checkpoints

The eight files total **88,582,903 bytes**. SHA-256 values below apply to the complete files, not individual tensors.

| File | Stage and selection | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `coarse1.pt` | 1-step coarse, EMA 200k | 11,216,897 | `d0914416c8877421061445a979d63cf04331fdc3970972cc70d7cc8a0b109af8` |
| `coarse2.pt` | 2-step coarse, EMA 200k | 11,216,897 | `143f8f9d7808a242492e6e6a966e968a7b618d2950ac35cf5ac3a2e4fcaef157` |
| `coarse4.pt` | 4-step coarse, EMA 50k | 11,218,177 | `a9288d7266cdde292e04b15619054476c04bcd17b06d646ba475381179547436` |
| `coarse8.pt` | 8-step coarse, EMA 25k | 11,213,057 | `a52c4e32295f251e671b4236dc72c6ee4f35fecc85ec9201db8c371c43f76f6b` |
| `coarse8_legacy.pt` | 8-step coarse, EMA 22.5k | 11,218,177 | `17d7c752c8d4f9693c6b5aa210418f79ab4749bd0b0c3e2c06ebe058efc7458f` |
| `residual8k.pt` | finite residual base, raw 8k | 18,284,418 | `5034c3c580c42e4ee3ab8a29c2bf39a7d9ae9efe11b009193109b0b988e3edde` |
| `decoder64.pt` | width-64 decoder, EMA 200k | 13,354,360 | `ab2d35209656fb367e896d72d0d1642bfeaf0401bad92e42fe2d3f90d0ea3cf2` |
| `decoder16.pt` | width-16 decoder, EMA 10k | 860,920 | `3f4333ed1f03bcfa29935a30beef735b16021163522ac41d5ff09fbbba19d880` |

The inventory also describes the teacher's original coarse checkpoint for local verification; it is **not included** in this repository. The original continuous-world base and original decoder are distributed with the [teacher model](https://huggingface.co/xandergos/terrain-diffusion-30m), separately from these distilled files.

## Loading a checkpoint

Install `torch` and `huggingface_hub` in a compatible Python environment. This example fetches and verifies the exact `coarse2` file before inspecting its checkpoint. For reproducibility, supply the desired repository commit SHA in the optional `revision` argument of `hf_hub_download`.

```python
import hashlib
from huggingface_hub import hf_hub_download
import torch

path = hf_hub_download(repo_id="dunkean/neural-earth-distilled", filename="coarse2.pt")
with open(path, "rb") as f:
    digest = hashlib.file_digest(f, "sha256").hexdigest()
if digest != "143f8f9d7808a242492e6e6a966e968a7b618d2950ac35cf5ac3a2e4fcaef157":
    raise ValueError("Checkpoint integrity check failed")
checkpoint = torch.load(path, map_location="cpu", weights_only=True)
print(checkpoint["config"])
```

This example inspects a checkpoint; it does not instantiate an inference pipeline. Magna Urbis's `web/scripts/neural_model_catalog.py` provides `load_student` and the finite-tile integration when used with the matching Neural Earth source and Python dependencies. Its loader verifies the inventory hash and uses `weights_only=True`. Set `MAGNA_NEURAL_WEIGHTS_DIR` to the directory holding these verified files. Refer to the [Neural Earth source](https://github.com/dunkean/neural-earth/tree/919550498b3fd7c9d4c53e575f6a2d5475f9be2d/distill) for the architectures and inference code.

## Compatibility and limitations

`residual8k` is an **experimental finite-tile residual** base with its own latent domain. It requires the exact `coarse2` checkpoint listed above and either `decoder64` or `decoder16`. It uses the finite flow and guided physical reconstruction; it cannot be substituted for the original base inside the continuous-world pipeline. Its close-detail refinement is different from the original continuous-world decoder refinement. Other coarse and decoder options are intended for the corresponding Neural Earth runtime paths; consult the source and inventory when selecting components.

These models generate plausible synthetic terrain. Outputs are not measured elevation, certified geography, or a substitute for surveying or safety-critical data. Model size alone does not establish runtime memory use, generation speed, hardware requirements, or quality. The included browser-independent PyTorch checkpoints do not imply browser compatibility.

## Attribution and license

The distilled checkpoints are distributed under the MIT license in `LICENSE` (Copyright © 2026 dunkean). The original teacher and code attribution and MIT license are reproduced in `LICENSE-TEACHER.txt`.
