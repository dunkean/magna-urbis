# Magna Urbis V2 stage, display, and backend icons

Generated: 2026-10-29.

## Method and scope

Created with the built-in `image_gen.imagegen` tool, using `transparent_background=true` for every call. No CLI/API fallback was used. Inspected these existing images before generation as style references (read only):

- `web/src/v2/icons-v2.png`
- `web/src/v2/assets/coast-icons-v1.png`
- `web/src/v2/assets/hydrology-icon-v1.png`

Three independent initial atlas generations were followed by exactly one corrective regeneration of each atlas. The first pass had insufficient gutter clearance, alpha specks, and some visible cross-cell spill in the display/backend atlases. The second pass was selected for all three final files. No further regeneration was performed.

Selected atlas PNGs were copied byte-for-byte from ImageGen's tool-managed output into this folder. The original PNGs were not resized, repainted, alpha-cleaned, or re-encoded. Their SHA-256 hashes are recorded in `manifest.json`. All explicit workspace writes were confined to this folder; no source code was edited and no git commands were run.

## Dimensions and layout

| Atlas | Original PNG dimensions | Layout | Equal cell dimensions |
| --- | --- | --- | --- |
| atlas-stages.png | 1254 x 1254 | 3 columns x 3 rows | 418 x 418 |
| atlas-display.png | 1254 x 1254 | 3 columns x 3 rows | 418 x 418 |
| atlas-backends.png | 1254 x 1254 | 3 columns x 3 rows | 418 x 418 |

The manifest uses zero-based `cell: [column, row]`, in row-major reading order.

## Extraction and verification

Used Python 3.13.9 and the already installed Pillow package. For each 418 x 418 cell:

1. Cleared alpha values equal to 1 (1/255 opacity) in the derivative cell only. These were faint scattered generation noise extending into gutters. Kept every alpha value from 2 through 255 unchanged at this stage.
2. Computed the resulting nonzero-alpha bounding box and cropped to it.
3. Resized proportionally with Pillow LANCZOS to fit inside 112 x 112 pixels.
4. Centered the result on a 128 x 128 RGBA transparent canvas, giving a uniform minimum 8-pixel transparent margin. Odd dimensions can produce a one-pixel centering difference.
5. Saved as lossless WebP with `lossless=True, quality=100, method=6, exact=True`.

All 27 WebPs were reopened and verified to be 128 x 128 RGBA, nonempty, and pixel-identical to their pre-save RGBA canvases. Every export has more than 20% fully transparent pixels: actual range approximately 32.8% to 71.5%. All export alpha bounds remain at least 8 pixels from canvas edges. Per-icon alpha counts, bounding boxes, and cleanup counts are in the manifest.

Every selected atlas is genuinely RGBA with alpha-zero pixels. After disregarding alpha=1 noise, every object's complete alpha bounding box lies strictly inside its own cell, with no edge contact. Original alpha-zero fractions: stages approximately 69.6%, display 65.3%, backends 68.5%.

## Issues and visual review

- **Raw atlas gutter caveat:** all three unmodified original PNGs still contain faint alpha=1 specks, including some cell-edge pixels. Thus the original atlases do not meet a literal all-gutter-pixels-equal-zero requirement, even after the single requested regeneration. Visible artwork is isolated. These alpha=1 artifacts were cleared in the individual WebP derivatives only, preserving the original atlas bytes as requested.
- **family-settlements:** reads as three connected individual cottages rather than three multi-building hamlets.
- **display-2d:** the map is flat, but its outline is slightly trapezoidal/perspective rather than a perfectly orthographic top-down square.
- **display-layers:** three sheets are clear, but their translucency is subtle.
- **display-light:** the sun and hill read clearly; a distinct cast shadow is subtle.
- **backend-webgpu:** the emitted light forms a broad diffuse halo, with short rays less distinct than the requested fan. The gem consequently appears smaller within its exported icon. The halo is part of the generated light effect, not an added background.
- No visible lettering, numerals, watermarks, merged neighboring objects, or empty cells were observed. Dice use round pips. The blank ribbon has no writing. The serpent is a natural animal, without a human/cartoon face.
- The hand-painted detail can soften at 28-40 pixels, especially the small settlement buildings and heightmap library tiles.

## Exact prompts

The prompts below are copied exactly from the generation calls. Atlas labels and IDs in this document are metadata, not requested rendered text.

