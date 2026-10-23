# City GPU renderer (WebGL2): files, API, measurements, integration (Opus, 2026-10-22)

Follows OPUS_PERF.md, which found that the slow camera ("rendu trop lent") comes from Canvas 2D path
rasterisation: Skia replays every Path2D vertex in the GPU process, 72-81 ms per frame at near zoom at 100k.
Only new files were added. No existing file was edited and nothing was committed. No native server was needed,
because the benchmark reads the saved plan from `web/out/city-perf/native/`.

## Files (all new)

| file | role |
|---|---|
| `web/src/render/cityGl.ts` | the renderer: `createCityGlRenderer(canvas)`, shaders, GPU packs, triangulation worker pool, `cityGlPick`, `cityGlOverlayLayers`, `SOFTWARE_GL` |
| `web/src/render/cityGlBuild.ts` | pure geometry, with no DOM and no GL: polygon packing relative to the city origin, earcut triangulation (also split by slices for workers), fill meshes with 512 m spatial chunks, street and wall segment instances (rank-sorted, then chunked), towers, `meshFeatureAt`, `visibleRanges` |
| `web/src/render/cityGlStyle.ts` | per-feature colour tables and the draw list for each (view, LOD, palette, layers) state, mirroring `drawCity` |
| `web/src/render/cityGlWorker.ts` | triangulation worker (transferable buffers in both directions) |
| `web/src/render/cityGlHost.ts` | `CityGlCanvasLayer`, a drop-in for `CityCanvasLayer`: one foreignObject holding a GL canvas under the 2D canvas, falling back to 2D only when WebGL2 hardware is missing |
| `web/tests/cityGl.test.ts` | 6 tests: hole triangulation (area, empty court), worker split equal to single thread, picking (building, parcel, court, empty) agreeing with the triangle mesh, street order and butt flags, chunk culling, LOD colours/draws |
| `web/scripts/city_perf_gpu.mjs` | benchmark: GL vs Canvas 2D `drawCity` on the same scene, 1x (100k) and Nx tiled (10x is a synthetic 1M) |

Earlier prototype files (`cityGlEarcut.ts`, `cityGlMesh.ts`, `cityGlLayer.ts`, `tests/cityGlMesh.test.ts`) are kept.
`cityGlBuild` imports the earcut port from `cityGlEarcut.ts`. The other prototype files can be deleted after integration.

## API

```ts
import { createCityGlRenderer, cityGlOverlayLayers } from '../render/cityGl';
const gl = createCityGlRenderer(canvas);              // throws without hardware WebGL2 (see "software" below)
await gl.setScene(cityPlan, cityBuilt);               // CityScene + CityBuildings from cityCanvas, built once
await gl.setBuildings(cityBuilt);                      // new silhouettes/compact footprints without rebuilding the plan
gl.draw({ viewport, metresPerPixel, view, lod?, palette?, layers?, selectedId?, selectedParcel?,
          buildingsVisible?, diagnostic?, refusedParcels?, clear? });   // returns { lod, drawCalls, instances, triangles, cpuMs }
gl.pick({ x, y }, { view, lod })                      // → { kind: 'building'|'parcel'|'block', id?, building?, parcel?, block? }
gl.resize(w?, h?); gl.stats(); gl.dispose();
```

- **Fills** (footprint, blocks, parcels, buildings): earcut triangles over one vertex buffer (f32, metres from a
  rounded city origin), plus a u32 feature id per vertex. Colours come from `texelFetch` on a per-feature RGBA texture.
  A view, palette, layer, LOD or refusal change rewrites the colour tables (4 B per feature) and never the geometry.
  A feature with alpha 0 is collapsed in the vertex shader.
- **Outlines**: `gl.LINES` on the same vertices, with a second colour table that selects which features have outlines.
- **Streets and walls**: one 36 B instance per centreline segment (a, b, width, minPx, distance along, feature, meta).
  Each instance becomes a quad on the GPU. The fragment shader computes a capsule distance field, which gives round
  joins and caps, a one-pixel antialiased edge, butt ends for bridges and wall pieces, and dashes for fords (casing)
  and palisades. The minimum pixel width per rank, `max(width, minPx·mpp)`, is applied on the GPU. Each street draw
  is two passes, casing then fill. Each wall draw is two passes, outer then the light inner line. Towers are
  instanced SDF discs with a ring.
