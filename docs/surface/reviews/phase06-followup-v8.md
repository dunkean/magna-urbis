# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Final independent review: V8 on `984f488`, F1/F2/F3, surface-1.5.2 layers and cities 419/500

# # Verdict

- **Technical prototype: qualified.** It is suitable for continuing the evaluation of the mapper.
- **Production and artistic acceptance: refused.** The status remains CHANGES REQUIRED.
- **Previous failures:** V8 does not erase anything. V1, V2, V3, V4, V6 and V7 remain FAILED. V5 does not qualify the 1.5 code.

I opened the 7 PNG of the tour, the 4 PNG of visibility, the unlit PNG, the 3 PNG native419 and the 4 historical PNG city500. I also opened `canopy-r4/top-2560m-comparison.png`.

**What I couldn't verify:**
- This session does not have a shell. So I couldn't run `git diff 984f488..HEAD` to confirm that the later commits only affect the documentation.
- Snapshot equality is based on the hashes recorded in `report.json`: `selectedRepository` and `finalRepository` both have HEAD `984f488`, status `""` and 542 files (lines 8536–9089).
- **Factual correction:** the prompt cites 529 runtime files. This figure is that of V6 and V7. V8 has **542** (`native-e2e-v8.json:18`).

# # Integrity of the V8 campaign (verified)

**Status and source**
- Status is `complete`. The source is fresh: coarse4/original/original models, neural token `3aabd4c1…`, SHA hash `3c7c2f32…`.
- The raw grid is 1024² at a step of 39.0625 m; the export is 512² at a spacing of 78.125 m.

**Navigation**
- Movement of 20.016 s. Three fresh preview128 worlds have been displayed, at native spacings of 15, 0.9375 and 0.46875 m.
- The final world `preview:false/512` was delivered in 140² at a spacing of 0.4657 m. This size is capped by the physical step of the source.

**View 10 m**
- The capture `06_10m` reuses the world `8375c84a…` from the query 5 (`viewSatisfiedSerial` 6). This is legitimate camera satisfaction, not fresh acceptance.

**Four quantities not to be confused (capture 10 m)**
- **Screen:** 4.8828125 mm per pixel.
- **Delivered grid:** spacing 0.4673 m.
- **Native source spacing:** 0.46875 m.
- **Mesh:** `geometryDetail` grid of 214² at a pitch of 0.467 m.

**Costs retained**
- Warmup of 50.5 s.
- Source application hole of **9.578 s** during movement.
- Frame time: p99 of 60 ms, maximum of 529 ms.

**Urban content**
- Fresh campaign contains **0 building and 0 road**: `nativeBuildings: 0` and `roadProjectors: 0` in `native-tour/metrics.json:3389,3446`, no non-zero road projector in `report.json`.
- It therefore does not qualify either a populated city or the support of roads.

# # F1 — rectangular forest page: **still visually broken**, partially technically corrected

**What is fixed**
- The MultiMesh normals defect (inverse-transpose) is corrected (`canopy-r4/README.md:5`).
- The optical filter is shared between representations.
- The aggregate coverage is fair: the combined C/V error is at most 0.095 point (`page-gpu.json:6`).

**What the pixels show (original pixel coordinates 2048×1280)**
- **`02_2560m_top.png`:** a square of approximately 370 px (≈ 460 m, i.e. the page of 480 m) occupies x≈835–1205, y≈440–815.
  - Inside, the crowns are larger and grouped.
  - Around, a **lighter halo** reveals the ground.
  - This is exactly the F1 fault. It is still visible in panel “r4” of `canopy-r4/top-2560m-comparison.png`.
- **`01_10000m_top.png`:** same footprint, visible as a texture seam towards x≈980–1020, y≈590–675. It disappears in `no-trees.png`, so it belongs to the representation of trees.
- **`03_640m_top.png`:** two **vertical bands of translucent ghost crowns** towards x≈305–355 and x≈1685–1735. They coincide with the edges of the page of 480 m (1536 px).
  - The crowns change size and density on both sides: approximate sites at 16 m outside, exact inventory inside.

**Why the proof does not cover this defect**
- The `page-gpu` proof is a flat canvas average of the entire page (“flat canvas optical-area proof”). It does not measure the transition strip `paintBlendM` 48 m / `geometryBlendM` 64 m, nor a spatial seam.
- The precise cause of the halo is not measured. The most likely hypothesis is the transition band in `canopy.gdshaderinc:49-72`.

