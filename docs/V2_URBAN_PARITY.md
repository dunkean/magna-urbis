# V2 urban controls: City Bench inventory and implementation

Local review alpha, 28 October 2026. This document distinguishes **parameter access**, **native execution**, and **specialist bench tools**. Exposing a parameter does not certify every combination of source, culture, terrain and historical policy.

## Authoritative inventory

The V2 city inspector reads the native [urban catalogue](../rust/crates/core/src/urban/catalogue.json), not a separate small set of V2 aliases. At this revision it contains **79 cultures, 443 morphology presets, 26 street/layout morphology fields and 10 parcel morphology fields**. Tuple endpoints, street ranks and growth-zone ranges are individual numeric fields. The generated scalar schema currently contains **222 fields**, before repeatable phase rules, house mixtures, site rules and outline vertices.

The sources of truth are:

- [urbanConfig.ts](../rust/bridge/urbanConfig.ts): `LayoutConfig`, `FootprintConfig`, `ProgrammeContext`, `ParcelConfig`, phase rules, quarter/parcel overrides and native normalisation.
- [urbanArchitecture.ts](../rust/bridge/urbanArchitecture.ts): `PlacementBatchSettings`, `HouseSettings`, per-lot placement constraints and retained architectural plans.
- [housesContract.ts](../rust/bridge/housesContract.ts) and [houses.ts](../rust/bridge/houses.ts): native source models, overrides, workshop presets and default house settings.
- [terrainUrban.ts](../web/src/ui/terrainUrban.ts), [urbanMainPanel.ts](../web/src/ui/urbanMainPanel.ts), [urbanBuildingsPanel.ts](../web/src/ui/urbanBuildingsPanel.ts): existing City Bench controls and stage behaviour.
- [urbanControlSchema.ts](../web/src/v2/urbanControlSchema.ts), [urbanControls.ts](../web/src/v2/urbanControls.ts): V2 structured controls, inheritance and scoped writes.

## Parameter parity

| Native family | V2 controls and scope | Execution / persistence |
| --- | --- | --- |
| Settlement layout | Culture, preset, recipe, growth zone, density, composition, settlement form, district count, rings, radius, radius multiplier, placement, monument reserve, site adaptation | Global and settlement overrides merge into the real `LayoutConfig`; native plan retained. |
| Spatial footprint | Mechanism, family, population/radius budget, gross density, aspect, orientation, nuclei, irregularity, anisotropy, separation, epochs, cohesion, satellites, branches and gaps | Real `footprint` object reaches native layout generation. `planned` is not shown as a distinct mechanism because the shared normaliser maps it to `auto`. |
| Growth / mixtures | Cultural influence, phase/sector distribution, share, angle, suburbs, phases; culture, tissue and recipe for all five growth zones | Native `phaseOverrides`; inherited values remain explicit in the inspector. |
| Streets and access | Tissue, axis alignment, exits, peripheral road, access mode/depth/budget, street/lane/stair grades, stairs, high-ground power, parallel-street merging, regular outline | Grades are displayed in percent and stored as m/m. All 26 consumed morphology fields are derived from the native catalogue, including ranges per zone and widths per rank. |
| Fortifications | Cultural/open/wall/palisade selection, all ten styles, stiffness, terrain adaptation, tower spacing, ditch wetness, old citadel, medieval policy, dry ditches and gate villages | Native admission and historical construction policies remain authoritative. Derived wall/gate/tower geometry is not presented as an independent generator parameter. |
| Waterfront and ports | Riverbank defence/chain, port enclosure, sheltered harbour, detachment, shelter preference, site archetype and rules by settlement identifier | Full native settings; actual water/shore/access constraints still determine feasibility. |
| Programme | Isolated and settlement roles, six independent function weights (0–1), resources, period, historical policy, navigable access, lore, condition and decay | Native programme/allocation step is separate from construction. After construction, `builtCapacity` reconciles evidence from the retained plans. Unknown actual household capacity remains unknown. |
| Cadastre | Preset/culture/recipe/zone/density, all ten parcel operators, street alignment, denser smallholdings, operator per growth zone; all ten native parcel morphology fields | Retains layout; passes actual `ParcelConfig` to the cadastral stage. |
| Architectural placement | Culture, lot fitting, floors and typology | Real `PlacementBatchSettings`; source and site refusals remain visible. |
| Mixed architecture | Weighted cultures with lot/block/quarter spread, at city, growth-zone and selected-quarter levels | Native `HouseSettings`; no relabelling of an incompatible recipe. |
| House model | Pack, recipe, historical mode, era, late traditions, size, variation, wealth; variant, footprint, roof, frame, infill, coating, cladding, floors, bodies, courtyard ratio, eaves, pitch and source slope | Explicit pinned template globally/per settlement; individual building patch uses its exact native request id. Native catalogue suggestions load on demand, with visible loading/error state. |
| Free workshop | Preset, footprint, roof, exact width/depth, roof frame, base, support kind/material/height range | Full native workshop request. Native fantasy-policy requirements and source constraints are retained. |
| Selected quarter | Culture, tissue, density, role, wealth, deletion and regeneration salt; outer boundary and holes | Writes `layout.overrides.quarters[id]` for this settlement only. Coordinates are editable as vertices in metres. |
| Selected parcel | Role, function, requested model households, garden/merge deletion, salt; outer boundary and holes | Writes `parcels.overrides.parcels[id]`; native cadastral and programme validators decide admissibility. |
| Selected building | All source model and workshop fields above, plus house seed | Writes `urban.buildings[settlement/requestId]`; the existing canonical delta path regenerates the affected native request and retains neighbours. |

