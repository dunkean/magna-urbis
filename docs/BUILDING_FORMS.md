# Building forms: masses, roles, roofs and styles

How buildings get their shape, and how to add a style, a building part, a monument or a house plan without touching the generation pipeline.

French version: [BUILDING_FORMS_FR.md](BUILDING_FORMS_FR.md).

## The idea

A building is an assembly of **masses**: convex footprints (mostly rectangles in the building's own frame) that never overlap in plan, each with a label saying what it is (`building`, `wing`, `nave`, `aisle`, `cavea-2`, `pagoda`…). Three layers turn masses into volumes:

| Layer | Code | Data | What it decides |
|---|---|---|---|
| Plan | `urban/forms/plan.rs` (homes), `urban/parcels/monuments/*.rs` (singular and utility buildings) | `forms/styles.json` (kits) | Which masses stand where |
| Raising | `urban/forms/roles.rs`, applied in `urban/massing.rs` | `forms/roles_*.json` | Wall height, base, roof kind and pitch, tiers, materials of each label |
| Roofs | `urban/forms/roof.rs` | none | The roof solids and their union across the lot |

The renderers receive explicit roof pans and never recompute a roof, so a new roof form needs no web code.

## Options

These are fields of the city layout configuration, shown in the V2 and City Bench panels.

| Option | Values | Effect |
|---|---|---|
| `houseComplexity` | `simple` (default), `complex` | `complex` composes homes with the plan grammar and gives them composed roofs, chimneys and dormers. A single isolated structure (lone farm, mill, inn) is always composed. |
| `singularDensity` | 0 to 3, default 1 | Scales the number of singular and utility buildings (monuments, inns, taverns, stables, warehouses). 0 keeps only the nucleus landmark. |
| `backBuildings` | 0 to 1, default 0.5 | Share of the town lots (core and middle zones) built under half of their tissue's coverage that build the ground behind their house; the others keep their court or garden. Only a body on a street or a lane is a house: the others are low dependencies (`annex`), reached through their lot. 0 leaves every lot with its house alone. |
| `styleSheet` | per facet, weighted cultures | Hybrid cities: which cultures the streets, plots, houses, monuments and farms draw from (see below). Empty by default. |

Monuments, utility buildings and isolated buildings use the forms engine whatever the first option says.

## Roofs

A pitched roof over a convex mass is the lower envelope of a few planes; the roof of a lot is the upper envelope of its masses' roofs. Consequences:

- a wing whose gabled end stands against a body at least as high runs into that body's roof up to its ridge, with true valleys;
- a `shed` whose rule says `"high": "main"` is a lean-to dying against the taller wall it touches (aisles, galleries, outshots);
- a tower, a chimney or a dormer hides the roof under it and stands out of the slope;
- eaves pass the walls where a building stands free.

Composed kinds: `gable`, `hip`, `shed`, `pyramid`, `halfhip` (clipped gable), `gablet` (hip under a small gable, the East Asian hip-and-gable), `gambrel`, `mansard`, `saltbox`. Flat and curved roofs (`flat`, `dome`, `cone`, `barrel`, `tent`) are drawn by the renderers from their kind and only occlude.

To add a pitched kind, add its planes in `roof.rs` (`planes`) and its fallback in `plain`. Nothing else changes.

## Mass roles (`forms/roles_*.json`)

One rule per label; a label without a rule keeps the built-in raising of `massing.rs`. The schema is documented in the `_doc` of `roles_core.json`. In short:

| Field | Meaning |
|---|---|
| `eave` | Wall height above the base: `{"m":[lo,hi]}`, `{"floors":n}`, `{"rel":[lo,hi]}` (lot storeys plus an offset), `{"nave":k}` (times the monument's nave height), `{"width":k}` (times the mass's short side), `{"main":k}` |
| `base` | `"ground"`, `"stack"` (on the mass under it), `{"m":x}`, `{"main":k}` |
| `roof`, `pitch`, `strict` | A kind, `"culture"`, or a draw `"a|b"`; degrees, a range, or `{"culture":delta}`; `strict: true` keeps the rule's pitched roof under a flat-roof tradition, which otherwise flattens ordinary pitched kinds |
| `axis`, `high` | Ridge direction (`long`, `short`, `street`, `main`, `cross`); high side of a shed (`main`, `street`, `back`) |
| `tiers` | Receding storeys: `{count, inset, first, skirt:{rise,overhang}, top}` (pagoda, stepped tower, stupa, lighthouse) |
| `round` | Replace the footprint by a regular polygon of that many sides |
| `wall`, `cover`, `openings`, `minor`, `overhang`, `floors`, `composable` | Materials, blind walls or door only, small decorative mass, eaves, shown storeys, body that may break into parts |

`overrides` replace a rule for one culture id or one monument family (`western`, `orthodox`, `maghreb`, `persian`, `chinese`, `japanese`, `indic`, `antique`, `american`, `african`): this is how a culture raises a shared part in its own way. An override key may also be a **group** that several cultures share: a culture lists its groups in its `roleGroups` trait, read after its own `overrides.<culture id>` (`roles_modern.json`: `modern-flat`, `terrace-flat`, `concrete-flat`, `mansard`, `green-roof`, `tin-roof`, `informal`, `suburban` for homes; `art-deco`, `highrise`, `gulf`, `soviet`, `cyberpunk`, `brutalist`, `danji`, `atompunk`, `space-colony`, `biopunk`, `glass-office` for towers and special parts).

Files: `roles_core.json` (home parts and generic parts), `roles_monuments_a.json` (classical, medieval, Islamic, civic), `roles_monuments_b.json` (utility, Asian, American, African, fantasy), `roles_rural.json` (farmsteads, countryside activity sites and monuments), `roles_modern.json` (modern styles).

## Home plans (`forms/plan.rs`, `forms/styles.json`)

The occupation fits the home's body in its lot; the grammar composes around it, in the room the lot leaves, a plan drawn from the kit: `bar`, `ell`, `tee`, `court` (two rear wings), `cross` (a taller cross-wing at one end), `aitch` (one at both ends), then extras (lean-to outshot, porch, front bay, stair turret in the inner angle). Parts are whole rectangles with labels `building`, `wing`, `crosswing`, `outshot`, `porch`, `bay`, `turret`; each is fitted in the lot and dropped when it does not hold.

A **kit** (`styles.json`, `kits.<id>.house`) holds the plan weights, how much room and wealth favour the larger plans, the chances of the extras, of chimneys and dormers, the roof kinds of a home, the eaves and the chimney material. A culture gets its kit from `cultures.<id>.kit`, else from the first `derive` rule its building traits match (roof kind, wall, cover, pitch), else from `default`. Code never tests a culture's name.

## Singular and utility buildings (`parcels/monuments/`)

A form lays labelled parts on its site with the `Site` mini-language of `parcels/landmark.rs`: `rect`, `bar`, `disk`, `apse`, `small`, `poly`, `ellipse`, `wedges` (ring of seating), `ring`, `court`. `monuments::build` asks each family in turn: `modern`, `metropolis` and `rural` first (they answer only their own roles; `modern` and `metropolis` only for the cultures whose traits state an `era`), then the cultural ones (`classical`, `islamic`, `asian`, `american`, `african`, `fantasy`, `medieval`), then the shared `civic` and `utility` forms. A family that declines leaves the site and the random stream untouched, and the older forms of `landmark.rs` then apply.

Which roles exist, for which cultures and how many is the programme's business: `services.json` (families, `cultureServices`, `harbour`, counts) and `roles.rs`. The layout option `singularDensity` scales how many a place gets.

## Countryside sites (`activities.json`, `parcels/monuments/rural.rs`)

Activity sites and countryside monuments use the same forms as the towns. An archetype of `activities.json` may carry `form: {role, site, has, absorbs}`: `role` names the form to build (a `services.json` role such as `worship.parish`, or a countryside one, `rural.windmill`, `rural.barrow`), `site` the ground it needs in metres (front, depth), `has` a part label the culture's form must hold (else the building keeps its single ring), `absorbs` the archetypes of the same yard that the form already contains (a belfry, a cloister). `activities::formed` then replaces the building by the parts of that form, one building per part, on ground the site accepts; a form refused by the ground or not built by the culture leaves the yard as it was.

`rural.rs` holds the `rural.*` forms: mills by type (water, tide, post, tower, smock, vertical-axis), sawmills, forges and smelters, kilns (lime, brick, glass, charcoal, tar), mine heads, quarries, salt works, fishing stations, press houses, tithe barns, granaries, dovecotes, sheepfolds, watch and beacon towers, toll houses, hermitages, wayside shrines, crosses and wells, megaliths, barrows and tombs. A sub-role fixes a variant (`rural.windmill.post`); the bare role lets the culture and the site choose. Their parts are raised by `roles_rural.json`.

**Countryside farms (`landuse/farms.rs`, `landuse/rural_farms.rs`).** The farms the land-use stage scatters over the countryside follow the culture of the nearest settlement. Their type is drawn among that culture's farm types (the `farmstead` block of `catalogue.json`), each weight multiplied by the site rules of the stage (slope, wet ground, exposure, soil, farm size). The classic types keep their own constructor (`court`, `range`, `hall`, `ring`…); every other type is laid out by `steading` from its catalogue record: the house at the type's size, its `core` buildings and a draw of its `ancillary` ones (more on a larger farm), at the catalogue's footprints and the culture's body scale, arranged by the type's `layout`: a court (`closed`, `u`, `l`), a row (`linear`, `terraced`), a round compound (`round`) or a scatter (`scattered`). Every building of a placed farm then carries `parts[i].massing`: one piece of the display contract of the town buildings, raised by `activities::countryside_farm_massing` with the code of the settlement farmsteads (the culture's building tradition, composed roofs on the house, the outbuildings as the low volumes of the farm type). The fields the farm already emitted (`use`, `arch`, `roof`, `material`, `type`, `culture`) are unchanged.

