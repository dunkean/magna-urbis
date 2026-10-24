# Independent Opus 5.5 review: integrated SurfaceWorld V15

I worked read-only (Read, Glob and Grep only). I ran no shell, tests, rendering or GPU work, wrote no files and recomputed no hashes; every hash below is a recorded value I cross-read. Coordinates are original pixels: tour and probe PNGs are 2048×1280 (×1.024 from the previews); city and composition PNGs are 1280×800; clast PNGs are 1600×1000.

## Overall verdict

| Scope | Verdict |
|---|---|
| Technical integration (fresh V15 campaign) | **PASS** |
| Strict 20 s navigation: distinct worlds and fine delivery | **PASS**. Margin improved over V13. |
| Broader navigation QoS | **PARTIAL**. The longest motion application gap got worse: **14.735 s**. |
| Ground / low cover / trees separation and provenance | **PASS** (technical). Low cover is visually weak. |
| Forest continuity, LOD, colour, culling, optical transfer | **PARTIAL**. Colour jump fixed at the 40 m frame; shadows and oblique not qualified. |
| Hydrology | **PARTIAL**. Source authority is intact; legibility defects remain. |
| Authentic city | Static technical **PASS**; visual **PARTIAL**. Retained legacy city, `covered:false` ×3. |
| Styled RPG mapper outputs | **PARTIAL**, up from FAIL. Composition exists; legend and labels are not production-grade. |
| Artistic / production acceptance | **FAIL — not accepted** |

Historical verdicts stay as they were. V14 remains **FAILED** (supervisor exit 1, 5 of 7 PNGs, no layer probes). The V13 review stays technical PASS, QoS PARTIAL, artistic FAIL.

---

## 0. What I actually opened

**V15 tour (7):** `ROOT/web/out/surface/native-e2e-40km-v15/native-tour/` — 00_40000m, 01_10000m, 02_2560m, 03_640m, 04_160m, 05_40m and 06_10m (all `_top.png`).

**V15 layer probes (10):** `…/native-layer-isolation/10000m/` and `…/160m/`, each with `all`, `no-low-cover`, `no-trees`, `ground` and `ground-mean-unlit`. All 17 exist; nothing was missing or substituted.

**CITY419 V14 (5):** `ROOT/web/out/surface/native-current-419-v14-final/`
- the three native captures: `blueprint-native-close-top`, `aerial-native-close-oblique`, `aerial-native-overall-top`
- the two compositions: `blueprint-map.png`, `oblique-map.png`

**Tree albedo controls (4):** `ROOT/docs/surface/evidence/vegetation-tree-v13/albedo-{unlit,lit}-{before,after}.png`.

**Source+GR A/B, at the exact paths in `source-albedo-ab.json` (3):** under `D:/workspace/self/_worktrees/magna-urbis-tree-albedo-v14-2026-10-24/web/out/tree-albedo-source-v13/`
- `40m-old/all.png`
- `40m-fixed/all.png`
- `160m-fixed/all.png`. The JSON records `full160AllPngEqual: true` and identical SHAs `3fb1889c…` for old and fixed, so I did not open `160m-old` separately.

**Clast controls, at the exact paths in `clasts-gpu.json` (4):** under `D:/workspace/self/_worktrees/magna-urbis-clasts-pbr-2026-10-24/web/out/clast-gpu-ab/`
- `top-baseline/all.png`, `top-clasts/all.png`
- `oblique-baseline/all.png`, `oblique-clasts/all.png`

**Oblique control (1):** `ROOT/docs/surface/evidence/oblique-v14-composed.png`.

**V13 history (3):** `ROOT/web/out/surface/native-e2e-40km-v13/native-tour/{04_160m,05_40m,06_10m}_top.png`.

**Docs and data read:**
- `NATIVE_V15.md`; `native-e2e-v15.json` (first ~41 k characters plus targeted greps)
- `supervisor-report.json` (whole); `strict-source-restoration.json` (whole)
- Raw `report.json`: lines 700–860, 10836–10865, 11796–11803, plus greps
- `native-navigation/navigation-report.json` (gaps); `native-navigation/metrics.json` (GPU and VRAM); `native-tour/metrics.json` (`covered`)
- `v15-postrun-source-equivalence.json`, `IMPLEMENTATION.md` (lines 1–60), `V14_CORRECTIONS.md`, `NATIVE_V14.md`, `NATIVE_CITY419_V14.md`
- `HEIGHT_SOURCE_CHAIN_BUDGET.md`, `ALBEDO_ENCODING.md`, `ALBEDO_SOURCE_AB.md`, `CLASTS.md`, `OBLIQUE_V14.md`, `PBR_PREPARED_CACHE.md`
- `blueprint-map.json` (whole); the bark/trunk section of `albedo-encoding-correction.json`
- The V13 review
- Code: `viewer-local/native-height/src/main.rs:215–519` and `viewer-local/adapters/surface_height_batch.gd:36–125`

