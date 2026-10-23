# Retained plan archives — implemented

## Concurrent detail requests — 23 October 02:07

Two simultaneous details from the same cold archive used to both miss the LRU, hash and gunzip the identical bytes. `decode` now shares the in-flight promise by archive ID **and exact source string**. Each caller still JSON-parses its own record. The promise is removed after success or failure; a cache epoch keeps work started before `clearPlanArchiveCache` from repopulating or removing newer entries. Existing callers can finish, without adding a shared cancellation mechanism.

Measured in the actual asynchronous gunzip test: two concurrent consumers, **one decompression and one miss**. The LRU remains2entries/8MiB; transient work is not claimed as cached payload.16archive tests and TypeScript pass, including retry after rejection, forged source under the same ID in both arrival orders, and clear during a decode. Root also ran11adjacent tests for detail scheduling, editing, selected-house transfer and cancellation; all pass. No city timing or GPU claim follows from this bounded correction.

Owned files:
- `rust/bridge/compactPlanArchive.ts`
- `web/src/io/planArchiveCompression.ts`
- `web/tests/compactPlanArchive.test.ts`
- `web/scripts/benchmark_plan_archives.ts`

`archivePlanBatch(batch)` asynchronously compresses native `compact-plan-1`
resolved objects and returns new building records. Each record carries
`{format: "compact-plan-archive-1", archive_id, index}`. Scene-level
`plan_archives: Record<string, string>` stores each gzip/base64 payload once.
Gzip uses `mtime: 0`; archive IDs are SHA-256 of its bytes, so replay/export is
deterministic. No generator, roof or layout code is called.

Chunks contain at most 64 native plans and at most 32 MiB of raw JSON. The
payload uses newline-delimited JSON; embedded string newlines are escaped.
Only the selected record is JSON-parsed. Browser code uses no Node Buffer.
The small helper lives under `web/src/io` so package imports resolve against
the existing `web/node_modules`; fflate is dynamically imported. Compression
uses synchronous gzip only inside an existing WorkerGlobalScope, avoiding a
nested worker per chunk. The UI path and selected-plan decompression use fflate's
asynchronous workers. Both compression paths produce identical gzip bytes.

Integration:
1. Archive each returned native chunk before merging into the city scene.
2. Merge `plan_archives` along with buildings in the transport aggregator.
3. Call `registerPlanArchives(scene)` after worker transfer or JSON restoration.
4. Before native realization, use
   `{...building, resolved: await resolveArchivedPlan(building, scene?)}`.

The registry is a WeakMap keyed by the building's resolved reference object.
It does not retain cities globally. The only strong cache is an LRU with at
most two decoded chunks and 8 MiB of accounted payload storage (raw bytes,
record offsets, UTF-16 compressed strings and map keys). Larger single chunks
can be resolved under the 32 MiB hard limit but are never cached. Parsed native
plans are returned fresh, so editing a prior result cannot mutate later replay.

Validation: all 12 focused Vitest tests passed, covering 64-record chunking,
lossless JSON export/restore including seeds and exact doubles, deterministic
compression, no eager decoding, immutable replay, count/byte LRU bounds, larger
uncached records, missing/corrupt data, legacy native pass-through and byte
equivalence between worker-local synchronous compression and async UI compression,
exact visible-value sharing, structured-clone aliases, chunk bounds and distinct
signed-zero/adjacent-double coordinates.
Command: `npx vitest run tests/compactPlanArchive.test.ts --project fast`.

## Actual native archive benchmark — 2026-10-22

Command (from web):
`node --expose-gc --import tsx scripts/benchmark_plan_archives.ts ../rust/target/debug/magna-urbis-local.exe 1000`

This launches and stops its own ephemeral native server, leaving :8791 untouched.
Fixture: 1,000 actual native EUR-MED-B02 plans, disjoint flat 30x38m sites,
distinct deterministic seeds. All 1,000 accepted, no refusals. No roof realization.

- Complete scene JSON: 13,059,670 → 5,924,285 bytes (**54.64% reduction**).
- Native retained plans: 7,818,279 bytes → 542,708 base64 archive bytes +
  138,840 reference bytes (**91.28% reduction**, excluding small archive-map keys).
- 16 archives, 407,016 binary gzip bytes.
- Node async/UI compression path: 547 ms. Worker-local sync timing was not measured.
- Measured V8 heap after two explicit GCs: 38,757,856 bytes with native scene →
  22,241,240 bytes with archived scene, **16,516,616 bytes lower**. Baseline was
  10,172,360 bytes. This includes runtime/transport allocations and excludes
  native server/worker heaps; serialized byte counts are the stable comparison.
- Three selected plans from different archives replayed with exact SHA-256
  equality of their native JSON, no procedural regeneration. Resulting cache:
  two entries / 929,260 accounted bytes; one eviction.

Report: `CODEX_PLAN_ARCHIVE_BENCHMARK.json`. The first real native chunk is saved
at `web/out/plan-archive-benchmark/native-first-chunk.json` for reproduction.

## Visible object sharing — 2026-10-22

`archivePlanBatch` additionally shares identical visible surfaces within each
building (building/roof/courtyard/circulation surfaces, volumes, levels and
foundations). Identical material slots and roof specifications share within each
64-building chunk. Equality is exact JSON with signed zero distinguished; there
is no coordinate rounding or geometry change. Intern maps are discarded after
each chunk. Inputs are untouched; already shared scenes return the same object.
`structuredClone` preserves these aliases. JSON exports retain their original
values and size; a subsequent `archivePlanBatch` restores sharing after JSON parse.

Same 1,000 real native plans, comparing unshared archive and shared archive in
the same process after releasing previous owners, two event-loop turns and two
explicit GCs per sample:

- Heap with unshared archived scene: 22,176,224 bytes.
- Heap with shared archived scene: 20,169,080 bytes.
- Additional saving: **2,007,144 bytes**, about **16.5%** of the scene's heap above
  the 9,997,472-byte process baseline. This is useful but does not solve all large
  scene memory requirements; native server and worker heaps remain excluded.
- Distinct visible surfaces: 8,003 → 5,000; material records: 1,000 → 48;
  roof specifications: 1,000 → 16. The number of references and all JSON values
  are unchanged.
- Sharing pass: 113 ms for 1,000 houses in this run with concurrent work active;
  this is not a clean throughput benchmark.
- Three retained native plan samples still replayed exactly; cache bounds held.

Report: `CODEX_PLAN_ARCHIVE_SHARING_BENCHMARK.json`. The script now measures both
archive representations from the same native responses before reporting the
structural sharing delta. A first synchronous-GC-only reading was rejected:
completed async frames still held the raw scene until the next event-loop turn.
