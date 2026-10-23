# Revue 3 - Opus 5.5

Verified model: claude-opus-5-5. Requested effort: high. Read-only review; the reviewer did not run tests.

Original verdict is preserved. Subsequent corrections are tracked in the implementation report.

**Verdict: CHANGES REQUIRED**

The adapter structure is sound: double-precision origin in GDScript, a relative GPU frame, a fixed set of four Terrain3D regions, a worker thread, the parent kept on screen, and `sourceLOD` provenance carried through. But several problems break the brief's requirement that heightfields be preserved and that terrain, water, city and vegetation register against each other. Severity below is my own static reading. I ran nothing; the authors' captures and metrics are not my test results. The Terrain3D addon is gitignored and not installed in this worktree, so anything that depends on `minimum.gdshader` is marked for empirical validation.

## High

**H1. The terrain mesh does not sit on the source samples, and it shifts while panning.**
- **Where:** `surface_data.gd:57-68` (`prepare`) and `main.gd:137-140` (`_begin_prepare`).
- **Problem:** The origin is the exact `focus`, and the display spacing is `max(spacingM, width/440)` with no snapping. Terrain3D vertices therefore fall at arbitrary positions on the bilinear source surface.
- **Impact:**
  - Peaks and valley floors get clipped.
  - Every pan resamples the heights, so the silhouette visibly shifts.
  - The rendered ground no longer matches candidate `y`, water levels, building `groundHeightM` or road heights, so objects float or sink.
  - This breaks "Infinite Generation heightfields preserved".
- **Fix:**
  - Snap `origin.xz` to `source.origin + k·spacing`.
  - Make the display spacing `spacingM·2^n` so vertices coincide with source samples.
  - Keep the fractional offset in the camera only.
  - At coarser levels, use a min/max-aware or mean prefilter instead of point bilinear sampling, which currently aliases.

**H2. Material and cover textures are misaligned with the CPU fields by up to half a cell.**
- **Where:** `surface_body.gdshaderinc:1` and `main.gd:181-182`.
- **Problem:** The contract defines samples as corner-registered points ("bounds include the last sample"). The shader computes `(xz-origin)/((w-1)s)` but samples texel centres at `(i+½)/w`.
- **Impact:** The offset grows from +s/2 at one edge to −s/2 at the other, about 7.8 m at 15.625 m spacing. GPU materials, canopy, snow and bedrock disagree with `sample_grid`/`roundi` (HUD, `F` inspect), water and candidates.
- **Fix:** Use `uv = ((xz-origin)/spacing + 0.5) / vec2(w,h)`, and pass `spacing` and the grid size as uniforms.

**H3. Depth precision in the oblique view is far too coarse.**
- **Where:** `main.gd:211-212` (`_update_camera`).
- **Problem:** `near = width·1e-6` and `far = 12·width`. The GL Compatibility renderer uses a standard (not reversed) 24-bit depth buffer, so depth resolution is roughly d²/(near·2²⁴):
  - about 19 m at the 640 m view;
  - about 1 km at the 40 km view.
- **Impact:** Water at +0.015 m and roads at +0.06 m will z-fight or disappear at most scales, and building bases will flicker.
- **Fix:**
  - Derive `near` from the camera's height above the terrain (for example `clamp(0.002·distance, 0.01, …)`) and fit `far` to the terrain window.
  - Use a depth bias or a separate render priority for water and roads.
- **Validate:** Capture 640 m and 10 km oblique views with water and roads.

**H4. Triangle winding and normals don't follow Godot's convention, so roads and probably water and buildings are lit wrongly.**
- **Where:** `surface_data.gd:92-95` (`make_mesh`), `main.gd:240`, `main.gd:291`, and `main.gd:270/296` (`CULL_DISABLED`).
- **Problem:**
  - Godot treats clockwise triangles as front faces. Its own face normal is the reverse of the `(b−a)×(c−a)` that `make_mesh` computes.
  - Roads (corner order 0,2,1) get a downward normal on front-facing triangles.
  - With culling disabled, Godot flips the normal on back faces (`DO_SIDE_CHECK`). Water, which is counter-clockwise seen from above, then gets a downward normal.
  - Native buildings are exported with outward right-hand (three.js-style) winding (`magna.ts:63-68`), so they are back faces in Godot and their outward normals get flipped inward.