**Representation of trees (views 160 m, 40 m, 10 m)**
- The crowns are identical smooth spheres. At 10 m, the faceted silhouette is visible, and spheres interpenetrate.
- Proxy shadow is consistent with crowns. I checked the constant offset of approximately (4.7; −8.5) m on several pairs in `04_160m`.
- But they are **flat disks with stepped edges**, in step with the texels of the atlas (≈ 0.15 m, very visible in `05_40m` and `06_10m`). The shadow has a fixed offset regardless of tree height and never falls on other crowns.
- Small low canopy cubes cast navy blue engine shadows, inconsistent with the gray of the proxy shadows.
- All this corresponds to the declared approximation. It is not a physical forest shadow.

# # F2 — regional rivers: **corrected for omission**, partially visually corrected

**What is fixed**
- No missing surfaces and no missing level triangles on the 7 scales.
- `budgetLimited:false`, no fallback, `minimumRiverStrokeApplied:false`, projection `source-map-terrain-projection`.
- The policy `subpixelPolicy` is declared, including in the empty branch (`surface_water_projection.gd:52`).

**Retry on board at 40 km (reread code, `surface_hydrology.gd:100-109, 213-219`)**
- 51 queries have been resolved, with a maximum deviation of 0.000122 m.
- The retry only applies **outside the support**, within a tolerance of half a ULP FP32 plus the original rounding. The point is already returned to NaN when it is interior.
- It does not move any vertex and does not widen the search for wet cells. He cannot invent an inner level.

**What the pixels show**
- **At 40 km:** the tributaries appear as **intermittent blue dotted lines, with gray-white stepped dashes**.
  - The projection texture is 24.4 m per texel, compared to 19.5 m per pixel on screen, and the rivers are thinner than a pixel.
  - It's honest (no hidden widened lines), but the regional readability of the map remains poor.
  - An uncovered background strip of approximately 35 px is also visible at the right edge.
- **At 10 km:** the network is continuous, but with stairs inherited from the source route, rectilinear segments aligned on the axes (towards y≈530 and y≈1090) and light spots at confluences.
- **At 2560 m:** a continuous line which stops towards x≈425, y≈730. This is consistent with a tributary head in the 10 km view; the direction of flow is not verified.

**Bed/water conflicts (disclosed and authorized)**
- 40 km: 2931 on 4087 samples, maximum delta of 58.2 m.
- 2560 m: **3882 on 3961**.
- Any presentation of physical water in aerial view would therefore be invisible almost everywhere. Only the cartographic projection is defensible.

# # F3 — colored stairs at 78 m: **drawn, not eliminated** (partially corrected)

- Single variable diagnostics exist (`surface_body.gdshaderinc:173-189`).
- `ground-mean-unlit.png` (diagnosis 7, raw soil average, bilinear) shows dark brown spots with stepped edges, at a pitch of approximately 16 px × 4.88 m ≈ **78 m**. Examples: x≈970–1165, y≈575–840, and the large massif at the bottom left.
- The same pattern appears in `ground.png`. It is attenuated in `no-trees.png` and hidden by the optical stippling of the canopy in `all.png`.
- The staircase therefore comes from the **canonical ground field at 78.125 m** (`surface_average`, `filter_linear_mipmap`). It comes neither from the low cover, nor from the trees, nor from the zoom.
- What I did not measure: whether it is real categorical contact or narrow humus thresholds (0.72–0.88) applied per cell.
- The invariance of the canonical fields between zoom levels has not been tested in pixels: the layer probe only operates at 10 km.

# # Three-layer contract: **corrected for technical scope**, with reservations

**Checked in code**
- Nine typed tables, i.e. 4×u16 + 3×f32 + 2×u32 = 28 bytes per sample (`surfaceLayers.ts:9`, integrated into the `compiler.ts:72` memory estimation).
- Validation of types, roles, terminals [0, 1], `fieldsVersion` and the canonical version (`surface_layers.gd:57-115`).
- The legacy announces `legacy-composite-unavailable` without unmixing attempt (`:94-99`).
- The RGB is premultiplied **before** `generate_mipmaps` (`:151-153`).
- The shader weights by `surface_weights*alpha` then normalizes (`surface_body.gdshaderinc:101-124`).
- The .2/.8 and transparent magenta tests are present (`surface.layers.test.ts:18-37`).

