# Contextual urban programme and bounded allocation

Implemented 21 October 2026. This is an artistic procedural prototype, not a historical economic simulation or a demographic reconstruction.

## Objective and inputs

Keep functional demand, land capacity and accepted building capacity separate. Inputs are the applied population, explicit role, known resources, culture by phase/quarter, period, architectural compatibility mode and lore. Coordinates and frontage are metres; areas are square metres. Unknown resources remain unknown. Surface water alone never establishes navigability: warehouse demand requires an explicit port role or navigable access; admissible waterfront land additionally requires physical water proximity and an explicit navigability declaration.

Explicit cultural functional profiles (`town`, `communal`, `institutional`) also affect common/exchange/institutional demand; communal profiles do not automatically acquire a civic market, while an explicit trade role can request one. These are declared artistic intentions, not universal historical rules.

The programme context accepts roles `auto`, `agricultural`, `crossroads`, `artisan`, `riverine`, `port`, `capital`; known resources such as `grain`, `timber`, `stone`, `ore`, `clay`, `fish`; and lore such as `temple`, `palace`, `necropolis`, `magic`. Resource names without a current effect remain retained inputs rather than acquiring invented economic properties. The period accepts `A`, `M` or `any` (an empty value means `any`). It selects a supported native recipe before cuts and is retained by houses admission; unavailable pack/era pairs remain explicit residual land and deficits.

## Demand and reservations

An explicit prototype assumption uses 4.5 people per domestic unit. Domestic and mixed demands share that total; their split responds to role. Commons are open land, with larger requests for agricultural places. Crossroads ask for larger markets. Artisan role or known timber/stone/ore/clay raises workshop demand. Capital role or declared institutional lore requests collective land. Each request records its unit, target area/frontage, provenance, prerequisites and reasons for failure.

Before cadastral subdivision, the algorithm chooses whole existing accessible blocks for demanding market, collective and warehouse functions, plus workshops tied to a known resource. Artisan activity without a declared resource remains a diffuse allocation. It preserves the block polygon, its holes and all streets. A reservation candidate must have the same continuous street-edge contacts as cadastral qualification, sufficiently flat dry land, and an area between 0.35 and 4 times its target. Ranking combines logarithmic area mismatch and distance to the centre. Infeasible reservations remain deficits. A parcel-only recalculation never silently changes the street network.

Whole-block reservations are deliberately conservative. This prototype does not carve a new quay, simulate shipping, or create a large institution by cutting through existing streets. The coarse block terrain test is an early filter; architectural placement performs the final geometric and terrain admission.

## Allocation and reconciliation

A spatial grid generates candidate neighbouring parcels, followed by positive collinear shared-edge overlap in metres; centroids alone do not create adjacency. Allocation ranks demands by scarcity of admissible parcels, then tries candidates using true neighbour coherence, frontage, centrality and excess capacity. It performs two passes. The second pass can reclaim excess domestic or mixed capacity only if the displaced demand remains covered. This is a local greedy heuristic designed here, not an implementation of a global optimisation paper. It never adds alleys, changes parcel boundaries or claims globally optimal allocation.

Ordinary built functions require an authorised access and a contained metric envelope, including exact polygon-difference checks against holes wholly inside the witness. A public frontage follows the cultural module; a private or collective gate instead follows its separate access width, derived from the selected recipe's enclosure gate dimensions with the houses solver's 0.8 m admission floor. A body may stand inside its domain behind a narrower gate; its geometry is never shrunk to that gate width. Cultural profiles distinguish frontage, compact, courtyard, compound and inherited land patterns. The cadastral witness envelope is retained when available and forwarded as an optional native placement hint. It is advisory: final physical geometry, access connection and containment still require validation. The houses engine remains the authority for an actual recipe and returns explicit placement refusals. Market and common allocations stay open spaces.

Domestic land capacity is one domestic unit per eligible parcel, matching the current native one-building placement path. Large parcels do not silently imply several households. Other enclosed uses estimate `parcelArea x 0.55`, in square metres; open uses keep land area. These assumptions estimate land suitability only. `parcelCapacity`, `builtCapacity` and `requested` are distinct fields. Accepted open surfaces have their own `openCapacity`, never built housing. The true outstanding demand is `max(0, requested - builtCapacity - openCapacity)`; land shortfall is separately `max(0, requested - parcelCapacity)`. A retained scene must update the built budget from accepted buildings; refusals do not consume housing demand.

## Culture and architectural boundary

Every UI culture has an explicit entry below. Sharing a geographical catalogue pack is declared as `shared-pack`; an invented or broad artistic culture has `declared-borrowing`. Strict mode refuses declared borrowing. Inspired and fantasy modes carry that declaration to architectural placement. No name similarity selects a pack. These are declared routes through the current geometric catalogue, not evidence that every recipe is usable in every parcel or period.