## Remote places (`activities.json` `remote`, `settlements/remote.rs`)

Rare single places whose situation is the point: a temple on a summit, a monastery on a cliff ledge, a sanctuary cut at the foot of a rock face, a tower on a crag, a hermitage on a sea stack, a tomb in a gorge, lost ruins deep in a forest or on a marsh island. They are activity sites like the others (same templates, yards, forms and ground test), placed by the terrain instead of a resource anchor. A template of `activities.json` is a remote place when it carries `remote: {situations, access, ruined, weight}`; the `remote` block of the file holds the two vocabularies and the rarity.

**Situations** are cheap tests on the planning grid: the heights round the point in eight directions on a near ring (1.5 cells, 60 m at least) and a far ring (3 cells, 180 m at least), the water mask and two resource potentials. Thresholds are data (`remote.situations.<id>`).

| Situation | The point stands there when |
|---|---|
| `summit` | everything on both rings is lower, by `drop` metres on average on the far ring, and no water lies within it |
| `crag` | a summit whose near ring falls at `grade` or more in `sides` directions of eight |
| `cliff-ledge` | in one direction the ground falls at `grade` on the near ring and by `drop` metres on the far ring (a ledge or a cliff top; more dramatic with rock rising behind) |
| `cliff-foot` | in one direction the ground rises at `grade` and by `rise` metres, while the opposite side stays under `ease` |
| `gorge` | the ground rises by `rise` metres on two opposite sides and runs on between them (more dramatic with a river) |
| `islet` | open water (sea or lake) lies within `reach` metres in `sides` directions of eight; `stack` metres above the water make a full sea stack |
| `marsh-island` | level ground (`ease`) at most `above_water` metres above its water, in peat (`peat` potential) or with water in `sides` directions |
| `deep-forest` | the `wood` potential holds here and 500 m all round, on ground under `ease`, at least `far` metres from any settlement |

