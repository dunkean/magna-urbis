# Open technical debt for contributors

The [first contribution guide](FIRST_CONTRIBUTION.md) covers the working culture, architectural style and 3D model examples. The two workstreams below are open engineering work. Each starts with an existing feature that can serve as a reference for the next contributor.

## 3. City composition and plan operators

A culture can already select an existing settlement preset. A contributor who wants to change how a plan is composed still needs to understand which stage owns the footprints, streets and parcels, and which later stages rely on them. For example, ordinary streets are cleared from water after formal street placement, and unused gates close against the finished network. Moving either operation can produce a plausible drawing with an invalid street or gate. See the [culture manifest](../contributions/urban-cultures.json), [plan assembly](../rust/crates/core/src/urban/pipeline/plan.rs) and [completion order](../rust/crates/core/src/urban/pipeline/complete.rs).

1. Expose one composition choice in a recipe. Let the author name and weight existing operators for one stage, such as parcel subdivision. Define eligibility, seed handling and what happens when no choice can run. Resolve the recipe once before processing lots.
2. Extract one existing Rust operator behind a typed interface. Document the geometry, units and seed it receives, the output it owns and the invariants it must preserve. Keep ordering and final geometry checks in the engine. Use the reference operator to demonstrate how to add a second implementation.

**Completion criteria.** A contributor can change a recipe weight in data and add an operator at one documented registration point. On fixed flat and waterfront scenes, the default recipe reproduces the reference geometry and the new choice replays deterministically. Check street access, parcel containment and gate crossings, then compare generation time on the same seeds, populations and build profile. Exercise the shared choice in V2 and City Bench.

## 4. Terrain passes, editing tools and import/export formats

The terrain crate already owns its calculations, and V2 tracks stage validity. The missing contributor contract is how a new pass declares its data and invalidates dependent results. The editor and file formats have a related integration cost. Tool activation references specific page controls, while the export dialog coordinates format selection, rendering and download. See the [terrain engine](../rust/crates/terrain/src/engine.rs), [stage validity](../web/src/v2/stageValidity.ts), [editing toolbar](../web/src/v2/editingTools.ts) and [export actions](../web/src/v2/page/exports.ts).

| Suggested order | First change | Evidence of completion |
| --- | --- | --- |
| 1. File formats | Extract one existing exporter that can read a saved scene. Give it a documented input, units, supported layers and output. Use the same separation for an importer, with validation before applying changes to a project. | A fixture exports without regenerating the world. A supported import restores the expected scale and geometry. Invalid input leaves the open project intact. |
| 2. Editing tools | Move one existing tool behind a small interface for selection, preview, apply and cancel. Document which project data the edit changes and which stages become stale. | Cancel preserves the original map. An applied edit survives save and reopen. An unrelated stage keeps its cached result. |
| 3. Terrain passes | Use one existing Rust pass to document input and output grids, dimensions, units, seed, buffer ownership and checkpoint dependencies. Connect its controls through the [stage registry](stage-registry-contract.md). | On a fixed heightmap, changing a pass parameter recomputes the affected outputs and reuses valid upstream checkpoints. Compare output, elapsed time and peak memory with the existing implementation at the same resolution. |

Start with the exporter because a saved scene gives contributors a small, repeatable input. For each area, publish the example and its focused check alongside the interface before inviting a second implementation.
