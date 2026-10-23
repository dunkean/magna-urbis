# Progressive architecture transport — ready

`placeArchitectureBatches` now accepts `ArchitectureBatchOptions.onBatch`.
The existing inferred options on `planUrbanBuildings` and `placeUrbanBuildings`
expose this directly; `architecture.ts` required no change and is released.

```ts
await planUrbanBuildings(input, runtime, {
  cancelled: () => superseded,
  async onBatch(delta, { start, completed, total }) {
    // delta is this successful chunk only, including its archives/materials.
    // Send/merge it under the current job ID; do not append the final scene again.
    publishChunk(delta, { start, completed, total });
  },
});
```

- `start`/`completed` are the zero-based input request interval; `total` is the
  total input request count. Refusals/open spaces count as completed requests.
- Native chunks contain at most 64 requests. The compact wrapper finishes native
  planning and archival before publication. Failed output-budget attempts never
  publish; successful smaller retries publish exactly once in request order.
- Each delta is a `structuredClone` of that chunk alone, not the accumulated
  scene. It contains its own metadata, materials and archive dictionary. Changing
  a consumer's delta cannot alter the accumulator or later native neighbors.
- The callback is awaited for backpressure. Cancellation is checked before and
  after native work, and after the callback even for the final chunk. Callback
  errors propagate outside the retry loop; no callback is silently retried.
- Empty input preserves the existing native metadata call and publishes its
  single empty result. Previous accumulated batches are never resent.
- Cloned archive references are registered before the callback. After a worker
  transfer the receiver must again call `registerPlanArchives` on its received
  delta/merged scene. The old first-batch archive dictionary alias in the final
  accumulator was removed, so later archive merges cannot alter it.

The UI owns generation IDs, partial-scene rendering, stale-message rejection,
and final commit/rollback. On cancellation/error it must not treat the displayed
prefix as a completed scene. The final Promise remains the complete scene; use
it to replace/finalize the prefix rather than append it a second time.
The legacy detailed generation route is unchanged.

Validation: one focused test passed (`architectureProgress.test.ts`, 192 ms),
covering two failed oversized attempts, ordered unique archived publication,
selected archive replay, consumer mutation isolation/backpressure, cancellation
after the final callback and cancellation before publication. Isolated TypeScript
strict compilation of the transport and test passed. No UI or native build changed.

## Client and worker integrated after Opus D2

`urbanSceneProgress.ts` now owns a linear, per-run accumulator. Every received
chunk registers only its own archives and appends its records without cloning
the accumulated scene. Material IDs merge through a map. The accumulating scene,
its arrays and received building objects keep their identity. Chunk arrays and
archive dictionaries are not mutated. Callbacks must treat both delta and scene
as read-only; the scene grows between awaited callbacks.

Implemented client contract:

```ts
client.run(input, onProgress, async (delta, progress, accumulatedScene) => {
  // Attach this same scene once, append delta to the renderer, then await paint.
});
```

The worker sends `{ id, batch: { delta, progress } }` and waits for the client's
ACK after its callback. A streamed completion contains `complete` metadata and
counts plus the existing authoritative requests/timing, **not another scene**.
The client checks completion and resolves with the identical accumulated scene.
Without a callback, the existing full-scene response remains available. Empty
input still yields one empty chunk and valid completion.

Cancellation/new work releases the single worker ACK wait. Callback errors
cancel rather than retry. A worker failure may use main-thread fallback only
before any chunk has been published; after publication it rejects so the UI can
roll back without receiving a duplicate prefix. Explicit `compact` and `detailed`
City modes both use native plans; omitted mode retains legacy eager houses and
built-capacity reconciliation. A run replacing pending work reattaches the raster,
because the replaced request may not have uploaded it yet.

Focused helper test passed (98 ms): transferred archive replay, stable identity,
materials/archive merging, thin completion, missing/duplicate chunk rejection,
and empty input.

Integration test passed (`urbanSceneStreaming.test.ts`, 412 ms): real client with
mock worker, plus actual worker handler with native-call stubs. Covers awaited
consumer/ACK, identical final scene, callback failure, stale response/ACK,
cancellation releasing the worker, no prefix replay after worker failure,
explicit detailed→plans, and omitted legacy mode→eager. Source TypeScript strict
compilation passed. The separate CityBench browser smoke supplies visual proof;
this unit test makes no first-paint or native performance claim.
## Authoritative site transfer — follow-up
Each acknowledged batch now carries only its original placement requests for `[start, completed)`. The client checks the interval length and appends these sites once. The final worker message contains completion counts and timings, with neither the full scene nor the whole-city sites array. The public client response still returns the complete authoritative, unedited `requests` array for per-house restyling. The fallback uses the same contract. This removes the final monolithic ~61 MB clone observed in the 100k smoke; total request storage/transport remains proportional to city size, and native `buildingSites` is still monolithic pending session handles/paging. Focused streaming tests cover original-vs-edited configurations, ordered assembly, missing requests, backpressure, cancellation and fallback.