**Accesses** (`remote.accesses.<id>`): each template lists the kinds it may have with a weight; they are tried in a weighted random order and the first one the ground allows is kept.

| Access | `line` | What it is |
|---|---|---|
| `none` | `none` | No path at all: `accessClass` is `none`, the site is not a road endpoint and no route is searched |
| `track` | `path` | The ordinary trail of the site, to its door |
| `cliff-stair` | `fall` | Steps cut straight down the fall line, up to `grade` 1.2, at most `reach` metres |
| `rock-steps` | `fall` | The same on gentler rock (`grade` 0.7): the steps traverse where the fall line is too steep |
| `tunnel` | `bore` | A gallery through the rock from the place to the first easy ground below |
| `causeway` | `span` | A line across the water to the nearest other shore, within `reach` |
| `rope-bridge` | `span` | The same over a shorter gap |

A `fall` line starts at the front of the yard and takes, step by step, the steepest way down a stair may take (the fall line, else a traverse beside it), until the slope eases under `path_grade` or it meets water; it may exceed any road grade but never its own `grade`. The line is one open installation of the site (`cliff_stair`, `rock_steps`, `rock_tunnel`, `tidal_causeway`, `rope_bridge`; ground kinds `engineered_path`, `underground_work`, `crossing`), and `access` is its far end: the ordinary trail of the site is routed to that point only. The site also carries `situation` and `approach` (the access kind), and `kind: "remote"`.