### atlas-stages.png: initial attempt (not selected)

```text
Use case: stylized-concept.
Asset type: square PNG sprite atlas of nine premium strategy-game inventory icons for the Magna Urbis medieval-fantasy cartography desktop application.
Style reference: the existing V2 icons have hand-painted watercolor/gouache parchment maps, dimensional stone towns with terracotta roofs, moss-green foliage and rich antique brass objects, softly shaded natural materials, gently dark painted contours, warm ivory highlights. Match that cohesive premium hand-painted style. Bold simple silhouettes readable at 28–40 pixels; reduce tiny detail. Slight 3/4 top view unless the specified object requires flat top-down.
Palette: warm ivory parchment, antique brass/gold trim, moss green, slate-blue water, terracotta roofs. Soft natural lighting from upper left.
COMPOSITION IS CRITICAL: one square image, exactly THREE equal columns by THREE equal rows, exactly NINE isolated icons. Invisible regular 3x3 grid. Reading order is left to right, top to bottom. Center each entire icon at its cell center. Each icon including all shadows, glow, arrows and accessory parts fits within the central 66% of BOTH dimensions of its cell. Generous completely transparent gutters on every side. All nine icons have consistent visual scale. No parts touch a cell edge or cross into a neighboring cell. Do not draw the grid.
Background: genuine alpha transparency everywhere outside the nine objects, including gutters; no colored backdrop, no opaque ground plane, no checkerboard pattern. Object-specific terrain/map swatches are allowed ONLY where explicitly described below.
Avoid: text, letters, numerals, logos, faces, UI frames, decorative background plates, borders, watermark. Dice may have simple round pips, never numerals. No labels or captions.
Exactly these nine subjects in this exact cell order:
Row 1, column 1: A small block of mountainous terrain with two peaks (relief stage).
Row 1, column 2: A river meeting a small lake with a few trees on its bank (water and natural cover).
Row 1, column 3: Three tiny hamlets connected by a dirt road on a parchment patch (regional settlements and roads).
Row 2, column 1: A compact walled town with terracotta roofs (one city).
Row 2, column 2: An artist's brass-rimmed painting palette with a small brush (display/appearance).
Row 2, column 3: A pair of brass dice resting on a terrain swatch (procedural generation).
Row 3, column 1: A glowing faceted crystal over a terrain swatch, cool blue light (neural generation); glow must fade fully to alpha within its cell.
Row 3, column 2: A single grayscale heightmap tile (soft white peaks on black) with a brass arrow entering it (import a heightmap); tile is grayscale, arrow is brass.
Row 3, column 3: A small open wooden drawer holding three stacked grayscale heightmap tiles (heightmap library); tiles show soft white mountain shapes on black.
```

### atlas-stages.png: corrective regeneration (selected original)

