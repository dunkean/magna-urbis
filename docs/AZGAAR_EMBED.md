# City iframe preview

The V2 build includes `embed.html`. It draws a schematic Canvas 2D plan on flat
ground, with the burg's approximate water, primary streets, blocks, and requested walls
and landmarks. After the first paint, the preview worker adds lanes and roofs to that
same plan. The canvas keeps its framing, water, roads and gates. Both passes use a
small deterministic TypeScript worker. It exits after the detail pass. The WASM city
engine is loaded by the full editor when the user opens it.

The public endpoint is `https://magna-urbis.org/embed.html` after publication.
In the development checkout, run `npm run dev:v2` in `web/` and open
`http://127.0.0.1:5174/embed.html?preview=1&name=Brackenford&population=2500&seed=12340007&walls=1`.

Opened directly, the preview includes **Randomize city** (French: **Tout changer**).
An embedded iframe hides these demonstration controls unless it receives `demo=1`.
The map supports drag, wheel, touch pinch, double-click, zoom buttons, and keyboard
navigation. English and French follow the `lang` query parameter or the stored V2 preference.

## Simple link

```html
<iframe title="City map" src="https://magna-urbis.org/embed.html?preview=1&amp;name=Brackenford&amp;population=2500&amp;seed=12340007&amp;coast=0&amp;river=0&amp;walls=1" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" style="width:440px;height:320px;border:0"></iframe>
```

`preview=1` displays the schematic map and the **Open in Magna Urbis** link.
Without `preview=1`, the same endpoint opens V2 in the current tab. The iframe link
opens V2 in a new tab. Both hand the original burg constraints to the regular city
importer. The full terrain can change where streets and buildings are laid out.

Flat query parameters reuse the existing Watabou city importer:

- `name`, `population` (people), `size` (Watabou size, used only when population is missing), `seed`.
- `river`, `coast`, `walls`, `citadel`, `urban_castle`, `plaza`, `temple`, `shantytown`, `farms`, `hub`.
- `sea`: Watabou direction, 0 east, 0.5 north, 1 west, 1.5 south; mapped to the nearest coast side.
- Additional FMG context: `capital`, `port`, `elevation` (metres), `temperature` (annual mean °C at
  the burg), `precipitation` (mm/year), `culture`, `cultureBase`, `cultureType`, `biomeId`, `biome`.

Boolean parameters accept `0`/`1` or `false`/`true`. The shared importer determines which fields
affect generation: currently `plaza` and `farms` are parsed but do not force generation options,
`hub=1` requests four regional exits, and a coast angle is reduced to a cardinal side. The schematic preview uses the plaza flag and can place a lake shore from a rich payload.
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
  externally. For the Magna Urbis provider, let the iframe handle pointer and wheel
  navigation and add `allow-popups allow-popups-to-escape-sandbox` to the existing sandbox
  permissions so its editor link can open the full studio. Keep the FMG editor's own
  open action as another way to reach the studio. Custom burg links retain priority.

The fragment supports at most 65,536 decoded characters. Invalid payloads display an error in
the iframe. No geometry import or terrain-constrained river tracing is added in this step.

## Validation

```sh
cd web
npm run build:v2
node scripts/v2_embed_check.mjs
```

The check serves a compressed production build under a subpath, with an FMG-sized iframe
on a second origin. It records first-plan and detail timings and bytes, checks phase order,
repeatability, resize, worker shutdown, invalid input and studio navigation from the iframe.
It also checks the four bundled changelog sections. Reports and screenshots are written to
`web/out/city-embed/`. Set `MAGNA_EMBED_TEST_LATENCY_MS` to add an HTTP response delay.
These are local measurements. The archived WASM generation profiles are documented in
[the previous handoff](HANDOFF_AZGAAR_EMBED_2026-11-19.md).
