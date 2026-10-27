# 40 × 40 km comparison viewer

> The [original French version](TILE_VIEWER_FR.md) is preserved for reference.

## Visible ground: N1–N4 and textures

The **View · Textured ground** menu displays ground without trees, canopy or buildings, on the same terrain in Top and 3D. **View · Render** retains the original map; **View · Soil types** shows classification with diagnostic colours. **View · Mineral support** removes covers to compare substrate with the final surface. Information layers work on these views.

Composition now follows three stages: **mineral support → litter/grass/moss surface → snow**. Cover textures no longer share the same budget as rocks and gravel. Dense cover masks their colour; outcrops and highly exposed slopes limit it. The support view reveals information retained beneath these covers.

**New texture variants** draws a new asset among the candidates for each type, once for the entire terrain. Zone classification does not change. Palette, scales and prepared hashes are retained in `user://ground-texture-palettes-v1.json`. The six climates of a family share the same seed and texture choices. A type with a single candidate keeps its source. Cursor hover identifies the dominant type and asset actually used. The wheel now allows views down to approximately 12 m wide.

The local `godot-render/ground_texture_catalogue.json` contains the study's **90 types / 142 candidates**, with sources and CC0 licences. Packs are prepared as 512² images; original downloads and their hashes are retained in `materials/cache/` and `materials/prepared/`. Godot uses only this local library, without downloading.

| Block | Produced data |
| --- | --- |
| N1 | Exposed rock, matrix and fragment cover, structural roughness; budgets summing to 1 |
| N2 | Separate sand/fines/gravel/stones/boulder stocks, deposit size, roundness and provenance mix; no sand created by aridity alone |
| N3 | Signed river/lake/sea distances, river connection, wet river footprint rasterised from retained vector polygons, potential exposed banks |
| N4 | Render state with canonical snow, dry/wet states; additional fresh, irregular, compact, old, windblown, partial and melting snow presets and two ice presets |

Thirteen new diagnostics join Information: **47 layers**, including five hydrological and the previous 29. FP32 data are archived in `surface-grids.bin.gz`, separately from earlier diagnostics. Fine river and Render-snow footprints are retained at 4096²; other fields remain at 1334². The two new surface diagnostics show its cover and snow mask. Diagnostics use the `surface-info-` prefix so canonical masks are never overwritten.

Forest, grassland, steppe and savanna preferences derive from environmental inputs; they do not claim to recover the exact canopy of the old Render. A global appearance profile, stable by seed and recorded in `tile.json`, resolves unmeasured preferences. It is independent of the variants button. The five geological parents retain twenty base rock profiles and two colonised profiles; no new lithology is invented.

Classification normalises recipes within their physical budgets. To limit texture reads, support retains two rock profiles, one fragment recipe and three mineral matrix recipes. Rock/fragment/matrix budgets are quantised together to sum to 255, then distributed among their slots: error per budget remains below 1/255. Above that, surface has three continuous proportions: litter, herbaceous and wet/moss. Each has its dominant recipe and separate cover. The shader interpolates responses of four neighbouring cells, never their IDs.

Appearance moisture is filtered over 110 m, organic matter over 85 m and scores over 75 m before recipe reduction. Reference hydrological fields, water levels and river polygons remain unchanged. Input filtering is normalised outside permanent water. Forest/herbaceous/moss proportions remain separate so a rank change does not recreate an abrupt grassland boundary.

At overview scale, colour is the linear mean of the prepared, recoloured asset. Zoomed in, the same asset supplies colour, OpenGL normals and roughness; height modulates only micro-response, without displacing terrain. Minerals receive a narrower palette with shared means across profiles of a parent: procedural geological succession no longer dominates overview colour. Affine adjustment preserves that same mean when zoomed in, with bounded contrast. Leaves, grass, moss and snow retain their own palettes. Terrain normals follow the B-spline gradient to avoid visible facets. Strata follow their continuous orientation; sand and snow ripples use the declared regional wind. Coordinates are physical and fixed, independent of camera.

