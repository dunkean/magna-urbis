# City Bench performance — measured chain, bottlenecks, GPU plan (Opus, 2026-10-22)

Scope: city-01-river-plain-l (100k inh., 16 km map) vs -s (5k), native profile, own server
(`magna-urbis-local` release built from the working tree at ffa2637 + uncommitted edits, port 8790,
`CARGO_TARGET_DIR=D:/opus-target-perf`). Headless Chrome 1500×1000, DPR 1. "GPU" = `--use-angle=d3d11`,
verified on the **RTX 4090** (WebGL renderer string + nvidia-smi; nothing on GPU 1). "CPU" = `--disable-gpu`
(software Canvas 2D). The machine was shared with other agents (load ~35 %): native timings varied ×2–3
between identical runs — ranges are given. No existing file was edited.

New files (all reproducible from `web/`):
- `scripts/city_perf_native.mjs` — native chain without UI: server ms, wall, bytes, JSON.parse, structuredClone (≈ worker→main postMessage), scene index in Node V8; `--scale N` tiles the plan.
- `scripts/city_perf_browser.mjs` — real City Bench: worker message arrival/handling, long tasks, CPU profile per phase, per-step pan/zoom cost at far/mid/near/close in 4 views (`--gpu`, `--readback`).
- `scripts/city_perf_trace.mjs` — Chrome trace of camera steps, self time per event on renderer main thread **and GPU process**.
- `scripts/city_perf_render.mjs` — renderer-only benchmark, Canvas 2D `drawCity` vs WebGL2 prototype, 1× and 10× (synthetic 1M).
- `src/render/cityGlEarcut.ts`, `cityGlMesh.ts`, `cityGlLayer.ts` — WebGL2 prototype (earcut port, mesh build, renderer); `tests/cityGlMesh.test.ts` (4 tests pass).
- Raw results: `web/out/city-perf/**` (JSON + logs + screenshots).

## 1. Native chain (Node client → own server, no UI)

| stage | 5k: server ms / reply | 100k: server ms | 100k wall | 100k request | 100k reply | parse | structuredClone |
|---|---:|---:|---:|---:|---:|---:|---:|
| quarters | 906 / 0.7 MB | **7 830 – 21 770** | 8.0–21.9 s | 0.09 MB | 6.5 MB | 54–97 ms | 118–530 ms |
| parcels (+programme) | 235 / 2.9 MB | **4 416 – 6 674** | 5.0–7.9 s | 0.1 KB (layoutsId) | **36.2 MB** | 390–552 ms | 517–917 ms |
| buildingSites | 137 / 5.4 MB | **2 082 – 5 770** | 4.3–8.4 s | **42.6 MB** (layouts+partitions re-sent) | **48.3 MB** | 202–1 190 ms | 549–2 845 ms |
| houses/plans (compact) | wall 1 091 | — | **8.2 s** | 48.2 MB | **75.2 MB** | 360 ms | 1 067 ms |

100k plan: 2 027 blocks (81k vertices), 2 046 streets (25k vertices), **12 392 parcels** (141k vertices),
10 583 allocations, 8 305 building sites, 6 683 compact plans accepted / 1 566 refused. (The UI run of the same
request gave 1 845 blocks: the UI sends its normalized parcel/layout config; counts are the same order.)

Quarters stage laps (`URBAN_PROFILE=1`, 100k, loaded machine): composition 3.7–9.7 s, split 4–5.4 s,
blocks 3.4–4.2 s, after-overrides (access, programme prepare) ~3.7 s. All single-threaded: there is **no rayon
in `urban/**`**; the parcel loop is per block with `root.fork(&block_id)` (independent RNG per block → parallel
and deterministic is possible).

