# Magna Urbis: technical architecture and scientific foundations

[French original](TECHNICAL_AND_SCIENTIFIC_OVERVIEW_FR.md).

Document status: **October 14, 2026**. Magna Urbis is a prototype for generating landscapes and preindustrial settlements. The TypeScript application remains the most complete reference; the Rust/WebAssembly version is **being implemented and integrated**. This document describes paths present in the repository and their foundations, without proposing a new definitive architecture.

Code links distinguish methods actually used from scientific references that explain or compare an approach. The cited papers do not constitute scientific validation of Magna Urbis: the project's parameters, simplifications and artistic choices have their own domain of validity.

## 1. System layers

| Layer | Inputs and results | Implementation and status |
| --- | --- | --- |
| Reference application | Seed, environment and cultures → landscape, cities, buildings and exports | TypeScript in `web/`, without a generation server |
| Procedural terrain | Noise, landforms, coasts and erosion → elevation field | Rust `crates/core`, WASM; WebGPU acceleration for selected passes |
| Optional neural terrain | Sketch, climate and seed → learned elevation field | WASM/WebGPU in the browser or Python/CUDA service; native Rust retained for legacy links |
| Hydrology | Elevations → drainage, lakes, river graph and beds | Rust; drainage preparation can run on GPU, vector finalization on CPU/WASM |
| Settlements and roads | Terrain and water → inhabited places and regional network | Rust, separate stages in Terrain Bench |
| Urban plans | Site, access, population and culture → neighborhoods, streets, blocks and parcels | Rust/WASM in Terrain Bench and Urban Bench; integration in progress |
| Houses | Architectural recipes and constraints → building volumes, courtyards and roofs | Independent Rust engine, House Bench; assembly with cities remains separate |
| Rural land use and rendering | Geometry and environment → fields, vegetation and map | TypeScript and temporary adapters; final renderer remains to be developed |

The main logical dependency is:

```text
seed + parameters
  ├─ procedural terrain → erosion and coasts
  └─ sketch + climate → coarse → base → decoder → neural elevation
                         ↓
                 retained physical surface
                         ↓
                 drainage → lakes and rivers
                         ↓
                 settlements → regional roads
                         ↓
             neighborhoods → streets / blocks → parcels
                         ↓
                 interface, rendering and exports

houses: independent engine, connection to parcels in progress
```

A parcel change does not need to recompute terrain. The camera samples the retained surface: zooming reruns neither erosion nor neural networks. See the [terrain engine](../rust/crates/core/src/engine.rs), [settlements](../rust/crates/core/src/settlements/mod.rs) and [urban stages](../rust/crates/core/src/urban/mod.rs).

### Exploring the implementations

After installing the tools listed in the [Rust README](../rust/README.md), run these commands from `web/`. Choose the bench to inspect; the neural service runs in a separate terminal when that source is used.

| Command | Entry point |
| --- | --- |
| `npm run dev` | TypeScript reference application |
| `npm run dev:terrain` | WASM build and `terrainbench.html` / `urbanbench.html` benches |
| `npm run dev:houses` | Independent house engine, `housebench.html` |
| `npm run neural:serve` | Optional native neural-terrain service |

To reproduce a result, retain the seed, applied parameters and versions of the engine, catalogs and weights. The [house bench instructions](../rust/crates/houses/README.md) specify inputs and rejected configurations.

## 2. Procedural terrain: noise, patterns and scales

Coherent noise assigns nearby values to nearby coordinates. Perlin's work on gradient noise is the classic reference; the local implementation uses **2D simplex noise** and sums of octaves. This variant must be distinguished from improved Perlin noise, cited here as general background. [Perlin, 2002](https://mrl.cs.nyu.edu/~perlin/paper445.pdf); [local code](../rust/crates/core/src/noise.rs).

A simplified sum is:

```text
h_noise(x, y) = Σ a_k · N(f_k · x, f_k · y)
```

