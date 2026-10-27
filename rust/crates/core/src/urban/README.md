# Neighborhoods and parcels in Terrain Bench

[Français](README_FR.md)

## Dispersion and gaps — October 20, 2026

Under **Neighborhoods → Complete settlement → Dispersion and gaps**, four settings complement natural shapes independently of the street fabric:

| Setting | Effect | New scene |
|---|---|---|
| Cohesion | Lower values leave more open land at the edge; 1 removes these gaps | 0.85 |
| Satellite tendency | Favors up to three secondary cores on dry, gently sloping, accessible sites | 0.15 |
| Branch depth | Extends guide corridors and strengthens growth near them | 0.20 |
| Gap size | Spatial scale of open spaces in meters (10–500) | 60 m |

Propagation can cross a cell without allocating it to the city. Gaps follow a deterministic spatial field and terrain cost; the core stays more continuous and small holes below useful resolution are avoided. Gap scale is at least three growth-field cells. Significant pockets are retained with a ground-routed connection, optionally using stairs where allowed. This connection crosses open land without converting it into a neighborhood. Fragments and new pockets that cannot be served are discarded; their area is missing from the budget, with the usual shortfall diagnostic. Explicit cores separated by water remain, without automatically creating a bridge.

Initial values remain moderate. For a stronger effect: cohesion 0.6, satellites 0.5, branches 0.6 and gaps 100 m. Settings are retained in links, decors and workshops; drafts do not replace applied values. Old links without these fields retain 1 / 0 / 0 and their previous growth. Explicitly imposed geometric foundations and vector strips retain their behavior. This is bounded procedural growth, not an economic simulation or complete urban history; dendritic guides remain suggestions of form.

Targeted checks: `cargo test -p magna-urbis-core --lib urban::footprint`, `npx vitest run --project fast tests/urbanRust.bridge.test.ts` and `node scripts/urban_sparse_ui_check.mjs` from `web/` for the last two. Validation recorded 57 native urban and 7 bridge tests passing; browser check without error, exact replay and preservation of the plan during parcel recomputation. Strict Clippy, WASM compilation, typecheck and builds passed.

## October 13, 2026 redesign

New plans use a native footprint independent of street fabric. **Footprint and growth** offers twelve families and four mechanisms: planned foundation, accessibility-driven growth, network accretion and core merging. Automatic choice evaluates culture, terrain and access; a manual override retains mechanism priority. The demographic budget is population / gross density in inhabitants per hectare. The artistic budget uses radius and its scale. Radius does not act in the demographic budget.

`footprint.rs` uses area-calibrated vector templates for planned foundations and strips for explicitly imposed ribbons on compatible terrain. Accessible growth, organic cores and automatic ribbons use a local anisotropic arrival field bounded at 192². Cost combines ground slope, route slope, access and multiscale spatial noise. An oval cultural enclosure no longer forces a circular foundation; automatic orthogonal foundations require a sufficiently flat, dry site. Explicit geometric choices remain available. Fingers and dendrites have different corridors. All components and water exclusions are retained; an infeasible footprint reports its shortfall.

The layout exports `structure`: growth reserve, allocated land, service centers, neighborhood identities, events and budgets. Calculation sectors follow the shared framework; they are not artificially cut at age boundaries. Recipes and zones are evaluated spatially during subdivision; each block retains its local phase. Composite form can combine an organic core with a grid extension.

**Adaptive access** adds local access when a block exceeds its recipe's land depth. Attempts are bounded per block and at 96 accesses per place. The corridor must remain on parent land, avoid water and neighboring blocks, and respect slope. The **Groups around a common** fabric creates actual shared courtyards at this stage. Recomputing parcels retains these accesses, commons and streets.

Parceling offers cultural recipes, strips, oriented subdivision, competing frontage territories, domains, whole blocks and gardens. Competition uses distance planes oriented from frontages; it is not a CGAL straight skeleton. Public, collective and private access are identified against the final network. Diagnostics check coverage and overlap through geometric union in addition to area sums.