Where the bytes go (100k):
- Partition 36.2 MB: `contacts` 11.4 MB, `shape` 6.7, `programme.allocations` 5.0, `programme.adjacency` 3.1,
  `envelope` 2.2, `front` 1.1, ids/parentIds 1.8. The renderer needs only `shape/use/block/id` (~7 MB).
  Coordinates are printed with 17 significant digits (`7399.2209954988475`): ~45 bytes per point vs 8 as f32×2.
- Building sites 48.3 MB: `accesses` 8.1, `terrain` 7.7, `buildable`/`cadastral`/`roof_domain` **4.37 MB each —
  identical in 8 305 / 8 305 requests (checked)**, `config` 4.2, `preview` 4.1, `party_boundaries` 3.0.
- buildingSites re-uploads the full layouts + partitions (42.6 MB) although the engine already retains the layouts
  (`layoutsId` is used for parcels only).

## 2. Browser main thread during generation (real UI, 100k, silhouettes)

Workers do fetch + JSON.parse; the main thread pays the structured-clone **deserialization** plus handling:

| reply | main-thread task (arrival → handled) | notes |
|---|---:|---|
| layouts (6.5 MB) | 69–122 ms | then buildCityScene + first paint |
| partitions (36 MB) | 126–271 ms | the UI requests parcels automatically after quarters (terrainUrban.ts:596) |
| silhouette scene | 85–178 ms | `urbanScene.ts:81` ~140–190 ms self time |

Long tasks per phase: max 140–310 ms. Main JS heap 137–171 MB (+ workers, not counted). Time to first city
frame after load ≈ native quarters time (8–15 s); the main thread is not the limit during generation **at 100k**.
Client index building is small: buildCityScene 12–22 ms, silhouetteScene 12 ms, buildCityBuildings 10–16 ms.

## 3. Camera: frame cost (real UI, 100k, silhouettes)

Each step issued from the previous rAF; `frame` = presented cadence (16.7 ms floor), `drawCity` = JS of the paint.

| zoom (view) | items drawn | GPU (4090) frame median / max | CPU (software) frame median / main-thread busy per step | drawCity JS |
|---|---|---:|---:|---:|
| far 14 m/px | footprint + 144 streets | 16.7 / 20 | 16.7 / 18–25 ms | ~1 ms |
| mid 4.5 (tissue/buildings) | 1 256 blocks, 338 streets | 25–30 / 47 | 34–37 / 49–52 ms | 4–5 ms |
| mid 4.5 (roles) | + 8 511 parcels | 34 / 38 | 45 / 62 ms | 8–9 ms |
| **near 1.5 (parcels)** | 520 blocks, 3 491 parcels, 543 streets | **93 / 134** | 84 / 95 ms | 9–10 ms |
| **near 1.5 (buildings, roles)** | + 2 844 buildings | **72–73 / 118–120** | 77–80 / 89–91 ms | 8–11 ms |
| close 0.4 | 96 blocks, 426 parcels, 304 buildings | 19–31 / 39 | 19–26 / 35–65 ms | 1–2 ms |

**Trace (GPU, parcels view, per camera step):** renderer main thread 4.5 / 9.1 / 11.6 ms (far/mid/near);
**GPU process `CrGpuMain` 4.9 / 39.6 / 80.6 ms, of which `RasterDecoderImpl::DoRasterCHROMIUM::Deserializing`
2.6 / 31.5 / 72.1 ms** — the GPU process replays every Path2D vertex of the frame through Skia. In software
mode the same replay is the `getImageData` flush on the main thread: 70–76 ms median at near (max 118 ms).
=> The slowness the user sees is **Canvas 2D path rasterization**, not our JS (drawCity is ≤ 11 ms) and not the
spatial index. It is proportional to the vertices in view, so it is worst at near zoom and when parcels are on.

## 4. Renderer-only: Canvas 2D drawCity vs WebGL2 prototype (4090, 1× = 100k, 10× tiled = synthetic 1M)

