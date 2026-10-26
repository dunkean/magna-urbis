# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Phase 6 follow-up review: SurfaceWorld integration (V5 at `f6a45af`)

I couldn't save this as a file because this session only had read and search tools. It's meant to sit next to `docs/surface/reviews/phase06.md` as its own follow-up file, for example `phase06-followup.md`. I did not change `phase06.md`, any report or any code. I ran nothing: no generation, no GPU process, no tests. I did open all seven V5 tour PNGs and describe them below.

## Verdict: CHANGES REQUIRED

All four original phase 6 findings are now fixed or mostly fixed. Three have real native evidence. The verdict is still CHANGES REQUIRED because of confirmed visual defects in the slice as implemented: the forest-patch discontinuity you already knew about, plus two I found in the 10 km capture. The city and roads were also never exercised in the fresh native run.

## What V5 actually shows

**Overall run**
- `native-e2e-40km-v5/report.json:751` reads `"status": "complete"`, with `durationMs` 314249.
- The phase order is navigation, then tour (`:6744`).
- The start and end HEAD are both `f6a45af`, with identical file hashes and a clean status (`:6773-6811`).
- `canonicalBuildCount` is 1 (`:792`).

**Motion window (M6-1)**
- The motion ran from tick 59240 to 79240 (20.005 s actual). The longest gap between inputs was 0.15 s.
- Two qualifying displays appear in `navigation-report.json:3895-4143`. Both are preview requests at resolution 128, both use the production epochs, and the fine-source weight at the focus point is 1.0 in both:

| Shown at | Request serial | World (≠ start world `72041dc7…`) | Accepted at | Source |
|---|---|---|---|---|
| 72046 | 99 | `37f8bf64…` | 66962 | LOD −1, 15 m native, 1950 m tile |
| 76218 | 208 | `f98c42bb…` | 71904 | LOD −6, 0.46875 m native, 110.6 m tile |

- I checked the join independently against `liveAcceptance` (`:2296-2363`): request serial, world id, request contents and both epochs all match.
- The final 512 request (serial 351) was accepted at 80839, after the motion ended. It was not counted as motion evidence, which is correct.

**Tour (seven captures from six source requests)**
- There were six live HTTP replies. For each, the downloaded size equals the expected size, with 1 MiB chunks, threaded reads and a 300 s timeout (`native-tour/metrics.json:139-223`).
- The 10 m capture reuses the cached 100 m source: camera serial 6, request serial 5, same world `7043df98…`, with a delivered spacing of 0.4673 m against a required 0.46875 m (`:3621-3663`). This meets every rule you set for honest cache reuse.
- Delivered spacing at each level is 77.97 / 23.54 / 6.10 / 1.60 / 0.4766 / 0.4673 / 0.4673 m. The camera's 4.88 mm/px at 10 m is a separate quantity and is never presented as source spacing.

**Driver checks**
- The driver re-verifies the probe's output independently (`web/scripts/surface_navigation_evidence.ts:67-84`): it requires a fine weight above 0.5, contribution weights that sum to 1, a matching production render event, and a fresh acceptance before the display.
- The 1e-12 relative spacing comparison is at `:5-6`.

## Blockers
None confirmed.

## Majors

**F1. The forest stops at a rectangle (known; confirmed again).**
- `02_2560m_top.png` and `03_640m_top.png` show a hard square forest patch: crown spheres, shadows and a darker ground inside; flat tan with no canopy outside. The page edge has half-faded discs and a straight-edged change in ground colour.
- I also see it in `01_10000m_top.png` as a small textured square at the centre, so it isn't only a 2560 m problem.
- **Cause:**
  - The candidate page is always a 480 m square centred on the tile (`web/src/surface/workerProcessor.ts:41-43`: `radius = min(240, extent/2)`).
  - Exports use ±160 m (`adapters/export.ts:49-51`).
- **Bounded fix:** outside the page, render a filtered canopy from the canonical `treeCover` (about 24% there), cross-fade over a band of several crown diameters, and calibrate the outside coverage against the inside coverage (26.7% measured) on the same footprint. Accept it with a coverage readback taken across the page boundary.

**F2. Rivers look broken at 10 km.**
- In `01_10000m_top.png`, channels show as runs of blocky blue squares, about 16–20 px (roughly one 78 m context cell), with gaps between them. Only a few short continuous lines appear.
- The cause is not proven. Two things point at it:
  - The source drops 9037 of 17892 retained wet cells to "Dry" (`report.json:6902`: 9032 of them have a bed above the water level).
  - The tour only records water metrics for the final 10 m frame, where there is no water at all (`metrics.json:3666-3697`, `quads` 0, area 0). The regional levels have no water metrics.
- For a map tool, broken rivers at regional scale are a failure of the fixed-hydrology display.
- **Fix:** log water authority, budget and fallback for every tour level, and draw the retained vector channels at regional scale whatever each cell's dry/wet state.

**F3. Staircase boundaries at the 78 m cell size (10 km and 40 km).**
- `01` is dominated by right-angle steps (about 16 px, which is 78 m) between the green and tan/grey zones. They are also visible at 4 px in `00`.
- The cause is not confirmed:
  - `surface_average` and `surface_state` are linearly filtered (`shaders/surface_uniforms.gdshaderinc:7,9`).
  - The ids are bilinearly weighted (`surface_body.gdshaderinc:1-18`).
  - So the likely culprit is the canopy term on `state.r` (`:75`) or the per-cell detail weights. This needs a single-variable diagnostic.

