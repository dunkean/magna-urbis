# V9 whole-view canopy qualification

Native implementation: `65961e93899c448b55d1480046d87420928acd8f`, isolated worktree from ROOT `9b87392`. The water helper dependency is the parent implementation 72590f8, mirrored locally 74aab60; only 65961e9 is the native change.

The input is a retained V8 neural world/fine source. The model generated a complete canonical tree page `[18000,22000]²`:67,221 trees, plus 8,039 other items in small family pages,75,260 total. The model CPU report proves world/source/parents/urban/context bytes unchanged and zero support clamped to the fine child. This is a retained replay, not a new neural-generation campaign.

## Spatial policy

A single phase controls the whole viewport. Ray intersections use a common reference plane, crown-height allowance, and the actual imported height envelope for oblique views. A complete source tree page, the optical atlas, and resident terrain must cover the whole relevant frustum plus halo. Otherwise the entire viewport uses approximate mesoscopic canopy. There is no per-pixel page-edge blend or page-edge geometry/rank thinning.

Phase 0→1 blends the whole optical representation from meso to exact, with geometry disabled. Phase 1→2 keeps exact optical coverage and introduces geometry using its physical3–8pixel LOD. The old matching atlas/meshes fade out before replacement; old meshes are rebased while retained. Different seed, source/scene epoch, context or physical-version lineage clears the old snapshot immediately. Stable captures wait for `canopy_transition_busy=false`. Effective atlas world/source/versions, SHA256, pending state, bounds and phase are recorded per capture.

Atlas sizes are powers of two and origins are aligned to dyadic world cells. Explicit coverage filtering shares the same weights/mip kernels as filtered per-texel transmittance. Counts are never averaged before exponentiation. This removes both recrop bands and small mismatches from hardware sampling weights.

## Measurements

- `pointwise-gpu.json`:35 phase/footprint cases ×262,144 sampled GPU points; **zero** violations of V≤C and V+(1−V)G=C. It exercises the real67,221-tree inventory.
- `spatial-views.json` / `spatial-reprojection.json`:five 640 m TOP pans, crossing the former 480 m query edges. All stable TOP states are globally exact. Reprojected overlaps differ by at most 2 RGB byte levels, mean ≤0.00364 byte. The earlier non-dyadic-atlas control was mean 0.49–0.65/max 60; that control is not a passing result.
- `top-views.json`:final production TOP 10 km phase 0, TOP 2560 m phase 2, TOP 640 m phase 2. Preview images here are resized copies; the manifest identifies all full 2048² images and hashes.
- `effective-capture-state.json`:actual scene/atlas/phase/instance/source state. The controlled oblique 640 m is phase 0 because the loaded-height envelope exceeds safe resident coverage. No partial exact page, floating tree geometry or clamped atlas bands are claimed as valid.
- `brdf-gpu.json`:nonuniform MultiMesh matches MeshInstance pixel-exactly; ideal crown atlas BRDF mean 0.587 byte/max 6 over the inner 85% radius. Normal transform, crown shape and shading remain the qualified r4 implementation.
- `shadow-gpu.json`:main-camera LOD/orientation controls pass. Total-C approximate optical shadows remain uniform across representations; native tree/trunk casting is off, terrain/building casting unchanged. Transmission remains[.25,.34,.50]. This is not geometric shadow-energy equivalence.
- `cpu-view-lineage.json`:camera-ray/halo/phase/page validation, incomplete page rejection, and seed/environment/occupation/source epoch/scene epoch/context anti-stale cases pass.

Geometry diagnostics are obtained from actual submitted MultiMesh buffers, node/camera visibility, shader ALPHA and centre-in-frustum checks. They distinguish allocation from contributing geometry and make no GPU occlusion claim. Ground, low cover and canopy remain separate; no physical source/layer array or accepted ID is edited.

The new water symbol parameters are forwarded explicitly, rejected for physical source-levels, and included with MPP/style/contour hash in reuse bindings. A cached texture must also have source geometry coverage of the visible domain; texture padding is not source coverage. The forest images predate the later vector-contour F2 helper and do not qualify its final hydrology appearance.

## Reproduce

Use the pinned Godot 4.7.2/Terrain3D 1.0.2 project and input named in `manifest.json`:

```powershell
& $godot --path viewer-local --rendering-method forward_plus --gpu-index 0 --script res://diagnostics/canopy_view_probe.gd -- --world $packet --assets $assets --x 20000 --z 20000 --width 10000 --resolution 2048x2048 --top --water-symbol-width-px 1.25 --probe-dir res://captures/v9-qualified-top
```

The spatial script is `canopy_spatial_probe.gd`; pointwise filtering is `canopy_phase_gpu_probe.gd`. The final integrated live campaign and independent visual review remain separate from these retained-source probes.