`city_perf_render.mjs`: same scene objects, 16 pans per configuration centred on a dense core; WebGL measured
first and the GPU queue drained between renderers. "10 redraws/vsync" = 10 full WebGL frames per rAF.

| config | 1×: Canvas2D frame / JS | 1×: WebGL frame / JS | 10×: Canvas2D frame / JS | 10×: WebGL frame / JS (10 redraws/vsync) |
|---|---:|---:|---:|---:|
| whole city (1×: mid LOD, 10×: far) | 28–45 / 5 ms | 16.7 / 0.1 | 24–37 / 8–37 ms | 16.7 / 0.1 (16.7) |
| whole city, parcels forced (near LOD) | 117–140 / 16–21 ms | 16.7 / 0.1 | **983–1 114 / 199–203 ms** | **16.7 / 0.1 (16.7)** |
| mid 4.5 m/px | 23–50 / 5 ms | 16.7 / 0.1 | 38–56 / 10–12 ms | 16.7 / 0.1 |
| near 1.5 m/px | 137–139 / 9 ms | 16.7 / 0.1 | 138–156 / 14–16 ms | 16.7 / 0.1 |
| close 0.4 m/px | 43–44 / 2–3 ms | 16.7 / 0.1 | 46–50 / 5–7 ms | 16.7 / 0.1 |

WebGL draw + `readPixels` round trip (forced completion): 0.4–4 ms at 1×, 1.1–16 ms at 10×. Ten complete
redraws per vsync keep 16.7 ms even at 10×, so a full 1M frame costs < 1.7 ms of GPU on a 4090 (expect ~10×
that on an integrated GPU — still interactive). Mesh: 1× = 308k vertices, 252k triangles, 305k outline edges,
23k street segments, **9.4 MB GPU**; 10× = 3.1M vertices, 2.5M triangles, 3.1M edges, 233k segments,
**93.5 MB**. Build in JS (earcut): 64–82 ms (1×), 630–663 ms (10×); upload 3–6 ms / 48–61 ms; recolour for a
view change (per-feature RGBA texture) ≤ 1 ms. Scene index at 10×: buildCityScene 176–216 ms,
buildCityBuildings 141–149 ms. Test page heap at 10×: ~500 MB (scene objects, not the GPU mesh).
Visual witness: `web/out/city-perf/render/*-x1-{webgl,canvas2d}-{buildings,parcels}-gpu.png` (same geometry;
the prototype has no labels/walls/glyphs yet).

## 5. Toward 1M inhabitants

**Measured natively** (same map, population 1 000 000, radius ×√10, `city_perf_native.mjs` over node:http without
timeouts — `fetch` gives up at 300 s):

| stage | 100k | 1M | ratio |
|---|---:|---:|---:|
| quarters server | 7.8–21.8 s | **261.6 s** | ×12–33 |
| — composition / split / blocks laps | 3.7–9.7 / 4–5.4 / 3.4–4.2 s | 41.1 / 20.5 / **157.8 s** | blocks ×40 (super-linear) |
| quarters reply | 6.5 MB | 48.8 MB (parse 1.1 s, clone 2.5 s) | ×7.5 |
| parcels server | 4.4–6.7 s | **31.6 s** | ×5–7 |
| parcels reply | 36.2 MB | **313 MB** (parse 5.7 s, structuredClone 9.7 s, stringify 8.8 s) | ×8.7 |
| buildingSites request | 42.6 MB | **refused**: connection reset — `MAX_BODY = 128 MiB` in local/main.rs | — |

So today a 1M city **cannot complete** in the UI: ~5 min of single-threaded quarters, then a 313 MB parcels reply
(≈5 s of main-thread deserialization), then the buildingSites upload exceeds the server's 128 MiB body cap.

