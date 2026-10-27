# Settlement variation variables: inventory, effects, and critique

Repository state reviewed October 24, 2026. This inventory describes code behavior and limitations; undelivered proposals are identified as such. Catalog appendices are extracted from existing data without running generation. Controls expose combinable functions, the distinction between demographic class and morphological grammar, profiles and independent overrides, admission policy, and period filtering. Links and imports retain explicit values; the report distinguishes requested settings from data returned with the plan. These controls introduce no historical ceiling or plausibility engine: undocumented cultural or historical coverage remains unknown.

> English translation of the [French original](CITY_VARIATION_VARIABLES_FR.md).

## 1. Answers to the three questions

### 1.1 What does “vocation” do?

`programme.role` biases the functional program: it changes what the engine requests and reserves in blocks/parcels. It is not a complete city classification or economic simulation. The cultural services catalog already supplies many more building roles than the six proposed urban vocations.

| Value | Effect actually observed in code |
| --- | --- |
| `auto` | Below 500 inhabitants, or for the `communal` functional profile, the program selects `agricultural`. Otherwise it retains the cultural program without explicit specialization. |
| `agricultural` | Requests 2 m²/person of communal space versus 0.5 outside the communal profile; doubles catalog storage sites under its rules and ceilings. |
| `crossroads` | Raises household shop-house share to 25% versus the usual 8%, except below 150 inhabitants where it is zero; doubles certain commercial establishments; triples the area coefficient for affected markets. |
| `artisan` | Adds workshop demand of 3.5 m²/person, minimum 80 m², and doubles catalog craft sites. |
| `riverine` | Doubles catalog mill sites. It does not create a river. |
| `port` | Shop-house share of 25%; warehouse demand of 2 m²/person, minimum 180 m². This generic demand subsequently requires evidence of navigable access and a waterfront location; the value does not create that access. Waterfront services and works have their own logic. |
| `capital` | Shop-house share of 25%; population thresholds for elite, civic, and defensive services divided by four. This is not simulated administration or economy. |
| `isolated-farm` | Intention for an isolated domestic structure; replaces city demands. |
| `roadside-temple` | One roadside temple, role `worship.wayside`. |
| `isolated-shrine` | One isolated shrine, role `worship.shrine`. |
| `isolated-mill` | One isolated mill, role `craft.mill`. |
| `isolated-inn` | One isolated inn, role `commerce.inn`. |
| `isolated-tower` | One isolated tower, role `defence.tower`. |

For isolated intentions, population no longer requests housing for an entire city: it helps size the program. The macro type becomes an isolated building or farm; `ruined` state can yield an isolated ruin.

**Critique of the retained exclusive contract:** the field mixes economic activity (craft), political function (capital), geographic situation (riverine), network function (crossroads), and single-building intention. These concepts are neither exclusive nor at the same level. A capital can also be a port, craft center, and religious center. Adding twenty exclusive values would preserve this flaw.

**Still to extend:** the UI now separates intention and six combinable functions (1.1 bis); additional activities/resources and institutions still need an explicit model and consumers. Weights should produce verifiable needs, placements, and visual signs, not merely a category name. Examples currently difficult or impossible to express as distinct vocations include extraction/mining, fishing, pilgrimage, monastery, garrison, caravan stop, river transit, livestock, royal residence, and shipyard. These are model directions, not claims of existing functionality.

### 1.1 bis Weighted functions and intention: what is implemented

The six biases `agricultural`, `commerce`, `artisan`, `riverine`, `port`, and `capital` can now be combined in `programme.functions` with finite weights from 0 to 1. The UI displays them separately from settlement or isolated-establishment intention. These are six existing functional biases, not a complete economy. Shared effects use the maximum and are not counted twice; service counts remain integers rounded down, and generic workshop/warehouse minima remain 80/180 m² when positive demand is created. Resources can still add their own needs.

Absent or `null` field: exact old exclusive-role behavior. Explicit `{}`: no specialization, without reactivating the previous role. An isolated intention retains weights but makes them inapplicable; it remains carried in legacy role IDs for compatibility. An older engine must reject an unsupported explicit field. General economic/institutional taxonomy and checking real navigation remain separate work.

### 1.2 Do hamlet / village / town / metropolis classes still exist?

**Yes, but several classifications coexist.** The previous answer presented shortcut populations as if they defined classes; these are separate things.

| Layer | Current values and thresholds | Effect |
| --- | --- | --- |
| Displayed demographic class, TS and Rust placement | `farmstead` < 15; `hamlet` 15–149; `village` 150–999; `town` 1,000–19,999; `city` 20,000–99,999; `metropolis` 100,000–999,999; `megacity` ≥ 1,000,000 | Population classification and selection shortcuts. This alone does not choose native form. |
| UI population shortcuts | Farm 10; hamlet 40; village 300; market town 3,000; city 30,000; metropolis 250,000; megacity 1,500,000 | Fill in a population; do not define thresholds. |
| Legacy `SizeName` | `hamlet`, `village`, `town`, `city`, `capital`; `sizeForPop` switches at 200, 1,200, 8,000, and 30,000 | Legacy area presets and settings for some stages; `capital` is a size name here, not political vocation. |
| Legacy cultural `ScaleClass` | `hamlet` < 200; `village` < 1,200; `town` < 20,000; `city` < 100,000; `metropolis` < 1,000,000; `megacity` above | Historical TS `scale.min/max` metadata independent of the new native grammar. |
| Native morphological `Kind` | 11 types detailed below; metropolis from 200,000 in automatic resolution | Chooses plan grammar: one site, farms along a road, street village, districts, phases, or multiple centers. |

Native automatic resolution after explicit values are considered:

| Condition | Resulting type and behavior |
| --- | --- |
| `settlementForm` directly names one of the 11 types | Takes priority over the following deductions. |
| Isolated intention | `single`, `farmstead`, or `ruin` depending on intention and state. |
| `nomad-camp` or `native-plains`, population < 5,000 | `camp`. This rule does not automatically include every other camp-themed preset. |
| Population ≤ 12 | `farmstead`, or `ruin` if state requires it. |
| 13–149 | `hamlet`. |
| 150–1,199 | `street-village` or `nucleated-village`, depending on explicit `ribbon/nucleated` choice, culture, site, and nearby road. |
| 1,200–4,999 | `market-town`, or `walled-town` if culture fortifies and population reaches 2,500 or the site is defensive. |
| 5,000–29,999 | `walled-town` if fortified; otherwise `city`. |
| 30,000–199,999 | `city`. |
| ≥ 200,000 | `metropolis`. |

Form differences still exist: small types bypass district grammar; a farm is a parcel with access, a hamlet follows a road, and a street village creates roadside strips. Small settlements normally have one phase, without suburbs or ring road; a small market town can have two phases; a metropolis favors four phases and many suburbs. Metropolitan composition adds multiple centers and attaches districts to them. The catalog also distinguishes cultural hamlet/village forms and, for some cultures, a city recipe above a threshold.

**Explicit separation:** demographic classes now come from shared `rust/crates/core/src/settlements/demographic_classes.json`, read by TS, Rust placement, and UI shortcuts. Shortcut populations are not class thresholds. Morphological thresholds above remain unchanged: at 100,000 inhabitants, the class is Metropolis while the grammar remains district-based City; at 200,000, automatic grammar becomes multicenter. At 13–14 inhabitants, class remains Farm but grammar is a road-following Hamlet. CityBench displays these axes separately, not as one enum. Legacy `SizeName` and `ScaleClass` remain historical dimension and recipe settings, not demographic classes; `capital` size code confers no political status. A demographic megacity extends metropolitan grammar, without a distinct native `megacity` category.

The UI exposes all eleven native grammars, the two historical village preferences, and automatic choice. An explicit return to automatic changes no other parameters. The report reads only program population, configuration, and archetype returned with the plan; missing evidence in an old import remains unknown. Forced forms retain native priority even for an isolated intention, and this priority is indicated. Cultural/historical suitability of a forced form is not certified by this work.

### 1.3 Are there culture-specific size limits?

Three mechanisms must be distinguished:

1. **Legacy TS infrastructure:** `Culture.scale.min/max` still exists. `pipeline.mainPopulation` and the historical urban path can bound population to `scaleMaxPop(max) × 1.5`, with a lower bound as well. This can change requested population. Explicit `scale` declarations found in current `cultures*.ts` files all have `max: 'megacity'`: this mechanism currently provides no table of differentiated realistic ceilings. Some camp and growth branches also follow their own paths.
2. **Native CityBench:** the exported catalog has no cultural demographic-range field applied as a ceiling. `scope` is text indicating artistic recipes, not a calculated constraint. Native types accept cultures beyond generic thresholds; `maori-pa` has no specific population maximum in this path.
3. **Map limit:** CityBench reads `decor.meta.tags.maxPopulation` to limit editor choices. This is a declared map capacity shared by cultures; it proves neither actual built capacity nor historical plausibility. The old editor also has a global five-million population limit.

**Two million inhabitants in `maori-pa`:** the program lacks the cultural checks needed to declare this historically supported, extrapolated, or forbidden. The local pā recipe may be used at metropolitan scale. Successful technical generation is not proof of coherence.

`strict` mode rejects, among other things, declared architectural borrowing; period can filter admissible native recipes. **These controls are not a general culture × period × size historical validator.** Neither `inspired` nor `fantasy` should be presented as complete historical simulation.

**Proposal for discussion:** distinguish a documented range, an explicitly assumed extrapolation range, and site-calculated capacity. Beyond the documented range: reject with reasons in strict mode if the profile does not cover the case; explain transformation or settlement network in inspired mode; allow extrapolation in fantasy while retaining construction rules. No cultural population ceiling should be invented without a source or confused with a technical limit.

### 1.4 Profiles, recipes, and policies in the controls

