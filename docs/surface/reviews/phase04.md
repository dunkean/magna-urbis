# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

I made no changes and ran nothing. This is a static read of `viewer-local/**`, the material/population code, the catalogue, the two design documents, phase 3, and the author's capture metrics and logs (text only).

# Phase 4 review: native SurfaceWorld viewer

**Verdict: CHANGES REQUIRED.** The phase 3 fixes for frame, rebasing, winding and async handling mostly land correctly. Phase 4's own core is not acceptable yet: material mean preservation, matching canopy between ground and instances across zoom, the normal-map frame, and display of the generator's height surface. Besides the known colour issue (B1), I found two more blockers.

**What the evidence covers:**
- Every author capture log shows exactly one `terrain-replaced` event. No log covers a multi-scale tour or continuous navigation. So nothing in the evidence tests popping, stale state or stutter across replacements.
- Frame times are vsync wall-clock (p50 ≈ 16.66 ms), not GPU timestamps.
- Main-thread replacement times measured by the author: 65 ms (`city-250m`), 85 ms (`teacher-refined-10m`), 136 ms (`teacher40km-top`), 172 ms (`river-640m-v4`).
- `teacher40km-top.log` loaded only 6 PBR assets: rock, soil, litter, grass, sand, gravel.

**No silent alternate generator found.** The viewer never synthesizes heights. Uncovered samples become holes (`surface_data.gd:240-241`), and display interpolation never changes `sourceLOD`.

## Blockers

**B1. Albedo mean normalization (known open issue; still open).** Passing numeric tests is not evidence it is fixed.
- **Mechanism:** `surface_uniforms.gdshaderinc:72` divides the sampled texel by `layer_mean`. That mean is computed in linear space from decoded pixels (`material_library.gd:52-54,72`). The ratio is only near 1 if `source_color` on the runtime `Texture2DArray` (`:20`) actually decodes sRGB under Compatibility.
- **Why it fits the symptom:** if the GPU returns encoded values, the ratio becomes E[sRGB]/E[linear], about 2–6×, and largest for dark channels. Then `base*mix(1,ah,0.82)` (`surface_body.gdshaderinc:43`) saturates toward lime/cyan, and the clamp at 0.95 (`:57`) produces white. That matches the river-640m-v4 screenshot.
- **Biases that remain even after the decode is fixed (confirmed):**
  - `Image.generate_mipmaps()` averages encoded RGBA8 (`material_library.gd:27,60`). Distant mips therefore darken relative to the linear mean until the shader blends to `base` at 0.5–2 × source spacing (`surface_body:44`), which is 7.8–78 m footprint.
  - The height-weighted patch blend `w·exp(0.8h)` (`surface_uniforms:69-71`) biases the mean wherever height and albedo correlate (weights up to 2.2×). The comment there claims the mean is retained.
  - AO from the height map applies only at fine scale (`surface_body:61`), and normals flatten without any roughness compensation. Both shift radiance with zoom.
- **What the fix needs:** a backend-independent decode, either linear RGBA16F layers or explicit decode with the filtering bias documented. Mips should be generated in linear space. Acceptance should come from an in-engine unlit diagnostic that outputs `ah.rgb`, read back and checked against 1.0 within 3% at several footprints. CPU parity alone is not enough.

**B2. Canopy is neither mass-preserving nor consistent across representations (confirmed by construction).**
- **The bands don't match:**
  - Ground canopy is painted with `distant = smoothstep(1,6,footprint m/px)` (`surface_body:52-55`).
  - Instance alpha is `smoothstep(1.25,3,size_px)`, computed once per replacement from `width_m`, not per pixel (`main.gd:415,439`).
  - For a 12 m tree at 4 m/px, instances are fully opaque while the ground still paints about 65% canopy, so canopy is counted twice.
  - Below 1 m/px the ground paints nothing, so canopy depends entirely on instances. Those are rank-thinned, pixel-culled and capped at 16,000 across all families (`main.gd:358-365`), with no compensation.
  - The comment at `surface_body:51` ("same projected-size band") is false.
