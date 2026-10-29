# Magna Urbis Atlas of Methods

Open [index.html](index.html?lang=en) for the English edition (the default),
or [fr.html](fr.html?lang=fr) for the French edition. Both contain all 19
chapters, from terrain to houses, with an annotated bibliography, contracts,
limitations, original SVG diagrams and attributed screenshots.
The visible EN/FR links preserve the current chapter. They share the app's
explicit language preference through `magna-urbis-v2-language`; the browser
locale never overrides the default English choice. A `?lang=en|fr` URL wins.

Content and images work offline without remote dependencies. Search filters
chapters; both complete static pages remain readable without JavaScript.
Browser printing includes every chapter even after filtering.

From the repository root:

```sh
node docs/scientific/check.mjs
node docs/scientific/check.mjs --browser
node docs/scientific/localize.mjs --check
node docs/scientific/build.mjs
node docs/scientific/build.mjs --out web/dist-v2/scientific
```

Browser verification uses Playwright installed in `web/` and the local
Chrome channel. It checks English and French, a French browser locale with
English as the fresh default, chapter-preserving switching, search and
navigation, mobile layout, local images, PDF printing and reading without
JavaScript. Evidence is written to `web/out/scientific-docs-bilingual/`.
The static build exports both pages and all assets to
`web/out/scientific-site/` by default. It does not delete its destination.

`fr.html` is the editorial source. `translation-source.json` records its
ordered content fragments; `translations-en.tsv` contains the corresponding
curated English text. Separate JSON catalogues cover attributes, explanatory
code/formulas and diagrams. Run `node docs/scientific/localize.mjs` to generate
`index.html`, both language controls and the English SVG variants.
The verification mode fails when French source content changes without an
explicit translation review, or when a generated page/diagram is stale.
It also verifies matching chapter IDs, source links, bibliography URLs and
unchanged diagram geometry across languages.

`styles.css` and `reader.js` provide local progressive enhancement.
`data-repo` links refer to checkout files but open GitHub.
`evidence.json` records source fingerprints, local state beyond HEAD,
available recipes, provenance limitations, figure hashes and translation
fingerprints. Screenshots retain their original capture language and pixels.

`record-evidence.mjs` regenerates the manifest and exact copies of all eight
screenshots. It also requires the ignored historical artifacts in
`web/out/city-visual-bench/03-validated/` and `web/out/v2-browser/`; do not run
it when either folder is missing. Ordinary reading, checking and exporting
do not depend on them. It updates documentation fingerprints: review claims
and captions before treating a new inventory as a renewed scientific review.
`record-localization.mjs` updates translation and translated-diagram provenance
without recollecting or relabelling historical screenshots and reports.

Historical screenshots are not presented as current V2 captures.
Diagrams are explanatory, not to scale, and are not measured outputs.
The documentation does not claim scientific certification of the generator.

The five V2 reports in `evidence/` are exact copies of project integration
checks, with their scopes and limitations. They distinguish WASM/native urban
generation, project composition, terrain platforms and Windows desktop startup.
`collect-reports.mjs` collects those reports and SHA-256 hashes without
refreshing code fingerprints; `record-evidence.mjs` performs both inventories.
A successful house regeneration case does not prove exact replay of every
possible edited recipe.
