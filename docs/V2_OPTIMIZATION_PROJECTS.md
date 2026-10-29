# V2 optimization: projects, cache and disposable workers

This pass changes allocation, serialization and message ownership. The project JSON schema remains `magna-urbis-v2`, version 1. Generation settings, seeds, numeric values, coastline/river geometry and modification histories retain their existing meaning. No distribution or native executable was built during this pass.

## Changes

### Project JSON

`projectJson.ts` writes the existing tagged typed-array format in bounded numeric blocks. It uses the native JSON number formatter on blocks of 2,048 cells instead of constructing one large boxed-number array for each raster and invoking a JSON replacer on every scalar. Repeated references to the same view reuse its encoded blocks. Strings, key ordering, omitted properties, array holes, `toJSON`, `-0`, nonfinite-number tags and supported typed-array tags retain the previous JSON conventions.

`serializeProject` still returns a string. `serializeProjectChunks` lets the project worker construct its downloadable Blob directly from chunks, avoiding a second complete project string before UTF-8 encoding.

Parsing uses the native JSON parser followed by a pass over object containers and typed-array tags. Ordinary numeric cells do not require individual reviver calls. Forbidden prototype-related keys, unknown tags and nonnumeric array payloads remain rejected. Validation avoids allocating `Object.entries` tuples and pending-stack tuples for every scalar. World geometry validation skips scalar recursion while retaining coordinate validation.

### Persistent cache

The previous `IndexedTerrainStore.put` called `getAll()` after every write just to sort timestamps and retain three maps. That read cloned all complete rasters back into JavaScript, including the newly written map.

IndexedDB schema 2 adds a `saved` index. A key cursor reads timestamps and primary keys, then evicts the same entries. Equal timestamps preserve the previous primary-key ordering. The saved terrain record format is unchanged. Schema-1 data migrates without regeneration. Connections close on version changes, and an upgrade blocked by an older tab can recover after that tab closes; an abandoned open request closes its eventual connection.

The in-memory cache retains its independent copies. Removing those boundaries would let later urban stages or caller edits corrupt saved terrain.

### Composition and worker results

Composition skips large input heightmaps before cloning options that will immediately be overwritten. A cloned, locally owned adopted recipe can pass its fields to the new composition directly. Returned settings and terrain remain independent of the source project and the current recipe.

Parse and composition workers transfer the ArrayBuffers belonging to their completed results. These worker-local results are disposable. The live main-thread world, cached terrain and retained generation-worker snapshots are not detached. SVG export already returns a Blob, so it does not need an additional transferable raster copy.

## Measurements

Measurements used this Windows workspace, Node **v24.10.0**, the installed Microsoft Edge through Playwright, and the source server at `127.0.0.1:5175`. The JSON fixture contains six physical typed-array fields, a 128² imported sketch and a fixed seed. Its 1,024² version serializes to **60,005,443 bytes**.

The original implementation was measured before editing. At all three tested grid sizes, the optimized serializer produced the **same complete JSON SHA-256**, and parsed elevation buffers retained the same byte hash. The comparison held the engine-version string constant. A later cache-key fingerprint change increments the engine/cache identifier from `.2` to `.3`; it does not change the JSON schema or generation output.

| Operation, 1,024² fixture | Before | After | Change |
| --- | ---: | ---: | ---: |
| Serialize project string | 926 ms | 426 ms | 54% less time |
| Serialize: observed JS heap increase | 204.9 MiB | 119.0 MiB | 42% lower |
| Parse complete project | 3,125 ms | 243 ms | 92% less time |
| Parse: observed JS heap increase | 452.1 MiB | 41.5 MiB | 91% lower |
| Create downloadable project Blob | 1,327 ms | 671 ms | 49% less time |
| Blob creation: observed JS heap increase | 154.8 MiB | 66.2 MiB | 57% lower |
| Blob creation: observed ArrayBuffer increase | 114.5 MiB | 66.3 MiB | 42% lower |

The output size remains unchanged. Smaller fixtures also improve: parsing 256² takes 191 → 29 ms and parsing 512² takes 709 → 57 ms in the recorded run.

| Additional operation | Before | After |
| --- | ---: | ---: |
| Four IndexedDB writes, 512² terrain | 160 ms | 47 ms |
| Raster bytes read back into JS solely for eviction, four writes | 55,050,240 B | **0 B** |
| Largest such readback during one eviction | 22,020,096 B | **0 B** |
| Composition with a 4 MiB existing heightmap: structured-clone calls | 16 | 7 |
| Same composition: raster bytes copied by those clone calls | 17,465,344 B | 9,076,736 B |
| Same composition elapsed time | 69 ms | 59 ms |
| Disposable 5.5 MB result: clone versus transfer | 3.8 ms | 0.1 ms |
| Additional receiver raster-buffer copy | 5,505,024 B | **0 B** |

The composition comparison asserts deep equality of the complete result after removing the elapsed-time statistic, and confirms both input projects remain untouched. The cache comparison retains the same three keys even with deliberately identical timestamps. Actual project and composition workers were exercised in the browser: typed arrays arrive correctly, exported Blob text is identical, and the main-thread source buffers remain attached.

Timings are measurements on a shared machine, not guaranteed latency. JSON heap figures are sampled immediately after each operation with GC requested before it; they are allocation observations, not continuously sampled process peaks. GC and filesystem scheduling affect timings and deltas. The counted raster-copy bytes, output lengths, SHA-256 hashes and equality assertions are deterministic. The required parsed raster buffers are unchanged at 21 MiB for the 1,024² fixture.

## Reproduction and evidence

Run from `web/`:

```text
node --expose-gc --import tsx scripts/v2_project_optimization_bench.ts after
node --expose-gc --import tsx scripts/v2_compose_optimization_bench.ts
node scripts/v2_cache_optimization_check.mjs
npx vitest run tests/v2ProjectOptimization.test.ts tests/v2Compose.test.ts tests/v2Engine.test.ts
npm run typecheck -- --pretty false
```

The browser check accepts `MAGNA_V2_URL`; it uses the existing source server and does not start or stop it. The composition benchmark reconstructs the previous clone boundaries in an isolated generated module and compares the real composition results.

Recorded evidence is under `web/out/v2-project-optimization/`: `before.json`, `after.json`, `blob-export.json`, `compose.json` and `cache-browser.json`. Eighteen relevant tests pass. New regression coverage includes every numeric view type, Unicode and special-number JSON conventions, malformed/forbidden tags, chunked Blob equivalence, shared-buffer view offsets and independent copies across a transfer.

## Français

Le format des projets et les résultats de génération sont conservés. Les exports traitent les rasters par blocs ; les imports évitent un appel de reviver pour chaque nombre. Le cache lit uniquement son index de dates pour supprimer les anciennes entrées. Les compositions évitent les copies de heightmaps qui seraient immédiatement remplacées. Les workers d’import et de composition transfèrent leurs résultats terminés sans détacher la carte active ni le cache.

Sur le projet de référence de 60 Mo, la sérialisation passe de 926 à 426 ms et le parsing de 3 125 à 243 ms. La hausse de mémoire JS observée pendant le parsing passe de 452 à 41,5 Mio. Les fichiers JSON restent identiques à identifiant de moteur constant ; les tests vérifient aussi les tableaux, les valeurs spéciales, les imports, les transferts, la conservation des entrées du cache et l’absence de modification des projets sources.