**Not read** (so I make no claims from them):
- `RENDER_SURFACE_DESIGN`, `RENDER_REVIEW`, `MATERIALS_REVIEW`
- `MAP_COMPOSITION.md`, `OBLIQUE_VISIBILITY_PLAN.md`, `HIGH_SUPPORT_CULLING.md` and its PNGs
- `native-e2e-v14.json`, `native-city419-v14.json`, the `height-source-chain-budget.json` body, `pbr-prepared-cache-cpu.json`
- `surface-v2.json`, `surface_render_profile.mjs`, `mapComposition.ts`, the material-library cache code
- stdout/stderr logs; `oblique-map.json`
- The 945 per-file hashes in the before/after snapshots. I confirmed that `selectedRepository` and `finalRepository` both show head `c53cd7e`, status `""`, and I relied on the compact `runtimeUnchanged: true` for the rest.

---

## 1. Technical integration — PASS

**Status and exits:**
- Raw `report.json:776` reads `status: "complete"`. The supervisor's `exitCode` is 0 (439,214 ms); the driver's is 0 (425,603 ms).
- All four native phases (navigation, tour, 10 km probe, 160 m probe) exit with code 0.
- `retentionRequested: true` but `retentionUsed: false`. This is **not** a "failed navigation with retained visuals" case.

**Source versions — kept separate:**
- **V15** ran runtime `c53cd7e…` (945 files) with the ROOT-built helper `c77ca0d0…`.
- The post-run record compares `c53cd7e` with `8c681c06`: 945/945 files, none added, missing or changed. The later changes are documentation plus one test that sits outside the snapshot paths. This is source equivalence, not an identical git snapshot, as the record says.
- **CITY419 V14** ran the older runtime `763081706…` with helper `1d2c1652…`. The old V14 helper is preserved as `height-batch-v14.exe`. I did not conflate the two.

**Profile actually used, not just parsed:**
- The supervisor command line passes `--viewer-render-profile surface-v2`.
- The compact evidence records 82 runtime files, all hashes matching, and the final profile identical (effective SHA `fcdb21fd…`, no overrides).
- In the actual phase metrics:
  - `heightSampler.mode` is `explicit-native-batch`, `used: true`, executable `c77ca0d0…`, in every phase.
  - The logger is `threaded` (62/62, 45/45, 12/12, 12/12 messages, zero rejected).
  - `pbrCache` shows 15 hits, 0 misses, 0 writes in all four processes.
  - Water is `source-map`, uniform tint, 1.25 px.
  - Tree digest is `74edf966…` and `treeEncodingCorrectionVerified: true`.
- So option usage is shown in runtime metrics.

**Height chain:**
- At 40 m the seven-layer chain really passes: 1,618,660 samples, `height-source-chain-2`, sample time 8.3754 ms, total 504.59 ms, `nativeKnownBufferUpperBytes` 55,596,232. This is exactly the shape that killed V14.
- The 40 km phase reports `holes: 3,932,160` of 2048². That is expected: a 2048² image at 77.97 m spacing spans about 160 km, so only 512² samples fall inside the source. Hole samples carry control bit 4 (`main.rs:475`).

**Restoration:** strict PASS for both packets, 6 attachments each, with no slot cleared or replaced. `fresh-source.surfacebin` is `70c05ed7…` (91,626,097 B); `live-refinement.surfacebin` is `f9bdb756…` (76,589,841 B).

**Source caveats:**
- The raw neural SHA `3c7c2f32…` is the same as V12 and V13. "Fresh" here means a deterministic re-generation of the same world, with a new token and registration.
- That makes V13→V15 pixel comparisons nearly source-controlled. Runtime, assets and timing still differ.
- The source has 0 buildings. `tilted-strata-v1` is authored context, not observed geology.
- The raw report also notes that the Vite endpoint does not attest its own Git revision (`report.json:11799`). Browser code identity is inferred from the selected repository.

