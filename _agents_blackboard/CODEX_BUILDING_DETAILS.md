# Detailed City Bench: native exteriors only when useful

**Ready:** `web/src/render/urbanBuildingDetails.ts`, `UrbanBuildingDetailController`; renderer hooks `getBuilding(id)` / `setDetail(id, visualOrUndefined)` in `urbanBuildingLod.ts`. No UI files changed.

The city Detailed mode must first generate **compact plans** using the progressive compact route. It must not call the eager whole-city detailed placement route. The following controller adds native exteriors to an existing compact renderer, without changing the applied scene, capacity or native planning facts.

```ts
const details = new UrbanBuildingDetailController({
  scene,
  renderer: buildingRenderer,
  realize: async (building, { scene, interiors }) => {
    const { realizeUrbanBuilding } = await import('../../../rust/bridge/architecture');
    return realizeUrbanBuilding(building, executionRuntime, interiors, scene);
  },
  onChange: () => schedulePaint(), // coalesced callback; do not regenerate/reindex
});

// Before drawing each camera frame; the same view is a cheap no-op.
details.update({ viewport, metresPerPixel, selectedId, enabled: architectureMode === 'detailed' });
const renderMetrics = buildingRenderer.draw(ctx, { viewport, metresPerPixel, appearance, selectedId });
// Preserve the existing rasterTilesPending animation-frame condition too.

// Progressive initial compact batches (renderer.appendScene is available).
buildingRenderer.appendScene(delta);
details.appendScene(fullExpandedScene); // updated archive table, same previous objects/IDs

// A different seed/replan/scene:
buildingRenderer.replaceScene(nextScene);
details.replaceScene(nextScene, buildingRenderer);
// On actual teardown:
details.dispose();
```

`realize` receives `{interiors:false, scene}`; the scene/archive table is captured at dispatch. It returns the native `HouseBatch`. The controller itself has no architecture/network import, so it does not force another WASM bundle into the UI. Callbacks must remain pending until native work actually settles. **Do not abort the HTTP fetch on camera movement:** closing a fetch does not stop Rust CPU work.

## Work and storage bounds

- Automatic requests only at `metresPerPixel <= 0.5` and projected size `>=72px`. Explicit selection is first priority even at a distant zoom; this occurs only while the controller is enabled (Detailed mode).
- Coarse unselected views perform **no building query and no detail request**. Close views use the existing spatial renderer index.
- Default maximum **2 physical calls**, shared across all controller instances, including disposed/replaced controllers whose native calls are still draining. A scene/camera change drops pending candidates and ignores obsolete responses; it never releases a running physical slot early.
- At most **32 queued**, renewed after completions. Working set up to **64 closest visible/selected buildings**, so the second queue batch gets a turn. Large close views deliberately retain this bound instead of detailing the entire city.
- LRU cache bounded by **64 entries, 16 MiB conservative geometry accounting, and 150,000 stored vertices**. The selected entry is protected when another entry can be evicted. Evicted buildings are not requested repeatedly in the same camera view, including when unrelated progressive chunks arrive; native refusals are retained in a bounded 256-entry map.
- Disabling removes visual overrides but keeps the bounded reusable cache. Replacement clears caches/refusals. Prefer one controller and `replaceScene()`; the shared physical semaphore also protects teardown/recreation.
- Fields are configurable through `BuildingDetailOptions`. `stats` exposes `queued`, `inFlight`, `globalInFlight`, `cached`, `cacheBytes`, `cachedVertices`, `refused`, `requestsStarted`, `responsesDiscarded`. `status(id)` returns `idle|queued|loading|ready|refused`, optional refusal message or native diagnostics. `getDetail(id)` returns the cached exterior visual without a scene-array copy.

## Geometry and renderer contract

`nativeExteriorDetail(base, HouseBatch)` verifies one unit, exact recipe/variant/body count, unchanged transform and retained body vertices (0.1mm tolerance). It transforms native XY and face normals by `unit.transform`, adds `ground_z_m` once to native local Z, and transforms group/structural-feature geometry. The complete native roof mesh is stored once on the first volume; face body/group/material identities remain native. Shared mesh vertices are not duplicated per body.

The visual shares the exact original footprint, roof-envelope and retained-plan references. Native mesh lines replace cartographic proxy ridges only at facet LOD. The renderer uses the base plan for indexing, picking, coarse rendering and cached raster tiles; receiving detail does not rebuild the index or invalidate overview tiles. Removal releases its prepared geometry cache. No new architectural geometry, entrances, source attribution or certified capacity is invented. Refusal keeps the base plan visible.

