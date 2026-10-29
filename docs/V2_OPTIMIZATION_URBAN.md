# V2 urban optimisation audit

Local review, 28 October 2026. The changes below preserve native parameters, physical raster resolution, geometry, source admission, retained architectural plans, random seeds and generation order. No distribution build or publication was performed for this pass.

## Measured results

Measurements use the same workstation and source tree. Kernel values are medians of nine warm runs; form values are medians of fifteen runs. These are bounded adapter workloads, not universal generation-time promises.

| Workload | Before | After | Evidence |
| --- | ---: | ---: | --- |
| Project 5,000 native buildings into the V2 2D representation | 35.90 ms | 1.22 ms | Complete projected output is deeply equal; SHA-256 `11d7ec863f542af378e7f2ab9461b8a66db529351e1c89b8a8526a44c7bdb043`. |
| Bind 32 edited requests to 5,000 retained neighbours, warm cache | 1.34 ms | 0.83 ms | All occupation surfaces, ordering and heights deeply equal. |
| Prepare retained snapshot with 5,000 buildings and 4.8 million archive characters | 35.81 ms | <0.01 ms | Copy-on-write header; heavy immutable products shared, not regenerated or serialised. |
| Reuse native physical raster, 512 × 512 samples | 0.63 ms | <0.01 ms | Same FP32 samples, water levels, river widths/ids and geographic domains. |
| Reuse 3D decor/physical metrics | 1.29 ms | <0.01 ms | All returned decor metadata deeply equal. |
| Reuse one complete native scene as the 3D union | 0.087 ms | 0.0014 ms | Same native scene data, without rebuilding arrays/archive tables. |
| Compute form inheritance with 10,000 house overrides and 32 local cities | 39.4 ms | 1.8 ms | Same 222 visible scalar values. |
| Synchronise that structured form | 69.9 ms | 2.9 ms | Visible-value SHA-256 remains `12f415501fb3bd0da0e1d40385c93180d87348b59874dd7fabd63d4e4fc68334`. |
| 3D warm frame, 40 terrain tiles / 41 draw calls | 541 uniform-location queries | 0 queries | Identical draw count, LOD and screenshot SHA-256 `64d6255eb18e34746cee67e8d444750b08dbaf94ea9eee863c93c9d19d9d1d79`. |

The snapshots are synthetic native-shaped adapter fixtures for repeatable kernel measurements. A separate real Rust/WASM browser run verifies native generation, editing, constraints and replay. Kernel output checks compare the actual previous source functions captured before optimisation with the current implementation; they do not compare two independently rewritten algorithms.

Local artifacts are in `web/out/v2-optimization/`: `urban-kernels.json`, `form-before.json`, `form-after.json`, the two uniform-cache reports/screenshots and `shader-equivalence.json`. The captured baseline source-pair digest is `d54f07da64ee202445e491be3b18861a1060738bfb63be8bb99def970f21e628`. Reproduce adapter measurements with `npx tsx scripts/v2_urban_optimization_bench.ts` after capturing the baseline files named in that script. The capture files are review artifacts, not runtime dependencies.

## What changed and why the results remain the same

### Retained native stages

[rustUrban.ts](../web/src/v2/rustUrban.ts) replaces the whole-snapshot `structuredClone` with a shallow transition header. Native layouts, cadastral geometry, requests, scenes and compressed plan archives are immutable retained products. A changed stage installs a new product; house-baseline bookkeeping copies its own map before an edit; house scene arrays are copied before sorting. Failed stages cannot modify the previous snapshot. Small retained house override records are copied so editing the next input cannot rewrite previous provenance.

The projection builds a first-request-by-parcel index once per immutable request array. It preserves the old `Array.find` first-match rule, including duplicate parcel ids and fallback building ids, while removing a request-list scan for every building component. Retained neighbour occupations/bounds/heights are cached weakly by the exact immutable native building object. The selection test, ordering and full occupation geometry remain unchanged.

