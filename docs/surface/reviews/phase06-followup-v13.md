# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Independent review of the integrated V13 campaign

I worked read-only: no shell, git, rendering or GPU, and I wrote no files. I recomputed no SHA-256. Every hash below is a recorded value that I cross-read between files. Image coordinates are in original pixels: tour and probe PNGs are 2048×1280 (I converted from the 2000×1250 previews ×1.024); city PNGs are 1280×800.

**Overall: technical gate PASS; navigation/QoS PARTIAL; static appearance PARTIAL / artistic FAIL; city/styles technical PASS, visual and style PARTIAL / FAIL; artistic and production acceptance FAIL.**

## 0. Images actually opened

All requested images exist and I opened all of them. Nothing was missing or substituted.

- **Fresh V13 tour (7):** `ROOT/web/out/surface/native-e2e-40km-v13/native-tour/` — `00_40000m_top`, `01_10000m_top`, `02_2560m_top`, `03_640m_top`, `04_160m_top`, `05_40m_top`, `06_10m_top`.
- **V13 layer probes (10):** `…/native-layer-isolation/10000m/` and `/160m/`, each with `all`, `no-low-cover`, `no-trees`, `ground`, `ground-mean-unlit`.
- **V13 city (3):** `ROOT/web/out/surface/native-current-419-v13-final/` — `blueprint-native-close-top`, `aerial-native-close-oblique`, `aerial-native-overall-top`.
- **Tree controls, retained V12 replay (4):** `ROOT/docs/surface/evidence/vegetation-tree-v13/` — `top10-high`, `top160-impostor`, `shadow160-negative`, `blueprint-flag`.
- **Ground legacy/response A/B (2):** `D:/workspace/self/_worktrees/magna-urbis-surface-v13-model/web/out/surface/ground-v13/gpu/{legacy-10000,response-10000}/ground-mean-unlit.png`.
- **V12 history (7):** `…/native-e2e-40km-v12/native-tour/{01_10000m_top,04_160m_top,06_10m_top}`, `…/native-layer-isolation/10000m/ground-mean-unlit`, and the 3 PNGs in `native-current-419-v12-final/`.

**Docs and code read:**
- `NATIVE_V13.md`, `native-e2e-v13.json` (all of it), `V13_CORRECTIONS.md`, the V12 review.
- `GROUND_RESPONSE.md` and the PNG/scope section of `ground-response-v13.json`.
- Tree `README`, `EXPERIMENTAL_RENDERER`, `GPU.md`.
- `HYDROLOGY_V13_DIAGNOSTIC.md`, `NATIVE_LOGGING.md`, `NATIVE_CITY419_V13.md`, grass `README`.
- `v13-postrun-source-equivalence.json`.
- `web/src/surface/groundResponse.ts`, `ground_response.gdshaderinc`, `surface_body.gdshaderinc:1-80`, `canopy.gdshaderinc`, `main.gd:456-479, 1295-1334`.
- `surface_tree_evidence.mjs`, `surface_native_log_evidence.mjs`, the gate wiring in `generate_surface_source.mjs`.
- Selected lines of the raw report, navigation `metrics.json` and `navigation-report.json`.

**Not read, or only partly:** the `RENDER_SURFACE_DESIGN`, `IMPLEMENTATION`, `RENDER_REVIEW` and `MATERIALS_REVIEW` docs in full; `binary.ts` and `packet.ts`; `surface_ground_response.gd`; the full MC and certificate JSONs; stdout logs. I did not verify whether HEAD `c36c5a4` touches runtime files. The equivalence record covers `dd886c8` only.

## 1. Verdicts

| Scope | Verdict |
|---|---|
| **Technical gate** (fresh source → browser/worker → native, 7 views + 2×5 probes, archives) | **PASS** |
| **Strict 20 s navigation window** | **PASS** (first new world at +12.808 s; margin 7.19 s) |
| Fine delivery inside the window | **PASS, very thin**: the 0.9375 m decoder world arrives at +19.602 s, a 0.398 s margin. The 0.46875 m world arrives only in the drain. |
| **Navigation QoS** | **PARTIAL**: longest motion application gap 12.416 s (V12: 9.758 s). Script max 219 ms. All-process frame max 699.89 ms. |
| Layer contract: ground / low cover / trees | **PASS**, confirmed in pixels at 160 m. The 10 km probe has no instances. |
| Continuous ground response | **Technical PASS**; artistic **PARTIAL** |
| Forest page/frustum/LOD/C/V | **Technical PASS within TOP scope**; visual **FAIL** |
| Hydrology | **PARTIAL**: halos traced and declared; residual beads, steps and fringes remain |
| City exteriors | **Static technical PASS**; visual **PARTIAL**; styled mapper **FAIL** (not delivered) |
| Static appearance overall | **PARTIAL** |
| **Artistic / production acceptance** | **FAIL — not accepted** |