- **The mid-scale pattern doesn't preserve coverage:** `smoothstep(1-c±0.12, crown)` over value noise (`:50`) does not give P = c. Bilinear-smoothstep value noise has far less variance than a uniform. By my estimate, sparse canopies (c ≈ 0.1–0.3) lose about half their coverage between 3 and 18 m/px and regain it beyond. That breaks the design's < 2-point coverage criterion. The blobs also don't coincide with candidate positions.
- **Palette mismatch:** painted canopy is linear (0.055, 0.105, 0.036) × (0.8 + 0.4·noise). Instance tint is `Color(0.10,0.20,0.065)` bound to a `source_color` uniform (`instance.gdshader:2`, `main.gd:380,397`). Godot converts that to linear ≈ (0.010, 0.033, 0.005), so instances are 3–6× darker than the canopy painted under them.
- **Temporal:** instance sets and fades change only on `_apply_prepared`. Any input increments `generation` (`main.gd:543`), so every result during continuous zoom is discarded (`:196`). The shader band moves every frame while instances stay frozen, then pop when the result finally applies.
- **Fix direction:**
  - Derive one representation weight per candidate from the same footprint metric in both places, so the ground canopy weight equals 1 minus the instance weight.
  - Remap the pattern through its measured CDF.
  - Use the same linear albedo in both representations.
  - Budget per family, scaling surviving crowns by expected coverage.

**B3. Heights are displayed with the wrong reconstruction kernel, with a step at child bounds (confirmed by construction).**
- **The kernel mismatch:** the registered canonical field is cubic B-spline *controls* (`infiniteRefinement.ts:22-24,82`; `registrationBinding.ts:44-53`). The child is "cell-centred cubic B-spline control reconstruction" plus residual (`infiniteRefinement.ts:132`). The viewer has a single bilinear kernel for every grid (`surface_data.gd:176-201`, `surface_geometry.gd:46-63`). The 40 km parent ring is therefore the control polygon, not the generator's surface.
- **Hard switch, no seam blend:** `height_at` returns the child if the point is inside its bounds, otherwise the parent (`surface_data.gd:196-201`). That produces vertical steps of up to `controlSmoothingMaxAbsM + refinementResidualMaxAbsM`, which `compareRefinementParent` already measures.
- **Buildings not re-seated:** native building triangles keep absolute `y` (`surface_geometry.gd:229-231`), while roads are re-draped on the child (`:299`). Design §4.2 requires supports to be updated explicitly after a real refinement.
- **Fix direction:** carry `reconstruction` / `interpolation` on `TerrainGrid` and evaluate cubic B-spline in `height_at`, `_prefilter_grid` and `_sample_height`. Feather the child/parent seam over a few child cells. Add a per-building vertical support delta, or report the conflict, as `compiler.ts:729` does for water.

## Major

1. **Normal-map frame is internally inconsistent (confirmed).**
   - Two pieces of code assume opposite conventions:
     - The stochastic rotation compensation uses `transpose(r)*n.xy` (`surface_uniforms:65`). That is only correct if the map's +y = +v.
     - The triplanar top projection maps the map's +y to −z (`:94`). That assumes +y = −v, which is the OpenGL convention under Godot's top-left UVs, and matches Terrain3D's B = cross(N,T) = −z (confirm against the pinned `minimum.gdshader`).
   - They cannot both be right. Under the −z frame, the correct compensation is `r*n.xy`. As written, patches rotated by 90° or 270° (half of them) are lit in mirror image to their albedo.
   - Diagnostic 5 shows only `w_normal`, through the filmic tonemapper (`surface_body:66`), so it cannot catch this.
   - Validate with a synthetic one-sided bump map, forcing each of the four rotations.
2. **Derivatives in non-uniform control flow (confirmed spec violation; visible impact to validate).** `dFdx/dFdy(uv)` run inside the per-material loop, which has `continue` and `first` branches driven by data (`surface_body:26-33` → `surface_uniforms:82`), and inside `if(abs(normal.y)<0.85)` (`:83-88`). GLSL leaves these undefined, so expect mip errors along material contacts and the slope seam. Compute `dFdx/dFdy(v_vertex.xz)` once at top level and scale per material.
3. **Catalogue binding ignored (confirmed).**
   - The viewer resolves layers by a hard-coded id map, falling back to `family` (`material_library.gd:105-108`), and never reads `recipeIds`.
   - Results: `snow-ice` gets the neutral fallback layer 0; `volcanic-crust` and `carbonate-karst` get light `rocky_terrain_02`; `arid-reg`, `cultivated-soil` and `wetland-organic` get `brown_mud`. `wind-ripple-sand` is forced to `gravelly_sand`, although the catalogue assigns it to `sand_02`.
   - Families listed on two assets (`gravity`, `vegetation`) resolve to whichever loads last.
   - Assets without a height map are dropped silently (`:43`), even though the fetcher allows a missing height (`surface_assets.mjs:61`).
   - Means stay correct because of normalization, but 9 of the 15 exemplars never take effect.
