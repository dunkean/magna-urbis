# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Phase 5/6 review: cross-renderer compatibility and live generation integration

**Verdict: CHANGES REQUIRED.** There is 1 blocker and 5 majors.

This was a read-only review: I made no writes and did not run any tests, generations or browsers. Every finding comes from reading the code at `7b57e37` plus the uncommitted docs changes. Performance and evidence figures (e.g. 170.6 MB / 15.8 s) are the implementation's numbers, not mine. I did not open generated binaries. I counted candidate-column packing as absent, because it isn't in the code.

## Phase 1 recheck

| Item | Status | Evidence |
|---|---|---|
| **B1** mirrored georeference | **Fixed** | The frame is documented at `model.ts:1`, and the "X azimuth = Z azimuth − 90°" rule at `neuralEarth.ts:5-6`. The rotation matrix at `neuralEarth.ts:79-86` is correct and is its own inverse. The origin is the first sample centre (`neuralEarth.ts:12`). Test: `surface.contract-boundary.test.ts:20`. |
| **B2** export offset | **Fixed for `exportSurfacePacket`** | `translatedBuildings` (`export.ts:49-61`) shifts triangles, footprints, accepted surfaces and ground constraints. Roads are shifted and tagged (`export.ts:85-88`), and the occupation raster is grid-indexed. Test: `contract-boundary.test.ts:54`. Leftover: `exportSurfaceInputPacket` (`export.ts:30-36`) and live packets have no coordinate tags (see M1). |
| M1 dry water level | Fixed | NaN default at `magna.ts:114-128`. |
| M2 LOD ordering | Fixed by documentation | `model.ts:7` |
| M3 regional package validation | Fixed | Explicit markers, typed and range checks, no reviver: `neuralEarth.ts:26-77`. |
| M4 climate | Fixed | Bench rules copied at `climate.ts:22-33`; `worldToSurfaceInput` and `exportSurfaceInputPacket` default to Magna temperate. |
| M5 shared terrain queue | Fixed | Each request gets its own worker, which is terminated on abort (`magna.ts:40-62`). The bench uses HTTP refinement with a fetch abort signal. |
| Phase 1 minors | Mostly fixed | `stream.ts`, `provider.ts`, the refinement identity and metadata bounds, and the `external-inflows` label are fixed. **Still open:** the silent 64–1024 resolution clamp in `createInfiniteTerrainProvider` (`magna.ts:33`) is still undocumented. |

## Blocker

**X1 — Native city geometry and candidates go into the binary file as JSON, which has a hard 16 MiB limit.**
- **Where:**
  - The limit is enforced in `binary.ts:51`.
  - `exportMagnaBuildings` (`magna.ts:64-85`) produces nested JS arrays: every triangle has 9 point coordinates, a normal, `materials` and a surface label.
  - Candidates are plain objects; the defaults are `maxCandidates: 100000` (`export.ts:42`, `workerProcessor.ts:29`).
- **Size estimate:** roughly 250–350 bytes of JSON per triangle and about 150–200 per candidate. So about 50k triangles, or a full 100k candidate cap, will throw `RangeError` in:
  - the UI export,
  - `export_surface_world.ts`,
  - every live packet.
- **This breaks two stated requirements:** native city geometry must be preserved, and large worlds must use typed fields rather than giant float JSON.
- **Live packets make it worse:** `packetFor` (`workerProcessor.ts:31-35`) re-sends all of `urban` plus the archived `sourceMetadata` on every tile, even when the canonical context is skipped.
- **Why the evidence doesn't cover it:** `verify_surface_ui.mjs` runs the live check at `stage=terrain`, where there are no buildings.
- **Fix:**
  - Pack the urban mesh into columns: positions as f32 or f64, normals, indexed material/surface tables, and per-building offset/count arrays. Keep IDs, holes, levels and the `representation` field in small records.
  - Land candidate-column packing.
  - Add an urban/context identity handshake (like `knownContextId`) so tiles don't repeat `urban` and `source`.
- **Validate:**
  - Export and live-request a settlements-stage decor with at least 500 native buildings and the candidate cap reached.
  - Check that triangle, hole and level counts and material IDs survive the round trip.

## Major

