# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Independent review of the V12 final campaign on `bc6579f`

Model: claude-opus-5-5, high effort, read-only tools. I had no shell in this session. I did not recompute any SHA-256, did not run `git`, and did not launch anything. Every hash below is a **recorded** value that I cross-read between files, not one I computed.

## 1. Verdicts by scope

| Scope | Verdict | Basis |
|---|---|---|
| **(1) Navigation gate (strict 20 s)** | **PASS, with a thin margin** | One new preview world (`7a9658…`, serial 59) appeared 17.018 s into the 20 s window. I checked the join between acceptance and display myself. This is one run with a 2.98 s margin. |
| (1) Navigation quality of service | **PARTIAL** | Longest gap between geometry applications: 9.758 s. Worst frame: 1625 ms. Worst script frame: 1700 ms. Warm-up 62 s, drain 17 s. Prints of 178–234 ms happened inside the window. |
| **(2) Seven settled tour views** | Technical **PASS**; visual **PARTIAL** | All 7 opened. Sources and quality requests are as recorded. Defects listed in §4. |
| **(3) Layer contract and probes (10 km and 160 m)** | **PASS within the stated scope** | Both sets opened. Hashes are stable within each view. The tree, trunk and low-cover counts behave as specified. The 10 km probe has no instances, so per-instance masking is proven only at 160 m. |
| **(4) Retained 419-building city and styles** | Static technical **PASS**; visual **PARTIAL** | This is the unchanged retained source `54616775…`. It is not a fresh city. Two of the three views record `viewSatisfaction.covered:false`. |
| **(5) Global technical campaign** | **PASS** | Navigation passed, so the failure-retention branch was never taken. `retainedNavigationFailure` and `visualsAfterNavigationFailure` are absent from the report. This is **not** a "GLOBAL FAILED with retained visuals" case. Had navigation failed, the run would be GLOBAL FAILED regardless of the 20 PNGs. |
| F1, forest page seam | **PASS for the seam**; tree aesthetics **FAIL** | The square, halo and ghost bands seen in V8 are gone, on the same raw height SHA `3c7c2f32…`. Spheres and stair-stepped proxy shadows remain. |
| F2, regional hydrology | **PARTIAL** | Strokes are now continuous and readable at 40 km, 10 km and 2560 m. Remaining: pale halos at confluences, pale dashes along some streams, and the band at the right edge. |
| Urban support (snow-like ground) | **PASS** | The broad pale "snow" from V8 is gone in V9, V11 and V12, replaced by beige mineral ground. |
| Legacy regional F3 (78 m ground steps) | **FAIL: traced, not eliminated** | The 10 km bare-ground diagnostic is visually identical to V8's. |
| **Artistic and production readiness** | **FAIL (not accepted)** | — |
| Image hashes and git history after the capture | **UNVERIFIED** | No shell (details in §2). |

All earlier verdicts stand. **V9 (`ab3c499`), V10 (`f4d25e1`) and V11 (`176e774`) remain FAILED**, as do V1–V4, V6 and V7. I re-read: V9 `navigation-report.json` (status failed, 0 fresh displays, 20.004 s), `native-e2e-v10-negative.json` (FAILED, 27.015 s, 0 displays), and `native-e2e-v11-negative.json` (FAILED, first preview accepted 16.426 s after motion start and displayed after 20 s). V8's original refusal of artistic acceptance is preserved.

## 2. Images opened and checks not done

**Opened at full size (71 PNGs in total):**
- **V12 tour:** `00_40000m`, `01_10000m`, `02_2560m`, `03_640m`, `04_160m`, `05_40m`, `06_10m`.
- **V12 layer isolation, `10000m/` and `160m/`:** `all`, `no-low-cover`, `no-trees`, `ground`, `ground-mean-unlit` in each.
- **V12 city:** `blueprint-native-close-top`, `aerial-native-close-oblique`, `aerial-native-overall-top`.
- **V8 tour:** 40 km, 10 km, 2560 m and 640 m.
- **V8 isolation:** `all`, `no-trees`, `ground`, `ground-mean-unlit`.
- **City controls:** the three V8 originals (`native-current-419-final/`), the three V9 images and the three V11 images.
- **Canopy controls:** `canopy-v9/top-10000m`, `top-2560m`, `top-640m`, `oblique-640m`, plus the 10 spatial pans (`pan-{19680…20320}-{beauty,target}`).
- **Water controls:** `source-reference`, `contours-mode0`, `symbols-1_25`, `symbols-roof`.