**Reserve**, **Allocated land**, **Centers and identities**, **Access** and **Growth phases** layers do not rerun the engine. Rural occupation and regional-network substitution use allocated land. Old links without `footprint` remain in **Legacy** mode; only applied settings are shared.

Native corpus: `cargo run --release -p magna-urbis-core --example urban_refonte -- --repeat --out out/urban-refonte.json`. Options `--case`, `--population`, `--seed` and `--geometry` allow replay and measurements on fixed inputs. Browser: `node scripts/urban_refactor_ui_check.mjs http://localhost:5173/urbanbench.html` from `web/`. To compare footprints on plain and valley: `node scripts/urban_natural_scenes_check.mjs`. Replay of the reported site uses `node scripts/urban_natural_ui_check.mjs` and its local decor.

See the [implementation note](../../../../../docs/REFONTE_URBAINE_IMPLEMENTATION_2026-10-13.md) for validation and limits. History remains a light chronology of footprints and mergers; houses and a complete economic simulation remain independent stages. Water precision still depends on the terrain-provided raster, up to 512².

Stage **6 · Neighborhoods and blocks**, then stage **7 · Parcels**, use `crates/core/src/urban/` exclusively in Rust/WASM. TypeScript transports inputs, presents controls and draws results. These structures are a temporary bench contract, not the engine's permanent model.

Selection offers **All**, then all settlements by decreasing population. The largest is selected at first startup. Seeds are independent by stage and settlement key: selecting a place alone or in All does not change its draws. Neighborhoods use already calculated physical terrain, water/rock mask and regional roads. The mask is the settlement raster, up to 512², so water boundaries remain limited by that resolution. Synthetic river and terrain settings from the old bench are replaced by terrain and hydrology stages.

Each stage has its own culture, recipe, zone, density, preset, native settings and JSON overrides. Recipes come from the resolved TypeScript catalogue, carried as versioned data in `urban/catalogue.json`. Their application, density, overrides and geometric operations are native. `rust/scripts/export-urban-catalogue.ts` refreshes the data: from the root, `node web/node_modules/tsx/dist/cli.mjs rust/scripts/export-urban-catalogue.ts`.

The plan starts with regional corridors and dry land. Cultural axes are then routed and neighborhoods subdivided: organic streets, grids, terraces, dead ends/closes/hutong/roji. Rectangle, oblique and notched layouts remain available as work scenes. The catalogue contains 53 cultures and 326 presets; profiles retain the cultural documents' orientations, enclosures and growth logic.

Slope limits are separate: streets 12%, lanes 18%, stairs 65% by default. These are visual generator settings, not construction standards. Each segment is checked on bilinear terrain, including ridges between endpoints. Detours use local search with slope and turn costs; only existing regional crossings may cross water. Stairs are explicitly identified and drawn. Intersections are shared nodes; isolated fragments are removed.

Fortification is independent of street style: cultural, absent, wall or palisade. Gates follow actual crossings. Open cities extend farther along approaches, with open cells between extensions and a core → outskirts progression of parameters. These cells remain available for rural use. Quays follow dry shores and join the network; this is not yet a complete harbor-basin, pier or navigation generator. A monument reserve retains an open block; it does not build a monument.

Parcels include frontage strips (burgage/machiya), courtyard/compound subdivision, siheyuan refinement and gardens. Their axes, frontages and backland stay explicit. Boolean operations retain holes and parcels partition their blocks. Squares and reserves are not recut. Recomputing parcels retains neighborhoods, blocks and streets. Rendering controls trigger no calculation. Links retain applied settings, seeds, selection and rendering; unapplied changes do not alter replay.

In Terrain Bench, **Auto** applies urban menus after a short pause without recalculating terrain or water. With Auto disabled, a message reports pending changes; stage buttons or the general **Generate** button apply them. Urban Bench retains its apply buttons. Changing culture returns to cultural recipes and removes the previous forced preset. The **Generation** menu stays visible: isolated sectors retain their scene contour even with organic fabric.