- **Impact:** Lighting on the native city, roads and water is inside-out. Turning culling off hides the problem.
- **Fix:**
  - Reverse winding when importing into Godot (swap vertices 1 and 2).
  - Compute normals as `(c−a)×(b−a)`.
  - Re-enable back-face culling for closed building shells.
- **Validate:** Add a normal-colour diagnostic capture.

**H5. Memory and main-thread cost grow with the whole world, not with what is visible.**
- **Where:**
  - JSON loaded into Variant arrays: `main.gd:61`.
  - Full-grid `_build_water` on the main thread on every replacement: `main.gd:228-240`.
  - Full-grid id/state/rock images rebuilt in every `prepare`: `surface_data.gd:72-81`.
  - Fresh `ImageTexture` uploads on each replacement: `main.gd:178-180`.
  - Every building triangle rebuilt on every replacement: `main.gd:257-262`.
- **Impact:**
  - 40 km at 15.625 m is about 6.5 M samples × more than 40 fields ≈ 300 M Variants, roughly 7 GB of RAM plus a multi-GB JSON string.
  - An ocean scene produces millions of water quads on every pan.
  - The "local 40 km" view cannot work at native spacing. It currently works only on small crops.
- **Fix:**
  - Use a binary sidecar for heights and fields (`PackedFloat32Array` via `get_buffer`).
  - Cache context textures per `world.id`.
  - Chunk water and buildings into meshes anchored locally. Move them on rebase by updating the transform (a small offset in float, so precision is fine). Cull them to the active window.
  - Set and enforce a sample budget.

**H6. The async path can apply stale results and can crash with no recovery.**
- **Where:** `main.gd:133-145` and `main.gd:395-400`.
- **Problems:**
  - `generation` is incremented but never compared: `applied_generation` is overwritten unconditionally. A world replaced with the same `id` (an atomic overwrite of `--world`) applies the stale result and never re-prepares.
  - `_apply_prepared` combines the old textures from `prepared` with `world.terrain` grid metadata from the *current* world (`main.gd:177-182`).
  - If the worker thread hits a script error (fields that are null, missing or the wrong length; `unpack_world` only checks `schemaVersion`), `wait_to_finish()` returns null. `prepared.worldId` then errors and the viewer stops preparing.
- **Fix:**
  - Put `generation` and the `world` reference in the result and drop any result that doesn't match.
  - Validate lengths, finiteness and the materials list before starting `prepare`.
  - Handle a null result, keep the parent visible and log the failure.

## Medium

- **M1. The oblique view shows the terrain edge.**
  - The data window is ±256·spacing ≈ ±0.58·width. The top of the frustum reaches about 0.73·width beyond the target and is wider than the window (`main.gd:209-210`, `surface_data.gd:57-59`).
  - Every oblique capture will show a cut-off edge. Above about 51 km wide, spacing is clamped to 100 m, leaving holes.
  - Fix: shift the window forward along the view direction or add a coarse outer ring.
- **M2. Vegetation selection is biased.**
  - `_build_populations` stops at 16 000 candidates in bucket order, starting from the minimum-z row (`main.gd:314-326`). One side of the view fills and the other stays empty.
  - It ignores the contract's `rank` ("use this rank for nested thinning").
  - Fix: filter by `rank` and distance first, then cap.
- **M3. Water patches are offset and cracked.**
  - Each quad covers `[x, x+s]` from the lower-left sample (`main.gd:232-239`), half a cell off the sample's own cell. The last row and column are missing.
  - Each cell is a flat patch at its own level, so steep rivers show steps and gaps.
  - Fix: centre each patch on its sample, or use a shared-vertex mesh that interpolates the levels.