**Limitations and checks I did not do:**
- **Hashes:** I recomputed no SHA-256 for PNGs, packets or the report. I only observed that recorded hashes agree. For example, `10000m/all.png` and tour `01` both record `b2e45de9…`, and `160m/all.png` and tour `04` both record `97746e86…`. The images agree visually, but I cannot tell whether these are deterministic re-renders or the same capture.
- **City "byte-identical to V9/V11":** V9, V11 and V12 look indistinguishable to me, but I did not verify bytes.
- **Git:**
  - Not run.
  - `v12-runtime-equivalence.json` records `currentHead: 031e0f1…`, 584 files and no mismatches. That is neither the campaign HEAD (`bc6579f`) nor this session's HEAD (`6820ff3`). Commits after `031e0f1` (including `6820ff3`, `bb652dc`, `e709ad0`, `01a8fec` and probably `9182e4e`) are **not covered** by that record.
  - Whether they touch only documentation is unverified.
- **Repository snapshots:**
  - V12 `report.json` has `selectedRepository` and `finalRepository` at `bc6579f` with status `""`, and the driver asserts they are frozen (`generate_surface_source.mjs:530-531`).
  - The city `capture-run.json` has `rootBefore`/`rootAfter` at `bc6579f`, status `""`. Its file list (lines 144–730) is consistent with 584 entries by span, but I did not compare entries pairwise against the campaign map.
- **Missing control:** `post-only-reference.png` is absent from `water-symbols-real-v9/`. I did not open it because it does not exist.
- **Not read, or read only partly:**
  - Canopy-v9 pointwise, reprojection, lineage and effective-atlas JSONs.
  - `water-vector-symbols-v9-gpu.json`.
  - The A/B raw logs and PAGE rows.
  - The V11 scheduler-replay trace and profile.
  - The `fresh-worker-cdp/` contents (I confirmed the files exist, nothing more).
  - The retarget, source-presentation and hydrology-cache documents (I read only their top-level status: `PASS_WITH_SCOPE`, `PASS`, `PASS_WITH_STATED_SCOPE`).
  - The V10 review (only its verdict and limits lines).
  - Driver, tour and probe stdout/stderr logs (not read in full).
- **PAGE counters:** I confirmed `pageTiming.limit` 4096 and `dropped` 0 (`report.json:41386-41387`). I did not count the 1045 events.
- **Root-reported preflight** (224 tests, 42 files, tsc, build, 13 Node tests, native parse, 65 hydrology checks): taken from tool records only. Not rerun.

## 3. Navigation: matched timeline (ticks in ms, motion window 87928–107928)

| Event | Tick | Source |
|---|---|---|
| Camera refreshes of the warm world `bf086e9c` (serial 0) | 88052, 88236, 97864 | `navigation-report.json:2494-2757` — correctly **not counted** as fresh (same world as the initial one, `surface_navigation_evidence.ts:130`) |
| Preview 59 HTTP completed (request took 8279 ms, so it started ≈91174) | 99453 | `metrics.json:262-273` |
| Preview 59 accepted (12.67 s after motion start) | 100598 | `metrics.json:207` |
| Cancellation of a camera-only refresh: requested, then reached at `height-rows` 41.067 ms later | 100601.1 → 100642.2 | `metrics.json:693-702` |
| **Preview 59 first displayed (+17.018 s)** | **104946** | joined with render event and acceptance |
| Same world displayed again (camera refresh, **not** a second world) | 107373 | — |
| Actual end of motion; terminal input gap 1.498 s | 108046 | — |
| Preview 198 accepted (8.7 s *after* the nominal end), HTTP 14.498 s | 116660 | after the window; not counted |
| Final world serial 275 accepted, then applied | 119764 → 123334 | 133² grid at 0.46835 m spacing, native LOD −6, `decoderUsed=true` |

**Not attributed:**
- From accept to display took 4.35 s. A 3242.6 ms prepare (generation 7) is the likely match by focus and width, but that join is my inference.
- Of preview 59's 8.28 s HTTP time, the worker reports only `synchronousProcessorWallMs` 2654.5 ms. About 5.6 s is **unattributed** (broker wait, scheduling, transfer).
- Population prepare takes about 1 s per near job and data prepare 1.5–1.9 s. I did not verify which thread they run on.

