# Task: generate three transparent brush atlases (Magna Urbis illustration style)

Use your built-in image generation tool (not code drawing, not SVG, not PIL shapes) to produce THREE new PNG
atlases with true alpha transparency. Save them exactly at:

- `web/src/render/assets/fantasy/families/foothills.png`
- `web/src/render/assets/fantasy/families/heath.png`
- `web/src/render/assets/fantasy/families/woodland.png`

Look first at the existing sibling atlases in the same folder for the style to match: `hills.png`,
`mountains.png`, `grasses.png`, `broadleaf.png`, `pines.png` (4 x 4 grids, top two rows black ink engraving,
bottom two rows ink + restrained watercolour colour). The new atlases must look like they belong to the same set.

If the image tool returns an opaque background, remove it so the exterior is genuinely transparent (alpha 0)
while the illustrated interiors stay opaque; a flat-colour/chroma background that you then key out is fine.
Final files: square PNG, RGBA, about 1254 x 1254 pixels (resize if needed), 4 columns x 4 rows of equal cells.
Do not modify any other file in the repository. Do not write code into the repository. When done, write a short
summary listing the three files, their pixel sizes and whether alpha is truly transparent at the corners.

## Common prompt (prepend to each atlas prompt)

Use case: stylized-concept. Production game asset: ONE fantasy RPG cartographic brush atlas. Genuinely transparent
background. EXACT regular square 4 columns x 4 rows, 16 equally sized cells, each illustration fits INSIDE THE
MIDDLE 75 percent of its cell with at least 12 percent blank transparent padding on ALL sides. Absolutely NO
illustration crosses a cell boundary. No labels, lines, borders, text, frames or backgrounds. Top two rows: EIGHT
DIFFERENT isolated black ink engravings with opaque white interior, no beige or colour, fine hand-drawn pen lines
and delicate cross-hatching. Bottom two rows: the matching EIGHT subjects in exquisite fine dark ink and
restrained watercolour colour. All 16 in the same gently plunging oblique view looking down about 40 degrees,
visible upright silhouettes, NEVER directly top down. Upper-left lighting. Each subject is grounded at the bottom
centre of its cell on a small unobtrusive footprint. Elegant refined premium fantasy RPG atlas, crisp readable
silhouettes at small map size. Natural asymmetry and visibly distinct outlines among variants, not copies or
mere flips. Truly transparent exterior with opaque illustrated interiors so overlapping sprites occlude. No
background shadows.

## Atlas 1: foothills.png

Subject: FOOTHILLS between mountains and plains, lower and greener than mountain peaks, higher and rockier than
rolling hills. Wide, squat silhouettes (width about 2 x height). The eight variations in row order: low rocky
spur with grassy flanks, double-humped foothill with a rock outcrop, long low ridge with a few scattered pines,
eroded knoll with scree, terraced shoulder of a hill with exposed strata, cluster of three small rocky knolls,
broad shoulder with a cliff on one side, gentle ridge with a saddle and tiny shrubs. Colour version: sage and
olive grass, warm grey and ochre rock, a few dark green tiny trees, ivory highlights.

## Atlas 2: heath.png

Subject: LOW HEATH, MOOR AND SCRUB ground cover clumps, 0.3 to 2 metres tall, wide and low, for dense ground
cover of uncultivated land. The eight variations in row order: heather clump, gorse bush with tiny flowers,
juniper scrub, bracken fern patch, tussock grass with stones, bramble thicket, low mixed scrub patch, small
broom bush. Colour version: muted heather purple, olive and sage greens, straw and dry ochre, a few yellow gorse
flowers, warm grey stones; restrained, not saturated.

## Atlas 3: woodland.png

Subject: DENSE WOODLAND CLUMPS for painted forests seen from a distance: tight groups of overlapping tree crowns
forming one compact mass, each clump wider than tall. The eight variations in row order: clump of five rounded
broadleaf crowns, clump of seven mixed broadleaf crowns of different sizes, clump of four tall conifers, clump of
six mixed conifers and broadleaves, long hedge-like row of crowns, dense oak copse, birch and alder grove with
lighter crowns, wedge of dark firs. Colour version: varied deep and mid greens with olive and a few autumn-free
yellow-green highlights, dark trunks barely visible.
