# Magna Urbis - Rust / WASM engine

**Alpha, under development.** This experimental engine is gradually catching up with the TypeScript implementation. Relief, erosion, coasts and hydrology are under development; urban generation and full application integration remain to come.

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
