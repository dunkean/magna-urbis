# V2 optimisation review · 28 October 2026

This review precedes the final release build. It keeps the generation settings, map resolution, scientific fields, native architectural plans and project format. Optimisations remove redundant work and copies; they do not lower the requested quality.

The detailed reviews cover [terrain and regional generation](V2_OPTIMIZATION_TERRAIN.md), [projects, persistence and exports](V2_OPTIMIZATION_PROJECTS.md), and [urban generation, forms and 3D](V2_OPTIMIZATION_URBAN.md). Each records its workload, measurement limits, tests and reproducible commands.

## Main-thread and worker transport

The transport benchmark uses the actual retained Rust project produced by `v2_rust_browser_check.mjs`, including its physical fields and native city snapshot. These figures measure Node structured-clone cost, not complete browser generation time. Medians use nine repetitions with garbage collection between repetitions.

| Operation | Before | After |
| --- | ---: | ---: |
| Typed-array backing stores sent to the 2D renderer | 25,413,452 B | 786,432 B |
| Clone that rendering payload | 19.217 ms | 2.990 ms |
| Typed-array backing stores resent for a subsequent town action | 25,413,452 B | 0 B |
| Clone that subsequent generation request | 19.026 ms | 0.033 ms |

The 2D renderer receives the complete cartographic geometry, labels and physical fields it uses. Imported input images, native terrain archives, derived forest source fields and native city archives stay in the scientific/project world. The complete data is still available to the inspector, 3D view and project exports. The original and projected SVG are byte-identical; three additional styles are compared in unit tests. No live source buffer is transferred or detached.

The generation worker retains one canonical snapshot. The client sends its identity token only when the supplied world is exactly the last successful result. Imported or edited sources cannot accidentally reuse that token; imported projects explicitly release the previous source. Starting a new terrain or complete world no longer sends an old world that the generator will discard. Failure and cancellation preserve the previous visible map. This trades one bounded retained worker source for repeated large inbound copies; it does not remove the necessary result sent back to the page.

Repeated display settings no longer rebuild the previous scene before attaching the new one. Loading an empty recipe releases the previous render worker and 3D resources. Generation and rendering remain separate workers.

Evidence: `web/out/v2-optimization/transport.json`; its exact input is retained as `transport-input.project.json.gz` with a source SHA-256. Reproduce from `web/` with `node --expose-gc --import tsx scripts/v2_transport_bench.ts path/to/retained.project.json`.

## Dense-city inspection

Building selection reuses the renderer's tile index, cached weakly by immutable geometry snapshot. Exact polygon and courtyard tests still determine the result, in the same reverse drawing order. Bounding boxes expand conservatively before Float32 indexing so precision near a boundary cannot exclude a valid candidate. Geometry edits create a new index; the previous snapshot remains valid.

A synthetic scene of 100,000 buildings and 200 queries took 124.979 ms with exhaustive picking and 0.369 ms with the warm index. Initial index construction took 23.790 ms. All selected indices were identical. These are picking timings, not a 339-fold application speedup. Tests additionally cover overlaps, holes, boundaries at large coordinates and edited geometry.

Evidence: `web/out/v2-optimization/picking.json`. Reproduce with `node --import tsx scripts/v2_picking_bench.ts`.

## Validation boundary

Physical output hashes and carved heights are compared before and after optimisation. Project encoding has a byte-identical comparison at a fixed version. Tests protect canonical snapshots from mutation and cover individual-house regeneration, imported project composition, cached terrain, independent regional routing, EN/FR switching and the real browser 3D view. Initial terrain calculation remains expensive: no universal cold-generation speedup is claimed.

The alpha remains local for review. A successful build or these browser tests do not establish that a newly packaged desktop executable was launched or freshly installed.

## Résumé français

La passe conserve la qualité et les résultats : moins de copies des terrains et archives, cache disque sans relecture de tous les rasters, chargement/export des projets moins coûteux, index pour sélectionner les maisons et réutilisation des étapes urbaines. Les tableaux distinguent les mesures locales, les scènes synthétiques et les temps de génération complets. Les rapports détaillés contiennent les limites et les preuves.