Physical native rasters are weakly cached by their original height grid and all relevant physical input identities. Changes to dimensions, samples, water, filled levels, sea level, coast/lake domains or river geometry/width/id invalidate the entry. Copying a river header solely to change its displayed name does not rebuild physical data. No sample is decimated. Weak caches follow the lifetime of their source products and are not exported into projects.

### 3D retained products

[urban3d.ts](../web/src/v2/urban3d.ts) reuses a complete single native scene directly, caches physical decor metrics, and checks actual geometry-product references separately from progress/report headers. A house edit does not recreate unchanged layout arrays merely because its snapshot header changed. [city3d.ts](../web/src/ui/city3d.ts) retains bridge, enclosure, quay and boardwalk meshes until their terrain or network inputs change; those meshes do not depend on a house edit or display colour policy.

The 3D view still consumes the complete retained native plans and the existing bounded exterior-detail controller. Source generation, physical admission and architectural outcomes are unchanged. Geometry is not replaced with lighter surrogate houses.

### Shader setup and driver calls

[terrain3d.ts](../web/src/ui/terrain3d.ts) caches uniform locations, including inactive/null uniforms, per linked program and WebGL context. Locations are immutable for that lifetime; the cache resets on context restoration. The measured frame still issues exactly 41 draw calls and displays 40 tiles at the same mesh/texture resolution. The complete before/after screenshot bytes are identical.

The V2 also opts into a small cartographic map shader on first opening 3D. Its texture transition, lighting, fog and diagnostic calculations reproduce the existing full shader's `groundEnabled == 0` branch. The full procedural material shader is compiled only when the user selects procedural ground, then cached for subsequent switches. A visible preparation message and `aria-busy` are painted before that optional compilation. Existing benches retain their original default unless they opt in.

The software WebGL2 smoke test opens that V2 view in approximately 0.5 seconds and verifies rendering plus hide/show responsiveness. This initial-view path does not reduce terrain or building detail.

### Structured form work

[urbanControls.ts](../web/src/v2/urbanControls.ts) already computes effective inherited values once per sync. The remaining cost was cloning the entire global urban database, including unrelated settlement and individual-house patches, while resolving just three native product configurations. Resolution now reads only layout, parcels and house settings. The model-enabled indicator reads the relevant model directly. Persisted settings are retained in full; no parameter or local edit is dropped.

## Validation and limits

- Sixteen focused tests pass across `v2UrbanControls`, `v2Urban3d` and `v2UrbanRetention`. Frozen snapshots verify no mutation on cache hits, edits, earlier stage stops and failed native requests. Tests also verify input provenance isolation, physical-cache invalidation and retained geometry indexes.
- The final [Rust/WASM browser check](../web/scripts/v2_rust_browser_check.mjs) passes with 243 rendered structured controls, all four real stage stops, advanced layout settings, quarter/parcel edits, global/local/individual house priorities, exactly one regenerated house request, unchanged neighbours and cadastral geometry, native refusal/retry, and snapshot-free recipe reconstruction. Browser errors: none. Artifacts: `web/out/v2-rust-browser/`.
- [The software 3D check](../web/scripts/v2_urban_3d_check.mjs) passes with actual SwiftShader WebGL2 rendering, a stable LOD, responsive hide/show and zero browser errors. It also records uniform-query counts and the actual renderer.
- The direct **full-shader versus short-map-shader rendered-pixel comparison did not complete**: compiling the full shader exceeded the 60-second driver budget on this machine, and the test stopped its owned browser process. `KHR_parallel_shader_compile` is unavailable in the measured SwiftShader context. Therefore no successful full-versus-short GPU pixel test is claimed. The shader's map branch is source-equivalent and retains the same geometry/LOD; the successful pixel-identical comparison above concerns the uniform-cache optimisation. The full procedural ground option remains available, with driver-dependent initial compilation cost.
- Native parent/cold-store workflows and unbounded cities are outside these bounded measurements. No general frame-rate, memory or historical-capacity guarantee is inferred from this audit.
