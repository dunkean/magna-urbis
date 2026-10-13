# Magna Urbis - Rust / WASM engine

**Alpha, under development.** This experimental engine is gradually catching up with the TypeScript implementation. Relief, erosion, coasts, hydrology, regional roads, urban footprints, street fabrics, blocks and parcels are available in the benches. Full application integration and buildings on these native city layouts remain separate work.

The [main README](../README.md) introduces the project and shows screenshots of the TypeScript application. The long-term goal is integration into [Neural Earth](https://github.com/dunkean/neural-earth), developed in Infinite Map.

## Development

Install the toolchain pinned in `rust-toolchain.toml`, the `wasm32-unknown-unknown` target and `wasm-pack`, then install npm dependencies in `web/`.

From `web/`:

```sh
npm run wasm:terrain   # Compile the WebAssembly module
npm run check:terrain  # Check rustfmt, Clippy and WASM compilation
```

Generated modules are placed in `rust/pkg/wasm/`, which Git ignores. The TypeScript application keeps its own development and build commands without depending on Rust.

`crates/core/` contains the engine without browser dependencies; `crates/wasm/` exposes bindings; `bridge/` temporarily adapts output to the existing interface and renderer. The current renderer is provisional, and the TypeScript model is not imposed as the permanent Rust engine model.

## Neural relief

The terrain bench can also take its relief from Terrain Diffusion's coarse → base → decoder chain, reimplemented in Rust with [Burn](https://burn.dev) in `crates/neural/`. It produces one 40 × 40 km map in about one second on an RTX 3090. Start the local native service from `web/` with `npm run neural:serve`. On first use, it prepares the weights from `../infinite_map` and the local Terrain Diffusion cache. Then choose **Source: Neuronal** in the Relief stage. The relief family, coasts and climate form a regional sketch that conditions the coarse network; the service warms its GPU kernels for about a minute after each launch.

The neural controls live in `terrainbench.html`, including sketch, climate,
conditioning noise, coarse steps, local relief passed to base, histogram and
decoder detail. Old `neuralbench.html` links redirect there with their settings.

## Neural Earth display style

Choose **Render · Neural Earth** in the terrain bench's style menu (`style=render`
in shared links). The material compositor is copied from Infinite Map's Neural
Earth and translated from WGSL to GLSL: continuous grass and forest coverage,
exposed rock, snow, beaches and depth-coloured sea. It works with both terrain
sources and the existing lighting, water, contours and exports. Display and SVG
raster preparation share the material shader and require WebGL2.

The bench supplies its regional temperature and rainfall. Material settings use
Neural Earth's defaults (summer); the soil and seasonal climate inputs are local
approximations because its geographic pedology/climate atlases are absent here.
Terrain generation is unchanged. The port lives in `bridge/terrainMaterial.ts`
and remains part of the temporary renderer, outside the Rust engine.

## Coarse terrain editor

The terrain bench offers **Éditeur de relief grossier** in the side panel, for
both procedural and neural sources. Enable the sketch, paint elevations or stamp a plateau, volcano or caldera,
then use **Générer** (or Auto). Undo/redo operates on complete strokes and restores
whether the sketch was enabled; Ctrl+Z and Ctrl+Shift+Z work in the editor. Start from
the displayed terrain or the current relief sketch, and import/export
`terrain-sketch.json` to edit the input before generation. Shared links retain the
applied sketch; unapplied edits do not change the displayed map's replay.

The JSON format is `{ "version": 1, "resolution": 64, "heights": [...] }`:
8–128 square cells per side, row-major from the north-west, cell-centred elevations
in metres, sea at zero, covering the whole map. The editor starts at 64². Imported
values must be finite and between −12,000 and 12,000 m. Applied snapshots, exported
files and links round to centimetres. Changing map size rescales
the sketch horizontally. Caverns do not use it.

Procedural refinement replaces the generated large-scale elevations with the
sketch, retains smaller-scale relief, and applies physical Rust erosion. This
edited path uses CPU/WASM for generation, erosion and coasts, and can sample the
retained surface with WebGPU; later coast and water recalculations retain the edited relief. Neural refinement sends the sketch to
the native service's `POST /generate`, conditioning coarse before base and
decoder. The request places it in the same 40 km window that will be cropped for
the user's map, or compensates the altitude scale when slopes are preserved.
Portable JSON files always cover the user's whole map; only the service request
adds a `region` object (`x`, `y`, `width`, metres within the 40 km surface).
Climate controls remain active; the sketch owns its shorelines. Features
smaller than the network's approximately 7.7 km coarse cells may not survive.
`GET /sketch` returns the current analytic neural sketch without running networks.
Restart `npm run neural:serve` after updating the service.

## Settlement points and regional roads