**Startup overlap:**
- The supervisor started at about 08:54:10.5 UTC (derived from the clock join: motion starts at 08:55:37.754, 87.24 s into the run).
- The OWN CPU test, 08:54:26.249–08:54:34.693, overlapped source generation and about 0.25 s of the surface-compiler worker, which started at 08:54:34.4395 per `report.json:824`. It ended about 63 s before motion.
- Source bytes are deterministic (same raw SHA as V13), so content is unaffected. Startup and compile timings may be slightly perturbed. None of this is a performance-speedup claim.

---

## 2. Strict 20 s navigation — PASS; broader QoS — PARTIAL

**Window:**
- Ticks run from 57,883 to the nominal end at 77,883; the actual end is 77,896 (20.013 s).
- Largest input gap is 0.507 s (14.609→15.116 s); the terminal gap is 0.050 s.
- There were 10 accepted responses and 4 geometry applications, but only **2 distinct displayed fresh worlds**.

**The two displayed worlds:**

| Seconds after motion start | World | Delivered grid | Native support | Decoder | What it is |
|---|---|---|---|---|---|
| 15.059 | `0ad40452…` | 128² at 66.277 m | 30 m | no | Coarse parent view |
| 18.995 | `ee30a8bb…` | 129² at 0.534 m | 0.46875 m | yes | Real learned fine refinement |

- The final settled world `917e2bf0…` (140² at 0.4657 m, requested 512, preview false) applies at tick 84,301, in the drain. It is correctly not counted.
- Accepted packets and repeated display of one world do not count as distinct worlds, and they are not counted here.

**Compared with V13** (same source; timing not controlled):

| Measure | V13 | V15 |
|---|---|---|
| Fine world inside the window | 0.9375 m, 0.398 s margin | 0.46875 m, 1.005 s margin |
| Warm-up | 50.8 s | 35.337 s |
| Drain | 12.85 s | 6.461 s |
| First new display | +12.808 s | +15.059 s |
| Longest motion application gap | 12.416 s | 14.735 s (`navigation-report.json:2711`) |

- Fine delivery inside the window and the margin are better. Responsiveness is worse: nothing new appears for the first 15 s of motion.

**Frame wall times** (`navigationFrameWallMs`) cover all frames after ready, including warm-up and drain:
- p50/p95/p99/max: 16.666 / 16.916 / 17.224 / 708.222 ms.
- The other phases have maxima of 987.6, 906.5 and 1014.1 ms.
- `cpuScriptMs` max is 213.68 ms during navigation and 703.98 ms in the 160 m probe.
- GPU render p50/p95/p99: 1.904 / 2.913 / 3.287 ms.
- `videoMemoryBytes` at the end is 1,368,236,112. That is an end-of-run counter, not a peak or a budget.
- The p50 is vsync-bound. **None of this proves 60 FPS.**

**Finer delivery and drain:**
- One camera-only cancellation (`urban-arrays`); zero failed, obsolete or older-than-displayed discards.
- One canonical build and one environment version.
- Tour views all report `covered: true` (`native-tour/metrics.json:5135–5438`).

---

## 3. Ground / low cover / trees separation and provenance — technical PASS

**What the probe pixels show:**
- **10 km:** `no-low-cover` loses the olive tint and leaves pinkish ground. `no-trees` loses the residual canopy tint (0 instances at this scale). `ground` is pink-beige.
- **160 m:**
  - `no-low-cover` removes the shrub spheres and debris.
  - `no-trees` removes the crowns **and** their optical shadows; engine shadows on shrubs and boulders stay.
  - `ground` keeps only the clasts. Boulders belong to the ground layer by declared design.
- The recorded counts (402/64 trees, 288 grass, 17 shrubs, 61 debris, 31 rocks) and the invariant physical fingerprints across the four toggles agree with what the pixels show.

**Source versus renderer:**
- **Source-coarse categorical contacts**, correctly not erased, in `10000m/ground-mean-unlit`:
  - dark polygons at about (973–1157, 707–819)
  - pale alluvial bead chain at (543–573, 102–563)
  - dotted chain at (1925–1997, 881–922)
- **Renderer-introduced but minor:** faint straight piecewise-linear creases in `160m/ground-mean-unlit`, about (461,0)→(922,1280) and (1382,0)→(1741,1280). These are interpolation seams of the 78 m field, with no new information.
- Raw 1024²/39.06 m and canonical 512²/78.125 m data are not presented as millimetre terrain. The 4.88 mm/px at 10 m is screen scale only, as the docs say.

