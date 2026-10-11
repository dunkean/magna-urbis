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

`web/src/ui/neuralbench.html` (`http://localhost:5173/neuralbench.html` under `npm run dev`) is a prototype bench for the networks alone: sketch, climate values, conditioning noise, coarse steps, the coarse local relief passed to base (scaled or imposed), base histogram and decoder detail. It shows the raw relief without erosion and a minimal hydrology: priority-flood filling from the sea and map edges, steepest descent elsewhere, and upstream area accumulation.