- **LOD**: same thresholds and hysteresis as `selectCityLod`, and the same choices as `drawCity`. Far: footprint plus
  rank ≤ 1. Mid: blocks, plus parcels in roles/uses views, plus rank ≤ 2 and crossings. Near and close: parcels and
  buildings; parcel outlines in parcels view; building outlines at close. Instances are sorted minor → major with
  crossings last, so "rank ≤ k" is a suffix range.
- **Culling**: each layer is packed by 512 m grid cell (row-major), giving one chunk per occupied cell. A frame draws
  only the chunks in view and merges consecutive ones into one call: 4-63 draw calls measured. Streets are chunked
  within each rank group.
- **Antialiasing**: MSAA on the default framebuffer (`antialias: true`) for fills and lines. Strokes and discs use
  analytic distance-field edges.
- **Picking**: the existing `SpatialBins` + exact polygon test (`pickCity`), topmost building, then parcel, then block.
  A court (hole) returns the block. `meshFeatureAt` checks that the triangles agree (test).
- **Build**: packing runs on the main thread. Triangulation runs on up to 4 module workers (polygon slices,
  transferred), with a single-thread fallback. A newer `setScene` drops a stale build. Context loss is handled
  (re-upload from the retained typed arrays).
- **Software guard**: `failIfMajorPerformanceCaveat` plus a renderer-name check (`SOFTWARE_GL`). On SwiftShader,
  llvmpipe or WARP, `createCityGlRenderer` throws and the host keeps Canvas 2D. Measured below: software GL is slower
  than software Canvas 2D. `{ allowSoftware: true }` overrides it (benchmarks).

Not ported, so these stay on the 2D overlay or are dropped: parchment ink hatching, dashed reserve-block outlines, the
1.6 px landmark parcel outline in roles view (1 px here), stairs tread marks, and diagnostics (fronts, axes, access,
reserve, allocated, quarters). Labels, landmark glyphs, district names and centres also stay in 2D: call `drawCity`
on the 2D canvas with `cityGlOverlayLayers(layers)` and `buildingsVisible: false`, and only those are drawn.

## Measurements

Setup: `node scripts/city_perf_gpu.mjs [--gpu] --scales 1,10` with headless Chrome at 1500×1000, DPR 1, map
city-01-river-plain-l. 1x has 2,027 blocks, 12,392 parcels, 2,046 streets and 8,249 silhouettes. 10x is 10 tiled
copies: 20k blocks, 124k parcels, 20k streets and 82k buildings (a synthetic 1M). GPU mode uses ANGLE D3D11 and was
verified on the **RTX 4090** (renderer string, plus nvidia-smi before and after; the 5090 stayed at 0 %). The machine
was shared and loaded.

- `gpuMs`: GPU time for one GL frame (`EXT_disjoint_timer_query_webgl2`, median of 8).
- `sync`: `draw` plus `readPixels(1 px)`, i.e. a full CPU→GPU→CPU round trip.
- `frame`: median presented-frame interval over 16 pans issued from rAF. In this session headless rAF ran at
  **31.2 ms (32 Hz) in GPU mode**, so 31.2 means "never late". With `--unthrottled` the GL cadence drops to 0.4 ms,
  but 2D frames then get coalesced, so throttled cadence plus gpuMs/sync are the numbers to trust.
- `js`: JS time of the draw call.

### Before/after, RTX 4090 (culled build; raw: `web/out/city-perf/gpu/city-01-river-plain-l-gpu.json`)

| zoom | view | 1x Canvas2D frame / JS | 1x WebGL gpuMs / sync / JS | 10x Canvas2D frame / JS | 10x WebGL gpuMs / sync / JS |
|---|---|---:|---:|---:|---:|
| whole city (mid at 1x, far at 10x) | parcels | 46.5 / 5.0 | 0.0 / 0.5 / 0.1 | 31.3 / 5.6 | 0.3 / 1.3 / 0.1 |
| whole city, LOD forced near (everything) | parcels | **143.8** / 20.6 | 0.8 / 2.0 / 0.1 | **1 080** (max 1 204) / 188 | **6.7 / 8.8** / 0.1 |
| far 14 m/px | parcels | 31.3 / 1.0 | 0.1 / 1.6 / 0.1 | 31.2 / 7.3 | 0.1 / 1.1 / 0.1 |
| mid 4.5 m/px | parcels | 53.1 / 5.1 | 0.3 / 3.0 / 0.1 | 57.2 / 9.9 | 0.0 / 0.7 / 0.1 |
| mid 4.5 m/px | roles | 53.3 / 11.1 | 0.4 / 1.8 / 0.1 | 52.6 / 13.6 | 0.5 / 1.4 / 0.1 |
| **near 1.5 m/px** | parcels | **160.3** (max 178) / 9.3 | **1.1 / 2.6** / 0.1 | **168.1** / 15.9 | **0.7 / 2.3** / 0.1 |
| **near 1.5 m/px** | buildings | 101.7 / 6.4 | 0.7 / 1.6 / 0.1 | 109.7 / 9.5 | 0.5 / 1.0 / 0.1 |
| **near 1.5 m/px** | roles | 158.8 / 13.1 | 0.8 / 2.2 / 0.1 | 123.0 / 15.2 | 0.6 / 1.4 / 0.1 |
| close 0.4 m/px | parcels | 44.4 / 1.8 | 0.5 / 2.0 / 0.1 | 49.3 / 6.2 | 0.5 / 3.5 / 0.1 |

