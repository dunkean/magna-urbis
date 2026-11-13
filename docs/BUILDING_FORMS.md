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

`overrides` replace a rule for one culture id or one monument family (`western`, `orthodox`, `maghreb`, `persian`, `chinese`, `japanese`, `indic`, `antique`, `american`, `african`): this is how a culture raises a shared part in its own way.

Files: `roles_core.json` (home parts and generic parts), `roles_monuments_a.json` (classical, medieval, Islamic, civic), `roles_monuments_b.json` (utility, Asian, American, African, fantasy), `roles_rural.json` (farmsteads, countryside activity sites and monuments), `roles_modern.json` (modern styles).

## Home plans (`forms/plan.rs`, `forms/styles.json`)

The occupation fits the home's body in its lot; the grammar composes around it, in the room the lot leaves, a plan drawn from the kit: `bar`, `ell`, `tee`, `court` (two rear wings), `cross` (a taller cross-wing at one end), `aitch` (one at both ends), then extras (lean-to outshot, porch, front bay, stair turret in the inner angle). Parts are whole rectangles with labels `building`, `wing`, `crosswing`, `outshot`, `porch`, `bay`, `turret`; each is fitted in the lot and dropped when it does not hold.

A **kit** (`styles.json`, `kits.<id>.house`) holds the plan weights, how much room and wealth favour the larger plans, the chances of the extras, of chimneys and dormers, the roof kinds of a home, the eaves and the chimney material. A culture gets its kit from `cultures.<id>.kit`, else from the first `derive` rule its building traits match (roof kind, wall, cover, pitch), else from `default`. Code never tests a culture's name.

## Singular and utility buildings (`parcels/monuments/`)

A form lays labelled parts on its site with the `Site` mini-language of `parcels/landmark.rs`: `rect`, `bar`, `disk`, `apse`, `small`, `poly`, `ellipse`, `wedges` (ring of seating), `ring`, `court`. `monuments::build` asks each family in turn: `modern` and `rural` first (they answer only their own roles), then the cultural ones (`classical`, `islamic`, `asian`, `american`, `african`, `fantasy`, `medieval`), then the shared `civic` and `utility` forms. A family that declines leaves the site and the random stream untouched, and the older forms of `landmark.rs` then apply.

Which roles exist, for which cultures and how many is the programme's business: `services.json` (families, `cultureServices`, `harbour`, counts) and `roles.rs`. The layout option `singularDensity` scales how many a place gets.

## Countryside sites (`activities.json`, `parcels/monuments/rural.rs`)

Activity sites and countryside monuments use the same forms as the towns. An archetype of `activities.json` may carry `form: {role, site, has, absorbs}`: `role` names the form to build (a `services.json` role such as `worship.parish`, or a countryside one, `rural.windmill`, `rural.barrow`), `site` the ground it needs in metres (front, depth), `has` a part label the culture's form must hold (else the building keeps its single ring), `absorbs` the archetypes of the same yard that the form already contains (a belfry, a cloister). `activities::formed` then replaces the building by the parts of that form, one building per part, on ground the site accepts; a form refused by the ground or not built by the culture leaves the yard as it was.

`rural.rs` holds the `rural.*` forms: mills by type (water, tide, post, tower, smock, vertical-axis), sawmills, forges and smelters, kilns (lime, brick, glass, charcoal, tar), mine heads, quarries, salt works, fishing stations, press houses, tithe barns, granaries, dovecotes, sheepfolds, watch and beacon towers, toll houses, hermitages, wayside shrines, crosses and wells, megaliths, barrows and tombs. A sub-role fixes a variant (`rural.windmill.post`); the bare role lets the culture and the site choose. Their parts are raised by `roles_rural.json`.

## Adding things

| To add | Do this |
|---|---|
| A style's homes | A kit in `styles.json` (or reuse one), and `cultures.<id>.kit` if the derive rules do not pick it |
| A culture's way of raising a part | An entry under `overrides.<culture or family>` in a `roles_*.json` |
| A new part of a building | A label in a form and its rule in a `roles_*.json` |
| A monument or utility building | A form in the family file of `parcels/monuments/`, the role in `services.json` |
| A countryside site or monument | A `rural.*` form in `parcels/monuments/rural.rs`, its part rules in `roles_rural.json`, `form: {role, site}` on the archetype in `activities.json` |
| A modern style | A culture in `styles_modern.json` (kit, traits), its tissue in `catalogue.json`, its services family in `services.json`, its forms in `parcels/monuments/modern.rs` and their rules in `roles_modern.json` |
| A home plan | A branch in `plan.rs` `compose` and its weight in the kits |
| A roof kind | Its planes in `roof.rs` |

## Culture traits

What sets a culture's buildings apart and is not in its tissue lives in `cultures.<id>.traits` of `styles.json` (`styles_modern.json` for the modern styles): the roof tradition of a culture whose tissue declares no `arch` (`tradition`), Mediterranean building (`mediterranean`), the roof-top detail family of flat roofs (`flavor`), the inhabitants' size (`bodyScale`), the scale of the whole house (`metricScale`), the exterior form of homes (`form`: tree, mushroom, longhouse, yurt, battered, mage, stilt) and the share of lots that take it (`formShare`), a single massive storey (`massiveStorey`), pile houses (`piles`), facade openness (`openness`, `lightWallOpenness`). `massing.rs` reads these traits and never a culture's name.

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

## Display contract

`programme.massing[i].volumes[]` may carry, besides the fields it always had:

| Field | Meaning |
|---|---|
| `base_m` | Bottom of the volume above the building ground |
| `pans` | Explicit roof faces `[x,y,z, …]`, already clipped against the other volumes; when present the renderer draws exactly these |
| `gables` | Wall faces above the wall top |
| `minor` | Small decorative volume: no openings, no shadow, skipped in the overview |
| `roof_form` | The true roof kind; `roof` stays a kind every renderer knows |

## Tests

`cargo test -p magna-urbis-core --lib urban::forms::` (roofs, roles, kits, plans, style sheet), `urban::massing::`, `urban::parcels::`, `urban::activities::`. Web: `tests/v2/cityParity.test.ts`.