**Weakness:** grass at 160 m is not legible as instances. `all` versus `no-low-cover` reads mainly as a tint change. That is honest, but visually thin.

---

## 4. Forest continuity, LOD, colour, culling, optical transfer — PARTIAL

**Albedo fix — the main V13 blocker is resolved at the tested frame:**
- In V15 `05_40m`, the high crowns at (1229–1705, 184–543) and (942–1224, 1142–1280) are now the same bright green as the impostors at (732–932, 0–118) and (1475–1633, 92–205). In V13 `05_40m` the high crowns were dark, saturated green.
- The controlled `40m-old` versus `40m-fixed` pair shows only the high-foliage change.
- The `160m` all-layers PNG is byte-identical between old and fixed (impostors only).
- In the unlit and lit before/after controls the crown moves from near-black green to source-like green.

**Open question on the albedo controls:** in `albedo-unlit-before.png` the trunk and branches at about (375–410, 480–590) are pale grey. In `albedo-unlit-after.png` they are brown. The doc says only the leaf image changed and every other image view is unchanged. Either the trunk shares the corrected atlas, or the unlit override differs. I could not resolve this from the files I read. A trunk-only pixel diff is needed.

**Still open:**
- A 29° normal difference.
- Impostor roughness is hard-coded at 0.9 against a source mean of 0.4755.
- Five discrete impostor views. Lighting, parallax and LOD continuity are **not** qualified.

**Culling:**
- V15 at 10 m submits 1 high tree and 25 impostors with 0 alpha-positive centres. The support-based selection is active.
- I did not open the `HIGH_SUPPORT_CULLING` PNGs, so I do not verify the negative or positive boundary poses myself.

**Optical shadows — unchanged from V13, still the main forest defect:**
- Texel-block interiors and edges remain at 160 m: (865,174), (952,256), (1475,123).
- At 40 m they are large blocky "pixel-art" shadows: (1198–1464, 768–1137) and (1679–1884, 973–1280).
- In the clast TOP controls the optical-shadow boundary is a staircase at (1400–1600, 0–1000).
- At 640 m, shadow blobs read more strongly than the crowns.
- The constant 9.8 m reference offset, tree casting OFF and the grey-transfer versus navy-engine dual model all persist.
- A sharp dark shape at the bottom of `05_40m`, (1362–1454, 1244–1280), is present in both V13 and V15 and remains unexplained.

**2560 m:**
- Exactly 10,000 retained and submitted impostors (3,951 alpha-positive centres). That looks like a cap; I could not confirm whether it is a page budget.
- Visually the frame is uniform speckle over blurred ground.

**Oblique:**
- `oblique-v14-composed.png` (retained legacy 1.5.3, no GR) is a real improvement: trees read as trees with trunks.
- But crowns are vertically stretched in the upper band, many shadows are detached floating blobs, e.g. (380–560, 470–520) and (690–740, 790–810), and green primitive spheres remain, e.g. (972,640).
- CITY419 `aerial-native-close-oblique` still shows thin vertical impostor streaks across the upper third (0–1280, 0–300).
- The fresh V15 campaign attributes **no** oblique result, correctly. C/V/filter certificates remain TOP-scope only.

---

## 5. Hydrology — PARTIAL

**Source authority is unchanged in all 17 images:**
- Vector coverage complete, 0 missing area, 0 triangles without a level, `budgetLimited: false`.
- 51 boundary queries at 40 km, maximum 0.122 mm.
- Bed/level conflicts of up to 58.165 m are declared, not "fixed".
- The 1.25 px symbol is declared as non-physical.

**Visible issues** (most are traced to source or ground, but they remain legibility defects):
- **10 km pale confluence halos** at (1413,676), (1567,543), (1065,1116), (614,1193), (1940,246). They persist in `ground-mean-unlit`, so they are ground alluvium, not water.
- **Stair-stepped strokes** at (1567–1741, 1167–1265) and (166–215, 535–776). **Axis-aligned segments** at 40 km around x≈440, y 410–604.
- **The 40 km lake shows bed relief shading through its surface** at (1126–1372, 31–338). Under uniform source-map tint the lake reads as tinted, shaded relief rather than a flat water surface. This is consistent with the declared bed/level conflicts, but cartographically confusing.
- **City overall top:** dark fuzzy stream fringes at (330–360, 150–260) and (410–440, 330–400), plus combed vertical striations beside the main river at (610–690, 30–130).
- **Source features, not the renderer:** the radial "fan" of straight drainage lines on the 40 km left side, (256–461, 389–666), is a neural source feature.

