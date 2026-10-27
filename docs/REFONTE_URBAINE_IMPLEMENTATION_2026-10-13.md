# Native urban redesign — implementation of October 13, 2026

[French original](REFONTE_URBAINE_IMPLEMENTATION_2026-10-13_FR.md).

The redesign now separates footprint, centers and history, street fabrics, computation sectors, blocks and parcels. It runs in Rust/WASM in Terrain Bench and Urban Bench through parcel generation. The existing cultural catalog remains available; the historical TypeScript application retains its independent engine.

## Delivered mechanisms

| Scale | Methods and behavior |
| --- | --- |
| Footprint | Vector foundation, anisotropic accessible growth, accretion along roads, merging cores |
| Families | Circular/oval, rectangular, polygonal, compact, elongated, ribbon, fan, fingers, dendritic, lobed, archipelago, composite |
| Area | Strict population/gross-density budget, or artistic radius budget; explicit shortfall |
| Geography | Local terrain and access costs, water exclusions, retained components and holes |
| Centers | Multiple cores anchoring their networks; explicit service centers for planned components |
| History | Disjoint chronological domains, extensions and merging announced only when components meet |
| Fabrics | Cultural, grid, organic, radial, terraces, branching and groups around a common |
| Interfaces | Shared framework; period boundaries do not become artificial street-generation boundaries |
| Blocks | Recipes and zones selected spatially by phase; phase retained per block |
| Access | Local loop adds public/pedestrian, collective or private passages according to depth, recipe and slope |
| Parcels | Bands, oriented cuts, competing frontage territories, whole domains and gardens |
| Geometry | Coverage, overflow and overlap checks by union, preservation of exclusions |

Family names are presets and guides. Automatic selection combines consistent mechanisms; a manual mechanism override keeps priority. A shape does not automatically dictate fabric or parcels.

### Natural-footprint adjustment

Automatic selection now distinguishes the shape of a cultural enclosure from a geometric foundation. A round or oval enclosure no longer suffices to produce a planned circular city. Cultural orthogonal foundations retain their geometric outline when the site is sufficiently flat and dry; a constrained site uses terrain-adapted growth. An explicit geometric family or planned foundation retains priority.

The geographic diagnostic samples the neighborhood at city scale, with slope, relief and share of available land. Growth combines accessibility, ground slope and deterministic multiscale spatial variation. Ground slope avoids treating a steep hillside as buildable merely because a horizontal route follows it. Organic cores use the same terrain; exclusions are not filled to artificially meet the population budget.

Displayed neighborhoods group sectors by center and dominant phase. They represent morphological generation identities, without claiming at this stage to simulate every historical social or administrative neighborhood.

## Using the benches

In block 6, choose **Footprint and growth**, the budget, family and optionally multiple cores. **Street fabric** and **Access** are configured separately. Groups around a common create collective spaces before parcels. Block 7 refines the same blocks and retains the layout.

Reserve, allocated land, cores/identities, phases and access layers help interpret results. Tables show target area, allocated area, roads and boundaries, reserves/commons, shortfall and accessibility. Rendering does not rerun generation. Rural land and the regional network use the actually allocated footprint.

URLs serialize only applied settings. Old entries without footprint configuration use the historical mechanism and access recipes. Standalone workshops remain available for comparing local operators.

Imported configurations are limited to fields in their contract before generation and before saving. This fixes links where a parcel operator had been retained in neighborhood settings: the Rust engine rejected that field and the city failed to build. The operator remains retained in parcel settings.

## Method choices and cost

The accessibility field is local and bounded to 192², independent of the regional raster. Planned foundations are calibrated by area; organic cores and automatic ribbons use the terrain growth field. Explicitly imposed road bands do not begin with a circular city to distort.

Growth contours are smoothed with bounded displacement, then simplified. A candidate is accepted only if topology, holes, centers and thin arms remain preserved, with area variation and symmetric difference limited to 1%. Water holes remain those of the mask. An exact segment index by ordinate then accelerates phase lookup without changing the radius test; the 30,000-person snapshot retains identical layouts and parcels after this optimization.

Adaptive access is bounded by attempts per block and 96 added accesses per place. The frontage index is reused while streets do not change. An access candidate must respect terrain, avoid water and neighbors, and preserve the parent partition. Rear areas impossible to serve remain explicit.

Competing frontage territories use oriented distance planes. This is a lightweight native alternative to priority strips, not a general straight-skeleton implementation. The engine can choose a different method per land-use program.

The framework reuses field and hierarchical subdivision principles and introduces local access/land co-generation. References are in the [literature review](URBAN_REDESIGN_LITERATURE_2026-10-13.md). No neural city model or new heavy dependency was added.

## Validation and reproduction

The Astra review was conducted by phase and then on native snapshots. It led to corrections to the centers' numeric contract, hidden inactive historical controls, finger/dendrite distinction, real merge events, access not spilling into neighbors, shared index and access diagnostics consistent with exported statuses.

Checks to run from `rust/`:

```powershell
cargo test -p magna-urbis-core urban --lib --release
cargo clippy -p magna-urbis-core -p magna-urbis-wasm --all-targets -- -D warnings
cargo check -p magna-urbis-core -p magna-urbis-wasm --target wasm32-unknown-unknown
cargo run --release -p magna-urbis-core --example urban_refonte -- --repeat --out out/urban-refonte.json
```

