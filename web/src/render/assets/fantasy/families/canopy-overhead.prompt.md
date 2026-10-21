# Overhead forest crowns

Generated with the built-in image generation tool on 2026-10-21 for
Render3DBrush. `canopy-overhead.png` contains eight columns and four rows:
pines, broadleaf, tropical and dry-climate tree crowns, eight variants each.
The original Fantasy side-view sheets remain intact for their original style.
The runtime packer trims transparent margins before normalising each crown,
so the atlas gutter cannot accidentally shrink its world-space diameter.
Source hues are discarded by the packer; biome colours come from the material.

## Generation prompt

Use case: stylized-concept. Asset type: production forest canopy brush atlas
for satellite-like fantasy terrain rendering. Generate ONE wide landscape
sprite sheet in EXACTLY eight columns and four rows (32 separate sprites),
aspect ratio 2:1, ideally 2048 by 1024 pixels. Every sprite centred in its own
equal square cell. No grid lines, labels or text. GENUINELY TRANSPARENT
BACKGROUND with alpha between all sprites. Depict TREE CROWNS viewed from
ALMOST DIRECTLY ABOVE, camera elevation 80 to 85 degrees: predominantly the
TOP of the leaf canopy, NOT a tree seen from the side. Absolutely no visible
long tree trunk, no side-view tree icon, no distant ground, no detached cast
shadow. Every crown should occupy most of its cell (roughly 80 to 86 percent
of the cell width and height) with a small fully transparent gutter. Fine
naturalistic watercolor and delicate botanical ink, intricate realistic
leaf/branch clumps, soft upper-left lighting with gently shaded canopy relief,
subdued sage and olive foliage. Consistent overhead projection and drawing
scale throughout. Row 1: eight different overhead conifer crowns, pines and
spruce, rounded or softly stellate foliage crowns with dense overlapping
branch pads, natural irregular edges, no side-view Christmas tree silhouette.
Row 2: eight different large broadleaf crowns for oceanic and warm-temperate
forest, oak, beech, maple, abundant contiguous lush foliage with irregular
rounded multilobed boundary. Row 3: eight different very dense tropical canopy
crowns, wide interlocking cauliflower-like foliage clumps, almost completely
filled leafy interior, irregular rounded lobes, very few tiny holes, suitable
for forming a CLOSED RAINFOREST CANOPY when overlapped. Row 4: eight different
overhead dry-climate tree crowns, Mediterranean evergreen oak, olive, cypress
seen from above, acacia, slightly more open branching and dusty sage foliage,
still crown-focused overhead, never tall side views. All 32 crowns must have
distinct realistic silhouettes and distinct internal branching/leaf-clump
structure, not copies. Maintain generous foliage footprint, avoid thin narrow
canopies or a tall triangular icon. No paper backdrop, no soil circle, no
grass disks, no scenery, no checkerboard transparency pattern, no neon
outlines, no border, no watermark. The output must be an exact well-aligned
8 by 4 sprite atlas with transparent gutters.

## Spacing refinement prompt

Production sprite-sheet cleanup of the provided 32 overhead canopy atlas.
Keep exactly 8 columns by 4 rows, same 32 individual crown designs, same row
families, same almost directly overhead viewpoint, same fine watercolor
botanical detail and natural colours, same wide 2:1 canvas. Make EACH crown
about 15 percent smaller about the centre of its own cell so that every crown
has a clearly empty transparent gutter on all four sides. Every isolated
crown must remain entirely within its exact grid cell and must NOT touch
another crown in adjacent rows or columns. Each cell should have at least
10 percent truly transparent margin per side. Preserve complete natural crown
outlines, no clipped leaves along the grid lines. Preserve genuine alpha
transparency and transparent holes. No visible grid or labels, no background,
no new objects, no side-view trunks. Correct only the spacing and isolation;
maintain the existing canopy art.