**Verified in pixels**
- Hiding trees cuts off residual canopy **and** proxy shadow (`surface_body:136-140`); tree and trunk instances are hidden via `surfaceLayer` (`main.gd:607,634,1188`).
- `no-trees.png` does not keep any green dotted lines.
- The soil is not a uniform brown (`ground.png`).
- The hashes of field, soil, sample, inventory, context and `geometryDetail` are identical, and the four central digests are distinct (`layer-report.json`).

**Reserves**
- Isolation is only proven in pixels at 10 km, a scale **without instance geometry**. Hiding tree and low canopy meshes in close view is only checked in code.
- `lowCoverOpacity` and `treeOpticalCoverage` in the report are worth “potential × flag”: these are not areas measured on GPU.
- The low cover appears beige-yellow, not grassy, and the close ground appears bare. This is a recipe choice to be reviewed, not a violation of the contract.

# # Cities

**native419 (`web/out/surface/native-current-419-final/`)**
- **Oblique perspective:** real orange two-sided roofs and shadows of buildings. This is a clear progression from the historic 500 package.
- **Major artistic flaw:** the built ground is a flat grayish white with blurred edges (15.6 m grid), which reads like snow. No interior street is visible (access outside the perimeter).
- **Close-up seen from above:** closed and legible contours, trees in points; blurred and jagged dark areas.
- **Overview:** buildings are just white dots at about 6.5 m per pixel, and the ceiling of 256 road projectors is reached.
- **Declared limits:** 81 refusal of planning, parent land at 15.625 m of LOD of unknown origin, accounts submitted ≠ accounts visible on GPU, bed/water conflicts of 84 on 117 in the close-up.

**History 500 (`city500-v152-final/`)**
- The close-up perspective shows mostly **roofless cream boxes**, with some brown roofs.
- The close-up contains open contours, for example towards x≈295, y≈215 and x≈50, y≈425.
- It is negative or historical proof; it should not be presented as native roofs.

# # Confirmed defects

**Blocking for the prototype:** none.

**Major (blockers for artistic production or acceptance)**
1. **F1:** forest page visible at 10 km, 2560 m and 640 m (square, halo, ghost bands).
2. **Representation of trees:** identical spheres, flat stepped shadow disks, shadows inconsistent with those of the low canopy.
3. **Rivers at 40 km:** dotted and illegible. Missing a **declared** map symbology, not a minimal hidden feature.
4. **Urban ground** white, snowy, in native view419.

**Moderate**
- Stairs 78 m from the ground (F3).
- Light spots at confluences.
- Background strip at the right edge of view 40 km.
- All captures of the tour are in `aerial` mode (`cartographic:false`, `native-tour/metrics.json:2879-2882`): no plan or blueprint style was captured on the fresh source.

# # Unmeasured risks

- Spatial stitching of the canopy page (the probe only measures the average).
- Hiding geometries in close view, in pixels.
- Zoom invariance of canonical fields.
- Energy and penumbra of proxy shadows.
- Application holes of several seconds and costs p99/max.
- Bed/water conflict rate from 72 to 98%.
- Content of commits after `984f488` (diff not executed).

# # Backlog (does not prevent the prototype from being accepted)

- Non-spherical and active crowns.
- Regional hydrographic symbology.
- Parity of map styles.
- Fresh city with fine detail.
- Complete rendering of the roads.
- Interiors and access.
- Continuous streaming at 60 FPS.
- Final choice of engine.

# # Delivery judgment

**Technically qualified prototype: YES**, to continue evaluating the mapper with Godot as a candidate. The source → layers → rendering → navigation chain is intact and traceable, without omission of water, without mutation of physical data and without false buildings.

**Artistic production or acceptance: NO.**
- F1 remains visibly broken.
- F2 is only corrected for the omission; regional readability at 40 km remains poor.
- F3 is traced but not eliminated.
- The layer contract is technically respected, with isolation proven at a single scale.

This result establishes neither a millimetric detail, nor updates to 60 FPS, nor the parity of styles, nor a fresh fine city, nor a final choice of engine.