```text
Use case: stylized-concept.
Asset type: square PNG sprite atlas of nine premium strategy-game inventory icons for the Magna Urbis medieval-fantasy cartography desktop application.
Style reference: the existing V2 icons have hand-painted watercolor/gouache parchment maps, dimensional stone towns with terracotta roofs, moss-green foliage and rich antique brass objects, softly shaded natural materials, gently dark painted contours, warm ivory highlights. Match that cohesive premium hand-painted style. Bold simple silhouettes readable at 28–40 pixels; reduce tiny detail. Slight 3/4 top view unless the specified object requires flat top-down.
Palette: warm ivory parchment, antique brass/gold trim, moss green, slate-blue water, terracotta roofs. Soft natural lighting from upper left.
COMPOSITION IS CRITICAL: one square image, exactly THREE equal columns by THREE equal rows, exactly NINE isolated icons. Invisible regular 3x3 grid. Reading order is left to right, top to bottom. Center each entire icon at its cell center. Each icon including all shadows, glow, arrows and accessory parts fits within the central 50% of BOTH dimensions of its cell. Generous completely transparent gutters on every side. All nine icons have consistent visual scale. No parts touch a cell edge or cross into a neighboring cell. Do not draw the grid.
Background: genuine alpha transparency everywhere outside the nine objects, including gutters; no colored backdrop, no opaque ground plane, no checkerboard pattern. Object-specific terrain/map swatches are allowed ONLY where explicitly described below.
Avoid: text, letters, numerals, logos, faces, UI frames, decorative background plates, borders, watermark. Dice may have simple round pips, never numerals. No labels or captions.
Exactly these nine subjects in this exact cell order:
Row 1, column 1: A small block of mountainous terrain with two peaks (relief stage).
Row 1, column 2: A river meeting a small lake with a few trees on its bank (water and natural cover).
Row 1, column 3: Three tiny hamlets connected by a dirt road on a parchment patch (regional settlements and roads).
Row 2, column 1: A compact walled town with terracotta roofs (one city).
Row 2, column 2: An artist's brass-rimmed painting palette with a small brush (display/appearance).
Row 2, column 3: A pair of brass dice resting on a terrain swatch (procedural generation).
Row 3, column 1: A glowing faceted crystal over a terrain swatch, cool blue light (neural generation); glow must fade fully to alpha within its cell.
Row 3, column 2: A single grayscale heightmap tile (soft white peaks on black) with a brass arrow entering it (import a heightmap); tile is grayscale, arrow is brass.
Row 3, column 3: A small open wooden drawer holding three stacked grayscale heightmap tiles (heightmap library); tiles show soft white mountain shapes on black.
STRICT PRODUCTION CORRECTION: Make the objects SMALLER than a usual contact sheet. Every cell must have a broad completely empty transparent margin of at least 20% of the cell width and height on every side. Center all objects at the exact centers of the nine equal cells (one sixth, one half, five sixths of canvas dimensions). Object artwork occupies only about HALF its cell width/height. Do NOT fill the atlas tightly. All shadows and glow must end well before the generous cell margins. The gutter pixels must have alpha exactly ZERO, with no faint stray paint, specks, glows or invisible noise. For the webgpu gem use short contained rays; for the light icon keep the sun small and close to the hill. Never draw cell boundaries. Precisely nine compact icons in a uniform invisible 3x3 square lattice.
```

### atlas-display.png: initial attempt (not selected)

```text
Use case: stylized-concept.
Asset type: square PNG sprite atlas of nine premium strategy-game inventory icons for the Magna Urbis medieval-fantasy cartography desktop application.
Style reference: the existing V2 icons have hand-painted watercolor/gouache parchment maps, dimensional stone towns with terracotta roofs, moss-green foliage and rich antique brass objects, softly shaded natural materials, gently dark painted contours, warm ivory highlights. Match that cohesive premium hand-painted style. Bold simple silhouettes readable at 28–40 pixels; reduce tiny detail. Slight 3/4 top view unless the specified object requires flat top-down.
Palette: warm ivory parchment, antique brass/gold trim, moss green, slate-blue water, terracotta roofs. Soft natural lighting from upper left.
COMPOSITION IS CRITICAL: one square image, exactly THREE equal columns by THREE equal rows, exactly NINE isolated icons. Invisible regular 3x3 grid. Reading order is left to right, top to bottom. Center each entire icon at its cell center. Each icon including all shadows, glow, arrows and accessory parts fits within the central 66% of BOTH dimensions of its cell. Generous completely transparent gutters on every side. All nine icons have consistent visual scale. No parts touch a cell edge or cross into a neighboring cell. Do not draw the grid.
Background: genuine alpha transparency everywhere outside the nine objects, including gutters; no colored backdrop, no opaque ground plane, no checkerboard pattern. Object-specific terrain/map swatches are allowed ONLY where explicitly described below.
Avoid: text, letters, numerals, logos, faces, UI frames, decorative background plates, borders, watermark. Dice may have simple round pips, never numerals. No labels or captions.
Exactly these nine subjects in this exact cell order:
Row 1, column 1: Three overlapping colour swatches (ochre, green, blue) fanned out like cards.
Row 1, column 2: Three stacked translucent parchment map sheets; no writing.
Row 1, column 3: A flat top-down map sheet lying perfectly flat; no raised terrain and no writing.
Row 2, column 1: An isometric terrain block with visible earth side walls.
Row 2, column 2: Three small houses with differently coloured roofs: red, blue, ochre.
Row 2, column 3: A paved stone road curving across grass.
Row 3, column 1: A square of textured earth and grass ground material sample.
Row 3, column 2: A small unrolled parchment banner/ribbon tag, completely blank with NO writing.
Row 3, column 3: A brass sun disc casting a shadow over a small hill; disc and hill form one compact isolated icon.
```

### atlas-display.png: corrective regeneration (selected original)