---

## 6. Authentic city and styled RPG mapper outputs

**City: static technical PASS, visual PARTIAL.**
- Retained packet `54616775…` with 419 native buildings and 81 refused parcels.
- The terrain used is the 15.625 m parent with unknown LOD and zero fine-child contribution. Legacy 1.5.3 ground, no GR. All three views remain `covered: false`. This is **not** a fresh neural city.
- The oblique shows real volumes and roofs with building shadows ON. They read as toy-like boxes, with sandy ground and greenish halo patches.

**Mapper: PARTIAL (V13 was FAIL).**

What is new and real:
- Title, frame, shared font, grid north and a 25 m = 80 px scale bar. That checks out: 400 m across 1280 px is 0.3125 m/px.
- A 5 m RPG grid.
- The native raster is embedded unchanged (`c69ecb23…`).
- The real worldToClip matrix and float64 `renderOrigin` (6507.8125, 50.86, 8445.3125) are bound in `blueprint-map.json`.
- The perspective map correctly has no uniform scale, grid or north arrow.
- Zero source names exist, and none are invented.

What is not acceptable yet:
- **The legend does not key the native glyphs.**
  - `blueprint-map.json:174–215` defines semantic categories, source paths and counts only, with no glyph descriptor.
  - In the PNG, the "Bâtiments" swatch at about (36–50, 668–680) is a filled blue box, while the native buildings are white outlines.
  - "Voirie" is an empty box, while the road is a dark band with a white double edge.
  - "Arbres" is an empty or blue box, while the trees are dark discs.
  - The counts are canonical support nodes (228 trees and 228 low cover), not what the reader sees.
- **The oblique legend lists absent items:** "Eau" appears though no water is visible, and three ground recipes have empty swatches.
- **Panels cover map content with no collision handling:** the blueprint legend panel (24–294, 640–775) covers footprints near (175–210, 655–735), and the oblique legend covers buildings at about (10–75, 600–640).
- `oblique-v14-composed` shows raw untranslated IDs ("Sol : mineral-soil").
- No labels, hatching, brushes or perspective draping. Nine overlay palettes do not mean 15 restyled terrains.

---

## 7. Native height batch and PBR cache — safety and correctness (read-only)

**Height batch: sound, fail-closed design.**
- The Rust decode checks framing, a 512 MiB body, a 1 MiB manifest and `deny_unknown_fields`.
- It uses checked arithmetic on width × height, totals, offsets and strides.
- It enforces ≤7 layers and ≤7,340,032 samples, contiguous offsets, finite values, non-decreasing spacing, lineage and kernel whitelists, footprint inside the last sample, mutual domain/layer equality, and no unused payload.
- The known-buffer preflight (≤384 MiB) runs **before** controls are promoted. It counts input, f64 grids, 8 B per output pixel, taps and a 32 MiB allowance. That arithmetic is consistent with the actual `Vec` capacities.
- Non-finite output is refused; output is atomic (temp file, sync, rename) with a payload SHA.
- The GD adapter checks the budget before wire allocation, cancels between layers, and uses a per-job temp directory with a timeout clamped to 10 ms–120 s.
- On kill or cancel it cleans up only its own PID's files.
- It verifies magic, framing, input SHA, echoed job, the budget contract, a lower bound on known buffers, finite extremes and the payload SHA.

Minor observations:
- **Exit code.** The helper's exit code is never read; correctness rests on atomic output plus the bindings, which is adequate.
- **Executable hash.** The adapter hashes the file at prepare time, and the helper only echoes that hash back. This is a small time-of-check/time-of-use gap; profile pinning compensates.
- **Rename.** `output.exists()` followed by rename is a theoretical race, mitigated by unique directories.
- **Polling.** The poll loop uses `OS.delay_msec` and is documented as running on the preparation worker. I did not verify the caller's thread.
- **Edge filling.** Out-of-source samples are filled by nearest-domain clamping and flagged as holes. That is the documented boundary policy, not invented terrain.

**PBR cache:** I read only the doc, not the code or JSON. The design looks safe:
- Content-keyed by the actual input SHAs and the decoder build.
- Payload SHA plus a checksum binding.
- Atomic writes with a lock; a busy or failed lock stops writes, with no eviction or recursive delete.
- Bounded to 32 files and 512 MiB, and refused inside the source directory.