**What stands there** is the template's business, in the forms of the culture:

| Template | Situations | Building | Accesses |
|---|---|---|---|
| `summit_sanctuary` | summit, crag | `rural.summit-temple`: the sanctuary on its stepped platform inside a terrace wall, the stair on the axis; a chapel with its apse in the Christian West and East | rock steps, cliff stair, none, track |
| `cliff_monastery_site` | cliff-ledge | `rural.cliff-monastery`: hall against the rock, a range either side, a lower row of cells and the gate tower on the brink, steps between the levels | cliff stair, none, tunnel, rope bridge |
| `rock_sanctuary` | cliff-foot, gorge | `rural.rock-sanctuary`: the carved front against the rock, its porch and two colossi | none, track, rock steps |
| `crag_tower` | crag, summit, cliff-ledge | the watch tower (`rural.watchtower`) | cliff stair, rock steps, none |
| `stack_hermitage` | islet, cliff-ledge, crag, marsh-island | the hermitage (`rural.hermitage`) | none, causeway, rope bridge, cliff stair |
| `lost_ruins` | deep-forest, marsh-island, gorge, islet | the culture's rural temple or chapel, always in ruins | none, track, causeway |
| `gorge_tomb` | gorge, cliff-foot, islet | the tomb of the culture (`rural.tomb`) | none, rock steps, track |
| `forgotten_stones` | deep-forest, marsh-island, summit | megaliths, a cairn for the cultures without them | none, track |

`ruined` is the share of a template found in ruins: `activities::ruined` turns every building into the broken walls of its own footprint (`parcels/ruins.rs`). Cultures weigh the templates through the `prefer` weight of their required building (`cultures.families` and `overrides`: cliff monasteries for the Tibetan, Himalayan, Byzantine, Ethiopian and Caucasian cultures, rock-cut sanctuaries for the ancient, Ethiopian and dwarven ones, summit temples in East Asia, India and the Americas); code never tests a culture's name.

**Rarity.** A region gets `rate` × √(land / 100 km²) × frequency places (1.2 on 100 km², 4.8 on 1 600 km² at frequency 1; the fraction is drawn from the seed, `most` caps it). Candidates come from a jittered grid of at most 48 × 48 probes, each refined on the top of its rise and eight points round it, and from the shore cells of the islands read on a stride (256 × 256 tests at most, an islet being smaller than a probe cell); the score is the situation's weight times its drama. Places stand `clear` metres from every settlement, `spacing` apart and `site_gap` from the other countryside sites, so a region without dramatic ground gets none. The placement option `remotePlaces` (`settlements::Config.remote_places`; "Remote places frequency" beside the dispersed farms density in the regional controls) is the frequency: 0 gives none, 1 is the default, 10 the most.

