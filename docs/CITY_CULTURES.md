# City Bench urban cultures

[Français](CITY_CULTURES_FR.md)

The native catalogue `rust/crates/core/src/urban/catalogue.json` describes **79 cultures**: the original 53 and 26 added on October 22, 2026 for a medieval and fantasy world inspired by reality. Each culture is an **urban-form** recipe (fabric, enclosure, core, densities, lots and phases) linked to an **existing house pack** by `urban/culture.rs::MAPPINGS`. No house recipe is invented by the city stage: packs belong to the `houses` engine.

Numerical values are **artistic generation ranges**, not surveys. `XX-YY-Snn` references point to the [architectural atlas](styles_architecturaux_mondiaux_city_mapper.md).

## How a culture is constructed

| Element | Where | Role |
|---|---|---|
| `plan` | `cultures[id].plan` | fabric (`organic`, `grid`, `terraces`, `linear`, `radial`, `dispersed`), enclosure shape, fortification, gates, orientation, stairs, waterfront |
| `nucleus` | `cultures[id].nucleus` | central monument (`kind` → `services.json::nucleus` role), shape and area; gives the central neighborhood its role |
| `phaseCount`, `faubShare`, `ring` | `cultures[id]` | number of rings by population; suburb share (enclosed / open); `ring: null` = a single phase (camps) |
| `core/ring/faubourg/village/hamlet` recipes | `presets[id/recette].params` | streets (`streets`, `streetOp`, `closeOp`), lots (`plotOp`, `frontage`, `plotDepth`, `houseArea`, `coverage`), density by zone (people/ha), widths by rank |
| `growth` | `cultures[id].growth` | a camp becoming a town above `minPop` (`grown-*` recipes) |
| `MAPPINGS` | `urban/culture.rs` | land family, pack, declared borrowing (fantasy), functional profile, architectural family |
| `PREFERRED` | `urban/culture.rs` | default native recipe when the pack’s “smallest envelope” heuristic would choose a less typical house |
| service family | `urban/services.json::cultures` | facilities (worship, markets, storage, etc.), labels and household occupancy |

The new cultures are produced by reproducible generator [`docs/methods/city_cultures_generator.mjs`](methods/city_cultures_generator.mjs) (base = existing preset + overrides, like `extensions` in `rust/scripts/export-urban-catalogue.ts`): `node docs/methods/city_cultures_generator.mjs rust/crates/core/src/urban/catalogue.json` replaces only its 26 entries and leaves the rest intact. Rerunning the old TypeScript export **would erase** them: first carry these specifications into its `extensions`.

## The 26 added cultures