Preview 59 is LOD 0, native 30 m, 128² at 51.79 m, with `decoderUsed=false`. It proves a new world was displayed. **It does not prove finer learned detail during motion.**

**Costs (reproduced, not summarised away):**
- Navigation frame wall time p50/p95/p99/max = 31.236 / 39.101 / 64.117 / 1625.123 ms. A separate `frameWallMs` block without a max reads 31.245 / 37.74 / 44.426.
- `cpuScriptMs`: 2561 samples, max 1700.361 ms.
- GPU p50/p95/p99 = 8.448 / 14.443 / 18.803 ms; the count of positive GPU samples is not exposed.
- 2127 frames. This is not an FPS figure.
- Video memory 1,100,181,280 B; textures 922,809,856 B. No RSS or heap budget exists.
- Initial HTTP: 140.65 MB taking 24.3 s.
- Nothing here supports a 60 FPS claim.

## 4. Findings by severity

Coordinates are in **original pixels** (2048×1280 for tour and probe images; 1280×800 for city images).

### Major (block artistic or production acceptance)

**M1. Tree representation remains stylised geometry, not forest.** This is a declared approximation, not a hidden physical claim, but it is unacceptable visually.
- `04_160m`: spheres interpenetrate with visible clipping seams, around (246,389) and (676,717).
- Proxy shadow discs have staircase edges at atlas-texel pitch everywhere. Examples: the disc near (860,164) in `04_160m`; the region (0–246, 205–799) in `05_40m`; the band (1126–1536, 655–1280) in `06_10m`.
- `06_10m`: the faceted crown silhouette is visible along (1126–1536, 0–666).
- Low-cover cubes cast **navy engine shadows** at (512,266) and (1219,1188), while crowns cast grey proxy shadows. Two inconsistent shadow models in the same frame.

**M2. F3 is unchanged.**
- `10000m/ground-mean-unlit.png` (diagnostic 7) shows dark brown stair-stepped patches at about 16 px × 4.88 m ≈ 78 m. Examples: (973–1157, 717–840), (1137–1203, 461–594), (1802–1905, 604–686), and the lower-left massif (0–461, 799–1280).
- I compared this image side by side with V8's: they are visually identical.
- The steps carry through to `ground.png` and `no-trees.png`, and are masked by stipple in `all.png`. This matches the 78.125 m canonical texture grid (`textureGrid.spacingM 78.125` in every tour record).
- I did **not** measure whether these are categorical contacts or per-cell thresholds.
- At 160 m one cell is about 1000 px, so the step cannot be tested there. I saw faint vertical banding at the left of `160m/ground-mean-unlit` around x≈100–460, low confidence. Cause unmeasured.

**M3. The navigation pass is thin and quality-of-service costs are large.**
- The pass rests on one run with a 2.98 s margin.
- The longest motion application gap is 9.758 s.
- Prints of **178–234 ms** occurred inside the window, at ticks 97864, 99453 and 107373 (`metrics.json:495-544`), even though output goes to inherited file descriptors and events are compact. V11's maximum print was 15.8 ms. The cause is unmeasured. Do not attribute the 1.7 s script spike to print alone.

### Moderate

**m1. F2 residuals at 40 km and 10 km:**
- **Pale halos at confluences** (10 km, tour `01` and `all.png`): (1562,451), (1935,246), (1014,1091), (620,1193), (1572,543), (563,415). They also appear in `ground-mean-unlit`, so they come from the ground or water composite, not the trees. V8 had them too.
- **Pale stair-step dashes** remain beside some 40 km tributaries, around (266–338, 707–1024), low-to-moderate confidence at this scale.
- **Uncovered background band** at the right edge of 40 km, x≈2015–2048, full height. This is the known limit of the source domain.
- **Axis-aligned river segments** at 10 km: x≈169 for y 532–768; y≈535 for x 41–215; x≈456 for y 799–870; y≈328 for x 1720–1894. These come from the source vector data; the stroke reproduces them faithfully. Not a render defect, but it hurts map readability.

