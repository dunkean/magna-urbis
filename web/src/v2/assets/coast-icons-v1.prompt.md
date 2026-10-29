# Coast icon atlas · v1

Generated 28 October 2026 with the built-in ImageGen tool through the imagegen skill. This is a new generated raster asset, not an SVG substitute or a hand-drawn placeholder.

- Asset: `coast-icons-v1.png`
- Canvas: 1536 × 1024 pixels, RGBA PNG.
- Sprite grid: three columns × two rows; each cell is 512 × 512 pixels.
- Coordinates, zero-based: north coast (0,0), northeast coast (1,0), island (2,0), inland (0,1), archipelago (1,1), empty (2,1).
- Cardinal coasts rotate the north swatch by 0°, 90°, 180°, 270° for N, E, S, W.
- Corner coasts rotate the northeast swatch by 0°, 90°, 180°, 270° for NE, SE, SW, NW.
- Palette: warm parchment/beige and olive green land; muted blue sea, painted shoreline.
- The generation output is copied unchanged. No crop, resize, recolour, or manual replacement was performed.
- Transparency inspected with Pillow read-only: alpha extrema 0–254; 740,609 pixels have alpha 0. Main silhouettes are isolated within their cells. The unused sixth cell has only numerical alpha residue (maximum 1 out of 255), with no visible icon; it is never consumed by the UI. Coloured RGB values under alpha 0 are not visible backgrounds.
- Generation source: `C:/Users/U108-N257/.codex/generated_images/01a184a4-a211-7f01-86a9-59dcddf45565/exec-340b0fc0-1ebe-4852-aee3-9a5b15d79819.png`.
- Style inspiration inspected: `../icons-v2.png`. It was not edited.

## Final prompt

```text
Use case: ui-mockup.
Asset type: one production PNG sprite atlas for a fantasy cartography application's coastline buttons.
Create exactly one transparent-background sprite sheet, landscape 3:2 aspect ratio, ideally 1536 by 1024 pixels. Arrange exactly SIX equal square cells in a mathematically regular THREE-COLUMN, TWO-ROW grid, each cell 512 by 512 pixels. Do not draw grid lines. Each icon occupies 80 percent of its own cell, centered, leaving clean transparent gutters so CSS can crop the six cells independently.

Style: beautiful hand-painted cartographic miniature icons matching classic parchment fantasy map UI: warm sandy beige land, olive/sage green grass, muted turquoise and slate-blue sea, subtle ink shoreline, little white wave strokes. A top-down flat square map swatch, NOT a perspective landscape or an isometric diorama. Clean, bold silhouettes, restrained detail, legible at 40 pixels. All five populated icons have the SAME scale, same roughly square outline with softly irregular paper/map edges and a delicate outline/shadow. The backdrop outside their individual map swatches and every gutter must be genuinely transparent alpha, not a painted checkerboard or white background.

EXACT CELL CONTENTS:
TOP ROW LEFT (cell 1): NORTH COAST. Blue water occupies only the top quarter to top third of the swatch. A clear gently wavy east-west coastline separates sea above from beige and green land across the bottom two-thirds. The other three edges are land.
TOP ROW MIDDLE (cell 2): NORTHEAST CORNER COAST. Blue water occupies only the TOP-RIGHT corner as a triangular corner bay. A gently curved diagonal coastline runs from the top edge near its middle to the right edge near its middle. The bottom and left edges are entirely beige-green land. This must clearly differ from the north coast.
TOP ROW RIGHT (cell 3): SINGLE ISLAND. One simple beige-green roundish island at the center of a blue sea swatch, with water visibly surrounding it on all sides.
BOTTOM ROW LEFT (cell 4): INLAND. A dry beige-green land swatch, absolutely NO BLUE WATER, with two small green hill marks and a few tiny trees.
BOTTOM ROW MIDDLE (cell 5): ARCHIPELAGO. Three to five distinct small beige-green islands surrounded and separated by blue sea.
BOTTOM ROW RIGHT (cell 6): Completely empty transparent space. Draw nothing in this sixth cell.

No letters, direction arrows, labels, typography, numbers, compass roses, icons outside the specified cells, borders around the whole atlas, UI buttons, mockup frames, or watermark. It is an asset sheet, not a screenshot.
```