| Id | Label | Fabric · enclosure | Core | Core/middle/edge density (people/ha, core preset) | Core lot (front × depth, m) | Pack → default house | Services |
|---|---|---|---|---|---|---|---|
| <a id="al-andalus"></a>`al-andalus` | Al-Andalus · Iberian patio medina | organic, wall, slope | great mosque | 300/220/140 | souk 4.8–7 × 7–12; patios 7–12 × 14–24 | AF-MAG → B02 (courtyard), B01 as shop | islamic |
| <a id="italian-comune"></a>`italian-comune` | Italy · comune with piazza and towers | organic, successive cerchie | piazza | 364/252/154 | 7.5–10 × 17–28 | EUR-MED → B02 narrow row house in core, B09 portico for mixed use, B04 in borghi | european |
| <a id="flemish-cloth-town"></a>`flemish-cloth-town` | Flanders · cloth town with belfry | organic, canals, enclosures | belfry + Grand-Place | 210/160/110 | 6–8 × 26–44 | EUR-MED → B11 stepped gables, B05 hall for mixed use | european |
| <a id="rynek-town"></a>`rynek-town` | Central Europe · town with rynek | grid, oval enclosure | large square 0.8–3 ha | 170/140/100 | 7–10 × 28–40 | EUR-MED → B03 half-timbered house | european |
| <a id="slavic-gord"></a>`slavic-gord` | Slavic · palisaded gród and podgrodzie | radial, palisade | gród (castle) | 80/60/45 | 12–18 × 26–40 (courtyards) | EUR-EAST → B01 izba | european |
| <a id="caucasian-highland"></a>`caucasian-highland` | Caucasus · Georgian and Armenian fortified town | terraces, wall | enclosed church | 195/150/103 | 6–10 × 12–20 | EUR-EAST → B03 Caucasian house | european |
| <a id="ethiopian-highland"></a>`ethiopian-highland` | Ethiopia · highland town | organic, open | circular church enclosure | 130/105/85 | 12–20 × 18–30 compounds | AF-EAST → B04 highland house | african |
| <a id="great-zimbabwe"></a>`great-zimbabwe` | Zimbabwe · dry-stone enclosure | organic, oval | royal enclosure (`royal-enclosure` → palace) | 60/45/35 | 28–38 × 30–42 compounds | AF-SOUTH → B05 hut compound | african |
| <a id="hausa-kano"></a>`hausa-kano` | Hausa · walled earthen city-state | organic, earthen wall | great mosque | 140/110/80 | courtyards 19–26 × 20–30 | AF-SAHEL → B05 Hausa courtyard house, B04 as shop | islamic |
| <a id="hadhrami-tower"></a>`hadhrami-tower` | Hadhramaut · vertical city (Shibam) | compact, rectangular, walled, single phase | mosque | 450/380/300 | 7–11 × 9–15 | AS-MIDE → B13 Hadhrami tower house (4–7 levels) | islamic |
| <a id="rajput-fort"></a>`rajput-fort` | Rajputana · town below a fort | organic, wall, slope | fort (garrison) | 260/190/120 | bazaar 5–8 × 12–20; havelis 13–25 × 22–32 | AS-IND → B10 balcony house (courtyard), B01 as shop | indian |
| <a id="dravidian-temple"></a>`dravidian-temple` | South India · concentric temple town | grid + square rings, cardinal gates | temple 2–8 ha | 200/160/110 | 5.5–8 × 24–40 | AS-IND → B01 rectangular house | indian |
| <a id="bagan"></a>`bagan` | Myanmar · royal city of Pagan | grid, square enclosure, river | temple | 90/70/50 | enclosures 14–22 × 20–32 | AS-SEA → B01 stilt house (platform) | indian |
| <a id="vietnamese-citadel"></a>`vietnamese-citadel` | Việt · citadel and merchant quarter | square citadel; organic extension | citadel 4–12 ha | 140/120/90 | citadel 25–34 × 36–48; tube houses 6–9 × 26–46 | AS-SEA → B04 courtyard house, B02 on narrow lot | chinese |
| <a id="tibetan-monastery"></a>`tibetan-monastery` | Tibet · sloped monastic town | terraces, stairs | monastery | 300/220/160 | 12–17 × 14–21 (`compound` family) | AS-HIM → B04 gallery house, B03 on narrow lot | indian |
| <a id="mongol-ordu"></a>`mongol-ordu` | Mongol · yurt ordu; walled capital ≥ 8,000 people | radial, cardinal gates; then walled grid | khan’s tent (steppe family) | 105/90/75 | 10–16 × 12–20 | AS-STEP → B01 yurt | steppe |
| <a id="maori-pa"></a>`maori-pa` | Māori · fortified terraced pā | terraces, palisade | — (clan common square) | 420/350/280 | 7–12 × 10–16 | OC-PAC → B03 whare | clan |
| <a id="pnw-plank-village"></a>`pnw-plank-village` | Northwest Coast · plank-house village | linear, facing shore | — | 90/80/70 | 13–20 × 28–38 | AM-PNW → B01 long plank house | clan |
| <a id="inuit-camp"></a>`inuit-camp` | Arctic · Inuit winter camp | dispersed, shore | — | 260/228/195 | 8–13 × 9–14 | AM-ARC → B05 igloo | clan |
| <a id="siberian-camp"></a>`siberian-camp` | Siberia · chum camp | radial | — | 210/192/168 | 9–14 × 10–15 | AS-SIB → B01 chum | clan |
| <a id="guarani-village"></a>`guarani-village` | Guaraní · longhouse village | radial, palisade | — (clan dance square) | 105/90/83 | 12–20 × 26–38 | AM-SOUTH → B03 Guaraní longhouse | clan |
| <a id="budj-bim"></a>`budj-bim` | Australia · Budj Bim stone village | dispersed, channels | — | 200/180/160 | 8–13 × 10–16 | OC-AUS → B03 stone hut | clan |
| <a id="lizardfolk-swamp"></a>`lizardfolk-swamp` | Lizardfolk · stilt lake city* | dispersed, walkways | sacred pool | 131/116/102 | 9–14 × 14–22 | AM-TROP → B05 stilt house (platform) | fantasy |
| <a id="merfolk-tidal"></a>`merfolk-tidal` | Merfolk · strand and sea caves* | organic, stairs, waterfront | tidal shrine | 176/152/128 | 8–13 × 12–20 | OC-PAC → B08 lagoon stilt house | fantasy |
| <a id="giant-hold"></a>`giant-hold` | Giants · megalithic town* | radial, cyclopean enclosure, streets ×2 | jarl’s hall | 25/22/18 | 20–32 × 40–60 | EUR-NOR → B01 longhouse | fantasy |
| <a id="goblin-warren"></a>`goblin-warren` | Goblins · hillside warren* | organic, dead ends (0.95), palisade | — | 320/260/200 | 17–24 × 15–22 | AS-SIB → B08 semi-underground house | fantasy |

