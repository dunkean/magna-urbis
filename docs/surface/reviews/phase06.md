# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Phase 6/6 review: integrated SurfaceWorld vertical slice

Model: claude-opus-5-5, high effort, read-only. I made no edits and ran no tests, builds, generations or GPU probes. Every number below comes from the repository's own reports and logs, and I name which one each time. I did not open any images or binaries.

**Code moved during the review.** The git status was clean at the start. Afterwards, `web/scripts/surface_live_plugin.ts`, `web/src/ui/surfaceLive.ts`, `web/src/surface/limits.ts` and a new `web/src/ui/surfaceLiveUpload.ts` changed in the working tree. I re-read the new versions. They are uncommitted and have not been run.

## Verdict: CHANGES REQUIRED

There is 1 blocker and 3 majors.

Many of the earlier fixes are real code changes, not just prose: linear mean residuals, the R·n normal rotation, cubic parent kernel with seam feathering, region removal, typed urban and candidate columns, the durable worker, the registration binding and the export worker. The `geometryDetail` + `surface-conditioning-1` binding is checked end to end in both TS and GDScript. The fixed-map water display does use Magna's retained polygons and original measured levels, with explicit fallback reasons.

The central claim is still unproven, though. The fresh 40 km native end-to-end run **failed**, and the code that produced that failure had confirmed transport defects.

## Blocker

**B6‑1: The native 40 km → 10 m live tour has not been achieved. Its first live packet failed in transport at the reviewed snapshot.**
- **What the reports say:**
  - `web/out/surface/native-e2e-40km/report.json:256` has `"status": "failed"`, and `:985` has `viewer.status: "failed"`.
  - There is no navigation phase.
  - The native log shows exactly one `terrain-replaced` event: the parent world, with `prepareMs` 7221 and `uploadAndObjectsMs` 189.5 (`native-tour/stdout.log:5`).
- **Defect (a): Godot rejected the live reply.** `native-tour/stderr.log:1-3` shows `HTTP Chunk too big!! >16mb`, followed by `Live terrain unavailable, retaining parent: HTTP 0`. The broker sent the whole packet (canonical context included, well over 16 MiB) as one implicit chunk without a `Content-Length`. Godot's HTTP client refuses chunks over 16 MiB.
- **Defect (b): the driver crashed.** `driver.stderr.log:5` shows `ERR_STRING_TOO_LONG` inside Playwright's pipe transport. The browser uploaded the multi-hundred-MB reply as a single POST, and devtools serialised its body.
- **Fixes now in the tree (unverified):**
  - `Content-Length` on the reply (`surface_live_plugin.ts:105`).
  - A chunked upload of 4 MiB slices (`surfaceLiveUpload.ts`, `surface_live_plugin.ts:72-98`, `limits.ts:6`).
  - Reading them, the approach is right. Nothing has rerun them.
- **Still open as a result:**
  - all seven live levels;
  - 10 m at ≤ 5 mm/px;
  - live geometry detail, water and city in the native scene;
  - continuous navigation;
  - the driver's per-level checks.

## Major

**M6‑1: The continuous-navigation pass criterion cannot detect live-detail starvation.**
- **What it actually checks:** `diagnostics/navigation_probe.gd:91,99-100` (and the driver at `generate_surface_source.mjs:181`) pass when *any* preparation applies during motion and *any* live packet is accepted.
- **Why that isn't enough:**
  - Every accepted live tile bumps `world_revision` (`main.gd:745`).
  - Any in-flight preparation for an older revision is then thrown away (`main.gd:235`).
  - Measured preparation takes seconds (7.2 s at 40 km).
  - So a run that accepts tiles but never *displays* live geometry while moving can still report `complete`.
- **Fix:**
  - Require at least one applied `terrain-replaced` during motion whose rendered source is a live tile (`sourceLODKnown`, an accepted live world id).
  - Record how many preparations were discarded.
  - Consider applying a same-lineage stale preparation and then re-preparing, instead of dropping it.

**M6‑2: Live replies are never checked against the world the viewer loaded.**
- **No session binding:** the broker sends a sessionless request to the most recent browser session (`surface_live_plugin.ts:60`).
- **No source check:** worker packets carry `source.originalSource` (`workerProcessor.ts:52`), but `_accept_packet` never compares it with the loaded `world.terrain.source` (`main.gd:696-756`). `_source_scene_lineage` only notices epoch changes after the request was issued.
- **The E2E run shows it:** the live session used a re-captured decor (`originalSource.version` 15:14:25.202Z, `report.json:645`), while the loaded export was version 15:14:14.361Z (`:805`). The viewer accepted it silently.
- **Fix:** on the first live accept, bind by content, not timestamp. For example, compare `registrationBinding.canonicalFieldFingerprint` (or a terrain fingerprint carried in the export) with the loaded world's heights, and reject on mismatch.

