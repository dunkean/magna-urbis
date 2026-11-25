# Magna Urbis documentation

Published at <https://magna-urbis.org/scientific/index.html>; the V2 "How it works?" link
and every stage "?" button open it there.

| Page | English | French |
|---|---|---|
| Atlas of methods: how a world is generated, stage by stage | `index.html` | `fr.html` |
| Architectural styles: the 115 cultures | `catalogue-architecture.html` | `catalogue-architecture-fr.html` |

The pages are generated; edit the sources in `src/`, never the HTML.

The 25 November 2026 architecture update has a direct link in each reader. The atlas explains how planned volumes become a close-range 3D mesh ([English](index.html#architecture-detail), [French](fr.html#architecture-detail)). The catalogue compares standard and detailed renderings of the same generated Dravidian house ([English](catalogue-architecture.html#architecture-compare), [French](catalogue-architecture-fr.html#architecture-compare)). Its 115 town and village sheets retain the dated November 14 captures.

- `src/atlas.en.mjs`: atlas chapters, English source. `src/atlas.fr.mjs` is its complete French translation.
- `src/stages.mjs`: one card per stage id of `web/src/v2/stageRegistry.ts` (EN and FR). The card's HTML id is
  `stage-<id>`, the anchor the V2 links to.
- `src/diagrams.mjs`: the inline SVG diagrams, with bilingual labels; colours follow the page theme.
- `src/catalogue-data.mjs` reads the Rust culture catalogue (`rust/crates/core/src/urban/catalogue.json`,
  `culture.rs`, `forms/styles*.json`); `src/catalogue.mjs` renders it; `src/catalogue.{en,fr}.json` hold names
  and descriptions. `src/catalogue-images.py` converts the per-culture captures of
  `web/out/planches-styles-v7/` into `assets/cultures/`.
- `src/shell.mjs`, `styles.css`, `reader.js`: page shell, theme (light and dark) and progressive enhancement.
- `src/FACTS-2026-11-14.md`: the facts gathered from the code for the 14 November 2026 refresh.

```sh
node docs/scientific/src/build.mjs     # writes the four pages
node docs/scientific/check.mjs         # rebuilds, then checks stage cards and local files
```

Publishing: copy `index.html`, `fr.html`, both catalogue pages, `styles.css`, `reader.js` and `assets/` into
`scientific/` on the `gh-pages` branch.
