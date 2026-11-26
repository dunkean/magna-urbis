# Regional Population Demographics in V2

## Replaced Problem

V1 started from a main place (`options.population`, normally 2,500 inhabitants), to which the engine added secondary places. The former V2 suggestion multiplied the area by terrain and climate coefficients, then rounded five headcounts. It distributed no population budget, ignored culture, and always kept the population of the main place independent. The automatic state of the headcounts was also stored in a `WeakMap` in the interface, so a generation code did not carry that intent.

V2 now computes **one population for the whole region**, then a list of places that share this budget. This list is passed to the native Rust engine, to the WASM build and to the TypeScript path. No place of 2,500 inhabitants is added to the budget. `main` remains a technical key for the first place for urban products; it is no longer a source of population.

## Sources and Relations

| Input | Influence | Storage |
|---|---|---|
| Region size | Area in km² = width² / 1,000,000 | `extent`, or `options.mapSize` in automatic size |
| Climate / biome | Productivity and living conditions | `terrain.climate`, `terrain.climateZone`, then biome, depending on `cultureEnvironment` |
| Relief | Share of the territory likely to support habitation | `terrain.relief`, otherwise `options.relief` |
| Coast | Estimated land area factor of 0.82; 1 without coast | Same context as the cultural choice |
| Underground | Additional factor of 0.3 | `underdark` biome |
| Culture | Reference density, resilience, settlement levels and automatic place size | `options.culture` |
| Settlement seed | Population variations and choice of isolated sites | `settle-sites` step of the general seed |
| Imposed density | Replaces the automatic density, in inhabitants/km²; resizes places without changing their number | `region.demography.density` |
| Imposed population | Replaces area × density; resizes places without changing their number | `region.demography.population` |
| Imposed headcount in the panel | Imposes the chosen counter; the population increases or decreases by the inhabitants of the places added or removed | `region.demography.counts.<class>` for the five categories |
| Imposed population of a place | Sets its share; the rest of the budget is distributed to the other places | `local.<key>.population` |
| Isolated building density | Multiplies their target, without adding inhabitants | `region.demography.isolatedDensity` |
| Imposed number of isolated sites | Replaces their automatic target | `region.demography.isolatedCount` |
| Cultural environment tracking | Keeps the checked/unchecked box in projects and MU3 | `region.demography.followCulture` |

These coefficients are **world generation settings**, not historical estimates or restrictions concerning real populations. The cultural limits below apply to automatic draws. The user may impose another population or another composition.

## Density Calculation

`environment factor = (climate factor × relief factor)^resilience × coastal factor × underground factor`

`automatic density = reference cultural density × environment factor`

`realistic population = round(area × density)`

### Floor for Harsh Maps

On an alpine, arctic, desert or underground map, the realistic estimate sometimes gives only a handful of inhabitants (alpine, high mountain, 10 km with coast: 12 inhabitants). `settlementFloor` (`regionalPopulation.ts`) sets a minimum number of places and inhabitants per map width (about 3 places and 140 inhabitants at 2.4 km, 6 and 600 at 10 km, 12 and 2,400 at 40 km); it replaces the estimate only when the estimate is lower. It never applies to an imposed population, density or headcount.

Several small places rather than one large one: each requires little flat land, and placement gradually shrinks a place if it lacks room. A place does not exceed the automatic maximum of its culture (camps). A temperate region stays above this (10 km: 750 to 6,000 inhabitants depending on relief).

`automatic population = max(realistic population, floor)`

The automatic area without an explicit width is 40 × 40 km; it is no longer calculated from a main population. The forecast uses the parameters of the territory. Actual placement remains subject to dry surfaces, slopes, resources and spacing: the inhabitants actually settled are displayed separately.

| Climate | Factor | Relief | Factor |
|---|---:|---|---:|
| Temperate | 1 | Plains | 1 |
| Mediterranean | 0.8 | Valley | 0.9 |
| Continental | 0.65 | Mixed | 0.72 |
| Savanna / tropical | 0.55 | Hills | 0.65 |
| Humid | 0.35 | Plateau | 0.5 |
| Steppe | 0.22 | Mountains | 0.18 |
| Nordic | 0.12 | Canyon | 0.12 |
| Alpine | 0.08 | Volcano | 0.08 |
| Desert | 0.035 | Caldera | 0.22 |
| Arctic | 0.025 | High mountain | 0.025 |

## Cultural Profiles

| Profile | Reference density | Resilience | Automatic maximum per place |
|---|---:|---:|---:|
| Historical (default) | 75 | 1 | 300,000 |
| Modern / futuristic | 1,200 | 0.5 | 5,000,000 |
| Very dense: highrise, megacity, arcology, cyberpunk | 3,000 | 0.5 | 5,000,000 |
| Mobile: Siberian camps, nomads, ordu, Plains, nordic | 1.2 | 0.8 | 400 |
| Inuit camp | 0.75 | 0.7 | 120 |
| Villages: PNW, Guarani, Iroquoian, kraal, Budj Bim | 4 | 0.9 | 900 |
| Mountain: dwarves / duergars | 50 | 0.55 | 300,000 |
| Terraces: Inca, Himalaya, Caucasus, Tibet, Newar | 50 | 0.7 | 300,000 |
| Dispersed: elves, halflings, lizardfolk, myconids | 25 | 1 | 10,000 |

The exact identifiers are resolved by `populationProfile` in `web/src/v2/regionalPopulation.ts`. Modern cultures are identified by `cultureEra`, not by searching for the word "modern" in their name.

The automatic number of places follows the width of the map and the square root of the population (`automaticPlaceLimit`, 60 at most): it does not multiply the small places, which are costly to build. Explicitly imposed headcounts keep priority.