An exported decor passes **applied** urban settings, seeds and targeted settlement to Urban Bench. Without its own urban parameters in the link, Urban Bench uses that configuration instead of defaults. Stages are enabled there for working on catalogue decors exported without city generation. An explicit Urban Bench link takes priority over the decor, including road settings. Reattaching the same file also retains current road settings. **Open Terrain Bench** carries current urban and road settings, selection and disabled-road state when roads are removed. With identical terrain, city, roads, options and seeds, both benches produce the same streets, blocks and parcels.

Changing style also restores regional roads when SVG rendering rebuilds layers. Both benches' Fantasy styles use the same mask: native allocated land with holes retained and regional approaches replaced by urban roads. Smoothing preserves small-neighborhood area and locally repairs protected cells without restoring the entire stair-step contour. Check: `node scripts/urban_styles_ui_check.mjs` (Terrain SVG/WebGL styles, Urban styles and five road renderings).

A spatial index accelerates frontage lookup without changing selection. Deep residential parcels are bounded by their cultural depth; inaccessible backland remains garden, even in a large block that terrain prevents subdividing. A block without retained frontage does not produce fictitiously accessible residential parcels.

The worker retains Rust terrain between calls. A browser refusing workers uses the same WASM calls on the page. A terrain, settlement or road change invalidates dependent neighborhoods. Stale responses do not replace current generation.

Checks from `rust/`: `cargo test -p magna-urbis-core urban --lib`, `cargo clippy -p magna-urbis-core -p magna-urbis-wasm --all-targets -- -D warnings`, `cargo check -p magna-urbis-core -p magna-urbis-wasm --target wasm32-unknown-unknown`. From `web/`: `npm run typecheck`, `npm run build`, `npm run build:terrain`. The shared browser check runs from `web/` with `node scripts/urban_workshop_ui_check.mjs http://localhost:5173/urbanbench.html path/to/map.decor`. It checks isolated scenes, exact replay, plan import and return to the map. A `file:///.../rust/out/browser/urbanbench.html` URL checks the same offline flow, with `testbench.html` in the same directory. `node scripts/urban_composition_ui_check.mjs http://localhost:5173/urbanbench.html` checks on a frozen flat intersection the clustered village with suburbs, town phases, enclosures, unapplied settings and exact replay. Captures and `.decor` file are written to `web/out/urban-composition/`.

During October 13 validation, the frontage index alone was measured on six fixed layouts: 1.20× to 11.72× faster, 4.72× on the sum of medians, with bit-identical outputs. This isolates the index before morphology and depth changes; it does not measure an overall gain on different cities. Frozen inputs, captures and measurements from that session are in `web/out/urban-audit-frozen/` (ignored local outputs).

## Urban Bench

The default mode is **Complete settlement**. The plan first composes the place from population, culture and access: hamlet, street village, clustered village or town. The core has its cultural phases (core, extensions and outskirts); suburbs occupy strips along actually connected approaches. Population shares, densities, phase thresholds, village recipes and recipe changes for cultures becoming towns come from the TypeScript generator via the versioned catalogue. **Place shape**, **Suburbs** and **Core phases** allow composition comparisons. Enclosures remain around the core. **Remove enclosure**, on the map or in the workshop, immediately recomputes the open plan using applied seeds and settings. Other pending settings remain drafts. The **No enclosure** menu option can also be applied with neighborhood generation; hiding enclosure rendering changes no geometry.

Neighborhoods and blocks inherit their phase; **Recipes · By phase** passes that recipe to streets and parcels. An explicit recipe or preset can force a common morphology. The **Growth phases** palette and composition table distinguish core and suburbs, with planned population and obtained dry area. Population is a composition budget, not measured housing capacity (houses remain an independent stage). The supplied radius is an indicative footprint divided among phases; suburbs can extend beyond it. **Center** frames the completed plan.

**Single sector · legacy bench** retains one-recipe scenes, rectangles, oblique layouts and notches. The workshop uses this mode for isolated scenes and retains composition of the plan imported from the map. Old links without `composition` open in isolated mode to preserve replay; a new link includes all applied settings.

This stage restores complete-settlement composition to evaluate neighborhoods and blocks in context. Local routing and subdivision remain the existing native operators; it adds neither houses nor a monument generator.