From `web/`:

```powershell
npm run typecheck
npx vitest run --project fast tests/urbanRust.bridge.test.ts tests/terrainSettlements.raster.test.ts
npm run build
npm run build:terrain
node scripts/urban_refactor_ui_check.mjs http://localhost:5173/urbanbench.html
node scripts/urban_composition_ui_check.mjs http://localhost:5173/urbanbench.html
node scripts/urban_natural_scenes_check.mjs
node scripts/urban_natural_ui_check.mjs
```

The example corpus supports `--case`, `--population`, `--seed`, `--repeat`, `--out` and `--geometry`. Generated reports and captures remain in ignored directories. Read native and WASM timings alongside each case's population, block/parcel counts and parameters; they do not establish a gain over an engine producing a different level of detail.

### Initial validation, before natural adjustment

- 39 native urban tests pass, as do strict Clippy and WASM compilation.
- Typecheck and eight targeted TypeScript tests pass; the historical application and standalone Terrain/Urban Bench builds compile.
- The corpus's 12 families reproduce exactly the same JSON over two generations.
- Modern and historical browser suites, Terrain Bench startup, parcel isolation, drafts after workshop import and exact replay pass.
- The offline bundle imports a local decor and exactly replays its plan after the file is reattached, with forced worker-free fallback, no page error and no external HTTP request.

| Execution / scene | Population | Parcels | Neighborhoods and access | Parcels |
| --- | ---: | ---: | ---: | ---: |
| Native release, compact/crossing, 70 people/ha | 30,000 | 10,171 | 5.215 s | 1.557 s |
| Native release, rectangle/flat, 70 people/ha | 100,000 | 20,345 | 4.807 s | 2.561 s |
| Chrome, WASM release, rectangle/grid, 160 people/ha | 4,000 | 409 | 42 ms | 61 ms |
| Chrome, WASM release, same decor and grid settings | 30,000 | 3,130 | 763 ms | 828 ms |

These are observed calls on this machine under variable local load, not guaranteed medians. Browser calls include the JSON/WASM boundary and exclude rendering. Native and browser cases use different densities and detail levels: they do not compare the two technologies. The small native corpus, 600–2,500 inhabitants, measures 26–461 ms for neighborhoods/access and 11–299 ms for parcels.

Reports: `rust/out/urban-refonte-smooth-{12,30k,100k}.json`, associated geometries, `web/out/urban-refactor/result.json` and `offline-result.json`. Captures are in `web/out/urban-refactor/`. In the two large native scenes, land without access represents approximately 7.6% and 22.4% of partitioned land respectively; diagnostics retain these explicitly.

### Validation after natural adjustment

The 41 native urban tests and 10 targeted TypeScript tests pass, as do rustfmt, strict Clippy, typecheck and WASM/Terrain/Urban Bench builds. The twelve-family corpus exactly reproduces layouts and parcels. The browser suite preserves mechanisms, disjoint components, seeds, unapplied drafts and parcel-stage isolation.

Five scenes compare an organic plain, an organic curved valley, a Chinese foundation on that valley, a Chinese foundation on a plain and an explicitly planned ellipse in a valley. The two automatic valley cities now follow the curved valley floor. The Chinese grid on a plain and explicit ellipse retain exactly their previous geometries. Captures were inspected and then reviewed by Astra, with no remaining blocking problem identified. The edge retains slight raster-derived aliasing.

The reported `d085-hills-coast-E-city` link, with 12,000 inhabitants, generates 177 blocks and 1,773 parcels without error and with exact replay. The link camera is retained until the decor loads. Allocated land is 1,599,197 m² for a 1,600,000 m² target; the silhouette improvement therefore does not come from a large reduction in footprint.

| Execution / scene | Population | Parcels | Neighborhoods and access | Parcels |
| --- | ---: | ---: | ---: | ---: |
| Chrome, WASM release, reported hilly coastal site, 75 people/ha | 12,000 | 1,773 | 1.695 s | 0.624 s |
| Native release, compact/crossing, 70 people/ha | 30,000 | 11,552 | 4.312 s | 1.728 s |

These remain observed calls, without guaranteed median or acceleration claim. The native scene's parcel count changed with its footprint; initial-validation timings are not a constant-geometry comparison. The twelve small scenes measure 37–338 ms for neighborhoods and 7–122 ms for parcels.

Current reports: `rust/out/urban-natural-12.json`, `urban-natural-30k.json`, `web/out/urban-natural/after-result.json` and `scenes-after/result.json`. Captures and before/after geometries are in `web/out/urban-natural/`.

## Explicit limitations

Delivered history is a lightweight footprint chronology; it does not yet simulate economy, successive cadastral changes or every kind of trace of old walls. Buildings remain deferred.

Water used by urban stages remains that of the settlements raster, up to 512². Smoothing a coarse regional mask does not recover a small canal. Slope checks are exact on the transmitted interpolated surface, not on unknown finer terrain.

Reserves and unserved rear areas can remain significant on constrained terrain and in some fabrics. Diagnostics show them without assigning fictional housing capacity. Densities are planning budgets, not a measure of constructed housing.
