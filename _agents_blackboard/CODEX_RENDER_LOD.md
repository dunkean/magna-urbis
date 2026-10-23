# Building renderer integration — ready

Owned files: `web/src/render/urbanBuildingLod.ts`, `web/tests/urbanBuildingLod.test.ts`, `web/scripts/benchmark_building_lod.ts`. Existing City Bench/UI/render modules were not edited.

## Entry point

```ts
import { UrbanBuildingLodRenderer } from '../render/urbanBuildingLod';

// Construct once per immutable scene, not once per camera frame.
const renderer = new UrbanBuildingLodRenderer(scene);
// Native PlacementBatch works directly; compact records can implement
// CompactBuildingVisual with cartographic {height_m, ridges, roof_system}.

function paint() {
  // Caller clears its overlay and applies world-to-device-pixel transform.
  const metrics = renderer.draw(ctx, {
    viewport: {minX, minY, maxX, maxY},
    metresPerPixel, // world metres / CSS pixel, NOT device pixel
    appearance,
    selectedId,
  });
  if (metrics.rasterTilesPending > 0) requestAnimationFrame(paint);
}

renderer.pick({x: worldX, y: worldY}); // source building or undefined; holes pass through
renderer.replaceScene(nextScene);   // replacement invalidates index, paths and rasters
renderer.clearCaches();            // also releases raster backing stores
```

The host owns Canvas creation/resize, clearing and DPR. `draw` clips to the viewport and restores its Canvas state. It does not change scene data, roofs or styles. Selection is an inexpensive vector overlay, including at silhouette/raster scale; selecting a new house does not invalidate raster tiles.

**Progressive overview is part of the API:** request another frame while `rasterTilesPending` is nonzero, and clear the overlay each frame. First-time tiles populate around the camera centre. A cold frame may show only the ready tiles. Do not recreate the renderer in this animation loop.

## Representation and bounds

- Uniform metric sectors select the visible records. Oversized buildings use a bounded overflow route instead of millions of cell memberships.
- CSS-pixel LOD thresholds default to 18 px for native ridges, 72 px for native facets, with 15% hysteresis. The silhouette style always stays a footprint. Curve tessellation spokes are suppressed. Unknown/flat compact roofs acquire no invented ridge.
- Compact `cartographic.ridges` are world-space `[Point, Point][]`; explicit empty arrays mean no ridges. Lines are clipped around native courtyard holes. The existing detailed inspector/export can continue using its exact exterior route.
- Path cache: 2,048 buildings / 200,000 vertices; camera history: 8,192. Scene replacement clears all three. Geometry is immutable between replacements.
- At >= 2 metres/CSS pixel in browsers, overview uses 256-pixel raster tiles with a one-pixel gutter and power-of-two scale buckets. Key includes scale, coordinates and appearance; scene replacement clears the entire epoch. Budget is 32 MiB. Eviction releases the canvas backing store.
- At most four tiles are prepared per frame, with an 8 ms **soft** preparation budget. One tile's work is synchronous and may exceed the time target. The host can tune these options. Coarser levels are selected if the visible tile set would exceed the configured cache; this avoids endless eviction/rebuilding.
- Warm overview visits only visible tiles, performs no building query, prepares no paths and reads no meshes. Node/no-Canvas environments fall back to the direct vector implementation. `raster:false` also explicitly selects vectors, useful for existing export workflows.

## Metrics

`draw` returns query counts, prepared/submitted vertices, native roof mesh reads, draw calls, cache counters, LOD counts, raster cache bytes and pending/built/drawn tiles. Raster `visibleBuildings`/LOD counts sum tile intersections and may count edge-straddling houses more than once (`visibleBuildingsExact:false`); do not present those as an exact unique-house count. Vector mode reports exact AABB-visible counts. Picking remains an exact native roof-surface test, including holes.

## Validation

11 focused unit tests: 1k/10k/100k repeated native reference geometry; fixed viewport work independent of city size; poisonous mesh getter at far zoom; native curve seams; no invented roof; courtyard fill/picking for both windings; overlap-safe nonzero batching; line clipping; bounded caches and same-ID replacement invalidation; selection; huge viewports/oversized structures; progressive tile convergence, bounded raster memory and zero warm building traversal at 100k.

Browser probe: `cd web; npx tsx scripts/benchmark_building_lod.ts` (Vite must be running). Defaults to Windows Edge or bundled Chromium elsewhere; override with `BUILDING_BENCH_BROWSER_CHANNEL`. This uses a separate headless browser, not the user's active tab. It repeats the actual native EUR-MED-B01 fixture's footprint, roof domain and ridge in a compact scene. It does not pretend to measure native generation or 100k detailed meshes.

Latest measured run (1280x900, DPR 1, Edge 155, synchronous Canvas readback included):

| Buildings | Fixed 25-house view, warm | Whole city, warm | Whole-city Canvas calls | Whole-city raster cache |
|---:|---:|---:|---:|---:|
| 1,000 | 0.4 ms | 1.5 ms | 1 | vector |
| 10,000 | 0.3 ms | 6.5 ms | 25 | 6.35 MiB |
| 100,000 | 0.3 ms | 6.4 ms | 64 | 16.25 MiB |