**m2. Directional row pattern in crown placement.**
- Crowns line up in diagonal rows in all five V9 spatial pans, in `canopy-v9/top-640m` and `oblique-640m`, and in V8 and V12 `03_640m`.
- This is not the page seam, and the target masks show no page boundary.
- Hypothesis: anisotropy in the candidate lattice or its jitter. Unmeasured.

**m3. In-frustum shrubs render as small green spheres.**
- Visible in `160m/no-trees.png` at (182,379), (568,279), (505,648), (1305,809) and (1729,816), with 17 shrubs recorded as `alphaPositiveInFrustum`.
- The contract is respected: tree and trunk counts are 0 and the shrubs vanish in `no-low-cover`.
- But shrubs read as miniature trees, which is a semantic legibility problem.

**m4. City support blocks and view satisfaction.**
- `aerial-native-overall-top`: the settlement support has stair-stepped edges at about the 15.6 m grid, at (580–640, 440–560) and (740–790, 440–590).
- Canopy phase 0 is disclosed: "Complete tree page does not cover this view".
- Blueprint and oblique record `viewSatisfaction.covered:false` ("finer source density required"). This is honestly disclosed but means these are not satisfied views.

### Minor

- Neither navigation test file contains a literal 22 s case. `verifyNavigationTiming` **accepts** a 27.015 s actual movement and records it as a diagnostic.
  - Tests do reject: stretching `motionEndTickMs` or `continuousSeconds` (`surface.navigation-timing.test.ts:37-41`, and the driver at `generate_surface_source.mjs:220`); and a fine preview displayed after 20 s even within the actual movement (`:50-58`).
  - A long actual movement is therefore never rejected as such. Only a late display or a stretched nominal window fails. The prompt's premise that "a 22 s movement is rejected" is inaccurate.
- The retention tests (`surface_visual_retention.test.mjs`) use a simulated flow, not the real driver. The real exit code 1 relies on the rethrow at `generate_surface_source.mjs:543` reaching top-level.
- `characters` in the log timing counts characters, not UTF-8 bytes (`main.gd:1023`). The label is honest.

## 5. F1, F2, urban ground and layers: code plus pixels

**F1.**
- V8 `02_2560m` showed a square of about 370 px with a pale halo at (840–1208, 440–819). V12 `02_2560m` shows continuous canopy there.
- V8 `03_640m` showed ghost bands at x≈307–358 and x≈1690–1761. V12 has none.
- The V8 seam near (1004–1044, 604–691) at 10 km is not visible in V12.
- The V9 pans and target masks show no rectangular void.
- The final tour capture records phase 2, `pendingAtlas:false`, `transitionPending:false`, `complete-frustum-plus-halo` (`native-tour/metrics.json:107-121`). I did not audit the per-capture canopy blocks for the other six captures.
- This is not a controlled pixel A/B. The raw heights match, but the runtime differs.

**F2.**
- All seven captures record: symbol version 2, 1.25 px width, cull mask 1, `sourceVectorMissingAreaM2: 0`, 0 missing level triangles, `budgetLimited:false`, complete contours, and `physicalWaterSurfaceClaimed:false`.
- Requested and output areas are kept separate (40 km: 48,038,668.5 vs 48,038,664.7 m²).
- Padding is recorded separately (12.207 m at 40 km).
- Bed conflicts are kept: 2931/4087 at 40 km (max 58.16 m), 3882/3961 at 2560 m (max 36.28 m), 393/393 at 640 m.
- The empty near views (0 rings) do not stand in for regional evidence.
- The controls show: mode 0 broken and faint; 1.25 px continuous; `symbols-roof` keeps the red layer-2 square intact.
- The cache key includes MPP, palette, width and scale policy, and coverage is checked before reuse (`main.gd:1450-1458`).

**Urban support.**
- V8 oblique shows a white blurred support around (520–1000, 180–450). V9, V11 and V12 show beige there.
- Overall view: V8's white settlement and roads have become tan.
- The trees inside the clearing also changed between V8 and V9. `URBAN_GROUND_SUPPORT.md:44` attributes this to canopy and candidate-page changes, not to ground. These screenshots therefore do not isolate the ground shader.
- `SURFACE_COMPILER_VERSION = 'surface-1.5.3'` and `SURFACE_PHYSICAL_CONTEXT_VERSION = 'surface-1.5.2'` are separate constants (`model.ts:3,5`). There was no physical re-generation.

