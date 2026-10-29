# Neural Earth detail on a retained Magna terrain

The terrain bench can compare Classic, Phasor, Hybrid and MSE on the same retained surface. These modes currently use the local Python service (`npm run neural:python`). They are experiments for detail below the regional source spacing; they do not replace the initial terrain generator or recompute Magna's regional hydrology.

## Inputs and composition

The service receives the retained square height/control grid in metres, its width in metres, a seed, and the selected method. A neural decoder is used only when the original neural world's token and latents remain available. Procedural and imported sources work without neural weights; their decoder octave is explicitly zero.

The adapter imports the sibling Neural Earth implementations without copying their algorithms:

| Mode | Actual implementation |
| --- | --- |
| Classic | `terrain_refinement.sample_refined`, decoder-v12 |
| Phasor | `terrain_phasor.sample_phasor`, phasor-v3, slope-guided ravines |
| Hybrid | `terrain_hybrid.sample_hybrid`, drainage-guided Phasor heights |
| MSE | `terrain_amplification.sample_amplified`, mse-v5, windowed multiscale erosion |

The reference is sampled on its 30 m native lattice. At finer levels its signed-square-root coastal base is subtracted from its metre heights. Only the resulting residual is added to the retained Magna spline. A continuous gain near zero elevation preserves the source's land/sea sign. Tile coordinates are global, with inverse-spline filtering and a halo. Method, intensity and source implementation hashes contribute to source/cache identity. Level zero returns the retained spline.

The exposed service levels use `cell = 30 * displayScale / 2^level`, for levels 1 through 6. Sampling more densely interpolates that finest residual. This adapter does not import Neural Earth's newer LOD -12 interpolation module. The four flow/deposit/scree/rock guide channels computed upstream are not transmitted to Magna's materials in this integration.

## Scope and evidence

`benchmark_neural_amplification.py` compares a real 50 km Magna terrain at 7.5 m and 1.875 m spacing, without neural weights. The recorded run uses a 512² source and a 128² local output. All eight cases were finite, deterministic and identical under a four-quadrant split. Phasor had the largest displacement, Hybrid was more conservative, and the current windowed MSE stayed close to Classic. These results cover one rugged window, not all biomes or a full fine-resolution region. The retained-source benchmark has not exercised the decoder-backed branch.

The matching Rust probe runs Magna's real hydrology on the local outputs. It is a compatibility check, not proof of globally correct catchments: independent local windows cannot supply their own upstream discharge.

## References

- Grenier, Guérin, Galin and Sauvage, [Real-time Terrain Enhancement with Controlled Procedural Patterns](https://doi.org/10.1111/cgf.14992), CGF 43(1), 2024 (first online 2023). Structured procedural detail, not a globally coherent river generator.
- Schott et al., [Terrain Amplification using Multi-scale Erosion](https://research.adobe.com/publication/terrain-amplification-using-multi-scale-erosion/), TOG, 2024; [MIT reference code](https://github.com/H-Schott/MultiScaleErosion). Neural Earth's short-window adaptation differs from whole-landscape runs in the paper.
- [Neural Earth](https://github.com/dunkean/neural-earth), local inspected revision `44681b358990fd00e0c8a978dbc586167400a938`, especially its amplification documentation and three sampler modules.