4. **Stale Terrain3D regions.** Nothing removes regions. When the window shrinks (for example 2048² → 512², i.e. 64 → 4 regions), the old regions stay. They are rescaled by the new `vertex_spacing` (`main.gd:217-218`) and still offset by the old `origin.y`, which can show on the skyline in relief and cast shadows. Log `get_region_count` after a 40 km → 10 m tour to confirm.
5. **Main-thread replacement cost and LOD starvation (measured: 65–172 ms in the author's metrics).**
   - Still on the main thread: winding reversal in `make_mesh` (`main.gd:285,288`); `_build_populations`, which builds Dictionaries for every candidate and runs a GDScript `sort_custom` (`:348-366`); `ImageTexture` creation (`:230`).
   - Continuous input discards every worker result (`:196,543`), so live refinement and instance LOD wait until input stops for more than 160 ms plus 1–3.5 s of prepare time.
6. **Road budget (confirmed).** The cross-section is split into columns at `spacing/2` (`surface_geometry.gd:258,279-280`). On a 0.47 m child, one 10 m-wide road gets about 43 columns, and 1 km of it exceeds `MAX_VERTICES`. Truncation follows iteration order, not distance (`:291`), and the budget is shared with buildings (`:223`).
7. **Roads and water vs the displayed terrain (structural; magnitude to measure).** Roads sit at +0.012 m on full-resolution bilinear canonical heights. Water sits at canonical levels. Terrain3D displays a prefiltered mesh plus clipmap LOD rings. The constant `DEPTH` offset of 3e-7 (`road.gdshader:7`, `water.gdshader:15`) is about 1 cm at the target at 640 m and does not cover LOD deviations. Expect buried roads and shoreline crawl as the clipmap follows the camera.
8. **Water coverage.**
   - When wet cells exceed 65,536, any wet cell in a group draws the whole `step×step` group (`surface_geometry.gd:132-141`). River area inflates by up to `step`× at regional views.
   - Water always comes from the canonical context, so at close range on the refined child it is a 15–39 m cell footprint. Near the shore, the child bed and the canonical level conflict; this is known (`compiler.ts:729`) and unhandled in the viewer.
9. **Floating boulders and debris (confirmed).** The sphere has height 0.7 and is centred at 0.5·size (`main.gd:390-391,411`), so the bottom sits 0.15·size above the support: 0.42 m for a 2.8 m boulder.
10. **Unfiltered macro noise.** The 16 m value noise ±9% (`surface_body:38,45`) is never band-limited. Above about 8 m/px (all regional views) it aliases and shimmers under motion.

## Minor
- Dead uniforms: `world_phase` (`surface_body:20`, `material_library.gd:123`) and `instance_blend_distance` (`surface_uniforms:24`).
- The UV-phase assertion in `probe.gd:53-56` is tautological: it re-implements `fposmod` and touches neither shader nor library. The hole bit is never asserted.
- The triplanar switch at |n.y| = 0.85 makes a weight jump of about 5% (`surface_uniforms:83-90`), visible as an iso-slope line.
- The viewer's FNV-32 canonical context id (`main.gd:686-688`) will diverge from the TS `fingerprint` once fingerprints move to 128 bits.
- A response rejected on `baseWorldId` is re-parsed every 15 frames (`main.gd:617`, `_poll_stream`), and response files are never cleaned up.
- `surface_ids` is stored as RGBAF, 16 B per texel where RG16 + R8 would do (`surface_data.gd:251`). u16/u32 arrays are decoded one element at a time in GDScript (`:43-50`).
- Even-width grids drop their last sample in `_prefilter_grid` (`:304`).
- The oblique camera clamp only checks the ground directly under the camera (`main.gd:268-269`), not terrain between camera and target.
- Version and anchor checks use `assert`, which only runs in debug builds (`main.gd:81`, `surface_shader.gd:8-9`). The launcher covers this partly.
- `directional_shadow_max_distance` is capped at 3,000 m (`main.gd:275`). Above about 4.7 km width in oblique, the target area gets no cast shadows, so lighting changes character with zoom.
- Water `tint : source_color` holds what look like linear values (`water.gdshader:3`). It is probably converted to linear ≈ (0.003, 0.024, 0.033), against the recipe's (0.028, 0.10, 0.115). Validate.
- README drift: it says "four regions 256²", "two arrays 512²" and "six materials". The code builds up to 64 regions, uses 1024² arrays, and the catalogue has 15 materials.
- The HUD does not show `decoderUsed`. Given the student64 failure, it should.

## Aesthetic limitations (not bugs)
- Trees are simple spheres and cylinders.
- Buildings use one neutral tint.
- Water has no depth, turbidity or flow.
- Linear tri-blend loses contrast at patch centres.
- On the X/Z projections, the texture's `v` runs along world +y, so cliff textures appear vertically flipped.
- The 1024² atlas cap gives 8–12 mm per texel for 8–12 m extents, i.e. magnification at the 10 m / 5 mm-per-pixel step.
- `aerial_grass_rock` may contain baked lighting.
- The authored `physicalExtentMetres` is not cross-checked against `providerDimensions`, so grain size versus real dimensions is unverified.

## Speculative / future
LEAN or Toksvig normal variance, PBR impostors, a page cache, GPU timestamps (they would need a non-Compatibility backend), and seasonal and wet state on separate supports.

## Phase 3 recheck

| ID | Status | Evidence / remaining issue |
|---|---|---|
| H1 vertices on samples | **Fixed** (for bilinear) | Spacing is `base·2^n` (`surface_data.gd:285-290`) and the origin snaps to `64·spacing` from the grid origin (`main.gd:175-177`); tent prefilter. Wrong kernel for B-spline grids → B3 |
| H2 texel alignment | **Fixed** | `+0.5` uv, `source_grid_size`, manual bilinear on ids (`surface_body:1-6`) |
| H3 depth precision | **Partly** | `near = 0.01·d`, far fitted (`main.gd:271-273`), DEPTH bias; LOD mismatch remains → Major 7 |
| H4 winding / normals | **Fixed** (geometry) | Single reversal in `make_mesh` (`surface_data.gd:330-350`); `CULL_BACK` on buildings; I hand-checked water and road normals. Terrain normal-map frame → Major 1 |
| H5 memory / main thread | **Partly** | Binary packet, 4M/1M budgets, worker-built cached chunks, context textures cached by id. `make_mesh`, populations and uploads still on main thread → Major 5 |
| H6 stale / failed async | **Fixed** | Generation and worldId check (`main.gd:196`), validation, null handling (`:459-463`). Starvation remains → Major 5 |
| M1 terrain edge | **Fixed** (flat) | Window ≥ ±w. Stale regions → Major 4 |
| M2 biased vegetation | **Fixed** | Rank sort before the cap. Shared cap, no compensation → B2 |
| M3 water offset / cracks | **Fixed** at step 1 | Centred footprints, shared corners. Inflation at step > 1 → Major 8 |
| M4 city / roads | **Fixed** | Proxies skipped, Liang-Barsky clipping, one batch, degenerates skipped; export offset applies to urban (`export.ts:61-77`). Budget → Major 6 |
| M5 phase on rebase | **Fixed** | Per-material lattice, noise and wave phases computed in double (`material_library.gd:109-119`, `main.gd:300`) |
| M6 albedo preservation | **Open** | → B1 |
| M7 launcher | **Fixed** | Paths resolved, Godot 4.7.2 regex, SHA-256, anchors asserted, `check.gd` parses the shader |
| M8 live / stream | **Mostly fixed** | Identity checks, 400 ms throttle, atomic requests, parent chain. Re-parse loop remains → Minor |
| Low: top-view clip, HUD NaN, shader re-read, sin hash | **Fixed** | — |
| Low: `--tour` without value | **Mitigated** | The launcher rejects it; a direct Godot launch still crashes |
| Validation: hole bit, depth, normals, RAM | **Open** | Single-replacement captures only; 40 km native-spacing peak RAM not measured (16 km: 893 MB private) |

## Still needs empirical validation
- Whether the B1 decode fix holds up, checked with the readback diagnostic.
- The normal-map frame (Major 1), using a synthetic bump map.
- Stale regions (Major 4), via region count after a 40 km → 10 m tour.
- Whether alpha hash is honoured in Compatibility. If not, instances fall into the transparent pipeline and lose shadows and sorting.
- Whether Terrain3D defers the height upload by a frame relative to the new material phases, which would cause a one-frame jump on each rebase.
- Road and shoreline stability over a recorded pan, rather than stills.
