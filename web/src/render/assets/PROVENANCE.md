# Natural map brushes

Generated with the built-in ImageGen tool on 2026-10-05, at the user’s explicit request. The untouched transparent RGBA originals and full generation/edit prompts are stored here. No manual pixel edits. Both atlases are 1254×1254, a 6×6 grid with 209×209 cells; symbols crop whole cells and keep their original alpha.

Vegetation rows: temperate, forest, desert, steppe, tropical, tundra. Column species are specified in prompts.json. Vegetation v2 corrects the birch (0,2) and steppe acacia (3,0) to overhead views. Terrain rows: dunes, rocks, grass, reeds, garden plants, crops.

Payload: 3497089 PNG bytes; base64 adds about one third. Only the main bundle embeds the URI literals. SVG exports embed each atlas once; classic exports contain no brush image.

{
  "biome-vegetation-v2.png": {
    "bytes": 1625224,
    "sha256": "af7a51b3d7cd4549ca68c1fdf5360eeb1cfbc53261331953646fdf091b927706"
  },
  "terrain-cultivation-v1.png": {
    "bytes": 1871865,
    "sha256": "889759ad696b9ace262b73236ab114bc202c1d8f215ae959cd77dec49dbee3c4"
  }
}

# Building and road materials (textured view)

`materials/albedo.webp`, `materials/normal.webp`, `materials/materials.json`: 256×256 tiles (vertical strip, LANCZOS downscale of the 1K maps) of CC0 PBR sets from [Poly Haven](https://polyhaven.com/) and [ambientCG](https://ambientcg.com/), built by `scripts/pack_building_textures.py` from `assets/materials/buildings` (sources and per-set provenance in `catalog.json`). Cover/wall/road → layer mapping is in `materials.json`. Loaded lazily, only when "Matières texturées" is on.

# Illustration brush families (round il5, 2026-11-08)

Runtime sheets in `fantasy/families/runtime/` (manifest entries added by `fantasy/families/pack_runtime.py`, 192 px cells, tight alpha rects, ink half then colour half):

- `peaks.webp`: from the existing `fantasy/families/mountains.png` (alpine peaks; ink cells 0-7, colour cells 8-15). Top relief tier.
- `shrubs.webp`: from the existing `fantasy/families/shrubs.png` (colour only, see `shrubs.prompt.md`); the ink half is derived (grey, contrasted) by `pack_runtime.py --color-only`.
- `foothills.webp`, `heath.webp`, `woodland.webp`: new atlases `fantasy/families/{foothills,heath,woodland}.png` (1256×1256 RGBA, 4×4, ink rows 0-1, colour rows 2-3), generated with the Codex CLI built-in image generation tool from the prompt `fantasy/families/new-il5.prompt.md` (result note `new-il5.result.md`). Foothills sit between ridges and hills; heath is uncultivated ground cover; woodland clumps carry the forest mass at a distance.
- Orchard placement uses the existing `broadleaf.webp` single round trees: ink cells 0, 1, 4; colour cells 8, 9, 12 (zero-based). The `orchards.webp` cells are multi-tree scenes and are excluded from orchard brushes. No bitmap assets were changed; crowns are 5–8 m on a parcel-aligned 9 m grid.

# Parchment symbols (ink and wash masks)

`parchment-symbols.json`: 16 cells of 64×64, two 8-bit masks per pixel (ink, wash), zlib + base64, 43.5 KB. Drawn by `parchmentSymbols.ts` for the parchment meadow, pasture, marsh and heath symbols; the colours come from the palette at draw time (biomes, seasons).
Source: generated on 2026-11-08 with the Codex CLI built-in image generation tool (transparent RGBA, 1254×1254, 4×4 cells), at the user's request. Original, request prompt and Codex's report with the exact image prompt: `parchment-symbols-source/` (`parchment-symbols-raw.png`, `prompt.md`, `codex-result.md`). Not shipped in the bundle.
Cells, row by row: grass tufts (0–3), reeds (4–7), heath cushion, scrub, small bushes, gorse (8–11), round crown, orchard crown, stones, boulder (12–15).
Packing: `python -I web/scripts/pack_parchment_symbols.py <raw.png> <out.json> [preview.png]`. The generator's soft alpha carries red and yellow fringes, so only masks are kept: ink = alpha × darkness, wash = remaining pale alpha; RGB is dropped. No manual pixel edits.

# Parchment trees (ink and crown masks)

`parchment-trees.json`: 36 cells of 96×96, two 8-bit masks per pixel (ink strokes, crown fill), zlib + base64, 292 KB. Drawn by `canopy.ts` (through `parchmentTrees.ts`) for the parchment woods, orchards and lone trees, in 2D and on the 3D drape; the palette tints, shades and casts the shadow at draw time.
Source: generated on 2026-11-08 with the Codex CLI built-in image generation tool (black ink on white, 1254×1254, 6×6 cells), at the user's request. Original, request prompt and Codex's report with the exact image prompt: `parchment-trees-source/` (`parchment-trees-raw.png`, `prompt.md`, `codex-result.md`). Not shipped in the bundle.
Cells, row by row: broadleaf crowns (0–17), fruit trees (18–23), plan-view conifers (24–26), side-view firs (27–29), clumps of two or three crowns (30–35). Cells 8, 14, 20 and 34 have open outlines and are not used.
Packing: `python -I web/scripts/pack_parchment_trees.py <raw.png> <out.json> [preview.png]`. Ink = darkness of the strokes; fill = holes of the closed ink mask; RGB dropped. No manual pixel edits.