The `culture` ID remains a compatible **named profile**: depending on input, it can describe a tradition, plan organization, or theme. The new “Urban cultural profile” label does not reclassify the 79 IDs as historical traditions or change routing or seeds. The building-profile override is named separately. The applied program retains and displays land-tenure family, functional profile, architectural family and pack, admission witness recipe, its periods, and declared borrowing. A witness recipe is used for upstream routing/admission; it is neither an urban phase recipe nor the list of built houses. Actual selected houses are read from their native archives.

“Admission policy” uses existing IDs: `strict` → `historical_strict`, `inspired` → `historical_inspired`, `fantasy` → `fantasy_mix`. Strict mode rejects declared borrowing and certain uncovered sources; it does not certify a culture × period × population combination. Without documented range metadata, plausibility remains **unknown**, including `maori-pa` with two million inhabitants. No cultural maximum is invented and population is not reduced to suggest false compliance.

`programme.period` is a filter, not an automatically calculated era: `''` and `any` disable filtering while remaining distinct transported values. `auto` is not a native alias; an old `auto` code remains a preserved code outside the choices, without silent conversion to an empty string. Period codes currently present in native profiles are `A` and `M`. The selector comes from a small projection of `rust/crates/houses/data/urban-admission.json`; it retains version, generator, and source SHA, strictly checked by a parity test. Maintenance is explicit, never run automatically by UI or build:

```powershell
node web/scripts/update_native_admission_periods.mjs --check
node web/scripts/update_native_admission_periods.mjs
```

An imported period or profile code absent from UI options remains visible and retains its exact value; applying controls no longer replaces it with an empty value. Compatibility belongs to the native consumer, which may reject it. An unknown imported policy is retained for reading, then requires explicit correction before application; it never implicitly becomes `inspired`. Removing the period filter does not touch functions, intention, resources, seeds, or positions.

The policy/routing summary reads only the returned/imported `programme`. A missing precise context or tradition ID remains unknown; neither the current catalog nor current settings reconstruct it for an old plan. Lack of cultural/historical certification remains distinct from morphological grammar, physical architectural admission, and visual validation.

### 1.4 bis Place state and vacancy: retained demand and context

CityBench exposes `programme.state` (`thriving`, `declining`, `abandoned`, `ruined`) and `programme.decay` in an advanced program panel. Unspecified state keeps the native input default `thriving`. For vacancy, **absent field**, **explicit `null`: state default**, and **explicit rate from 0 to 1**, especially **0**, remain distinct on roundtrip. An `undefined` field is omitted in JSON serialization, like an absent field; no replacement is invented. Reset removes only these two fields. Functions, intention, resources, profiles, period, population, positions, and seeds are retained.

Vacancy influences the program and some building roles; it is neither a rate observed in realized houses nor inhabitant capacity. The engine has its own state rules; the UI does not replace `null`/absence with a numerical rate from the current catalog. Imported values outside the UI domain remain visible and retained in their original context, without silent conversion; the native consumer may reject them. A newly entered explicit rate must be finite and between 0 and 1.

The applied summary reads only returned/imported program context, separate from pending settings. A context, field, or effective rate not retained remains unknown; a default rate is never recalculated from the current catalog for an old plan. These controls do not change engine rules for form suitability or vacancy.

### 1.4 ter Retained culture of phases and growth stages

The applied composition table displays the urban profile actually recorded in `GrowthPhase.culture`, with its exact ID. An absent, null, or empty value remains **unknown**; neither requested profile nor current mix fills it in. An out-of-catalog retained ID remains displayed without certifying coverage. This phase profile is not an attested architectural tradition for every house. “Growth stages” controls and “Stage 1, 2…” rows describe ordinal stages without recorded historical dates. The `epochs` and `epoch` keys, their values, links, and imports remain identical; historical `programme.period` filtering (A/M, etc.) remains separate and unchanged.

### 1.5 Precedence of place, plan, parcel, and building profiles

In CityBench, opening a link/MU or import no longer overwrites `layoutConfig.culture` with `site`. An absent field takes only the existing normalization default `site`. The actual plan selector is available under “Plan cultural profile · override,” opened automatically if an override is retained, even if unknown to the UI catalog. The summary distinguishes requested profile and last profile actually returned with the plan; an absent plan is not assigned a resolution inferred from current settings.

| Layer | Inheritance / override | Effect of a change |
| --- | --- | --- |
| Place | `SettlementSpec.culture` | Changes place profile and site preferences; retains requested seeds, population, and position. Does not reset plan, parcel, or building overrides. Placement remains subject to the engine. |
| Plan | `layoutConfig.culture = site` follows place; another ID overrides plan | Changing it or using “Plan: match place” modifies only this field. Recipe, preset, parameters, parcels, and architecture remain retained. |
| Parcels | `parcelConfig.culture = site` follows returned plan profile / phase cultures; another ID overrides parcels | Not a second place-profile choice. ID remains independent of the plan override. |
| Architecture | Absent `buildingState.settings.culture` follows each request's architectural program routing; present ID overrides buildings | Does not change streets or parcels. Not historical-tradition certification; native code checks rights and admissible sources. |

The existing **global style** button retains its advertised function of resetting street, parcel, and building recipes and overrides; it is distinct from changing a profile or returning only the plan to the place profile. An explicit recipe/preset can become incompatible after a profile change: it is not silently replaced and native rejection stays visible. Out-of-catalog IDs are retained without a support promise. Requested settings may differ from the last applied plan until regeneration succeeds. No historical range, cultural population limit, or ID substitution is invented.

### 1.6 Settings relevance: small direct path and fallback

The CityBench diagnostic distinguishes **current request** from **path documented by the returned plan**. An explicitly forced native form takes priority over an isolated intention; `nucleated` and `ribbon` remain preferences, and `nucleated-village` uses districts. The six native small direct grammars are `single`, `ruin`, `farmstead`, `camp`, `hamlet`, and `street-village`. An `auto` request with isolated intention only suggests a small direct path, without reimplementing population/culture resolution in the UI.

Even then, native code may fail to place the small plan on the site and fall back to district grammar. Extent/growth, phases/suburbs, and mix settings are therefore **retained and editable for this fallback**; they are not disabled solely because of the requested role or Kind. The `legacy` mechanism does not use this direct path. Recipes, morphological parameters, meshing, access, and physical constraints may still participate in validation and common stages; no whole group is declared irrelevant on assumption alone.

For the retained plan only, `structure.mechanism=kind`, a family equal to its small native archetype, a known non-legacy configuration, and absence of district edits document direct composition. The report then names district-composition fields that did not drive that stage: growth shape/budget/dimensions (excluding mechanism and growth stages), phases, suburbs, and mix. It does not predict their use at next generation. Archetype alone is insufficient: it is also written after fallback. Missing/contradictory markers, an old import, or a plan composed with edits: no non-use is asserted. This diagnostic changes no generation value or parameter and infers no capacity or architectural admission.


## 2. Matrix of principal enumerable axes

A scenario row chooses one value per applicable column. These tables are column dictionaries, not permission to multiply all domains without checking dependencies. Automatic values do not guarantee a result distinct from an explicit value.

| Culture | Demographic class | Morphological type | Explicit mesh | Explicit footprint shape |
| --- | --- | --- | --- | --- |
| 79 IDs, appendix 7 | `farmstead`, `hamlet`, `village`, `town`, `city`, `metropolis`, `megacity` | `single`, `ruin`, `farmstead`, `camp`, `hamlet`, `street-village`, `nucleated-village`, `market-town`, `walled-town`, `city`, `metropolis` | `grid`, `organic`, `radial`, `terraces`, `dendritic`, `clusters`; default `culture` | `circle`, `rectangle`, `polygon`, `compact`, `elongated`, `linear`, `fan`, `fingers`, `dendritic`, `lobed`, `archipelago`, `composite`; default `auto` |

| Biome | Terrain climate | Relief | Site archetype |
| --- | --- | --- | --- |
| `temperate`, `forest`, `desert`, `steppe`, `tropical`, `tundra`, `underdark`, `underdark-caverns` | `temperate`, `oceanic`, `mediterranean`, `arid`, `cold`, `tropical` | `flat`, `hills`, `valley`, `canyon`, `mountains`, `mixed`, `plateau`, `high-mountains`, `volcano`, `caldera`, `cavern` | `bridge`, `confluence`, `meander`, `harbor`, `estuary`, `valley`, `hilltop`, `plain`, `lakeshore`, `island`, `spur`, `pass`; `auto` selection possible |

| Vocation | State | Requested enclosure | Suburbs | Cultural mix | Program framework |
| --- | --- | --- | --- | --- | --- |
| `auto`, `agricultural`, `crossroads`, `artisan`, `riverine`, `port`, `capital`, `isolated-farm`, `roadside-temple`, `isolated-shrine`, `isolated-mill`, `isolated-inn`, `isolated-tower` | `thriving`, `declining`, `abandoned`, `ruined` | `culture`, `none`, `wall`, `palisade` | `auto`, `none`, `few`, `many` | None; second culture from the same 79 IDs; `phases` or `sectors` distribution | `strict`, `inspired`, `fantasy` |

Axis effects:

| Axis | What changes | Limit / critique |
| --- | --- | --- |
| Culture | Core, extension, village, and hamlet recipes; core, enclosure, orientations, spaces, services, cultural household, and architectural recipe routing. | Catalog mixes traditions, reference plans, social organizations, and fantasy themes. 79 entries do not imply 79 entirely distinct engines or equal coverage. |
| Population / class | Housing and service demand, footprint, phases, center count, and network width/hierarchy depending on stage. | Class derives from population. Demand, land capacity, and actually housed inhabitants must remain three distinct measures. |
| Morphological type | Choice between single-site, small-settlement, and district-composition grammars. | Forcing can bypass scale protections. Resolved type and reason should be recorded. |
| Mesh | `grid` forces grid operator; `organic` strengthens variation; `radial` guides skeleton; `terraces` follows terrain; `dendritic` favors dead ends; `clusters` favors closes/groupings. | Six choices are not six independent local operators: several use the organic operator. An override can erase cultural traits. |
| Footprint | Territorial silhouette, continuity, elongation, branching, or multiple components. | Not a house shape. Family guides construction constrained by terrain; it does not necessarily impose an exact geometric silhouette. |
| Biome | Ground cover, vegetation, and agriculture in the consuming pipeline; underground visual context. | The biome module states urban geometry is independent. A fixed map loaded in CityBench must already carry this context. |
| Climate | Upstream terrain/climate conditions and water budget depending on terrain generator. | Not six city grammars; this field does not recreate scenery during urban-only recalculation. |
| Relief | Slopes, actually accessible space, orientation, terraces/stairs, and building admissibility. | Depends on a real raster, not just its label. `valley` is also a site archetype: these are different fields. |
| Site | Relationships to water, roads, defense, and slope; influences street/grouped village choice, districts, and possible facilities. | Choosing “port” does not prove navigable access, built quays, or admitted warehouses. |
| Intention and specialization | Six combinable weighted functions (1.1 bis); old roles retained for compatibility. | Several functions remain outside the six biases; isolated intentions are not city specializations. |
| State | Empty-building share (decline default 20%, abandonment/ruin 100%), roles and households; in the native pipeline abandoned/ruined streets become paths. | A `.ruin` role alone does not guarantee a destroyed architectural model or detailed vegetation. |
| Enclosure | None, palisade, or wall and cultural fortification choice. | Settlement type, route, gates, roads, and buildings must remain compatible; styles are not all interchangeable. |
| Suburbs | Presence and intensity of peripheral extensions. | Overlaps phases, satellites, and overall form; a raw Cartesian product yields duplicates or contradictory requests. |
| Mix | Another culture in phases or sectors. | Not unlimited fusion of every architecture. Two cultures, their order, and territory must be recorded. |
| Historical framework | Program borrowing/admission controls; routing to distinct architectural modes. | No automatically validated historical population range. |

## 3. Other urban selectors: inventory without hiding them in “etc.”

These vary the scene or generation path, but are not all scenario axes to multiply.

| Field | Domain | Effect and status |
| --- | --- | --- |
| UI settlement style | `culture`, `walled-core`, `dense-core`, `growing-town`, `village` | Macro presets replacing several plan/parcel settings. Composite axis, redundant with its settings. |
| `composition` | `settlement`, `district` | Complete composition or isolated district. A fabric sample is not a city. |
| `settlementForm` | `auto`, `nucleated`, `ribbon`, then the 11 `Kind` | Form request; `nucleated/ribbon` guide villages while a type ID forces the type. |
| `footprint.mechanism` | `auto`, `legacy`, `planned`, `accessibility`, `ribbon`, `fusion` | Footprint construction algorithm. `legacy` preserves old behavior. Web normalization replaces saved `planned` with `auto`; native code also resolves it and forces `planned` for a rectangle family. Do not count six equally accessible independent modes. |
| `footprint.budget` | `population`, `radius` | Derives land from population or radius. Not built-capacity validation. |
| `axisAlignment` | `regional`, `culture` | Influence of regional or cultural axes. |
| `exitTreatment` | `legacy`, `adaptive`, `closed` | Exit and connection treatment. |
| `peripheralRoad` | `auto`, `none`, `partial`, `full` | Absent, partial, or complete peripheral road. |
| `accessMode` | `adaptive`, `cultural`, `none` | Access mode for rear and internal areas. |
| `allowStairs` | `false`, `true` | Conditional permission: culture or fabric must also permit stairs. |
| `placement` | Native: `center`, `rectangle`, `skew`, `notched`; old workshop adds `lateral` | Fixture placement/shape or district composition depending on path. Not a new culture. |
| `ParcelConfig.operator` | `culture`, `strips`, `oriented`, `compact`, `inherited`, `courtyard`, `frontage`, `compound`, `wholeBlock`, `garden` | Subdivision choice. `strips` maps to `burgage`, `oriented` to `compact`. Other names do not all imply independent methods. |
| `preset`, plan/parcels | `culture` or catalog preset, notably `morph/...` | Parameter recipe choice; complete list derivable from appendices 7 and 8. |
| `recipe`, plan/parcels | `auto` or recipe ID available for culture | Core, extension, suburb, village, hamlet, sector, and growth variants depending on culture. Domains differ across 79 cultures. |
| `culture`, plan/parcels | `site` or catalog cultural ID | Each stage can inherit or override site culture; parcel culture may differ from plan culture. Extra override distinct from phase/sector cultural mix. |
| `zone` | `auto`; morphological zones `core`, `middle`, `edge`, `faubourg`, `village` | Selects parameter ranges by urban position. `edge` exists in morphologies even though exported recipes mostly use the other four zones. |
| `streetOp` | `organic`, `grid` | Local street operators beneath macroscopic mesh. |
| `closeOp` | Menu: `closes`, `culDeSacTree`, `hutong`, `roji`, `none`; native dendritic fabric can write `derbs` | Secondary access. Preserve menu/internal-value difference in combination analysis. |
| Morphological `orientation` | `road`, `cardinal`, `terrain`, `water` | Preferred orientation relative to roads, cardinal directions, slope, or water. |
| Historical menu `plotOp` | `burgage`, `courtyard`, `siheyuan`, `machiya`, `compound`, `garden`, `wholeBlock` | Historical parcel methods/aliases. Native code can reroute according to cultural admission family (`compact`, `inherited`, etc.). |
| `fortificationStyle` | `auto`, `palisade`, `gord`, `hedge`, `curtain`, `flanked`, `concentric`, `rammed-earth`, `wengcheng`, `bastioned` | Fortification subtypes: earth/wood, hedge, curtain wall, towers, concentric walls, rammed earth, courtyard gates, bastions. A style incompatible with type may be replaced by cultural style. |
| `monument` | Free string; default `none` | In district grammar, can mark the largest block `compound:<name>`. Not a closed enumeration of actually built monuments. |
| `programme.resources` | Free list; explicitly read triggers: `timber`, `stone`, `ore`, `clay` | Adds workshop needs; other words do not guarantee a specialized industry. |
| `programme.lore` | Free list; explicit triggers: `temple`, `palace`, `necropolis`, `magic` | Creates collective demand bearing the first recognized token. Not a complete narrative ontology. |
| `programme.period` | Free string; empty and `any` disable some filters; otherwise periods present in architectural admission | Recipe filter, not a global period list homogeneous across 79 cultures. |
| `programme.navigableAccess` | `false`, `true` | Explicit navigation declaration used by some demands; independent of mere water presence. |
| Historical site preferences | `waterSide`, `hillSide`: `N`, `E`, `S`, `W`; quantitative weights and preferences | Historical contract adds `flatness`, `margin`, `centerInset` to archetype weights, `mountainFace`, and `woodland`. Native placement bridge directly exposes mainly `weights`, `mountainFace`, `woodland`; do not assume all historical preferences transfer. Historical comment marks `woodland` reserved on this path. |
| Cultural construction on water | Legacy `Culture.waterBuild` boolean; platforms/stilts according to native admission | A stilt tradition is not merely a land house. Conditional cultural/architectural capability, not global permission to build on all water or an attested universal CityBench button. |

### Architecture: derived domains and overrides

| Field | Domain | Scope |
| --- | --- | --- |
| Building function | `domestic`, `mixed`, `workshop`, `warehouse`, `collective`, `open_space` | Six broad admission functions; detailed catalog roles supplement them. |
| Admission typology | `common`, `row`, `courtyard`, `compound`, `detached` | Architectural preference, normally from program/culture, sometimes overridden. |
| Architectural program composition | `row`, `detached`, `courtyard`, `farm`, `compound`, `hall`, `religious`, `civic`, `defence`, `inn` | Organization of requested establishment. Do not confuse with `LayoutConfig.composition`. |
| Houses historical mode | `historical_strict`, `historical_inspired`, `fantasy_mix` | Architectural contract distinct from urban-program mode names. |
| House recipe / variant / style | Houses catalog IDs and architectural index | Depend on culture, period, function, size, and actual site admission; this document does not enumerate every internal variant. |
| `parcel_fit` | `false`, `true` | Permits engine-supported adaptation under access, rights, terrain, and roof constraints. |
| Role, district, wealth, households, floors, built area, continuity, and party walls | Program role/ID or quantitative values | Actual house variations; generally urban-program outputs, not independent categorical city axes. |

The old workshop building-operator menu includes `streetFrontRow`, `streetFrontRowExperimental`, `courtyardHouse`, `shopRow`, `pavilionCompound`, `yashiki`, `machiya`, `detached`, `treeHouse`, `hall`, `longhouse`, `kancha`, `yardHouse`, `tomb`, `venetian`, `konak`, `sahelCompound`, `giebelhaus`, `hanok`, `gnome`, `primitive`, `fungalHouse`, `duergarHall`, `perimeterBlock`. These are historical generator/workshop operators; they must not be presented as 24 autonomous native Houses model choices.


## 4. Terrain, water, roads, and regional ensemble

These variables are upstream of the city. A CityBench scenario on fixed scenery does not vary them merely by changing `LayoutConfig`.