**Ground.** A yard is laid on the candidate, then on two rings of eight spots round it, with every corner dry. Each body passes `ground_fits`; a form takes its whole `site`, then a tighter one, else the single body stays. A candidate that holds no required building is dropped.

## Adding things

| To add | Do this |
|---|---|
| A style's homes | A kit in `styles.json` (or reuse one), and `cultures.<id>.kit` if the derive rules do not pick it |
| A culture's way of raising a part | An entry under `overrides.<culture or family>` in a `roles_*.json` |
| A new part of a building | A label in a form and its rule in a `roles_*.json` |
| A monument or utility building | A form in the family file of `parcels/monuments/`, the role in `services.json` |
| A countryside site or monument | A `rural.*` form in `parcels/monuments/rural.rs`, its part rules in `roles_rural.json`, `form: {role, site}` on the archetype in `activities.json` |
| A remote place | A template in `activities.json` `sites` with `remote: {situations, access, ruined, weight}` and no `context`, its id in `ACTIVITY_TEMPLATES` of `rust/bridge/urbanConfig.ts`; a `prefer` weight on its required building for the cultures given to it |
| A situation | Its thresholds under `remote.situations` and its predicate in `situations` of `settlements/remote.rs` |
| An access | An entry under `remote.accesses` with one of the lines `none`, `path`, `fall`, `span`, `bore` and its installation archetype; a new line kind is a branch of `approach` in `settlements/remote.rs` |
| A modern style | A culture in `styles_modern.json` (kit, traits with `era` and `roleGroups`), its tissue and five presets in `catalogue.json`, its row in `culture.rs` `MAPPINGS`, its services family (`cultures`) and own buildings (`cultureServices`) in `services.json`, its groups in `enclosures.json` and `activities.json`; new forms in `parcels/monuments/modern.rs` or `metropolis.rs` and their rules in `roles_modern.json`; web: its English label in `gen/options.ts`, French label in `v2/interfaceMessages.ts`, toponyms in `gen/names/profiles.ts`, `v2/cityCodeDefaults.json`, and its climate zone in the v7 sheet `run.mjs` |
| A home plan | A branch in `plan.rs` `compose` and its weight in the kits |
| A roof kind | Its planes in `roof.rs` |

## Culture traits

What sets a culture's buildings apart and is not in its tissue lives in `cultures.<id>.traits` of `styles.json` (`styles_modern.json` for the modern styles): the roof tradition of a culture whose tissue declares no `arch` (`tradition`), Mediterranean building (`mediterranean`), the roof-top detail family of flat roofs (`flavor`), the inhabitants' size (`bodyScale`), the scale of the whole house (`metricScale`), the exterior form of homes (`form`: tree, mushroom, longhouse, yurt, battered, mage, stilt) and the share of lots that take it (`formShare`), a single massive storey (`massiveStorey`), pile houses (`piles`), facade openness (`openness`, `lightWallOpenness`), the era of a modern style (`era`: `modern`, `futuristic`, `alien`; empty for the historical and fantasy cultures), the override groups it shares (`roleGroups`) and its wall palette (`palette`). `massing.rs` reads these traits and never a culture's name. The web reads `era` through `cultureEra(culture)` of `gen/options.ts`, which imports `styles_modern.json`.

## Modern, futuristic and alien styles

The 36 styles of `docs/Modern_cities_review.md` are cultures of `styles_modern.json`; each has its tissue (five presets: core, ring, faubourg, village, hamlet) in `catalogue.json`. Styles of one building tradition share a kit, a services family and override groups; their differences are tissue parameters and traits.