Extrapolating the rest of the wire (sizes scale with parcels, measured ×8.7): buildingSites request ≈ 370 MB and
reply ≈ 420 MB, compact plans ≈ 650 MB. V8's maximum string length is ~512 MB (2^29−24 chars): **plans and
probably buildingSites cannot even be `JSON.parse`d / `JSON.stringify`d at 1M** — a hard wall, not a slowdown.
Structured-clone to the main thread would be 5–10 s per stage (×10 of the 0.5–1.1 s measured). Canvas 2D near
views stay ~140–155 ms (viewport-bounded) but any whole-city view with parcels is ~1 s per frame.

## 6. Bottlenecks, ranked

1. **Native generation is the dominant wait** (100k: 8–22 s quarters, 4–7 s parcels, 2–6 s sites, 8 s plans; 1M:
   262 s quarters — the `blocks` lap grows ×40 for ×10 population — and 32 s parcels). Single-threaded on 24 threads.
2. **Canvas 2D path raster** for every camera move: 40–80 ms per frame in the GPU process (or 70–95 ms on the
   main thread without GPU) at mid/near for 100k; ~1 s at 1M overview with parcels. drawCity JS itself ≤ 11 ms.
3. **JSON as transport**: 36 + 43 + 48 (+75) MB per run at 100k, 17-digit coordinates, redundant fields,
   full layouts re-uploaded; at 1M: 313 MB parcels, buildingSites upload over the 128 MiB server cap, plans near
   the V8 string limit.
4. **Structured clone worker→main**: 70–270 ms main-thread tasks per reply at 100k; seconds at 1M.
5. Minor: JS scene indexing (≤ 22 ms at 100k, ~350 ms at 1M), SVG map/overlay repaint per camera step
   (~4–7 ms renderer main thread), duplicate parcel run only in the bench script (UI auto-requests parcels).

## 7. GPU plan (WebGL2)

What goes to the GPU — everything drawn per camera move:
- **Fills** (urban footprint, blocks, parcels, building silhouettes / compact footprints): earcut triangles on one
  shared vertex buffer (f32 x,y relative to a city origin — mm precision at 16 km), one `uint` feature id per vertex.
  Colour = `texelFetch(featureColours, id)`: switching view (tissue/uses/parcels/roles), palette, selection tint or
  refusal diagnostics rewrites a 4-byte-per-feature texture (0.5 MB at 1M), never the geometry.
- **Outlines** (block, parcel, building edges): `gl.LINES` index buffer on the same vertices (1 px hairlines are
  what the plan shows at near/close). For thick or dashed strokes use the street pipeline below.
- **Streets, walls, ridges, fronts/axes**: one instance per centreline segment (ax, ay, bx, by, width, rank; 24 B),
  extruded in the vertex shader; minimum pixel width per rank = `max(width, minPx·mpp)` computed on GPU, so the
  zoom changes a uniform only. Casing + fill = two instanced draws. Instances sorted minor→major so "rank ≤ k"
  (LOD) is a suffix range — no CPU filtering.
- **LOD** = which ranges are drawn (far: footprint + rank ≤ 1; mid: blocks (+parcels for roles/uses); near:
  parcels, buildings, outlines; close: everything). With < 2 ms per full 1M frame, culling is unnecessary for the
  plan; for 10M+ split the buffers per city tile (e.g. 512 m) and draw visible tiles only.
- **Picking**: keep `SpatialBins` + exact polygon test (CPU, a few µs per click); an R32UI ID buffer is an easy add
  (render feature id on demand, read 1 px) if hover picking at 60 fps is wanted.

What stays on Canvas 2D / CPU: labels, landmark glyphs, district names (hundreds of items; a small overlay canvas
redrawn per frame, or an SDF text atlas later); the selected item highlight (or a GL tint); SVG/Canvas exports;
Codex's detailed roofs at close zoom (`urbanBuildingLod` raster tiles) — or port its ridge lines to the segment
pipeline and its roof facets to the fill pipeline once compact plans arrive as binary.