`*` indicates declared fantasy borrowing (`borrowed = true` in `MAPPINGS`): the culture uses cited real morphologies; strict mode rejects it as a documented tradition.

Functional profile (`MAPPINGS`, fifth field): `communal` = one household per lot (tents, igloos, family huts, stilt houses); `town` allows multiple households per lot according to usable area (`services.json::occupancy`). The `town` profiles are lineage compounds of `great-zimbabwe`, the ordu (`mongol-ordu`, which becomes a walled capital), multifamily plank houses (`pnw-plank-village`) and the goblin warren.

The six house packs previously without a city are now used: AM-ARC, AM-PNW, AM-SOUTH, AS-SIB, OC-AUS, OC-PAC (32 of 32 packs).

### `clan` service family

New family for lineage villages without a temple town (Māori, Northwest Coast, Inuit, Siberia, Guaraní, Budj Bim): common house (landmark), gathering square, raised caches/granaries, waterside canoe shelters, drying sheds/workshops and small elevated shrines. Occupancy: 8 people per household, 40 m² per household, at most 6 households per lot (large clan houses).

## Land consistency (October 22 check)

Each culture is replayed on a City Bench map (`city_replay.mjs --sites`, neighborhoods → parcels → building sites) and judged by lot/household balance, not counts alone: a buildable lot left as garden indicates a house recipe that does not fit the lots; households without a lot indicate incorrect density or profile. Corrections from this check:

| Culture | Symptom (before) | Correction | After |
|---|---|---|---|
| `italian-comune` | 53% of lots in gardens: parcels sized for the pack’s compact B04 house, but the program required the B09 portico (7 × 13.2 m) | lots 7.5–10 × 17–28; B02 in core, B09 mixed, B04 outside walls; density ×1.4 instead of ×1.8 | 1% gardens, 1,111 households housed |
| `tibetan-monastery` | 47% gardens (same B04 / B03 mismatch) | lots 12–17 × 14–21; `compound` family (lot-by-lot choice between B04 and B03) | 2% gardens |
| `ethiopian-highland` | no housing on 04 (median slope 0.27 > AF-EAST-B04’s admitted 0.21); 27% gardens on 13 | verification map 13; density 130/105/85 | 1% gardens, 588 homes |
| `great-zimbabwe`, `mongol-ordu` (12,000), `goblin-warren` | households without lots (one household per lot imposed) | `town` profile | 1.5 / 1.9 / 3.7 households per lot, all housed |

