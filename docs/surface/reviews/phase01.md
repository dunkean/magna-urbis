# Revue 1 - Opus 5.5

Verified model: claude-opus-5-5. Requested effort: high. Read-only review; the reviewer did not run tests.

Original verdict is preserved. Subsequent corrections are tracked in the implementation report.

# Phase 1 review: SurfaceWorld contract boundary

**Verdict: CHANGES REQUIRED.** There are 2 blockers.

This review is read-only. I did not run any tests or generation. While I was reviewing, `magna.ts`, `climate.ts` and `surface.adapters.test.ts` changed; the findings below are based on the latest versions I read.

**Status of the two corrections the adapter author had in progress:**
- **Offline `sourceLODKnown=false`: fixed.** `decorToSurfaceInput` sets it (`magna.ts:89`), the compiler warns on it (`compiler.ts:235`), and refinement output sets it to `true`.
- **Climate query extraction: fixed for decor input, still missing for World input.** `decorToSurfaceInput` now uses `climateFromMagnaQuery`, but `worldToSurfaceInput` has no climate (see M4).

**What checked out:**
- **Grid layout:** grids are cell-centred and row-major everywhere, consistent with `sampleGrid`, the Rust engine and the Neural Earth server (`x + (i+.5)*step`).
- **Axis swap and winding:** the swap converts Magna's y-down frame into a right-handed Y-up, +Z-south frame. Reversing the triangle winding keeps `cross(b−a, c−a)` aligned with the mapped normal, so normals stay correct.
- **Immutable source records:** input arrays are copied with `.slice()` or `structuredClone`, and the compiler takes its own snapshot.
- **Water class mapping** is correct.
- **Climate presets** are guarded against drift from the copy in `rust/bridge/terrain.ts`.

## Blockers

**B1 — The Neural Earth georeference describes a mirrored frame.** `neuralEarth.ts:5` (`MetricGeoreference.zAzimuthDeg`), plus `model.ts:1`.
- The doc comment says "X is +90° clockwise from +Z". But Magna maps are y-down (`exportWorld.ts:21`), so the metric +Z points south. The Neural Earth server also uses y-down from the north-west corner (`server.rs:6`), and so does Godot (−Z = north).
- With +Z south (azimuth 180°), that rule puts +X at 270°, which is west. Every import that follows this contract would be mirrored east–west.
- `model.ts` never states the frame's handedness or which way +Z points. The test fixture (`crs: 'local-enu', zAzimuthDeg: 0`) encodes the wrong convention.
- `RegionalLayer.originX/Z` doesn't say whether it is a corner or the first cell centre.
- **Fix:**
  - In `model.ts`, document the frame: right-handed, +X east, +Y up, +Z = Magna map +y (south).
  - Redefine the georeference rule as "X azimuth = zAzimuthDeg − 90°". Magna/Neural Earth tiles would use `zAzimuthDeg = 180`.
  - State that a layer's origin is the first sample centre, as `TerrainGrid` does.
  - Add a test that maps a known east/north point both ways.
  - This needs to land before any v1 packages are written, because their meaning would then be fixed.

**B2 — The export offset moves the terrain but not the buildings or roads.** `export.ts` (`compileFromDecor` and `exportSurfacePacket`).
- `originX/originZ` shift `world.terrain`, and through it the candidates. `urban.triangles`, `footprint`, `roofFootprint` and `urban.roads` stay in unshifted map coordinates, and nothing in the packet records the offset for them. Only `source.water` records the origin.
- Any caller that passes an offset gets buildings and roads displaced by exactly that offset relative to the terrain.
- `urban.roads` are also 2-D map `[x, y]` pairs sitting next to metric triangles, with no stated coordinate system.
- **Fix:** apply the same offset to building triangles, footprints and roads, or record `originX/originZ` and a per-array coordinate system in `urban`. Add a test with a non-zero offset that checks a building vertex lands on the terrain.

## Major (fix soon, not blocking)

- **M1 — Dry cells get a finite water level.** `magna.ts` (`decorToSurfaceInput`, `waterLevelM: r.waterLevel.slice()`).
  - Both `settlementRaster` and `readDecorBytes` set `waterLevel = height` for dry cells. `compiler.ts:175` copies that, so dry cells end up with a finite `waterLevelM`, which contradicts the "NaN at dry" contract. Any renderer that treats a finite value as water will flood dry land.
  - The test hides this by filling every cell with level 3.
  - **Fix:** set `NaN` wherever `water[i] === 0`.
- **M2 — `sourceLOD` runs in opposite directions across providers.**
  - The refinement server returns `lod = -level`, so finer tiles are more negative (`neural_refinement.py:234`). The Infinite provider and its tests treat a higher number as finer.
  - `SourceIdentity` doesn't define an ordering, so code comparing LODs across providers will draw wrong conclusions.
  - **Fix:** document `nativeSpacingM` as the only comparable measure, or normalise the sign in `infiniteRefinement.ts`.
