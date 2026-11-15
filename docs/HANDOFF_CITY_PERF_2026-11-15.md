# Handoff: city generation and display performance (14-15 November 2026)

Everything below is committed and pushed on `main` unless a line says otherwise. Read this before resuming the work; the detailed reasoning is in `CITY_GENERATION_SCALING_2026-11-14.md` (review and plan) and `GROW_UNTIL_HOUSED_2026-11-15.md` (the one large lever left).

## Where things stand

Time from the click to a drawn map in `v2.html`, native engine, on the development machine (i9-12900K):

| Town | Friday evening | Now |
| --- | --- | --- |
| 20,000 | 21 to 24 s | 17 s |
| 100,000 | 53 s | 40 to 43 s |
| 1,000,000 | could not be displayed | about 280 s, 2D only |

Engine alone (replay, 8 threads on logical CPUs 8-15): 100k chain 32.5 s → 13.6 s; 250k 117 s → 32 s; 1M about 9 min → about 129 s, and about 104 s with every core since the engine stopped being throttled by Windows.

## What was added

| Area | What | Where |
| --- | --- | --- |
| Generation speed | One measuring pass, local and parallel whole-town passes, enclosure-fit bound, parallel allocation sub-steps; identical output | `rust/crates/core/src/urban/` (`trim.rs`, `quarters.rs`, `network.rs`, `composition.rs`, `programme.rs`, `programme_lots.rs`, `footprint/terrain.rs`) |
| Engine threads | Windows background throttling turned off at start, pool sized from the allowed cores; one `[threads]` line on stderr; `MAGNA_CORES=performance` as an option | `rust/crates/core/src/threads.rs` |
| Transport | Parcel pack `magna-city-parcels` v1 (parcels, programme, built capacity); site visuals v2 (no `housing_floor_need`, per-site programme texts); paged building sites for City Bench silhouettes | `urban/parcel_pack.rs`, `urban/pack.rs`, `urban/display.rs`, `rust/bridge/urbanParcelPack.ts`, `urbanDisplay.ts`, `web/src/ui/urbanSilhouettePages.ts` |
| Land use | Indexed cuts and parallel regions, identical replies | `rust/crates/core/src/landuse/`, `rust/bridge/urbanNetwork.ts` |
| Display | Heavy results replace the engine worker; urban layers projected on the page; roof detail only for the visible area above 60,000 buildings; roofs and shadows built in workers; cheaper canvas paths; names generated once; far satellite raster of towns | `web/src/v2/engine.worker.ts`, `client.ts`, `urbanPack.ts`, `rustTownProjection.ts`, `nativeCityMap.ts`, `web/src/render/cityBuildingsParallel.ts`, `cityFarRaster.ts`, `gpu/path.ts`, `roadStyle.ts` |
| Forest pass | A background forest update is never dropped while its key is current (`BackgroundJob`) | `web/src/v2/passes/pass.ts`, `benchRenderer.ts` |
| Neighbouring towns | Claims (land and edge streets), canonical order, cascade to dependent towns, warnings | `urban/neighbours.rs`, `web/src/v2/townNeighbours.ts`, `engine.ts` |
| Density gradient | Layout option `zoneDensity` (`phases` by default, `gradient`) | `urban/zone_blend.rs`, `rust/bridge/urbanConfig.ts` |
| Render | Road surface mode (Plan / None / Rendered), coastal swell and surf (close-up only) | `web/src/render/roadStyle.ts`, `web/src/v2/roadDisplayControl.ts`, `rust/bridge/terrainRenderV2Coast.ts` |
| Tests | The core WASM is loaded in Node tests again (broken since 7 November) | `web/tests/setup/coreWasm.ts`, `rust/bridge/wasmRuntime.ts` |

## How to measure and verify