Every WebGL configuration presented every frame on the 31.2 ms tick. The "10 redraws per vsync" stress also stayed
on the tick. GL + 2D overlay (labels and glyphs via `drawCity` with `cityGlOverlayLayers`) costs 0.1-2.4 ms of JS at
1x and up to 24 ms at 10x with the near LOD forced on the whole city (all 1M landmarks and labels). Even then it never
missed a frame.

Culling effect at 10x (pre-culling run kept in `…-gpu-nocull.json`): near parcels gpuMs went from 5.0 to 0.7, close
buildings from 6.9 to 0.3, and near triangles drawn from 1.87M to 0.13M. A view's GPU cost now depends on what is in
view, not on city size.

### Scene build and memory

| | 1x (100k) | 10x (synthetic 1M) |
|---|---:|---:|
| mesh | plan 225k vertices / 189k triangles; buildings 83k / 55k; 23k street segments | plan 2.25M / 1.89M; buildings 828k / 546k; 233k segments |
| GPU memory (buffers + colour textures) | **9.7 MB** | **96.3 MB** |
| `setScene`, single thread (pack + earcut + assemble + upload) | 82-110 ms | 534-617 ms |
| `setScene`, 4 workers (wall time) | 37-52 ms; main thread about 25 ms (pack 7-18, upload 6) | 274-340 ms; main thread about 200 ms (pack 84-159, upload 32); one long task of 90-166 ms |
| `setBuildings` only (4 workers) | 8-14 ms | 74-82 ms |
| colour-table rebuild (view/LOD change) | < 1 ms | a few ms |
| for reference: `buildCityScene` / `buildCityBuildings` | 12-27 / 6-14 ms | 154-166 / 141-192 ms |
| page JS heap | ~50 MB | ~530-550 MB (scene objects, not the GL path) |

### Software (no GPU: `--disable-gpu`, WebGL on SwiftShader), 1x

Raw data: `web/out/city-perf/gpu/city-01-river-plain-l-cpu.json` (culled build). The renderer string was SwiftShader.
"GL frame" is the presented cadence; the floor in this mode was 16.7 ms.

| zoom (view) | Canvas 2D frame / getImageData sync | WebGL (SwiftShader) frame / sync |
|---|---:|---:|
| far 14 (parcels) | 16.5 / 3.7 | 24.8 / 21.3 |
| mid 4.5 (parcels) | 34.5 / 33.3 | **151 / 146** |
| mid 4.5 (roles) | 69.4 / 69.4 | **187 / 181** |
| near 1.5 (parcels) | 161 / 165 | **247 / 246** |
| near 1.5 (buildings) | 131 / 144 | **260 / 255** |
| close 0.4 (parcels) | 41.3 / 38.6 | **97 / 88** |
| whole city, near LOD forced | 178 / 169 | **451 / 425** |

Without culling, the same software run was worse at near and close (393 and 380 ms).

So without a GPU, WebGL is the wrong path. MSAA, the fragment SDF and LINES are all emulated on the CPU. This is why
the renderer refuses software contexts by default and the host keeps `drawCity`. Canvas 2D in software mode is
unchanged: 77-95 ms at near (OPUS_PERF.md).

Visual check: `web/out/city-perf/gpu/*-x{1,10}-{webgl,canvas2d}-{buildings-1.2,parcels-0.5,roles-3,parcels-6}-gpu.png`.
The two renderers show the same plan and colours (the GL shot also shows the selection outline). GL block outlines
look slightly heavier: a 1-device-pixel line at full alpha vs Skia's antialiased hairline.