## Minors
- **East edge at 40 km.** In `00_40000m_top.png`, the eastern ~33 px (about 640 m) and a ~5 px strip on the west show background, but the source bounds reach 39,922 m. Low confidence; worth one probe.
- **Delivered grid missing during motion.** `motionLiveDisplays` doesn't record the delivered grid size or spacing. The log's `displaySpacingM` 0.4726 at 72046 is Terrain3D's mesh vertex spacing, not the 15 m source, and is easy to misread.
- **Misleading focus label.** `_source_actual_at_focus` labels the fine source as "actual" at any weight above 1e-6 (`viewer-local/scene/main.gd:1076`). The checks require above 0.5, so it doesn't affect the gate, but the field name overstates.
- **Timestamp overwritten.** The `viewSatisfaction.tickMs` attached to the 10 m capture shows the apply tick (183037), while the event itself was at 182084 (`metrics.json:3355` vs `:3655`).
- **Hitch.** The worst frame wall time during navigation is 1037 ms (`metrics.json:237`).

## Recheck of the original phase 6 findings

| ID | Status | Evidence |
|---|---|---|
| B6-1 transport / live tour | **Fixed for transport and the seven live levels.** City, roads and regional water in the fresh native scene are still unproven. | V1–V4 stay `failed` (`native-e2e-40km/report.json:256`, `-v2:380`, `-v3:490`, `-v4:386`). V4's separate re-evaluation is `overallE2EAccepted:false`, `navigationExecuted:false`. V5 has `buildings: 0` (`report.json:7058`) and `roadProjectors: 0`. |
| M6-1 starvation | **Fixed** | Gate `surface_navigation_evidence.ts:67-84` and `navigation_evidence.gd:44-64`; the two displays above. No preparations were discarded. |
| M6-2 live binding | **Fixed** (code + unit tests; no native mismatch run) | The loaded heights are re-fingerprinted (`surface_live_binding.gd:49-82`). Live packets are checked for fingerprint, n, width and source identity (`:84-96`). Crops and translations are refused (`:33,54`). V5 binding is `rf1-019b8a…`, n 512, 40000 m, with no rejections. |
| M6-3 crop frame / geology | **Fixed** (unit level) | `frame.ts:24-39` (`liveCompatible`), `export.ts:72-76`, `geology.ts:29-35`. Tests `surface.frames.test.ts:19-65`. The live packet carries the full descriptor (`report.json:830-924`). |
| V3 256 import alignment | **Fixed, CPU only** | 512 restored (`surface_data.gd:295`). Alignment guard at `main.gd:1118-1122`. `terrain-import-alignment.json` uses the real Terrain3D `get_height`, but headless, on CPU storage, at 1.0 m spacing only. |

## Earlier open majors

| ID | Status |
|---|---|
| P2 M5 hydration trust | **Improved.** Geology, materials and state are now re-hashed on load (`compiler.ts:519-521`). Hydrology and environment are only compared as version strings (`:657-658`). |
| P3 H5 / P4 M5 cost | **Still partial.** Preparation takes 0.9–24.2 s (`navigation stdout.log:10` shows 24245 ms). Uploads take 9.5–307 ms. There was a 9.7 s gap between displays during motion. The first new world appeared 12.8 s into motion, and it was a 15 m source while I estimate the camera was only tens of metres wide. |
| P4 M7 roads vs displayed terrain | **Not re-measured.** No roads in V5. |
| P5 M3 viewer side | **Fixed** (see M6-2). |

From the phase 6 minors, I only rechecked two:
- **Duplicated call (fixed):** `export.ts:65` now calls `withSurfaceGeologyQuery` once.
- **Candidate cap (fixed on the live path):** the worker caps at 100k (`workerProcessor.ts:43`), matching the viewer.

I did not reverify the others.

## Not measured (risks, not confirmed defects)
- **Physical GPU placement.** Nothing reads heights back from the GPU. The import probe uses only integer, 1.0 m spacing, while production uses fractional spacings (0.4673, 77.97). Floor rounding inside Terrain3D at those spacings is untested.
- **Negative native runs.** There is no native campaign with a mismatched binding, a crop, or translated geology.
- **City evidence.** The 500-building native report says it is a legacy retained parent with unknown LOD: `fineChildContributionAtCameraFocus` is 0.0 and every camera lies outside the child tile (`native500-qualified/qualification-report.json:2,35-45`). That is honest, but it is not fresh fine-detail city proof.
- **Not inspected.** I did not locate the 214 ms / 62 MB replay or the 4 MiB upload acknowledgement code in this pass.

## What I saw in the images vs what the metadata claims

**In the pixels:**
- `04`–`06` (160 m to 10 m): primitive sphere trees and cubes, with aliased shadow edges, banding on the spheres and visible facets on silhouettes at 10 m.
- Relief at 160 m and below is almost flat.

**From the metadata only:** source LOD, spacing and lineage for each capture.

Nothing here supports claims of photorealism, full artistic parity, continuous 60 FPS, or transport/sediment science. The docs don't make those claims (`docs/surface/IMPLEMENTATION.md:23,152-153,340`).
