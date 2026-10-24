# Offline tree preparation — historical authoring stage

This page records the offline preparation stage at `ffa0328`, before the
consumer was enabled. Subsequent implementation and bounded native rendering
are recorded in [GPU.md](GPU.md) and
[EXPERIMENTAL_RENDERER.md](EXPERIMENTAL_RENDERER.md). The production default
remains legacy; the prepared tree is an explicit aerial-renderer option.

The source is [Tree Small02](https://polyhaven.com/a/tree_small_02), by Rico
Cilliers / Poly Haven, [CC0](https://polyhaven.com/license). The pinned source
catalogue is `surface/vegetation/tree-offline-source.json`: eleven files,
84,114,593 bytes, with SHA256 and an exact Blender5.2.1 LTS build pin. Nothing here
is a new tree candidate, physical surface field, neural refinement or city.

## Actual prepared product

[preparation.json](preparation.json) describes the final root-pivot1024 product.
The full ignored cache is `web/out/vegetation-tree/prepared-root-pivot-1024/` in
the producing worktree. It contains the local GLB, two-triangle view-indexed
impostor, five1024² albedo/normal views of the same derivative, shared minZ-first
A8 top mask, and separately named intact-source reference products. The four
PNG controls alongside this document are copies of the CPU bakes, not Godot
captures. Source and products are CC0-derived renderer assets.

- **134,295 actual triangles:**126,304 leaf triangles plus7,991 branch/trunk
  triangles. Source glTF index counts are checked independently of requested
  decimation ratios. There are three material surfaces. GLB36,778,808 bytes,
  SHA256 `e1126e5bc1e8074ec262083a0323ceb03ec177fb7b111b980415e9626e628889`.
- Every one of63,152 leaf components becomes a UV-affine quad. No component is
  dropped; no degenerate-UV fallback was needed. NormalGL/roughness maps and
  source UVs remain bound. UV fits and their normalized residuals are recorded.
- Root pivot comes from52 source vertices in the bottom1% of source height,
  **not** the leaning crown's bounding-box centre. The canonical candidate root
  stays fixed. Source height4.564037 / support radius2.939950 are source units;
  normalized geometry binds height to candidate.size and radius to its existing
  crownRadiusM. The actual horizontal support stays within unit radius. Small
  vertical fit residuals are reported, not silently re-seated.
- Source alpha becomes a shared binary data texture using threshold.5.
  Exported leaf alpha is byte-exact to that product; glTF uses MASK/.5. CPU
  bakes use the same policy and measured normal maps. This explicit material
  profile does not claim to reproduce the source author's translucent shader.
- CPU-only Cycles, two threads,36.23s authoring. No Godot tree import/render,
  draw-cost, memory/VRAM or artistic acceptance is claimed. Product file sizes
  are not RAM measurements. Sixteen close assets would be2,148,720 triangles;
  the suggested500px high-detail threshold and16-tree cap remain unimplemented.
  A cap must switch representations, never drop accepted tree IDs.

## Comparisons, including rejected attempts

Blind collapse to8k failed at15,109 triangles. A16k attempt produced a sparse
skeleton: alpha area16.8% of its source and IoU.165. It was rejected and never
activated. Those raw controls remain in ignored `prepared-leaf-quads/` /
`prepared/`; the final product does not inherit their measurements.

The root-pivot1024 UV-quad derivative has soft-alpha top IoU **.9090** and
area/source ratio **1.0681** under the same cutout profile and camera. Its alpha
area is.21484 of the normalized envelope disc; the intact-source control is
.20113. The derivative is fuller by about1.37 percentage points of the envelope.
The separately classified binary A8 footprint occupies.22157. These differences
are measured; there is **no** opacity multiplier to compensate for lost leaves.
The off-centre crown explains why root-centred figures differ from earlier
provisional bbox-centred256 controls. Old figures are not relabelled as final.

## Proposed C/V contract and existing CPU evidence

Canonical treeCover remains potential **crown envelopes**, not measured leaf
opacity. Candidate slots, acceptance, positions, dimensions, orientation, rank
and IDs stay unchanged. The asset adds a separate optical coverage target:

`Copt = 1 - product_all(1 - M_i)`;
`V = 1 - product_selected(1 - w_bin * M_i)`;
`residual = (Copt - V) / (1 - V)`.

For cutout footprints, source C and selected four-bin counts must use the same
A8 grid, threshold, origin, rotation and physical radii. Evaluate
`1-product((1-w_bin)^count_bin)` **before** common dyadic/bilinear filtering;
never mipmap/average counts before pow. Preserve the whole-frustum page phase
and source/asset compatibility guards. Near and middle use the **same derivative**
and mask; the intact source is an artistic comparison, not an interchangeable
C/V mask. Atlas identity must add the asset digest, cutout, normalization,
projection and optical calibration version; world physical versions do not change.

[mask-calibration.json](mask-calibration.json) reads1004 real retained candidates
without regeneration. Twelve per-instance alpha/rank cases and60 four-bin cases
at four dyadic levels have no V>C and composition error<=1.11e-16. These are CPU
algebra tests, not a GPU silhouette oracle. The test selectors are explicitly
diagnostic stable-rank subsets, not production geometry selection.

The off-page meso marginal is a separate asset-derived LUT: unchanged envelope
potential -> existing per-slot acceptance -> expected optical union of the same
20m/32-slot process. It integrates radius/orientation and neighbouring cells.
At envelope potential.8, the predicted optical mean is.29718; multiplying cover
by the isolated-crown ratio would give.17726. Quadrature parameters and the full
curve are preserved. Monte Carlo ±2-point validation and production meso binding
are **not completed**, so the LUT is not enabled in the viewer.

Next bounded runtime work: bind the mask/counts/LUT and derived impostor under a
new explicit profile; retain all selected IDs, using mesh only at very large
physical pixel sizes and impostors otherwise. Keep total-C optical shadows,
with a separately declared physical penumbra footprint rather than blurring the
ground or visibility C/V. Then qualify TOP coverage, mip/phase/page pans, actual
MultiMesh normals and controlled oblique parallax. The2D palette/glyph path stays
independent. No exact oblique leaf-shadow or energy claim follows from these
top-down bakes.

## Reproduce

```powershell
node web/scripts/surface_tree_source.mjs
node web/scripts/surface_tree_source.mjs --offline
& $Blender --background --factory-startup --python-exit-code 1 --python viewer-local/tools/prepare_tree_cpu.py -- --source-root web/out/vegetation-tree/source --out web/out/vegetation-tree/prepared-root-pivot-1024 --resolution 1024 --samples 8
python viewer-local/tools/tree_asset_mask_probe.py --prepared web/out/vegetation-tree/prepared-root-pivot-1024 --packet retained-v12-live-refinement.surfacebin --out web/out/vegetation-tree/root-shared-mask-probe.json
python viewer-local/tools/test_tree_product.py --prepared web/out/vegetation-tree/prepared-root-pivot-1024 --probe web/out/vegetation-tree/root-shared-mask-probe.json
```

The final file/alpha/mask proof has42 assertions. The external diagnostic used
Python3.13.9 / NumPy2.3.5 / Pillow11.3.0. Blender supplies its own NumPy for
preparation. No GPU is used by these commands; Cycles is explicitly CPU/two
threads. Raw logs stay alongside products. Asset digest
`ef89df3fa4e374b778f57f385e072fd6bcc6c2d5e95884bdb7bcd67343723aa6`
identifies this final descriptor. It is distinct from the canonical recipe and
environment versions.
