# Oblique visibility planning (CPU stage)

The retained V12 160 m oblique counterexample remains a failed rendering qualification. Both legacy and asset branches submitted instances while their whole-view safety phase stayed at zero. A complete 4 km tree inventory was present; the resident terrain and the atlas did not cover the same conservative view. Authored flat tests do not qualify this real case.

This change is limited to oblique preparation. TOP keeps its former camera, atlas request and resident selection. A separate parity test compares its height/control/context/layer image bytes and mipmaps against `6ef8d3c`.

## One immutable worker plan

`SurfaceVisibilityPlan.build` runs before Data and Population in the same ScenePrepare job. It receives the actual Camera3D snapshot, source world, positively prefiltered display source, snapped anchor and complete tree page. It returns one atlas rectangle, a resident origin and aligned image size, conservative source height bounds, camera/source/context/kernel bindings and diagnostic budgets. No canonical arrays, candidate IDs or source versions change.

The worker builds a bounded min/max hierarchy from the original and display controls. Bilinear interpolation, cubic B-spline reconstruction, binomial display filtering and parent/child feathering have nonnegative weights. Queries therefore union all overlapping source intervals before frustum rejection. This is important at seams: neither parent's nor child's AABB alone bounds their blend. Cubic queries include all sixteen control taps. Two display samples provide extra support for RF interpolation across a partition boundary.

The walk clips source-cell AABBs against camera side and near/far planes. It includes the declared support envelope: legacy crown radius and 20 m height; asset yawed high/impostor union bounded by 1.56 times crown radius and height −12…32 m. Absolute coordinates are subtracted as doubles before renderer vectors are formed. The reported height minimum is a contributing-control bound, **not** a measured minimum among visible pixels, and no occlusion culling is claimed.

Atlas padding covers the halo and existing whole-view transition. The resident is recentered to the plan and remains aligned to Terrain3D's 256-sample import regions. It may use 512, 1024, 2048 or 4096 samples at the **unchanged display spacing**. This does not generate additional source information. In the retained V12 replay most support still comes from the real 78.125 m B-spline parent; only the small child footprint has native 0.46875 m/grid 0.625 m detail.

The oblique guard uses the plan's visible-support XZ bounds; it does not reintroduce infinite horizontal planes at the padded resident's global min/max. Its fixed-reference-plane homography must have finite W/endpoints or phase is zero. The existing analytic C/V filter certificate still uses the **active** atlas spacing. Camera or immutable world mismatch also forces zero, then a camera refresh can obtain a new certificate. Newly accepted source worlds still finish and display terrain; this change does not broaden cancellation eligibility.

## Bounds and limitations

- At most 1,572,864 unique source samples, a 64 MiB upper estimate for the height index and 65,536 visited spatial nodes. One index set is retained; it is released before a new set is allocated. Index and walk checkpoints honor the existing cancellation token.
- Resident side is capped at 4096. The previous 2048 failure remains recorded separately.
- A 2 GiB ceiling applies to the **estimate of known working buffers**: resident RF/control/backing/transfer, new atlas buffers/images/mips/upload, retained active atlas/resident, height index and an explicit source/context reserve. This is not an RSS or VRAM guarantee. Godot, Terrain3D, driver and other unmeasured allocations remain outside that estimate. Budget failure yields an explicit phase-zero reason instead of coarsening source data or pretending coverage.
- A complete inventory, valid lineage, supported positive kernels and sufficient page extent are mandatory. There is no quantile, camera-dependent height assumption or invented local elevation range.
- The tree page must also be covered by the union of transported source-height domains. A fine-only packet cannot substitute its candidate positions for a missing parent heightfield, and disjoint domains do not cover their bounding-box gap.
- Preparing a 4096² resident involves 16.8 million real height queries. This may be expensive for B-spline parent reconstruction. Static map preparation and interactive QoS must be reported separately; no latency/FPS improvement is claimed by the planning certificate.
- The certificate bounds continuous source/display reconstruction. Actual Terrain3D import, mesh LOD/morph behavior, assets, projections and visible canopy must still be checked on the real retained oblique case. A passing CPU plan alone is insufficient.

## Reproduction and review

Use Godot 4.7.2 headless with the Dummy audio driver. Small CPU checks:

```text
--headless --audio-driver Dummy --path viewer-local --script tests/surface_visibility_plan_test.gd
--headless --audio-driver Dummy --path viewer-local --script tests/visibility_top_parity_test.gd -- <small authored.surfacebin> <6ef8d3c surface_data.gd>
--headless --audio-driver Dummy --path viewer-local --check-only --script scene/main.gd
```

The source replay probe requires the existing V12 packet whose physical world/parents were retained while its tree page was explicitly refreshed to 4 km, and the original failed oblique metrics:

```text
--headless --audio-driver Dummy --path viewer-local --script tests/oblique_visibility_retained_probe.gd -- <V12 replay.surfacebin> <failed160m metrics.json> <report.json> [--prepare-resident]
```

It performs no Neural generation or registration, preserves the negative metrics, compares height/field hashes and reports source-plan/filter and optional resident CPU preparation separately. After independent code review, a GPU slot should test the same retained replay, camera, assets and source hashes against the old failure. Inspect actual Terrain3D coverage and known source support, phase/filter state, native and impostor visibility, rebasing, water/ground styles and camera/resize invalidation. Only then may the real oblique rendering be qualified; full streaming/QoS remains a separate campaign.