| Variable | Enumerable domain | Effect |
| --- | --- | --- |
| Coastal terrain | Eight-direction mask `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`; no coast; island modes `island`, `archipelago`, `random` | Land continuity, shores, and available space. The mask can combine directions; these are not eight exclusive coast shapes. |
| Geological terrain environment | `flat`, `hills`, `mixed`, `mountains`, `high-mountains` | Plateau/volcano/caldera background; conditional sub-option. |
| Active hydrology | `false`, `true` | Presence of hydrology pipeline and constraints. |
| Main river | `auto`, `none`, `stream`, `river`, `major` | Target watercourse family. |
| Lakes | `auto`, `none`, `some` | Presence/addition of lakes subject to relief and available water. |
| Meanders | `natural`, `reduced`, `none` | Watercourse and riverside terrain form. |
| Estuary | `auto`, `simple`, `widening`, `funnel`, `tidal` | Mouth morphology depending on pipeline. |
| Depression policy | `auto`, `fill` | Hydrological treatment of relief. |
| Preconditioning | `none`, `erosion`, `breach`, `both` | Terrain modification before water; technical submode. |
| Hydrology pipeline | `vector`, `rust` | Implementation; some option domains differ. |
| Vector river tracing | `vector`, `grid` | Vector path method. |
| Confluence | `climate`, `drainage` | Vector pipeline mode. |
| Boolean hydrology options | Active/displayed erosion, balance, anabranches, terrain influence, avulsions, deltas | Some change geography; erosion display can also change the shown background. Not city families. |
| Regional network level | `primitive`, `rural`, `developed`, `imperial` | Road types, network development, and available connections. |
| Road profile | `auto`, `medieval`, `roman`, `east-asian`, `caravan`, `andean`, `mesoamerican`, `tribal`, `elven`, `dwarven` | Widths, slopes, and road choices by profile. |
| Requested road surface | `auto`, `dirt`, `gravel`, `paved`, `flagstone` | Network surface and representation. |
| Produced road classes | `highway`, `main`, `local`, `track`, `trail` | Hierarchy outputs, not five independent city overrides. |
| Produced crossings | `bridge`, `ford`, `causeway` | Bridge, ford, or causeway according to network constraints. |
| Regional generation mode | `auto`, `counts`, `list` | Automatic placement, counts by class, or explicit settlement list. |
| Regional size distribution | `classes`, `zipf` | Population distribution across settlements. |
| Historical `SettlementSpec.kind` intention | String field, default `settlement` | Do not equate with native type resolved by `LayoutConfig.settlementForm`. |

### Quantitative or free variation, not enumerable without chosen steps

| Group | Fields retained in inventory | Effect |
| --- | --- | --- |
| Identity / realization | Terrain, road, district, parcel, building seeds; ID, name, position, and center | Other realizations of one profile; position changes actual constraints. A name alone does not define new geometry. |
| Size and map | Population, map width, radius and radius factor | Volume of demand and working space; must be explicit in benchmarks. |
| Footprint | `grossDensity`, `aspect`, `orientation`, `nuclei`, `irregularity`, `anisotropy`, `separation`, `epochs`, `cohesion`, `satellites`, `branchDepth`, `gapSize` | Gross density, proportions, nuclei, growth, continuity and discontinuities. |
| Plan | `density`, `count`, `rings`, `phases`, `siteAdaptation`, `maxStreetGrade`, `maxLaneGrade`, `maxStairGrade`, `accessDepth`, `accessBudget` | Intensity, element counts, adaptation/accessibility. Some are bounded integers but remain internal settings of these modes. |
| Mix | `mixShare`, `mixAngle` | Share and orientation of second influence; historical TS also knows `blend`, which native `mixMode` does not accept. |
| Program | `decay`, free resources, free period, free lore | Vacancy and special demands; unrecognized words have no guaranteed effect. |
| Street morphology | `laneSpacing`, `wardArea`, `accessDepth`, `fieldTwist`, `curvature`, `fieldNoise`, `fieldWavelength`, `fieldRandom`, `gridSpacing`, `gridSkew`, `blockSize`, `minBlock`, `minWidth`, `widthByRank`, `widthScale`, `widthJitter`, `placeThreshold`, `deadEndRatio`, `slitDepth`, `plotDepth`, `contourFollow`, `contourBlend`, `longCut` | Spacings, angles, areas, widths, places, and terrain following. Native district catalog fields, excluding operators already listed. |
| Parcel morphology | `houseArea`, `coverage`, `frontage`, `plotDepth`, `plotTilt`, `wideLotChance`, `deepFill` | Areas, coverage, frontage, depth, bias, and filling. `deepFill` is boolean. |
| Workshop building morphology | `arch`, `roomDepth`, `courtyardShare`, `buildDepth`, `setback`, `bigCourtChance`, `houseVariation`, `blockCourtShare`, `blockSolidChance`, `blockInfillChance`, `footprintConformity`, `cornerFill`, and common dimension/coverage fields | Internal variations of selected historical operator; not an exhaustive definition of Houses options. |
| Regional placement | `density`, `zipfExponent`, `minPopulation`, `populationJitter`, `spread`, `smallTop`, `mainClear`, `clustering`, `edgeMargin`, `flatnessWeight`, `buildableWeight`, `freshWaterWeight`, `riverWeight`, `coastWeight`, `floodWeight`, `defenseWeight`, `elevation`, `variationWeight`, `siteWeights`, `sitePrefs` | Settlement count and position; slope, water, defense, woodland, and mountain preferences depending on consuming path. |
| Regional roads | `density`, `gradeWeight`, `maxGrade`, `crossingCost`, `wobble`, `sharing`, `exits` | Density, slope, crossing, sinuosity, sharing, and exits. |
| Local editing | District: culture, fabric, density, role, wealth, shape, deletion, salt; parcel: role, function, households, shape, deletion/merge/garden, salt | Can produce a city no longer described by one global profile. Edited polygons are not a finite domain. |
| Terrain / water | Dimensions, resolution, erosion intensities, water, slopes, noise, river/lake thresholds, widths, sinuosity, braiding; climate values and raster drawing/import | Continuous upstream parameters; generator internals are not extra city categories. |

## 5. Presentation and execution variations to record separately

| Variable | Domain | What can be concluded |
| --- | --- | --- |
| CityBench architecture | `silhouette`, `compact`, `detailed` | `silhouette` is a preview; the other two use native architectural plans, with detailed view enriched. A silhouette does not prove house admission or capacity. |
| Building paint style | `geometric`, `cartographic`, `silhouette` | Presentation of retained geometry; not another culture. |
| Diagnostic | `none`, `uses`, `height`, `access` | Read functions, heights, and access. |
| Urban layer | `tissue`, `uses`, `parcels`, `buildings`, `roles` (CityBench) | Inspected object; other layers/outlines/centers can be enabled independently. |
| CityBench background | `relief`, `render`, `parchment` | Cartographic background; availability depends on prerendered images. |
| View / camera | 2D / 3D, framing, zoom, orientation | Actually visible detail and cost; not inherently a new settlement generation. |
| Terrain creation | `procedural`, `neural-wasm`, `neural-python`, `neural` | Different terrain sources, compatibility, and upstream realization. |
| Terrain/hydrology computation | WASM/CPU, GPU depending on stage; native modes depending on runtime | Execution and reproducibility variable; should not inflate urban style counts. |

## 6. General critique and proposed combination model

