# Experimental tree consumer

The opt-in renderer is now implemented by `--tree-assets <resolved.json>` in
aerial views. Its budget, filtering certificate and approximations are described
in [the renderer contract](evidence/vegetation-tree-v13/EXPERIMENTAL_RENDERER.md).
The [bounded GPU evidence](evidence/vegetation-tree-v13/GPU.md) distinguishes
actual TOP coverage, cartographic invariance and the retained oblique fallback.
The staged data-loader description below remains the basis of its source/asset
separation. CPU checks do not substitute for the subsequent GPU/campaign results.

The prepared CC0 asset and its limitations are recorded in
[the offline evidence](evidence/vegetation-tree-v13/README.md). This document
tracks the consumer work; no production default changes in the data-loader step.

Prepare a resolved local manifest after the offline bake/calibration:

```powershell
& $Godot --audio-driver Dummy --headless --path viewer-local --script tools/resolve_tree_assets.gd -- /absolute/prepared-root-pivot-1024 /absolute/root-shared-mask-probe.json
& $Godot --audio-driver Dummy --headless --path viewer-local --script tests/surface_tree_data_test.gd -- /absolute/prepared-root-pivot-1024/resolved.json --inspect-import
```

The resolver creates linear premultiplied RGBAH albedo/normal pyramids for the
five views, transforms baked Blender normals to the glTF/Godot coordinate frame,
and stores a257-sample envelope-potential -> optical-mean LUT. It uses only CPU
Images, no ImageTextures. SHA256, normalization, projection, cutout and budget
semantics participate in a path-independent descriptor digest. The JSON writer
uses full double precision so the digest survives serialization exactly.

`SurfaceTreeLibrary` validates hashes and dimensions. The UI owns imported
geometry/textures; the worker receives only a private renderer packet copy with
`_treeAssetCPU`: packed mask, optical LUT and top colour/normal buffers. Source,
world and canonical physical fields remain untouched. Dictionary bindings are
read-only; Godot cannot freeze PackedArray elements, so these privately owned
buffers are borrowed read-only by contract. Consumers expose no mutation path.
Tests hash their input before/after sampling rather than pretending that native
PackedArrays are security-frozen. The private packet copy is cached by source
snapshot identity to preserve worker-cache reuse.

The optional headless import test inspects the actual three-surface134k mesh and
NormalGL/roughness/albedo bindings. This remains a CPU import/parser test, not a
GPU render or artistic acceptance. Without the explicit experimental profile,
legacy rendering continues unchanged.
