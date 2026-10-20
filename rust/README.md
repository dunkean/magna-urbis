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

Two execution profiles are available: **web** uses WASM/WebGPU, while **local**
uses the optimized native Rust service with browser GPU stages. From `web/`, run
`npm run start:local` on Windows or Linux. `npm run app:dev` opens the same
workshops in a desktop window; `npm run app:build` packages an application for
the current OS. Shared defaults are in `../config/execution.json`. See the
[desktop/local instructions](desktop/README.md) for dependencies and options.

`crates/core/` contains the engine without browser dependencies; `crates/wasm/` exposes bindings; `bridge/` temporarily adapts output to the existing interface and renderer. The current renderer is provisional, and the TypeScript model is not imposed as the permanent Rust engine model.

## Shared benches page

On Windows, run `start-terrainbench.bat` from the repository root (or
`npm run start:benches` from `web/`). It stops existing project instances,
starts the shared site on port 5173, the native Rust engine on port 8791 and
the Python/CUDA service on port 8793 in the background, and waits for all three
services to respond. Its launch link selects Local/Rust, neural Python and a
2.4 km map. Fresh terrain maps use the profile's neural method and that small
extent; explicit shared settings remain applied. Legacy `source=neural` links
without an explicit endpoint now use Python/CUDA. To replay the native neural
reference, retain `source=neural&neural=http://127.0.0.1:8792`.
Re-running the launcher restarts the services. Use `stop-terrainbench.bat` or `npm run stop:benches`
to stop them and their child processes. Logs are in
`web/out/benches-runtime/`. An unrelated program occupying either port is
reported without being killed. Existing WASM packages and npm dependencies
are required, along with the release engine (`npm run build:local` once).
`MAGNA_LOCAL_BIN` overrides the engine executable. Python runs directly in Neural Earth's virtual environment;
`MAGNA_NEURAL_PYTHON` overrides that executable. There is no Docker or compilation
at startup; neural weights load on the first Python generation. To run just the
site for procedural/browser inference, pass `-NeuralBackend none` to the launcher.
`-NeuralBackend native` retains the old native Rust service for legacy URLs and
reference checks, with optional `-Warmup`. Use `npm run build:neural` to rebuild
that reference binary explicitly.

From `web/`, `npm run dev:benches` serves `/rustbench.html`, a shared container
for Terrain (stages 1–3), Settlements (regional roads and quarters), Urban and Houses. Each bench loads on its first
visit and retains its settings and results while switching tabs. **Lien** copies
a container link with the active bench's shared settings; **Ouvrir** opens that
bench independently. Reloading the container closes its live sessions; explicitly
saved exports remain in the browser's IndexedDB history. Terrain can send its whole
surface or a square crop to Settlements. A selected city opens directly in Urban's
quarter/parcel workshop with its computed streets and blocks. Parcels are off by
default in Settlements. Urban contains the quarter/parcel workshop only. The existing decor catalogue,
terrain import and territory occupation options live in Settlements. City transfers
include a local relief/water/road crop; shared settings synchronize between live
sessions, and returning restores the full regional map. See [the staged workflow and portable format](../docs/RUST_BENCH_PIPELINE.md).

`npm run build:benches` assembles the container and all benches in
`rust/out/benches/index.html`. It uses the existing terrain and houses WASM
packages; build them with `npm run wasm:terrain` and `npm run wasm:houses` if
needed. This command does not compile Rust. The generated folder can be served
statically or opened locally. For Urban Bench without a decor server, load a
`.decor` file manually. Python relief requires its service; browser neural
relief requires HTTPS or localhost and WebGPU. Neural runtime and model files
are separate assets in the generated `neural/` folder, not embedded in HTML.
When local file permissions prevent reading an embedded bench's current URL,
the container disables **Lien**; open the bench independently to share from it.
The development container reloads when generated WASM changes; use the existing
terrain/houses development commands when automatic Rust compilation is needed.

## Neural relief

World offers three sources in the Relief stage:

| Source | Execution | Network profile |
| --- | --- | --- |
| Procedural | Rust/WASM and selected WebGPU stages in the browser | Analytic relief and erosion |
| Neural WASM | Direct WebGPU runtime, through Rust/WASM, in a browser worker | coarse4, NF4 B75 two-step base, distilled decoder |
| Neural Python | PyTorch/CUDA on the local service, port 8793 | coarse4, original one-pass base, distilled decoder |

`npm run wasm:neural` builds the browser adapter and prepares about 162 MB of
external, SHA-256-checked model assets. It reuses the shared runtime and prepared
models from the sibling `../infinite_map` checkout (`wasm/dist/runtime/models`);
it does not use the old Burn browser convolution path. Run Neural Earth's
`npm run build:wasm` first if those prepared models are absent. Browser weights
are cached when storage permits, and only downloaded when that source is used.
The adapter is an optional standalone Cargo workspace: ordinary terrain/houses
builds do not depend on the sibling checkout. Ordinary TypeScript builds
require neither those assets nor Rust.

`npm run neural:python` starts the Python service with the sibling Neural Earth
virtual environment, source and checkpoints; `MAGNA_NEURAL_EARTH` selects another
checkout. Its conditioning is prepared with the same regional Rust sketch as
browser inference, including manual edits. Different base models and numerical
precisions mean the two neural modes are not numerically interchangeable;
the delivered metadata reports backend, profile, precision and stage timings.
Both deliver signed metre elevations over 40 km in a 1024-square raster.

Neuronal Python now offers independent **Coarse**, **Base** and **Décodeur**
choices in **Neural networks**. Nine complete checkpoints, each below 100 MB,
are retained with SHA-256 identities in [`models/neural-earth`](models/neural-earth/README.md).
They include coarse 1/2/4/8 variants, the experimental 18.28 MB residual base,
and the 13.35 MB / 0.86 MB decoders. The residual base uses its actual finite
Tile40 flow and requires Coarse2; incompatible combinations are disabled.
The original large base remains external. Browser inference retains its pinned
coarse4/NF4 B75/decoder profile; these Python choices do not relabel that runtime.

The neural controls live in `terrainbench.html`, including sketch, climate,
conditioning noise, coarse steps, local relief passed to base, histogram and
decoder detail. The obsolete standalone neural bench has been removed;
Use `terrainbench.html?source=neural-wasm` or `?source=neural-python`.
Existing `source=neural` URLs retain the old native Rust backend on port 8792;
that compatibility choice only appears when such a link is opened. Existing
container links using `#neural` enter the same World session.

## Neural Earth display style

Choose **Render · Neural Earth** in the terrain bench's style menu (`style=render`
in shared links). The material compositor is copied from Infinite Map's Neural
Earth and translated from WGSL to GLSL: continuous grass and forest coverage,
exposed rock, snow and beaches. Water uses a shared shore-distance palette for seas and lakes. It works with both terrain
sources and the existing lighting, water, contours and exports. Display and SVG
raster preparation share the material shader and require WebGL2.

The bench supplies its regional temperature and rainfall. Material settings use
Neural Earth's defaults (summer); the soil and seasonal climate inputs are local
approximations because its geographic pedology/climate atlases are absent here.
Styles, visible layers, diagnostics and generation masks have separate roles.
Altitude is a diagnostic; selecting it retains the chosen style. Water appearance
and its original map scale travel with retained decors and city workshops.
See [the shared rendering contract](../docs/RENDERING.md).

Terrain generation is unchanged. The port lives in `bridge/terrainMaterial.ts`
and remains part of the temporary renderer, outside the Rust engine.

### Terrain flyover

In the Terrain workshop only, **3D** projects the selected map style, water,
contours and Fantasy illustrations onto a perspective mesh of the retained
Rust/WASM elevations. Drag to move, right-drag or Shift-drag to rotate and
tilt, and use the wheel to approach the ground. Arrow keys move the view;
Shift-arrow keys orient it. **N ↑** faces north, **Fit** frames the map,
and **Relief ×** adjusts the vertical exaggeration without changing elevations.
The camera and 2D/3D mode travel with shared links and workshop sessions.