Background construction is done in batches of eight places at most, using the four generation paths of the "Build selected cities" workflow. Regional crops, names and display are updated only once per batch. A cancellation or a change to the map discards any late result; the selected place takes priority in the next batch.
## Distribution and overrides

Categories follow the thresholds of the shared demographic catalogue: farms 1–14, hamlets 15–149, villages 150–999, towns 1,000–19,999, cities 20,000 and above. The "Cities" box includes metropolises and megacities; the engine keeps their precise class.

The list of places is primary, and population follows from it. Automatic headcounts come from the map size, the environment and the culture (automatic population above), never from an entered population.

1. Sizes are drawn first: a continuous rank-size law (`rankSizes`), from the largest possible place down to a hearth, scaled to the total and capped by the largest automatic place (20,000 inhabitants or the culture's maximum). There is no category ceiling: a village may exceed 999 inhabitants.
2. The category counted in the panel is read from the size. The identity (village, town, city) is given after placement, based on size, site and culture (`demographics::identity`: a trading place becomes a town earlier, an agricultural village or a village-dwelling people later). Place keys (`main`, `site-<rank>`) carry no category.
3. Entering a population or a density resizes the places without changing their number; a total that is too small removes the last places rather than sharing a hearth.
4. Imposing a count keeps the largest places of that category and adds others of the usual size (the average size of the category in the automatic list); if a population or density was entered, it is corrected by the same difference. Free places remain outside the imposed categories. Imposed local populations are fixed before the remaining balance is distributed. The list is limited to 1,000 places.
5. The sum is exactly the regional population when the choices are compatible. If the imposed counts require more inhabitants or cannot hold that many, the interface shows the distributed sum and the gap; it does not invent inhabitants elsewhere.
6. A manual list of places takes priority. Changing the regional controls explicitly reactivates automatic distribution, without erasing the list kept in the recipe.

The ↶ button on a field removes only its own override. "Restore automatic distribution" removes the demographic overrides while keeping the cultural tracking choice. Changing the environment recalculates the automatic values and keeps the overrides.

The panel groups the five inhabited categories and the isolated buildings in a grid of three columns over two rows. Each card shows a GPT Image illustration, its label, its count and its reset-to-automatic control; the detailed explanations are collapsed.

## Isolated buildings

**Inhabited farms** are part of the five habitation categories and of the inhabitant budget. **Isolated sites** are activities without residents: mills, workshops, quarries, sanctuaries and remote places. A site may contain several buildings; the box/field sets the number of isolated sites, not an exact number of roofs.

`target = min(area × environment factor × 0.3; distributed inhabitants / 25) × cultural activity factor × isolated site density`

The target is rounded and limited to 1,000. From 15 inhabitants on, a positive target requests at least one site. The cultural factor is 1 by default, 1.8 for modern cultures, 0.12 for mobile profiles, 0.04 for the Inuit camp, and 0.2 for village profiles. An explicitly zero density requests zero sites; an almost empty region may also request zero.

The engine produces the feasible sites; a selection that is stable by identifier then respects the budget **before** routing their access. Route nodes fill the remaining budget. A site that is impossible for lack of a resource is not replaced by a false mill. The native density of scattered farms is disabled in automatic regional distribution so that no residents are added outside the budget.

## MU3, saving and variants

The project and the MU3 code record the context and only the overrides: density, population, manual categories, isolated sites, cultural tracking and per-place changes. The computed automatic list and the drawn populations are not serialised: they are rebuilt by `regionalPopulation` in the workers as well as in the interface.

When the date, time and latitude drive the scene, MU3 also recalculates the season and the sun's direction/height. It does not store a second copy of these derived floating-point numbers. Empty name containers do not inflate the code.

`cityCodeDefaults.json` identifies the new V2 recipe baseline (Satellite, automatic regional size and no main count). The choice tables keep their order. Since the project rules do not require historical reproduction between development versions, reproducing an older result requires its source snapshot.

The Cities die renews the six urban seeds of the single chosen place only: layout, streets, plots, programme, buildings and houses. The terrain and placement seeds stay identical. Inhabitants, culture and neighbours therefore stay identical; the urban variant travels within MU3.

### Priority of changes

An upstream change replaces downstream edits: changing the regional context, the common culture, the regional density/population or its counts removes the particular populations/cultures of the places, their urban configurations and the building edits. Cultures of the preserved world are also updated, so that a rebuild actually uses the new culture. Free markers remain kept.

A regional placement die clears these exceptions and also renews the common urban draw. A local die keeps the current population and culture of that place, but clears its district, plot and building edits before drawing a new variant. Editing a district replaces its plot and building edits; editing a plot replaces its building edits. There is no longer a checkbox to enable this propagation.

Restoring a complete project or MU3 remains an exact restoration: its edits are part of the recipe and are not treated as upstream changes. A later change made in the interface then applies this hierarchy.

The "Architecture" selector is no longer offered per city, and its former local override is no longer read by the engine. Cities follow the generator's common choice and the cultural style; local architecture overrides are omitted from the MU3 code.
## Files and checks

- Model: `web/src/v2/regionalPopulation.ts`.
- Contract and validation: `web/src/v2/regionSettings.ts`.
- Interface: `settlementPopulationPanel.ts` and `workbenchLayout.ts`.
- Transmission and routes: `region.ts`, `engine.ts`, `stageValidity.ts`.
- Local variants: `urbanSeeds.ts`, button `#reroll-town` in `main.ts`.
- Code: `cityCode.ts`, `cityCodeDefaults.json`.
- Regressions: `web/tests/v2RegionalPopulation.test.ts` and the regional browser check.
- Icons: `web/src/v2/assets/settlement-classes-v1.png`, GPT Image atlas; prompt file alongside it.