### Verification replay (native server, October 22 tree)

Frozen City Bench neighborhood requests with culture and population replaced (`web/out/p5-cultures-final/<culture>-<map>-<pop>/`, `.png` images beside each request). “Homes” means domestic or mixed building sites; “warn” excludes cadastral remnants < 0.02 m². `european-organic` and `medina` are references.

| culture | map | people | blocks | streets | lots (plot) | gardens | residential | requests | homes | homes/plot | warn | ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| european-organic | 01-river-plain-s | 5000 | 162 | 145 | 863 | 98 | 38 | 872 | 846 | 0.98 | 3 | 3432 |
| medina | 05-arid-plateau-s | 5000 | 171 | 271 | 423 | 69 | 53 | 436 | 410 | 0.97 | 3 | 3770 |
| al-andalus | 07-arid-shore-s | 5000 | 206 | 272 | 724 | 160 | 51 | 735 | 710 | 0.98 | 3 | 4237 |
| italian-comune | 03-aegean-hills-s | 5000 | 131 | 128 | 417 | 109 | 32 | 422 | 397 | 0.95 | 4 | 5245 |
| flemish-cloth-town | 01-river-plain-s | 5000 | 95 | 88 | 651 | 41 | 48 | 660 | 634 | 0.97 | 3 | 3379 |
| rynek-town | 13-temperate-valley-s | 5000 | 139 | 131 | 710 | 105 | 34 | 718 | 693 | 0.98 | 3 | 4710 |
| slavic-gord | 09-boreal-river-s | 5000 | 187 | 158 | 1175 | 105 | 17 | 1146 | 1112 | 0.95 | 12 | 4441 |
| caucasian-highland | 04-mountain-bay-s | 5000 | 227 | 214 | 658 | 184 | 77 | 652 | 619 | 0.94 | 8 | 11129 |
| ethiopian-highland | 13-temperate-valley-s | 5000 | 95 | 124 | 611 | 51 | 3 | 619 | 589 | 0.96 | 2 | 6094 |
| great-zimbabwe | 05-arid-plateau-s | 5000 | 202 | 177 | 467 | 261 | 16 | 483 | 453 | 0.97 | 3 | 4386 |
| hausa-kano | 05-arid-plateau-s | 5000 | 137 | 441 | 651 | 315 | 47 | 662 | 639 | 0.98 | 5 | 11965 |
| hadhrami-tower | 07-arid-shore-s | 5000 | 147 | 149 | 426 | 191 | 97 | 436 | 414 | 0.97 | 4 | 10877 |
| rajput-fort | 05-arid-plateau-s | 5000 | 138 | 255 | 512 | 159 | 40 | 505 | 486 | 0.95 | 5 | 6356 |
| dravidian-temple | 01-river-plain-s | 5000 | 119 | 102 | 761 | 108 | 54 | 734 | 716 | 0.94 | 2 | 3398 |
| bagan | 01-river-plain-s | 5000 | 75 | 106 | 695 | 51 | 3 | 701 | 683 | 0.98 | 1 | 2427 |
| vietnamese-citadel | 13-temperate-valley-s | 5000 | 54 | 60 | 306 | 72 | 24 | 316 | 301 | 0.98 | 4 | 7707 |
| tibetan-monastery | 04-mountain-bay-s | 3000 | 107 | 95 | 294 | 22 | 16 | 294 | 279 | 0.95 | 2 | 5668 |
| mongol-ordu | 05-arid-plateau-s | 3000 | 85 | 127 | 627 | 77 | 2 | 564 | 546 | 0.87 | 3 | 4086 |
| mongol-ordu | 01-river-plain-s | 12000 | 119 | 206 | 1153 | 97 | 3 | 1176 | 1137 | 0.99 | 1 | 2828 |
| maori-pa | 02-atlantic-coast-s | 800 | 46 | 40 | 97 | 3 | 16 | 101 | 91 | 0.94 | 5 | 4568 |
| pnw-plank-village | 02-atlantic-coast-s | 600 | 14 | 26 | 61 | 40 | 1 | 64 | 57 | 0.93 | 0 | 6965 |
| inuit-camp | 09-boreal-river-s | 150 | 7 | 16 | 22 | 0 | 1 | 25 | 18 | 0.82 | 2 | 3614 |
| siberian-camp | 09-boreal-river-s | 200 | 6 | 15 | 31 | 2 | 1 | 34 | 25 | 0.81 | 2 | 2455 |
| guarani-village | 13-temperate-valley-s | 500 | 46 | 36 | 66 | 3 | 17 | 71 | 62 | 0.94 | 12 | 3532 |
| budj-bim | 02-atlantic-coast-s | 300 | 6 | 20 | 73 | 0 | 0 | 46 | 38 | 0.52 | 1 | 9714 |
| lizardfolk-swamp | 01-river-plain-s | 1500 | 102 | 93 | 318 | 18 | 33 | 312 | 300 | 0.94 | 1 | 4303 |
| merfolk-tidal | 07-arid-shore-s | 1500 | 83 | 83 | 303 | 13 | 14 | 310 | 299 | 0.99 | 1 | 4193 |
| giant-hold | 09-boreal-river-s | 800 | 55 | 55 | 146 | 88 | 3 | 145 | 138 | 0.95 | 3 | 3489 |
| goblin-warren | 03-aegean-hills-s | 2000 | 74 | 88 | 114 | 0 | 16 | 115 | 106 | 0.93 | 2 | 11309 |