- **M4. Native city and roads have several gaps.**
  - Buildings tagged `representation:'cartographic-proxy'` are drawn the same as native ones, which mixes the city2D proxies into the 3D city.
  - Road segments with an endpoint outside the bounds are dropped instead of clipped (`main.gd:282-283`).
  - Roads are draped using only their four corner heights, so long segments float or sink.
  - Each road gets its own MeshInstance and material, so draw calls scale with the number of roads.
  - Zero-length segments produce a degenerate `normalized()`.
  - Contract issue (not in the viewer): `exportSurfacePacket` shifts the terrain by `options.originX/Z` (`export.ts:41`) but not the road points or building triangles (`export.ts:43-48`, `magna.ts:64`). Any city placed at an offset in a larger world will be misplaced.
- **M5. Procedural patterns jump on rebase.**
  - `world_phase = fposmod(origin, 4096)`, but `surface_noise(p/16)` and `surface_noise(p/9)` hash cell indices modulo 4096. The stochastic tiling grid's skew factor (−0.577) also does not repeat every 4096 m. The water wave phase has the same problem.
  - Macro tint, canopy pattern and tile layout jump whenever the origin crosses a multiple of 4096 m.
  - Fix: compute a CPU-side phase for each grid in that grid's own units, as `material_phase` already does.
- **M6. Albedo is not preserved.**
  - The "neutral" fallback albedo is 0.5 sRGB, which becomes about 0.214 linear under `source_color`. With `ah.rgb*2` mixed at 0.82, the palette is multiplied by about 0.53 (`material_library.gd:19`, `surface_body.gdshaderinc:14`).
  - Real assets also shift the mean, so `colorLinear` is not preserved.
  - Fix: normalise by each layer's mean linear albedo, computed once on the CPU.
- **M7. The launcher is not reproducible.**
  - Godot's `--path` changes the working directory to `viewer-local/`. The Node launcher does not resolve relative `--world`, `--assets`, `--capture`, `--metrics` or `--tour` paths (`surface_viewer.mjs:24`).
  - The Godot version (4.7.2) is never checked.
  - An existing `addons/terrain_3d` is accepted without checking that it is the pinned 1.0.2 (`bootstrap.ps1:10`).
  - The shader anchor `replace()` calls fail silently if the text differs, leaving grey terrain (`main.gd:166-168`).
  - `--check` neither compiles the shaders nor checks the anchors.
  - Fix: resolve all paths, check the Godot and addon versions, and `assert(code.contains(anchor))`.
- **M8. Live and stream transports have identity and throttling gaps.**
  - A live response is accepted with no check on `baseWorldId`, `canonicalContextRef` or source identity (`main.gd:498-504`).
  - The child replaces the parent outright, so zooming out shows holes until the next response arrives.
  - `_request_source` writes a non-atomic request file on every input event, so a mouse drag writes thousands (`main.gd:474`, `main.gd:513`).
  - A response with a mismatched `requestId` is re-parsed every 15 frames.
  - After one refinement, `baseWorldId != world.id` can reject later responses that were based on the canonical parent.

## Low

- Top view: the camera sits only `width` above the focus height, so terrain higher than that is clipped. The oblique camera can end up below terrain.
- The HUD errors if the material id is NaN or out of range (`main.gd:439`). `--tour` given without a value crashes.
- The shader file is re-read and re-concatenated on every apply.
- The `sin`-based hash gets very large arguments (around 10⁶), which can band on some GPUs.

## Needs empirical validation

1. That `minimum.gdshader` in 1.0.2 contains both anchors and defines `v_vertex`, `v_vertex_xz_dist`, hole discarding and `TANGENT`/`BINORMAL`. The normal-map frame depends on these.
2. That the hole bit (`decode_float` of `[4,0,0,0]`) survives `import_images` and shows as holes.
3. Depth fighting at 640 m, 10 km and 40 km oblique (H3).
4. The normal and lighting orientation of roads, water and buildings (H4).
5. Main-thread replacement time against grid size, and peak RAM for a full 40 km world.

## Future features, not defects

- Composing parent and child terrain in rings.
- Geometry finer than 0.25 m (a Terrain3D limit; centimetre detail is texture-only).
- Mean-preserving vegetation LOD (a fixed 180 m `instance_blend_distance` against a population radius of up to 2.5 km already double-counts canopy) and photoreal trees: phase 4.
- Building material families and GPU timestamps.
- A Neural Earth provider. The current `canonicalContextRef`/`retarget` contract is compatible with the viewer.