| Era | Styles |
|---|---|
| `modern` | `american-grid`, `industrial-victorian`, `haussmannian`, `belle-epoque`, `mediterranean-modern`, `garden-city`, `art-deco-metropolis`, `modernist-functionalist`, `soviet-socialist`, `american-suburbia`, `european-contemporary`, `global-high-rise`, `gulf-contemporary`, `informal-urban-expansion`, `eco-city`, `japanese-contemporary`, `chinese-megacity`, `korean-high-rise`, `southeast-asian-tropical`, `south-asian-metropolis`, `latin-american-grid`, `latin-american-hillside`, `north-african-contemporary`, `sub-saharan-african-metropolis`, `middle-eastern-contemporary`, `australian-suburban`, `post-socialist-european` |
| `futuristic` | `cyberpunk`, `solarpunk`, `dieselpunk`, `dystopian-brutalism`, `atompunk-retrofuturist`, `post-apocalyptic-ruins`, `corporate-arcology`, `futuristic-space-colony` |
| `alien` | `biopunk-organic-city` |

| Kit | Homes |
|---|---|
| `brick-rowhouse` | Brick row houses and walk-ups (grid, Victorian, Art Deco, dieselpunk) |
| `masonry-apartment` | Stone and plaster apartment buildings (Haussmannian, Belle Époque, Mediterranean, Latin grid, North African, Middle Eastern, post-socialist) |
| `suburban-house` | Detached and semi-detached houses with porches (garden city, suburbia, Australian, atompunk) |
| `concrete-slab` | Slabs and towers (modernist, Soviet, high-rise, Gulf, Chinese, Korean, cyberpunk, brutalist, arcology) |
| `eco-block`, `compact-mixed`, `informal-block`, `pod-habitat`, `organic-pod` | Timber blocks, small mixed plots, self-built houses, habitat modules, grown pods |

Services families: `industrial` (nineteenth and early twentieth century: factories, stations, department stores), `modernist` (slabs, towers, stadium, power plant, television tower, monument), `contemporary` (malls, offices, towers, stadium; worship per culture), `informal` (open markets, workshops, schools), `futuristic` (towers, malls, power plants; arcologies, megastructures, domes and vertical farms per culture), `alien` (hive, organic spires). A culture's own buildings, and the family buildings it does not have (an entry with `maxPop: 1`), are in `cultureServices`. `post-apocalyptic-ruins` is the informal family with a `ruinShare` at every size.

The forms of `metropolis.rs`: `housing.slab` (slabs across a lawn), `housing.tower` (point towers, some on a podium), `commerce.mall`, `civic.stadium`, `civic.power-plant` (and `.atomic`: reactor dome), `civic.tv-tower` (broadcast tower, or airship mooring mast in the industrial family), `civic.arcology`, `civic.megastructure`, `civic.habitat-dome` (and `.ward`), `civic.vertical-farm`, `civic.monument`, `civic.hive`, `civic.organic-spire`. The skyscraper of `modern.rs` takes each tradition's crown through the groups: Art Deco spire, glass shaft, Gulf needle, Stalinist tower, atompunk dome.

### Materials and wall tints

The modern styles build in their own materials. Walls: `concrete` (panels, slabs, towers, malls, plants), `glass` (high-rise shafts and offices, Gulf and cyberpunk towers, arcologies), `steel` (habitat modules) and `ashlar` (cut limestone: Haussmannian and Belle Époque blocks, Stalinist and Art Deco towers, Beaux-Arts civic buildings, Levantine stone), besides brick, plaster, wood and stone. Covers: `zinc` (Haussmannian mansards, ashlar hips), `bitumen` (flat roofs of the northern and high-rise styles), `glass` (atria, train sheds, greenhouses, habitat domes); the warm-climate styles keep light plastered terraces (group `terrace-flat`). A tissue's `arch.material` names them (`concrete`, `ashlar`, `glass`, `steel`); the mass rules of `roles_modern.json` and the culture's `traits.tradition` do the rest.

Each modern style has a palette in `styles_modern.json`: `palettes.<id> = {homes, special}`, two weighted lists of sRGB tints (`"#d8c8a8": 3`), and `traits.palette` names it. `massing.rs` draws one tint per building from its own seed: the `special` list for a landmark, a lot that is not a dwelling (civic, commerce, slabs and towers, industry) or a dwelling of nine storeys or more, the `homes` list otherwise, so ordinary homes vary less than singular buildings. Haussmannian homes stay in a narrow range of warm limestone; the concrete styles read grey with a few faded pastels; the towers of the contemporary and futuristic styles vary between blue, green, bronze and dark glass, white cladding and a few strong accents. A style without a palette (every historical and fantasy culture) emits no tint.