Empty fields inherit; reset removes the local override. An explicit native `null` remains distinct from inheritance. Editing one range endpoint copies the effective other endpoint and sends a complete native tuple, never a sparse array. Named native identifiers are stored as literal keys even when they contain `/` or `.`. Technical identifiers and user-supplied values are not translated; captions and policy choices are English by default with live French switching.

Urban placement owns **one request per lot, its transform and the batch seed**. Batch house `count` and `orientation_deg` would be ignored by native placement, so they are explained rather than exposed as misleading city controls. A selected house has a genuine independent seed. A pinned architectural template has an explicit pack: domestic lots of a different pack may be refused, as in City Bench.

## Retained rendering and execution

[rustUrban.ts](../web/src/v2/rustUrban.ts) sends the merged configurations to the existing Rust bridge. Layout, parcel, programme, request and house fingerprints retain reusable products. `capacityKey` associates reconciled built-programme evidence with the exact scene. Terrain is reused between urban stages. Per-house edits keep the native source baseline and binding neighbour occupations; they do not rerun terrain, layout or cadastral subdivision.

[urban3d.ts](../web/src/v2/urban3d.ts) mounts the **same City Bench 3D renderer** inside V2. It supplies the actual physical raster, native layouts, partitions, regional streets, fortifications and retained house scenes. It preserves compressed native plan archives. Close-up exteriors use the existing bounded detail controller and the V2-selected WASM/native runtime. Rendering is not a new admission or a source of capacity certification. The 3D view uses WebGL2; native urban construction itself uses CPU, while terrain generation can use its supported CPU/GPU paths.

The [urban optimisation audit](V2_OPTIMIZATION_URBAN.md) records measured cache/projection/form/3D work reductions, exact-output checks and the remaining software-driver shader compilation limit.

## Boundaries still visible in this alpha

- Parameter parity does not yet mean every specialist City Bench workspace is reproduced. Native parent/archive NDJSON ingestion, cold paged city stores and experimental parent-assembly sessions remain specialist bench workflows; V2 currently retains regular native city snapshots in its project format.
- Outline overrides have structured coordinate/vertex controls. The existing bench's direct drag-to-reshape tool is not yet mounted in the V2 map.
- The V2 3D architecture adapter displays retained Rust city scenes. The legacy TypeScript pipeline keeps its own 2D urban representation; switching to the native city pipeline provides native 3D plans.
- Source availability and historical/functional coverage are the native catalogue's claims with their provenance and limits, not a promise of a building for every lot or every named monument. A reserved monument area is not a generated interior.
- The existing full-scene and project transport budgets remain enforced. The alpha does not claim the specialist cold-store performance envelope for unbounded cities.

## Validation

[v2UrbanControls.test.ts](../web/tests/v2UrbanControls.test.ts) checks coverage against every native default leaf and native morphology field, parity with shared house defaults, exact range edits, inherited/native-null semantics, settlement/id isolation, unchanged transport into the real native configuration normalisers, and English/French captions without translating identifiers or numeric counters.

[v2_rust_browser_check.mjs](../web/scripts/v2_rust_browser_check.mjs) drives actual structured controls in the local V2 app and verifies the generated snapshots: real stage stops; advanced layout values; selected quarter/parcel edits; global/local/house floor priority; one-house changes with neighbours retained; native rejection and retry; and snapshot-free recipe reconstruction. Built-programme evidence may change after houses; the test compares the retained cadastral geometry separately from that evidence. Its artifacts are written under `web/out/v2-rust-browser/` for local review.

No publication or deployment is implied by these checks. The V1 remains separate and the alpha stays in local review.