## Focused evidence

- `web/tests/urbanBuildingDetails.test.ts`: two focused tests pass. Exact local/world conversion, unchanged retained identities, mesh accounting; no overview query; selected-first scheduling; obsolete calls retain their physical slots through scene replacement; all four desired buildings advance through a two-entry queue; refusal preservation; byte eviction and no same-view churn, including progressive `appendScene` arrivals.
- `web/scripts/building_detail_smoke.mjs`: two fresh `/houses/plans` results on the existing native runtime **:8810**, then browser/controller `/houses/realize-plan` calls. No server launched, stopped or rebuilt. Two calls maximum, both accepted, 16/44 roof faces, 33,596 accounted cache bytes, 136 vertices. Same-camera rendering changed 29,043 pixels, with base plans unchanged. Returning to overview reads zero roof meshes and makes no extra native requests.
- Artifacts: `building-detail-smoke/before-compact.png`, `after-native.png`, `report.json`, `fresh-plans.json`. The synthetic Playwright page explicitly grants its localhost origin local-network permission, required by Chromium's address-space policy for routed documents. This is a harness setup detail, not a product permission workaround.

## First useful native chunk from the 100,000-population corpus

2026-10-22 15:41:51 UTC: exactly one POST `/houses/plans` on the existing `:8810`, preserving requests 0–63 of `city-visual-audit/01-l/requests.json` (10,960 total requests). Every recorded per-request setting and constraint remained intact, including old pinned recipes. The source array records no batch settings; native defaults therefore apply. No detailed realization, server lifecycle operation, or full-city run.

- HTTP 200: **133.3 ms** through the full response, plus **4.1 ms** JSON parsing. This is native first-chunk latency, not end-to-end CityBench first paint: upstream layout/partition, scheduling and rendering are excluded.
- **49 accepted buildings, 11 refusals, 4 open spaces**. Ten refusals report an authored layout/programme without a constrained operator; one exhausted its 80 bounded candidates. Accepted recipes: 48 `EUR-MED-B02`, one `EUR-MED-B05`; these recorded recipe pins do not evaluate the newer palette diversity.
- Request **338,411 bytes**, response **590,886 bytes** (58,951 bytes gzip computed offline; HTTP compression was not claimed). Target process CPU rose about **78 ms**. Five native processes were present; the other four had unchanged CPU at the two snapshots. Shared machine, one observation: indicative, not a throughput guarantee or a linear metropolis estimate.
- Replay input, native response and timings are saved under `city-visual-audit/01-l/first64-plans-{request,response,report}.json`; `measure-first64.mjs` refuses to rerun once the report exists.

## Retained urban source transport — UI/worker integration

2026-10-22: `urbanSourceBinding.ts` keeps a runtime-only source from the native parcel response, bound to the exact applied layouts/partitions arrays and their native member references, terrain identity and runtime URL. Selection returns city keys in native layout order. New applied geometry, returned capacity partitions, restores/history, accepted edits and terrain changes invalidate it. Display/camera changes do not. No handle is written into settings, snapshots, decor or MU1.

`terrainUrban` chooses this source before adapting a terrain raster. `urbanSceneProtocol.urbanSceneTransport()` strips `layouts`, `partitions` and `raster` from source messages, while the main UI retains its normal references for rollback. Worker and fallback read building sites via `source + keys`; no raster prerequisite, geometry clone or native upload occurs on that route. Stale source errors remain explicit and cannot enter the raster-missing resend branch. Older native servers/WASM with no source retain the existing geometry path. Legacy eager capacity reconciliation also stays on that path, because native source reads are currently limited to `buildingSites`.

Validation: `urbanSceneSource.test.ts` (3 focused tests) and `urbanSceneStreaming.test.ts` (2 tests), **5/5 passed**, plus `tsc --noEmit` passed. The client test supplies geometry containing non-clonable functions and uses real `structuredClone()` in the fake worker: the source message succeeds because geometry is absent. The actual worker handler test verifies source-without-terrain, legacy geometry, and a stale source error with no retry. No live native/browser run or server lifecycle operation accompanied this change. The building-site response remains complete JSON; this change only removes the redundant geometry upload. Pagination remains a separate next step.

Source bookkeeping integration files are ready for handoff: `terrainUrban.ts` (receive/generate/invalidation only), `urbanSceneProtocol.ts`, `urbanScene.ts`, `urbanSceneWorker.ts`, new `urbanSourceBinding.ts` and `urbanSceneSource.test.ts`. Paint, inspector behavior, 3D and comparison hook were not changed.