`N` is coherent noise, `f_k` its frequency and `a_k` the octave's amplitude. Low frequencies structure large masses; high frequencies add detail. *Domain warping* distorts evaluation coordinates using other noise fields, avoiding overly regular ridges. The term “fractal” describes this multiscale construction; it does not demonstrate a geological law.

Map size and pattern scale are separate. Terrain families add shape constraints: plain, hills, valley, mountains, plateau, canyon, volcano or caldera. Coastal cutting defines a signed surface with sea at zero, then retains the results of physical processing. Octaves unresolved at the sampling scale are filtered to limit artifacts. See the [core](../rust/crates/core/src/lib.rs), [coasts](../rust/crates/core/src/coast.rs) and [noise preparation](../rust/crates/core/src/generation_noise.rs).

## 3. Erosion: drainage, incision and redistribution

### Depressions and flow directions

An elevation field contains closed depressions and flat areas where slope alone cannot choose a downstream direction. **Priority-Flood** explores cells from outlets in increasing elevation order and computes the level needed to drain each depression. This level is a drainage potential; it does not mean that every depression must become a lake or be physically filled. [Barnes, Lehman and Mulla, 2014](https://doi.org/10.1016/j.cageo.2013.04.024); [authors' implementation](https://github.com/r-barnes/Barnes2013-Depressions).

For erosion, **D∞** routing estimates a direction on triangular facets around a cell and divides contributing area between two downstream neighbors. It reduces the preference of D8 grids for eight fixed directions. The final vector network instead uses its own drainage topology: the two representations serve different purposes. [Tarboton, 1997](https://doi.org/10.1029/96WR03137); [erosion code](../rust/crates/core/src/erosion.rs).

### Fluvial incision

The *stream-power* law relates bed lowering to drainage area and slope. A reference form for landscape evolution is:

```text
∂h/∂t = U − K · A^m · S^n
```

`h` is elevation, `U` uplift, `A` contributing area, `S` slope and `K` erodibility. The exponents describe the model's response. Braun and Willett's implicit solver handles downstream dependencies without requiring the small steps of an explicit scheme. [Braun and Willett, 2013](https://doi.org/10.1016/j.geomorph.2012.10.008).

Magna Urbis applies an interactive adaptation: capped contributing area, attenuated response on gentle slopes, bounded incision and implicit updates toward downstream elevation. The “erosion” setting controls intensity, not a calibrated geological duration. The equation above explains the family of methods; it is not an exact transcription of every generator pass. Threshold openings and partial basin filling are also bounded. [CPU implementation](../rust/crates/core/src/erosion.rs); [GPU passes](../rust/bridge/terrainErosion.wgsl).

### Thermal relaxation and hillslope diffusion

Thermal relaxation moves material when slope exceeds a talus threshold. Diffusion smooths small irregularities while protecting certain channels. These complement incision: cutting valleys and redistributing hillslopes are different operations.

**Geomorphological diffusion**, which redistributes a spatial quantity, must also be distinguished from **neural diffusion**, which learns to remove noise. Local erosion is not a complete solver for hydraulics, sediment transport and mass conservation over geological time.

## 4. Hydrology: from rasters to rivers and lakes

### Drainage graph and river geometry

The hydrology stage reads the physical surface and builds downstream directions, contributing areas, basins and depressions. Initial diagnostics remain separate from routing decisions and terrain corrections. A bounded breach can open a depression that is not retained; flats require topological ordering to avoid loops and arbitrary flow. [Hydrology](../rust/crates/core/src/hydrology.rs); [flats](../rust/crates/core/src/hydrology_flats.rs); [depressions](../rust/crates/core/src/hydrology_depressions.rs).

Drainage cells then become a **vector graph**: sources, reaches, confluences and outlets. Widths and profiles are evaluated along centerlines; incised beds and water surfaces also contribute to terrain sampling. Shared nodes maintain confluence joins. The water profile must remain downhill and compatible with ground-correction budgets.

Local curves use deterministic multiscale variation in physical units constrained by terrain. They are not a sine wave drawn over a grid line. Meander-migration models such as Howard and Knutson's provide scientific comparison; the current Rust module is not a complete reimplementation of that time-dependent simulation. [Howard and Knutson, 1984](https://doi.org/10.1029/WR020i011p01659); [Rust curves](../rust/crates/core/src/hydrology_meanders.rs).

### Lakes and water balance

A topographic depression does not guarantee a permanent lake. The local module estimates annual runoff from precipitation and empirical evapotranspiration depending on temperature and elevation. A lake reaches a level compatible with its inflows and surface evaporation: it can remain closed or overflow at its threshold and pass on the surplus. Artistic minima and caps remain generator parameters. [Local water balance](../rust/crates/core/src/hydrology_balance.rs).

The **Fill–Spill–Merge** family retains depressions and distributes inflows among basins that fill, spill and merge. The local module takes inspiration from it for a simplified equilibrium on its drainage; it does not reproduce the published algorithm's entire hierarchy and dynamics. [Barnes, Callaghan and Wickert, 2021](https://esurf.copernicus.org/articles/9/105/2021/).

These treatments seek network consistency and cartographic legibility. They do not predict floods, tides or navigation. Visually plausible neural terrain may still need hydrological corrections or be rejected by a profile constraint.

## 5. InfiniteDiffusion, Terrain Diffusion and Neural Earth

### What “infinite” means

**InfiniteDiffusion** is Goslin's algorithm for lazy, unbounded generation that is consistent with the seed and independent of visit order. **Terrain Diffusion** applies it to terrain synthesis. Windows share deterministic spatial noise and their contributions blend in overlaps. The computation therefore does not simply juxtapose independently generated images. [Goslin, 2025, revised in 2026](https://arxiv.org/abs/2512.08309).

Spatial dependencies are evaluated on demand; truncating the number of blending steps makes their expansion tractable. The stated constant cost concerns a region of fixed size and configuration, regardless of its position. Enlarging the region, increasing resolution or changing the number of evaluations still increases work. [Paper, sections 3.3–3.4](https://arxiv.org/html/2512.08309v4).

### The pipeline used in Magna Urbis

The Rust port computes a **finite 40 × 40 km window**, not an infinitely navigable world. It runs:

1. **Coarse**: regional structure conditioned on the altitude sketch and climate, at 7,680 m spacing.
2. **Base**: latent field at 240 m spacing, conditioned on coarse.
3. **Decoder**: detail at the native 30 m spacing, followed by altitude reconstruction and 1024² resampling for the bench.

The local profile is `coarse4` → original base in one evaluation → distilled student decoder. The planner traces backwards from the delivered area to determine required windows; blending normalizes their weighted contributions. The decoder alone does not replace regional and latent information. [Planner](../rust/crates/neural/src/plan.rs); [pipeline](../rust/crates/neural/src/pipeline.rs); [reconstruction](../rust/crates/neural/src/reconstruct.rs).

Diffusion-model theory distinguishes the denoising network, its conditioning and the sampling scheme. EDM and EDM2 provide formulations and normalization mechanisms used by this family of networks. Distillation trains a student to replace a more expensive chain; consistency models in particular allow generation in few evaluations. This does not make any original model reliable in one pass. [Karras et al., 2022](https://arxiv.org/abs/2206.00364), [Karras et al., 2024](https://arxiv.org/abs/2312.02696), [Song et al., 2023](https://proceedings.mlr.press/v202/song23a.html).

The sketch controls large shapes and climate guides learned structures. A small feature below coarse resolution is not guaranteed to survive. The neural surface is imported without reapplying procedural erosion and coastal cutting; hydrology is a separate stage. [Sketch](../rust/crates/neural/src/sketch.rs); [imported surface](../rust/crates/core/src/engine.rs).

### Relationship to Neural Earth and Orogen

**Neural Earth**, developed in Infinite Map, combines **World Orogen** planetary geography with Terrain Diffusion's learned refinement. Orogen produces continents, tectonic structures, erosion processing and climate; Neural Earth connects them to exploration and map layers. This planetary pipeline belongs to a separate project. [Neural Earth](https://github.com/dunkean/neural-earth); [World Orogen](https://github.com/raguilar011095/planet_heightmap_generation).

Magna Urbis aims to add roads, settlements and cities. Full integration remains to be done. Using the same terrain models or sharing a rendering style does not prove cities are already integrated into a planetary world.

## 6. Settlements, roads, city plans and buildings

### Where to place settlements and how to connect them

Placement combines buildability, slope, freshwater, coasts, defensive position, cultural preferences and spacing. A demographic option follows a rank–size law: `P_r ≈ P_1 / r^q`. It provides an adjustable distribution, not a historical or economic prediction. Footprint exclusions avoid treating population as a mere point cloud. [Placement](../rust/crates/core/src/settlements/placement.rs).

The regional network selects links on a Delaunay graph using a spanning tree and shortcuts. Route search combines terrain costs, slopes, turns, obstacles and road reuse. Its state retains an arrival direction; moves more varied than the eight neighbors allow switchbacks. Intersections are then joined into a planar graph. [Roads](../rust/crates/core/src/settlements/roads/mod.rs); [search](../rust/crates/core/src/settlements/roads/search.rs).

This approach belongs to the family of anisotropic least-cost paths: Galin and coauthors show how to incorporate slope and obstacles into road generation. Magna Urbis's local classes and constraints are its own choices. [Galin et al., 2010](https://doi.org/10.1111/j.1467-8659.2009.01612.x).

### From culture to street graph

A city is not just a distorted grid. The TypeScript model combines morphologies and growth phases: cores, axes, walls, extensions, squares and amenities. Organic families, bastides, medinas, Chinese or Japanese plans and fantasy cultures impose different rules. Recipes are documented approximations; mixing them does not constitute an archaeological reconstruction. [Cultures](../web/src/gen/urban/cultures.ts); [streets](../web/src/gen/urban/streets.ts); [settlement catalog](catalogue_settlements_antiquite_moyen_age_rpg.md).

Two references situate this approach: Parish and Müller separate global goals and local constraints in urban L-systems; Chen and coauthors use tensor fields to guide two main street orientations and edit their graph. These explain families of methods; citing them does not mean Magna Urbis uses their exact solver. [Parish and Müller, 2001](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf); [Chen et al., 2008](https://www2.cs.uh.edu/~chengu/Publications/streetModeling/street_sig08.pdf).

The Rust urban port applies versioned cultural data, uses regional access and dry land, routes axes, then subdivides neighborhoods into blocks and parcels. Footprints, street fabrics and growth logic continue to evolve. Slopes are checked along segments; water crossings must correspond to accepted crossings. Parcel recomputation retains streets and blocks. [Profiles](../rust/crates/core/src/urban/profiles.rs), [macroplan](../rust/crates/core/src/urban/macroplan.rs), [neighborhoods](../rust/crates/core/src/urban/quarters.rs), [parcels](../rust/crates/core/src/urban/parcels.rs).

### Geometry and houses

Blocks and lots require geometric operations with holes, intersections and explicit frontages. Useful invariants are block coverage, absence of overlap, street access and building containment. A correct sum of areas alone does not guarantee a correct partition.

The Rust house engine assembles recipes for building volumes, courtyards, materials, levels and roofs, then checks geometric and access constraints. It can reject a configuration instead of producing an invalid structure. Its bench is independent; building a house does not prove that all city parcels are already populated with buildings. [House engine](../rust/crates/houses/src/lib.rs); [architectural catalog](styles_architecturaux_mondiaux_city_mapper.md).

## 7. Rust, WebAssembly, WebGPU and neural inference

| Execution path | Where computation runs | Implication |
| --- | --- | --- |
| TypeScript | Browser JavaScript with workers | Static application; development and build independent of Rust |
| Rust → WASM | Browser CPU | Same native core exposed through `wasm-bindgen`, staged calls and numeric arrays |
| WebGPU compute | Browser GPU, WGSL shaders | Accelerates selected terrain and drainage passes; requires a compatible browser and adapter |
| Native neural Rust | Local service, GPU via Burn/wgpu | Reference retained for legacy `source=neural` links |
| Neural WASM | Rust/WASM and Neural Earth's direct WebGPU engine in a worker | Connected to World; NF4 B75 base, verified external weights and browser cache |
| Neural Python | Local PyTorch/CUDA service | Connected to World; original base in one pass, same regional conditioning prepared in Rust/WASM |

WebAssembly is a portable execution format; it does not automatically enable the GPU. WebGPU exposes GPU resources and commands; WGSL describes shaders. `wgpu` provides an abstraction usable natively and on the Web, while Burn organizes tensors, networks and compute backends. Performance depends on transfers, kernels and hardware capabilities. [WASM goals](https://webassembly.org/docs/high-level-goals/), [WGSL specification](https://www.w3.org/TR/WGSL/), [wgpu](https://docs.rs/wgpu/latest/wgpu/), [Burn backends](https://burn.dev/books/burn/building-blocks/backend.html).

Repository boundaries are explicit: `crates/core` knows nothing of the browser or renderer; `crates/wasm` exposes its functions; `bridge` transports and adapts results to the interface. Procedural shaders are not neural networks. The neural port is in `crates/neural`, with Burn 0.22 declared in its manifest; convolutions use FP16 and some statistics computations remain FP32. [Manifest](../rust/crates/neural/Cargo.toml); [GPU operations](../rust/crates/neural/src/gpu.rs).

The native service retains weights on its GPU and supplies `/status` and `/generate`, among other endpoints. Its terrain response contains FP32 heights in meters with defined resolution and extent. From `web/`, `npm run neural:serve` starts this optional path. It requires weights and a compatible GPU; generated weights and modules are not included in Git. [Service](../rust/crates/neural/src/server.rs); [commands](../web/package.json).

The [neural-wasm](../rust/crates/neural-wasm/src/lib.rs) crate replaces the former Burn/autotune experiment with the direct WebGPU engine shared with Neural Earth. Browser replay 42 → 43 → 42 recovers the same raster for the same seed in controlled cases. The [Python service](../web/scripts/neural_python.py) runs networks on CUDA with hooks that verify input devices. The two modes use different bases and precisions: their outputs are not numerically interchangeable. These targeted checks certify neither every seed nor every GPU.

## 8. Reproducibility, rendering and limitations

Local coordinates and elevations are in meters; areas are in square meters. The procedural generator uses named sub-seeds per stage and object so changing a control does not redistribute every random draw. The RNG port retains the TypeScript reference's `sfc32` stream and UTF-16 hash. The neural pipeline has its own portable noise. [Shared RNG](../rust/crates/random/src/lib.rs); [neural noise](../rust/crates/neural/src/noise.rs).

Reproducibility depends on engine, catalog and weight versions, configuration and CPU/GPU path. FP16, BF16 and FP32 do not necessarily produce bit-identical outputs; autotuning can change kernels. A link must describe the settings applied to the displayed map. Drafts, camera and annotations do not all play the same role in generation.

Rendering turns data into a map: biome colors, shading, contours, textures, vegetation and symbols. Diagnostic and mask resolution imposes a geometric limit; finer zoom does not automatically add physical information. Generation, adaptations, transfers, scene preparation and display must be measured separately. [Current renderer](../web/src/render); [interfaces and workers](../web/src/ui).

The current interface is intended to be retained. The renderer and bench contracts remain transitional. Integration prioritizes connecting coherent stages while preserving their independence; produced maps remain procedural creations for cartography and games, with explicit physical, demographic and historical simplifications.

## 9. References

Sources consulted October 14, 2026. The papers establish or situate methods; files linked in the sections describe their local adaptation.

| Reference | Relevant contribution |
| --- | --- |
| [Perlin, K. (2002), *Improving Noise*](https://mrl.cs.nyu.edu/~perlin/paper445.pdf) | Coherent gradient noise; context for local simplex noise |
| [Barnes, R., Lehman, C. and Mulla, D. (2014), *Priority-Flood: An Optimal Depression-Filling and Watershed-Labeling Algorithm for Digital Elevation Models*](https://doi.org/10.1016/j.cageo.2013.04.024) | Depressions and basins; Computers & Geosciences 62, 117–127 |
| [Tarboton, D. (1997), *A New Method for the Determination of Flow Directions and Upslope Areas in Grid Digital Elevation Models*](https://doi.org/10.1029/96WR03137) | D∞; Water Resources Research 33(2), 309–319 |
| [Braun, J. and Willett, S. D. (2013), *A Very Efficient O(n), Implicit and Parallel Method to Solve the Stream Power Equation Governing Fluvial Incision and Landscape Evolution*](https://doi.org/10.1016/j.geomorph.2012.10.008) | Implicit incision; Geomorphology 180–181, 170–179 |
| [Barnes, R., Callaghan, K. L. and Wickert, A. D. (2021), *Computing Water Flow through Complex Landscapes — Part 3: Fill–Spill–Merge*](https://esurf.copernicus.org/articles/9/105/2021/) | Routing through depression hierarchies; Earth Surface Dynamics 9, 105–121 |
| [Howard, A. D. and Knutson, T. R. (1984), *Sufficient Conditions for River Meandering: A Simulation Approach*](https://doi.org/10.1029/WR020i011p01659) | Comparative meander reference; Water Resources Research 20(11), 1659–1667 |
| [Goslin, A. (2025/2026), *InfiniteDiffusion: Bridging Learned Fidelity and Procedural Utility for Open-World Terrain Generation*](https://arxiv.org/abs/2512.08309) | Unbounded, lazy and consistent generation; [authors' code](https://github.com/xandergos/terrain-diffusion) |
| [Karras et al. (2022), *Elucidating the Design Space of Diffusion-Based Generative Models*](https://arxiv.org/abs/2206.00364) | EDM formulation and sampling |
| [Karras et al. (2024), *Analyzing and Improving the Training Dynamics of Diffusion Models*](https://arxiv.org/abs/2312.02696) | EDM2 architecture and magnitude preservation |
| [Song, Y., Dhariwal, P., Chen, M. and Sutskever, I. (2023), *Consistency Models*](https://proceedings.mlr.press/v202/song23a.html) | Few-evaluation generation and distillation; ICML, PMLR 202 |
| [Galin, E., Peytavie, A., Maréchal, N. and Guérin, E. (2010), *Procedural Generation of Roads*](https://doi.org/10.1111/j.1467-8659.2009.01612.x) | Anisotropic paths and terrain constraints; Computer Graphics Forum 29(2), 429–438 |
| [Parish, Y. I. H. and Müller, P. (2001), *Procedural Modeling of Cities*](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf) | Global goals and local constraints; SIGGRAPH, 301–308 |
| [Chen, G., Esch, G., Wonka, P., Müller, P. and Zhang, E. (2008), *Interactive Procedural Street Modeling*](https://www2.cs.uh.edu/~chengu/Publications/streetModeling/street_sig08.pdf) | Tensor fields and street graphs; ACM Transactions on Graphics 27(3), article 103 |

Software documentation: [WebAssembly](https://webassembly.org/docs/high-level-goals/), [WGSL](https://www.w3.org/TR/WGSL/), [wgpu](https://docs.rs/wgpu/latest/wgpu/), [Burn](https://burn.dev/books/burn/). Related projects: [Terrain Diffusion](https://github.com/xandergos/terrain-diffusion), [World Orogen](https://github.com/raguilar011095/planet_heightmap_generation), [Neural Earth](https://github.com/dunkean/neural-earth).
