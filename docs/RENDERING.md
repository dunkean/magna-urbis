# Styles, layers, diagnostics and masks

[French original](RENDERING_FR.md).

Rendering combines four distinct concepts without changing generation:

| Concept | Role | Example |
| --- | --- | --- |
| Style | Defines element colors and materials | Atlas, Parchment, Render |
| Layer | Content whose visibility can be selected | Terrain background, water, contours, buildings |
| Diagnostic | Visualizes computed data | Elevation, watershed, neighborhood identity |
| Mask | Spatial data that bounds or weights an operation | Generation zones, lake footprint |

A diagnostic can replace terrain coloring, as Elevation does, or overlay the map. It retains the selected style. Internal masks do not become styles when a diagnostic displays them.

## Shared definitions

- `web/src/render/styles.ts`: map palettes and their water materials.
- `web/src/render/terrainStyle.ts`: shared terrain-style catalog, including the Render material compositor and Fantasy illustrations.
- `web/src/render/waterStyle.ts`: water-palette contract and CPU/GLSL interpolation; uniforms prepared once per material.
- `web/src/render/displayLayers.ts`: visibility vocabulary and controls.
- `web/src/render/displayDiagnostics.ts`: hydrology and elevation diagnostics, required data, legends and composition mode.

Terrain and Settlements use the same panel and renderers. The urban workshop also distinguishes map style from colored neighborhood identity and block, parcel and orientation diagnostics.

## One water material per style

`WaterStyle` contains a list of `[position, color]` points and a transition width. Position is distance from the shore divided by the map's reference width and `bandFraction`. Segments use the same smooth interpolation on CPU and in GLSL. Rivers use the shore color.

Sea and lake evaluate the same material at the same distance from shore. Seabed shading does not change that color. Render supplies its own palette, with no lake-specific coloring path. Brushes remain an illustration layer independent of the water material.

`terrainWater.ts` adapts surfaces to SVG/PNG images and the application's Canvas. `TerrainGl` uses the same color points. Shores and holes remain defined by their geometries; changing style does not recompute them. The Water checkbox includes sea, lakes and rivers. Hiding the terrain background retains water when enabled.

## Scales, crops and retained files

The material's reference width and coordinates belong to the source map. Zoom and successive crops translate this frame without narrowing the gradient. Distance surfaces and images are cached by their data and dimensions.

New `.decor` files retain neutral fields in base64-encoded FP32, their shores and the source frame. Compression remains that of the decor file. Style is evaluated on display, including after a crop or view change. Recipes that regenerate terrain omit this derived data. Old files remain readable: their lake materials are reconstructed from the available mask. An old file already cropped cannot recover outside-shore data it did not contain.

Links use `style` for appearance and `diagnostic` for computed-data visualization. Legacy `overlay` and `style=copernicus` are still read; the latter becomes the Elevation diagnostic with Parchment style.

## Render3D procedural ground

`Render3DBrush` retains this material and replaces analytical forest crowns with 48 watercolor motifs tinted to the Render3D palette: near-vertical crown views (pines, broadleaf, tropical and dry trees) and actual low shrubs, chosen by physical height (≤ 3 m), not screen size. Shores have a narrow band (a few to a few dozen meters) measured on displayed river geometry. The same forest field and LOD apply in 2D, perspective and raster export; see the [method note](methods/render3d-brush.md), also available offline from the style selector's `?`.

The [scientific note in English](methods/render3d-ground.md) describes the field, equations, filtering, references and limits of this integration.

`Render3D` has a ground material evaluated in the perspective shader: albedo, normals and roughness follow shared structures measured in meters. The shader uses physical position before vertical exaggeration and the pixel footprint on that surface to filter detail. Other styles and the `Render` material retain their map-rendering path. Maximum `Render3D` zoom is 128 CSS pixels per meter in 2D and 3D; other styles retain their 8 CSS pixels per meter limit.

Material classification uses B-spline coefficients of the global source field stored in R32F, independently of mesh resolution. Changing level of detail therefore does not redefine rock or grass areas.

