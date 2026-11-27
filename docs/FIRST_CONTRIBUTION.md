# Your first culture, 3D model or renderer variation

Start with the [procedural setup](../CONTRIBUTING.md#setup). From `web/`, run `npm run dev:v2` and open `http://127.0.0.1:5174/v2.html`. Prepare or reuse the procedural WASM packages first. If you work on the shared development machine, coordinate any build or test that compiles code through the shared build register in the main checkout, even when you are working in a separate worktree.

## Add an architectural style and culture

Copy the Copper Bastide entry in the [culture manifest](../contributions/urban-cultures.json) and append the copy to the array. Give it a unique lowercase hyphenated `id` and a display `label`, then choose a built-in culture as its `base`. Start with a base whose density, streets and building footprints suit the settlement you want to draw. The base supplies the settlement plan and native house recipes. The optional `recipes` object maps an inherited settlement slot, such as `core`, to an existing preset, such as `bastide/core`. See the [urban catalogue](../rust/crates/core/src/urban/catalogue.json).

Set `style.kit` to a kit ID from the historical or modern registry. Kits shape complex house volumes, including roof types and the chances of additions such as dormers. The compact and detailed native house modes use the base culture’s recipe pack. Start by changing `style.palette.homes`, the weighted wall colours for ordinary buildings. Each key is a `#rrggbb` colour and each value is a positive weight. `style.palette.special` optionally gives singular and collective buildings their own colours. See the [historical kits](../rust/crates/core/src/urban/forms/styles.json) and [modern kits](../rust/crates/core/src/urban/forms/styles_modern.json).

The Rust build validates and bundles the manifest. From `web/`, refresh the procedural packages with `npm run prepare:v2 -- --no-threads` for a local browser preview after a culture edit. If you preview with the native Rust engine, use a binary built from the same changes.

In V2, use seed `magnas` and a temperate plain for Copper Bastide. Open **Settlements**, turn off **Follow the environment**, and choose **Copper Bastide** or your new label. Run **Full generation**. To compare with **Bastide** or your chosen base on the same terrain, select the same settlement under **Cities**, change its local culture, and regenerate it. Select **Complex plans** under **House plans** to inspect the kit’s roof and body forms. Switch the map **Appearance** to **Satellite**, zoom to the houses and tilt the map to compare the roofs and façades.

## Add a 3D model

Copy the [market hall manifest](../contributions/models/market-hall.json) to a new JSON file in the same directory. Give it a unique `id` and `label`, fill in `attribution.author`, `attribution.license` and `attribution.source`, and set `culture` and `role` to the intended match. Import the file and add it to `MODELS` in [the shared authored-model registry](../web/src/render/city3d/authoredModels.ts). The example uses `copper-bastide` and `commerce.market.hall`, the covered market hall role. To preview a new version for that same pair, replace `marketHall` in `MODELS` with your imported model for the duration of the comparison.

Use indexed triangles in metres. Put the origin at the centre of the footprint at ground level, with X along the long side, positive Y facing the entrance, and Z pointing up. Set `footprintM` to `[width, depth]` and `heightM` to the overall height. Each triangle contains three zero-based vertex indices in counterclockwise order as seen from outside, followed by a key from `materials`. Use [built-in city materials](../web/src/render/city3d/materials.ts) and remove unused vertices. Give `near` and `overview` the same overall extents. Keep at most 128 triangles in `near` and 48 in `overview`, and use fewer triangles for `overview`. Simplify small trim and openings in `overview` while preserving the roofline and footprint. The hall uses 48 and 14 triangles respectively.

Open `http://127.0.0.1:5174/v2.html?model-preview=market-hall` to see the authored hall on the left and the ordinary silhouette on the right. Both use a fixed preview scene on flat ground. Replace `market-hall` in the URL with your model’s ID. To compare City Bench, run `npm run dev:benches` in `web/` and use `http://127.0.0.1:5173/citybench.html?standalone=1&model-preview=market-hall`. Append `&model-lod=overview` to either URL to start from the distant view.

Also check the model in a generated settlement. The 3D renderer fits the model to a walled, single-level rectangular silhouette body without holes when its culture and role match. Width, depth and height can each scale from 0.65× to 1.75×. If the model cannot fit, the renderer uses the regular building silhouette. The generated scene supplies the footprint, foundations and other building parts.

## Add a renderer variation

In the [market hall manifest](../contributions/models/market-hall.json), change `materials.roof` from `city3d:cover:metal@628b79` to `city3d:cover:metal@a66645`. The suffix is a six-digit sRGB tint. Both meshes use the `roof` key, so the main roof changes colour at both levels of detail. Reload the V2 and City Bench preview URLs and compare the roofs under the same camera and lighting.

For a behaviour change shared by several models, make the change in the shared renderer and keep the pages’ settings the same when checking it. The coordinate, material and rendering conventions are documented in [how urban buildings are drawn](methods/urban-buildings-rendering.md).

## Verify in V2

Keep the seed, terrain, population, map style, camera and building detail level fixed when comparing your change with the original. Save the recipe or share code so another contributor can reproduce the comparison.

Check a street close up, then look at the full settlement from overhead and in the tilted 3D view. Check that the street-facing entrance and roof read at street scale, buildings stay within their allotted sites, and courtyards and gaps remain visible. Compare near and distant views for missing pieces, changing silhouettes and flicker. If you changed geometry, record the triangle count at each level of detail. Check responsiveness while panning and tilting over a dense block, where repeated instances can make small mesh costs add up.

V2 is the reference. Use City Bench to debug the same inputs. Keep choices consumed by both pages in the [shared city contract](../web/src/render/cityContract.ts) or the relevant shared renderer. From `web/`, run the culture, model and parity checks against the current WASM packages.

```sh
npm test -- --project fast tests/v2/contributorCultures.test.ts tests/v2/contributorModels.test.ts tests/v2/cityParity.test.ts
```

Include the recipe or seed, before and after screenshots, check results, and any measured performance change with your contribution. Give the source and license for each asset you distribute, including textures. Use the project [license](../LICENSE) and [third-party notices](../THIRD_PARTY_NOTICES.md) when checking redistribution terms. Add user-visible changes under the upcoming version in the [desktop release notes](DESKTOP_RELEASE_NOTES.md).