**M1 — Live and export packets use different urban schemas, and live packets lose road materials.**
- **The divergence:**
  - Export (`export.ts:84-88`) adds `roadsCoordinateSystem`, `footprintsCoordinateSystem`, `sourceIndex`, road `surface`/`class` and `sourceToWorldTranslation`.
  - The live worker (`surfaceWorkerSource.ts:16,20`) and the synchronous session (`surfaceLiveSession.ts:22,25`) send only bare `{points, widthM}` roads and no coordinate tags.
  - `exportSurfaceInputPacket` (`export.ts:35`) has no tags either.
- **Effect:** a native renderer needs two code paths, and live mode drops road materials.
- **Fix:** have all four producers call one `magnaUrbanPacket(decor, scene, dx, dz, roadsOverride?)` builder. Add a schema test that compares the export packet with the live packet.

**M2 — Every superseded request throws away the cached canonical context, so live mode can stall.**
- **What happens:**
  - The session handler calls `compiler.cancel()` on every new request (`surfaceLiveSession.ts:99`), and `SurfaceCompilerClient.cancel` terminates the worker (`workerClient.ts:42-45`).
  - The next job re-clones the decor, re-prepares occupation and rebuilds the canonical context (`workerProcessor.ts:18-25`).
  - On a 1024² world that is several seconds of the reported 15.8 s.
- **Effect:** under continuous camera movement, or with the broker allowing 4 pending requests (`surface_live_plugin.ts:48`), the first packet may never arrive.
- **Also:** deterministic validation errors such as the out-of-bounds `RangeError` also kill the cache (`workerClient.ts:64`).
- **Fix:**
  - Cancel cooperatively during retarget, candidates and encode: a `SharedArrayBuffer`/`Atomics` flag checked where `assertNotAborted` already runs.
  - Terminate the worker only after a grace timeout, on an epoch change, or on dispose.
  - Alternatively, build the canonical context eagerly in a phase that supersession does not terminate.
  - Keep the worker alive after routed validation errors.
- **Validate:** send 5 requests 200 ms apart during the first build. The last one should complete with `canonicalBuildCount ≤ 2`.

**M3 — The source-registration lineage check is hard-coded to pass.**
- **The gap:** `prepareSurfaceDecorWorkerSource` always returns `registeredSourceBinding: true` (`surfaceWorkerSource.ts:19`). The worker then binds any `job.terrain.source.id` to the retained canonical context (`workerProcessor.ts:20-22`), so a provider registered from a different field is accepted silently.
- **Other gaps:**
  - The `providerId` passed at initialisation (`surfaceLiveSession.ts:81`) is captured once and goes stale after a re-registration (`infiniteRefinement.ts:46`).
  - `packetFor` doesn't check that the tile's origin, spacing and extent match `job.region`.
- **Fix:**
  - Put a registration binding in the payload: `{expectedSourceId, fieldFingerprint, width, n}`, computed from the exact field sent in the `createInfiniteRefinementProvider` call (`terrainbench.ts:2033-2038`).
  - In the worker, require an exact match of `job.terrain.source.id`.
  - In the worker, assert that the terrain bounds equal the region bounds within the tolerance for one sample.
  - In the bench, assert `decor.raster.width === retained.width`.
- **Validate:**
  - Compare a live tile with the canonical heights interpolated at the same positions; the correlation should be above that of the transposed grid. This catches x/y transposition and offset errors that no current test detects.
  - Report max |Δ|. The registration labels the decor raster samples as B-spline control points (`benchTerrainTransfer.ts:56`, `infiniteRefinement.ts:22`), so refined heights are systematically smoothed relative to the canonical samples. Measure this and record it in provenance.

**M4 — In the settlements stage, the live cache and `isCurrent` don't notice road or settlement edits.**
- **The gap:**
  - The handler is cached on `terrain` and `scene` only (`terrainbench.ts:2018`), and `isCurrent` checks the same plus `settings` (`terrainbench.ts:2040`).
  - `settlements.captureData()` roads and placements, and the forest/climate query from `withForestQuery`/`shareQuery`, can change without either changing.
- **Effect:** live packets keep serving stale occupation, roads and climate.
- **Fix:** key the cache and `isCurrent` on a cheap revision. `capturePipelineState()` (`terrainbench.ts:1930`) already gathers the right inputs. Pass that revision as `sourceEpoch` and `sceneEpoch`.