`rust/bridge/terrainGround.ts` defines the shared CPU/GLSL detail field. The mesh samples a canonical camera-independent height; parent/child transitions interpolate its approximations. The material follows the canonical physical normal and retains unresolved slope variance. Compact elliptical gravel complements analytical noise bands. Plains remain smooth and fine displacement is attenuated near water. This presentation detail recomputes neither Rust terrain nor hydrology. Reflectance uses GGX, Smith and Schlick with linear albedo, following the [real-time model described by Filament](https://google.github.io/filament/main/filament.html). Unresolved variance broadens the slope distribution. Detail gradients are analytical; variations in its slope/climate envelope are treated as macroscopic variations without differentiating every term.

The 3D material receives an RGBA capture containing only water, contours and overlays. Its alpha carries their explicit coverage: ground color is not used to identify water. Captures retain real neighbors in a two-texel border, and textures are composited with premultiplied alpha. The “Tiles” diagnostic overlays boundaries without changing heights.

Reference methods are [Wave Noise, SIGGRAPH 2025](https://pascalguehl.github.io/siggraph2025-wave-noise/), [Laplacian blending, JCGT 2025](https://jcgt.org/published/0014/01/02/) and [LEADR, SIGGRAPH Asia 2013](https://perso.liris.cnrs.fr/victor.ostromoukhov/publications/pdf/SAsia2013-LEADR.pdf). The local implementation uses bounded spectral synthesis, band blending and a slope-variance approximation; it is not a complete port of those three works. It does not simulate erosion, individual grain shadows or overhangs. Subpixel detail affects reflectance without creating a silhouette the mesh could not represent.

## Render3D forest and applied land use

The [scientific note in English](methods/render3d-vegetation.md) describes the forest field, crowns, filtering, empirical CHMv2 calibration and their limitations.

**Principle**

- `forestEnabled`, `forestDensity` and `forestClearings` affect display only. They appear only with `Render3D`.
- They remain outside `TerrainSettings`. Links carry `forest=0|1`, then `forestDensity` and `forestClearings` when they differ from defaults.
- A canonical RGBA8 field is computed once over retained terrain.
  - R: cover; G: height 0–50 m; B: conifer share; A: stand tone.
  - R and G carry `Render` tree eligibility (rock outcrops, slope, perennial snow, tree line), evaluated on CPU with its material semantics: no trees on `Render` rocky slopes, and no applied woodland or orchard beyond them.
  - The 2D map, 3D view and raster export sample it in world coordinates.
- `Render` rendering, including macroscopic woodland, remains the unresolved reference. Beyond approximately 32 m per pixel, `Render3D` and `Render3DBrush` display exactly its ground; around 8 m per pixel, clearings and stands appear attenuated and softened; below 2 m per pixel, canonical crowns, litter and clearings are fully visible. Crown and open-ground colors derive from `Render`.
- With “Detailed canopy” unchecked, `Render3D` returns to its previous rendering with its original coarse forest tint. `Render` is unchanged.

**Applied land use**

- In the Settlements stage, applied land use becomes a signed-distance texture produced by `web/src/ui/forestOccupation.ts`.
  - Fields, meadows, pasture, orchards, gardens, commons and built footprints open the forest.
  - Woodlands in the rural plan remain wooded.
  - Wetlands remain natural.
- Natural cover produced without a city (`generateNaturalCover`) never constrains the material.
- Polygons, decor raster and displayed terrain share the `[0, width]²` frame, including after a cell-aligned crop. A width mismatch suspends the constraint.
- When Render3D forest is active, the land-use Canvas layer hides its drawn forests. Fields, furrows, hedges, orchards, gardens and farms remain visible. Other styles retain the complete drawing.

**Current limit:** perspective exists only in the Terrain stage, without land use. Agricultural clearings therefore appear in the Settlements stage's 2D Render3D map. Showing them in 3D would require enabling perspective at that stage, which is not planned here.

## Verification

From `web/`, `node scripts/styles_ui_check.mjs` checks sea/lake colors for the twelve styles on the GPU, layer independence, diagnostic composition and link replay in WebGL and SVG renderers. `tests/render.water-style.test.ts` covers palettes, caches, legacy decors and successive crops. Existing rendering and export suites remain applicable.