```text
Use case: stylized-concept.
Asset type: square PNG sprite atlas of nine premium strategy-game inventory icons for the Magna Urbis medieval-fantasy cartography desktop application.
Style reference: the existing V2 icons have hand-painted watercolor/gouache parchment maps, dimensional stone towns with terracotta roofs, moss-green foliage and rich antique brass objects, softly shaded natural materials, gently dark painted contours, warm ivory highlights. Match that cohesive premium hand-painted style. Bold simple silhouettes readable at 28–40 pixels; reduce tiny detail. Slight 3/4 top view unless the specified object requires flat top-down.
Palette: warm ivory parchment, antique brass/gold trim, moss green, slate-blue water, terracotta roofs. Soft natural lighting from upper left.
COMPOSITION IS CRITICAL: one square image, exactly THREE equal columns by THREE equal rows, exactly NINE isolated icons. Invisible regular 3x3 grid. Reading order is left to right, top to bottom. Center each entire icon at its cell center. Each icon including all shadows, glow, arrows and accessory parts fits within the central 50% of BOTH dimensions of its cell. Generous completely transparent gutters on every side. All nine icons have consistent visual scale. No parts touch a cell edge or cross into a neighboring cell. Do not draw the grid.
Background: genuine alpha transparency everywhere outside the nine objects, including gutters; no colored backdrop, no opaque ground plane, no checkerboard pattern. Object-specific terrain/map swatches are allowed ONLY where explicitly described below.
Avoid: text, letters, numerals, logos, faces, UI frames, decorative background plates, borders, watermark. Dice may have simple round pips, never numerals. No labels or captions.
Exactly these nine subjects in this exact cell order:
Row 1, column 1: Three overlapping colour swatches (ochre, green, blue) fanned out like cards.
Row 1, column 2: Three stacked translucent parchment map sheets; no writing.
Row 1, column 3: A flat top-down map sheet lying perfectly flat; no raised terrain and no writing.
Row 2, column 1: An isometric terrain block with visible earth side walls.
Row 2, column 2: Three small houses with differently coloured roofs: red, blue, ochre.
Row 2, column 3: A paved stone road curving across grass.
Row 3, column 1: A square of textured earth and grass ground material sample.
Row 3, column 2: A small unrolled parchment banner/ribbon tag, completely blank with NO writing.
Row 3, column 3: A brass sun disc casting a shadow over a small hill; disc and hill form one compact isolated icon.
STRICT PRODUCTION CORRECTION: Make the objects SMALLER than a usual contact sheet. Every cell must have a broad completely empty transparent margin of at least 20% of the cell width and height on every side. Center all objects at the exact centers of the nine equal cells (one sixth, one half, five sixths of canvas dimensions). Object artwork occupies only about HALF its cell width/height. Do NOT fill the atlas tightly. All shadows and glow must end well before the generous cell margins. The gutter pixels must have alpha exactly ZERO, with no faint stray paint, specks, glows or invisible noise. For the webgpu gem use short contained rays; for the light icon keep the sun small and close to the hill. Never draw cell boundaries. Precisely nine compact icons in a uniform invisible 3x3 square lattice.
```

### atlas-backends.png: initial attempt (not selected)

```text
Use case: stylized-concept.
Asset type: square PNG sprite atlas of nine premium strategy-game inventory icons for the Magna Urbis medieval-fantasy cartography desktop application.
Style reference: the existing V2 icons have hand-painted watercolor/gouache parchment maps, dimensional stone towns with terracotta roofs, moss-green foliage and rich antique brass objects, softly shaded natural materials, gently dark painted contours, warm ivory highlights. Match that cohesive premium hand-painted style. Bold simple silhouettes readable at 28–40 pixels; reduce tiny detail. Slight 3/4 top view unless the specified object requires flat top-down.
Palette: warm ivory parchment, antique brass/gold trim, moss green, slate-blue water, terracotta roofs. Soft natural lighting from upper left.
COMPOSITION IS CRITICAL: one square image, exactly THREE equal columns by THREE equal rows, exactly NINE isolated icons. Invisible regular 3x3 grid. Reading order is left to right, top to bottom. Center each entire icon at its cell center. Each icon including all shadows, glow, arrows and accessory parts fits within the central 66% of BOTH dimensions of its cell. Generous completely transparent gutters on every side. All nine icons have consistent visual scale. No parts touch a cell edge or cross into a neighboring cell. Do not draw the grid.
Background: genuine alpha transparency everywhere outside the nine objects, including gutters; no colored backdrop, no opaque ground plane, no checkerboard pattern. Object-specific terrain/map swatches are allowed ONLY where explicitly described below.
Avoid: text, letters, numerals, logos, faces, UI frames, decorative background plates, borders, watermark. Dice may have simple round pips, never numerals. No labels or captions.
Exactly these nine subjects in this exact cell order:
Row 1, column 1: A brass and green circuit microchip.
Row 1, column 2: A brass graphics card with a fan.
Row 1, column 3: A single brass cogwheel.
Row 2, column 1: Four small interlocking brass cogwheels, exactly four visible separate gear hubs.
Row 2, column 2: A brass tray holding a neat row of small cogwheels (worker pool).
Row 2, column 3: A blacksmith anvil with a glowing ember (native compiled engine).
Row 3, column 1: A coiled green-and-gold serpent around a small glass flask (Python neural server); no human face, no cartoon facial features.
Row 3, column 2: A faceted gem emitting a fan of light rays (WebGPU); rays fade fully to alpha inside cell.
Row 3, column 3: A brass gear with a small spanner (settings).
```