Tiling uses a triangular grid with three patches at deterministic translations and rotations, following the technique described in [RENDER_REVIEW §3.1](../../../magna-urbis-height-chain-budget/docs/RENDER_REVIEW.md) and [RENDER_SURFACE_DESIGN §7.2](../../../magna-urbis-height-chain-budget/docs/RENDER_SURFACE_DESIGN.md). UVs, derivatives, colour, height and roughness follow the same transformations and weights; tangent normals rotate inversely. Oriented materials retain their direction with small dispersion. Variance correction limited to 1.4 reduces contrast loss. This is an approximate correction, without an exact histogram-preserving LUT.

The Godot sun casts terrain shadows, using an 8192² directional map with camera-adapted range. Reduced ambient light and occlusion computed over eight DEM horizons make hollows legible; this occlusion does not replace cast shadows. The old Render remains displayed without new lighting.

**Render state** automatically overlays the snow mask computed by the original Render shader, before its lighting, from the same DEM and climate. `ground_render_snow.mjs` instruments only an offline GPU pass: no white pixel in the map is interpreted as snow. The mask and its hashes are retained; underlying ground remains available.

Additional snow/ice presets are test states with a declared scene cold anomaly of −18 °C. Dry and Wet also retain Render snow. This remains scene appearance, without glacial history simulation. Dry declares a desiccation cycle to permit small cracks. Water levels and geometry remain unchanged. Banks are derived potentials, not observed bars; no glacial, peat or saline history from 4.2 is required.

Prepare from this worktree after terrain/hydrology/ground data:

```powershell
node godot-render/tools/ground_water_masks.mjs
node godot-render/tools/ground_render_snow.mjs
python godot-render/tools/ground_surface.py --workers 4
python godot-render/tools/prepare_ground_textures.py
python godot-render/tools/validate_ground_surface.py
./Test-Render.ps1 -Check
./Test-Render.ps1
```

PBR preparation is the only step accessing the Internet. Snow-mask extraction requires the reference Render page served locally at `http://127.0.0.1:5203`, with Edge/Playwright; no neural service is required. The Godot viewer then uses retained files without a server. An unavailable JPG download may use the PNG pack of the same asset. Scripts can be rerun and retain complete outputs whose identity is unchanged. `--tile mountains--temperate` restricts map compilers and validator to one tile.

Checks: `test_ground_surface.py` checks budgets, admissible materials and states; `validate_ground_surface.py` verifies archives, hashes, all 42 tiles and 142 assets. GPU test `res://tests/ground_textures_test.gd` checks views, presets, palette stability, visible variant changes and classification preservation. `ground_quality_test.gd -- --tile mountains--cold` also isolates shadows, cover, snow and a planar material. `validate_ground_quality.py` compares its summary with reference periodic tiling at actual asset spacing and checks mean and contrast drift.

## Navigation and reference data

Double-click `Test-Render.cmd`, or run `./Test-Render.ps1` with no arguments. The `godot-render/project.godot` project also opens the demo directly.

One 3D scene, mesh and material are retained for both views. At startup the camera is vertical and orthographic. The “Switch to 3D” button or Tab enables perspective; returning to the map retains centre and view width. The last orbital orientation is remembered.

- Left or middle drag: pan.
- Right or Alt + left drag: orbit, automatically entering 3D.
- Wheel: centred zoom.
- Physical ZQSD / WASD or arrows: move; Shift accelerates.
- R: recenter; H: hide panel; Escape: quit.
- Terrain and climate menus, list of 42 combinations, previous/next buttons.
- Changing tile retains XY position, zoom and projection.
- The bottom-left ruler follows zoom. In perspective it measures horizontal distance at the centre of the view, at pivot elevation.
- At bottom right, elevation and coordinates are the intersection of the cursor ray with displayed terrain triangles. Outside the tile: “—”. Sea surface is at 0 m.

