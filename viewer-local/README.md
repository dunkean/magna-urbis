# Local SurfaceWorld preview

[French original](README_FR.md).

Godot is a candidate renderer for Magna Urbis 2D/3D RPG maps and plans. Data contracts remain engine-independent; existing palettes, orthographic views and map exports guide its evaluation. SVG/Canvas output currently retains labels and final composition that are not reproduced here. This project generates no terrain and changes neither source heights, native urban volumes nor their material IDs.

## Install and launch

Pinned versions: **Godot 4.7.2 stable**, **Terrain3D 1.0.2 stable**. The Windows bootstrap verifies the Terrain3D archive's SHA-256 and installs the extension outside Git. Install the engine separately. Forward+ is the default backend and supports road Decals. Compatibility is a fallback with different capabilities.

```powershell
$env:GODOT = 'C:/tools/Godot_v4.7.2-stable_win64_console.exe'
./viewer-local/bootstrap.ps1 -Godot $env:GODOT
node web/scripts/surface_viewer.mjs --check
node web/scripts/surface_viewer.mjs --world C:/data/world.surfacebin --assets C:/data/surface-assets/resolved.json
```

The launcher accepts `--godot <executable>` and `--renderer forward_plus|mobile|gl_compatibility`. Relative paths resolve from the current directory. It imports the project on first launch. `--check` verifies scripts, the Terrain3D shader contract and versions; a GPU test is still required to qualify a backend. On Linux/macOS, unpack the pinned zip into `viewer-local/` and import with `godot --headless --path viewer-local --editor --import --quit`. Windows measurements do not qualify those platforms.

The viewer accepts `magna-surface-packet` v1 JSON, `SurfaceWorld` JSON, and **MUFSURF1** binary transport. The latter preserves typed columns, urban double precision and sentinels; it avoids giant JSON strings for 1024² grids. Urban and population columns are read without materializing a million JavaScript/Godot objects. Canonical schemas remain under `web/src/surface/`.

`resolved.json` comes from `web/scripts/surface_assets.mjs`. Its maps are local: offline rendering performs no downloads. The current catalog has fifteen CC0 PBR sets; `recipeIds` takes priority over family fallback. Without a catalog, the analytical fallback material is explicit. A missing height map becomes flat texture relief with a warning. `SurfaceMaterialLibrary.asset_version` and `asset_digest` identify actually loaded assets, their bindings, physical sizes, amplitudes, and declared and observed SHA-256 values. Absolute paths and key order do not enter the digest. `loaded_asset_bindings` exposes layers and their linear means. This render provenance is distinct from `World.versions.materialLibrary`, which describes canonical-model recipes.

Vegetation assets have separate manifests: `--vegetation-assets C:/data/grass/resolved.json` enables CC0 tufts in aerial view; `--tree-assets C:/data/tree/resolved.json` enables the experimental tree path with near meshes, impostors and a shared optical mask. Map glyphs retain their presentation. These options change no height, candidate identity, rock or river. See [tree preparation](../docs/surface/TREE_ASSET_EXPERIMENT.md) and [grass evidence](../docs/surface/evidence/vegetation-grass-v13/README.md). The campaign driver passes `--viewer-vegetation-assets` and `--viewer-tree-assets` respectively and checks manifests at the beginning and end.

The `surface-1.6.0` compiler provides [continuous ground response](../docs/surface/GROUND_RESPONSE.md): physical parameters are interpolated before the recipe. Older packets retain their previous rendering; the viewer does not reconstruct fine soils from their colors. Ground, grass/litter and trees remain three independent layers.

## Views and map styles

```powershell
node web/scripts/surface_viewer.mjs --world C:/data/city.surfacebin --presentation cartographic --style blueprint --top
node web/scripts/surface_viewer.mjs --world C:/data/world.surfacebin --assets C:/data/surface-assets/resolved.json --presentation aerial
```

The packet carries `presentation`, a copy of the shared palette and its provenance. The launcher also supplies `surface/presentation/palettes.json`, exported from existing styles, for `--style` overrides. The profile retains the identity of fifteen terrain styles, their palettes and water metadata. Godot previews the palette, urban mass hierarchy, native material groups and orthographic view. Fantasy brushes, composition, labels and final layout remain the responsibility of existing web renderers.