### atlas-backends.png: corrective regeneration (selected original)

```text
Use case: stylized-concept.
Asset type: square PNG sprite atlas of nine premium strategy-game inventory icons for the Magna Urbis medieval-fantasy cartography desktop application.
Style reference: the existing V2 icons have hand-painted watercolor/gouache parchment maps, dimensional stone towns with terracotta roofs, moss-green foliage and rich antique brass objects, softly shaded natural materials, gently dark painted contours, warm ivory highlights. Match that cohesive premium hand-painted style. Bold simple silhouettes readable at 28–40 pixels; reduce tiny detail. Slight 3/4 top view unless the specified object requires flat top-down.
Palette: warm ivory parchment, antique brass/gold trim, moss green, slate-blue water, terracotta roofs. Soft natural lighting from upper left.
COMPOSITION IS CRITICAL: one square image, exactly THREE equal columns by THREE equal rows, exactly NINE isolated icons. Invisible regular 3x3 grid. Reading order is left to right, top to bottom. Center each entire icon at its cell center. Each icon including all shadows, glow, arrows and accessory parts fits within the central 50% of BOTH dimensions of its cell. Generous completely transparent gutters on every side. All nine icons have consistent visual scale. No parts touch a cell edge or cross into a neighboring cell. Do not draw the grid.
Background: genuine alpha transparency everywhere outside the nine objects, including gutters; no colored backdrop, no opaque ground plane, no checkerboard pattern. Object-specific terrain/map swatches are allowed ONLY where explicitly described below.
Avoid: text, letters, numerals, logos, faces, UI frames, decorative background plates, borders, watermark. Dice may have simple round pips, never numerals. No labels or captions.
Exactly these nine subjects in this exact cell order:
Row 1, column 1: A brass and green circuit microchip.
Row 1, column 2: A brass graphics card with a fan.
Row 1, column 3: A single brass cogwheel.
Row 2, column 1: Four small interlocking brass cogwheels, exactly four visible separate gear hubs.
Row 2, column 2: A brass tray holding a neat row of small cogwheels (worker pool).
Row 2, column 3: A blacksmith anvil with a glowing ember (native compiled engine).
Row 3, column 1: A coiled green-and-gold serpent around a small glass flask (Python neural server); no human face, no cartoon facial features.
Row 3, column 2: A faceted gem emitting a fan of light rays (WebGPU); rays fade fully to alpha inside cell.
Row 3, column 3: A brass gear with a small spanner (settings).
STRICT PRODUCTION CORRECTION: Make the objects SMALLER than a usual contact sheet. Every cell must have a broad completely empty transparent margin of at least 20% of the cell width and height on every side. Center all objects at the exact centers of the nine equal cells (one sixth, one half, five sixths of canvas dimensions). Object artwork occupies only about HALF its cell width/height. Do NOT fill the atlas tightly. All shadows and glow must end well before the generous cell margins. The gutter pixels must have alpha exactly ZERO, with no faint stray paint, specks, glows or invisible noise. For the webgpu gem use short contained rays; for the light icon keep the sun small and close to the hill. Never draw cell boundaries. Precisely nine compact icons in a uniform invisible 3x3 square lattice.
```
