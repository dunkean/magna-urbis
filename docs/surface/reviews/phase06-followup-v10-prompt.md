# Independent Opus 5.5 high review — V10 draft, NOT launched

Use Claude Opus 5.5, high effort, read-only tools. This prompt is prepared before V10 finishes. **Do not infer PASS from its existence.** Return the review as text; do not write files, launch Godot/browser/Python services, run tests/builds/generation, install packages, change any checkout, or use a GPU. Read-only source/report/git/hash inspection and actually opening existing PNGs are allowed. Preserve every original review and failed campaign.

## Completion block — orchestrator must fill from the actual finished run

- Integration worktree ROOT: `D:/workspace/self/_worktrees/magna-urbis-surface-world-2026-10-23`.
- V10 directory: `ROOT/web/out/surface/native-e2e-40km-v10/` [CONFIRM ACTUAL PATH].
- Selected HEAD: frozen f4d25e1 [EXPAND FULL SHA FROM REPORT]; final HEAD: [FILL FROM REPORT]. Selected/final status: [FILL].
- Runtime snapshot file count/digest: [FILL FROM ACTUAL V10 REPORT; NEVER COPY529,542 OR V9'S560]. Asset manifest/digest: [FILL SEPARATELY].
- Final campaign status/exit/failure stage: [FILL; UNKNOWN UNTIL COMPLETED].
- Fresh source: [MODELS, TOKEN, RAW/EXPORTED GRID AND SPACING, SHAS, GENERATION TIMES].
- Motion window: [ACTUAL DURATION]; fresh accepted AND actually rendered preview worlds during motion: [COUNT/IDS/SERIALS/TICKS]; final false512 and drain: [RESULT/TIMES/DELIVERED GRID].
- Tour: [ACTUAL PNG COUNT/PATHS]. Isolation: [ACTUAL10km AND160m STATUS/PATHS].
- Measured frame/apply/CPU/GPU costs and sample counts: [FILL WITHOUT CALLING SAMPLE COUNT FPS].
- V10 input/code change relative to ab3c499: canonical-population TS optimisation plus scripts/docs, independently checked bit-exact; inspect the actual diff and runtime digests. The native Godot consumer used by city419 on ab3c499 is byte-identical to the fresh f4d25e1 consumer; the city packet SHA remains54616775da71a5fb94e32d1cce13b59cad38f79f410f04525be72bc14edf589e. Do not call those retained city images fresh V10 NN output.

If any placeholder remains, identify the gap. If a run failed or expected images do not exist, report that explicitly and do not qualify the absent stage. Do not substitute V8, V9 city, retained probes or authored fixtures for a missing V10 image.

## Product and preserved negative evidence

Magna Urbis is a mapper/city generator for styled2D/3D roleplaying maps, plans, orthographic views and export. Godot is a candidate main renderer, while contracts/styles/source data remain engine-neutral. Infinite Generation remains the actual height source; the viewer must not invent terrain, roofs, streets, material evidence or accepted trees.

Read `ROOT/docs/surface/reviews/phase06-followup-v8.md` first. V8 on984f488 technically qualified the prototype but refused artistic/production acceptance: visible forest square/halo/ghost bands, intermittent regional rivers, stylized spherical crowns/optical shadows, and white snow-like urban support. The original regional78m ground steps were a separate moderate F3 finding; do not silently rename or erase it when reviewing the newer urban-ground correction.

**V9 on ab3c4996e16be503dbcc5e3f04cd5592e361009a FAILED navigation.** Read `ROOT/web/out/surface/native-e2e-40km-v9/report.json`, `native-navigation/navigation-report.json`, `metrics.json`, `stdout.log` and `stderr.log`. Motion lasted20.004s with zero new preview worlds actually displayed. Preview41 was accepted near122017ms, motion ended123540ms, and its first actual render was126885ms. Native g9 preparation3700.093ms/upload32.538ms is the actual concurrent measurement. No V9 tour or fresh layer-isolation stage ran. Do not reinterpret acceptance as display or replace these timings with an unmatched headless replay. Prior failed campaigns remain failed; V10 must stand on its own.

Read the integrated docs and relevant code, not just this explanation:

- `docs/surface/V9_CORRECTIONS.md`, `CANDIDATE_PAGES.md`, `WATER_SYMBOLS.md`, `URBAN_GROUND_SUPPORT.md`, `docs/SURFACE_RENDER_LAYERS.md`.
- Compiler1.5.3 derives new infrastructure support; separately named physical-context algorithm remains1.5.2. Verify this separation rather than reporting a false physical/population re-generation.
- `web/src/surface/{compiler,groundSupport,population,candidatePages,surfaceLayers}.ts` where present, packet/binary validation and worker producer; discover exact paths rather than assuming a missing file.
- `viewer-local/adapters/{surface_canopy,surface_canopy_view,surface_population,surface_scene_prepare,surface_data,surface_layers,surface_hydrology,surface_water_projection,surface_water_symbols,surface_water_contours}.gd`, `scene/main.gd`, corresponding shaders and external navigation/layer probes.

`URBAN_GROUND_SUPPORT.md` was found cp1252 before final documentation cleanup. Read its content with the correct encoding if needed; a replacement glyph in128² does not disprove a numeric report. Do not mutate the file to fix encoding during this review.

## Mandatory image opening:20 V10/current-city PNGs, plus comparisons

Open every existing full-size PNG below. Metadata descriptions, image hashes and passing tests do not replace viewing pixels. List exactly which images were opened. If tools cannot open images or inspect git, state the limitation instead of claiming verification.

1. **Seven fresh V10 TOP images** under `native-e2e-40km-v10/native-tour/`: `00_40000m_top.png`, `01_10000m_top.png`, `02_2560m_top.png`, `03_640m_top.png`, `04_160m_top.png`, `05_40m_top.png`, `06_10m_top.png`. Confirm actual paths from the completed report.
2. **Two same-source isolation sets**, expected `native-e2e-40km-v10/native-layer-isolation/10000m/` and `/160m/`: open `all.png`, `no-low-cover.png`, `no-trees.png`, `ground.png`, and `ground-mean-unlit.png` in EACH directory. Read both `layer-report.json` and metrics/logs. Missing sets cannot be marked passed.
3. **Three retained native419 V9 city images**, actually completed on ab3c499, under `ROOT/web/out/surface/native-current-419-v9-final/`: `blueprint-native-close-top.png`, `aerial-native-close-oblique.png`, `aerial-native-overall-top.png`. Read their JSONs, `capture-run.json`, `qualification-report.json`, `source-frame-counts.json`, `source-page-report.json`, and `ground-migration-report.json`.
4. **V8 comparisons:** actually open the V8 tour40km/10km/2560m/640m images under `native-e2e-40km-v8/native-tour/`, V8 `native-layer-isolation/{all,no-trees,ground,ground-mean-unlit}.png`, and the corresponding three original city images under `native-current-419-final/`. Match filenames from disk. Compare defect patterns at native resolution; fresh campaign differences are not a controlled pixel A/B unless source bytes match.
5. **Canopy spatial and water bank controls:** open `docs/surface/evidence/canopy-v9/{top-10000m,top-2560m,top-640m,oblique-640m}.png` and locate/open the five beauty and five target-C pans identified by its manifest (`...surface-v9-viewer/viewer-local/captures/v9-final-spatial/pan-{19680,19840,20000,20160,20320}-{beauty,target}.png`). Read the pointwise, reprojection, lineage and effective-atlas reports. Open the retained-water source/reference/post-only/vector/roof control PNGs named by `docs/surface/evidence/water-vector-symbols-v9-gpu.json` and read that report. These are bounded replay controls, NOT fresh V10 or Terrain3D/full-style proof.

## Questions that require code AND pixel evidence

### F1: source page must never become a visible forest boundary

Check 10km/2560m/640m and the near views for the old480m square, cleared halo, translucent edge bands, differences in cap size/density/illumination and atlas clamp stripes. Do not pass F1 solely from mean coverage, a larger page or a zero-error algebra test.

A page is complete only within its actual bounds; requested bounds/budget reduction do not imply full view coverage. Full frustum, halo, atlas and resident-height envelope must be covered. Phase0→1 is global meso→exact optics with no geometry; phase1→2 keeps exact optics and adds physical-pixel geometry. Check immediate safety decline, smooth rise/replacement, actual active-atlas hash/source/epoch, pending flag, stale lineage clearing, matching transmittance/coverage kernels and actual selected IDs. Stable images must await transition completion. During navigation a declared whole-view meso representation is legitimate; an old world or obsolete geometry must never be counted as a fresh source display.

Inspect spatial pans and zooms across former page edges. A conservative oblique phase0 is allowed and must be disclosed; it is not proof of exact oblique trees. The ideal-disc C/V test is not equality to tessellated native silhouettes. Spheres and approximate optical total-C shadows remain stylized; do not label them photoreal assets or physical forest-shadow energy. Note unresolved aesthetic issues separately from the administrative seam.

### F2: readable original hydrology with declared cartographic symbols

Review all seven per-capture water records, especially40km/10km/2560m, and the actual visible bank network. Require original requested/output/missing areas, missing levels, contour completeness/hash, budgets and fallback policy. A final empty near view cannot stand in for regional evidence.

Version2 strokes the retained Float64 polygon rings before rasterisation, with a declared1.25screen-pixel all-water boundary symbol. It does not infer a centreline, source width, flow, surveyed topology or new sea shoreline. Raw helper/mode0 remains unexpanded; physical source-levels forbids symbols. Screen MPP, texture texel size, padding, image budgets, contour budgets, palette/hash/scale cache invalidation and source clip coverage must be explicit. Padding is NOT additional source data. Source areas and symbol coverage must remain separate.

The projection targets terrain layer1 and must leave roofs/bridges/other layer2 geometry intact. Genuine source-level/bed conflicts are permitted for a declared mapper projection and must remain reported; do not demand zero conflicts or call the projection physical water. Check continuity/readability without accepting invented pixels away from true contour/AA bands. The bank control uses182735samples with a visibility neighbourhood and a controlled flat receiver, not a discharge/topology/full-style certificate.

### Urban ground correction and legacy regional F3

Compare retained419 V8/V9: does the broad pale snow-like Built/Road/Yard support vanish while local mineral/organic substrate persists? Occupation cells are conservative exclusions, not proof of paving. Preserve source-width road finishes, native materials/roofs/plans and cultivation; do not invent streets/access. Examine actual blueprint and aerial images, not merely the migration's changed-cell count.

Separately trace remaining78m regional steps using bare-ground diagnostic7 at10km and160m. Distinguish actual source resolution/categorical contacts from opacity/UV/mip/compositor artifacts. No camera noise/blur may fake ecological invariance. A remaining source-resolution limitation must not be represented as eliminated.

### Sol / herbes-litière / arbres are independent

Check the nine typed arrays/roles/version hashes and legacy-unavailable policy, premultiplied low-cover RGB and alpha-weighted material/roughness/normal interpolation. Ground remains under vegetation/water; canopy is not a soil recipe or a global three-part sum.

At BOTH isolation scales, compare source/terrain/ground/context/detail/inventory hashes and actual instance buffers. At160m require contributing tree instances before masking, zero visible/ALPHA-positive tree+trunk instances after no-trees, proxy residual AND optical shadow off; require actual low-cover geometry before masking and zero afterwards. Ground/boulders remain unchanged. Submitted allocation, node visibility, positive shader ALPHA with centres in frustum and GPU occlusion are different quantities. Never treat potential cover×flag as a measured pixel area. Read actual uniforms and the population_instances hook plus opened images. Distinct central pixel hashes alone do not prove semantic correctness.

## Integrity, source scope and cost

Join actual render events to fresh live acceptances by world/serial/epochs/ticks within the unchanged20s motion window. Require original preview128 evidence and finalfalse512/drain. A cache-satisfied camera is legitimate only with actual coverage/density/lineage evidence; it is not a fresh acceptance. Do not lower the gate or count merely scheduling preparation.

Require identical selected/final runtime snapshot HEAD/status/file list/digests for the ACTUAL V10 run. If only recorded hashes can be inspected, say so. Read-only diffs must establish which changes followed a capture. Retained419 ab3c499 captures are not falsely relabelled as whole-snapshot V10 renders; compare native renderer subset digests if claiming equivalent renderer code. Assets are versioned separately from canonical geology/recipes.

Name camera millimetres per pixel, delivered grid width/spacing, native source spacing/knownLOD, mesh spacing and derivative grid separately. A5mm/pixel image is not5mm NN geometry. Report actual source-contribution at focus, not simply child metadata. Preserve worst-case HTTP/worker/decode/native prepare/upload/apply gaps, cold start, p99/max and CPU/GPU sample counts. Do not advertise60FPS from a few frame timing samples or startup duration.

The fresh landscape may have0buildings/roads: verify exact counts, and then explicitly exclude fresh populated-city qualification. Retained city419 has419 authentic current native exteriors from500 attempts and81 declared refusals. Terrain parent15.625m/unknown originalLOD, decoderUsed=false and no active fine contribution remain the city scope. Submitted254/335/419 and CPU-frustum91/139/419 are previous measured estimates to verify, never GPU-visible counts. Regional roads hit a256projector cap. The roof-absent legacy500 packet is historical/negative evidence, not419realized or500complete. No interfaces, access/capacity, full route coverage or fresh fine city is implied.

## Required review output

Lead with separate verdicts: technical prototype, visual corrections F1/F2/urban support, three-layer contract, and artistic/production readiness. Use PASS / PARTIAL / FAIL / UNVERIFIED per scope, not one blanket success. List opened PNGs and unavailable checks. Give reproducible findings by severity with file/line or PNG original-pixel coordinates and exact evidence. Separate measured facts from hypotheses; avoid treating declared approximations as secretly physical or a unit test as beauty approval. Preserve V9's FAILED result and all earlier original verdicts. Finish with concrete remaining blockers/limits and next bounded changes, without claiming the final engine choice, style parity, photorealism, city freshness, interiors or performance beyond the evidence.