Cartographic view uses linear exposure, white ambient light and no direct sun. Projected roads can thus retain CSS colors. Aerial view uses PBR materials and preview tints associated with native patterns (`tile`, `wood`, `stone`, etc.). These tints do not rewrite the source architecture catalog. The material cache is bounded and distinguishes palettes, slot assignments and source IDs.

The diagnostic interface is hidden by default; `--hud` or `H` shows it. Wheel: zoom; left drag: pan; `O`: top/oblique; `1` to `7`: 40 km to 10 m; `D`: diagnostics; `F`: inspect center JSON; `S`: capture; Escape: profile and close. Orthographic width and meters/pixel spacing are exact. In perspective, the stated spacing applies to the targeted center plane.

The diagnostic HUD follows the system language when it is French, English, simplified Chinese, Spanish or Portuguese; other languages fall back to English. Pass `--locale fr|en|zh|es|pt` to select one explicitly. Source warnings and material identifiers retain their original text.

## Captures, profiles and GPU checks

```powershell
node web/scripts/surface_viewer.mjs --world C:/data/world.surfacebin --assets C:/data/surface-assets/resolved.json --width 10 --top --frames 180 --capture C:/data/close.png --metrics C:/data/close.json
node web/scripts/surface_viewer.mjs --world C:/data/world.surfacebin --assets C:/data/surface-assets/resolved.json --top --tour C:/data/tour --metrics C:/data/tour.json
```

`--x` and `--z` set the canonical center. `--frames` and `--tour` disable input for reproducible capture. A tour step waits for preparation and the applied live response, or that request's explicit error, then stabilizes frames. Profiles separate CPU preparation, region/object import, navigation time, viewport-measured CPU/GPU rendering and reported graphics memory. Frame quantiles include vertical synchronization; GPU timestamps do not measure all CPU cost and remain absent if the backend provides no positive sample.

Independent checks, using the same Godot executable and `viewer-local` directory:

```powershell
& $env:GODOT --path viewer-local --rendering-method forward_plus --script diagnostics/material_mean_probe.gd -- C:/data/surface-assets/resolved.json C:/data/material-mean.json
& $env:GODOT --path viewer-local --rendering-method forward_plus --script diagnostics/normal_frame_probe.gd
& $env:GODOT --path viewer-local --rendering-method forward_plus --script diagnostics/cartographic_decal_probe.gd -- C:/data/decal-probe
& $env:GODOT --headless --path viewer-local --script diagnostics/presentation_probe.gd -- surface/presentation/palettes.json
& $env:GODOT --headless --path viewer-local --script diagnostics/asset_provenance_probe.gd
```

`material_mean_probe` uses the production sampler and three footprints per material, then compares an origin shifted by 64 m across 4096 m. On RTX 4090 Forward+, fifteen PBR sets and the fallback produced a maximum linear-mean error of **0.154%**, and a rebase difference of **one 8-bit level**. Normal rotation by 0/90/180/270° produced zero encoded difference in the GPU probe. The Decal probe gives the exact CSS road color, with zero differing pixels after ±2 m ground deformation; ground differs from its target by less than one 8-bit level. These isolated checks do not constitute complete visual qualification.

## Source, precision and on-demand supply

The camera retains canonical coordinates in double precision. Origin subtraction precedes GPU coordinates. Terrain3D windows are rebuilt from the source and replaced together; the node is not simply translated. Display spacing and origins follow the source grid. Terrain3D limits spacing to 0.25–100 m: display interpolation remains distinct from `sourceLOD`, `nativeSpacingM` and `sourceLODKnown`.

Shaders reconstruct weights for both materials of each of the context's four neighbors. Color means are linear. PBR maps use linear RGBA16F color/height and normal/roughness, in 1024² arrays with mips. Transforms and stochastic weights are shared across maps; OpenGL normals rotate in the same frame. Color variation is centered on the mean and bounded without amplifying dark targets. Derivatives are computed before branches; macro noise is filtered by footprint.