Land family controls subdivision. Architecture family independently selects a native building layout: Sahel shared compound land contains individual houses, and stilt land contains native supported platforms.

| Urban culture | Land family | Architecture family | Functional profile | Houses pack | Declared borrowing |
| --- | --- | --- | --- | --- | --- |
| european-organic | frontage | frontage | town | EUR-MED | no; shared pack |
| bastide | compact | compact | town | EUR-MED | no; shared pack |
| medina | courtyard | courtyard | town | AF-MAG | no; shared pack |
| chinese | courtyard | courtyard | town | AS-CHI | no; shared pack |
| japanese-jokamachi | compact | compact | town | AS-JAP | no; shared pack |
| indian-temple | courtyard | courtyard | institutional | AS-IND | no; shared pack |
| roman-core | courtyard | courtyard | town | MED-ANT | no; shared pack |
| elven | inherited | inherited | communal | EUR-NOR | yes |
| dwarven | compact | compact | town | EUR-EAST | yes |
| necropolis | compound | compound | institutional | AF-NILE | yes |
| russian-kremlin | compound | compound | town | EUR-EAST | no; shared pack |
| aztec | courtyard | courtyard | town | AM-MESO | no; shared pack |
| inca | compound | compound | town | AM-AND | no; shared pack |
| byzantine-greek | courtyard | courtyard | town | EUR-EAST | no; shared pack |
| venetian-lagoon | frontage | frontage | town | EUR-MED | no; shared pack |
| persian | courtyard | courtyard | town | AS-MIDE | no; shared pack |
| ottoman | courtyard | courtyard | town | AS-MIDE | no; shared pack |
| sahel | compound | common | town | AF-SAHEL | no; shared pack |
| hanseatic | frontage | frontage | town | EUR-MED | no; shared pack |
| korean | courtyard | courtyard | town | AS-KOR | no; shared pack |
| wizard-city | compound | compound | institutional | EUR-MED | yes |
| gnomish | compact | compact | town | EUR-MED | yes |
| stilt-town | compound | platform | town | AS-ISL | yes |
| barbarian | inherited | inherited | communal | ATL-CEL | yes |
| barbarian-celtic | compound | compound | communal | ATL-CEL | no; shared pack |
| barbarian-norse | inherited | inherited | communal | EUR-NOR | no; shared pack |
| norse-ringfort | compound | compound | communal | EUR-NOR | no; shared pack |
| maya | compound | compound | town | AM-MESO | no; shared pack |
| khmer | compound | compound | town | AS-SEA | no; shared pack |
| celtic-oppidum | inherited | inherited | communal | ATL-CEL | no; shared pack |
| orcish | compound | compound | communal | ATL-CEL | yes |
| halfling | inherited | inherited | communal | EUR-MED | yes |
| kraal | compound | compound | communal | AF-SOUTH | no; shared pack |
| native-iroquoian | compound | compound | communal | AM-WOODS | no; shared pack |
| native-pueblo | compact | compact | town | AM-PUEB | no; shared pack |
| native-plains | inherited | inherited | communal | AM-WOODS | no; shared pack |
| nomad-camp | compound | compound | communal | AS-STEP | yes |
| swahili-stone-town | courtyard | courtyard | town | AF-EAST | no; shared pack |
| drow-enclave | courtyard | courtyard | town | AS-MIDE | yes |
| duergar-hold | compact | compact | town | EUR-EAST | yes |
| myconid-colony | compound | compound | communal | AM-TROP | yes |
| egyptian-planned | compact | compact | town | AF-NILE | no; shared pack |
| nubian-fortified | compound | compound | town | AF-NILE | no; shared pack |
| mesopotamian | courtyard | courtyard | town | AS-MIDE | no; shared pack |
| levantine-tell | courtyard | courtyard | town | AS-MIDE | no; shared pack |
| oasis-caravan | courtyard | courtyard | town | AS-STEP | no; shared pack |
| ksar-oasis | courtyard | courtyard | town | AF-MAG | no; shared pack |
| yoruba | compound | compound | town | AF-WEST | no; shared pack |
| himalayan-terraces | compact | compact | town | AS-HIM | no; shared pack |
| newar | courtyard | courtyard | town | AS-HIM | no; shared pack |
| indus-planned | compact | compact | town | AS-IND | no; shared pack |
| javanese-courts | compound | compound | institutional | AS-ISL | no; shared pack |
| mississippian | compound | compound | town | AM-MISS | no; shared pack |

The core produces neutral placement intents with cadastral/buildable polygons and holes, actual street contacts, cultural pack/mode/period, stable IDs and sampled physical ground altitude/gradient. They are passed to houses in a coarse call. Terrain and building metres are independent of camera, style and vertical exaggeration. Actual neighbouring building geometry is not invented before buildings exist; the first batch has no occupied-neighbour footprints.

## Rural continuity

