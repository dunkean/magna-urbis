# House engine and bench

[Français](README_FR.md)

The Rust engine produces houses and domestic compounds from the project's architectural catalogue. It is independent of terrain, browser and rendering. The web bench uses a temporary SVG adapter; its model is not imposed on the engine.

The catalogue explicitly maps recipes to the 32 packs and to entries in [architectural styles](../../../docs/styles_architecturaux_mondiaux_city_mapper.md) and the [settlement catalogue](../../../docs/catalogue_settlements_antiquite_moyen_age_rpg.md). `data/source-inventory.json` retains their texts and fingerprints; `data/recipes.json` comes from the `../../scripts/house-recipes.py` mapping, with no runtime keyword inference. Recipe counts and coverage statuses describe this catalogue; they do not prove generation for every configuration. Physical constraints or engine budgets can still reject a recipe; the bench displays the error.

This checkpoint remains a prototype under validation. Public access for GreatHouse and Himalayan Compound, and final native/WASM/browser QA after their correction, remain unfinished. Medieval lean-tos have been checked in varied batches and the web bench. Some complex compounds exceed a batch's geometry budget; the refusal is explicit. Functional mappings connect companion-catalogue uses to available morphotypes.

## Open the bench

Install the toolchain in `rust/rust-toolchain.toml`, the `wasm32-unknown-unknown` target, `wasm-pack` and the npm dependencies in `web/`. From `web/`:

```sh
npm run dev:houses
# http://localhost:5173/housebench.html
npm run build:houses
# ../rust/out/houses/housebench.html
npm run check:houses
```

`dev:houses` compiles WASM and then watches house sources. `build:houses` produces a standalone page containing JavaScript and WASM, openable offline in a modern browser. Packages and outputs are ignored in `rust/pkg/houses/` and `rust/out/houses/`. Ordinary `npm run dev`, `npm run typecheck` and `npm run build` remain independent of Rust and the generated package.

## Generate and inspect houses

The bench starts with seed `42` and a requested batch of ten units. Choose a pack, optionally a specific recipe, then **Generate houses**. Changing settings starts native preflight: it reports admissible recipes and estimated budgets without promising that every geometry stage will succeed. On error, the last successful batch remains displayed; its settings are retained for exports.

The seed is a UTF-8 string. With identical engine and catalogue versions, the same settings produce the same scene. Size adjusts dimensions; variation and wealth modulate recipe-specific ranges. Wealth is a composition bias, not an economic model. Orientation rotates the scene clockwise; distances remain in meters.

Advanced settings offer three modes: **strict historical**, **historically inspired** and **fantasy**. The first retains dimensions and assemblies permitted by the source. The second allows limited adaptation. Fantasy permits freer combinations while retaining geometry, access and budget constraints. Chronological filters **A**, **M** and **All** follow the periods declared by each recipe. **Allow late variants (L)** is incompatible with strict mode; a long-lived tradition does not constitute a universal date.

With a specific recipe, **Variant** selects its main bundle or a declared variant. Other advanced options override plan, roof, materials, floors, number of bodies, courtyard, pitch or overhang. An empty value uses the recipe; **Plaster → None** explicitly requests no plaster. Overrides may be rejected outside the recipe's allowed ranges.

A unit can contain multiple main bodies, annexes and galleries. **Bodies** counts main bodies: the displayed total can be higher after annexes are added. Available levels come from the Rust scene; they are not inferred solely from the requested floor count. Some bodies occupy only part of the compound's levels.

**Roofs** and **Plan** views share a metric scale for comparing cards. Selecting a level displays its floors, rooms, walls, openings and access. Graph and dimensions help interpretation. Clicking a card opens its detail, where the view can be changed and the drawing zoomed or panned. Roof edges come from the Rust mesh; the UI does not regenerate geometry.

**Explore catalogue** shows recipes, provenance and shape/function coverage statuses. The **Pack tour** attempts each pack in turn with the current general settings; it resets the recipe and overrides. Its report distinguishes successes from native errors. Stopping the tour takes effect between packs. Clicking a success reruns that pack; the table is not a cache of all scenes.

## Free workshop

**Path → Free workshop** opens experimental presets separate from sourced traditions: twenty FP plan primitives and twenty-two RF roof systems each have a declared preset with compatible footprint and materials. Their metadata declares `stylized` confidence, with no assigned chronology or cultural provenance. Catalogue presence does not guarantee every possible substitution.