**Layers (160 m).**
- `all` state: tree 64/402, trunk 64/402, grass 288/1000, shrub 17/51, debris 61/243, boulder 31/101 (in-frustum / submitted).
- `no-trees`: tree and trunk become 0 visible, still 402 submitted; residual canopy and optical shadow are both false.
- `no-low-cover`: grass, shrub and debris become 0.
- Boulders stay at 31 throughout. Allocations are fixed.
- I confirmed this in pixels: in `no-trees` the crowns and shadow discs are gone and the boulders remain.
- At 10 km all counts are 0 with `requireInstances:false`, so that probe proves only optical and residual masking.

## 6. Performance claims A1, A2, B, C and failure retention

**Failure retention (`surface_visual_retention.mjs`).**
- Eligibility requires all of: final ready, verified final display, no timeout or signal, exit code 0 or (1 with status failed), and zero integrity errors.
- Integrity errors include native SCRIPT/SHADER ERRORs, non-409/499 HTTP errors, worker errors, request failures and broker errors (`generate_surface_source.mjs:249-254`).
- These checks throw *before* eligibility is computed, so the driver fails closed: timing (`:220-221`), source binding (`:224`), and canonical context or regeneration (`:244-248`).
- When retention is used, the driver sets `overallSuccessAllowed:false`, and `assertNoRetainedNavigationFailure` throws (`:533`), giving status failed and a rethrow.
- V12 did not take this branch; the flag was only in the arguments (`driver-process.json:38`).

**B (prepare cancellation).**
- Eligibility is fixed when the job is spawned (`surface_prepare_control.gd:15`): only jobs whose revision and world equal what is displayed can be cancelled. An accepted world that has not yet rendered is never cancellable.
- A completion-race skip runs before and after the awaited water bake (`main.gd:1432,1474`).
- `render_events` advance only in `_apply_prepared` (`:418`).
- V12 had one real cancellation: camera-only, revision 1, of the already-displayed `bf086e9c`, 41.067 ms after request. Zero failed, zero obsolete-lineage, zero older-than-displayed.

**A2.** The fact that `cpuScriptMs` covers every `_process` frame is stated in the metric's `scope` field; I did not trace it through the code.

**C.** Counters labelled "accepted" are kept separate from "display". Legacy aliases are explicit (`navigation-report.json:3-13`) and enforced by the verifier (`:43-55`).

**Supplementary evidence.** These are distinct from V12 and are **not** substitutes for its verdict:
- The A/B diagnostic on `6cf2b8d`.
- The scheduler replay (one task: 9280.6 ms wall vs 389 ms thread CPU; cause unknown).
- `fresh-worker-cdp` on `f5d0c62`.

None of them proves the internal cause of the V10 Node pause.

## 7. Remaining blockers and next bounded changes

1. **Git:** run `git diff --stat bc6579f..HEAD` restricted to the 584 runtime paths to confirm that the commits after `031e0f1` touch documentation only.
2. **Navigation margin:** repeat the unchanged 20 s gate at least 3 times on the same source to measure the variance of first display. Do not loosen the gate.
3. **Preview HTTP time:** attribute the ≈5.6 s of preview 59's HTTP time not covered by the worker's processor span, using the existing PAGE and broker rows.
4. **Print stalls:** run a bounded A/B on the 178–234 ms print stalls (file descriptor vs a buffered writer), without claiming a cause in advance.
5. **F3:** either declare the 78 m canonical ground as an explicit style limit, or plan a new physical-context version that derives finer ground fields. A shader blur must not hide the steps.
6. **Trees:** move to real crown assets or impostors; use one shadow model for crowns and low cover; filter the proxy-shadow texels at near scales.
7. **Water:** trace the confluence halos with the diagnostic channels, and handle the edge band without inventing relief outside the bounds.
8. **Crown placement:** run a CPU orientation or spectral test on candidate positions to check the row pattern.
9. **Still out of scope:**
   - fresh populated-city qualification (the fresh source has 0 buildings and the tour submits 0 road projectors);
   - fine-detail retained city;
   - interiors and access;
   - full route coverage (the 256-projector cap is still reached);
   - style parity;
   - photorealism;
   - 60 FPS and production memory budgets;
   - the final engine choice.
