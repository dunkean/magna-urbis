# Sharing recipes

[French original](MAP_RECIPES_FR.md).

In the Rust workshops (terrain, settlements, urban planning and houses), **Export code** opens a `MU.…` recipe. You can copy this text or download a **.murecipe** file. **Import code** accepts pasted text, including line breaks, or the same file. Import automatically opens the right workshop.

The recipe retains applied parameters, seeds, pins and notes when present, the camera, and display settings serialized by the workshop. Generation drafts do not replace the applied state. No URL-shortening service or account is required.

New procedural exports retain the terrain recipe and the list of crops aligned to its cells. On import, the same workshop regenerates the terrain, then replays the crops and recomputes subsequent stages with their parameters. Data without a reconstruction recipe (such as older .decor files) is embedded directly. A local heightmap is included: no local-storage identifier is left as the sole source of terrain. These cases can therefore produce longer codes, for which a file is more convenient.

The format is compact JSON, zlib-compressed using a dictionary of common settings, then base64url-encoded. The checksum detects damaged codes. The file contains exactly the same code followed by a newline. Compatibility between generator revisions is not guaranteed.

The codec is in `web/src/ui/recipe.ts` (`encodeRecipe` / `decodeRecipe`). The interface and reconstruction are in `recipeSharing.ts`. `recipeDictionary.json` contains only vocabulary and common values, not a map catalog. The developer script `node scripts/recipe_dictionary.mjs` regenerates it from Vite; this deliberately invalidates old codes.

Verification from `web/`:

```powershell
npx vitest run tests/ui.recipe.test.ts
node scripts/recipe_ui_check.mjs http://127.0.0.1:5173
```
