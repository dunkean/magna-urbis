# V2 terrain and regional generation: traceability

The V2 recipe now exposes the existing Rust Terrainbench terrain and water contracts. This inventory records the executed path, its tests, and the remaining limits. It does not claim new scientific methods or universal CPU support for the neural models.

English is the default application language; French is available. Control labels and help are registered by `web/src/v2/terrainControlSchema.ts`. Runtime messages use `web/src/v2/runtimeMessages.ts`.

## Terrain recipe → execution → retained result

| Existing source of truth | V2 recipe | Executed path / retained result | Evidence |
| --- | --- | --- | --- |
| `rust/bridge/terrain.ts::TerrainSettings`; `core/src/engine.rs` | `extent`, seed, `terrain.motifSize`, resolution | `effectiveTerrainSettings` → `platform.generateEngineHeight` → `sampleRustTerrain`. The map width is passed unchanged. Rust supports **500–100,000 m**; the bench's motif scale supports 250–50,000 m. | `v2TerrainParity.test.ts`; real WASM `caldera-100km` check |
| `RELIEFS`, `ENVIRONMENT_RELIEFS` in the terrain bridge | `terrain.relief`, environment, mountainMix | All 11 relief families and all 5 geological surroundings use the existing terrain engine. Mix is forwarded; the core uses it for mixed relief. | Forwarding test includes caldera, high mountains, independent motif and mix; real caldera check |
| Terrainbench's eight coast bits and island modes | `terrain.coastMask`, islandMode | Integer mask 0–255, including diagonal combinations; island/archipelago/random forwarded directly. These replace the previous cardinal-only conversion when supplied. | Forwarding test mask169; real WASM coast mask68 |
| `EROSION_SETTINGS`; `core/src/erosion.rs` | `terrain.erosion`, erosionTuning | Every named override is forwarded: iterations, incision, incisionSlope, fill, carve, finalCarve, talus, thermal, diffusion, detail, warp, surfaceIterations, surfaceIncision, surfaceCarve, surfaceRouted, surfaceThermal, surfaceDiffusion. Missing overrides keep the engine's relief defaults. | Test forwards all 17 overrides; real WASM uses iterations3 and surfaceIterations0 |
| Terrainbench compute controls | runtime backend/compute; `terrain.compute`, generationCompute | Browser WASM CPU, WebGPU sampling, GPU fine/all noise, GPU erosion, or native Rust generation. Auto may retry procedural generation on CPU; an explicit GPU recipe does not silently fall back. Independent stage provenance is retained. | `v2EngineRuntime.test.ts`; real browser CPU checks. GPU/native hardware coverage is in `v2_platform_check.mjs`, not inferred from CPU tests. |
| Terrainbridge neural sources | runtime source, neuralServer, pythonServer, neuralAssets | Browser `neural-wasm`, Python/CUDA `neural-python`, native Rust neural service `neural` (default 8792). Procedural native Rust is a separate server (default 8791). Loopback validation protects native endpoints. | Native neural forwarding unit test; hardware/model execution requires the corresponding installed runtime. |
| `NeuralTuning`, `fetchNeuralRelief` | fidelity, landScale, steps, all four noise ratios, reliefMode/Scale/Fixed, histogram[5], detail | Full structured tuning reaches the neural request. Model-generated relief is not replaced by procedural relief on failure. | Neural forwarding test includes all tuning values and an unrestricted finite histogram. |
| Neural fitting and checkpoint controls | neuralFit, neuralSlopes, coarseModel/baseModel/decoderModel | The existing model generates a 40 km source. Crop/scale and optional slope preservation fit it to the selected extent. Checkpoint selection is effective on Python/CUDA. Browser inference and the native Rust neural server use their installed profile; dormant checkpoint drafts are preserved but excluded from those effective recipes. | Python checkpoint request assertions; native profile/endpoint assertions; model identity/profile retained in stats. |
| `terrainSketch.ts`, `terrainZones.ts` | `terrain.sketch`, zones | Portable versioned sketch and semantic masks are validated and forwarded to the same edited-surface/zoned-generation paths. Imported V2 heightmaps become a metre-valued surface sketch for Rust hydrology rather than bypassing water customisation. | Project/recipe validation; existing sketch/zone parser contracts. Interactive editing is implemented by the V2 terrain control module. |
| `terrainAdjust.ts::FractalDetail` | refine, detailNoise | All eight detail controls are forwarded. Detail is sub-source-cell refinement: a coarse overview may legitimately show no change. The retained source field and refinement recipe remain available to the renderer. | Forwarding test; terrain bridge applies refinement in SVG sampling. |
| `hydrology.ts::HydrologySettings` | `terrain.hydrology` | **Actual Rust/vector hydrology is executed**, not a second TypeScript regeneration after height export. All Rust controls, water budgets, breach/fill policy, conditioning, erosion visibility, grid resolution and CPU/GPU preference are passed. Failure of requested hydrology is reported rather than hidden. | Rich forwarding test; native river id 42 and exact vertices survive projection; real Rust 256 check produces 2 rivers. |
| `vectorWater.ts`, `riverVectors.ts` | hydrology engine=vector; riverArea, lakeDepth/Area, riverMode, flatSlope, sinuosity, vectorWidth/Resolution, balance, braiding, anabranching, terrainInfluence, avulsions, confluence, deltas | Retained vector lake and river output feeds the World projection. Braids, oxbows and distributaries are retained. Grid mode projects the already routed D8 graph, without inventing vector meanders; the applied threshold is retained in `VectorWater.riverArea`. | Real vector 512 custom-climate check produces 54 river lines. Grid routing is also rasterised for native placement. |
| `terrainClimate.ts`, `terrainForest.ts` | climate preset/values; forest.enabled/density/clearings | Custom climate reaches neural generation and water budgets. `buildForestField` produces an actual canopy field used by natural cover and retained rural land use. Forest-only edits reuse the expensive terrain/water cache. A bounded forest-field cache avoids repeating an identical canopy calculation. | Forest-disabled/cache-reuse assertions; real vector custom-climate case. |