The existing TypeScript countryside generator remains in use. Its adapter preserves applied site archetype/offers, culture and known programme resources/profile metadata. Rural cover currently uses site geography and culture, not an invented resource economy. Explicitly agricultural profiles can generate the existing TypeScript farmsteads along real rural access; their lots remain outside the retained urban footprint. Other profiles retain cover without adding those farm buildings. Open fringe reserves may receive rural cover; programme reservations remain protected. Modern `structure.allocated` and legacy quarter footprints both observe this distinction.

## Determinism, scale and limitations

Allocation uses no random global state. Ranking tie breaks use stable parcel IDs and demand IDs; graph candidates use deterministic ordered sets. Geometry is full-resolution, independent of view LOD. The spatial grid avoids a global all-pairs neighbour scan but very large overlapping bounding boxes can still increase candidate work. No performance budget is claimed before a measured browser replay.

Cultural admission dimensions in the urban core come from a versioned table generated by the houses engine from resolved minimal native plans, with the placement path's 0.3 m clearance on both sides. The physical envelope bounds bodies, courts, circulation, enclosures, supports and roofs. A recipe whose minimal skeleton or access is refused is excluded from urban selection. The core includes this small table rather than the architectural catalogue or house-generation code. The table also carries source eras and floor ranges. Era A/M/any filters the supported native sources before reservation and cadastral cuts; a missing route leaves an explicit residual and deficit. Selection prefers native sources whose minimum is at most two levels. Native placement requests choose one level for communal/village housing and workshops/warehouses, two for dense town housing and collective functions, clamped within the actual recipe range. Explicit UI floor choices remain native recipe overrides and undergo its admission. The selected recipe ID is pinned in placement requests, so the same resolved source envelope guides subdivision and building generation. The table records its recipe-source SHA-256 and deterministic construction seed; the native houses drift regression regenerates and compares the table. It describes minimal default bundles, not every possible random variant or imposed floor/typology override, which still undergo final admission. These catalogue ranges remain prototype descriptions, not historical measurements. The separate houses admissibility API exposes every recipe range. Final houses placement can refuse a theoretically allocated parcel, leaving a real built-capacity deficit. This delivery does not establish universal historical density, production chains, transport capacity or household occupancy.

## Reproduction and validation

From `rust/`: `cargo test -p magna-urbis-core --lib urban::programme`, and `cargo test -p magna-urbis-core --lib urban::culture`.

The compact `programme-case` fixture is flat, with three 20 x 30 m blocks on a 10 m street at y=105 m, centre (150,130), population 600 and culture `european-organic`. Roles agricultural/crossroads/riverine/artisan produce distinct requests; the artisan case knows `ore`; a port with no explicit navigability retains a warehouse deficit. Tests also check reservation-before-cuts, unchanged parcel geometry, two-pass replay, strict borrowing refusal, real boundary adjacency, short-street segmentation, interior holes, inaccessible slivers, stale cultural witnesses, narrow private gates and separate real built/open capacity. Duplicate or contradictory outcomes and open surfaces outside their parcel are refused. These are executable method examples, not historical calibration.

Native API replay from `web/`: `node scripts/urban_native_api_check.mjs path/to/magna-urbis-local.exe`. The script starts its own process on a free port, verifies retained-raster quarters/parcels/programme/buildingSites/placement/builtCapacity/enrich and contextual era/mode/lore behaviour, then stops only that process. Reports go to ignored `out/urban-native/`.

Primary implementation sources: [programme and allocation](../../rust/crates/core/src/urban/programme.rs), [explicit culture map](../../rust/crates/core/src/urban/culture.rs), [placement intents](../../rust/crates/core/src/urban/building_sites.rs), [resolved admission table](../../rust/crates/houses/data/urban-admission.json), [architectural catalogue](../../rust/crates/houses/data/recipes.json), and [houses placement](../../rust/crates/houses/src/placement.rs). The method is an original bounded adaptation of existing project geometry and catalogue data; it does not claim to reproduce a published land-use model.

## Applied snapshot transfer

Urban crops and returns translate world-space cadastral contacts, reservations, building footprints, roof footprints, levels, foundations, meshes, structural features and cameras. They preserve physical z, vectors, normals, materials and opaque local `resolved` architecture. A portable Urban snapshot removes a procedural CASE selector so replay opens the applied payload. Ordinary procedural URLs retain their CASE. The return replaces only the selected city, retaining other cities' parcels and buildings even when the returned city has quarters only. An isolated fixture cannot overwrite an applied city. URLs and option synchronisation carry settings and seeds; `.decor` and portable Urban or Settlements recipes retain the applied scene. Settlements capture takes the current applied sites, routes and urban snapshot, including the camera, rather than an earlier terrain import. When such a city exists, its exact raster and scene are embedded even if the terrain has a procedural regeneration recipe. A Settlements state without an applied city keeps the existing procedural replay. Tests: `npx vitest run --project fast tests/urban.snapshot.test.ts tests/urban.landuse.test.ts` from `web/`.