**Historical verdicts are preserved:**
- V1–V4, V6, V7 and V9–V11 remain FAILED.
- V12 remains technical PASS with a thin margin and artistic FAIL.
- The V13 logging A/B remains strictly FAILED (`SurfaceGroundResponse.expected_wire_dtype` SCRIPT ERROR). The later fix does not requalify it.

## 2. Answers to the seven questions

### Q1 — Integration, navigation window, fine delivery, hashes, static stages

**What the recorded evidence shows:**
- Report top-level `status: "complete"` (`report.json:776`). No `retainedNavigationFailure`, `visualsAfterNavigationFailure` or `overallSuccessAllowed` key exists (0 matches). The retention branch was requested but not used. This is not a "global FAILED with retained visuals" case.
- **Two distinct displayed worlds, not two acceptances:**
  - `9a1ace8c…`, serial 57, applied tick 91494, `decoderUsed:false`, native 30 m, delivered 128² at 66.277 m.
  - `00ba16bb…`, serial 212, tick 98288, `decoderUsed:true`, native 0.9375 m, delivered 1.3707 m.
  - Motion runs from 78686 to 98686, so these are at +12.808 s and +19.602 s.
  - There were 10 acceptances and 4 geometry applications.
  - The final world `c6e36356…` (140² at 0.46567 m, native 0.46875 m) applies at 111495, in the drain. It is correctly not counted.
- **Static stages are separate and complete:** 7 tour captures, `error:0` each, 6 broker → worker → Python tiles (5 decoder-backed), one canonical build, one environment version. Each probe has its own phase.
- **Archives:** two packets restored strictly, 6 attachments each, without clearing, repairing or replacing any slot. Hashes cross-read: fresh `6fc8f9c2…` (91,626,097 B), live `239b2cc2…` (76,589,841 B), raw report `b6614643…` (3,000,695 B), runtime 624/624 unchanged, and post-run `dd886c8` adds 2 files and changes 0. The 6 recorded PIDs have no survivors.
- The 160 m tour image and `160m/all.png` share SHA `477b22aea…`. The 10 km tour image and `10000m/all.png` share `a7f877ee…`.

**My own cross-check (recorded hashes, not computed):**
- The fresh raw SHA `3c7c2f32…` equals the raw height SHA cited in the V12 review. The "fresh" source is a deterministic re-generation of the same world (fresh token and registration).
- The V13 `160m/ground-mean-unlit.png` SHA `149862911…` is byte-identical to `response-160/ground-mean-unlit.png` in `ground-response-v13.json:598`. That control was rendered from the retained, augmented V12 packet.
- This is good evidence of reproducibility. It also means V12 → V13 differences are differences in the same terrain under a different runtime and GPU. They are **not** controlled A/Bs: the 10 km means differ in bytes, and water decals are now excluded.

**What this does not establish:**
- Accepted ≠ displayed.
- Screen 4.88 mm/px at 10 m ≠ source spacing.
- The RTX 5090 numbers cannot be compared with the RTX 4090 runs.

**Important scope caveat:** the qualified configuration is **not the default renderer**. It used:
- `--tree-assets` (experimental opt-in; "production default remains legacy"),
- `waterVectorTint: uniform` (the default is `source-classes`),
- `native-log-mode threaded` (the default is synchronous).

So V13 qualifies this opt-in configuration. The legacy sphere/source-class/synchronous defaults were not re-run in V13.

### Q2 — Ground / low cover / trees separation; continuous ground response

**Separation: PASS, confirmed in pixels.**
- `10000m/no-low-cover` removes the olive tint and leaves pinkish-beige ground.
- `160m/no-low-cover` removes the shrub spheres and debris.
- `160m/no-trees` removes the impostors and their transfer shadows.
- `160m/ground` keeps only boulders. The recorded counts (64/288/17/61/31, trunk 0) match the V12 contract.