Integration (owners: round-2 stream for `terrainUrban.ts` / `cityCanvas.ts`): replace the per-frame `drawCity`
geometry part by `CityGlRenderer.draw` on a WebGL canvas placed under the SVG overlay (pointer-events none),
keep `drawCity`'s screen-space marks on a 2D canvas above it; build the mesh once per (layouts, partitions,
scene) — exactly where `buildCityScene`/`buildCityBuildings` are built today — and call `setColors` on view or
palette change. The prototype API: `buildCityGlMesh(scene, buildings)`, `new CityGlRenderer(canvas)`,
`upload(mesh)`, `setColors(cityGlColors(...))`, `draw({ viewport, mpp, lod, view })`.

## 8. Non-GPU fixes (expected gain, owner)

- **Binary geometry from Rust** (urban/** + local/main.rs): return parcels/blocks/streets/sites as typed arrays
  (f32 coords relative to origin, u32 ring offsets, ids) + a small JSON of attributes; better, emit the triangulated
  mesh directly (earcutr / own earcut in Rust, parallel). 36 MB → ~3–5 MB for parcels at 100k; parse ≈ 0; the
  worker transfers `ArrayBuffer`s (zero-copy) to the main thread → removes the 126–271 ms tasks and the 1M wall.
- **Quarters `blocks` stage** (urban/quarters.rs, between `harmonize+fringe` and `blocks` laps): 3–4 s at 100k,
  158 s at 1M — find the quadratic part (likely a global scan per block/quarter: use the spatial index) before
  parallelizing; it alone decides whether 1M is feasible.
- **Do not re-send layouts+partitions for buildingSites** (local/main.rs + rust/bridge/urban.ts): retain partitions
  in the session like layouts (`partitionsId`) → −42.6 MB upload, −1 to −3 s wall at 100k.
- **Trim replies** (urban/**): ship `contacts`, `adjacency`, `envelope`, `provenance`, the triplicated
  `buildable/cadastral/roof_domain`, `terrain` only on demand (inspector) → parcels −70 %, sites −40 %+.
  If JSON stays: round coordinates to cm → −40 %.
- **rayon** (urban/** parcels per block, sites per parcel, programme passes where independent; houses plans per
  request — Codex's crate): parcel RNG is already forked per block identity, so results stay deterministic;
  expected 5–10× on parcels/sites/plans with 24 threads. Quarters: composition/split/blocks per quarter if their
  RNG forks allow it; otherwise this is the next algorithmic target (it grows super-linearly, see §5).
- **Serve without `serde_json::Value`** (local/main.rs): `json!` builds a full Value tree then `to_vec`, and quarters
  additionally serialize+reparse the layouts to retain them; serialize structs straight into the response.
- **Retained layouts in the worker**: keep the full objects in the worker, send the main thread only the GPU
  buffers + attribute tables; the inspector asks the worker by id.
- Mesh build (64–82 ms / 630–663 ms in JS) moves to the worker or to Rust with the binary transfer.

## 9. Caveats

- Shared machine: other agents' servers/builds ran concurrently; identical native runs varied ×2–3 (ranges above).
- 5k comparison (UI, software): every zoom ≤ 3 ms drawCity, flush ≤ 20 ms, no long tasks — the problem is purely
  one of scale.
- The compact-plan UI run (`--architecture compact`) was invalidated by page reloads (Vite full-reload from
  concurrent edits: the decor was decoded three times, heap 1.3 GB, no parcels); not reported. Native compact plans
  were measured in §1 (8.2 s, 75 MB); Codex's raster-tile renderer has its own numbers in CODEX_RENDER_LOD.md.
- Readback-based "flush" numbers are only valid in software mode (Chrome demotes an accelerated 2D canvas after
  repeated `getImageData`); GPU-mode numbers use frame cadence and the trace.
- The WebGL prototype draws plan geometry only (no labels/walls/glyphs/dashes yet) and approximates drawCity's
  palette; it is a measured feasibility prototype, not wired into the UI.
