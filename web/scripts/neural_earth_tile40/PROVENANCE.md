# Finite-tile inference source

Copied from [Neural Earth](https://github.com/dunkean/neural-earth) revision
`919550498b3fd7c9d4c53e575f6a2d5475f9be2d`, `distill/`:

`features.py`, `tile40_conditioning.py`, `tile40_flow_network.py`,
`tile40_flow_runtime.py`, `tile40_runtime.py`, `tile40_height.py` and
`tile40_export_utils.py`.

Local changes use package-relative imports and expose the existing decoder-detail
slider through a default-one multiplier in `Tile40.decode_latents`. Model loading
and Magna Urbis conditioning adaptation live separately in
`../neural_model_catalog.py`. No teacher-generated latent fields, training bank or
training runtime is included.

The adapters continue to use the installed sibling Terrain Diffusion architecture,
noise, Laplacian reconstruction and solver. The upstream third-party attribution
is retained in `THIRD_PARTY_NOTICES.md`; Terrain Diffusion's MIT text is in
[LICENSE-TEACHER.txt](../../../rust/models/neural-earth/LICENSE-TEACHER.txt).
This adaptation was previously distributed with Magna Urbis under GPL-3.0.
From 2026-10-30 it is combined with the AGPL-3.0-only project; original GPL
portions retain their terms under the GPL/AGPL section 13 combination provisions.
Other third-party components retain their own terms. The original
[GPL v3 text](../../../licenses/GPL-3.0.txt) remains available.