100k index creation was 62.4 ms. Its global raster population took 32 progressive calls / 629.5 ms of accumulated measured work before warm measurement. These are local observations, not universal performance guarantees. Full data: `CODEX_RENDER_BENCHMARK.json`; inspected visual witness: `CODEX_RENDER_BENCHMARK.png`. Browser pixel assertions verify a courtyard crossing tile boundaries remains transparent, adjacent roof pixels are continuous, and warmed tiles prepare zero vertices.

Ready for Opus/root integration; please preserve the progressive redraw condition above.

## Export compatibility — added

`web/src/render/urbanBuildings.ts` now accepts optional export bounds/scale without changing existing call signatures:

```ts
urbanBuildingsSvg(scene, appearance, selectedId, {viewport, metresPerPixel});
await drawUrbanBuildings(ctx, scene, appearance, metresPerPixel, {
  viewport, selectedId,
  maxPixels: 32 * 1024 * 1024,
  maxSidePixels: 16384,
});
```

- Native SVG calls without scale preserve the exact existing exterior/material-pattern renderer. Supplying scale enables native silhouette/ridge/detail LOD; supplying viewport enables indexed culling and a clipping rectangle.
- Compact or empty-mesh records export their actual material-colored footprint and resolved roof lines. Their courtyard holes stay transparent. SVG and Canvas share the same native/compact ridge extraction/clipping function; no bounding-box gables are synthesized.
- Canvas export draws synchronously into the caller's transformed context with raster tiles disabled, so no partial progressive frame reaches an export. It no longer allocates a whole-city SVG `Image` or computes extents solely from mesh vertices. Native/compact/silhouette bounds come from footprints, also including structural feature surfaces.
- Canvas export rejects extents exceeding the explicit pixel limits; it never silently downsamples. Supply a bounded viewport or consciously raise the limits for a larger caller-owned canvas. Exact native SVG remains available for exports needing the existing material patterns.
- Four focused export tests (including actual Resvg pixel assertions) plus existing LOD/exterior suites: **21 passed**; TypeScript passed. No UI files changed.

## Native small-gallery QA

Reproduce with `cd web; npx tsx scripts/native_building_gallery.ts`. Uses its own ephemeral native debug process and shuts it down; never touches the user's :8791 server. Browser draws real `/houses/plans` responses using `UrbanBuildingLodRenderer({raster:false})`.

Inspected artifacts: `native-building-gallery/gallery.png`, `native-building-gallery/report.json`, and the exact native requests' results in `native-building-gallery/native-cases.json`.

- Actual indexed bundles: EUR-MED-B01 default rectangle, B06 default U, B06 quadrangle courtyard, B07 default house+tower.
- Six accepted native plans; thirteen body pixel witnesses and two native semantic-courtyard transparency/picking witnesses pass. Closed-court geometry retains its actual gateway, so its open court is not necessarily represented as an internal polygon ring.
- Same style and seed produce visibly and numerically different rectangle and house+tower geometry in narrower envelopes. Narrow U and quadrangle probes explicitly refuse when retained court/range minima no longer fit; the report includes the attempted dimensions and native reason.
- No catalogue bundle declares FP-L, even among allowed footprints. The corresponding gallery row says unavailable; no source-backed medieval L recipe is fabricated.
- This is a small compact-plan visual check, not native roof realization or another scale stress benchmark.

## Fresh native endpoint / City Bench smoke (2026-10-22 16:23 local)

`web/scripts/compact_city_smoke.mjs` owns an ephemeral native process and headless Edge, then closes both. Run from `web/` after a coordinated native build. `--api-only` and `--city-only` isolate the two checks; `--out=...` keeps their evidence separate. No UI source changes or dependency additions.

- Tested executable modified 16:20:16. Fresh `/houses/plans` output is written to disk, read back, and passed to `/houses/realize-plan`; no older fixture is reused. B01 succeeded: 1 body, 16 native roof vertices, 16 faces, world-space footprint error exactly 0.
- **Reproduction handed to root/morphology:** B07 house+tower refused detailed realization because its native roof exceeds the retained cartographic envelope by 4.226625 m². Exact new response: `compact-city-smoke/fresh-native-plans.json`, building index 1; request construction in the script. `compact-city-smoke/report.json` contains the error. No permissive fallback or geometry alteration was introduced to hide the failure.
- Independent live City Bench pass: user river-plain decor, edited to 300 inhabitants, UI selector changed to Plan compact and generation button clicked after the actual parcel reply. `/houses/plans` HTTP 200, **21 native compact buildings / 13 refusals / 2 open spaces / 1 retained-plan archive**. No browser errors, no per-building SVG nodes, 1140×925 Canvas with nonempty pixels. Generation observation: 1046 ms; this is functional QA, not a performance guarantee.
- Inspected screenshot `compact-city-smoke-ui/city-compact.png`; report `compact-city-smoke-ui/report.json`. The UI still has old silhouette explanatory text and a silhouette-only appearance label in compact mode; reported to root for Opus, not edited here.
- One harness correction: the generation button is enabled before parcel arrival, so the script waits for the actual fresh parcel Worker response. An initial premature click returned the intended missing-parcels error; it was a harness timing issue, not a native failure.