The view requires WebGL2. Sea and lake surfaces use their water elevations;
changing the style or moving the camera preserves generation. Editing zones,
placing pins, measuring and choosing a crop return to 2D. SVG/PNG exports keep
their cartographic view. The perspective mesh and material refine in quadtree
tiles around the camera, using retained world-space height and material grids.
Close zoom reaches the map's limit of 8 CSS pixels per metre;
device pixel ratio is preserved up to 2. Tile caches and background loading
keep memory bounded. Fantasy illustrations remain projected map brushwork.
The original 2D views and **Render** keep their existing surface and material.
The separate **Render3D · Multiscale** style extends Render with world-space
material detail and is also selectable in 2D. Enhanced mesh residuals are isolated
to 3D and this explicit style: their physical wavelengths adapt to the source
cell size, keep plains smooth and retain the underlying slopes. The sampled
surface is independent of the camera; continuous geometry morphs and material
crossfades handle LOD changes without replacing the landscape at each level.
The implementation follows established continuous terrain LOD and derivative-
conditioned noise techniques; it does not claim to simulate physical erosion.
This viewer is presentation code in `web/src/ui/terrain3d.ts`, independent of
the engine and the future permanent renderer.

**Raffinement** selects **Source**, **Noise multiscale** or **Neural Earth · CUDA**
for 3D and the explicit Render3D style, including Render3D in 2D. This selection
is saved in links as `refinement3d`. Source retains the original raster; Noise
uses a world-anchored derivative-conditioned surface. Neural Earth requires
the local Python service (`npm run neural:python`) and reuses the updated
upstream `decoder-v12-nyquist-notch` refiner directly: one decoder band at 15 m,
then sparse-convolution detail down to 0.46875 m in the native 40 km coordinate
system. Scaling the map scales these physical spacings. A generated Python
WorldPipeline retains its appearance latents for that decoder band. Procedural,
browser and finite residual-base sources use the same sparse-convolution
method with native terrain roughness, without claiming a second neural decode.
The status reports which path actually ran. Only fine residuals are added to
Magna's retained relief; water generation is preserved. The mesh and material
consume the same haloed, spline-prefiltered tile, and the parent stays visible
until both are ready. Ordinary 2D styles, including Render, keep their original
surface, palette and refinement behavior.

## Painted terrain operations

**Zones de génération** in Terrainbench paints semantic masks in the main map:
sea, plains, hills, mountains and high mountains. The brush stores operation
weights, not elevations. Brush radius and transition width shape the regions;
the eraser returns to the selected automatic background. **Exemple : côte et
massifs** provides an editable starting layout. Undo/redo and shared links retain
whole applied masks; ungenerated strokes remain drafts.

The procedural Rust simulation uses these weights in its initial noise,
regional uplift, mountain distribution, ridge skeleton and fine detail before
erosion. One shared physical pass joins the result. Sea masks apply a signed
coastal cut. Empty masks restore the ordinary seeded generator. Zoned generation
runs in CPU/WASM; retained sampling and display can use the GPU.

Neural WASM and Python use the same Rust regional profiles to generate mean
height conditioning and local relief constraints from the masks. Local relief
is applied before the base network, so a mountain region is not flattened by a
global plain preset. Both networks generate their own terrain details. The
marine operation also applies to the delivered surface, preserving the painted
sea. The network's coarse cells cover about 7.7 km of its native 40 km surface:
use broad regions. Entering zoned neural generation selects Scale so the whole
mask participates, including on smaller displayed maps; Crop remains selectable.

Zone JSON: `{ "version": 1, "resolution": 128, "weights": [...] }`, with five
interleaved bytes per cell in the order sea/plain/hills/mountains/high-mountains.
Cells are centred, origin north-west. The sum is at most 255; the remainder uses
the automatic background. Valid resolutions are 8–128. Zone exports and links
contain no user-painted height samples. The browser runtime's small local-relief
overlay is installed by `npm run wasm:neural` over generated sources, leaving
the shared upstream implementation unchanged.

Heightmap JSON and grayscale PNG 8/16-bit import, plus JSON/PNG 16-bit export,
remain in a separate expandable section, up to 1024². They exchange existing
rasters; they do not define the zone brushes. Old height sketches and shared
links remain readable. Restart the Python service after updating its code;
older running services are rejected for zoned conditioning.

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