**M6‑3: UI crop exports use a different frame from live, which breaks the "fixed world" geology anchor.**
- **The two paths disagree:**
  - `pipelineCapture` crops into crop-local coordinates (`terrainbench.ts:1946-1949`).
  - The export worker passes no `terrainOriginX/Z` (`surfaceExport.worker.ts:10`).
  - Live always uses the full retained world (`terrainbench.ts:2032-2036`).
- **Effect on live:** a cropped export connected to live receives tiles from a different place.
- **Effect on geology:** `tilted-strata-v1` is evaluated in the crop or translated frame (`export.ts:77-78`, after the `dx/dz` shift). The same physical point therefore gets different strata in a crop export, a translated export, a full export and live.
- **Fix:**
  - Pass `meta.pipeline.crop` as `terrainOriginX/Z`.
  - Evaluate the scenario before any frame translation.
  - Or refuse live mode for crop exports.

## Minor
- **Bare fallback in water:** an invalid vector point returns `fallback` without a `fixedHydrologyFallbackReason` (`surface_hydrology.gd:151`).
- **Regional vector water may never be exercised:** water triangulation costs edges × bands with a 12 M budget (`surface_hydrology.gd:160-161`). Large retained river polygons may fall back to the raster at regional views. Check `metrics.water.authority` at each tour level.
- **Hydration recomputes only `versions.terrain`** (`compiler.ts:508`). Geology, hydrology and environment versions, and the rule "canonical bedrock == scenario" (enforced only at compile, `:776`), are not re-verified. Phase 2 M5 is therefore only partly fixed.
- **The fingerprint is not a true 128-bit hash.** It is four multiply-only FNV lanes (`hash.ts:5-6`), so the low bits depend only on the low input bits. That's fine for cache keys, but "128-bit" is an overstatement.
- **Candidate cap mismatch:** the viewer caps candidates at 100k (`surface_data.gd:120`) while TS allows 1M (`candidateColumns.ts:6`). A larger packet is rejected entirely.
- **Broker edge cases:**
  - A completed upload with a bad magic stays pending until timeout (`surface_live_plugin.ts:99`).
  - Each pending upload can allocate up to 512 MB, with up to 4 pending.
- **Duplicated call:** `withSurfaceGeologyQuery` runs twice in `export.ts:66,69`.
- **Default geology recipes aren't frozen.** `surface_geology=tilted-strata-v1` without a descriptor depends on code defaults (`geology.ts:18`). Packets do store the full descriptor. Explicit descriptor overrides *are* reproduced by both the CLI (`export_surface_world.ts:25`) and the UI query copy.
- **Evidence provenance:**
  - The material-mean JSONs pin shader commit `9d86d00`, not HEAD `aff1504`.
  - The normal-rotation and canopy GPU reports cited in the docs are not in `viewer-local/diagnostics/evidence` or `web/out`.
- **Doc drift:** `IMPLEMENTATION.md:56` still says the geometry-detail integration is "en cours".

## Unmeasured risks (not confirmed defects)
- **Per-packet geometry-detail validation is heavy.** GDScript re-derives every geometry-detail sample (up to 1,048,576, `surface_geometry_detail.gd:85-102`). It also decodes u16/u32 arrays one element at a time (`surface_data.gd:76-83`). This runs on the decode thread for every packet, and on the main thread at startup (`main.gd:116-123`).
- **Upload cost:** the measured 190 ms upload at 40 km, plus multi-second preparation, means continuous 60 Hz during source updates is not demonstrated (and not claimed).

## Aesthetic limitations and future work (not defects)
- Trees are spheres and cylinders. Lit crowns versus painted canopy differ in radiance.
- Water has no depth or flow.
- Buildings keep their source construction planes; support deltas are reported, not re-seated.
- In Compatibility mode, roads are draped against the prefiltered terrain rather than the clipmap LOD.
- Rock-exposure colour uses the raw unit `colorLinear`.
- Photorealism and full artistic parity are not claimed, correctly.

## Recheck of earlier blockers and majors

**Phase 1**

| ID | Status | Evidence |
|---|---|---|
| B1 mirrored georeference | Fixed | `neuralEarth.ts:5,82-86` |
| B2 export offset | Fixed | Single builder translates every geometry: `magnaUrban.ts:17-46`. New caveat → M6‑3 |
| M1 dry water level | Fixed | `magna.ts:122,135` |
| M2 LOD ordering | Fixed (documentation) | `IMPLEMENTATION.md:64` |
| M3 regional package validation | Fixed in phase 5 | Not re-read |
| M4 climate | Fixed | `export.ts:43`, `magna.ts:143` |
| M5 shared terrain queue | Fixed | `magna.ts:43-62` |

**Phase 2**

