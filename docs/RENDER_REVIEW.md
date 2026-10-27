# State of the art — Procedural generation of very high-resolution textures

Technical and scientific review · October 23, 2026 · Neural Earth / Magna Urbis

> English translation of the [French original](RENDER_REVIEW_FR.md).

## 1. Summary: what exists and what is relevant

Neural Earth and Magna Urbis have a particular objective: produce realistic surface detail at scales from 10 cm to 1 cm over potentially immense territories, while allowing free zoom without visible seams or repetition.

Many open-source solutions exist, but they do not all solve the same problem. Five families can be distinguished:

1. Pure mathematical shaders: procedural noise, Voronoi, domain warping, and distance functions. Direct evaluation in world coordinates without a precomputed texture.
2. Example-based texture synthesis: create an infinite surface from a small reference texture without obvious repetition.
3. Structured, contextual generation: stones, cracks, pebbles, grasses, paving stones, sand deposits, etc., positioned according to physical or spatial rules.
4. PBR material generators: produce colors, relief, normals, roughness, and other surface properties from procedural graphs.
5. Neural and diffusion methods: learn the visual distribution of a material and generate variants, potentially conditioned on the environment.

For these projects, a hybrid architecture is preferred: the shader performs most real-time work, while generative models mainly create materials, variants, and structured details.

At centimeter scale, adding noise octaves is generally no longer sufficient for convincing rendering. Recognizable objects — grains, stones, debris, vegetation tufts, cracks, and joints — and their spatial organization must be represented.

## 2. Comparing the major approaches

| Approach | Potential realism | Real-time GPU | Deterministic zoom | Value |
| --- | --- | --- | --- | --- |
| Noise / fBm / Voronoi / warping | Medium to good | Excellent | Excellent | Essential foundation |
| Stochastic texture tiling | Very good | Very good | Excellent | Priority |
| Wang tiles / patch synthesis | Very good | Very good | Excellent | Priority |
| Primitive / SDF scatter | Very good | Good to excellent | Excellent | Priority at 1–10 cm |
| Procedural PBR materials | Very good | Good, depending on complexity | Excellent | Material creation |
| Texture diffusion | Very good to excellent | Poor for direct generation | Difficult | Offline production |
| Neural texture networks | Potentially excellent | Variable | To be designed | Research to explore |