## Known gaps

- `pnw-plank-village`: a town of 600 has only “village” blocks, where the program imposes one household per lot (`programme.rs`): 57 houses for 75 households in the final replay. Large plank houses (30–50 people) would require multi-household capacity in village zones too.
- General mismatch between stages (outside culture files): the parcel first witnesses the pack’s compact house (`parcels/admission.rs::compact_fallback`) while the program requires the main recipe for `frontage`/`compact` families; only `courtyard`/`compound` families reuse the compact house lot by lot. Any main recipe over 1.5 × the pack’s compact-house area leaves lots empty.
- `ethiopian-highland` and other single-story, single-house packs refuse slopes > 0.21: on a mountain map, the town empties.
- `guarani-village`, `maori-pa`: some blocks of the palisaded ring have no continuous street contact and remain open space (subdivision warnings).
- Houses remain those of the packs: no giant house, goblin warren or merfolk cave; no gopuram, stupa, belfry or isolated Hadhrami tower as a specific monument (monuments are program reserves).
- Bridges: `footprint/crossings.rs::spans` does not know the new cultures (default 1.0); camps (`inuit-camp`, `siberian-camp`, `mongol-ordu`, etc.) should be treated there as ford builders.
- Contextual variants (`culture.rs::contextual_uncached`) cover only narrow lots; elite houses (Tuscan towers EUR-MED-B08, Svan towers EUR-EAST-B04) are not yet selected by social rank.
- `hadhrami-tower` declares one phase (`phaseCount [[0, 1]]`, `ring: null`): Shibam is a single walled rectangle. The October 22 replay (shared tree, composition stages being redesigned) nevertheless produces 3 epochs and 2 enclosures on 07: the culture’s phase count is no longer respected by composition.
- Counts vary between replays while parcel/composition stages evolve (e.g. `budj-bim`: 41 lots then 73 lots, 40% gardens).