Choose a preset, then **Generate houses**. Width and depth are absolute dimensions in meters; an empty value uses the preset. The Size slider and historical filters are disabled. A dimension that is too narrow is refused without silent enlargement. Seed, variation, wealth, orientation and count remain available; explicitly imposed dimensions stay fixed.

Advanced options change FP/RF, roof carrier, base material and supports. Posts, piers or raft require a suitable supporting material and height. The body count applies to multicell primitives and round groups; other primitives may reject that substitution. Physical constraints remain active. Metrics, native levels and exports work as in the Atlas. Replay restores the path and preset; switching back retains Atlas settings. The tour remains limited to the 32 sourced traditions.

In the Atlas, **Plan** changes the primitive where the recipe's organization allows it. Fixed-organization compounds refuse a substitution that could not be applied; the workshop allows inspection of the isolated primitive without using a cultural recipe as an intermediary.

## Replay and export

**Link** encodes successful settings and the view in the URL. The engine reports a different generator version on replay. A seed too long for a link remains exportable as JSON; the UI disables the link and shows the limit. JSON contains the full scene, settings and schema, generator and catalogue versions. The bench does not offer JSON scene import; for native generation, use its `settings` object as a configuration file.

**SVG** exports the displayed sheet or detail, with patterns and definitions embedded. The file does not depend on remote images or fonts. JSON also retains structures invisible in the chosen view. The standalone HTML build works without a server. Generation runs in a Worker; without Workers, the bench reports a main-thread fallback and limits batches to ten units.

## Sources and limitations

Recipes are parametric interpretations for RPG mapping, not archaeological surveys or certified reconstructions. Dimensions, distributions and assembly rules include explicit heuristics. Detail shows available provenance and confidence; catalogue statuses and generation errors must be read with these limits. Recipe compatibility does not prove coverage of every seed, variant or settings combination.

## Native use and checks

From `rust/`:

```sh
cargo run -p magna-urbis-houses --example houses -- --input fixtures/houses/config-reference.json
cargo run -p magna-urbis-houses --example houses -- --audit
cargo run -p magna-urbis-houses --example houses -- --audit-variants
cargo run -p magna-urbis-houses --example houses -- --audit-batches
python scripts/house-source.py --check
python scripts/house-recipes.py --check
```

The example writes the JSON scene to stdout and errors to stderr. The audits respectively attempt recipes, their variants and batches of ten; a failure produces a nonzero exit code and a JSON report. They do not replace visual inspection. `npm run check:houses` checks formatting, Clippy, WASM compilation, native tests and the TypeScript contract.

Native API: `preflight(HouseConfig)` and `generate_batch(HouseConfig)` return a `Result`. The scene schema is versioned (`schema_version: "2"`). Local coordinates are meters, with x rightward, y downward and z as height. Initial dimensions and footprints use a millimeter grid; derived intersections and roof junctions retain their precision so their edges are exactly shared.

### External urban placement

`placement::admissibility_profiles()` exposes recipe envelopes without interiors. `placement::place_batch(PlacementBatchRequest)` receives cadastre, buildable domain, holes/reserves, roof rights, access, neighborhood, culture/function, physical terrain and seeds. It returns native volumes and roofs or inspectable refusals; open spaces remain free. `resolve_architecture` retains the same settings and `LayoutPlan` as the standalone generator. `placement::enrich_placement` details this retained copy without new random draws, or explicitly rejects an incompatibility. Non-domestic volumes carry their function and do not claim domestic interiors. See the [method and limitations](../../../docs/methods/urban-architecture-placement.md) and [TypeScript contract](../../bridge/urbanArchitecture.ts).

`data/urban-admission.json` is produced without interiors by the minimal native path (plan, courtyard, enclosure, roof and circulation); it distinguishes buildable minima and refusals. From `rust/`, regenerate with `cargo run -p magna-urbis-houses --example admission -- crates/houses/data/urban-admission.json`. The `admission::tests` test checks its catalogue fingerprint and profiles. To replay a JSON placement batch, use `cargo run -p magna-urbis-houses --example place -- input.json`. To enrich a retained placed copy, add `--enrich` to the same example.

Native contract: [model.rs](src/model.rs). Web boundary: [houses-wasm](../houses-wasm/README.md). Scene validator: [housesContract.ts](../../bridge/housesContract.ts).
