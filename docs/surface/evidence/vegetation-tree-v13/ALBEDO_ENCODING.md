# Measured high/impostor albedo encoding correction

The same-camera [support-culling pair](HIGH_SUPPORT_CULLING.md) confirmed a large
lighting pop. A separate diagnostic rendered actual high/impostor MultiMeshes at
identical TOP transforms,768²/20m (522px crown diameter), with production vertex,
texture, alpha and normal code. Explicit channel overrides isolated unlit albedo,
world normals, front/back faces and roughness. A0.25/0.5/0.75 calibration verified
sRGB framebuffer decoding. [albedo-encoding-correction.json](albedo-encoding-correction.json)
contains the raw reports, artifact hashes, image invariants and corrected descriptor.

The first control already differed **without lighting**: mean linear RGB was
high`[.01818,.02834,.00827]` versus impostor`[.09516,.15122,.04726]`. Thus lighting
or normal averaging alone could not explain the main error.

CPU inspection localized it in the exported leaf base-color PNG, not in the
runtime sampler. The pinned original16bit source has mean encoded RGB
`[.40084,.46741,.22950]` over exported-alpha pixels; its linear mean is
`[.14337,.19194,.04541]`. The combined PNG embedded by the exporter instead has
encoded values`[.13755,.18339,.04322]`: approximately linear source values stored
in glTF's sRGB base-color slot. The correct `source_color` sampler decodes those
values a second time. Material factors are1, leaf UV0 is shared by color/normal/
roughness, and the JSON-only alpha-cutoff patch was not the source of this bug.

## Producer correction

`fix_tree_glb_albedo.py` creates a **new** prepared directory. It checks the pinned
CC0 source SHA and rebuilds the embedded leaf image with original16bit sRGB RGB
values and the exported alpha8 expanded exactly to alpha16 (`byte×257`). The
original alpha8 plane and all normalized alpha values remain exact. The script
appends the corrected PNG to GLB BIN; **all original BIN bytes** remain unchanged.
Accessors, meshes, positions, indices, UVs, normals, tangents, materials and every
other image view remain unchanged. This is an encoding correction, not a color
gain, source alteration or new geometry.

The A8 mask, optical LUT, all five packed impostor products and root normalization
are copied unchanged. GPU coverage, normal and roughness PNGs are byte-identical
before/after for both LODs; impostor albedo/lit PNGs are also byte-identical. Only
the high albedo response changes. The old negative product stays untouched.

The new GLB SHA is`b6d29721da4b47dcbe7cab34c4180ee18c766558fe0341bc9a2889992a3eb93b`.
Source artifact digest is`448060befa93602b93cab63e08419335b75d651a0eab3dee9b7819f19761148c`;
consumer digest is`74edf966059a17fd44df22d24f4ee055f780d84196ee9c54703fa3b9e46ecbe9`.
The descriptor's normal hash invalidation applies; no canonical World version,
height, candidate, recipe, C/V mask or mean-cover calibration is changed.

## Measured result and remaining limits

Under the same diagnostic light, corrected unlit high mean becomes
`[.10574,.16650,.05233]`; the impostor stays`[.09516,.15122,.04726]`. Lit high is
`[.08835,.12476,.03257]`, impostor`[.08783,.12492,.03201]`. The previous large mean
brightness discontinuity disappears in **this control** without an empirical fit.
Per-pixel differences and variance remain. These means do not certify arbitrary
sky, sun, view or roughness, nor source RGB equality at every raster sample.

Other measured differences remain: high mean positive normal/sun dot0.4997 versus
impostor0.5565; common-pixel normal difference29.07°. Removing the high face flip
makes that angle worse(32.45°), so it is not adopted as a fix. High roughness mean
is0.4755 versus the impostor's historical hardcoded0.9. Normal averaging/variance,
roughness transport and oblique response remain separate work. No normal oracle,
BRDF parity or artistic final acceptance is claimed from these means.

- [Unlit high before](albedo-unlit-before.png) / [after](albedo-unlit-after.png)
- [Lit high before](albedo-lit-before.png) / [after](albedo-lit-after.png)

## Reproduction

The measured Python environment used NumPy2.3.5, Pillow11.3.0 and native
OpenCV4.13.0 (`opencv-contrib-python4.13.0.92`); PNG operations use one CPU thread,
not GPU. The pinned source is16bit RGBA. An initial tool version rejected it
before producing output; the final implementation preserves that precision.

```powershell
python viewer-local/tools/fix_tree_glb_albedo.py --prepared <old-prepared> --source-root <pinned-source> --source-manifest surface/vegetation/tree-offline-source.json --out <NEW-prepared>
godot --audio-driver Dummy --headless --path viewer-local --script tools/refresh_tree_descriptor.gd -- <NEW-prepared>
godot --audio-driver Dummy --path viewer-local --rendering-method forward_plus --gpu-index 0 --script diagnostics/tree_asset_brdf_probe.gd -- <NEW-prepared/resolved.json> <output-folder>
```

The fast refresh command reuses an already resolved/packed input cache. When
starting from fresh Blender output without `resolved.json`, use the original
`tools/resolve_tree_assets.gd` with the unchanged mask-calibration JSON instead.
It now preserves the encoding-correction provenance. The library reports that
policy in its renderer version metadata. Never overwrite the old V13 cache or
quietly relabel its negative captures as corrected results.