- **M3 — The regional package's validation and serialisation are incomplete.** `neuralEarth.ts` (`validate`, `deserializeRegionalPackage`).
  - `±Infinity` is serialised as `null`, which comes back as `0` without any error.
  - Values that aren't numbers become NaN or 0 instead of being rejected.
  - `originX/originZ`, `season.dayOfYear`, `id`, `seed` and `features` are never checked, and plain (untyped) arrays pass validation.
  - A missing `georeference.origin` throws a TypeError instead of a validation error.
  - The reviver also takes over any opaque feature object that happens to have an `arrayType` key.
  - **Fix:** encode `NaN`/`±Infinity` as explicit markers, reject anything else, require typed arrays and integer ranges, and only revive arrays under `layers.*.values`.
- **M4 — The default climate doesn't match Magna's, and query parsing differs from the bench.**
  - `worldToSurfaceInput` and caller-built `exportSurfaceInputPacket` inputs fall back to the compiler's `temperate-default-1` (12 °C / 850 mm). Magna's `temperate` preset is 18 °C / 1000 mm.
  - `climateFromMagnaQuery` differs from `terrainbench.ts:253-255` in two ways:
    - It applies value overrides even for named presets; the bench applies them only for `climate=custom`.
    - It throws on a malformed value; the bench falls back to the default. An old decor with a bad parameter that loads fine in Magna would therefore fail to export.
  - **Fix:** add `climate` to `worldToSurfaceInput` (a required parameter or the Magna temperate preset), and copy the bench's rules exactly.
- **M5 — Abandoned live requests still block the page's terrain queue.** `createLiveInfiniteTerrainProvider`.
  - `sampleRustTerrain` runs on a shared queue (`terrain.ts:236`) and ignores the abort signal; the adapter only checks the signal after the work finishes.
  - A surface request that was cancelled still holds up the user's 2D/3D terrain requests.
  - **Fix:** give surface requests a priority or a separate queue, or add cancellation to the bridge before streaming is wired to the camera.

## Minor

- **`infiniteRefinement.ts`:**
  - `source.version` is the server's code `VERSION`, so two different registered fields with the same seed get the same `SourceIdentity`. Add `registration.id`, which is a content hash, to the version or provenance.
  - `meta.x/y/width` are never checked against the requested bounds.
- **Test realism:** the real server rejects the refinement test's registration (`n=2` when it requires 8–4096, and `seed: 'true-seed'` when it calls `int(seed)`). The test only proves the mocked transport behaves.
- **`stream.ts`:**
  - Stale-world rejections throw a plain `Error`, while `SurfaceTerrainSession` throws `AbortError`, so callers can't treat them the same way.
  - The response drops `sourceLODKnown` and `nativeSpacingM`.
  - `bounds` are not checked for finiteness: Infinity bounds pass the square check in `createInfiniteTerrainProvider` because `Inf − Inf` is NaN.
- **`provider.ts` (`SurfaceTerrainSession.request`):** if a request has already been superseded and its provider then fails with a non-abort error, that error reaches the caller instead of a stale `AbortError`.
- **`worldToSurfaceInput`:**
  - `boundary: 'truncated'`, but `flow` already includes injected river inflow, so `'external-inflows'` is the accurate label. As it stands, the compiler warning about unknown exterior inputs is misleading.
  - `receiver` comes from the depression-filled surface while `heights` are raw.
- **`createInfiniteTerrainProvider`:** the 64–1024 resolution clamp can silently return a different spacing than requested. Document that consumers must read `grid.spacingM`.

## Future suggestions (not phase-1 scope)

- **Neural Earth climate import:** uncorrected regional temperature fields need a per-cell reference elevation, but `ClimateInput.referenceElevationM` is a single number. Add an optional field, or require the adapter to correct to the local DEM and set `elevationCorrected`. Also add an adapter from `RegionalLayer` to `ClimateInput` with resampling, and units like `kg m⁻² s⁻¹`.
- **Decor heights:** they come from bilinear sampling of the display B-spline control grid (`rust/bridge/settlements.ts:88`). Keep this for city compatibility, but say so in the provenance; it conflicts with the "never B-spline coefficients" note in `infiniteRefinement.ts:10`.
- **Lapse rate below sea level:** Magna clamps with `max(h, 0)` but the compiler does not, so cells below sea level come out warmer.
- **Streamed tiles:** they need a halo, as `TerrainRefinementSession` has, so slope and terrain-position calculations don't break at tile seams.
- **Winding test:** add one asserting `dot(cross(b−a, c−a), normal) > 0` for every exported triangle.