## Native snapshots, exports and cache identity

`terrain.v2NativeTerrain` retains the bench `TerrainData`: FP32 overview heights and normals, its physical field and `exact` flag, cave mask, raw Rust hydrology arrays and packed vector topology, vector hydrology, conditioning deltas, and neural provenance when present. `TerrainRequest.retainField` requests this data independently of SVG/WebGL selection. Analytic/coarse fields are explicitly marked `exact:false`; no approximation is relabelled as exact.

`projectEngineTerrain` adapts that completed result for the shared `World` renderer and settlement workflow. It does not regenerate elevation, drainage, lakes or rivers. The planning raster uses the requested overview resolution; receiving indices are projected when drainage and overview grids differ. The complete original drainage remains in the snapshot. Native lake rings and cave domains are retained. Some legacy export/render paths treat individual lake rings independently; the original ring topology remains available in the native snapshot.

The versioned terrain cache key covers the effective native terrain recipe, neural/checkpoint choices, compute choices and exact imported bytes. It excludes transport endpoints and forest-only controls. IndexedDB retains complete physical terrain results across worker/application sessions; memory/disk caches clone their boundaries. Project JSON preserves typed arrays, native snapshots, the recipe and edit history. Large 1024² hydrology snapshots can produce large JSON files; the existing 256 MiB project limit is explicit.

The classic TypeScript engine keeps its 600–40,000 m limits and original controls. Selecting it preserves the dormant Rust recipe for a later switch; its visible classic controls determine its generation. Unsupported neural CPU execution is reported: current neural runtimes require WebGPU or a local GPU service. Procedural CPU generation is available in web and local profiles.

## Regional placement and road customisation

| Source | V2 configuration / call | Retention / verification |
| --- | --- | --- |
| `rust/bridge/settlements.ts::SettlementConfig`; `core/src/settlements/mod.rs::validate` | `settings.region.placement` → `effectiveRegion` → `SettlementEngine.run({place})` | Demographics, counts/list, site preferences, site weights, spacing and scoring retain the native names. Validation mirrors core ranges, including total secondary counts≤1000 and complete in-map X/Y positions. |
| `settlements.ts::settlementRaster` | Physical native field and selected water graph → requested regional raster resolution | No terrain regeneration. Legacy/coarse inputs are explicitly resampled; more samples do not invent finer source information. Tests inspect the exact native input and requested grid. |
| `RoadConfig`; `core/src/settlements/roads/mod.rs::validate` | `settings.region.roads` or null → `run({roads})` | All road development/surface/culture, density, grade, crossings, wobble, sharing and exits controls are forwarded. Raw road class/profile/surface/crossings remain in `debug.v2RustRegion`. |
| Placement and roads are separate core calls | Reroute sends retained `sites`, without `place` | One engine/native session and raster are reused while terrain identity/resolution/runtime are unchanged. A changed runtime disposes the old WASM handle. Road-only requests do not move sites. `v2Region.test.ts` checks that a second call has neither placement nor raster upload. |

`smallTop` remains a legacy contract value; the current Rust implementation explicitly states that sampling now considers all available land. It is not represented as an effective new generation feature.

## Repeatable checks

From `web/`:

```text
npm run typecheck
npm run test:v2
node scripts/v2_terrain_parity_check.mjs
```

The browser script requires a Vite development server (`MAGNA_V2_URL`, default `http://127.0.0.1:5175`). It runs actual Rust/WASM CPU generation with software browser rendering and writes `web/out/v2-terrain-parity-check.json`. Its four cases cover combined coasts with Rust water, explicit water disabling, a 100 km caldera, and vector water under a custom climate. Unit tests distinguish mocked forwarding/session orchestration from real browser execution. Neural numerical quality and GPU/native timing require their dedicated hardware/model tests; passing the CPU checks is not evidence for those paths.

## Repères en français

La recette V2 transmet désormais les paramètres structurés de Terrainbench aux moteurs existants. L'hydrologie Rust ou vectorielle calculée est conservée : elle n'est plus remplacée par une nouvelle hydrologie TypeScript après transfert du relief. Les snapshots natifs, hauteurs FP32, réseaux d'eau et paramètres restent dans les projets et le cache.

L'étendue Rust réelle est 500 m–100 km. Le moteur classique garde 600 m–40 km et ses réglages historiques. Les modèles neuronaux actuels demandent un GPU ; aucune réussite CPU procédurale ne prouve leur fonctionnement. La forêt utilise réellement le climat et les contrôles de densité/clairières, tout en réutilisant le relief et l'eau conservés.

Implantations et routes régionales disposent de leurs paramètres Rust, d'une validation alignée sur le cœur et de sessions réutilisées. Recalculer les routes renvoie les sites existants au moteur, sans relancer leur implantation ni recharger un terrain identique. Les tableaux ci-dessus relient chaque groupe de paramètres à son code et à ses preuves de validation.