The catalogue contains 7 terrain forms × 6 climates on a 40,000 m square. Default corresponds to the existing temperate preset (18 °C, 1,000 mm/year). The three coastal families request a south coast in neural conditioning. Every combination was actually generated by the Python/CUDA service with all three `original` models. One seed per family enables climate comparisons.

Each folder in `godot-render/tiles/` contains the 1334² FP32 heightfield, its SHA-256, neural parameters and provenance, and a 4096² map produced by the existing web Render. The scene displays that map on a 1335² mesh displaced by the heightfield using cubic B-spline interpolation, without vertical exaggeration. The sea is flat at zero. The pivot follows local height so zoom stays above terrain.

The complete chain is `coarse → base → decoder`, with original models. The decoder checkpoint is native at 30 m. `outputResolution=native` retains that definition: 1,334 samples over 40 km, or 29.985 m per sample. It avoids the historical reduction to 1024² (39.0625 m) and coarser 513² mesh. Slight interpolation from the native 30 m grid to the exact 40 km domain does not create new neural information. Each descriptor retains `decoderNativeCell`, `outputResolution`, the three executed stages and `nativeDefinitionRetained`. Generation rejects a response that does not attest this definition.

This is the first exploration baseline: map colour and lighting are precomputed, so the texture gains no detail when zooming in. All 42 terrains now pass through Terrain Bench's **vector** chain: priority-flood drainage, Fill–Spill–Merge lake balance and vector rivers (meanders, branches, deltas). Balance uses climate temperature, precipitation and evaporation. The river threshold is `min(16 ; 4.8 × √(300 / max(3, runoff)))` km²: arid environments require a larger basin, while the tropics show more watercourses. Generation checks arid < tropical in count and length for all seven families. No artificial lake is added unless terrain and balance allow it.

`height.f32` and its hash retain the raw decoder output. `surface.f32` raises lake cells to hydraulic level for the 3D view. `water.json` retains polylines and topology; `water.svg` contains vectors only, without embedded image. Web Render composes these waters onto the 4096² map.

The **Information** selector overlays layers on the same surface in both projections: watersheds, accumulation/runoff, potential reservoirs (depression depth below threshold), balance of open/closed lakes and flow directions. The slider adjusts opacity; “No layer” restores the map. Selection is retained when changing tile. A legend describes colours. Potential reservoirs are topographic depressions, not built dams or a simulation of engineered impoundments.

Transparent layer PNGs derive from calculations retained in `hydrology-grids.bin.gz`: basins, receivers, accumulation, fill levels, sea mask, lakes, lake levels and types. The descriptor supplies types, offsets and spatial units; floats are FP32 and integers are 32-bit, little-endian. No hydrology computation depends on the camera. The viewer then runs offline, without service or regeneration. The old exact 2D fixture reader remains available with `-Scene`.

### Step 1: ground context (§5.1–5.4)

The five hydrology diagnostics are supplemented by **29 ground layers** on each of the 42 tiles. They share the canonical 1334² grid (~30 m), coordinates and terrain of Top and 3D views. Selection persists when changing tile; categories have legends with colour swatches, continuous fields show ranges and units. Opacity controls overlay on the Render map; “No layer” restores the background.

| Part | Added layers |
| --- | --- |
| 5.1 Geomorphology | Geomorphons at 150, 600 and 2,000 m; slope; aspect; profile and plan curvature; topographic positions at all three radii |
| 5.2 Geology | Bedrock composition; dominant rock (diagnostic); hardness; weatherability; bedding orientation |
| 5.3 Processes | Dominant domain; upstream river provenance; potential deposit thickness |
| 5.4 Water and soil | TWI; HAND; water distance; available water; drainage; available storage; sand/silt/clay texture; organic matter; stoniness; soil depth |
| Context | Limits and confidence according to domain completeness |

