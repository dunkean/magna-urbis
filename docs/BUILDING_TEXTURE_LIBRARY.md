# Building texture library

[Français](BUILDING_TEXTURE_LIBRARY_FR.md)

This collection prepares roof, wall and wood textures for future integration. Files are in [`assets/materials/buildings/`](../assets/materials/buildings/README.md), outside assets loaded by the browser. No renderer or building generator is modified.

It follows the recommendations of [RENDER_SURFACE_DESIGN §7.1](RENDER_SURFACE_DESIGN.md#71-un-catalogue-de-recettes-alimenté-par-les-assets-existants) and [RENDER_REVIEW](RENDER_REVIEW.md): existing Poly Haven and ambientCG materials, with provenance and dimensions retained. The architectural scope is the **32 packs and 39 materials** in [`recipes.json`](../rust/crates/houses/data/recipes.json), used by [urban cultures](CITY_CULTURES.md). Associations are documentary; they do not replace native-recipe material choices.

## Contents and consultation

- [Inventory of types, sources and uses](../assets/materials/buildings/README.md): one row per PBR set, then material and pack coverage.
- [Color-map contact sheet](../assets/materials/buildings/contact-sheet.jpg): visual comparison of the materials actually downloaded.
- [JSON catalogue](../assets/materials/buildings/catalog.json): paths for all maps, pixel dimensions, sizes, SHA-256 fingerprints, download URLs, author, license, known physical extent, qualified mappings and complete per-pack inventory.
- [JSON selection](../assets/materials/buildings/selection.json): French types, candidate uses and limits for each texture. Each subdirectory also has its own standalone `material.json`.

Directories are organized by primary use; a material can be useful elsewhere:

| Directory | Types |
|---|---|
| `roof/` | terracotta and grey ceramic tiles, slate, thatch/straw/reed, wood shingles |
| `wall/` | clay and earthen plaster, white/colored plaster, fired brick, ashlar, rubble, stacked stone, sandstone, coral and volcanic stone |
| `wood/` | rough and aged wood, light/dark/weathered siding, cedar and hinoki, logs, round/woven bamboo, bark |
| `special/` | felt, woven cloth, leather/suede, snow, grass cover, dry earth, natural rock and rope |

## Preserved formats and conventions

The selected resolution is **1K**, to keep the complete collection at a reasonable size. Links and identifiers allow 2K/4K variants to be downloaded later from the libraries. Supplier maps are not recolored, resampled or GPU-packed.

Each set includes `base_color`, `normal_gl`, `roughness` and `height`. AO and other available useful maps are retained. For Poly Haven, color is JPEG and data maps PNG where offered. For ambientCG, files come from the official `1K-JPG` archive; original formats are retained, including any PNG maps in that archive. This is a working collection; PNG archives or higher resolutions may be preferable when preparing final assets.

- `base_color` is **sRGB**; normal, roughness, height, AO and opacity are **linear data**.
- Retained normal maps are **OpenGL (+Y)**, not DirectX. Any future conversion must be explicit.
- `physical_extent_m` corresponds to one full repeat. Poly Haven API dimensions are converted from millimeters to meters; ambientCG dimensions from centimeters to meters. An unspecified dimension remains `null`, without inventing a 1 m square. For example, [RoofingTiles015A](https://ambientcg.com/view?id=RoofingTiles015A) reports about 2.9 × 2.9 m, or `290` × `290` in its API.
- A height map alone does not reveal its physical amplitude. That amplitude remains `null` when not supplied by the source and must be calibrated before geometric displacement.
- Maps in a set must share UVs, orientation and scale. Tile/slate/shingle rows and thatch fibers follow the slope; wood follows each piece's grain. Inspect source-image orientation before fixing the frame. Rotating a normal map must transform its tangent components.

## Coverage and limitations

The inventory includes variant and component materials, not just each culture's default house. Each pack therefore has an explicit list of available, approximate and missing materials in the catalogue. **Documented coverage is not a validated historical reproduction.**

Earth/plaster textures approximate wattle and daub, cob, adobe and rammed earth; they do not contain unfired-brick joints or rammed-earth strata. Reeds approximate palm roofing without depicting palm leaves. Light sandstone approximates chalk and limestone; coral stone approximates shellstone. Volcanic stone is not certified as basalt and does not by itself reproduce clinker. Weathered wood, modern leather, grass/earth and surface snow are also qualified as approximations of driftwood, tent hides, turf blocks and compacted construction snow.

**No architectural bone has been acquired.** ambientCG search results for “bone” were hazard signs and were excluded. `MAT-BONE` remains explicitly `missing` in the material catalogue, which associates it with Arctic sources `AM-ARC-B01` and `AM-ARC-B06`. Current recipes do not reference it in their parameters, so this caveat is not counted as a missing texture in an active pack.

Grey tiles provide a material for Chinese, Korean and Japanese styles; they do not reproduce all their modules or profiles. Framing textures do not create half-timbering, joints or stilts. Log, dry-stone, monolith and snow textures do not replace geometry. Specific glazed roofs, thick limestone slates, facade patterns and other cultural variants must be selected or supplemented according to the precise integration need.

## Provenance and licenses

Collected asset files are **CC0 1.0** under [Poly Haven](https://polyhaven.com/license) and [ambientCG](https://docs.ambientcg.com/license/) terms. This third-party license is recorded in each `material.json` independently of the project's code license. Maps remain redistributable; retaining provenance helps locate their variants.

**Powered by [Poly Haven](https://polyhaven.com/)** and [ambientCG](https://ambientcg.com/). The tool uses their public APIs and official download links. The contact sheet is produced locally from color maps; no website presentation render is reused.

## Reproduce and verify

Prerequisites: Python 3 and Pillow. From the root:

```powershell
python scripts/fetch_building_textures.py
python scripts/fetch_building_textures.py --verify
```

The first command reuses sets already present and intact. It collects missing sets with at most two simultaneous downloads and rebuilds the catalogue, tables and contact sheet. The second is entirely offline: it verifies each file's SHA-256 and size, image decoding, map-dimension alignment, the four basic PBR maps and native-catalogue coverage. Poly Haven also supplies map MD5 hashes, checked during acquisition; ambientCG ZIPs are checked by size and CRC, then their SHA-256 hashes and those of the maps are recorded.

To add a texture, complete `selection.json`, qualify its `MAT-*` associations, then rerun collection. Update the English descriptions and source digest in `scripts/translate_building_textures.py`, then run that script to regenerate the translated inventory. It refuses changed French descriptions, an unrecognized texture or an untranslated non-direct material limitation. A change to `recipes.json` requires coverage review: the catalogue retains its SHA-256 to detect changes.