- **Engine replay suite** (local, not in git): `web/out/perf-2026-11-14/`. `runcase.py EXE THREADS AFFINITY TIMEOUT CASE...` with `RUNS=<label>` writes stage times, `quality.json`, `town.png`, `density.png`, `buildings.png`; `quality.py --compare <ref> <new>` prints IDENTICAL or the differences. References: `runs-j3` (suite, 100k), `runs-q1` (250k, 1M). Build the tool with `cargo-sync build --profile fast -p magna-urbis-local --example cities_native_replay`. `AGENT_RULES.md` in that folder lists the invariants.
- **Land-use replay** (in git): `rust/crates/local/examples/landuse_replay.rs` against captured requests in `web/out/v9regen/megapoles-1m-v2/lu-*`.
- **Page timings and pictures**: `web/out/v9regen/megapoles-1m-v2.mjs` (local), from `web/`: `node out/v9regen/megapoles-1m-v2.mjs european-organic-1m`, with `POP=20000` or `POP=100000`, `CPUPROF=1`, `HEAPPROF=1`, `CHAIN_ONLY=1`, `NO3D=1`, `DELAY_PREP=<ms>` (reproduces the forest race). Reports and pictures in `web/out/v9regen/megapoles-1m-v2/`. A 1M run takes every core: take `web/out/v9regen/1m-run.lock` first.
- **Engine on :8791**: binaries in `web/out/engine/`; swap by PID only. The running copy is `magna-urbis-local-landuse-perf.exe`: it predates the last Rust commit (parallel allocation sub-steps, identical output), so a release build and a swap are due.
- A measurement that looks slow with many threads on a binary older than commit 58ffaf8d is the Windows throttling, not the cores.

## What is left, in order of value

1. **First image at 100k**: GPU tessellation of the first frame (`renderParts`, 1.5 to 3 s), yard enclosures (1.2 s, a worker candidate), merge of building chunks (0.75 s), `forestWash` (0.7 s).
2. **Two races like the forest one** (found, not fixed): the CPU branch of `forestPass` can lose `setRoadCanopy` when two `set()` overlap; `requestVectors` drops a raster that became stale without invalidating, so a view can stay on a coarser raster.
3. **Page tests**: the full suite was stopped at 72 files of 468 (19 with failures, log `web/out/vitest-full.log`). Seen so far: approved town fingerprints of `urban.culturequality` and `urban.edgeRoofs` (towns changed by the wall and parcel work of 14 November: to re-approve), `v2Engine` (renaming the map no longer keeps the identity of the streets: a likely regression of the page work), `urban.landuse` ("reserves the real quarters"), `urbanWorker.retention`, `cityRetainedPlacement` (9), `render.landscape-ground` (5), and tests behind the code since 7 November (`v2CityBatch`). None was triaged further.
4. **1M**: the 3D view dies at opening (it builds every building: needs the visible-area tiering the 2D got); the page peaks at 4.07 GB of a 4.09 GB tab, so parcels and layouts read from the binary buffers instead of objects are the lever (about 900 MB); mid-zoom views take 2 to 3 minutes each.
5. **Engine quarters stage**: at identical output it is near its floor. The remaining lever changes town edges: see `GROW_UNTIL_HOUSED_2026-11-15.md`.
6. **Neighbouring towns**: a town next to another loses its wall when the circuit would cross the neighbour (a wall fitted to the free side is not done); the "no room at all" and "short of land" warnings were not exercised in the page.
7. **Review sheet**: the three 1M megapoles were not added to the v7 sheet or the gallery; do not run them through City Bench (`megapoles.mjs` recomputes the town at each setting and the page dies at 4 GB).
8. **Web profile**: the threads and release WASM packages were not rebuilt with this Rust; the single-thread package was (`npm run wasm:terrain`).

## Traps met

- The trim must run to its exact fixed point (test `serviced_quarters_fill_from_the_core_with_a_bounded_population`).
- A polygon overlay against a subset of operands changes the ring representation and broke towns twice: keep operations whole or rings identical.
- Density seen by the eye is building fabric (rows against detached houses), not households per hectare: judge on `blockCoverageShare` and `buildings.png`, and in the real page.
- The tree is shared by several sessions: stage hunks with a filtered patch (`git apply --cached --unidiff-zero`) rather than stash; a merge of `origin/main` works on a dirty tree when the incoming commits do not touch dirty files.