`web/src/ui/urbanbench.html` (`http://localhost:5173/urbanbench.html` with `npm run dev:terrain`) prototypes the same stages 6 and 7 without the terrain → water → settlements → roads pipeline. It loads **decors**: the exact raster passed to Rust by Terrain Bench, settlements, roads and vector water from a map, in `.decor` format (`web/src/ui/decor.ts`).

- Export the current map: **Export decor** in the Settlements stage.
- Export a varied batch (terrain, coasts, rivers, roads, sizes, cultures): `node scripts/export_decors.mjs [--count 100] [--force]` from `web/`, with the development server running. Files go to `web/decors/` (ignored by Git) with `index.json`; `--index` rebuilds the index after manual removal.
- City seed: a decor place (same roads, seed and neighborhoods as Terrain Bench) or a free seed placed on the map (P), with population, culture and radius. Regional roads can be recomputed with the seed.
- The offline-built bench (`npm run build:terrain`) opens or receives `.decor` files by drag and drop.
- **Neighborhood / parcel workshop** opens the historical editor with the same Rust calls as the map. It supports isolated scenes, reference parcel shapes and import of the exact plan displayed on the map. Recomputing parcels retains blocks; **Apply settings to map** transfers settings. The link stores both spaces. The workshop alone opens at `urbanbench.html?space=workshop`; `testbench.html?engine=rust` redirects there. The original TypeScript testbench remains independent of Rust.
- **8 · Land use** reuses `gen/landuse/rural.ts` and the TypeScript application's Canvas 2D rendering: fields and furrows, hedges, farm tracks, orchards, gardens, meadows, woods and marshes. Decor terrain, water levels and roads feed a temporary adapter (`ui/urbanLanduseData.ts`). Neighborhoods reserve their exact footprint even without houses; other decor places retain projected reserves. Farm buildings also await house integration. Calculation runs in a Worker with local fallback. Moving the city or regenerating neighborhoods recomputes landscapes; changing parcels, style, textures or opacity retains geometry. Biome, seed and display are saved in the link. **Land use** hides the layer. The **Generate land use** checkbox in stage 8 also disables calculations, including ongoing ones; its state is saved in the link. Rust rendering and the native urban model are unchanged.

  Canvas follows the SVG camera using TypeScript-engine LODs and caches. Retained terrain is the background for color blending. **Foliage and canopy** replaces circles with irregular, shaded crowns that join in forest and align in orchards; **Classic symbols** allows comparison. Painted textures remain available. Foliage patterns are vector, deterministic and shared with SVG export. Trees are placed individually with minimum spacing and subtle shades, without a repeating tile. Their centers belong to the wooded area; crowns remain whole and may extend outside its boundary. Orchards retain rows. Furrows use the city's TypeScript preset scale independently of loaded decor width.

Regional paths are retained outside neighborhoods and replaced by the native graph inside, for both display and rural costs. A physically impassable approach produces an explicit warning.

