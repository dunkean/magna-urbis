# Selected architecture edit API — ready

Owner: Codex style_index agent. Only new bridge/helper tests; no UI changes.

```ts
editArchitectureScene(
  previous: PlacementBatch,
  requests: PlacementRequest[],
  generate: (input: PlacementBatchRequest) => Promise<PlacementBatch>,
  settings?: PlacementBatchSettings,
): Promise<{
  scene: PlacementBatch;
  applied: boolean;
  changedIds: string[];
  refusals: PlacementRefusal[];
}>
```

`rust/bridge/architectureEdits.ts`. Opus supplies the exact authoritative sites,
stable IDs, scope filtering and final per-scope overrides. `generate` is normally
`planUrbanBuildings` or `placeUrbanBuildings`, already responsible for bounded
native batches. The helper invents no building geometry and calls no API itself.

- All selected IDs form one transaction. A refusal, missing/duplicate/unexpected
  output ID, wrong parcel ID or wrong open/building category rejects the whole
  edit: `scene === previous`, `applied:false`, `changedIds:[]`, refusals returned
  separately. Native/network exceptions propagate without changing the scene.
- Duplicate/empty request IDs are caller errors and throw before generation.
  Empty selections are no-ops. Unknown prior IDs are allowed for previously
  absent/failed sites, but every requested ID must receive exactly one result.
- `function:'open_space'` explicitly converts/removes a building through the
  native open-space result. Ordinary requests must produce a building.
- A spatial index built once from unaffected footprints, courts, circulation,
  structures and foundations supplies exact nearby occupied surfaces as native
  neighbors. Selected old buildings are omitted; existing request neighbors are
  preserved except matching selected IDs or their `/occupation/` records.
- The callback receives an independent clone of selected requests/settings and
  relevant neighbors. Native generation cannot mutate the previous scene through
  those arguments. No full-city deep clone is needed.
- Success replaces only selected IDs across buildings/open spaces/refusals;
  outside objects retain identity. Unused archive chunks are pruned, referenced
  old/new chunks merged and registered; material records merge by stable ID.
- Schema must be compatible. Generator/version and building mode cannot change
  while any outside result remains. A complete replacement or empty scene may
  adopt the new generator metadata; no silent legacy/compact mixture is produced.

Shared material IDs with conflicting definitions are refused when outside
results remain, so changing one target cannot silently recolor its neighbors.
Archive integrity remains checked on selected replay; the edit verifies archive
references/presence/collisions without eagerly decompressing every retained plan.

## Integration and validation

Files ready: `rust/bridge/architectureEdits.ts` and
`web/tests/architectureEdits.test.ts`. Four focused tests pass, covering:

1. Atomic native refusal, missing result and callback failure; original inputs
   remain untouched even when the callback mutates its arguments.
2. Exact nearby footprint/court/circulation/feature/foundation neighbors,
   removal of selected old occupation and unchanged distant object identity.
3. Archive merge/prune/registration with exact selected replay, material merge,
   explicit native building-to-open-space conversion.
4. Duplicate/foreign IDs, wrong parcels/categories, mixed generator/mode
   refusals, empty selection and permitted whole-scene migration.

Commands passed:
`npx vitest run tests/architectureEdits.test.ts --project fast`
and isolated TypeScript strict compilation of the helper/test.

The caller owns scene-state concurrency: discard superseded async completions
before applying `result.scene`, and commit persisted overrides together with an
`applied:true` result. The helper operates on its supplied immutable snapshot;
it cannot know whether the UI has switched scenes while native work was running.
No TODO item is marked complete until Opus wires and checks the City Bench flow.