**Code check:**
- `groundResponse.ts:121-152` and the shader `ground_response.gdshaderinc:20-76` interpolate stoniness, slope, organic and the six potentials **before** `writeAmounts` and the recipe.
- `rockRecipe`, occupation, bedrock and sourceRock stay nearest.
- Exact knots return the stored IDs and sRGB8 mean (`.ts:130`, `.gdshaderinc:25-31`).
- Crop maps to cultivated in both implementations. No colour is blurred across a recipe boundary.
- The packet keeps `compilerVersion surface-1.6.0`. The physical context is unchanged, and `canonicalFieldsVersion` and the GR id are separate identities.

**Pixel check (legacy vs response, same retained source):**
- Legacy shows 78 m stair blocks: lower-left massif (0–470, 800–1280), (973–1157, 717–860), and stepped dark chains around (220–360, 60–110).
- Response turns these into smooth parameter contours. This answers V12 M2/F3 for the non-categorical part.

**What remains, by design and visible:**
- Categorical contacts at 78 m, e.g. the 40 km top-right pale stepped band (≈1587–1843, 133–410).
- Dotted contact chains in `10000m/ground-mean-unlit`: (1925–1997, 891–922) and (1597–1802, 973–1137).
- Pale alluvial "bead strings" along narrow channels: (532–573, 102–553), and a stepped pale segment (1475–1546, 476–492). A 78 m grid cannot represent a linear channel without beading.
- Faint piecewise-bilinear creases in `160m/ground-mean-unlit`, low confidence.

**PBR and normals:**
- Aerial PBR uses one top-two pair per pixel when GR is active (`surface_body.gdshaderinc:21-24`). The mean is continuous.
- Where the second and third recipes swap, the detail texture identity switches abruptly. This is an expected-risk moderate issue. No near image at a contact exists to check it in pixels.
- Normals stay in the terrain TBN (`sample_surface_material`). The canopy normal is converted to tangent space (`:151`).
- The GPU float oracle (2,573 points, max 0.00212 near knots, within the half-step bound) is the numeric proof. PNGs remain filmic 8-bit.
- The GPU control snapshot `c8db2a6` predates the F32-slope fix `b18d100`. That fix entered production separately, through the campaign.

**No fake fine observation:** the docs, the JSON `interpretation` field and the 10 m pixels all agree. At 10 m the ground is near-uniform beige grain. Nothing fine was invented, and that leaves the near views visually empty (see B1).

### Q3 — Forest continuity, LOD, culling, roots, C/V, shadows

**Continuity, phase and culling:**
- 2560/640/160/40/10 m are at phase 2, `complete-frustum-plus-halo`, `transitionPending:false`, filter ratios 0.63/0.63/0.31/0.08/0.02 (max 8).
- 40 km and 10 km are honestly at phase 0.
- I saw no page square, seam or ghost band in 02, 03 or 04.
- The plan conserves IDs (`droppedCount 0`; `retained = high + impostor`). At 40 m: 2 high = 268,590 triangles = 2×134,295.

**Camera:** `main.gd:467` lifts the top camera to `target.y + 32` whenever tree assets are active in aerial mode. The guard uses a 32 m envelope (`:1303, :1312`). I did not verify that no candidate size plus relief exceeds that envelope; it is unverified.

**Gate wiring:** `surface_tree_evidence.mjs` requires geometry only at ≤160 m, and counts centres and ALPHA, not fragments.
- At 10 m: 26 submitted, 0 alpha-positive centres. The frame (06) and the centre of 05 are open ground, so this capture shows no missing-crown hole. It also cannot exclude one.
- The support-based fix is not credited to V13.

