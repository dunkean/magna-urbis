# Fantasy cartography layers

`fantasy-ink` (black and white) and `fantasy-color` (ink/watercolor) are
display-only styles in Rust Terrain Bench and Neural Earth (`../infinite_map`).
Select **Fantasy Ã‚Â· Encre N&B / Aquarelle** in Magna Urbis or **Fantasy Ã‚Â· Ink /
Watercolor** in Neural Earth's layer menu. They use a gently oblique view of
individual landmarks; geographic coordinates, coastlines and the camera stay
unchanged. The legacy TypeScript settlement application is deferred.

The first mixed sheets are retained in `web/src/render/assets/fantasy/` as
prototypes. The active library is `families/`: thirteen original ImageGen PNG
sheets, one each for pines, broadleaf trees, tropical vegetation, cypresses,
hills, mountains, snow mountains, rocks, dunes, wetlands, crops, orchards and
grasses. Every sheet has eight ink silhouettes and eight watercolor silhouettes
in a 4Ãƒâ€”4 grid: **208 motifs**. Variants include different ages, proportions,
branch shapes, single trees and stands; they are selected by an independent
world-coordinate hash, preserving map placement when switching styles.

`node scripts/pack_fantasy_brushes.mjs` reads transparent sprite bounds and
renders alpha-preserving 768Ã‚Â² WebP runtime sheets (176 px maximum sprite size).
Original PNGs remain intact. Runtime files total about 4.6 MB versus about
33 MB for the sources. The generated `runtime/manifest.json` owns dimensions
and source rectangles. SVG embeds only used families and reusable variant
symbols; Canvas decodes each used family once. Workers do not embed the brush
library. Source prompts are preserved in `families/prompts.json`.

## Painting

The shared planner is `rust/bridge/fantasyPainting.ts`. It is pure TypeScript,
independent of DOM, engine and host application. The renderer belongs to the
temporary bridge, not the Rust terrain core. A seed and three world-anchored grids own all
placements. Relief uses a 0.85-pitch grid, with continuous height-dependent
summit sizing; woodland uses a 0.24-pitch grid. All motif widths are now scaled
by 0.55 relative to the previous display size, retaining their candidate density
and world positions. The size slider can reduce this further down to 0.1.
Coverage noise retains its original map-scale wavelengths, preserving broad
forests and clearings. Relief is protected when the stamp budget is reached. Two smooth noise scales modulate stands and clearings; actual
height, slope, temperature and annual rain determine brush families. Local
mountain suitability and conservative summit silhouette bounds exclude trees.
Ground anchors reject
water; geographic north to south ordering gives silhouette overlap. Cultivation
and wetlands use decorative suitability estimates by default. The optional
**Suivre l’occupation du territoire** setting instead uses generated occupation
polygons, including holes: trees in forests, crops in fields and gardens,
orchards and marshes in their corresponding areas. Without generated occupation,
this option leaves only relief motifs. See the bundled
[method note](methods/fantasy-landuse.md), available from the control's help.

Magna Urbis **Terrain Bench and Urban Bench** retain whole-map stamp geometry across camera refinement, caches
six style/settings variants per terrain and invalidates on water replacement.
SVG embeds one atlas and sixteen reusable symbols. Changing density, size or
spacing redraws without regenerating terrain or urban geometry. Urban Bench
has a visible **Rendu** selector in the top toolbar, with sliders and exports
in **Fantasy Ã‚Â· Brushes et export**. Brushes avoid actual quarter footprints,
roads and retained water. The occupation overlay has global visibility and
opacity controls, plus independent visibility by occupation type and for farm
objects. These display filters do not change the polygons used by the painter.
The parameters travel in URLs as `brush_density`, `brush_size`, `brush_spacing`,
`brush_landuse`, and the `landuse` display settings. Exports: self-contained SVG and
4096Ã‚Â² PNG, including displayed water and settlement overlays. Brush sliders
and export buttons are in the **Layers** panel.

Neural Earth paints cached, depth-sorted stamp lists onto the annotation canvas.
A spatial index avoids scanning every tile per sample. Atlas images are decoded
once. Visible-region planning is capped at 64,000 candidate cells and 12,000
stamps. Pitch is selected in discrete world-space tiers (minimum 20 m) to bound
screen density; changing tiers deliberately changes cartographic detail.
The current flat map is exported as PNG. Brush perspective applies to flat maps;
switching to globe shows relief, and returning restores the fantasy style.
Globe brush projection remains future work.

Both Python/WebGPU and browser Rust/WASM transports provide physical altitudes.
The CPU fallback paints quiet land/sea backgrounds from those same altitudes,
not inferred image brightness. Browser `physical-tile.mjs` supplies the small
climate atlas in the existing transport layout when requested. Shared rendering
recipes retain brush settings separately from generation.

## Distribution and checks

From `web/`, `node scripts/build_fantasy_painter.mjs` bundles the shared planner
and copies the thirteen runtime sheets plus `fantasy_brush_assets.js` into the
sibling Neural Earth `web/` directory. Pass
a destination argument to distribute elsewhere. The script is generated;
edit the TypeScript source. `npm run build:wasm` in Neural Earth includes the
viewer, painter, family sheets and physical transport helper. Python serves the painter, registry, client integration and family atlases through
explicit routes.

Checks from Magna Urbis `web/`:

```sh
npm run typecheck
npx vitest run --project fast tests/fantasyPainting.test.ts
node scripts/fantasy_ui_check.mjs
node scripts/fantasy_urban_ui_check.mjs
node scripts/fantasy_assets_check.mjs
node scripts/fantasy_neural_check.mjs
node scripts/fantasy_gpu_check.mjs
npm run build
npx vite build --mode terrainbench --emptyOutDir false
npx vite build --mode urbanbench
```

Browser checks use Chrome with WebGPU enabled. Screenshots/downloads go in
ignored `web/out/fantasy/`. Neural Earth must be running for its live check;
its initial Orogen/model preparation can take time. No Rust generation changes
are necessary for these display layers.

## Asset provenance and prompt set

Generated with the built-in **ImageGen** tool on 2026-10-13. Google Imagen was
not available in this session. The original generated files are copied intact;
transparency is retained. Runtime source rectangles assemble the brushes.

Shared prompt: production fantasy RPG cartography brush atlas; genuinely
transparent exterior; exactly four columns and four rows with sixteen isolated
centered motifs; generous margins; no labels, borders, text or background;
slightly oblique overhead view looking down about 40 degrees, visible upright
silhouettes rather than directly top-down; upper-left light; bottom-center ground
anchors. Subjects in row order: pine/oak/palm/cypress; hill/alpine mountain/snow
mountain/crag; dune/wetland/crop field/orchard; pine stand/broadleaf stand/jungle/grass.

Ink prompt: exquisite black pen engraving, delicate cross-hatching and opaque
ivory interiors to occlude rear silhouettes, crisp at small sizes, premium
antique fantasy atlas, no color. Runtime grayscale ensures monochrome.

Color prompt: fine dark ink outlines and muted watercolor, warm ivory highlights,
moss/sage greens, ochre sands, slate mountains, restrained jewel colors, opaque
painted interiors and transparent exterior, refined miniature silhouettes.

The initial mixed atlas prompts above describe the prototypes. The active per-family
prompt set in `families/prompts.json` explicitly requests eight distinct outlines
repeated as ink and watercolor, one family per sheet, with safe transparent gutters.
