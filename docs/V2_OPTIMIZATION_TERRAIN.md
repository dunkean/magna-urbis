# V2 terrain optimisation review

This pass preserves the selected generation quality, native snapshots and project data. It reduces repeated copies, oversized identities and work whose result was discarded. No production build or native executable was launched for these measurements.

## Measurements

`web/scripts/v2_terrain_optimization_bench.mjs` runs actual Rust/WASM generation in headless Edge, with browser rendering on software. Both runs use the same seed, 6 km extent, 512² overview, 512² Rust hydrology, 1024² physical field, motif 4.5 km, erosion .15 and conditioning disabled. Those are explicit benchmark settings; application defaults were not reduced.

| Operation | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Copy a retained terrain World, median of 5 | 38.2 ms | 0.1 ms | Physical buffers and immutable archives are shared between stages. Mutable metadata is detached. |
| Newly copied typed-array bytes for that operation | 36,049,344 | 0 | Deterministic allocation count for this terrain-only fixture. Other worlds can contain mutable urban arrays that still need copies. |
| Identity of a 1024² edited heightmap, median of 3 | 123 ms | 13.9 ms | Exact numbers are fingerprinted without expanding them into decimal JSON. |
| Heightmap identity length | 19,297,941 characters | 1,876 characters | Full heights and parameters remain in the recipe/project; only the cache/session identity is compact. |
| Physical-field hydrology carving, median of 3 | 73.3 ms | 53.8 ms | Normals and their gradient were computed and discarded; the height-only path skips them. |
| Scratch arrays eliminated by height-only carving at 1024² | — | 16 MiB per call | Three normal grids and one gradient-change grid. The ordinary sampled-terrain path still updates its real normals. |
| Reusing a terrain, median of 3 | 82.7 ms | 59.1 ms | Natural-cover classification is cached separately from physical terrain and returned through a detached copy. |
| Browser reported used JS heap at the final checkpoint | 363,896,811 bytes | 224,451,068 bytes | An indicative browser measurement, not process RSS or a guaranteed peak. |

The cold full-generation measurements varied from 6.9 to 9.9 seconds during concurrent development checks; the last after run was 8.4 seconds. This pass **does not claim a cold-generation speedup**. Short timings and heap samples depend on scheduling, JIT and garbage collection; the strongest evidence is the eliminated byte count and identical physical output. Raw measurements are written to `web/out/v2-terrain-optimization-before.json` and `web/out/v2-terrain-optimization-after.json`.

## Implemented changes

`worldState.ts` defines the stage ownership boundary. Physical height/slope/flow/water/drainage, native terrain, forest fields, site cost/fields and existing land use are immutable inputs to subsequent generation. The helper clones the terrain wrapper and river records because naming writes `River.name`; it also detaches options, centres, mutable town state, debug maps and other mutable metadata. Native town snapshots use the urban adapter's own copy-on-write transitions. Plan, town, town-stage and regional rerouting no longer deep-copy the whole scientific archive.

`terrainFingerprint.ts` hashes exact byte content and IEEE-754 JavaScript height values into four deterministic 32-bit lanes. Byte offsets, tails, numeric order and signed zero are significant. Explicit little endian keeps numeric fingerprints portable. This is a non-cryptographic cache identity, not a security or file-integrity primitive. In-place edits are scanned and detected; there is no stale identity memo based only on array object identity. `terrainCacheKey` substitutes fingerprints only for large sketch/zone rasters and imported pixels. The complete recipe is unchanged. Cache engine version `.3` invalidates older identities.

Changing cache identity does not force regeneration of a coherent saved `.2` world. Continuation compares the complete historical key, including the original numeric arrays and 64-bit imported-pixel fingerprint, with the exact historical recipe derived from the current settings. Only an exact match is accepted, and the original key/provenance/geometry are preserved. Seed, explicit extent, physics settings and raster edits are rejected. A weak memo attached to the immutable height grid avoids reconstructing a long historical key on every later action; scalar stats are copied through a new object without copying their immutable strings. The original `.1` TypeScript pipeline is also recognised, within its original 600–40,000 m range and with its exact original regional key. The older mixed Rust-height/TypeScript-water pipeline is not declared replay-equivalent to the current native water pipeline; its imported snapshot remains intact and exportable, without automatic conversion or geometry removal.

Validation of sketches and zones now checks the original arrays without making an unused raster-sized copy. Their public parsers keep their previous defensive-copy default. The compact placement key similarly copies only the small branches it actually edits.

`applyHydrologyHeight` applies the existing carving arithmetic to a physical height field without allocating normals or differentiating a discarded gradient. `applyHydrologySurface` retains its previous default behaviour for real terrain normals. Empty water masks skip polygon vectorisation; nonempty masks follow the same geometry algorithm.

Natural canopy and natural land cover have bounded three-entry derived caches. A forest-only change continues to reuse physical terrain and water; a biome/forest change invalidates the appropriate derived cover. Cache boundaries detach returned data so edits to a returned cover cannot corrupt another result.

Regional placement/routing reuse one native/WASM engine and its raster while runtime, terrain identity and raster resolution remain unchanged. Rerouting sends retained sites and road settings, without placement or a second raster upload. Changing the execution runtime disposes the obsolete WASM handle. Raster resampling preserves physical metre values and the requested sampling resolution; it does not manufacture finer source relief.

## Quality and isolation checks

The before/after browser checks retained these exact byte hashes:

| Retained field | Before and after |
| --- | --- |
| World height | `27fdb05d` |
| Water codes | `67f3d0a0` |
| Flow | `5d76642e` |
| Receiver graph | `5cf5b8ca` |
| Native physical field | `ae711d3e` |
| Height-only carving output | `7003da42` |

`v2TerrainOptimization.test.ts` checks compact identities, last-cell/in-place edits, exact scalar distinctions, byte-offset handling, copy-on-write ownership, and byte-identical height/extrema from full-normal and height-only hydrology at multiple resolutions. Existing retained-generation tests continue checking deterministic town output and unchanged source terrain. Derived-cover tests verify equal results and immunity to caller edits. `v2Region.test.ts` verifies actual forwarding boundaries, retained-site routing, raster/session reuse, runtime disposal and full native parameter validation.

Repeat from `web/` with the Vite development server running:

```text
npm run typecheck
npm run test:v2
node scripts/v2_terrain_optimization_bench.mjs
```

`MAGNA_BENCH_PHASE=before` selects the pre-optimisation clone and normal-producing carving baseline paths in the harness. To reproduce the original long-key measurement, use the pre-fingerprint source revision; after the code change the active cache-key function is intentionally compact in both harness phases. The saved before artifact was captured before that change.

## Résumé français

Les étapes ne recopient plus les dizaines de mégaoctets de terrain et d'archives immuables. Les noms, centres, réglages et cartes d'état modifiables restent détachés. Une heightmap 1024² garde tous ses paramètres et altitudes dans le projet ; sa clé de cache passe d'environ 19,3 millions de caractères à moins de 2 000.

L'incision du champ physique conserve exactement les hauteurs, en évitant 16 MiB de tableaux temporaires destinés à des normales inutilisées. Le couvert naturel et les sessions d'implantation/routage sont réutilisés. Les empreintes des cinq champs physiques suivis, ainsi que celle de l'incision, sont identiques avant/après. Aucun gain sur la génération complète à froid n'est revendiqué à partir de ces mesures.