**Appearance, from pixels:**
- **LOD appearance jump (05_40m):** the high trees at (1229–1700, 184–543) and (942–1224, 1142–1280) are dark saturated green. The impostors at (737–927, 0–118) and (1475–1633, 92–205) are pale yellow-green. `GPU.md` already suspects this; the fresh tour confirms it in one frame.
- **Shadows (04, 05, `top160-impostor`):** shadow interiors and edges still show texel blocks, e.g. (860,174), (952,256), (1464,123) at 160 m and (1680–1875, 975–1280) at 40 m.
  - The softness is the **reconstruction filter**: `canopy.gdshaderinc:123` uses 2×atlasSpacing, i.e. mip 1 plus bilinear.
  - It is **not** physical penumbra. The 0.53° penumbra is about 0.09 m and is capped at `min(diameter, 1.0)`.
  - Every crown uses the same horizontal offset: `surface_canopy.gd:159` uses a single 9.8 m reference height, giving about (4.7, −8.5) m. Small and large trees cast equally displaced shadows. In 640 m and 160 m the shadows often read more strongly than the crowns.
- **Two shadow models remain:** grey canopy transfer versus navy engine shadows on shrubs, boulders and grass, e.g. a grass tuft at (486–507, 312–333) in 06.
- **Roots:** the high tree in `top10-high` sits on its root pivot, and the trunk and branches read correctly. I saw no floating crowns.
- **Unexplained artefacts:** pale-green flat patches through gaps in that crown (e.g. ≈1536, 338; ≈942, 758), which may be impostors or low-cover cards beneath. A box-like green/olive object at (≈512, 840) casts a block shadow.

**C/V:** zero `V>C` across 42 GPU TOP cases; the analytic whole-rectangle certificate exists; no `min(C,V)` correction. I treat this as **TOP-only technical evidence**. The MC 0.5945 pp bias+interval is a mean calibration. Neither proves native pixel equivalence, oblique optics or artistic adequacy.

### Q4 — Hydrology

**Source authority is unchanged:** `magna-urbis-fixed-hydrology`, 0 missing level triangles, 0 missing area, `budgetLimited:false`, and 51 boundary queries resolved at 40 km (max 0.122 mm). The uniform tint is declared on every capture. The 1.25 px symbol is declared as non-physical.

**Edge:** the 40 km image shows thin pale columns at x≈0–3 and ≈2043. This matches the "two sky columns" claim and replaces V12's ~31 columns. No relief is invented.

**Residuals in 01_10000m:**
- Pale confluence halos at (1940,246), (1567,543), (1418,676), (1024,1096), (614,1193), (717,1224). They persist in `ground-mean-unlit`, where water is now excluded, so they are ground: alluvial support at 78 m. Correctly not erased.
- Stair-stepped strokes, e.g. (1530–1700, 1140–1235).
- Axis-aligned segments (41–215, 535) and (169, 614–773). These are source geometry.

**City overall top:** dark fuzzy fringes along streams at (330–360, 150–260), (410–440, 330–400), (930–950, 630–700). These are softer than V12's green fringes but still read as halos.

Halos and steps are honestly traced to source and ground, but they remain a cartographic legibility defect.

### Q5 — City and styles

**Authentic exteriors:**
- The oblique shows real roof volumes and materials (orange roofs, building shadows). The blueprint shows source footprints.
- 254/335/419 submitted, 0 proxies, 15 material groups.
- Source `54616775…` unchanged; legacy ground 1.5.3 (`baked-color-legacy`), no GR. This is not the fresh city.
- **All three views record `viewSatisfaction.covered:false`** (V12 had two of three): "finer source density required" ×2 and "final 512 source request required".

**Oblique trees:** in `aerial-native-close-oblique`, the distant impostors read as thin vertical streaks across the upper third (≈0–1280, 0–300). Canopy reads far sparser than V12's spheres, with detached shadow smudges in the foreground (≈20–400, 700–800). Phase 2 with 1,367 alpha-positive centres is a count, not visual adequacy. This is consistent with the declared "5-view planar depth, oblique not qualified" limit.

**Blueprint:** visually indistinguishable from V12 (recorded: 4 pixels differ). Tree discs plus outlines plus a road band, with **no labels, legend, title, scale, north arrow or composition**. The styled mapper output is a raster layer, not a finished map.

**Engine commitment:** packets stay renderer-agnostic, and the hydrology and ground groups are versioned outside Godot. Terrain3D remains a candidate consumer. I see no game-only lock-in, and no Neural Earth integration evidence either.

### Q6 — Performance, memory and QoS