| ID | Status | Evidence |
|---|---|---|
| B1 floodplain provenance | Fixed | `compiler.ts:223-224,325-334` |
| B2 cache identities | Fixed | `compiler.ts:272-273,415-417` |
| B3 JSON size | Fixed | `binary.ts`; guard at `compiler.ts:458-469` |
| M1 HAND sentinel | Fixed | NaN: `compiler.ts:59,225,554` |
| M2 TPI edge bias | Mitigated | Planar bias removed + `edgeConfidence`: `:129,143` |
| M3 extent/resolution dependence | Fixed | Physical thresholds: `:213,252,297,310` |
| M4 season in material | Fixed | `:379-394` |
| M5 deserialisation trust | **Partial** | See the Minor on hydration |
| M6 cancellation | Fixed | Worker termination |
| M7 population budget | Fixed | `population.ts:41-50` |
| M8 hydrology input gaps | Fixed | `compiler.ts:85-89,216-223,283` |
| M9 memory check before allocation | Fixed | `:255-256` |

**Phase 3**

| ID | Status | Evidence |
|---|---|---|
| H1 vertices on samples | Fixed | `main.gd:213-217`, `surface_data.gd:354-403` |
| H2 texel alignment | Fixed | `surface_body.gdshaderinc:1-11` |
| H3 depth precision | Mostly fixed | `main.gd:321-324`; decals on Forward+ |
| H4 winding/normals | Fixed | |
| H5 memory/main thread | **Partial** | Upload 190 ms, prepare 7.2 s; GDScript decode/validation |
| H6 stale/failed async | Fixed | `main.gd:235,524-531` |
| M1 terrain edge | Fixed | |
| M2 biased vegetation | Fixed | `surface_population.gd:38-42` |
| M3 water offset/cracks | Fixed | |
| M4 city/roads | Fixed | |
| M5 phase on rebase | Fixed | `material_library.gd:191-216` |
| M6 albedo | Fixed | See phase 4 B1 |
| M7 launcher | Fixed in phase 4 | Not re-read |
| M8 live/stream transport | Fixed | `main.gd:691,697` |

**Phase 4**

| ID | Status | Evidence |
|---|---|---|
| B1 albedo mean | Fixed | Linear RGBAH, mean residual. GPU JSONs: Forward+ 0.153 %, Compatibility 0.425 %, rebase 1 byte. Shader commit not tied to HEAD |
| B2 canopy | Fixed by construction | `canopy.gdshaderinc:42-59`; per-family budgets. GPU report absent from worktree |
| B3 height kernel | Fixed | Cubic kernel + feather: `surface_geometry.gd:59-129`. Buildings reported, not re-seated |
| M1 normal frame | Fixed | `normal_frame.gdshaderinc:3-5`. Evidence file absent |
| M2 derivatives in branches | Fixed | `surface_body.gdshaderinc:21-23` |
| M3 catalogue binding | Fixed | `material_library.gd:141-147,186-187` |
| M4 stale regions | Fixed | `main.gd:283-284` |
| M5 main-thread cost / LOD starvation | **Partial** | → M6‑1 |
| M6 road budget | Fixed | `surface_geometry.gd:418-490` |
| M7 roads/water vs displayed terrain | **Partial** | Compatibility roads; clipmap LOD unmeasured |
| M8 water coverage | Fixed | Coverage mask |
| M9 floating boulders | Fixed | `surface_scene_prepare.gd:97` |
| M10 macro noise | Fixed | `surface_body.gdshaderinc:71-72` |

**Phase 5**

| ID | Status | Evidence |
|---|---|---|
| X1 JSON city/candidates | Fixed | Typed columns + handshakes |
| M1 divergent urban schemas | Fixed | Shared `magnaUrbanPacket` |
| M2 worker thrown away | Fixed | 30 s grace (`workerClient.ts:55-65`); E2E `canonicalBuildCount` = 1 |
| M3 forged lineage boolean | Fixed in the worker | Viewer side still open → M6‑2 |
| M4 roads/climate invalidation | Fixed | `surfaceBenchRevision.ts`, `terrainbench.ts:2021-2056` |
| M5 blocking UI export | Fixed | Export worker, cancellable |

## What the evidence does show
- **Fresh real source:** 40 km, models `coarse4/original/original`, `neuralToken` retained.
- **40 m refinement:** fetched by the driver itself over HTTP (not by the native viewer). `decoderUsed=true`, `sourceLOD` −6, native spacing 0.46875 m. Parent correlation 0.998 against −0.993 when transposed.
- **Fixed geology descriptor:** the full `tilted-strata-v1` descriptor is present in the live packet.
- **First native 40 km request:** honestly reports `decoderUsed=false`, lod 0.

## What is not shown
- Any native live level beyond the parent.
- The 10 m / 5 mm-per-pixel capture.
- Continuous navigation.
- Any image quality judgement: I opened no image.