Method references: Galin et al., [*Procedural Generation of Roads* (2010)](https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf); Chen et al., [*Interactive Procedural Street Modeling* (2008)](https://peterwonka.net/Publications/pdfs/2008.SG.Chen.InteractiveProceduralStreetModeling.pdf). The solver remains a bounded local approximation for interactive generation.

## Influences, exits and site adaptation

Stage 6 offers a second culture, its area share and two distributions: `mixMode=phases` assigns newer extensions to that influence; `mixMode=sectors` divides land by an orientable axis (`mixAngle`). Shares remain disjoint and preserve population budgets. Each phase carries its culture and recipe, reused by streets and parcels in “By phase” mode. Explicitly forced recipes, fabrics or operators retain priority. Shared axes cross cultural boundaries.

`exitTreatment=adaptive` handles peripheral ends before parcel subdivision: connection to a nearby regional axis, circumferential sections, a few narrower rural paths, or withdrawal into the block to close access with parcel land. `closed` retains only dead ends and existing regional approaches. `peripheralRoad` selects none, automatic choice, partial sections or a complete circuit when slopes and water permit. Each section joins two actual accesses; an obstacle leaves a break rather than an invented crossing. An enclosure retains wall-and-gate handling.

`siteAdaptation` (0–2, default 1) strengthens local following of contours and shores, including for grids. Axes generated on slopes compare detours with the direct route even when it respects maximum grade; simplification retains the detour's benefit. Imported regional roads and bridges retain their paths. Old Legacy-mode links without these fields retain previous behavior; modern plans receive new defaults.

Targeted validation: `cargo test -p magna-urbis-core urban --lib`, usual Clippy/WASM checks, and from `web/`: `node scripts/urban_influences_ui_check.mjs` (plain), then `node scripts/urban_influences_ui_check.mjs http://127.0.0.1:5173/urbanbench.html --terrain` (slope and river). These also check unapplied drafts and exact replay. Captures remain in `web/out/urban-influences*/`.

`axisAlignment=regional` (new default) aligns the foundation, major axes and local street field with the tangent of incoming major regional roads. Rank, width and proximity prioritize major axes over tracks; artificial footprint guides do not drive this selection. Terrain and shores then adapt the alignment. The `culture` choice and explicit orientation overrides retain priority. The browser check also accepts `--aligned` for a principal axis at 27°.

The panel keeps shape, growth, fabric and accessibility visible. Regeneration is at the top; seeds, recipes, diagnostics and fine settings remain in collapsed sections. Drafts retain their scope.

Regional roads crossing the core are the place's framework: cultural axes no longer duplicate those branches and extend only missing directions, with their tangent and width. Accessible growth favors dry shores according to cultural affinities; accretion shifts its land budget toward water without moving roads or building on water.

Width transitions are handled before reserving streets in blocks. Drawing uses the same tapered strips as Rust. Peripheral roads now border allocated land and reuse nearby parallel corridors. A road at the foot of the inner enclosure often appears; other draws let parcels reach the wall. Impassable terrain or slopes interrupt this road without inventing a crossing. The reported Swahili case is checked by `node scripts/urban_junctions_ui_check.mjs`.

Planned growth is no longer offered in the panel; old links fall back to automatic mode. Explicit square, rectangular, polygonal and circular forms remain available. A square cultural enclosure retains its straight foundation; an open city regains natural growth.

Open cities can add small parcel strips beyond some peripheral-road sections, directly served by that road without new outgoing streets. Their extra area remains limited to 8% of the initial footprint; population budgets and cultural shares are preserved. Up to three local connections seek a regional axis within 360 m, with reduced width in the middle and transitions at junctions.

Both benches pass the same vector land and water contours to the urban engine. New decors retain these contours and terrain up to 1024²; old ones reconstruct the coast from signed elevations and reuse saved vector water. This removes cell-shaped cuts without inventing details absent from old exports. Street strips use `nonzero` fill to avoid holes at overlapping junctions.

Worker results are immutable snapshots: SVG path and road-cut caches are invalidated by replacing the plan, not by its display settings. The worker retains the last plan JSON and accepts its response identifier for parcel requests. A terrain change or new generation invalidates that identifier; the workerless fallback supplies the complete plan. `JSON.parse`/`JSON.stringify` stays identical to the historical path to preserve the same Rust input numbers and cuts.

Reproducible measurements from `web/`, with an active Vite server and Chrome:

```sh
node scripts/generation_perf.mjs http://localhost:5173/urbanbench.html out/perf.json
node scripts/generation_perf.mjs http://localhost:5173/urbanbench.html out/perf-after.json out/perf.json
npx tsx scripts/ts_generation_perf.ts 3
node scripts/ts_generation_browser_perf.mjs http://localhost:5173
```

The first check measures three native browser scenes, worker transfer, rendering completion and palette changes. It compares complete geometries and SVG (attribute order normalized). Compare WASM builds with the same profile on the same machine; times are not test thresholds. The last script also accepts a reference TypeScript module URL and report path to alternate before/after measurements. The existing native corpus `urban_refonte --geometry` exports complete inputs and outputs for byte-equality checks, including coasts, rivers and relief. With `TS_PERF_APP=town` or `city`, the browser TypeScript script measures generation of the whole application; the reference module must then export `generate`. `World` comparison excludes only duration diagnostics. `TS_PERF_RUNS` sets the number of measured runs after a warmup run.
