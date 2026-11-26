# Physical terrain definition

The region width is expressed in metres. `terrain.sampleSpacing` chooses the requested step of the physical source; `terrain.resolution` only chooses the preview grid (64 to 1024). The number of physical samples is `ceil(width / sampleSpacing)` and the effective step is `width / n`.

Constraints are checked before generation: at least 16 samples per side, at most 8192, and an estimated working-raster budget of 1536 MiB. This estimate excludes the model weights and activations as well as the render caches. An impossible combination is refused, without silently reducing the requested definition.

| Technology | Extent | Definition |
| --- | --- | --- |
| Rust procedural | 500 m to 100 km | Chosen step, subject to the budget |
| Conventional regional neural | 500 m to 200 km | Native 30 m source, output possibly less dense |
| Experimental profile Tile40 / residual8k | 40 km | Fixed 1024² output; contract specific to the model |
| Heightmap | 500 m to 100 km | Limited by the samples actually imported |
| Classic TypeScript | 600 m to 40 km | Definition specific to the engine; no promise of a finer Rust source |

The neural windows overlap: coarse 64/48, base 64/32, decoder 512/384. The conventional region is placed deterministically within a single coarse window, with the contributions needed for reconstruction. The 200 km bound preserves the margins of this placement. Tile40 keeps its own inference context and must not be equated with the regional profile. This experimental profile evaluates four coarse windows; its conditioning also covers their margins, without artificial replication of the edge.

This context field contains 113² coarse cells, distinct from the 1024² samples of its physical output.

The factors 32 and then 8 describe the resolution ratios between cells, not a subdivision into independent tiles. A coarse window covers 491.52 km (cells of 7.68 km), but neighbouring windows overlap over 122.88 km. A base window covers 15.36 km with a step of 7.68 km; a decoder window also covers 15.36 km with a step of 11.52 km. The margins required at each stage add together: subtracting only two margins of 15.36 km from the coarse window therefore does not give its usable area with a single coarse inference. The tested regional plan remains within one window up to 6688 native cells (200.64 km); the product caps this width at 200 km.

The neural conditioning remains at 7.68 km: a 30 m output step does not guarantee control of the sketch or the coastline at this fineness. A coarser neural output reduces the data kept and transmitted to the cities; it does not reduce the model's initial work at 30 m. The intermediate rasters of this inference are not included in the budget of the retained source.

The GPU procedural computation produces any source from 16² to 4096². The size is read from the uniform block: changing it recompiles no pipeline. The device requests the adapter's buffer limits. In automatic mode, a size that the adapter refuses, or whose fixed GPU cost exceeds the estimated CPU computation, uses the CPU pipeline, and the activity panel indicates this choice. A forced GPU choice that is impossible is refused, with the adapter's maximum size reported.

The regional grid does not depend on the source. The surface erosion grid equals its physical base (640² to 1024²), never more than the source; beyond 1024², it follows 0.6 × the source, capped at 2048². One surface iteration represents the same physical time on any grid: implicit incision scales with 1/step, and thermal creep and diffusion with 1/step², within their stability limits. The erosion budgets and coefficients are in the "Super advanced" controls. The effective erosion definition may be coarser than that of the source; it is indicated separately.

Changing the step can change the drainage, even with the same seed.

Open sea remains coarse: once the coastline has been cut out, a 128² mask marks the sea cells that are further from land than the skipped stages (detail, Phasor, surface) reach. They keep their reconstructed bathymetry. As long as the coastline is not known, nothing is skipped.

Hydrology keeps its own grid, capped at 1024² in the current engines: at 200 km, its best regional step is therefore 195.31 m, even with a 30 m neural source. It also does not exceed the power of two that contains the source, with a minimum of 256²: a 200² source drains on 256². The panel displays this step separately; a denser source does not mean that the basins and flow paths were computed at the same fineness.

## Transmission to cities

The world keeps the physical source independently of the preview. The planning, routing and resource grids remain capped at 1024²: there is no need to duplicate every mask at the elevation definition. Urban queries transmit separately the continuous surface used for heights, local slopes and foundations. The B-spline controls, when available, use the same kernel and the same floor as the terrain surface. Ground patches contain evaluated metres, not interpolation coefficients.

The native `/raster` transport adds `physicalN`, optionally `physicalInterpolation: "bspline"` and `physicalFloor`, then a float32 layer after the existing planning layers. A single physical layer is kept in the urban engine. Worker pools are subject to a copy budget.

The classic TypeScript urban engine refuses a physical surface that differs from its planning grid. In that case, one must choose Rust or the native engine.

Visual details finer than the source grid spacing (source cell size) remain distinct from the generation information; increasing the pixels of a preview does not create relief.

## Checks of 6 November 2026

Choices reviewed with Opus 5.5 high via CLI. Validation: 605 Rust tests passed (23 skipped), 80 TypeScript tests, 5 Python tests, full TypeScript check, V2 browser checks and rustBench, native physical transport and CPU checks of the WASM binaries, including the Tile40 context bounds. The native artefacts and the three WASM variants have been rebuilt. Services already running remain in place during the rendering work; their update and restart remain to be done afterwards. A full neural inference over 200 km has not been run during this work.