V15 runtime shows warm hits only (15/0/0), so the cold-rebuild and corruption paths were **not** exercised in this campaign.

---

## 8. V13 blockers and majors: status

| V13 finding | Status in V15 | Evidence |
|---|---|---|
| **B1** Near scales empty and monotone | **Unresolved** | V15 `06_10m` is visually the same as V13; `05_40m` and `04_160m` ground is uniform tan; `02_2560m` is speckle |
| **B2** High vs impostor colour jump | **Resolved at the measured frame** → now moderate (normals, roughness) | `05_40m` V13 vs V15; `40m-old` vs `40m-fixed` |
| **B3** Mapper outputs incomplete | **Partially resolved** → major | `blueprint-map.png`, `oblique-map.png` (§6) |
| **M1** Shadows | **Unresolved** | §4 coordinates; clast TOP staircase |
| **M2** Primitive low cover | **Boulders improved** (irregular clasts, though flat facets and a serrated shadow edge remain at (790–1210, 45–110) in `top-clasts`); **shrubs still spheres** at (184,379), (507,650), (364,814), (1306,809), (1731,814) | `04_160m` |
| **M3** Oblique streaks | Better in the bounded control; **still present** in the city oblique | §4 |
| **M4** QoS | Fine margin better (1.005 s); **gap worse (14.735 s)** | §2 |
| **M5** Qualified config ≠ defaults | **Governance resolved**: `surface-v2` named, pinned and used. Legacy defaults not re-run | §1 |
| **M6** City `covered:false`, legacy ground | **Unresolved** | `NATIVE_CITY419_V14.md` |

## 9. Remaining findings by severity

**Blockers** (for artistic and production acceptance only, not the technical gate):
1. **B1** Near and intermediate scales are visually empty and monotone (10 m, 40 m, 160 m ground; 2560 m speckle).
2. **Optical forest shadows:** blocky texel transfer, constant offset, two shadow models. This is the most visible defect from 640 m down to 40 m.

**Major:**
1. Legend swatches do not represent native glyphs; legends list invisible categories; panels occlude content.
2. QoS: a 15 s motion stretch with no new world; frame maxima of 0.7–1.0 s; script spikes of 214–704 ms.
3. Shrubs are primitive spheres; grass is not legible.
4. Oblique is not qualified in a fresh campaign; the city oblique still shows streaks.
5. The city is retained legacy, `covered:false` ×3, without GR.

**Moderate:**
1. The trunk colour change in the albedo controls needs explaining.
2. Normal (29°) and roughness (0.9 vs 0.4755) parity is still open.
3. The exactly-10,000 impostor count at 2560 m may be a cap.
4. The lake shows bed shading under uniform tint.
5. Halos, stair strokes, axis segments and bead chains (source-traced but illegible).
6. Interpolation creases in `160m/ground-mean-unlit`.
7. Clast facets and the serrated engine-shadow edge.
8. The persistent unexplained dark shape at the bottom of `05_40m`.
9. The Vite endpoint is not revision-attested.

**Minor:**
1. `IMPLEMENTATION.md:23` says V15 validates real chains "à toutes les échelles". It validated the exercised views.
2. Terrain3D deprecation warning.
3. Height-batch time-of-check/time-of-use nits.

## 10. Checks I could not make

- I did not diff the 945 per-file before/after hashes, or the 82 profile files, myself.
- I did not read the profile and composition code, or the C/V and oblique-plan documents.
- PBR cold-path, corruption and lock behaviour were not exercised in V15.
- I did not verify the high-support negative and positive control PNGs.
- I did not inspect logs for warnings beyond what the docs report.

## Final determinations

1. **Technical integration PASS.** One fresh (deterministic) source, 2 distinct displayed worlds including native 0.46875 m inside the 20 s window, 17 complete images, strict restoration, a pinned profile and helper, and the V14 budget failure is genuinely repaired at 40 m.
2. **Navigation: gate PASS; QoS PARTIAL.**
3. **Static appearance: PARTIAL.** The leaf colour fix and clasts are real, visible gains. Shadows, primitives and near emptiness remain.
4. **City: static technical PASS, visual PARTIAL. Mapper: PARTIAL.**
5. **Artistic / production acceptance: FAIL.**

None of this establishes Google-Earth quality, the full design backlog, all map styles, Neural Earth viewer integration, 60 FPS or a final engine adoption decision. Godot/Terrain3D remains a consumer candidate; Infinite Generation remains the height source.