Terrainbench has two stages after hydrology. **4 · Settlements** places points on
the completed map; **5 · Roads** links them. They are separate Rust calls on one
`settlements::Terrain` handle (kept by the WASM worker as `SettlementTerrain`):
road options never move a settlement, and moving a settlement only reroutes.
Neither stage regenerates terrain or water. The standalone HTML falls back to the
same engine on the page when the browser refuses a worker opened from `file://`.

**Settlements** (`crates/core/src/settlements/placement.rs`) ports the legacy
planner's suitability scores, central-place spacing and extent exclusions.
Automatic composition uses either a rank-size law (rank *r* holds main ÷ *r*^q
inhabitants, with a density, smallest place and log-normal spread) or the legacy
class bands; counts by class and an editable list remain. Geography weights
(flat ground, buildable land, fresh water, river, coast, flood avoidance,
defensible heights, elevation preference, seed variation), global site-type
multipliers on top of each culture's preferences, clustering towards larger
places and the border margin are exposed. Select a marker or list entry to see
its score terms and edit name, population, class, culture, site preference and
coordinates; markers can be dragged, returned to automatic placement or deleted.

**Roads** (`crates/core/src/settlements/roads/`) link a Delaunay graph's spanning
tree plus shortcuts (network density). Routes are searched most important first
on 24 directions, so switchbacks hold a per-class grade limit on raw ground
heights; long moves are graded along their whole line, and bridges cross at bank
level. Reuse is per road move and cells beside a road cost more, so routes share
trunks instead of running alongside. The search state carries the heading (eight
sectors) and each class has a sharpest turn per move (45° for roads), so a
hairpin is a rounded loop a few cells across and switchback legs never stack one
cell apart; turns cost the square of their angle, more on steep ground, and the
meander noise fades on slopes. Roads therefore follow contours and valleys with
few hairpins rather than zigzagging up steep faces. All routes then merge into
one planar graph (crossings become junctions, chains between junctions become
segments), whose class (highway, main, local, track, trail) comes from the most
important trip carried on the final network. The
development level (primitive, rural, developed, imperial) maps traffic to
classes and surfaces (dirt, gravel, paved, flagstone); a surface can be forced.
Road cultures (`roads/profile.rs`, auto from each link's larger place or forced)
set grades, straightness, meandering, bridge preference, causeways over shallow
lakes and surface bias. Exits run to the cheapest dry cell of the nearest borders.
The **Rendering** section of the Roads stage only redraws: style (by surface,
road atlas, topographic, ink on parchment, minimal), width, opacity, smooth
curves, casing and bridges. It is saved in the shared link.
Lakes, sea and cavern rock block roads except causeway cultures. The routing
raster is capped at 512², independently of camera zoom.

Validation from `web/`: `npm run typecheck`,
`npx vitest run --project fast tests/terrainSettlements.raster.test.ts`, and
`node scripts/terrain_settlements_ui_check.mjs` against a running terrainbench
(defaults to port 5174; `PLAYWRIGHT_CHANNEL` selects the browser).
Add `--water` after the URL for both water engines, or `--vector-water` for
the vector chain only. Pass the standalone HTML's `file:///…` URL to verify
offline editing and sharing.
Native invariants (no doubled roads, junctions at every crossing, grades with
switchbacks, culture and level typing, causeways, rank-size law) run from `rust/`
with `cargo test --release -p magna-urbis-core --test settlements`. For a bench map,
`DUMP=1 node scripts/terrain_roads_visual.mjs` (from `web/`) writes screenshots
and the adapted raster; `cargo run --release -p magna-urbis-core --example
roads_inspect -- <dump.json>` then reports grade bands, doubled length,
switchback shape (hairpins, leg length and spacing, hatched length) and the
steepest stretches.

## Urban stages in Terrain Bench

**6 · Quartiers et îlots** and **7 · Parcelles** extend the settlement and road
stages with independent native Rust generation calls. Select one settlement
(largest first), or **All**; cultural recipes, fine generation parameters,
separate seeds and display controls are available. Parcel edits retain streets.
See the [urban-stage contract and controls](crates/core/src/urban/README.md).

## Houses bench

The independent `crates/houses/` engine generates domestic buildings and compounds from the architectural catalogue, with a separate free workshop for geometric primitives. `crates/houses-wasm/` provides coarse JSON calls; `bridge/houseRender.ts` is a temporary SVG adapter. The [houses guide](crates/houses/README.md) explains the French controls, historical modes, native levels, source confidence, replay links and SVG/JSON exports. Catalogue coverage records do not guarantee every recipe or configuration can be generated; the bench reports native errors.

From `web/`:

```sh
npm run dev:houses    # Rust watcher and /housebench.html
npm run wasm:houses   # Development WASM package only
npm run build:houses  # Standalone rust/out/houses/housebench.html
npm run check:houses  # Native, WASM and contract checks
```

The standalone HTML embeds its WASM and works offline in a modern browser. Generated packages stay in ignored `rust/pkg/houses/`. The ordinary TypeScript application commands remain independent of Rust. See the [WASM boundary](crates/houses-wasm/README.md) for the API and limits.
