Use your built-in image generation tool (do not write code to draw it, do not use PIL to paint it) to create ONE image, then save it.

Goal: a sprite atlas of small hand-drawn map symbols for an antique parchment map seen from directly overhead (plan view, map-symbol convention, like 18th century estate maps and Tolkien-style regional maps), drawn in sepia/brown ink with a very light muted watercolour wash.

Format:
- Square image, 1024x1024, TRANSPARENT background (RGBA, alpha 0 outside the strokes). No paper texture, no background colour, no frame, no grid lines, no text, no labels, no numbers.
- A 4x4 grid of equal invisible cells (256x256 each). One symbol centred in each cell, the symbol occupying about 60 percent of its cell, never touching the cell border.
- Ink colour: dark sepia (#4a3a22 to #5a4a2a), thin even pen stroke weight (about 3 px at 1024), slightly irregular hand line. Wash: very pale, desaturated olive (#9a9a62 at low opacity) only where noted. Low contrast, delicate, nothing bold.

Cells, row by row (left to right):
Row 1 (meadow grass tufts): 1) small tuft of 5 fine curved grass blades fanning upward from a common base, 2) a smaller 3-blade tuft leaning right, 3) a tuft of 4 blades with one longer blade, 4) a pair of tiny tufts side by side.
Row 2 (marsh reeds): 1) a cluster of 4 vertical reed stems with one cattail head, a short horizontal water stroke under it, 2) three reeds and two short horizontal water dashes, 3) bent reeds clump, 4) a single row of short water-level dashes with tiny reed ticks.
Row 3 (heath and scrub): 1) a low rounded heather cushion drawn as a cluster of tiny scribbled loops with pale olive wash, 2) a small irregular scrub bush, scalloped outline, pale wash, 3) a cluster of 3 tiny bushes, 4) a gorse/broom clump as a star of short spiky strokes.
Row 4 (misc): 1) an isolated round deciduous tree crown seen from above, scalloped outline, pale olive wash, small shadow crescent on the lower right, 2) an orchard tree: smaller neat round crown with a dot trunk shadow, 3) a small group of 3 rocks drawn as angular outlines with a hatched shadow side, 4) a single boulder with hatching.

Style must be consistent across all 16 cells: same ink, same line weight, same scale logic, same wash. Overhead map symbols, not side views of plants, not 3D.

Save the generated image unmodified as D:/workspace/self/magna-urbis/web/out/render-board/par5-codex/parchment-symbols-raw.png (keep the alpha channel). If the tool returns a non-transparent background, still save it as is and say so. Then write in your final answer: the file path, the image size, whether it has real transparency, and the exact prompt you gave to the image tool.