The academic *Survey of Procedural Methods for Two-Dimensional Texture Generation* (2020), available through [PMC](https://pmc.ncbi.nlm.nih.gov/), surveys structured and unstructured textures and their combination.

Two techniques deserve attention ahead of some newer generative models: stochastic tiling and Wang tiles. Both enable very large surfaces with high visual diversity and fast, reproducible evaluation.

## 3. Classical methods to study first

### 3.1. Stochastic texturing: photorealism without repetition

Very high priority · 2D and 3D · Compatible with real-time shaders

The most directly applicable family is the work of Eric Heitz and Fabrice Neyret. Foundational publications:

- Heitz & Neyret, *High-Performance By-Example Noise Using a Histogram-Preserving Blending Operator*, HPG 2018.
- Deliot & Heitz, *Procedural Stochastic Textures by Tiling and Blending*, GPU Zen 2.
- Mikkelsen, *Practical Real-Time Hex-Tiling*, JCGT 2022.

A 512 × 512 rock texture repeated over a mountain quickly becomes recognizable. The solution uses a triangular or hexagonal grid to sample the texture with pseudorandom transformations and blend samples at boundaries. It:

- Does not require generating a new giant image.
- Can evaluate the material directly from world coordinates.
- Produces immense surface variety from a few samples.
- Preserves material statistics to varying degrees depending on the method.

Heitz's method notably uses a histogram transform to prevent blending from reducing contrast. Mikkelsen offers a simplified version, easier to integrate and particularly interesting for normal maps.

Directly usable code:

- [mmikk/hextile-demo](https://github.com/mmikk/hextile-demo?utm_source=chatgpt.com) — MIT, implementation accompanying Mikkelsen, including a variant maintaining precision far from the origin.
- [UnityLabs/procedural-stochastic-texturing](https://github.com/UnityLabs/procedural-stochastic-texturing?utm_source=chatgpt.com) — complete Heitz/Deliot example, archived since 2025 but still usable as a reference.

The method works well for earth, sand, granular rock, and fine gravel. It is less suited to strongly structured patterns such as large paving stones, long cracks, or agricultural furrows: blending can break their geometry.

### 3.2. Wang tiles: structured materials over infinite surfaces

Very high priority for ground, paving, walls, and paths

The reference is Cohen et al., *Wang Tiles for Image and Texture Generation*, SIGGRAPH 2003. A small tile atlas has edge-matching constraints; tiles are assembled under those constraints to produce a large nonperiodic surface without visible seams.

| Material | Wang-tile use |
| --- | --- |
| Paved street | Variation in placement and wear of stones |
| Rocky ground | Assembly of fractured slabs |
| Forest floor | Distribution of leaves, moss, and stones |
| Fields | Small coherent patterns and controlled repetition |
| Roofs | Tile or shingle variation |
| Ancient ground | Mosaics and irregular paving |

Tile choice can be deterministic from world cells and a seed without saving the generated map. On-demand generation in arbitrary order nevertheless requires a selection scheme compatible with neighboring constraints.

Wei & Levoy's *Order-Independent Texture Synthesis* (2003) explicitly addresses arbitrary-order texel generation with a pyramidal representation and cache, close to the zoom-exploration problem.

### 3.3. Noise more sophisticated than Perlin and fBm

Some algorithms suit particular material structures better than classical fractal noise.

| Technique | Characteristic | Applications |
| --- | --- | --- |
| Worley / cellular | Distances to sites | Pebbles, stones, mud cells |
| Domain warping | Spatial distortion of patterns | Rock, marble, organic soils |
| Gabor noise | Frequency and direction control | Striations, sand, anisotropy |
| Wavelet noise | Frequency control | Microrelief, filterable details |
| Reaction–diffusion | Emerging biological structures | Mosses, lichens, deposit patterns |
| Sparse textons | Primitives distributed in space | Stones, leaves, grains, debris |
| SDF | Signed distances to shapes | Cracks, joints, stone outlines |

Gabor noise merits special attention. Lagae et al. (SIGGRAPH 2009) propose procedural sparse-convolution noise with spectral control. It suits materials with a dominant pattern orientation, such as rock strata or wind ripples.

Practical mathematical-noise foundations include [FastNoiseLite](https://github.com/Auburn/FastNoiseLite?utm_source=chatgpt.com) (MIT, Rust, JS, GLSL, HLSL, etc.) and [procedural-tileable-shaders](https://github.com/tuxalin/procedural-tileable-shaders?utm_source=chatgpt.com) (MIT, GLSL, including warping and cellular noise).

### 3.4. Texture bombing and textons: the centimeter-object layer

This is probably what a renderer based exclusively on noise bands lacks most. Instead of visually simulating stones with a continuous function, place them explicitly:

\\[ P_i = f(\\operatorname{hash}(\\text{cell}_i,\\text{seed})) \\]

Each object has a position, orientation, size, shape, and optionally a material. The shader evaluates only objects in the pixel's neighborhood; sprites, distance functions, or analytical relief can be associated with them.

This produces actual distributions of:

- 1–10 cm stones in soil.
- Leaves and twigs on earth.
- Grass tufts and low plants.
- Water-arranged pebbles.
- Debris and rubble around buildings.

To avoid an overly random appearance, use context-dependent spatial distributions: Poisson disk / blue noise, clusters, and distributions conditioned by slope, flow, or paths. This is closer to procedural generation of a microscopic 2D scene than conventional texturing, a fundamental distinction for this use.

## 4. Concrete open-source projects

| Project | Technology | Value |
| --- | --- | --- |
| [Material Maker](https://github.com/RodZill4/material-maker?utm_source=chatgpt.com) | Godot, GLSL, graphs | Excellent for material creation |
| [Hex-Tile Demo](https://github.com/mmikk/hextile-demo?utm_source=chatgpt.com) | C++ / shaders | Excellent for breaking tiling |
| [FastNoiseLite](https://github.com/Auburn/FastNoiseLite?utm_source=chatgpt.com) | Multilanguage | Reproducible noise foundation |
| [Tileable Shaders](https://github.com/tuxalin/procedural-tileable-shaders?utm_source=chatgpt.com) | GLSL | Shader primitives |
| [TextureLab](https://github.com/njbrown/texturelab?utm_source=chatgpt.com) | Electron, GPU | Tileable texture editor |
| [VFX Texture Lab](https://github.com/MattyGWS/VFXTextureLab?utm_source=chatgpt.com) | WGSL, GPU | Experimental graphs and materials |
| [DiffMat](https://github.com/mit-gfx/diffmat?utm_source=chatgpt.com) | PyTorch | Material graph optimization |
| [MatFuse](https://github.com/giuvecchio/matfuse?utm_source=chatgpt.com) | PyTorch, diffusion | Neural PBR generation |
| [MatLat](https://github.com/KAIST-Visual-AI-Group/MatLat?utm_source=chatgpt.com) | PyTorch, diffusion | Recent PBR latent research |
| [Water Shader](https://github.com/tuxalin/water-shader?utm_source=chatgpt.com) | HLSL | Procedural water reference |
| [Unity Voronoi Water](https://github.com/cbunt/unity-voronoi-water?utm_source=chatgpt.com) | Shader Graph | Stylized water and flow maps |

The neural projects are discussed in the next section.

### A closer look at Material Maker

[Material Maker – Godot Engine illustration](https://images.openai.com/static-rsc-4/xdzphVfRdnHd4Dsx0sIy-rsKwRRN1UT5rd5lby6_0tpiUJTqvzbEL4tn73Eq2DqkAPXicFbbugfMSIqvN7hTC2U24R109mubarYHUHSRudexIb56TalXy4OvqkSbr0ZJmTJi6GTRq9xrO2EWqjiTIDk36r8rMIGqoGTg2fWX6rg?purpose=inline)

This is probably the best practical starting point. The application supplies over 200 nodes, PBR materials, a community library, and the ability to create GLSL nodes. Its repository is MIT-licensed.

A soil, rock, or stone texture can be designed, its maps exported, and those used in a 2D WebGPU engine. This separates material creation from application to a procedural world: a curated material library can coexist with a general-purpose renderer.

A Material Maker graph should not, however, be assumed to run automatically in WGSL: exporting maps is simple; dynamically porting graphs takes additional work.

### Two other tools to watch

VFX Texture Lab has a graph architecture using WGSL for GPU evaluation, with noise, shape, erosion, height, normal, and material nodes. It is interesting for a WebGPU pipeline, but remains in public beta.

MIT's DiffMat is more research-oriented. It makes material graphs differentiable and optimizes their parameters to reproduce a reference image, a promising way to turn a ground photograph into a procedural recipe. The repository license is noncommercial and some features still require proprietary Adobe tools.

## 5. Neural state of the art: 2024–2026

Research is moving from models that produce only RGB images toward models generating complete, consistent materials with albedo, height, normals, and roughness. Two problems must be distinguished:

- Generate an excellent 2 × 2 meter material.
- Generate that material over an infinite territory with spatial, climatic, and geological consistency.

Research is advancing rapidly on the first; the second remains largely a systems-integration problem.

### Recent work to follow

[MatFuse](https://github.com/giuvecchio/matfuse?utm_source=chatgpt.com) — CVPR 2024. Diffusion-based SVBRDF generation conditioned by text, image, sketch, or palette. Material maps are represented in a learned latent space. PyTorch code is available under MIT, making it an interesting experimental basis for generating material libraries.

[StableMaterials](https://openaccess.thecvf.com/content/CVPR2026/html/Vecchio_StableMaterials_Enhancing_Diversity_in_Material_Generation_via_Semi-Supervised_Learning_CVPR_2026_paper.html?utm_source=chatgpt.com) — CVPR 2026. Among recent work, this is especially relevant to the problem. It uses latent diffusion, semi-supervised learning to increase material diversity, and distillation enabling four-step generation. It also introduces seamless tiling. It directly targets PBR material variety, unlike much work on 3D meshes. The paper and presentation are available; availability of a complete reusable repository was not confirmed.

[MatLat](https://github.com/KAIST-Visual-AI-Group/MatLat?utm_source=chatgpt.com) — CVPR 2026. Introduces a specialized PBR-material latent space built from a pretrained VAE, better preserving local information across material maps. Code and checkpoints are published. It is principally a 3D object texturing model and therefore less directly applicable to an infinite 2D world.

[ProcTex](https://github.com/ruiqixu37/ProcTex?utm_source=chatgpt.com) — Eurographics 2026. Addresses a problem particularly relevant to Magna Urbis: consistent appearance across instances of a procedural model. It generates a texture on a reference shape, then learns correspondences to transfer it to shape variants. Code is MIT-licensed; the repository mentions configurations tested on RTX 4090 and 5090. It would apply more to building families than continuous ground.

[Texture Space Material Diffusion](https://nvlabs.github.io/texdiffusion/?utm_source=chatgpt.com) — NVIDIA, September 2026. Generates PBR maps up to 8K by diffusion directly in texture space. It can be conditioned on text, photographs, and low-resolution material maps. It is useful for material generation and refinement, but is not designed to generate pixels of an infinite territory on the fly.

Two other publications merit mention: *MaTi — Make PBR Materials Tileable With Latent Diffusion Inpainting* (2025), which makes non-tileable materials seamless, and *TexPro* (2025), which seeks to reconstruct procedural PBR materials from text descriptions.

### What this research suggests for Neural Earth

Three realistic AI uses are proposed:

1. **Offline material generation.** Create, for example, 20 volcanic-soil, 30 sedimentary-rock, and 15 mud variants. These form a reusable library for a deterministic shader.
2. **Procedural-material optimization.** Instead of generating final pixels, learn graph parameters such as pebble density, size distribution, colors, and crack frequency. This is illustrated by MATch, DiffMat, and *Generating Procedural Materials from Text or Image Prompts* (SIGGRAPH 2023).
3. **Locally conditioned generation.** More experimentally, train a model to produce surface detail from geology, moisture, slope, land use, water proximity, and other context. Spatial and multi-scale consistency would need to be imposed explicitly.

The last direction is potentially scientifically original, but not the most economical starting point for a convincing result quickly.

## 6. Useful datasets

- [Poly Haven](https://polyhaven.com/textures?utm_source=chatgpt.com): photographic, generally high-resolution CC0 PBR materials; a good choice for rock, earth, paving, and natural surfaces.
- [ambientCG](https://ambientcg.com?utm_source=chatgpt.com): a large CC0 library of ground, gravel, stone, mud, and architectural materials, useful for automatically populating atlases.
- [MatSynth](https://www.gvecchio.com/matsynth?utm_source=chatgpt.com) — CVPR 2024: over 4,000 high-resolution CC0 PBR materials with metadata and associated renders, useful for training or evaluating a specialized generator.

Retain physical-scale metadata where available. A 2K image covering 50 cm means something very different from one covering 5 m. Height and normal maps must also have consistent scales.

## 7. Approach by surface type

At centimeter scale, each material family needs a different strategy:

| Surface | Preferred technique | Contextual information |
| --- | --- | --- |
| Dry earth | Stochastic tiling + grains + cracks | Soil texture, moisture |
| Wet earth / mud | Voronoi, height map, roughness variation | Water, drainage, traffic |
| Sand | Directional noise, ripples, grains | Wind, slope, moisture |
| Gravel | Texton placement + atlas | Grain size, transport |
| Massive rock | PBR material + SDF cracks | Lithology, fracturing |
| Scree | Hierarchical fragment scatter | Slope, erosion |
| Short grass | Sprites / textons + background material | Climate, trampling |
| Forest litter | Leaf and twig scatter | Vegetation type |
| Snow | Irregular surface, hollows, and crusts | Wind, melting, shading |
| Paving stones / slabs | Structural paving + PBR wear | Roads, culture, age |
| Still water | Animated normals + reflection | Wind, depth |
| Flowing water | Flow map + normals + foam | Speed, depth, obstacles |

### Special case: water

Water should not be treated as a simple tileable material. For rivers and coasts, separate water geometry from visual details. The latter can be produced with:

\\[ C(x,y,t) = F\\big(d_{\\text{shore}},h_{\\text{water}},\\vec v,\\nabla z,N(x,y,t)\\big) \\]

Here `d_shore` is signed distance to shore, `h_water` is depth, `v` is the current velocity field, `∇z` represents terrain variation, and `N` is animated noise.

For small streams this orients ripples along the current, generates turbulence near obstacles, and places foam bands near banks. Oceans can add spectral components or even FFT simulation for a true 3D surface, though a full ocean FFT seems disproportionate for a top-down map view.

[water-shader](https://github.com/tuxalin/water-shader?utm_source=chatgpt.com) and [unity-voronoi-water](https://github.com/cbunt/unity-voronoi-water?utm_source=chatgpt.com) provide examples of procedural water effects and flow maps, respectively.

### Special case: roads and urban ground

A paved street in Magna Urbis should not be generated solely with a texture. Paving structure depends on street geometry: stone orientation, curbs, gutters, transitions to walls, and so on.

The urban generator defines paving stones or their cells. The shader then adds material, small cracks, wear, color variations, and dirt. This avoids asking the shader to reconstruct structure the generator already knows.


## 8. Proposed architecture for both projects

The [Neural Earth Render3D documentation](https://github.com/dunkean/neural-earth/blob/main/docs/render3d.md?utm_source=chatgpt.com) addresses many difficult problems already:

- Material evaluation in physical coordinates.
- Numerical precision far from the origin.
- Progressive appearance of detail according to pixel footprint.
- GGX lighting integration.
- Deterministic grains, small relief, and vegetation.

The current implementation uses four ground-detail bands at 8 m, 2.2 m, 0.32 m, and 0.055 m. Rendering can reach 1/128 m per pixel, with unresolved frequencies contributing to roughness instead of aliased visual detail. This is a suitable foundation to retain.

### Proposed pipeline

```text
Neural Earth / Magna Urbis
  Biomes · geology · slope · hydrology · land use · roads
       ↓
Contextual material field
  Material weights, moisture, directionality, object density
       ↓
Procedural shader                       Material atlas
  Noise · SDF · analytical relief         Photogrammetry · Material Maker
  · deterministic scatter                 · generative textures
       ↓                                  ↓
Stochastic composition
  Hex tiling · Wang tiles · material blending · physical masks
       ↓
Render3D / WebGPU
  Albedo · relief · normals · roughness · lighting · multi-scale antialiasing
```

This pipeline could be shared despite the projects' different territorial representations.

### A useful representation: probabilistic material

Instead of associating a single texture with each pixel, represent a local composition:

\\[ M(x,y)=\\{(w_i,\\theta_i,s_i)\\}_{i=1}^{K} \\]

Here `w_i` is material proportion, `θ_i` orientation, and `s_i` physical scale. For example, ground beside a river could comprise 60% gravel, 25% sand, and 15% silt. The engine would arrange components spatially rather than blend them uniformly pixel by pixel.

Geology and hydrology would determine proportions and distributions; the shader would perform fine synthesis. This maintains physical continuity from landscape scale down to small detail.

## 9. The central problem: consistency from 10 m to 1 cm

The difficulty is not maximum resolution, but transition between scales.

| Characteristic scale | Dominant representation |
| --- | --- |
| 100–10 m | Geology, terrain, ground cover |
| 10–1 m | Outcrops, large stones, tufts, paths |
| 1 m–10 cm | Stones, roots, mud patches, cracks |
| 10–1 cm | Small gravel, leaves, joints, fine relief |
| Below 1 cm | Filtered microstructure, statistical roughness |

The system must avoid two recurring defects. First, arbitrary appearance of detail: if a stone becomes visible at 5 cm/px, its aggregate contribution should ideally already appear at 20 cm/px. LOD changes must preserve average appearance and, where possible, roughness properties.

Second, zoom and boundary inconsistencies: a grain must retain its position as the camera moves, and objects must not be cut or resampled differently between tiles. A worldwide implementation should consistently use integer cell coordinates and hierarchical seeds, with local shader evaluation. Existing tile-origin handling already points in that direction.

Remaining documented limits include possible detail drift between some LODs, distortion toward the poles in planetary projection, and discontinuities at the antimeridian.

### Why not precompute everything

At 1 cm per pixel, a 1 km square already represents 10 billion pixels, or approximately 40 GB for one uncompressed RGBA8 image. Materials must therefore be evaluated on demand according to displayed pixel footprints, rather than always generating maximum resolution.

A 512 × 512 tile at 1 cm/px covers only 5.12 × 5.12 m on the ground. The actual memory budget depends on the visible area, caches, and loaded material maps, not the planet's total area.

## 10. Experimental roadmap

Benchmark in four stages, directly reusing existing Render3D rendering:

| Stage | Experiment | Success criterion |
| --- | --- | --- |
| 1 | Integrate a photographic material and hex tiling in WebGPU | Credible rendering without repetition or seams |
| 2 | Add consistent height, normals, and roughness | Good rendering under multiple light directions |
| 3 | Add deterministic scatter of centimeter-scale objects | Convincing rocky / forest ground when zoomed in |
| 4 | Condition materials on local context | Natural transitions between rock, sand, earth, and vegetation |

Compare three representative scenes: volcanic ground with scree, a sedimentary riverbank, and a worn medieval paved street. Measure 1080p smoothness, tile and LOD discontinuities, stability during camera motion, and especially visible repetition over large areas. Neural Earth's documented timings offer a starting comparison, not a guarantee for new methods.

## 11. Ranking of directions to explore

| Rank | Direction | Likely contribution | Estimated effort |
| --- | --- | --- | --- |
| 1 | Mikkelsen hex tiling | Very strong for natural materials | Low to medium |
| 2 | PBR library from Material Maker and Poly Haven | Very strong immediate realism | Low to medium |
| 3 | Deterministic texture bombing / textons | Very strong at centimeter scale | Medium |
| 4 | Wang tiles for structures | Strong for Magna Urbis | Medium |
| 5 | Geological and hydrological conditioning | Strong for world consistency | Medium to high |
| 6 | MatFuse / StableMaterials for offline generation | Strong for diversity | Medium |
| 7 | Direct learning of an infinite neural material field | Uncertain but interesting research | High |

### Conclusion

For near-term results, combine photographic or synthetic PBR textures, nonrepeating stochastic sampling, and procedurally structured details. A multi-scale renderer with coordinate management, filtering, and lighting is already in place.

The most visible improvement is likely to come from replacing noise bands with a genuine description of physical ground composition, so the shader knows whether to draw sand, stones, cracks, leaves, or paving.

For neural research, prioritize StableMaterials, MatFuse, and procedural-graph generation models. They could automatically create hundreds of consistent materials from a few references and environmental parameters. This is a promising balance between visual quality, generativity, real-time performance, and Neural Earth's ambition to zoom anywhere in the world without precomputing what is there.
