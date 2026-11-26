# Appearance of the map

The **Appearance** button uses the same component in V2, Terrainbench and Citybench, including when they are opened from Rustbench and the local launcher. The bench controls are moved along with their existing handlers; the generation fields remain in their steps.

The settings are grouped into six families:

- **Relief and shadows**: shading, sun direction and height, intensity, exaggeration; refinement and vertical exaggeration of the 3D view.
- **Ground: colors and style**: map style or materials, terrain background, hypsometry, low and high altitude colors, map background.
- **Ground cover and contours**: vector land use, vegetation, painted textures, contour lines, fantasy brushes, satellite season, canopy, density and clearings.
- **Roads and streets**: independent visibility of regional roads and urban streets, ground integration, styles and widths available in each bench, colors of carriageways, edges and paths.
- **Rivers, lakes and sea**: visibility of water, lakes and former channels, colors of shallow water, deep water and rivers.
- **Buildings and city plan**: building visibility, roof styles, materials and shadows, city plan palettes and layers, colors of roofs/footprints and outlines. Hiding buildings keeps streets, parcels and gardens.

General presentation (place names, frame, legend, title block) and diagnostics have their own sections. Controls that depend on an engine remain conditional. The panel closes with Esc or a click outside it, and stays within the window on desktop and mobile.

An **asterisk next to the style name** indicates custom rendering settings: `Parchment *`, for example. It applies to colors, lighting, layers, vegetation, roads and buildings. Returning to the style's values removes the asterisk. The marker remains correct after a language change, a project reload or the opening of a custom link; the saved style identifier never contains this asterisk.

## Colors and compatibility

Each color has a picker and a **Reset** button, which removes its override and restores the value of the current style. Changing style keeps custom colors. Saved palettes are never modified globally.

The colors of satellite materials and diagnostic scales remain controlled by their renderer: incompatible fields are disabled and explained. Vector vegetation colors are distinct from the satellite canopy materials. In Citybench, a background already computed as an image cannot be recolored through its display parameters alone.

Native roofs keep their geometry and facet-based shading when a color changes. Building caches include colors, so that no tiles from an old palette are kept. An explicit carriageway color also applies when textures or ground integration are selected.

The Render, Render3D and Render v2 styles use WebGL2, including to compose their SVG/PNG images. In V2, the compositor and exports reuse the map context, including a software context. A separate RGBA framebuffer keeps the image, dimensions and graphics state of the map. Without a shared context, the compositor tries `OffscreenCanvas`, then a classic canvas in the page. A lost context is recreated. If the worker cannot compose the image, it still passes the computed altitudes to the page. In the complete absence of WebGL2, an appearance change keeps the previous map and displays a persistent notice; the map styles remain available.

2D tiles keep their margins for filtering, but each displayed pixel belongs to a single tile. This prevents transparent ground layers from becoming more opaque at the seams. The composition canvas is cleared between two images to prevent opacity from accumulating.

## Persistence and retained data

V2 saves `appearance.colors`, `appearance.roads`, `appearance.buildings` and any `appearance.forest` overrides. Colors are `#RRGGBB` values validated on import. Exports use the same preferences as the map. Bench links keep colors under `color_<name>`; their other display settings keep their existing format.

Custom canopy is recalculated from the retained altitudes and water, with a separate cache. No appearance change runs the relief, hydrology, settlement or building generators.

## Implementation and verification

- `web/src/ui/renderSettingsPanel.ts`: common structure, categories, pickers and color reset.
- `web/src/ui/benchRenderSettings.ts`: adaptation of the existing Terrainbench and Citybench controls.
- `web/src/v2/renderControls.ts`: adaptation of the V2 preferences and French/English translations.
- `web/src/render/customColors.ts`: isolated palette overrides and rendering capabilities.
- `web/src/v2/displayForest.ts`: adaptation of the forest to the retained data.

The targeted tests cover validation, data retention, layer independence, export, palette restoration, caches and roof lighting. `scripts/render_settings_panel_check.mjs` verifies the three interfaces and the mobile dimensions. `scripts/render_custom_colors_browser_check.mjs` imports a retained native map, checks the custom pixels in the map and in the exported PNG, then verifies the identity of altitudes and cities after saving the project. These scripts are run from `web`, with `V2_CHECK_URL` and `BENCH_CHECK_URL` used to choose the servers.

`scripts/render_material_canvas_check.mjs` deliberately refuses WebGL2 on `OffscreenCanvas`. It compares the pixels of the original and satellite shaders with their composition on a classic canvas, reloads a native map in V2 with **Render · Neural Earth** and verifies its PNG export without any generation call.

`scripts/render_style_customization_check.mjs` verifies the asterisks in the three interfaces: modification, return to the original values, style/language change and restoration of links.

`scripts/render_material_shared_check.mjs` verifies the RGBA pixels and state restoration of a shared opaque context, then the three materials and a PNG export with a single WebGL context allowed. It also verifies that the map is kept when no context is available. `scripts/render_tile_seams_check.mjs` compares 180 tiled images against their direct rendering: five palettes, three pixel densities, opaque or transparent background, fractional offsets and cache reuse.
