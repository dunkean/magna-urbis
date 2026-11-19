# City iframe preview

The V2 build includes `embed.html`. It generates one procedural city and displays it in the same
Minimal Canvas renderer as the full application. It has no workbench, hardware dialog, GPU
requirement, neural download or optional local service. Its generation worker stops after the
result arrives. The view fits the city and redraws when the iframe is resized. Up to six small
thumbnails are cached locally, so reopening a burg at the same frame size does not start the
engine. Cached thumbnails scale to fit on resize; a fresh generation at another initial size
retains the full vector renderer. A new application build invalidates these thumbnails.

After web publication, the endpoint is `https://magna-urbis.org/embed.html`.
For development, use `http://127.0.0.1:5174/embed.html` with `npm run dev:v2`.

Opened directly, the preview includes **Randomize city** (French: **Tout changer**), which randomizes culture, population,
geography and settlement features, with a short parameter summary. An ordinary embedded iframe
keeps these demonstration controls hidden; add `demo=1` to show them inside an iframe too.
The map supports drag-to-pan, wheel zoom towards the cursor, touch pinch, double-click zoom,
and + / − / recenter buttons. The `lang` query parameter and the saved interface preference
select the same language as the studio; English is the default. With the map focused, +, −, 0 and arrow keys also work. Cached
thumbnails can be panned and zoomed as images; freshly generated maps retain vector detail.

## Simple link

```html
<iframe title="City map" src="https://magna-urbis.org/embed.html?preview=1&amp;name=Brackenford&amp;population=2500&amp;seed=12340007&amp;coast=0&amp;river=0&amp;walls=1" sandbox="allow-scripts allow-same-origin" style="width:440px;height:320px;border:0"></iframe>
```

`preview=1` displays only the map and a small attribution/editor link. Without `preview=1`, the
same endpoint opens the full V2 editor with the source city inputs and generates automatically.
The full editor uses its normal terrain quality; the preview uses a 128-cell terrain and regional
raster, skips erosion and forest generation, and renders building footprints from the native
silhouette architecture. It does not replace the Rust city generator with an approximation.

Flat query parameters reuse the existing Watabou city importer:

- `name`, `population` (people), `size` (Watabou size, used only when population is missing), `seed`.
- `river`, `coast`, `walls`, `citadel`, `urban_castle`, `plaza`, `temple`, `shantytown`, `farms`, `hub`.
- `sea`: Watabou direction, 0 east, 0.5 north, 1 west, 1.5 south; mapped to the nearest coast side.
- Additional FMG context: `capital`, `port`, `elevation` (metres), `temperature` (annual mean °C at
  the burg), `precipitation` (mm/year), `culture`, `cultureBase`, `cultureType`, `biomeId`, `biome`.

Boolean parameters accept `0`/`1` or `false`/`true`. The shared importer determines which fields
affect generation: currently `plaza` and `farms` are parsed but do not force generation options,
`hub=1` requests four regional exits, and a coast angle is reduced to a cardinal side.
Missing parameters retain the importer's defaults. These links describe constraints, not an
exact terrain, coastline or river course.

## Recommended Azgaar PR: export payload in the fragment

Send the existing `fmg-burg-v1` object described in [AZGAAR_IMPORT.md](AZGAAR_IMPORT.md), directly
from FMG's burg/cell data. No console prompt, clipboard, full-map export, POST endpoint or
cross-origin DOM access is needed. A single city payload is small enough to use ordinary JSON;
compression and messaging are unnecessary for this first integration.

```js
function magnaUrbisLinks(data) {
  // data is the fmg-burg-v1 object, with population already scaled to people.
  const link = new URL('https://magna-urbis.org/embed.html');
  link.hash = new URLSearchParams({ burg: JSON.stringify(data) }).toString();
  const preview = new URL(link);
  preview.searchParams.set('preview', '1');
  return { link: link.href, preview: preview.href };
}
```

Example object:

```json
{
  "format": "fmg-burg-v1",
  "i": 12,
  "name": "Skarholm",
  "population": 5000,
  "mfcgSeed": "12340012",
  "capital": false,
  "port": true,
  "citadel": true,
  "walls": true,
  "plaza": true,
  "temple": false,
  "shanty": false,
  "type": "Naval",
  "elevation": 40,
  "temperature": 8,
  "precipitation": 900,
  "biome": { "id": 6, "name": "Temperate deciduous forest" },
  "river": false,
  "confluence": false,
  "coast": { "sea": 0.5, "water": "ocean" },
  "culture": { "name": "Norse", "base": "Nordic", "type": "Naval" }
}
```

Preserve the original seed as text: `burg.MFCG || mapSeed + String(burg.i).padStart(4, '0')`.
For inland burgs, send `coast: null` and `river: false` explicitly. For rich payloads, an optional
`mfcg` Watabou URL carries the existing size/road/farm hints. In a generator adapter inside
`Burgs`, obtain it from `createWatabouCityLinks`, **not** `getPreview`, which would recurse after
Magna Urbis becomes the selected provider. The fragment payload takes precedence over flat fields.

FMG integration points (upstream checked at `74136292b8012abe0d57a11ac7780ddc43d9433d`):

- `src/model/political/burgs-generator.ts`: add a `magna-urbis` provider to `getPreview` and a
  method returning the `{link, preview}` pair above.
- `src/controllers/political/burgs/burg-group-editor.ts`: add the provider to the preview selector.
- `src/controllers/political/burgs/burg-editor.ts` already embeds `preview` and opens `link`
  externally. Its iframe uses `allow-scripts allow-same-origin`, which this endpoint supports.
  For Magna Urbis, set the iframe's `pointerEvents` to `auto` instead of `none` so pointer and
  wheel events reach its built-in map navigation; leave the existing behavior for other providers.

The fragment supports at most 65,536 decoded characters. Invalid payloads display an error in
the iframe. No geometry import or terrain-constrained river tracing is added in this step.

## Validation

```sh
cd web
npm run build:v2
node scripts/v2_embed_check.mjs
```

The check serves the production artifact under a subpath, embeds it from another origin with
FMG's sandbox restrictions, records cold/cached generation timings, checks deterministic output,
resize, a rich coastal burg, invalid input, released workers, and the four bundled changelog
sections. Reports and screenshots go to `web/out/city-embed/`. Its local timings exclude public
network transfer time. The shared WASM engine remains a substantial first-download asset.