## Integration in terrainUrban.ts (owner: round-2 stream, after round 2)

1. Replace `new CityCanvasLayer(options.map, layer, paintCity)` with
   `new CityGlCanvasLayer(options.map, layer, paintCity)` from `../render/cityGlHost`. It uses the same
   foreignObject, the same `request()`/`attach()`/`dispose()`, and the same frame plus `frame.gl`.
2. In `drawCityLayer`, where `cityPlan = buildCityScene(...)` changes:
   `void cityLayer.gl?.setScene(cityPlan, cityBuilt).then(() => cityLayer.request())`. Where `cityBuilt` changes
   (silhouettes or compact scene appended): `void cityLayer.gl?.setBuildings(cityBuilt).then(...)`. Chunked
   `appendScene` deltas can be batched, e.g. one `setBuildings` per 250 ms; at 100k it costs 8-14 ms.
3. In `paintCity`, when `frame.gl` exists: call `frame.gl.draw({ viewport: frame.viewport, metresPerPixel: frame.mpp,
   lod: cityLod, view: render.view, palette: render.palette, layers: render, selectedId: selected, selectedParcel,
   buildingsVisible: buildingPanel.state.visible && !native, diagnostic: appearance.diagnostic, refusedParcels })`.
   Then call `drawCity(ctx, …)` as today, but with `layers: cityGlOverlayLayers(render)` and `buildingsVisible: false`.
   The 2D canvas then holds only labels, glyphs, diagnostics, the selected-parcel stroke, and the native renderer
   `native.draw(ctx, …)` (Codex's detailed roofs), which stays on top. Without `frame.gl`, keep today's code unchanged.
4. Picking can stay `pickCity(cityPlan, …)`; `gl.pick` is the same thing plus `kind`/`id`.
5. Line width (`render.width`): GL outlines are fixed at 1 device px. If the slider matters, use the stroke pipeline
   for outlines (an instance per edge, ~300k at 100k, about 11 MB).
6. Vite: the worker is `new Worker(new URL('./cityGlWorker.ts', import.meta.url), { type: 'module' })`, a literal
   pattern Vite bundles. If workers fail, triangulation runs on the main thread (82-110 ms at 100k).

## What Codex's building renderer could reuse

- **Overview raster tiles become unnecessary at ≥ 2 m/px**: GL draws all 8k (100k) or 82k (1M) footprints in under
  1 ms of GPU, with no tile cache or progressive fill. `UrbanBuildingLodRenderer` can keep the vector "detailed" level
  at close zoom only.
- **Shared GL context and layer formats**: `cityGlBuild` already defines what roofs need. `CityGlPacker` +
  `packLayer`-style chunking + `triangulatePolygons` (or the worker pool) for facets, each facet with its own feature
  id and colour from a table (material, shade by slope). The `CityGlStrokes` instance format (36 B: a, b, width,
  minPx, along, feature, meta with butt/dash bits) fits ridges and hips (`[Point, Point][]` from
  `cartographic.ridges`). The cleanest next step is a small extension point,
  `renderer.addLayer({ fill?: CityGlFillSource, strokes?: CityGlStrokes, colors, minLod })`, drawn between plan and
  selection. It is not built yet; it needs agreement on ownership.
- **Binary from Rust**: if the native side emits f32 coordinates relative to an origin plus u32 ring offsets (see
  OPUS_PERF.md §8), they map 1:1 onto `CityGlPolygons` (`coords`/`rings`/`polys`/`features`), and the JS pack step
  disappears. That step is 84-186 ms of main thread at 1M, the largest main-thread cost left.

## Remaining limits

- Main-thread packing at 1M (84-186 ms) plus `buildCityScene`/`buildCityBuildings` (~300 ms) and the 500 MB heap of
  scene objects. Fix with binary geometry from Rust or the worker-retained plan (OPUS_PERF.md §8).
- Integrated or weak GPUs were not measured; a 4090 is ~10-20× a typical iGPU. With culling the worst observed frame
  is 0.8-1.1 ms of 4090 GPU time in normal views, and 6.7 ms with the near LOD forced on a whole 1M city, a
  configuration the UI never selects.
- Overlay labels at 1M with the near LOD on the whole city cost up to 24 ms of JS (drawCity's landmark loop). In real
  views it is ≤ 2.4 ms.
