# Next artistic step: close vegetation

This page preserves the initial audit, before import. Work executed since is documented separately: [GPU grasses](evidence/vegetation-grass-v13/README.md), [tree preparation](evidence/vegetation-tree-v13/README.md), [experimental consumer](TREE_ASSET_EXPERIMENT.md) and [independent optical audit](TREE_OPTICAL_INDEPENDENT_REVIEW.md).

Audit of 24 October 2026 during the Opus V12 review. Proposal only: no import, geometry download, runtime code, GPU test or ROOT change. V12 remains frozen. Figures below come from metadata and small official glTF documents consulted; they do not measure rendering.

## Findings and first bounded step

`scene/main.gd::_build_populations` currently builds spherical crowns/shrubs, prism grasses and coarse debris. `surface_object.gdshader` has no blade/leaf texture. The fifteen existing PBR sets describe ground/low cover, not trees. `forest_leaves_03` is downloaded but has no recipe/family binding; it is not a crown texture to activate.

**Start with real grasses.** Select a few small `grass_medium_01` clumps, remove their collection presentation offsets, measure bottom pivot/dimensions and normalise height to `candidate.size`. Keep position, orientation, rank, stable variant and identity exactly. Litter remains a low-cover response, distinct from ground and trees. No new candidate, physical field or canonical botanical type is necessary.

Create an engine-neutral `surface/vegetation/catalogue.json` and a `surface_vegetation_library.gd` adapter: source and prepared-product URLs/licences/hashes, submesh name, pivot, dimensions, normalisation, surfaces, maps and colour spaces, alpha policy, budgets. Prepared files are local and versioned by renderer digest; they do not change geology/recipe/population versions. Keep the current cartographic path with source palette and legible glyphs.

## Verified CC0 sources and actual cost

Poly Haven permits modification and redistribution of its assets under [CC0](https://polyhaven.com/license). [API terms](https://github.com/Poly-Haven/Public-API) are separate: attribute ingestion and keep runtime offline.

| Official asset | Contents of consulted glTF | 1k download with dependencies |
|---|---|---:|
| [grass_medium_01](https://api.polyhaven.com/info/grass_medium_01) / [files](https://api.polyhaven.com/files/grass_medium_01) | 17 named clumps; tiny variants of 28–79 triangles, others 290–6,422 | 3,065,099 bytes |
| [tree_small_02](https://api.polyhaven.com/info/tree_small_02) / [files](https://api.polyhaven.com/files/tree_small_02) | 2,062,487 triangles, 3 surfaces | 100,974,143 bytes |
| [fir_tree_01](https://api.polyhaven.com/info/fir_tree_01) / [files](https://api.polyhaven.com/files/fir_tree_01) | 3 meshes of 4,176,819 / 2,300,624 / 505,494 triangles, 4 surfaces each | 487,358,833 bytes |

These are export index counts, different from advertised polygon counts. Raw trees are excluded from the proposed runtime. Reproducible offline preparation is needed, not a stub loading two million triangles. Targets to validate, not yet realized: one broadleaf tree, at most two surfaces, near LOD ≤8k triangles, intermediate ≤1k then impostor; 1–2k atlas. At 64 nearby trees this represents at most 512k triangles; 10k trees at that LOD would be excessive. LOD must follow physical projected size and retain a representation of retained identities.

## Trees: shared mask required before activation

The next substitution concerns a prepared tree **with its alpha/normal/mean-response impostor derived from the same asset**. C and V currently assume solid discs; open foliage changes visible cover. Substituting a glTF without changing this binding would falsify residual painting and could recreate a halo.

The selected-cover atlas must use the same alpha mask, variants and transformations as geometry. Canonical crown support, treeCover, IDs, page/frustum guards and the three layers remain unchanged. V≤C and ≤2 percentage-point coverage guarantees must be remeasured, especially obliquely; they are not inherited from sphere tests. If they fail, this tree remains experimental, and grasses can be delivered separately.

Adapt the vegetation shader for albedo/normal/roughness and tested/hashed alpha, correct TBN under non-uniform transformation, shared camera fade and linear lighting. Do not import BLEND unchanged: [Godot describes its cost/sorting differences](https://docs.godotengine.org/en/stable/tutorials/3d/standard_material_3d.html). Split MultiMeshes by variant/surface/LOD; the current surface-0-only override is unsuitable. Initially retain total-C optical shadows and tree/trunk cast-shadow OFF to avoid a second unqualified shadow model.

## Required evidence and limits

- CPU: hashes/licences/pivots/sizes, strictly unchanged source/candidates, stable variant during zoom/refinement/rebase, bounded buffers and budgets.
- GPU on isolated snapshot: 10 m/160 m/640 m/2,560 m and controlled oblique view; mesh versus impostor, actual MultiMesh, alpha/normals, coverage within two percentage points, pans/page crossings without rectangle/halo.
- Layers/styles: unchanged ground RGB/normal/roughness; grasses/litter and trees/shadows actually removed by their toggles; cartographic styles and buildings preserved.
- QoS: strict 20 s navigation, measured memory, loaded bytes, triangles/draws and upload. [MultiMeshes do not cull individually](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html); large batches must remain bounded. That page itself notes an incomplete 4.7 update: verify on the pinned engine.

Main risks: foliage overdraw, multiple surfaces, preparation cost and optical parity in oblique views. None of these new assets was imported or rendered here; no photorealism or FPS promise. Recommended first delivery: real clumps, then a prepared and qualified tree, without physical-data changes.

[Original French version](VEGETATION_ASSET_NEXT_FR.md).