## Hybrid cities: the style sheet

The layout option `styleSheet` says, facet by facet, which cultures a place draws from. A facet is a weighted mix for the whole place (`city`), for a growth zone (`zones`: core, middle, edge, faubourg, village) or for a quarter; each lot, block or quarter (`spread`) draws one culture of its mix from the seed. An empty facet follows the place's own culture.

| Facet | What it changes | Where it is read |
|---|---|---|
| `streets` | The street grammar of a zone (the heaviest culture of its mix) and, unless the other facets say otherwise, its fabric | `influences.rs` |
| `plots` | The cadastral cut of a growth phase (plot operator, frontage, depth, coverage) | `parcels.rs` |
| `houses` | The homes: the drawn culture builds in its own tissue (plan, storeys, roofs, materials) | `building_sites.rs` |
| `monuments` | The singular and utility buildings: each community brings what a place of its size and culture has, built in its own forms | `roles.rs`, `programme.rs` |
| `rural` | The farm types of farm lots | `building_sites.rs` |

An old core of one culture inside extensions of another, the homes of one people on the plots of another, or a town with the monuments of two cultures are style sheets. The resolver is `forms/sheet.rs`.

## Style facets

`styles.json` reserves, under `styles.<id>`, the facets of a whole style: `houses` (kit), `monuments` (services family and role overrides), `rural` (farm types), `siting`, `plots`, `streets` (pattern, hierarchy, block sizes), `plan` (nucleus, enclosure, zoning), `regional` (road classes between places) and `epochs` (an ordered list of styles for the growth phases of a place). Each facet names a source style or holds its own values, so a hybrid city is a style whose facets come from different sources. Today the style sheet above mixes cultures facet by facet; the `styles` table is the migration path towards styles that are themselves assembled from facets.

## Height by population (modern styles)

A modern, futuristic or alien style names a height ladder (`traits.heightLadder` in `forms/styles_modern.json`, steps in `ladders.<id>` as `[population, storeys]`). The ladder caps the storeys of the style's ordinary buildings by the settlement's population, in the display massing and in the programme's household capacity alike: with `metropolis`, a place of 10 000 builds two to four storeys, towers come from about 50 000 (12 storeys) and the tallest in the hundreds of thousands; `midrise` stays at six to ten storeys. A capped tissue keeps its low end at 60 % of the cap, so a tower tissue becomes low blocks, not stumps. A quarter the user sets as city core (quarter edit `zone: "core"`) takes the ladder's top step whatever the population. The tall singular buildings (`housing.tower`, `housing.slab`, office blocks, skyscrapers, megastructures, arcologies, tv towers) come by population through their `minPop` in `services.json`. A new style states its ladder (an existing one or its own); a style without one keeps its tissue's storey range.

## Display contract

`programme.massing[i].volumes[]` may carry, besides the fields it always had:

| Field | Meaning |
|---|---|
| `base_m` | Bottom of the volume above the building ground |
| `pans` | Explicit roof faces `[x,y,z, …]`, already clipped against the other volumes; when present the renderer draws exactly these |
| `gables` | Wall faces above the wall top |
| `minor` | Small decorative volume: no openings, no shadow, skipped in the overview |
| `roof_form` | The true roof kind; `roof` stays a kind every renderer knows |

The piece entry `programme.massing[i]` of a style with a palette also carries `tint`: the wall colour the building asks for, sRGB `#rrggbb` (absent: the wall material's own colour). A volume's own `tint`, if any, wins over the piece's.

## Tests

`cargo test -p magna-urbis-core --lib urban::forms::` (roofs, roles, kits, plans, style sheet), `urban::massing::`, `urban::parcels::`, `urban::activities::`, `settlements::remote::` (remote places). Web: `tests/v2/cityParity.test.ts`.