1. **The matrix is conditional.** An isolated farm does not have the same active axes as a metropolis. Available recipes depend on culture. Footprint shape is not a parcel subdivision, roof type, or demographic class.
2. **Culture currently bundles too much.** `bastide` is a plan principle, `maori-pa` a culturally situated settlement type, `japanese-jokamachi` a castle town, and `necropolis` a program/theme. This heterogeneity makes comparisons difficult. Keep IDs for compatibility, but separately describe architectural tradition, urban organization, period, and institutions.
3. **Form synonyms mask several scales.** Street village, linear footprint, and ribbon mechanism act at different levels; “dendritic” exists for footprint and fabric; “archipelago” for islands and discontinuous urbanization.
4. **An explicit cultural scale policy is missing.** Distinguish “documented,” “extrapolated,” “incompatible,” and “insufficient technical coverage.” Do not silently reduce population to make a request computable.
5. **Six functions are combinable; general taxonomy remains open.** Isolated intention and weights are exposed with existing effects. Additional activities/institutions/resources should not become options without consumers or be equated with a simulated economy.
6. **The catalog must state its support level.** Historical reference, morphological recipe, architectural admission, and visual validation are four different things. An entry or successful capture does not demonstrate all four.
7. **Resolved variables must accompany requested variables.** Record at least culture(s), requested population, class, resolved type, recipe per phase, resolved footprint and mesh, program, land capacity, actually housed inhabitants, deficits, and substitution reasons.
8. **Cleanup must reach the interface.** User-facing axes must be accessible in CityBench with distinct labels, combinable weighted functions, resolved automatic choices, and explained substitutions. Dependent options should follow context: phases and suburbs are not relevant settings for an isolated mill. Generation, inspector, examples, reset, and links/imports must share one model. This user requirement is tracked in [TODO](../TODO.md#cohérence-des-paramètres-et-accès-ui--priorité-haute). Weighted functions, classes, and grammars are active; section 1.4 covers labels/policies/imports. General contextual disabling and decomposed cultural model remain unfinished.

To enumerate combinations, start from `culture × population/scale × intention × terrain context`, resolve cultural defaults, then apply only relevant overrides. A scenario must carry these columns, even when some are “not applicable”:

```text
culture_principale, culture_secondaire, mode_melange,
population_demandee, classe_demographique, type_demande, type_resolu,
intention_isolee, fonctions_dominantes, etat, periode, cadre_historique,
biome, climat, relief, site, cote_insularite, riviere, lacs, navigation,
forme_emprise, mecanisme_emprise, budget_foncier, maillage,
composition, croissance_phases, faubourgs, enceinte, style_enceinte,
recettes, zones, operateur_parcellaire, desserte, orientation,
profil_routes, niveau_routes, surface_routes,
graines, position, decor, version_generateur,
architecture_affichee, camera,
capacite_fonciere, population_logee, deficits, substitutions
```

Combinable `fonctions_dominantes` and plausibility statuses are proposals, not fields implemented exactly as shown. Exact population, phase counts, and seeds must be defined for a finite matrix. The previous figure of 39,816 configurations counted only 79 cultures × 7 classes × 6 forced fabrics × 12 forced forms; it is neither the number of distinct supported variants nor coherent cases.

For captures, distinguish cultural, scale, and interaction coverage and performance stress. Fifty captures can provide a contrasting sample; they cannot individually cover 79 cultures, much less all combinations.



## 7. Complete cultural catalog and variation by scale

Table extracted from the native catalog. `—` means no explicit value or growth recipe; it does not mean a population ceiling. Growth selects another recipe set at the indicated threshold. Hamlet/village forms are cultural metadata; their final result depends on the native rules described above.

| Cultural ID | Label | Cultural plan | Hamlet / village | Growth from | Available recipes |
|---|---|---|---|---|---|
| `european-organic` | Medieval organic (Europe) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `bastide` | Bastide (planned grid) | `grid` | `auto` / `auto` | — | `core` ; `faubourg` ; `village` ; `hamlet` |
| `medina` | Medina (North Africa) | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `chinese` | Chinese walled city | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `japanese-jokamachi` | Japanese castle town (jōkamachi) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `indian-temple` | Indian temple town | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `roman-core` | Roman castrum core | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `elven` | Elven forest town | `organic` | `walled` / `walled` | — | `core` ; `ring` ; `village` ; `hamlet` |
| `dwarven` | Dwarven hold | `terraces` | `walled` / `walled` | — | `core` ; `faubourg` ; `village` ; `hamlet` |
| `necropolis` | Necropolis (city of the dead) | `grid` | `walled` / `walled` | — | `core` ; `ring` ; `village` ; `hamlet` |
| `russian-kremlin` | Russian kremlin and posad | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `aztec` | Aztec city (Tenochtitlan) | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `inca` | Inca city (Cusco) | `terraces` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `byzantine-greek` | Byzantine hill town (Mystras) | `terraces` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `venetian-lagoon` | Venetian lagoon town | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `persian` | Persian city (Isfahan) | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `ottoman` | Ottoman town (Bursa) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `sahel` | Sahelian mud town (Djenne) | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `hanseatic` | Hanseatic port (Lubeck) | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `korean` | Korean walled town (Hanyang) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `wizard-city` | Wizard city | `radial` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `gnomish` | Gnomish canal town | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `stilt-town` | Stilt town (marsh folk) | `dispersed` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `barbarian` | Barbarian: Germanic village | `dispersed` | `ring` / `ring` | 2000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `barbarian-celtic` | Barbarian: Celtic ringfort | `radial` | `ring` / `ring` | 2400 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `barbarian-norse` | Barbarian: Norse farmstead cluster | `dispersed` | `ring` / `ring` | 2200 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `norse-ringfort` | Norse ring fortress (Trelleborg) | `radial` | `ring` / `ring` | 1800 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `maya` | Maya city (ceremonial core, sacbeob) | `dispersed` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `khmer` | Khmer city (Angkor) | `grid` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `celtic-oppidum` | Celtic oppidum | `organic` | `ring` / `ring` | 20000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `orcish` | Orcish war camp | `dispersed` | `ring` / `ring` | 45000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `halfling` | Halfling shire | `dispersed` | `ring` / `ring` | 1500 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `kraal` | Kraal (African homestead) | `radial` | `ring` / `ring` | 3000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `native-iroquoian` | Native American: Iroquoian longhouse village | `linear` | `ring` / `ring` | 3500 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `native-pueblo` | Native American: Pueblo | `terraces` | `ring` / `ring` | 5000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `native-plains` | Native American: Plains tipi camp | `radial` | `ring` / `ring` | 4500 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `nomad-camp` | Nomad camp (steppe ordu) | `radial` | `ring` / `ring` | 6000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `swahili-stone-town` | Swahili stone town (Lamu / Zanzibar) | `organic` | `auto` / `walled` | — | `core` ; `core-sector-0` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `drow-enclave` | Drow enclave | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `duergar-hold` | Duergar industrial hold | `terraces` | `walled` / `walled` | — | `core` ; `faubourg` ; `village` ; `hamlet` |
| `myconid-colony` | Myconid colony | `radial` | `walled` / `walled` | — | `core` ; `village` ; `hamlet` |
| `egyptian-planned` | Egypt · planned Nile town | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `nubian-fortified` | Nubia · fortified town | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `mesopotamian` | Mesopotamia · courtyard districts | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `levantine-tell` | Levant · fortified tell town | `terraces` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `oasis-caravan` | Central Asia · oasis caravan city | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `ksar-oasis` | Maghreb · oasis ksar | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `yoruba` | Yoruba · compound town | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `himalayan-terraces` | Tibet and Ladakh · terraced settlement | `terraces` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `newar` | Newar Nepal · town with ritual squares | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `indus-planned` | Indus · Harappan city | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `javanese-courts` | Java · city of courtyards and enclosures | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `mississippian` | Mississippian · palisaded plaza center | `radial` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `al-andalus` | Al-Andalus · Iberian patio medina | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `italian-comune` | Italy · comune with piazza and towers | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `flemish-cloth-town` | Flanders · cloth town with belfry | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `rynek-town` | Central Europe · rynek town | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `slavic-gord` | Slavs · palisaded gord and podgrodzie | `radial` | `ring` / `ring` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `caucasian-highland` | Caucasus · Georgian and Armenian fortified town | `terraces` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `ethiopian-highland` | Ethiopia · highland city (Aksum, Lalibela) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `great-zimbabwe` | Zimbabwe · dry-stone enclosures | `organic` | `ring` / `ring` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `hausa-kano` | Hausa · earthen-walled city-state (Kano) | `organic` | `walled` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `hadhrami-tower` | Hadhramaut · vertical tower-house city (Shibam) | `organic` | `walled` / `walled` | — | `core` ; `village` ; `hamlet` |
| `rajput-fort` | Rajputana · town below a fort (Jaisalmer, Amber) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `dravidian-temple` | South India · temple town with concentric streets (Madurai) | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `bagan` | Burma · royal city of Pagan | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `vietnamese-citadel` | Viet · citadel and merchant district (Thăng Long) | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `tibetan-monastery` | Tibet · hillside monastic town | `terraces` | `terraces` / `terraces` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `mongol-ordu` | Mongols · ordu, princely yurt camp | `radial` | `ring` / `ring` | 8000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `maori-pa` | Māori · fortified terraced pā | `terraces` | `terraces` / `terraces` | — | `core` ; `village` ; `hamlet` |
| `pnw-plank-village` | Northwest Coast · plank-house village | `linear` | `auto` / `auto` | — | `core` ; `village` ; `hamlet` |
| `inuit-camp` | Arctic · Inuit winter camp | `dispersed` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `siberian-camp` | Siberia · reindeer herders’ chum camp | `radial` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `guarani-village` | Guaraní · longhouse village (tekoha) | `radial` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `budj-bim` | Australia · Budj Bim stone village | `dispersed` | `auto` / `auto` | — | `core` ; `village` ; `hamlet` |
| `lizardfolk-swamp` | Lizardfolk · stilt lake city | `dispersed` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `merfolk-tidal` | Merfolk · shore and sea-cave village | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `giant-hold` | Giants · megalithic town | `radial` | `ring` / `ring` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `goblin-warren` | Goblins · hillside warren | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |


### Growth recipe change thresholds

| Culture | Threshold (inhabitants) |
|---|---|
| `barbarian` | 2000 |
| `barbarian-celtic` | 2400 |
| `barbarian-norse` | 2200 |
| `norse-ringfort` | 1800 |
| `celtic-oppidum` | 20000 |
| `orcish` | 45000 |
| `halfling` | 1500 |
| `kraal` | 3000 |
| `native-iroquoian` | 3500 |
| `native-pueblo` | 5000 |
| `native-plains` | 4500 |
| `nomad-camp` | 6000 |
| `mongol-ordu` | 8000 |

These thresholds are not population maxima. A growth recipe can change the plan while preserving an architectural tradition. Absence of explicit growth does not prevent metropolitan use.

### Internal cultural domains present in the data

These values are recipe components, not independent selectors exposed by CityBench. The list includes values in base and growth profiles.

| Component | Values actually present |
|---|---|
| `plan.pattern` | `dispersed`, `grid`, `linear`, `organic`, `radial`, `terraces` |
| `plan.enclosure` | `circle`, `organic`, `oval`, `rect`, `rounded-rect`, `square`, `terraces` |
| `plan.fortification` | `auto`, `hedge`, `none`, `palisade`, `wall` |
| `plan.gates` | `cardinal`, `roads` |
| `plan.orientation` | `cardinal`, `road`, `terrain`, `water` |
| `nucleus.kind` | `castle`, `clocktower`, `drum-tower`, `forum`, `grove`, `maidan`, `market`, `mortuary`, `mosque`, `mud-mosque`, `none`, `precinct`, `royal-enclosure`, `temple`, `ushnu`, `wizard-tower` |
| `nucleus.shape` | `circle`, `hull`, `rect`, `square` |
| `nucleus.orientation` | `cardinal`, `qibla`, `road`, `terrain`, `water` |
| `core.enclosure.shape` | `circle`, `organic`, `oval`, `rect`, `rounded-rect`, `square`, `terraces` |
| `core.enclosure.wall` | `auto`, `hedge`, `none`, `palisade`, `wall` |
| `core.enclosure.fossil` | `none`, `street`, `wall` |
| `ring.enclosure.shape` | `circle`, `organic`, `oval`, `rect`, `rounded-rect`, `square`, `terraces` |
| `ring.enclosure.wall` | `auto`, `hedge`, `none`, `palisade`, `wall` |
| `ring.enclosure.fossil` | `none`, `street`, `wall` |
| `hamlet.form` | `auto`, `ring`, `terraces`, `walled` |
| `village.form` | `auto`, `ring`, `terraces`, `walled` |

TS profiles also know `grove` forms, `qibla` nucleus orientations, `street/wall/none` enclosure fossils, and rendering attributes such as canopy, stilts, canals, and terraces. Presence in the historical contract must be distinguished from actual native scene support.


## 8. Presets and roles: complete dependent domains

The catalog contains **79 cultures, 382 cultural recipe references, and 443 presets**. These counts do not add up to independent styles. The references below make the preset list explicit.

### Exact cultural recipe references

| Culture | Recipe → preset |
|---|---|
| `european-organic` | `core` → `european-organic/core` ; `ring` → `european-organic/ring` ; `faubourg` → `european-organic/faubourg` ; `village` → `european-organic/village` ; `hamlet` → `european-organic/hamlet` |
| `bastide` | `core` → `bastide/core` ; `faubourg` → `bastide/faubourg` ; `village` → `bastide/village` ; `hamlet` → `bastide/hamlet` |
| `medina` | `core` → `medina/core` ; `ring` → `medina/ring` ; `faubourg` → `medina/faubourg` ; `village` → `medina/village` ; `hamlet` → `medina/hamlet` |
| `chinese` | `core` → `chinese/core` ; `ring` → `chinese/ring` ; `faubourg` → `chinese/faubourg` ; `village` → `chinese/village` ; `hamlet` → `chinese/hamlet` |
| `japanese-jokamachi` | `core` → `japanese-jokamachi/core` ; `ring` → `japanese-jokamachi/ring` ; `faubourg` → `japanese-jokamachi/faubourg` ; `village` → `japanese-jokamachi/village` ; `hamlet` → `japanese-jokamachi/hamlet` |
| `indian-temple` | `core` → `indian-temple/core` ; `ring` → `indian-temple/ring` ; `faubourg` → `indian-temple/faubourg` ; `village` → `indian-temple/village` ; `hamlet` → `indian-temple/hamlet` |
| `roman-core` | `core` → `roman-core/core` ; `ring` → `roman-core/ring` ; `faubourg` → `roman-core/faubourg` ; `village` → `roman-core/village` ; `hamlet` → `roman-core/hamlet` |
| `elven` | `core` → `elven/core` ; `ring` → `elven/ring` ; `village` → `elven/village` ; `hamlet` → `elven/hamlet` |
| `dwarven` | `core` → `dwarven/core` ; `faubourg` → `dwarven/faubourg` ; `village` → `dwarven/village` ; `hamlet` → `dwarven/hamlet` |
| `necropolis` | `core` → `necropolis/core` ; `ring` → `necropolis/ring` ; `village` → `necropolis/village` ; `hamlet` → `necropolis/hamlet` |
| `russian-kremlin` | `core` → `russian-kremlin/core` ; `ring` → `russian-kremlin/ring` ; `faubourg` → `russian-kremlin/faubourg` ; `village` → `russian-kremlin/village` ; `hamlet` → `russian-kremlin/hamlet` |
| `aztec` | `core` → `aztec/core` ; `ring` → `aztec/ring` ; `faubourg` → `aztec/faubourg` ; `village` → `aztec/village` ; `hamlet` → `aztec/hamlet` |
| `inca` | `core` → `inca/core` ; `ring` → `inca/ring` ; `faubourg` → `inca/faubourg` ; `village` → `inca/village` ; `hamlet` → `inca/hamlet` |
| `byzantine-greek` | `core` → `byzantine-greek/core` ; `ring` → `byzantine-greek/ring` ; `faubourg` → `byzantine-greek/faubourg` ; `village` → `byzantine-greek/village` ; `hamlet` → `byzantine-greek/hamlet` |
| `venetian-lagoon` | `core` → `venetian-lagoon/core` ; `ring` → `venetian-lagoon/ring` ; `faubourg` → `venetian-lagoon/faubourg` ; `village` → `venetian-lagoon/village` ; `hamlet` → `venetian-lagoon/hamlet` |
| `persian` | `core` → `persian/core` ; `ring` → `persian/ring` ; `faubourg` → `persian/faubourg` ; `village` → `persian/village` ; `hamlet` → `persian/hamlet` |
| `ottoman` | `core` → `ottoman/core` ; `ring` → `ottoman/ring` ; `faubourg` → `ottoman/faubourg` ; `village` → `ottoman/village` ; `hamlet` → `ottoman/hamlet` |
| `sahel` | `core` → `sahel/core` ; `ring` → `sahel/ring` ; `faubourg` → `sahel/faubourg` ; `village` → `sahel/village` ; `hamlet` → `sahel/hamlet` |
| `hanseatic` | `core` → `hanseatic/core` ; `ring` → `hanseatic/ring` ; `faubourg` → `hanseatic/faubourg` ; `village` → `hanseatic/village` ; `hamlet` → `hanseatic/hamlet` |
| `korean` | `core` → `korean/core` ; `ring` → `korean/ring` ; `faubourg` → `korean/faubourg` ; `village` → `korean/village` ; `hamlet` → `korean/hamlet` |
| `wizard-city` | `core` → `wizard-city/core` ; `ring` → `wizard-city/ring` ; `faubourg` → `wizard-city/faubourg` ; `village` → `wizard-city/village` ; `hamlet` → `wizard-city/hamlet` |
| `gnomish` | `core` → `gnomish/core` ; `ring` → `gnomish/ring` ; `faubourg` → `gnomish/faubourg` ; `village` → `gnomish/village` ; `hamlet` → `gnomish/hamlet` |
| `stilt-town` | `core` → `stilt-town/core` ; `village` → `stilt-town/village` ; `hamlet` → `stilt-town/hamlet` |
| `barbarian` | `core` → `barbarian/core` ; `village` → `barbarian/village` ; `hamlet` → `barbarian/hamlet` ; `grown-core` → `barbarian/grown-core` ; `grown-ring` → `barbarian/grown-ring` ; `grown-faubourg` → `barbarian/grown-faubourg` |
| `barbarian-celtic` | `core` → `barbarian-celtic/core` ; `village` → `barbarian-celtic/village` ; `hamlet` → `barbarian-celtic/hamlet` ; `grown-core` → `barbarian-celtic/grown-core` ; `grown-ring` → `barbarian-celtic/grown-ring` ; `grown-faubourg` → `barbarian-celtic/grown-faubourg` |
| `barbarian-norse` | `core` → `barbarian-norse/core` ; `village` → `barbarian-norse/village` ; `hamlet` → `barbarian-norse/hamlet` ; `grown-core` → `barbarian-norse/grown-core` ; `grown-ring` → `barbarian-norse/grown-ring` ; `grown-faubourg` → `barbarian-norse/grown-faubourg` |
| `norse-ringfort` | `core` → `norse-ringfort/core` ; `village` → `norse-ringfort/village` ; `hamlet` → `norse-ringfort/hamlet` ; `grown-core` → `norse-ringfort/grown-core` ; `grown-ring` → `norse-ringfort/grown-ring` ; `grown-faubourg` → `norse-ringfort/grown-faubourg` |
| `maya` | `core` → `maya/core` ; `village` → `maya/village` ; `hamlet` → `maya/hamlet` |
| `khmer` | `core` → `khmer/core` ; `village` → `khmer/village` ; `hamlet` → `khmer/hamlet` |
| `celtic-oppidum` | `core` → `celtic-oppidum/core` ; `village` → `celtic-oppidum/village` ; `hamlet` → `celtic-oppidum/hamlet` ; `grown-core` → `celtic-oppidum/grown-core` ; `grown-ring` → `celtic-oppidum/grown-ring` ; `grown-faubourg` → `celtic-oppidum/grown-faubourg` |
| `orcish` | `core` → `orcish/core` ; `village` → `orcish/village` ; `hamlet` → `orcish/hamlet` ; `grown-core` → `orcish/grown-core` ; `grown-ring` → `orcish/grown-ring` ; `grown-faubourg` → `orcish/grown-faubourg` |
| `halfling` | `core` → `halfling/core` ; `village` → `halfling/village` ; `hamlet` → `halfling/hamlet` ; `grown-core` → `halfling/grown-core` ; `grown-ring` → `halfling/grown-ring` ; `grown-faubourg` → `halfling/grown-faubourg` |
| `kraal` | `core` → `kraal/core` ; `village` → `kraal/village` ; `hamlet` → `kraal/hamlet` ; `grown-core` → `kraal/grown-core` ; `grown-ring` → `kraal/grown-ring` ; `grown-faubourg` → `kraal/grown-faubourg` |
| `native-iroquoian` | `core` → `native-iroquoian/core` ; `village` → `native-iroquoian/village` ; `hamlet` → `native-iroquoian/hamlet` ; `grown-core` → `native-iroquoian/grown-core` ; `grown-ring` → `native-iroquoian/grown-ring` ; `grown-faubourg` → `native-iroquoian/grown-faubourg` |
| `native-pueblo` | `core` → `native-pueblo/core` ; `village` → `native-pueblo/village` ; `hamlet` → `native-pueblo/hamlet` ; `grown-core` → `native-pueblo/grown-core` ; `grown-ring` → `native-pueblo/grown-ring` ; `grown-faubourg` → `native-pueblo/grown-faubourg` |
| `native-plains` | `core` → `native-plains/core` ; `village` → `native-plains/village` ; `hamlet` → `native-plains/hamlet` ; `grown-core` → `native-plains/grown-core` ; `grown-ring` → `native-plains/grown-ring` ; `grown-faubourg` → `native-plains/grown-faubourg` |
| `nomad-camp` | `core` → `nomad-camp/core` ; `village` → `nomad-camp/village` ; `hamlet` → `nomad-camp/hamlet` ; `grown-core` → `nomad-camp/grown-core` ; `grown-ring` → `nomad-camp/grown-ring` ; `grown-faubourg` → `nomad-camp/grown-faubourg` |
| `swahili-stone-town` | `core` → `swahili-stone-town/core` ; `core-sector-0` → `swahili-stone-town/core-sector-0` ; `ring` → `swahili-stone-town/ring` ; `faubourg` → `swahili-stone-town/faubourg` ; `village` → `swahili-stone-town/village` ; `hamlet` → `swahili-stone-town/hamlet` |
| `drow-enclave` | `core` → `drow-enclave/core` ; `ring` → `drow-enclave/ring` ; `faubourg` → `drow-enclave/faubourg` ; `village` → `drow-enclave/village` ; `hamlet` → `drow-enclave/hamlet` |
| `duergar-hold` | `core` → `duergar-hold/core` ; `faubourg` → `duergar-hold/faubourg` ; `village` → `duergar-hold/village` ; `hamlet` → `duergar-hold/hamlet` |
| `myconid-colony` | `core` → `myconid-colony/core` ; `village` → `myconid-colony/village` ; `hamlet` → `myconid-colony/hamlet` |
| `egyptian-planned` | `core` → `egyptian-planned/core` ; `ring` → `egyptian-planned/ring` ; `faubourg` → `egyptian-planned/faubourg` ; `village` → `egyptian-planned/village` ; `hamlet` → `egyptian-planned/hamlet` |
| `nubian-fortified` | `core` → `nubian-fortified/core` ; `ring` → `nubian-fortified/ring` ; `faubourg` → `nubian-fortified/faubourg` ; `village` → `nubian-fortified/village` ; `hamlet` → `nubian-fortified/hamlet` |
| `mesopotamian` | `core` → `mesopotamian/core` ; `ring` → `mesopotamian/ring` ; `faubourg` → `mesopotamian/faubourg` ; `village` → `mesopotamian/village` ; `hamlet` → `mesopotamian/hamlet` |
| `levantine-tell` | `core` → `levantine-tell/core` ; `ring` → `levantine-tell/ring` ; `faubourg` → `levantine-tell/faubourg` ; `village` → `levantine-tell/village` ; `hamlet` → `levantine-tell/hamlet` |
| `oasis-caravan` | `core` → `oasis-caravan/core` ; `ring` → `oasis-caravan/ring` ; `faubourg` → `oasis-caravan/faubourg` ; `village` → `oasis-caravan/village` ; `hamlet` → `oasis-caravan/hamlet` |
| `ksar-oasis` | `core` → `ksar-oasis/core` ; `ring` → `ksar-oasis/ring` ; `faubourg` → `ksar-oasis/faubourg` ; `village` → `ksar-oasis/village` ; `hamlet` → `ksar-oasis/hamlet` |
| `yoruba` | `core` → `yoruba/core` ; `ring` → `yoruba/ring` ; `faubourg` → `yoruba/faubourg` ; `village` → `yoruba/village` ; `hamlet` → `yoruba/hamlet` |
| `himalayan-terraces` | `core` → `himalayan-terraces/core` ; `ring` → `himalayan-terraces/ring` ; `faubourg` → `himalayan-terraces/faubourg` ; `village` → `himalayan-terraces/village` ; `hamlet` → `himalayan-terraces/hamlet` |
| `newar` | `core` → `newar/core` ; `ring` → `newar/ring` ; `faubourg` → `newar/faubourg` ; `village` → `newar/village` ; `hamlet` → `newar/hamlet` |
| `indus-planned` | `core` → `indus-planned/core` ; `ring` → `indus-planned/ring` ; `faubourg` → `indus-planned/faubourg` ; `village` → `indus-planned/village` ; `hamlet` → `indus-planned/hamlet` |
| `javanese-courts` | `core` → `javanese-courts/core` ; `ring` → `javanese-courts/ring` ; `faubourg` → `javanese-courts/faubourg` ; `village` → `javanese-courts/village` ; `hamlet` → `javanese-courts/hamlet` |
| `mississippian` | `core` → `mississippian/core` ; `ring` → `mississippian/ring` ; `faubourg` → `mississippian/faubourg` ; `village` → `mississippian/village` ; `hamlet` → `mississippian/hamlet` |
| `al-andalus` | `core` → `al-andalus/core` ; `ring` → `al-andalus/ring` ; `faubourg` → `al-andalus/faubourg` ; `village` → `al-andalus/village` ; `hamlet` → `al-andalus/hamlet` |
| `italian-comune` | `core` → `italian-comune/core` ; `ring` → `italian-comune/ring` ; `faubourg` → `italian-comune/faubourg` ; `village` → `italian-comune/village` ; `hamlet` → `italian-comune/hamlet` |
| `flemish-cloth-town` | `core` → `flemish-cloth-town/core` ; `ring` → `flemish-cloth-town/ring` ; `faubourg` → `flemish-cloth-town/faubourg` ; `village` → `flemish-cloth-town/village` ; `hamlet` → `flemish-cloth-town/hamlet` |
| `rynek-town` | `core` → `rynek-town/core` ; `ring` → `rynek-town/ring` ; `faubourg` → `rynek-town/faubourg` ; `village` → `rynek-town/village` ; `hamlet` → `rynek-town/hamlet` |
| `slavic-gord` | `core` → `slavic-gord/core` ; `ring` → `slavic-gord/ring` ; `faubourg` → `slavic-gord/faubourg` ; `village` → `slavic-gord/village` ; `hamlet` → `slavic-gord/hamlet` |
| `caucasian-highland` | `core` → `caucasian-highland/core` ; `ring` → `caucasian-highland/ring` ; `faubourg` → `caucasian-highland/faubourg` ; `village` → `caucasian-highland/village` ; `hamlet` → `caucasian-highland/hamlet` |
| `ethiopian-highland` | `core` → `ethiopian-highland/core` ; `ring` → `ethiopian-highland/ring` ; `faubourg` → `ethiopian-highland/faubourg` ; `village` → `ethiopian-highland/village` ; `hamlet` → `ethiopian-highland/hamlet` |
| `great-zimbabwe` | `core` → `great-zimbabwe/core` ; `ring` → `great-zimbabwe/ring` ; `faubourg` → `great-zimbabwe/faubourg` ; `village` → `great-zimbabwe/village` ; `hamlet` → `great-zimbabwe/hamlet` |
| `hausa-kano` | `core` → `hausa-kano/core` ; `ring` → `hausa-kano/ring` ; `faubourg` → `hausa-kano/faubourg` ; `village` → `hausa-kano/village` ; `hamlet` → `hausa-kano/hamlet` |
| `hadhrami-tower` | `core` → `hadhrami-tower/core` ; `village` → `hadhrami-tower/village` ; `hamlet` → `hadhrami-tower/hamlet` |
| `rajput-fort` | `core` → `rajput-fort/core` ; `ring` → `rajput-fort/ring` ; `faubourg` → `rajput-fort/faubourg` ; `village` → `rajput-fort/village` ; `hamlet` → `rajput-fort/hamlet` |
| `dravidian-temple` | `core` → `dravidian-temple/core` ; `ring` → `dravidian-temple/ring` ; `faubourg` → `dravidian-temple/faubourg` ; `village` → `dravidian-temple/village` ; `hamlet` → `dravidian-temple/hamlet` |
| `bagan` | `core` → `bagan/core` ; `ring` → `bagan/ring` ; `faubourg` → `bagan/faubourg` ; `village` → `bagan/village` ; `hamlet` → `bagan/hamlet` |
| `vietnamese-citadel` | `core` → `vietnamese-citadel/core` ; `ring` → `vietnamese-citadel/ring` ; `faubourg` → `vietnamese-citadel/faubourg` ; `village` → `vietnamese-citadel/village` ; `hamlet` → `vietnamese-citadel/hamlet` |
| `tibetan-monastery` | `core` → `tibetan-monastery/core` ; `ring` → `tibetan-monastery/ring` ; `faubourg` → `tibetan-monastery/faubourg` ; `village` → `tibetan-monastery/village` ; `hamlet` → `tibetan-monastery/hamlet` |
| `mongol-ordu` | `core` → `mongol-ordu/core` ; `village` → `mongol-ordu/village` ; `hamlet` → `mongol-ordu/hamlet` ; `grown-core` → `mongol-ordu/grown-core` ; `grown-ring` → `mongol-ordu/grown-ring` ; `grown-faubourg` → `mongol-ordu/grown-faubourg` |
| `maori-pa` | `core` → `maori-pa/core` ; `village` → `maori-pa/village` ; `hamlet` → `maori-pa/hamlet` |
| `pnw-plank-village` | `core` → `pnw-plank-village/core` ; `village` → `pnw-plank-village/village` ; `hamlet` → `pnw-plank-village/hamlet` |
| `inuit-camp` | `core` → `inuit-camp/core` ; `village` → `inuit-camp/village` ; `hamlet` → `inuit-camp/hamlet` |
| `siberian-camp` | `core` → `siberian-camp/core` ; `village` → `siberian-camp/village` ; `hamlet` → `siberian-camp/hamlet` |
| `guarani-village` | `core` → `guarani-village/core` ; `village` → `guarani-village/village` ; `hamlet` → `guarani-village/hamlet` |
| `budj-bim` | `core` → `budj-bim/core` ; `village` → `budj-bim/village` ; `hamlet` → `budj-bim/hamlet` |
| `lizardfolk-swamp` | `core` → `lizardfolk-swamp/core` ; `ring` → `lizardfolk-swamp/ring` ; `faubourg` → `lizardfolk-swamp/faubourg` ; `village` → `lizardfolk-swamp/village` ; `hamlet` → `lizardfolk-swamp/hamlet` |
| `merfolk-tidal` | `core` → `merfolk-tidal/core` ; `ring` → `merfolk-tidal/ring` ; `faubourg` → `merfolk-tidal/faubourg` ; `village` → `merfolk-tidal/village` ; `hamlet` → `merfolk-tidal/hamlet` |
| `giant-hold` | `core` → `giant-hold/core` ; `ring` → `giant-hold/ring` ; `faubourg` → `giant-hold/faubourg` ; `village` → `giant-hold/village` ; `hamlet` → `giant-hold/hamlet` |
| `goblin-warren` | `core` → `goblin-warren/core` ; `ring` → `goblin-warren/ring` ; `faubourg` → `goblin-warren/faubourg` ; `village` → `goblin-warren/village` ; `hamlet` → `goblin-warren/hamlet` |


### Other catalog presets

61 presets are not referenced by the cultural recipes above:

- `morph/european-organic`
- `morph/bastide`
- `morph/perimeter-block`
- `morph/kraal`
- `morph/plains-camp`
- `morph/barbarian`
- `morph/barbarian-celtic`
- `morph/barbarian-norse`
- `morph/iroquoian`
- `morph/pueblo`
- `morph/norse-ringfort`
- `morph/maya`
- `morph/khmer`
- `morph/oppidum`
- `morph/orcish`
- `morph/halfling`
- `morph/stilt-town`
- `morph/nomad-camp`
- `morph/barbarian-town`
- `morph/barbarian-celtic-town`
- `morph/barbarian-norse-town`
- `morph/norse-ringfort-town`
- `morph/celtic-oppidum-town`
- `morph/orcish-town`
- `morph/halfling-town`
- `morph/kraal-town`
- `morph/native-iroquoian-town`
- `morph/native-pueblo-town`
- `morph/native-plains-town`
- `morph/nomad-camp-town`
- `morph/inca`
- `morph/aztec`
- `morph/posad`
- `morph/necropolis`
- `morph/roman-castrum`
- `morph/medina`
- `morph/medina-souk`
- `morph/chinese`
- `morph/jp-samurai`
- `morph/jp-merchant`
- `morph/indian-temple`
- `morph/elven`
- `morph/dwarven`
- `morph/chinese-suburb`
- `morph/swahili-stone`
- `morph/swahili-bazaar`
- `morph/byzantine`
- `morph/venetian`
- `morph/persian`
- `morph/persian-bazaar`
- `morph/ottoman`
- `morph/ottoman-carsi`
- `morph/sahel`
- `morph/sahel-town`
- `morph/hanseatic`
- `morph/korean`
- `morph/wizard`
- `morph/gnomish`
- `morph/drow-enclave`
- `morph/duergar-hold`
- `morph/myconid-colony`


### Detailed functional roles

Service families contain **87 distinct roles**. Adding rural services, isolated intentions, and nucleus mapping yields **98 referenced role IDs** in these sections. This shows why six urban vocations do not summarize the generator’s full functional variety. These are program roles, not a guarantee that a dedicated building is actually admitted.

| Role | Generic catalog label, where present | Provenance |
|---|---|---|
| `civic.academy` | Academy | cultural services |
| `civic.amphitheatre` | Amphitheatre | cultural services |
| `civic.ballcourt` | Ballcourt | cultural services |
| `civic.basilica` | Basilica | cultural services |
| `civic.bathhouse` | Bathhouse | cultural services |
| `civic.calmecac` | Calmecac (school) | cultural services |
| `civic.clocktower` | Belfry | nucleus |
| `civic.council-house` | Council house | cultural services |
| `civic.drum-tower` | Drum tower | nucleus |
| `civic.forum` | Forum | cultural services, nucleus |
| `civic.ghat` | Ghats (river steps) | cultural services |
| `civic.guildhall` | Guildhall | cultural services |
| `civic.hall` | Common hall | cultural services |
| `civic.hammam` | Hammam | cultural services |
| `civic.hospital` | Hospital | cultural services |
| `civic.kallanka` | Kallanka (great hall) | cultural services |
| `civic.khan-tent` | Khan’s tent | cultural services |
| `civic.longhall` | Great hall | cultural services |
| `civic.madrasa` | Madrasa | cultural services |
| `civic.maristan` | Maristan (hospital) | cultural services |
| `civic.palace` | Palace | cultural services, nucleus |
| `civic.stepwell` | Stepwell | cultural services |
| `civic.tank` | Sacred tank | cultural services |
| `civic.theatre` | Theatre | cultural services |
| `civic.thermae` | Thermae | cultural services |
| `civic.townhall` | Town hall | cultural services |
| `civic.university` | University | cultural services |
| `civic.wizard-tower` | Wizard tower | nucleus |
| `civic.yamen` | Yamen (magistrate’s seat) | cultural services |
| `commerce.bazaar` | Bazaar | cultural services |
| `commerce.caravanserai` | Caravanserai | cultural services |
| `commerce.dharamshala` | Dharamshala (pilgrim lodging) | cultural services |
| `commerce.emporium` | Emporium (port market) | cultural services |
| `commerce.fishmarket` | Fish market | cultural services |
| `commerce.funduq` | Funduq | cultural services |
| `commerce.inn` | Inn | cultural services, isolated |
| `commerce.macellum` | Macellum (covered market) | cultural services |
| `commerce.maidan` | Maidan | nucleus |
| `commerce.market` | Market square | cultural services, nucleus |
| `commerce.market.gate` | Gate market | cultural services |
| `commerce.market.ward` | District market | cultural services |
| `commerce.souk` | Souk | cultural services |
| `commerce.taberna` | Taberna | cultural services |
| `commerce.tianguis` | Tianguis (market) | cultural services |
| `commerce.warehouse` | Port warehouse | cultural services |
| `craft.alchemist` | Alchemist’s shop | cultural services |
| `craft.bakery` | Bakery | cultural services |
| `craft.boatshed` | Boatshed | cultural services |
| `craft.brewery` | Brewery | cultural services |
| `craft.dyer` | Dye works | cultural services |
| `craft.fullonica` | Fullery | cultural services |
| `craft.mill` | Water mill | cultural services, isolated |
| `craft.obsidian` | Obsidian workshop | cultural services |
| `craft.potter` | Pottery | cultural services |
| `craft.smithy` | Smithy | cultural services |
| `craft.tannery` | Tannery | cultural services |
| `craft.weaver` | Weaving workshop | cultural services |
| `craft.workshop` | Workshop | cultural services |
| `defence.barracks` | Barracks | cultural services |
| `defence.castle` | Castle | cultural services, nucleus |
| `defence.fort` | Fort | cultural services |
| `defence.fortress` | Fortress | cultural services |
| `defence.kasbah` | Kasbah | cultural services |
| `defence.keep` | Keep | cultural services |
| `defence.tower` | Watchtower | isolated |
| `dwelling.farm` | Farm (dwelling, barn, and courtyard) | isolated |
| `elite.kancha-palace` | Palace (kancha) | cultural services |
| `elite.palace` | Palace | cultural services |
| `open.cemetery` | Cemetery | cultural services |
| `open.corral` | Livestock enclosure | cultural services |
| `open.kraal` | Kraal | cultural services |
| `open.necropolis` | Necropolis | cultural services |
| `open.plaza` | Square | cultural services |
| `open.thing` | Thing meeting place | cultural services |
| `storage.barn` | Communal barn | rural |
| `storage.granary` | Granary | cultural services |
| `storage.horreum` | Horreum (warehouse) | cultural services |
| `storage.qollqa` | Qollqa (state granary) | cultural services |
| `worship.capitolium` | Capitolium | cultural services |
| `worship.cathedral` | Cathedral | cultural services |
| `worship.city-god-temple` | City god temple | cultural services |
| `worship.confucian-temple` | Confucian temple | cultural services |
| `worship.grove` | Sacred grove | nucleus |
| `worship.hof` | Hof (temple) | cultural services |
| `worship.huaca` | Huaca (sacred place) | cultural services |
| `worship.kiva` | Kiva | cultural services |
| `worship.masjid` | Neighborhood mosque | cultural services |
| `worship.monastery` | Monastery | cultural services |
| `worship.mortuary-temple` | Mortuary temple | nucleus |
| `worship.mosque.friday` | Friday mosque | cultural services, nucleus |
| `worship.parish` | Parish church | cultural services |
| `worship.precinct` | Sacred precinct | nucleus |
| `worship.pyramid-precinct` | Pyramid precinct | cultural services |
| `worship.shrine` | Shrine | cultural services, isolated |
| `worship.temple` | Temple | cultural services |
| `worship.temple.major` | Major temple | cultural services, nucleus |
| `worship.ushnu` | Ushnu (ceremonial platform) | cultural services, nucleus |
| `worship.wayside` | Wayside shrine | isolated |


The program also produces domestic and open-space roles (for example `dwelling`, `dwelling.shop`, `open.common`, `open.garden`); local roles can be edited and states add suffixes. The set of possible strings is therefore not one globally closed enumeration.

## 9. Sources and scope of completeness

The inventory covers every axis cited in the discussion; all selectors in `LayoutConfig`, `ParcelConfig`, `FootprintConfig`, and `ProgrammeContext`; scale classifications; the 79 cultures and their recipes; major terrain/water/road contexts; and presentation differences. Quantitative and free fields are identified so they do not disappear from the matrix. Neural model versions, internal parameters of each house recipe, individual brush palettes/dimensions, and settings for every tower or portal are not new city categories; their detailed domains remain in their respective catalogs.

Principal sources, all local:

- [Urban configuration contract](../rust/bridge/urbanConfig.ts)
- [Native cultures and recipes catalog](../rust/crates/core/src/urban/catalogue.json)
- [Native type and small-settlement resolution](../rust/crates/core/src/urban/kinds.rs)
- [Composition, phases, and centers](../rust/crates/core/src/urban/composition.rs)
- [Cultural profiles and population adaptation](../rust/crates/core/src/urban/profiles.rs)
- [Footprint and growth mechanisms](../rust/crates/core/src/urban/footprint.rs)
- [Program and request admission](../rust/crates/core/src/urban/programme.rs)
- [Services and vocation effects](../rust/crates/core/src/urban/roles.rs)
- [Services and states catalog](../rust/crates/core/src/urban/services.json)
- [Culture / architecture mapping](../rust/crates/core/src/urban/culture.rs)
- [Legacy demographic classes and thresholds](../web/src/gen/options.ts)
- [Legacy scale ranges and cultural forms](../web/src/gen/urban/culture.ts)
- [Legacy pipeline ceiling](../web/src/gen/pipeline.ts)
- [UI population shortcuts](../web/src/ui/settlementKinds.ts)
- [Declared CityBench map limit](../web/src/ui/terrainSettlements.ts)
- [Composite settlement presets](../web/src/ui/urbanSettlementStyles.ts)
- [Historical workshop operators](../web/src/gen/urban/testbenchConfig.ts)
- [Biomes](../web/src/gen/biomes.ts)
- [Terrain and climates](../rust/bridge/terrain.ts)
- [Hydrology](../rust/bridge/hydrology.ts)
- [Regional placement and roads](../rust/bridge/settlements.ts)
- [Native architectural contract](../rust/bridge/urbanArchitecture.ts)
- [Building modes and painting](../web/src/render/urbanBuildingStyle.ts)

No historical population ceiling is asserted for a culture on this code alone. Sections 1 and 6 contain model recommendations distinct from existing behavior.