`--live-url http://127.0.0.1:PORT/surface-live/terrain` uses the active Terrain Bench browser and its real engine. `--session-id` optionally selects its session, not a world. Requests specify a minimum origin, extent and resolution and remain within the retained context footprint. `knownContextId` and `knownSceneContextId` avoid retransmitting unchanged context and city. Parents remain visible during loading; a provider error retains the last valid world and provenance. The viewer never replaces a decoder error with terrain noise.

`--stream-dir <directory>` also permits file-based requests/responses; the provider must publish responses atomically. An offline export does not prove source refinement was generated on demand.

## Preview limitations

Region transfer can exceed 16.7 ms; profiles report it. Trees, shrubs and debris are simple geometric representatives. Distant cover uses the candidate-crown atlas and their transmittance; this is not a photographic forest. There is no certified centimeter-scale microgeometry. Zooming to 1 cm/pixel adds no information to a coarse DEM. Water retains supplied classes/levels; shores depend on their support. Native urban volumes are retained; cartographic proxies remain identified as such and hidden by default. Projected roads do not earthwork terrain. Current Godot rendering does not yet replace Magna Urbis's finished map styles.

References: [Terrain3D 1.0.2](https://github.com/TokisanGames/Terrain3D/releases/tag/v1.0.2-stable), [Terrain3D regions](https://terrain3d.readthedocs.io/en/stable/api/class_terrain3ddata.html), [Godot environment and tonemapping](https://docs.godotengine.org/en/stable/tutorials/3d/environment_and_post_processing.html). The Terrain3D shader's MIT license remains in the archive installed by the bootstrap.

## Ground, low cover and canopy

Modern packets carry the nine `ground*` / `lowCover*` fields: physical ground (rock, deposits, humus), low cover (grass, low shrubs and litter) and trees remain independent layers. Canopy does not rename a ground texture. `--layers all|ground|low-cover|canopy` and `set_layer_visibility(ground, low_cover, trees)` isolate these representations without changing heights, fields or source IDs. An old composite packet is reported as `legacy-composite-unavailable`: its bare ground cannot be reconstructed. Low-cover means are premultiplied by opacity before filtering; colors, normals and roughness of transparent texels do not contribute.

Unlit diagnostics 7, 8, 9 and 10 isolate ground mean, low-cover opacity, `treeCover` and geometric normal respectively. 11 and 12 show low cover and optical canopy residual; 13 and 14 isolate ground roughness and normal; 15 and 16 isolate refined rock detail. Diagnostics 17–19 support compositor evidence (mean, roughness, normal), not aesthetic map export.

The supplied tree inventory is exact within its declared page. Beyond that, a coverage-calibrated optical crown approximation uses only the canonical seed and world coordinates. These approximate positions are never inventory IDs. The pattern converges to the mean when statistical crown diameter becomes subpixel; the page transition is C1 and instances are selected by rank within an interior band. Painted crowns have an optical normal and approximate shadow transfer (authored crown center 8 m, sun direction, RGB transmission [0.25, 0.34, 0.50]). This transfer does not claim to reproduce geometric shadows on sloping receivers or exactly conserve light energy. It is removed with the tree layer and disabled in cartography. Real-instance shadows and colors use the same main-camera LOD, including during light shadow passes.

## Hydrology of fixed maps

For a fixed Magna map, the default `--water-mode source-map` projects retained hydrological contours onto terrain only (Decal, mask 1). Buildings and trees, on mask 2, remain occluders. This water is a projected cartographic representation, including in the PBR aerial view; it is not a physical water surface fitted to terrain. `--water-mode source-levels` retains the presentation of measured levels and their possible conflicts with terrain. No source level, bed or network is raised, carved or recomputed to correct presentation. Projection preserves source widths and may lose a subpixel watercourse; no minimum stroke is added. Its budgets, omissions and conflicts are reported in each capture's metrics. GPU baking of an immutable snapshot precedes its application; captures wait for it to finish. Forward+ is required for terrain-only projection.

For readable regional mapper output, source-map water defaults to a declared 1.25-screen-pixel outline of retained Float64 vector contours. Metadata separates that display recipe from source geometry, levels and areas. Use `--water-symbol-width-px 0` for unexpanded contours; source-levels physical mode never enables symbols. See [the policy and limits](../docs/surface/WATER_SYMBOLS.md).