**Navigation:**
- Warm-up 50.811 s, drain 12.85 s.
- Frame wall (all-process) p50/p95/p99/max 16.665/16.882/17.154/699.89 ms. The p50 is vsync-bound; this is not a motion-only FPS figure.
- GPU render p50/p95/p99 1.92/2.93/3.30 ms.
- `cpuScriptMs` max 219.379 ms (4,835 samples).
- **Longest motion application gap 12.416 s.**
- The threaded writer's off-thread `printWallMs` reaches 69.48 ms, with main-thread `enqueueMs` around 0.03 ms. Neither attributes stalls.

**Memory:**
- `videoMemoryBytes` 1,345,850,800 at end of navigation. This is an end-of-run counter: not a peak, and no RSS or heap budget.
- GR adds 6.8 MB per 512² packet and 12.6 MB of native images.
- Tree GLB 36.8 MB; high cap 1.88 M triangles.

**Open backlog (not delivered):**
- Interactive latency and 60 FPS.
- Oblique VisibilityPlan, support-based high LOD, a full botanical library, native tree shadow casting.
- Fresh populated city, finer offline terrain, route coverage (256-projector cap).
- Final style typography and composition, the Neural Earth binding, engine choice.

## 3. Findings by severity

### Blockers (for artistic and production acceptance only, not the technical gate)

- **B1 — Near scales are visually empty and monotone.**
  - 05_40m and 06_10m are almost uniform beige: 3 grass centres at 10 m, a handful of crowns at 40 m.
  - 02_2560m reads as uniform speckle noise.
  - It is honest (no invented fine data), but it is not an acceptable map or scene.
- **B2 — High vs impostor appearance discontinuity** in a single frame: 05_40m, coordinates in Q3.
- **B3 — Styled mapper outputs are incomplete.** No typography, legend or composition. Only the blueprint raster exists, and it is unchanged from V12.

### Major

- **M1 — Shadows.** Texel-step interiors remain at 160 m and 40 m. The softness comes from a reconstruction filter, not penumbra. All crowns share a constant 9.8 m-reference offset. Two shadow models (grey transfer vs navy engine) coexist.
- **M2 — Primitive low cover.** Shrubs are still green spheres at the same positions as V12 m3: (184,379), (507,650), (364,814), (1300,809), (1731,814). Boulders are white pentagonal prisms, e.g. (1203,425), (1111,814).
- **M3 — Oblique impostors** read as streaks with sparse canopy (city oblique).
- **M4 — QoS:** 12.416 s application gap; the fine world lands 0.398 s before the window closes.
- **M5 — Qualified configuration ≠ defaults** (tree assets, uniform tint, threaded logger).
- **M6 — City:** all three views `covered:false`; legacy ground without GR; tree phase 0 at 8,400 m.

### Moderate

- **m1** — Categorical 78 m contacts, dotted chains and alluvial bead strings (Q2 coordinates). Declared, but visible.
- **m2** — Confluence halos, stair strokes, axis segments and river fringes (Q4).
- **m3** — PBR top-two identity switching at secondary/tertiary swaps. Pixel-unverified.
- **m4** — The centre-based high-LOD limit at 10 m, and the 32 m envelope assumption, are unverified.
- **m5** — `top10-high` contains a box-like object and flat green patches under the crown.
- **m6** — Faint grid and banding on 160 m ground, and vertical banding at 10 m. Low confidence.
- **m7** — The equivalence record stops at `dd886c8`; `c36c5a4` is unverified by me.

### Minor

- Terrain3D deprecation warnings remain.
- The GR GPU harness has an `OpArrayLength` warning and 3 leaked ObjectDB instances (diagnostic only).

## 4. Final determinations

1. **Technical gate: PASS.** One fresh-but-deterministic source, strict navigation with 2 distinct displayed worlds, 17 gated images, strict archive restoration, 624/624 unchanged files.
2. **Navigation/QoS: PASS on the gate, PARTIAL on quality of service.** Thin fine-detail margin, 12.4 s gap, no 60 FPS claim.
3. **Static appearance: PARTIAL.** GR removes the rectangular F3 steps and the seams are gone. Shadows, primitives, LOD colour and near emptiness remain.
4. **City/styles: static technical PASS; visual PARTIAL; styled output FAIL** (not delivered).
5. **Artistic/production acceptance: FAIL.** Tests, a new tree asset, or a continuous ground law do not grant product completion.