Geomorphons use eight sightlines with every sample available within each physical radius, a signed zenith/nadir opening comparison and a flatness threshold of 1°. Reduction yields ten classes: flat, summit, ridge, shoulder, spur, slope, hollow, footslope, valley, depression. References: [Jasiewicz and Stepinski](https://doi.org/10.1016/j.geomorph.2012.11.005) and [r.geomorphon](https://grass.osgeo.org/grass-stable/manuals/r.geomorphon.html). This is a local implementation of sightlines and classification, not a GRASS execution or reproduction of its extended corrections. TPI uses a square neighbourhood whose half-width is the stated radius; slope, aspect and curvatures use Gaussian smoothing with sigma 60 m. None of these fields derives from the camera mesh or Render colours.

Bedrock is a **declared procedural prior**, independent of elevation and climate: folded limestone/sandstone/clay-marl sequences, contacts warped by coherent noise, granite intrusion and basalt province. Noise scales range from 70 m to 8 km; a shared family seed guarantees the same composition across its six climates. The model retains five proportions summing to 1. Contacts are gradual zones of variable width, warped at multiple scales; internal heterogeneity supplements the units. Hardness, weatherability, source mineral texture and transported provenance consume these proportions without going through a dominant class.

“Bedrock composition” visualises fractions with colours mixed in linear light and moderate internal variation. “Dominant rock (classes)” is only for inspecting classification and retains sharp boundaries. Continuous fields use interpolation and mipmaps in Godot; classes retain nearest-neighbour sampling. Base Render terrain remains the precomputed source map: proportions are now available for the next ground-material step. This representation prepares transitions; it is not yet centimetre-scale validation of future PBR blending.

Structural orientation and mineral properties remain distinct fields. Bedrock remains visible under lakes in its diagnostic, while soil diagnostics are masked under permanent water.

The compiler follows retained receivers of vector hydrology exactly. It recalculates **geometric contributing area** for TWI, distinct from accumulation weighted by water balance. HAND follows the graph to the first channel, lake or sea; it is undefined and transparent if the path ends at an outlet without that reference. References and outlet types are archived. Channels retain downstream reaches where runoff decreases, following the vector-network logic.

A mix of five provenances, weighted by erosion potential, travels upstream to downstream. Lateral alluvium receives the neighbouring reach's mix under slope, distance and height-above-drainage constraints. Colluvial potentials follow a rock source and downstream path with attenuation; aeolian accumulations require sand stock, dry climate and traps under a regional wind declared at 70°. Coastal potential depends on sea proximity, elevation, slope and stock; frost depends on altitude-corrected climate. These are synthetic domains: no dune, incision, salt crust or terrain modification is produced.

Soil retains **sand + silt + clay = 1** and separates organic matter, stoniness, depth, storage and water potential. Thickness, storage and available water are synthetic proxies, without mass balance, groundwater, karst drainage, dated rain or flood prediction. Existing closed basins are retained. The domain does not know outside inflows: a diagnostic reduces confidence in basins touching edges and in a 2 km edge strip. It does not replace the missing upstream basin.

`tile.json.ground` retains compiler and dependency identity, geological scenario, parameters, ranges, palettes and hashes. `ground-grids.bin.gz` archives integer categories and FP32 fields, including five bedrock proportions, internal variation, five provenance fractions, process potentials and HAND references. The schema supplies offsets, types, size, local frame (x east, y south), width in metres and little-endian ordering. `ground-*.png` serves display only. Generated files remain outside Git.

To rebuild context without recalculating terrain, water or Render:

```powershell
python -m pip install -r godot-render/tools/requirements-ground.txt
python godot-render/tools/surface_context.py
python godot-render/tools/validate_ground.py
python godot-render/tools/test_surface_context.py
```

`--tile mountains--temperate` limits rebuilding to one tile; `--force` ignores cache; `--scenario` accepts `mixed` (default), `granite`, `limestone`, `sandstone`, `marl` or `basalt`. Changes to compiler, terrain, graph, climate or scenario invalidate outputs. Rebuilding processes two tiles in parallel by default; `--workers` and `--threads` set processes and sightline threads per process. The catalogue is published only by the main process, after each tile's files. `hydrate_tiles.mjs` then invokes this compiler automatically; `--python` specifies its executable. Data directories are excluded from Godot import with `.gdignore` and PNGs are read explicitly.

The validator checks 1,218 ground PNGs and hashes, archives, unchanged sources, mineral fractions, contributing-area conservation, HAND, TWI, geology identical across climates and higher mean available water in tropical than arid climate. GPU test `res://tests/ground_layers_test.gd` traverses all 34 layers, checks palettes, projections and retained selection, then produces `evidence/ground-*.png` captures. The general test also traverses all 42 tiles.

```powershell
./Test-Render.ps1 -Check
./Test-Render.ps1 -Tile coastal-mountains--tropical -Mode 3D
./Test-Render.ps1 -Capture ./godot-render/evidence/manual.png
```

Generated files remain local, outside Git. The generation script resumes completed tiles; it requires already-installed local services and neural assets and the original Render worktree:

```powershell
node godot-render/tools/generate_tiles.mjs --web-root ../magna-urbis-render-original-reference/web --base http://127.0.0.1:5203 --assets-base http://127.0.0.1:5197 --neural http://127.0.0.1:8894
```

If all 42 native sources exist, the script reuses them and regenerates only water, maps and layers, without neural service. This step can also be run directly with `node godot-render/tools/hydrate_tiles.mjs`. `tiles/hydrology-report.json` retains statistics by climate. `--force` also recalculates existing outputs; otherwise a complete unchanged configuration is reused. `terrain-render.png` retains the water-free background to avoid accumulating overlays on reruns.

`node godot-render/tools/validate_hydrology.mjs` checks all 42 sources and surfaces, map hashes, polylines, compressed grids, lake levels and 210 layers, then compares arid and tropical for each terrain form.

GPU validation: `godot --path godot-render --audio-driver Dummy --script res://tests/tile_viewer_test.gd`. The test loads all 42 tiles, checks hashes, surface uniqueness, land/sea presence on coasts, mesh identity, projections, zoom, orbit and movement. Captures and report are written to `godot-render/evidence/`. `res://tests/survey_test.gd` additionally checks elevation on flat terrain then actual terrain at multiple angles, reprojection of the point under the cursor, points outside the tile and ruler variation with zoom.

## Visible cover, close detail and water

The **Textured ground** view retains the Render view as its overview reference when zoomed out. Between 4 and 24 metres per pixel, the material gradually approaches its colours and shading; outcrop tint may retain that of the chosen mineral material. As the camera moves closer, textures, normals, Godot shadows and forest objects take over. Grass/moss photographs are centred around the open-ground guide from Render: details remain visible with consistent colour between scales. In forests, the canopy guide is retained while crowns are unresolved, then gradually reveals PBR ground between their silhouettes.

Ground remains textured in every zone. Litter, grass and moss consume only the N1 **matrix** share: rock and fragment budgets remain intact. Ridges/summits at 150 m, major outcrops and very steep slopes stay clear. **Mineral support** permits substrate inspection without low vegetation. Beaches and sandy deposits retain their sand textures.

Grass, sand and wood masks come from the **original Render3D**, reference `dff14f387a6d1edc89d93737f861ee91e022a5aa`. Their export is opaque: outcrop is exported separately in `original-outcrop.png`. A data channel must not serve as transparency alpha during `canvas.toDataURL`, which alters/loses other channels through premultiplication.

Vegetation reuses `buildForestField`, historical parameters `density=1`, `clearings=.45`, seed `1905266606` and the reference's analytical crown GLSL. `forest_placement.py` now filters the retained field's density channel while retaining height, type and tone. The filter associates the wood guide with sufficient density and height, climate and forest potential; it excludes water, beaches, ridges and exposed rock, with a transition margin measured in metres. Low tree potential no longer suffices to turn grassland into forest. Automatic galleries are disabled to prevent isolated trees bypassing this filter in desert or on a beach. Low vegetation in grasslands, steppes and deserts is represented by textures, without miniature crowns. This is an appearance policy inferred from layers, not an observed ecological inventory. No V2 profile is used. GLSL adaptation changes only function signatures, type conversions and a flattened cache of nine gradients, because Godot does not permit an array inside a structure. A separate sparse-conifer supplement is now blended into favourable cold/mountain sectors. It uses the same crown model with its own potential and mean colour; original exports remain retained. See [Profiles and coastline](SUPPORT_SHORES_REFINEMENT.md). At close range, lighting is Godot's with terrain shadows. Crowns remain analytical in the material, as in the reference, without added tree instances. The variants button changes the world's PBR palette, including ground between trees; crowns retain their original seed and colours.

Intermediate terrain now uses four fields of 64 / 27 / 9.5 / 3.75 m, conditioned by support and filtered according to mesh spacing. Refinement of the same 40 km plane begins at medium zoom; material takes over details the mesh no longer resolves. Native DEM and hydraulic surfaces remain intact. Water masks are strictly protected. See [Intermediate terrain and material](TERRAIN_MESOSCALE.md) for amplitudes, transitions, picking, tests and GPU measurements.

Close outcrops use per-patch tangent projection to limit photograph stretching on slopes, with a geometric profile and normals more legible at a few metres. The existing three PBR patches are reused. See [Close-range rock](ROCK_CLOSE_DETAIL.md) for operation, limitations and measured GPU cost.

Water uses a non-periodic procedural spectrum from 233 m to 60 cm, filtered using screen derivatives. Rivers follow downstream direction in blended fixed frames; lakes and sea use wind drift. The shoreline is reconstructed as a continuous contour, retained at the distant Render transition. Tint depends on retained depth for lakes/sea, an indicative 1.5 m optical depth for rivers and distance to banks. Normals, roughness, specular reflection, sky contribution and coastal foam replace the emissive flat fill. This is not a wave simulation or traced scene reflection. Levels and ice presets are retained. Vector sources now use a fine start gradually joining downstream width; see [River headwaters](RIVER_HEADWATERS.md).

Local reconstruction after N1–N4 and the PBR library:

```powershell
# Original reference and local Vite server on 127.0.0.1:5203 required.
node godot-render/tools/prepare_original_cover.mjs
node godot-render/tools/export_original_cover.mjs
python godot-render/tools/forest_placement.py
python godot-render/tools/prepare_mesoscale.py
python godot-render/tools/prepare_surface_water.py
python godot-render/tools/validate_surface_finish.py
python godot-render/tools/validate_mesoscale.py
./Test-Render.ps1 -Check
```

Each preparer accepts `--tile mountains--temperate`. The GLSL generator also accepts `--shader-only`. Local descriptors retain source commit, parameters and hashes of guides, forest fields and water textures. Generated data remain outside Git. Cover textures are loaded once per tile and reused when changing preset or palette.

`res://tests/surface_finish_test.gd` produces captures with/without cover, geometric detail and ripples. It checks the original reference, crown stability, mesh resolution, spatial terrain stability, close picking, stationary water levels and texture advection. Reports are in `godot-render/evidence/`.

`res://tests/cover_policy_test.gd` compares zoomed-out Render/textured views, checks textures of open terrain and outcrops, absence of crowns on grassland/desert and their presence in forest. `test_forest_placement.py` covers beach, ridge, cliff, water and arid-climate exclusions. The validator checks these exclusions and placement hashes on all 42 tiles. After rebuilding N1–N4, rerun `forest_placement.py`.
