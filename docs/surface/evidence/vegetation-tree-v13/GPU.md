# Experimental tree: bounded GPU evidence

The actual CC0 high tree and five-view impostor rendered in Forward+ on **RTX5090**,
Godot4.7.2 / Terrain3D1.0.2, Dummy audio. Default rendering remains legacy. These
controls do not qualify photorealism, navigation latency or final artistic quality.

[gpu.json](gpu.json) preserves raw report/capture/log paths and hashes, native
snapshots, source fingerprints, phase, submitted instances and the negative cases.
The packet is the retained V12 replay `e9646f0a…079d2c`: a complete4km tree page,
original fine40m raster and real parent outside it. It is not a new generation.
The renderer asset digest is `e3243d0d…f4bde`. Runtime source was `4a1b6c2` for the
first controls and the camera/shadow patch now committed as `a7e44ab` for the later
controls. Those later runs executed this patch as WIP before commit. Historical
runtime start/end hashes were **not** captured; canonical Git source hashes and
actual native hashes collected after completion are labelled separately. The
reproduction runner now records and checks start/end native runtime hashes.

| Source view | Actually submitted tree product | Result / scope |
| --- | --- | --- |
| TOP10m, matched camera | 1high /134,295triangles +27impostors | Physical hashes and no-trees/ground central pixels equal baseline |
| TOP160m, matched camera | 394impostors /788triangles | Same invariants; no high tree meets500px threshold |
| TOP640m | 4,911impostors /9,822triangles | Phase2 and same physical/disabled-layer pixels; captured **before** final shadow-reconstruction floor |
| OBLIQUE160m | 808impostors allocated, geometry weight0 | Guard forced whole-view meso; **not** a visible-impostor qualification |
| Blueprint TOP160m | Legacy glyphs; asset excluded | Four visibility-state central pixel hashes identical with/without flag |

All capture processes exited. Existing Terrain3D interpolation-deprecation
warnings remain; successful production A/B runs had no shader/runtime errors.
Process durations of roughly20–35s include loading and five captures, not FPS.
For example the asset160m end-of-run engine counters were809,071,616texture bytes
and982,233,040video bytes for the entire viewer. They are not peak RAM/VRAM or an
isolated asset allocation measurement.

## Native silhouette and C/V

The coverage probe uses actual MultiMesh high/import and impostor production
vertex/cutout/alpha code, with only unshaded/white ALBEDO substituted for readback.
It compares them with `Canopy.prepare` and `surface_canopy_target` at the **same**
root, scale, yaw and camera. Six TOP controls cover10m/160m and three rotations.
Error is divided by the visible crown-envelope pixel count, not the mostly empty
160m frame. Maximum high-versus-target error is **1.396percentage points**;
impostor-versus-target is **0.259points**. High/impostor IoU is0.9475–0.9566:
their silhouettes are measurably different, although within this bounded gate.

The same production fragment C/V kernels, actual1024² A8 mask and four-bin counts
passed42 GPU phase/footprint cases with zero sampled `V>C`, residual-range or
`V+(1−V)G=C` violations. Ratio32 cases explicitly have geometry disabled. The host
analytic-certificate tests and independent review cover the counterexample that
corner sampling missed. No `min(C,V)` patch hides it.

These checks are **TOP** controls, separate from the independent Monte Carlo mean
calibration. They do not prove physically exact3D coverage, shadow energy, all
radii/rotations or oblique silhouette. No common-camera lit high/impostor BRDF or
normal-direction oracle was run. Darker high foliage versus brighter mid imagery
remains a possible LOD-appearance issue; different-camera images cannot isolate
its cause. The actual material normal/alpha code compiled and rendered, but that
alone does not certify normal-direction parity.

## Preserved negatives and shadow response

The first TOP10 control had camera20m below the declared32m billboard envelope;
the guard correctly produced phase0. The camera patch puts the experimental TOP
consumer above that envelope. A second comparison correctly failed disabled-tree
pixel equality because baseline20m and asset32m cameras differed. Final TOP10/160
controls explicitly use `--top-clearance-m 32` in **both** profiles; the physical
framing and disabled-layer central pixels then match exactly.

The initial160m shadow exposed coarse atlas texels. The final response uses
`max(pixelFootprint, declaredSolarPenumbra, 2×activeAtlasSpacing)` for **shadow
reconstruction only**. C/V visibility, atlas hash, selected counts and the entire
no-trees PNG remain identical in the controlled160m before/after comparison.
The0.53° angular diameter and9.8039m reference height remain declared separately
from that reconstruction bandwidth. Images show softer steps; this is not a
claim of a physically reconstructed leaf shadow. Final640m shadow appearance was
not independently recaptured in this proof.

The source oblique160m had loaded height range2039..2190m. Its conservative
frustum/height envelope no longer fit the prepared atlas/resident terrain; margin
was about−198m. Both profiles remained phase0. The guard was not weakened to make
the image qualify. Five-view planar depth and discrete view changes remain limits.

The first standalone coverage attempt failed in the diagnostic itself: a dynamic
shader lost relative include context and the authored test record omitted family.
That raw error log is preserved; the corrected second run passed without changing
production shading for the test.

## Reproduction

After source ingestion and preparation described in [README.md](README.md), run:

```powershell
node web/scripts/surface_tree_gpu.mjs --godot <pinned-godot> --world <retained-page4000.surfacebin> --assets <terrain-resolved.json> --tree-assets <tree-resolved.json> --widths 10,160,640
godot --audio-driver Dummy --path viewer-local --rendering-method forward_plus --gpu-index 0 --script diagnostics/tree_asset_gpu_probe.gd -- <tree-resolved.json> <output-folder>
```

The first command makes five-image layer controls per profile. Add `--oblique`
or `--presentation cartographic --style blueprint --style-catalogue <palettes.json>`
for the corresponding limited controls. Neither command generates or edits source
terrain. Raw output is ignored under `web/out/tree-gpu-*`. The following copies
are unchanged capture files, not rendered substitutes:

- [TOP10 high](top10-high.png)
- [TOP160 impostors and reconstructed shadows](top160-impostor.png)
- [TOP640, prior shadow floor](top640-impostor-prior-shadow.png)
- [Blueprint with flag excluded](blueprint-flag.png)
- [Initial160m shadow negative](shadow160-negative.png)