**M5 — "Export 3D surface" blocks the UI and can't be cancelled.**
- **Where:** `pipelineSurface` (`terrainbench.ts:1994-2010`) runs everything synchronously on the main thread: compile, occupation, candidates, archive and encoding about 190 MB. That is two full copies at peak, and the export fails outright on worlds larger than the default 512 MB compile budget.
- **Fix:** send the export through the existing compiler worker with an `export` job kind. Transfer the bytes back and make it cancellable.

## Medium / Minor

- **Superseded live requests are reported as errors.** `installSurfaceLive` (`surfaceLive.ts:22-27`) POSTs the AbortError text, and the viewer receives a 422.
  - Fix: map `name === 'AbortError'` to a distinct `cancelled/superseded` reply, and have the broker supersede explicitly.
  - Also handle `EventSource` reconnects (`events.onerror` → abort all), because old-session work otherwise keeps running.
- **Occupation versioning builds huge JSON strings.** `occupation.ts:88` does `JSON.stringify(Array.from(...))` over the full classes and orientations arrays. That is tens of MB at 1024², and at 4096² (~300 MB) it approaches V8's maximum string length.
  - Fix: use the byte-level `fingerprint` from `compiler.ts:10`; export it.
- **`source.water.originX/Z` is a cell corner, but the grid contract says origin is a sample centre.** `export.ts:79` uses the corner while `terrain.originX` is the corner plus `cell/2`, so consumers are off by half a cell.
  - Fix: rename to `cornerX/Z`, or store the centre with an explicit convention.
- **Terrain-stage export uses an unrelated building scene.** In the terrain stage, `pipelineSurface` passes `settlements.urban.buildingState.scene` (`terrainbench.ts:1998`) along with a capture whose settlements and roads were cleared and which may be cropped.
  - Fix: pass `undefined` in the terrain stage.
- **The binary encoder silently drops non-plain objects.** It turns `ArrayBuffer`, `Map`, `Set` and `Date` into `{}` (`binary.ts:32-45`).
  - Fix: reject any prototype other than `Object.prototype`/`null` and arrays.
- **Some source-archive attachments are not reversible.** In `sourceArchive.ts:38-41`, the `scene/layouts/partitions/geometry` path JSON-stringifies before checking for typed arrays or non-finite numbers. In-memory typed arrays and NaN would come back as objects and nulls.
  - Fix: guard with a replacer that throws.
- **Decoded packets are not validated.** Native consumers and `verify_surface_ui.mjs` trust whatever `decodeSurfaceBinary` returns.
  - Fix: add `validateSurfacePacket` (format/version, `schemaVersion`, field length = w·h, context-reference consistency).
- **Re-registration (`infiniteRefinement.ts:46`) ignores `request.signal`.** Concurrent "source expired" responses also each re-register.
  - Fix: pass the request signal into `connect()` and share a single in-flight registration promise.
- **Memory budgets differ along one pipeline.**
  - The live encoder allows 256 MB (`workerProcessor.ts:49`), the broker cap is 256 MB, the `surfaceLive` fallback encoder allows 1 GB and the compile budget is 512 MB.
  - A first packet with context is about 170 MB at 1024², so a ~1450² world will exceed the broker cap.
  - Fix: use one constant, documented.
- **The dev broker accepts cross-origin requests.** `/surface-live/terrain` accepts `text/plain` JSON from any origin (`surface_live_plugin.ts:47-49`).
  - Fix: check `Origin`/`Content-Type`.
- **Context and world IDs are 32-bit FNV hashes.** They are used as viewer cache keys through `knownContextId`, so collisions are possible.
  - Fix: use 64-bit or larger hashes, or include `environmentVersion` and `sourceEpoch` in the handshake.

## Future suggestions (outside this phase)

- Serve the canonical context from its own cached endpoint (`/surface-live/context/{id}`) so tile packets stay small.
- Add a MUFSURF1 variant of the Neural Earth `RegionalLayer` package. Large regional layers are currently JSON decimal arrays (`neuralEarth.ts:26-30`).
- Earlier future items still open: per-cell climate reference elevation, a lapse-rate clamp below sea level, halos on streamed tiles, and a test asserting correct triangle winding.
- Record occupation provenance when `occupationBuildings` falls back to visual `buildings` (`magna.ts:66`). The fallback itself is labelled per building, but the packet doesn't say it happened.
