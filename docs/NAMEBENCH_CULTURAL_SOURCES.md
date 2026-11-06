# Cultural source policy for generated place names

Each toponym profile declares `sourceMode`, `coherence`, and `rootGrammar` in
`web/src/gen/names/profiles.ts`. Architectural culture selects a naming palette;
it does not establish the language of an entire modern country or attest a
historical place name. Explicit language selection overrides that palette.

## Geographic sources

The following modern geographic inspiration is deliberately bounded:

| Profile | GeoNames country pool |
| --- | --- |
| French | FR |
| English | GB |
| German | DE |
| Italian | IT |
| Dutch | NL |
| Arabic / Moroccan medina | MA |
| Persian | IR |
| Turkish | TR |
| Chinese | CN |
| Japanese | JP |
| Korean | KR |
| Russian | RU |
| Polish | PL |
| Vietnamese | VN |

These are current geographic samples, not language-pure wordlists or proof of
historical continuity. GB, MA, IR and CN in particular include multiple naming
traditions. Selecting them means modern geographic inspiration for the named
profile, with `coherence: modern-geographic`. Country provenance remains visible
in the profile. A future authenticated language corpus can replace an individual
policy without changing the resolution API.

GeoNames records come from Namebench's original `name` field, not its ASCII or
alternate-name fields. The generated pack's source database SHA-256, row counts,
feature codes and attribution are recorded in `names-manifest.json`. The pack is
unchanged by the cultural policy layer. Upstream: [GeoNames](https://www.geonames.org/).

## Original fictional sources

`web/src/gen/names/data/cultural-roots.json` is original authored material for
Magna Urbis. It contains **55 separate fictional phonotactic palettes**. There
are no scraped words, translated dictionaries, sampled real people, or claims
of authentic Indigenous or historical morphemes in this file. Coincidental
matches to real words or places are possible. Tokens are design material, not
linguistic documentation.

Each palette explicitly lists consonant onsets, vowel nuclei, permitted codas,
syllable counts, and separate bound roots for habitation, river, lake, sea,
forest, hill, region and farm. The feature roots are fictional type markers,
not translations. A feature uses its own root table; a forest or river never
inherits the town generator. Dedicated PRNG forks keep each feature stable
when another entity is added or reordered.

The following profiles use these original constructions instead of a broad
modern country pool:

- Roman, Greek/Byzantine, Norse, Celtic, Slavic, Sanskrit/Indus/Rajput,
  Egyptian, Nubian, Mesopotamian and Levantine.
- Maya, Aztec, Andean, Khmer, Sahel, Swahili, southern African, west African,
  Himalayan, Javanese, Burmese, Tibetan, Mongolian, Arabian, Caucasian,
  Ethiopian and Dravidian/Tamil.
- Māori, Inuit, Siberian, Guaraní and Australian/Budj Bim.
- Five distinct North American palettes: Iroquoian, Pueblo, Plains,
  Mississippian and Pacific Northwest. They share no US country source and
  do not claim to describe a single Indigenous language or nation.

In particular, Roman names never select modern Italian towns; Tamil names
never select India-wide places; Māori names never select New Zealand towns;
Inuit names never select Canada-wide places; Siberian names never select
Russia-wide places; North American Indigenous names never select US towns.
These profiles report `sourceMode: constructed` and
`coherence: fictional-phonotactic`. The profile diagnostic states the fictional
status. This is an explicit fictional design choice, not an authenticity claim
attached to an unrelated geographic corpus.

Modern geographic profiles also have their own authored palette for feature
types absent from the source database, such as forests and farms. A returned
record identifies the actual source mode for that feature. No generic French,
English or family-bridge grammar fills these gaps silently.

## Fantasy generators

Elven, dwarven, orcish and halfling settlements use the existing, usable generic
Namebench patterns `elven_citys`, `dwarven_citys`, `orcish_citys` and
`fantasy_towns`. These originate in
[Snake4life/fantasy-names](https://github.com/Snake4life/fantasy-names), as
recorded in the generated manifest. No franchise category is used. The original
Roman and Viking generator entries in the source database have empty arrays;
they are excluded rather than silently substituted with modern towns.

English and halfling features may use explicit `places.rivers`, `places.lakes`,
`places.forests`, `places.mountains` and `places.lands` generators when there is
no applicable geographic pool. Other fantasy features use their own typed
authored roots. No settlement generator supplies a river or forest.

## Structured names and display translation

`generateToponymRecord` returns `proper`, `cultural`, `kind`, `opaque`, `profile`,
`sourceMode` and `coherence`. Geographic records also preserve the exact original
string in `corpusLabel`. `generateToponym` returns the cultural string for callers
that need the convenience API.

Imported bare typed names such as `Loire` or `TsingTao` can receive a translated
generic feature descriptor while keeping the proper name unchanged. A reviewed
table of standalone descriptors conservatively marks complete labels such as
`River Avon`, `Lac Léman`, `Loch Ness` and `Sumiyō Gawa` opaque. These rules only
annotate the complete source string: they never strip a word, translate a proper
name, split an unknown compound, or infer its grammatical gender. Bound material
inside a proper name is retained. False-positive opacity is preferable to
corrupting a source label; unlisted descriptors remain a limitation of this
small policy table.

Constructed records keep their typed root separate from an explicit cultural
descriptor template or syntax wrapper. Display-language selection uses that
structure and never reseeds generation. Generic translation and cultural syntax
are presentation layers; the fictional roots do not become authenticated words
because a descriptor is translated.

Algorithm version 2 and the combined corpus fingerprint cover both the
Namebench pack SHA-256 and the exact authored JSON SHA-256. The quality test
verifies the latter and the combined fingerprint, along with profile separation,
typed roots, source exclusions and independent deterministic generation.
