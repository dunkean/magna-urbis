# World atlas of settlement morphologies and architectural styles
## Style reference for a historical or fantasy city mapper (Antiquity → 15th century)

> **Purpose:** select a **settlement tradition** and produce **building footprints** visually recognizable by layout, plan, volume, roof, load-bearing system, and materials. This complements the functional building catalog; it does not repeat trades or facilities.
>
> **Scope:** worldwide, favoring forms attested before the 16th century; traditions whose best-preserved examples are later are clearly marked. **This is not a literally exhaustive inventory of every culture**, but deliberately broad worldwide coverage organized for implementation.

> The [original French edition](styles_architecturaux_mondiaux_city_mapper_FR.md) is preserved for reference.

## How to use: four scales, not one “style”

1. **Culture / period / environment:** limits possible historical combinations. A region never implies a single style.
2. **Settlement morphology:** roads and paths, parcel pattern, center organization, enclosures, squares, terraces, access to water.
3. **Complex morphology:** family property with several huts, city block, *siheyuan*, *kancha*, palace court, longhouse and outbuildings.
4. **Building morphology:** footprint, floors, structure, infill, roof, and details (at minimum legible in a 2D plan).

**Development order — not a hierarchy of civilizations:**

- **P0 — Essential:** high-yield primitives reusable worldwide.
- **P1 — Regional essential:** architectural identity needed to recognize a tradition.
- **P2 — Distinctive:** more variety and historical/cultural specificity.
- **P3 — Rare / advanced:** complex architecture, exceptional sites, constrained uses, borderline periods.

**Time convention:** `A` = local Antiquity; `M` = medieval period / local equivalent before ~1500; `T` = long tradition or broad dating; `L` = **characteristic attestation mainly after 1500**, *late / fantasy* option (do not use by default in the pre-Renaissance corpus). Cultural names contextualize models, **not** assign one form to a people. Some buildings known today are later reconstructions.

**Reading the tables:** descriptions are **top-down generation presets**, not guaranteed archaeological plans. When roof or elevation details are hypothetical for a period, they must remain configurable or simplified.

---

# I. Universal morphological grammar

## I.1. Settlement morphologies independent of cultures

| Priority | ID | Morphology | Geometry / map constraints |
| --- | --- | --- | --- |
| P0 | `SET-NUCLEATED` | Nucleated village | Dwellings grouped around center, radial streets, irregular parcels. |
| P0 | `SET-DISPERSED` | Dispersed settlement | Distant houses, agricultural parcels, access paths. |
| P0 | `SET-LINEAR` | Street village | Footprints aligned on axis; elongated perpendicular parcels. |
| P0 | `SET-RIVER` | Riverside village | Ribbon of dwellings, landings, crossings, and banks. |
| P0 | `SET-CLUSTER` | Clustered hamlets | A few connected nuclei; cultivated spaces between them. |
| P0 | `SET-RADIAL` | Radial village | Access radiates from square, well, or central enclosure. |
| P0 | `SET-IRREGULAR` | Organic fabric | Curving lanes and dead ends, variable block sizes. |
| P0 | `SET-GRID` | Orthogonal city | Hierarchical axes, near-right-angle intersections, repeatable blocks. |
| P0 | `SET-HILL` | Hilltop village | Contours, terraces, walls, switchback access. |
| P0 | `SET-WALLED` | Enclosed town | Defensive boundary and gates constrain through-axes. |
| P0 | `SET-COURTYARDS` | Compound fabric | Enclosures with several small volumes around courts. |
| P0 | `SET-COASTAL` | Coastal settlement | Quay/landing beach, siting set back from inundation. |
| P1 | `SET-AXIAL` | Axial capital | Major ceremonial axis, gate sequences, nested enclosures. |
| P1 | `SET-MULTICORE` | Polycentric city | Multiple squares/powers/nodes, autonomous districts. |
| P1 | `SET-CIRCULAR` | Concentric enclosures | Circular palisades/courts, limited entrances, peripheral volumes. |
| P1 | `SET-TERRACE` | Terraced settlement | Retaining walls, stairs, blocks follow contours. |
| P1 | `SET-CANAL` | Canal city | Hierarchical navigable canals, bridges, quays, irregular blocks. |
| P1 | `SET-OASIS` | Oasis city | Compact core, irrigation, palm grove, farmland, water point. |
| P1 | `SET-CEREMONIAL` | Ritual-center city | Esplanades and monumental complexes, separate peripheral housing. |
| P1 | `SET-COMPOUND` | Family-compound village | Fenced properties with main building and outbuildings. |
| P1 | `SET-MOUND` | Platform center | Artificial mounds, esplanades, dominant buildings, surrounding dwellings. |
| P1 | `SET-PASTORAL` | Pastoral village | Water points, fodder stores, livestock, pasture access. |
| P2 | `SET-WATER-STILT` | Stilt village | Walkways and quays, buildings on shallow water or floodable banks. |
| P2 | `SET-FLOATING` | Floating village | Dwellings on moored rafts/boats; anchors and channels. |
| P2 | `SET-CLIFF` | Cliff settlement | Niches, shelters, adjoining dwellings; constrained vertical circulation. |
| P2 | `SET-SUBTERRANEAN` | Rock-cut settlement | Excavations, sunken patios, stairs, light wells. |
| P2 | `SET-ISLANDS` | Artificial-island city | Dikes, raised ground, canals between built units. |
| P2 | `SET-NOMAD` | Mobile camp | Circle/line of tents or yurts, clear spaces, seasonal mobility. |
| P2 | `SET-TERRESTRIAL-RITUAL` | Diffuse ritual landscape | Villages separate from sanctuary, mounds, or ceremonial enclosures. |
| P3 | `SET-LAKE` | Lake city | Dikes, causeways, canals, productive shores. |
| P3 | `SET-VERTICAL` | Tower-house city | Very dense narrow plots, compact access, multiple levels. |
| P3 | `SET-NESTED-CITADEL` | Adjacent autonomous citadels | Large enclosed blocks, successive courts, selective paths. |
| P3 | `SET-MEGAHOUSE` | Giant-house settlement | One or a few communal buildings hold most dwellings. |
| P3 | `SET-ICE` | Polar winter camp | Small units separated by snow/winds, seasonal access. |

## I.2. Parcel and complex forms

| Priority | ID | Form | 2D interpretation |
| --- | --- | --- | --- |
| P0 | `LOT-STRIP` | Strip / deep parcel | Narrow frontage, rear court and outbuildings. |
| P0 | `LOT-BLOCK` | Dense built block | Joined volumes and residual internal court(s). |
| P0 | `LOT-COMPOUND` | Domestic compound | Fence distinct from roofs and subordinate buildings. |
| P0 | `LOT-CENTRAL-YARD` | Central courtyard | Structuring void bordered on two to four sides. |
| P0 | `LOT-FARM` | Rural compound | Court, barns, garden, small pen, crops. |
| P1 | `LOT-ATRIUM` | Atrium house | Open internal central court with perimeter roof. |
| P1 | `LOT-PERISTYLE` | Porticoed court | Open court, surrounding roofed gallery. |
| P1 | `LOT-SIHEYUAN` | Axial Chinese courtyard | Pavilions around court, north/south hierarchy. |
| P1 | `LOT-KANCHA` | Andean kancha | Several rectangular rooms within one perimeter wall. |
| P1 | `LOT-KRAAL` | Pastoral compound/enclosure | Circular/elliptical fence, central or associated livestock pen. |
| P1 | `LOT-LONGHOUSE` | Great communal house | Elongated footprint and internal hearths or bays. |
| P1 | `LOT-PLATFORM` | Platform complex | Buildings on shared slab/terrace. |
| P2 | `LOT-MULTIYARD` | Cascading courts | Entrance court → family court → private court sequence. |
| P2 | `LOT-TRIANGLE` | Corner parcel | Irregular building constrained by converging roads. |
| P2 | `LOT-CLIFF` | Cliff terrace | Narrow circulation strip and backing against rock. |
| P2 | `LOT-WATER` | Stilt island | Platform, walkway, access by water. |
| P3 | `LOT-RING` | Ring house with court | Continuous inhabited ring, one entrance, central court. |
| P3 | `LOT-CELLULAR` | Cellular complex | Rooms added across generations, few true streets. |

## I.3. Building-form library (*building primitives*)

### Footprints

| Priority | ID | Footprint | Procedural construction |
| --- | --- | --- | --- |
| P0 | `FP-ROUND` | Circular | Polygonal disk; radius, oriented opening, possible ring. |
| P0 | `FP-OVAL` | Oval | Ellipse, generally marked longitudinal orientation. |
| P0 | `FP-SQUARE` | Square | Four orthogonal walls, possible awning. |
| P0 | `FP-RECT` | Rectangular | Configurable ratio, common for dwellings and halls. |
| P0 | `FP-LONG` | Very elongated | Longhouse, hall, basilica; repeated bays. |
| P0 | `FP-L` | L-shaped | Two wings, courtyard open on two sides. |
| P0 | `FP-U` | U-shaped | Three wings frame courtyard. |
| P0 | `FP-COMPLEX` | Composite / additive | Union of several touching or separate rectangles. |
| P1 | `FP-COURT` | Ring around courtyard | Solid footprint minus central void. |
| P1 | `FP-POLYGON` | Polygonal | Five to twelve sides, dwellings and towers. |
| P1 | `FP-TOWER` | Narrow tower | Square, round, or polygonal footprint; tall. |
| P1 | `FP-APSIDAL` | Apsidal end | Rectangle plus semicircular end. |
| P1 | `FP-TRICONCH` | Trefoil plan | Central volume plus three apses. |
| P1 | `FP-CROSS` | Cross-shaped | Intersection of perpendicular volumes. |
| P1 | `FP-TERRACE` | Superposed terraces | Decreasing nested polygons, axial stairs. |
| P2 | `FP-ELLIPTICAL-RING` | Elliptical ring | Housing and outbuildings around enclosure. |
| P2 | `FP-ROCKCUT` | Excavated | Void subtracted from terrain rather than placed object. |
| P2 | `FP-MULTICELL` | Adjacent cells | Repeated small compact rooms and courtyards. |
| P2 | `FP-CLUSTER-ROUND` | Round-hut group | Three to twelve disks in enclosure. |
| P3 | `FP-IRREGULAR` | Irregular curved footprint | Construction fitted to terrain and rocks. |

### Volumes and roofs

| Priority | ID | Silhouette | Useful parameters |
| --- | --- | --- | --- |
| P0 | `RF-CONE` | Conical | Eaves radius, pitch, tip, thatch. |
| P0 | `RF-GABLE` | Gable | Ridge direction, pitch, overhangs, gables. |
| P0 | `RF-HIP` | Hipped | Pitches, hips, ridge height. |
| P0 | `RF-FLAT` | Flat terrace | Parapet, access, drainage. |
| P0 | `RF-SHED` | Lean-to | Single slope; secondary buildings. |
| P0 | `RF-DOME` | Dome/hemisphere | Radius, possible oculus, covering. |
| P0 | `RF-THATCH-VAULT` | Vegetal barrel | Curved roof on flexible frame. |
| P1 | `RF-VAULT` | Barrel vault | Vault axis, closed/open ends. |
| P1 | `RF-CROSSVAULT` | Groin vault | Orthogonal intersection. |
| P1 | `RF-STEP` | Stepped volumes | Terraces/plan reductions by level. |
| P1 | `RF-EAVES` | Large eaves | Overhang and perimeter gallery. |
| P1 | `RF-CURVED` | Upturned roof edges | Curved slope, upturned hips, tiles; **not universal in Asia**. |
| P1 | `RF-TIERED` | Multiple stacked roofs | Two to five pavilions with decreasing footprints. |
| P1 | `RF-REED-HIP` | Steep vegetal hip | Tall thatch volume, wide overhang. |
| P1 | `RF-TENT` | Conical textile cover | Poles, canvas/felt, dismountable assembly. |
| P2 | `RF-SADDLE` | Saddle / upturned ends | Longitudinal curve, saddle ridge. |
| P2 | `RF-GAMBREL` | Two broken slopes | Rare/chronologically filtered before modern period. |
| P2 | `RF-DOME-CONE` | Dome on drum | Circular/polygonal drum, dome. |
| P2 | `RF-STEEP-STEP` | Stepped gable | Stepped facade profile. |
| P2 | `RF-MULTIPAV` | Interlocking roofs | Several orthogonal bodies, multiple junctions. |
| P3 | `RF-SNOW` | Snow vault | Seasonal Arctic dwelling. |
| P3 | `RF-SHELL` | Vegetal shell | Large curved thatch sheet on wood/bamboo arches. |

### Structure and materials: **do not merge load-bearing structure with infill**

| Priority | Code | Technique / material | Structural rendering / typical use |
| --- | --- | --- | --- |
| P0 | `MAT-WATTLE-DAUB` | Wattle and daub | Posts/branches coated in earth; many regions. |
| P0 | `MAT-COB` | Cob (mass earth) | Thick walls shaped in layers, earthen plaster. |
| P0 | `MAT-ADOBE` | Adobe / mud brick | Dried-earth blockwork, load-bearing walls. |
| P0 | `MAT-RAMMED-EARTH` | Rammed earth | Earth walls compacted in formwork. |
| P0 | `MAT-MUD-PLASTER` | Earthen plaster | Finish, repairs, pigments, decorative relief. |
| P0 | `MAT-TIMBER-POST` | Timber posts/beams | Timber frame, independent or filled walls. |
| P0 | `MAT-LOG` | Stacked wood / logs | Horizontal trunks, joined corners. |
| P0 | `MAT-STONE-DRY` | Dry stone | Unmortared rubble, often local stone. |
| P0 | `MAT-STONE-MORTAR` | Rubble masonry | Stone and mortar; load-bearing walls. |
| P0 | `MAT-STONE-ASHLAR` | Ashlar | Regular courses, costly/monumental. |
| P0 | `MAT-THATCH` | Grass thatch | Thick roof covering, good pitch. |
| P0 | `MAT-REED` | Reeds / rushes | Roofing, hurdles, panels. |
| P0 | `MAT-TILE-CLAY` | Fired clay tiles | Adequate pitch and ceramic supply. |
| P0 | `MAT-WOOD-SHINGLES` | Wooden shingles | Forest regions, pitched roofs. |
| P0 | `MAT-SLATE` | Slate / stone slabs | Stone plates, heavy roofs. |
| P1 | `MAT-HALF-TIMBER` | Exposed timber framing | Visible load-bearing grid plus daub/brick. |
| P1 | `MAT-BURNT-BRICK` | Fired brick | Brickwork and mortar; specialized production. |
| P1 | `MAT-BAMBOO` | Bamboo | Frame, split strips, woven walls. |
| P1 | `MAT-PALM` | Palm fronds | Roofing, mats, walls, light beams. |
| P1 | `MAT-RAISED-POST` | Wooden piles/stilts | Raised floor for flooding/ventilation. |
| P1 | `MAT-PLASTER-LIME` | Lime/stucco | Water-repellent/decorative plaster on mineral support. |
| P1 | `MAT-CORAL` | Coral limestone | Tropical coastal masonry, lime mortar. |
| P1 | `MAT-BASALT` | Basalt | Rubble or large blocks, islands/volcanoes. |
| P1 | `MAT-BARK` | Bark | Shingles, roofing, cladding. |
| P1 | `MAT-FELT` | Felt | Textile yurt covering; non-load-bearing. |
| P1 | `MAT-HIDE` | Hides | Tent membrane and nomadic shelters. |
| P1 | `MAT-TURF` | Peat / turf sods | Insulation, cold-region walls and roofs. |
| P2 | `MAT-CHALK` | Chalk | Regional rubble/plaster. |
| P2 | `MAT-SHELLSTONE` | Shellstone | Coastal masonry. |
| P2 | `MAT-CLINKER` | Scoriaceous volcanic rock | Local lightweight masonry. |
| P2 | `MAT-ICE-SNOW` | Compacted snow | Cut blocks, temporary dome. |
| P2 | `MAT-MEGALITH` | Megalithic monoliths | Platforms, thresholds, tombs, pillars. |
| P2 | `MAT-WOOD-MORTISE` | Complex timber joinery | Mortise-and-tenon joints, brackets, elaborate frames. |
| P3 | `MAT-ROCKCUT` | Rock excavation | Material subtracted from natural terrain. |
| P3 | `MAT-DRIFTWOOD` | Driftwood | Framing in treeless Arctic regions. |

### Minimal assemblies / elevations

| Priority | Prototype | Map-readable example |
| --- | --- | --- |
| P0 | **Round + daub + thatch cone** | Round hut with one door, central chimney/hearth. |
| P0 | **Rectangle + posts/daub + gable roof** | One-story house or workshop, gable to street. |
| P0 | **Rectangle + stone walls + gable roof** | Masonry house with shingles, tiles, or stone slabs. |
| P0 | **Square + adobe + roof terrace** | Dry-climate house with small openings. |
| P0 | **Several buildings + courtyard + fence** | Family compound, shared court. |
| P0 | **Long volume + hipped roof** | Large communal dwelling, hall, or barn. |
| P1 | **Round + wattle + domed thatch roof** | Rondavel or dwelling of a major vegetal tradition. |
| P1 | **Rectangle + timber stilts + steep roof** | Humid tropical dwelling, exterior stairs. |
| P1 | **Rectangle + timber + projecting floor + tile roof** | Merchant house in dense town. |
| P1 | **Square + central court + galleries** | Mediterranean, Persian, Indian, or Chinese house by configuration. |
| P1 | **Dry stone + grouped terraced rectangles** | Andean, mountain Mediterranean, or Pueblo dwelling. |
| P1 | **Timber + 2–3 superposed pavilions + upturned edges** | Prestigious East Asian building; cultural/chronological control. |
| P1 | **Elongated hut with curved vegetal roof** | Communal house on arches and posts. |
| P1 | **Saddle-roof house** | Toraja / island variant signature, never “all Asia.” |
| P2 | **Earthen tower + flat roof** | Vertical dry-region dwelling, massive walls. |
| P2 | **Continuous wall circle + inner court** | *Tulou* or inhabitable enclosure, late depending on preset. |
| P2 | **Hypostyle hall + flat / terraced roof** | Monument with regular column grid. |
| P2 | **Excavated house + sunken court** | Rock-cut dwelling, specific top-down views. |
| P3 | **Basalt-log architecture on islets** | Insular Micronesian megalithic complexes. |

**Key rule:** a universal form (“round hut”) is not a complete cultural style; it becomes an identifiable tradition through **plot organization, proportions, roof system, fences, materials, and social distribution of buildings**.

---


# II. Cultural settlement and building packs

**Settlement columns:** priority, name, **place plan**, environment/time. **Building columns:** priority, type, **plan/volume**, **structure/walls**, **roof/finishes**. Entries run from most useful to most specialized **within each region**.

## 01. Ancient Mediterranean — Greece, Rome, Phoenicia, and Etruria `MED-ANT`

**Scope and signature:** A → Late Antiquity. *Polis* streets, Roman public axes, patios and peristyles, adjoining stone/brick houses, tile roofs. Do not confuse a military **castrum** with every Roman city.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `MED-ANT-S01` — **Compact Greek polis** | Upper acropolis + lower agora, hillside streets, irregular fabric | Mainland Greece, Aegean islands, A |
| P1 | `MED-ANT-S02` — **Hippodamian polis** | Orthogonal network, residential blocks, reserved agora | Greek colonies and planned foundations, A |
| P1 | `MED-ANT-S03` — **Regular-grid Roman colony** | Two structuring axes and forum, rectangular blocks | Founded/replanned city, A |
| P1 | `MED-ANT-S04` — **Roman vicus** | Merchant street village, built strips on both sides | Along roads and frontier posts, A |
| P1 | `MED-ANT-S05` — **Castrum and canabae** | Hierarchical defensive rectangle + external merchant suburb | Garrison present, A |
| P1 | `MED-ANT-S06` — **Phoenician/Punic port** | Harbor basin, waterfronts and terraces, merchant cores | Mediterranean coasts, A |
| P2 | `MED-ANT-S07` — **Ancient Greek island village** | Small rocky terraces, tight lanes, clustered buildings | Cyclades and other islands, A; avoid modern clichés |
| P2 | `MED-ANT-S08` — **Rural villa estate** | Courtyard complex + outbuildings and agricultural parcels | Romanized countryside, A |
| P3 | `MED-ANT-S09` — **Etruscan hill city** | Defensive plateau, streets, peripheral burial complexes | Central Italy, A |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `MED-ANT-B01` — **Ancient masonry house** | One- or two-level rectangle, sometimes attached | Rubble/mud or fired brick, plaster | Two tile slopes or flat roof by region |
| P1 | `MED-ANT-B02` — **Atrium domus** | Nearly square envelope, light-giving inner court | Masonry walls, posts and colonnades | Tile slopes toward impluvium |
| P1 | `MED-ANT-B03` — **Peristyle domus** | Hall and rooms around large porticoed court | Brick/stone and columns | Tiles, perimeter gallery |
| P1 | `MED-ANT-B04` — **Urban insula** | Large attached rectangular block, potentially several floors | Brick, masonry, timber frame | Tiles, ground-floor shops, courts/stairs |
| P1 | `MED-ANT-B05` — **Greek courtyard house** | Rectangle with rooms around patio | Mud brick on stone foundation | Low pitch or tiles, partial gallery |
| P1 | `MED-ANT-B06` — **Stoa / columned portico** | Long linear building, one open facade | Stone or wooden posts/columns | Regular pitched roof, rhythmic bays |
| P1 | `MED-ANT-B07` — **Civic basilica** | Large rectangular nave with column rows | Masonry and long-span timber frame | Elongated tiered roof or high attic |
| P2 | `MED-ANT-B08` — **Punic patio house** | Compact volume and distributing court | Stone, plaster, wooden elements | Terraces and slabs, local context |
| P2 | `MED-ANT-B09` — **Roman vaulted hall** | Rectangle and barrel/groin vault bay grid | Brick/ancient concrete and stone | Vaults visible on large masses |
| P2 | `MED-ANT-B10` — **Tholos / rotunda** | Circular plan with or without surrounding columns | Ashlar | Conical roof or dome by monument |
| P3 | `MED-ANT-B11` — **Colonnaded terrace villa** | Several U-shaped wings around esplanade | Decorated masonry, galleries | Tiles at multiple heights |
| P1 | `MED-ANT-B12` — **Compact Roman dwelling over shop — inspired envelope** | One closed rectangle, two floors, no central court; artistic dimensions, unknown capacity | Plastered brick masonry, timber frame; no certified internal shop | Proposed tile gable; artistic form and pitch |
| P1 | `MED-ANT-B13` — **Small Roman street apartment building — inspired envelope** | One closed body, two floors by default, 3/4 variants; rear court and side passage; artistic dimensions, unknown capacity | Plastered brick, timber frame; generic shared distribution without certified apartments | Proposed tile gable; no automatic burgage infill |

## 02. Atlantic and Celtic Europe — Iron Age, castros, oppida `ATL-CEL`

**Scope and signature:** A → early M. Defensive hill villages, roundhouses in some Atlantic regions, but also rectangular houses and stone dwellings; the “round Gaulish hut” is not a universal model.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `ATL-CEL-S01` — **Roundhouse hamlet** | Spaced disks, gardens/hearths, organic paths | British Isles and Atlantic regions, A |
| P1 | `ATL-CEL-S02` — **Fortified oppidum** | Large enclosed plateau, internal routes, craft districts | Celtic Europe and neighbors, late A |
| P1 | `ATL-CEL-S03` — **Atlantic castro** | Enclosed summit or slope, close round/oval huts | Northwest Iberia, Iron Age |
| P1 | `ATL-CEL-S04` — **Earthen-enclosure village** | Grouped dwellings, peripheral ditch/palisade | Temperate Europe, A |
| P2 | `ATL-CEL-S05` — **Lake crannog** | Small artificial island and walkway/landing | Scotland, Ireland, A/M |
| P2 | `ATL-CEL-S06` — **Rock-terrace village** | Adjoining stone houses and narrow courts | Oppida or rocky hills, A |
| P2 | `ATL-CEL-S07` — **Coastal Brittonic village** | Dispersed dwellings behind low walls and enclosures | Atlantic coasts, A/M |
| P3 | `ATL-CEL-S08` — **Broch site** | Massive tower dominates enclosure and small buildings | Northern Scotland, Iron Age |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `ATL-CEL-B01` — **Daub roundhouse** | Simple disk/oval, one level | Posts, wattle, daub | Thick thatch cone |
| P1 | `ATL-CEL-B02` — **Stone-based roundhouse** | Thick-walled disk, one opening | Dry stone below, light frame above | Thatch cone or vegetal covering |
| P1 | `ATL-CEL-B03` — **Long farm house** | Elongated rectangle, internal divisions | Timber/earth on stone footing | Thatch gable |
| P1 | `ATL-CEL-B04` — **Attached castro house** | Round, oval, or rectangle in irregular block | Granite/rubble masonry | Thatch or local covering |
| P1 | `ATL-CEL-B05` — **Raised granary** | Small separate rectangle or four legs | Timber on bases, light walls | Small steep vegetal roof |
| P2 | `ATL-CEL-B06` — **Rectangular oppidum building** | Dense rectangle, street frontage | Timber and earth or stone | Gable roof, rear court |
| P2 | `ATL-CEL-B07` — **Shell-roof hut** | Short rectangle or oval | Wooden hoops/posts | Continuous rounded reed roof |
| P3 | `ATL-CEL-B08` — **Scottish broch** | Thick circular tower with double facing | Monumental dry stone | Masonry crown; high roof debated |
| P3 | `ATL-CEL-B09` — **Dry-stone corbelled cell** | Small circular/oval plan | Receding dry-stone courses | Stone false dome |


## 03. Medieval western and central Europe — France, Empire, Italy, Christian Iberia `EUR-MED`

**Scope and signature:** M. Fundamental variation among clustered towns, planned subdivisions, timber-framed houses, stone cities, mountains, and countryside. One “European village” style is insufficient.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `EUR-MED-S01` — **Compact village around a church** | Square or forecourt, radiating lanes, deep parcels | Rural western Europe, M |
| P0 | `EUR-MED-S02` — **Commercial street town** | Single merchant street, tight frontages, rear courts | Roads and crossings, M |
| P1 | `EUR-MED-S03` — **Organic medieval city** | Densified irregular blocks, hierarchical streets, multiple walls | Long growth, M |
| P1 | `EUR-MED-S04` — **Bastide / new town** | Grid adapted to terrain, market square, repeated plots | Western Europe, chiefly 13th–14th centuries |
| P1 | `EUR-MED-S05` — **Castle town** | Overlooking castle and dense hillside housing | Plateaus, spurs, M |
| P1 | `EUR-MED-S06` — **Alpine village** | Strips along torrent, terraces, raised outbuildings | Mountain ranges, M |
| P2 | `EUR-MED-S07` — **Germanic street village with strips** | Long agricultural plots behind street houses | Planned agrarian settlement, M |
| P2 | `EUR-MED-S08` — **Arcaded merchant town** | Aligned facades and continuous porticoes | Italy and regional trading centers, M |
| P2 | `EUR-MED-S09` — **Italian tower-house city** | Narrow plots and towers in massive blocks | Communal cities, 11th–14th centuries |
| P2 | `EUR-MED-S10` — **Circular village around castle** | Road rings and parcel crowns | Regional examples, M |
| P3 | `EUR-MED-S11` — **Stepped hilltop village** | Stairs, adjoining houses, party walls | Rocky Mediterranean areas, M |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `EUR-MED-B01` — **Rectangular thatched cottage** | One-story rectangle, sometimes gable to street | Wattle/daub or rubble | Two thatch slopes |
| P0 | `EUR-MED-B02` — **Narrow attached house** | Short street frontage, deep, one to three floors | Timber and earth, stone or brick | Gable roof, ridge often perpendicular to street |
| P1 | `EUR-MED-B03` — **Jettied timber-framed house** | Rectangle, upper floor projects over street | Exposed timber frame, earth/brick infill | Tile/slate, sometimes carved gable |
| P1 | `EUR-MED-B04` — **Village stone house** | One- or two-story rectangle, added lean-tos | Rubble, lime, small openings | Gable roof in tiles or stone slabs |
| P1 | `EUR-MED-B05` — **Merchant hall-house** | Ground-floor shop row, dwelling above | Timber/stone, arcades or piers | Gable or parallel ridge, tiles |
| P1 | `EUR-MED-B06` — **U-shaped or quadrilateral farm court** | Broad courtyard bordered by long volumes | Rubble/timber frames | Large gable roofs |
| P1 | `EUR-MED-B07` — **Fortified house with tower** | Rectangular block and stair/watch tower | Massive stone and loopholes | Steep roof or crenellated terrace |
| P2 | `EUR-MED-B08` — **Tuscan tower house** | Small square, three to six floors, urban density | Ashlar | Masonry crown or low roof |
| P2 | `EUR-MED-B09` — **Italian portico house** | Row rectangle, open ground floor | Stone/brick, columns and vaults | Ridge parallel to street |
| P2 | `EUR-MED-B10` — **Alpine house with mixed base** | Broad rectangle, timber upper floor on mineral base | Stone ground floor, logs/timber above | Large overhanging shingle/stone-slab roof |
| P2 | `EUR-MED-B11` — **Stepped-gable house** | Urban rectangle with stepped facade | Brick and stone | Gable roof hidden by steps |
| P2 | `EUR-MED-B12` — **Thatched longhouse** | Very elongated rectangle, open courtyard | Rubble/daub/timber | Very long two-slope vegetal roof |
| P3 | `EUR-MED-B13` — **Bridge dwelling** | Volume built over arch/watercourse access | Stone and timber | Connected roofs, hydraulic foundations |

## 04. Scandinavia, Iceland, Baltic, and medieval Norse world `EUR-NOR`

**Scope and signature:** late A → M. Longhouses, logs, turf in treeless regions, stacked wood and detached buildings. Danish circular fortress form is not an ordinary village model.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `EUR-NOR-S01` — **Longhouse hamlet** | Parallel long volumes, courts and small granaries | Agropastoral Scandinavia, A/M |
| P1 | `EUR-NOR-S02` — **Norse coastal village** | Houses face fjord or anchorage, yards/boats | Scandinavia and North Atlantic, M |
| P1 | `EUR-NOR-S03` — **Icelandic turf farm** | Court surrounded by low volumes, sheltered from wind | Iceland, M |
| P1 | `EUR-NOR-S04` — **Norse port trading post** | Narrow parcel row facing quay | Norse trading towns, M |
| P1 | `EUR-NOR-S05` — **Forest log village** | Compact volumes with enclosures, central road | Baltic and Nordic forests, M |
| P2 | `EUR-NOR-S06` — **Seasonal Sámi camp** | Spaced tents, shared shelter, variable reindeer pen | Northern Fennoscandia, T |
| P2 | `EUR-NOR-S07` — **Promontory enclosure/fort** | Buildings protected by stone/timber rampart | Coasts and islands, A/M |
| P3 | `EUR-NOR-S08` — **Viking ring fortress** | Large circular rampart, regular internal geometry | Denmark, 10th century, military |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `EUR-NOR-B01` — **Norse longhouse** | Very long rectangle with aisle or longitudinal hearth | Posts and wood, possible stone footings | Large thatch/turf gable roof |
| P1 | `EUR-NOR-B02` — **Stacked-log house** | Compact rectangle, one or two floors | Crossed-corner logs | Gable, shingles/turf |
| P1 | `EUR-NOR-B03` — **Icelandic turf-gabled house** | Several narrow parallel rectangles | Stone/turf and timber frame | Heavy vegetated roof |
| P1 | `EUR-NOR-B04` — **Coastal boathouse** | Very long volume open toward sea | Posts, local stone or timber | Low gable, wide entrance |
| P1 | `EUR-NOR-B05` — **Raised Nordic granary** | Small square/rectangle on posts | Stacked timber or framing | Shingled gable roof |
| P2 | `EUR-NOR-B06` — **Early stave church** | Rectangular nave and sometimes tall central core | Massive timber posts, sophisticated joints | Steep superposed roofs (stave church, M) |
| P2 | `EUR-NOR-B07` — **Sámi kota / goahti** | Low oval or round, narrow entrance | Bent poles or trunks | Canvas, turf, or bark covering |
| P2 | `EUR-NOR-B08` — **Mobile Sámi lavvu** | Pole circle, single interior | Dismountable masts/poles | Textile and hide cone |
| P2 | `EUR-NOR-B09` — **Baltic timber-framed/wooden house** | Rectangle with farm court | Wood, daub, stone by area | Steep gable, vegetation/shingles |
| P3 | `EUR-NOR-B10` — **Terrain-integrated turf house** | Group of connected small parallel rooms | Earth/turf, limited timber frame | Staggered vegetated roofs |

## 05. Eastern Europe, Byzantium, Balkans, and Caucasus `EUR-EAST`

**Scope and signature:** late A → M. Roman-Byzantine traditions intersect with rural timber, mountain stone, and domed monasteries; much later Ottoman styles are not injected retroactively.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `EUR-EAST-S01` — **Forest-clearing village** | Linear streets and dispersed wooden farms | Slavic areas, eastern Europe, M |
| P1 | `EUR-EAST-S02` — **Palisaded Slavic town** | Timber/earth embankments, market road, family courts | Slavic regions, M |
| P1 | `EUR-EAST-S03` — **Byzantine hill city** | Curved sloping lanes, walls and citadel | Balkans, Asia Minor, M |
| P1 | `EUR-EAST-S04` — **Fortified Caucasian stone town** | Dense massive houses, dominant towers | Mountain valleys, M |
| P1 | `EUR-EAST-S05` — **Terraced mountain village** | Retaining walls, stepped lanes | Caucasus, Balkans, M |
| P2 | `EUR-EAST-S06` — **Monastic-sanctuary village** | Building enclosures near domed church | Eastern Europe and Caucasus, M |
| P2 | `EUR-EAST-S07` — **Anatolian rock-cut city** | Surface courts and excavated dwellings | Cappadocia, T |
| P3 | `EUR-EAST-S08` — **Svan tower settlement** | Adjoining houses and many clan towers | Svaneti, Caucasus, M |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `EUR-EAST-B01` — **Izba / forest log house** | Rectangle, one or two floors with porch | Crossed logs and stone footing | Shingled gable |
| P1 | `EUR-EAST-B02` — **Rural gallery house** | Long rectangle, sheltered porch | Timber/earth and local masonry | Tiles or thatch |
| P1 | `EUR-EAST-B03` — **Caucasian stone house** | Compact rectangle around hearth | Thick rubble and wooden beams | Flat or shallow-pitched roof by region |
| P1 | `EUR-EAST-B04` — **Defensive Svan tower** | Small square, multiple floors | Very thick stone masonry | Crown under stone roof |
| P1 | `EUR-EAST-B05` — **Byzantine cross-in-square church** | Square with arms and apse | Brick/stone, masonry vaults | Central dome on drum |
| P1 | `EUR-EAST-B06` — **Byzantine urban house** | Rectangle with courtyard and loggia | Mixed masonry, timber floors | Channel tiles, separate volumes |
| P2 | `EUR-EAST-B07` — **Armenian stone church** | Compact cross or central plan | Ashlar, vaults | Cone/dome on polyhedral drum |
| P2 | `EUR-EAST-B08` — **Georgian cross church** | Nave and arms, central square | Ashlar | Tall dome on polygonal drum |
| P2 | `EUR-EAST-B09` — **Rock-cut house** | Excavated cells + stairs | Soft rock, masonry reinforcement | No separate roof or light awning |
| P3 | `EUR-EAST-B10` — **Rock-cut monastery complex** | Excavated room network with rock facades | Excavation and partitions | Galleries, stairs, staggered thresholds |


## 06. Nile Valley — Pharaonic Egypt, Nubia, Meroë, and Nubian kingdoms `AF-NILE`

**Scope and signature:** A → M (local chronologies). Dense mud brick, tight streets, Nile towns, monumental stone complexes, and villages between river and cultivated land. A pyramid is not a dwelling.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `AF-NILE-S01` — **Nile mud-brick village** | Compact rectangular houses at edge of cultivation | Nile and canal banks, A/T |
| P1 | `AF-NILE-S02` — **Planned Egyptian city** | Rectilinear dense districts, axes to temple/palace | Administrative centers, A |
| P1 | `AF-NILE-S03` — **Nile temple city** | Large sacred precinct, peripheral streets and residences | Egypt, A |
| P1 | `AF-NILE-S04` — **Fortified Nubian town** | Brick/stone wall, block housing | Nubia, Middle Nile, A |
| P1 | `AF-NILE-S05` — **Irrigated agricultural estate** | Courtyard dwelling and granaries on levee | Alluvial land, A/T |
| P2 | `AF-NILE-S06` — **Meroitic town** | Civic/ritual core and brick districts | Ancient Sudan, A |
| P2 | `AF-NILE-S07` — **Egyptian oasis settlement** | Earthen-walled core, irrigation/palm grove | Desert depressions, A/T |
| P3 | `AF-NILE-S08` — **Satellite royal necropolis** | Pyramid tomb group with mortuary temples | Egypt/Nubia, A; **not an inhabited settlement** |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `AF-NILE-B01` — **Egyptian adobe house** | Attached rectangle, one or two floors, court | Plastered mud brick, scarce timber | Flat roof of beams and earth |
| P1 | `AF-NILE-B02` — **Nile courtyard house** | Blocks around open court | Adobe/earthen plaster | Flat terraces, stairs |
| P1 | `AF-NILE-B03` — **Planned workers' housing** | Small repeated rectangles on straight streets | Adobe on uniform grid | Terraces, some light wells |
| P1 | `AF-NILE-B04` — **Cylindrical grain store** | Small cylinders grouped in court | Mud brick | Local earthen dome/vault cover |
| P1 | `AF-NILE-B05` — **Egyptian pylon temple** | Large rectangle of courts and hypostyle halls | Monumental ashlar | Heavy flat roofs, gateway pylons |
| P1 | `AF-NILE-B06` — **Vaulted Nubian house** | Low long rectangle | Self-supporting mud brick | Brick barrel vault |
| P2 | `AF-NILE-B07` — **Nubian/Meroitic temple** | Small axial rectangle + court | Stone and brick | Flat terraces/modest pylons |
| P2 | `AF-NILE-B08` — **High-hall house** | Nested rectangles around roofed core | Adobe and wooden posts | Flat roof with varying height |
| P3 | `AF-NILE-B09` — **Nubian pyramid** | Narrow square base, very pointed elevation | Masonry stone | Pyramid summit; funerary monument |
| P3 | `AF-NILE-B10` — **Mastaba** | Rectangle with sloping walls | Mud brick or stone | Monumental flat funerary roof |

## 07. Maghreb, Atlas, pre-Saharan oases, and Sahara `AF-MAG`

**Scope and signature:** A → M and some L forms. Compact earthen urbanism, courtyard houses, kasbahs (fortresses) and ksour (fortified settlements), hillside stone villages. “Ksar” and “kasbah” are not synonyms.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `AF-MAG-S01` — **Terrace-house village** | Tight lanes between earthen complexes and patios | Morocco, Algeria, Tunisia, M/T |
| P1 | `AF-MAG-S02` — **Oasis ksar** | Compact walled settlement, defensive entrance | Pre-Sahara, M; preserved examples often L |
| P1 | `AF-MAG-S03` — **Maghrebi medina** | Merchant axes and secondary lanes/dead ends | Medieval Maghrebi towns, M |
| P1 | `AF-MAG-S04` — **Amazigh mountain village** | Stepped houses following slope, stair lanes | Atlas and mountain regions, T |
| P1 | `AF-MAG-S05` — **Urban kasbah** | Citadel/power enclosure within or at edge of city | Maghrebi fortification, M/T |
| P1 | `AF-MAG-S06` — **Fortified palm-grove village** | Built core + canal/well network + gardens | Saharan oases, T |
| P2 | `AF-MAG-S07` — **Communal-granary village** | Small houses and large fortified *agadir* | Sous and Anti-Atlas, M/T |
| P2 | `AF-MAG-S08` — **Saharan nomad camp** | Variably spaced tents around animals | Mobile pastoralism, T |
| P2 | `AF-MAG-S09` — **Excavated-courtyard village** | Sunken patios and rooms cut into earth/rock | Specific Tunisian sites, T; dates uncertain |
| P3 | `AF-MAG-S10` — **Earthen citadel with corner towers** | Flanked geometric enclosure, tightly packed houses | Pre-Saharan regions; preserved forms chiefly L |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `AF-MAG-B01` — **Earthen terrace house** | Rectangle/square, optional court | Adobe, rammed earth, plaster | Flat roof with parapet |
| P1 | `AF-MAG-B02` — **Patio dar** | Ring or U of rooms, open patio | Masonry/earth and timber | Terrace, internal galleries |
| P1 | `AF-MAG-B03` — **Early riad / enclosed-garden house** | Vegetated court, wings around garden | Brick/rammed earth/lime/timber | Terraces, galleries, optional fountain |
| P1 | `AF-MAG-B04` — **Dry-stone mountain house** | Rectangle backed by slope | Dry rubble, timber beams | Terrace or local pitch |
| P1 | `AF-MAG-B05` — **Ksar tower house** | Tall rectangle, two to four floors | Mass earth, thick walls | Flat roof, regional corner turrets |
| P1 | `AF-MAG-B06` — **Courtyard Maghrebi mosque** | Large rectangle, bayed prayer hall | Masonry and columns | Terraces and local roofs, separate minaret |
| P1 | `AF-MAG-B07` — **Agadir / granary fortress** | Walled enclosure and many storage cells | Dry stone and timber | Flat roofs/terraces |
| P2 | `AF-MAG-B08` — **Cylindrical courtyard granary** | Small grouped round silos or ovens | Earth and plant stems | Low earthen domes |
| P2 | `AF-MAG-B09` — **Inner-portico house** | Rectangle with courtyard and columned gallery | Brick, stone, lime plaster | Terrace/tile roofs by area |
| P2 | `AF-MAG-B10` — **Low Saharan tent** | Flattened oval/square | Poles and ropes, woven textile | Tensioned double-curved membrane |
| P3 | `AF-MAG-B11` — **Excavated patio dwelling** | Deep sunken court, peripheral rooms | Stabilized rock/earth | Natural ground covering |

**Caution:** The preserved ksar of Aït Benhaddou chiefly illustrates construction **from the 17th century onward**. A medieval ksar can be used as an **archetype**, but its later details should not be automatically reproduced.


## 08. Mesopotamia, Levant, southern Anatolia, Arabia, and Iran `AS-MIDE`

**Scope and signature:** A → M, **several traditions separable in software**. The earthen courtyard house is highly reusable; ziggurat cities (A), medinas (M), fortified Iranian cities, and desert villages differ in period and roofs.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `AS-MIDE-S01` — **Narrow-street earthen city** | Massive patio-house blocks, dead ends and lanes | Mesopotamia, inland Levant, A/T |
| P1 | `AS-MIDE-S02` — **Mesopotamian high-temple city** | Dense districts, dominant sacred complex, canals | Sumer/Akkad/Babylon, A |
| P1 | `AS-MIDE-S03` — **Fortified Levantine city** | Tell center, walls, sloping streets and gates | Ancient Levant, A |
| P1 | `AS-MIDE-S04` — **Bazaar and district city** | Bazaar routes, secondary streets, courtyard houses | Syria, Iran, Anatolia, M |
| P1 | `AS-MIDE-S05` — **Caravan crossroads** | Caravan enclosures, souk, cistern, strip districts | Inland routes, A/M |
| P1 | `AS-MIDE-S06` — **Arab desert village** | Earth/stone blocks at wadi edge, hidden courts | Arabia and Near East, T |
| P1 | `AS-MIDE-S07` — **Persian citadel city** | Enclosure, central square, commercial axes | Iran and neighbors, M |
| P2 | `AS-MIDE-S08` — **Ancient city with great sacred axes** | Processional avenues, walled palaces/temples | Babylonia/Assyria, A |
| P2 | `AS-MIDE-S09` — **Canyon tower-house city** | Compact stepped fabric in arid valley | Yemen/Hadhramaut; filter L traits |
| P2 | `AS-MIDE-S10` — **Windcatcher village** | Courts and low volumes with vertical windcatchers | Iranian plateau, M/T |
| P3 | `AS-MIDE-S11` — **Vertical Hadhramaut city** | Adjoining tower houses, quadrangular enclosure | Preserved Shibam **16th century** onward: L |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `AS-MIDE-B01` — **Levantine courtyard house** | Rectangular block, one or two floors, patio | Stone/earth/plaster | Flat roof, shaded gallery |
| P1 | `AS-MIDE-B02` — **Mesopotamian courtyard house** | Rooms around one courtyard | Adobe/fired brick by wealth | Earthen terraces, sometimes vaults |
| P1 | `AS-MIDE-B03` — **Persian iwan house** | Rectangular court with one to four large vaulted niches | Brick, stucco, earth | Vaults and flat roofs |
| P1 | `AS-MIDE-B04` — **Levantine stone house** | Adjoining blocks, small courts | Limestone/rubble and lime | Terraces or stone vaults |
| P1 | `AS-MIDE-B05` — **Courtyard caravanserai** | Large square, cells around large void | Stone/brick, monumental portals | Terraces and vaults around court |
| P1 | `AS-MIDE-B06` — **Vaulted brick house** | Linear rectangle or courtyard cell | Mud or fired brick | Brick barrel vault or dome |
| P1 | `AS-MIDE-B07` — **Courtyard / hypostyle-hall mosque** | Large square/rectangle with court + columned nave | Stone/brick and timber | Porticoes, selected domes by period |
| P1 | `AS-MIDE-B08` — **Ziggurat** | Superposed platform tiers | Mud bricks with fired facing | Terraces, stairs/ramps; temple, A |
| P2 | `AS-MIDE-B09` — **Wind-tower house** | Square around patio + ventilated tower | Adobe/brick, ducts | Terrace and vertical badgir |
| P2 | `AS-MIDE-B10` — **Bazaar gallery house** | Narrow attached volume, rear court | Brick/stone and timber framing | Street vault or local covering |
| P2 | `AS-MIDE-B11` — **Iwan madrasa** | Square court and two/four large porticoed niches | Brick, ceramic, stucco | Vaults and small domes |
| P2 | `AS-MIDE-B12` — **Multi-story desert tower** | Small massive rectangle, restricted access | Earth/stone and beams | Roof terrace, parapets |
| P3 | `AS-MIDE-B13` — **Tall Hadhrami tower house** | Narrow rectangle, four to seven floors | Sun-dried mud bricks, beams | High terrace, white plaster; **L** |

**Caution:** The classic silhouette of **Shibam** dates mainly from the 16th century: retain it as a late extension, not a typical ancient Arabian house.


## 09. Central Asia, Eurasian steppes, and oasis cities `AS-STEP`

**Scope and signature:** A → M. Distinguish **mobile pastoral camp** (felt/timber, ground without street grid) from **oasis city** (earth/brick, walls, bazaar). A yurt is not a permanent urban house.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `AS-STEP-S01` — **Nomadic yurt camp** | Spaced round units, clearing and mobile enclosures | Mongolian/Central Asian steppes, T |
| P1 | `AS-STEP-S02` — **Tribal camp around a core** | Dominant large yurts, small units in arc | Steppes, T |
| P1 | `AS-STEP-S03` — **Oasis city on caravan route** | Walled core, large market, canals, gates | Transoxiana, Tarim, M |
| P1 | `AS-STEP-S04` — **Irrigated oasis village** | Rectangular houses along canals and fields | Arid Central Asia, T |
| P1 | `AS-STEP-S05` — **Earthen city with citadel** | Lower city, separate enclosure/citadel, souk | Urban Central Asia, M |
| P2 | `AS-STEP-S06` — **Isolated caravanserai** | Large square enclosure beside route | Trade routes, M |
| P2 | `AS-STEP-S07` — **Mountain-valley village** | Stone-walled terraces, upstream pasture | Pamirs/Tian Shan, M/T |
| P2 | `AS-STEP-S08` — **Mixed tent + adobe camp** | Light enclosures, permanent house and seasonal tents | Oasis/steppe margins, T |
| P3 | `AS-STEP-S09` — **Fortified steppe capital** | Settled city with more structured plan, functional districts | Turco-Mongol empires, M |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `AS-STEP-B01` — **Yurt / ger** | Circle with central hearth and oriented door | Timber lattice, poles, felt covering | Low dome-cone with crown |
| P1 | `AS-STEP-B02` — **Elongated steppe tent** | Oval/rectangle with flexible ridge | Pole frame, felt or hide | Tensioned textile gable |
| P1 | `AS-STEP-B03` — **Adobe oasis house** | Compact one- or two-story rectangle | Mud brick and plaster | Roof terrace |
| P1 | `AS-STEP-B04` — **Transoxian courtyard house** | Rectangular buildings around patio | Adobe/brick and timber | Terraces, courtyard awnings |
| P1 | `AS-STEP-B05` — **Fortified caravanserai** | Square with open court and peripheral cells | Mass earth and fired brick | Flat/vaulted roofs, axial portal |
| P1 | `AS-STEP-B06` — **Turco-Persian domed mausoleum** | Low square supporting dome on drum | Fired brick, stucco, ceramic | Dome and facade decoration |
| P2 | `AS-STEP-B07` — **Stone valley granary** | Small detached rectangle | Dry masonry and timber | Flat or gable roof |
| P2 | `AS-STEP-B08` — **Chief's main tent** | Large oval/round, axial entrance | Lattice and decorated felt | Higher roof crown |
| P2 | `AS-STEP-B09` — **Rammed-earth valley house** | Courtyard rectangle with annexes | Compacted earth and poplar | Flat pole roof |
| P3 | `AS-STEP-B10` — **Monumental oasis pavilion** | Rectangle with tall porch and court | Glazed bricks, timber, plaster | Dome or vault; closely period-dependent |

## 10. Sahelian Africa — Niger, Niger bend, Hausa, Songhai, Mali `AF-SAHEL`

**Scope and signature:** local A → M and survivals. Earthen courtyard houses, flood-related siting, earthen streets, Sudano-Sahelian forms. Famous great mosques have often been **rebuilt**, although earthen traditions are old.

### Settlement morphologies

| Priority | ID and archetype | Plan organization | Environment and period |
| --- | --- | --- | --- |
| P0 | `AF-SAHEL-S01` — **Earthen compound village** | Enclosures of rooms and small courts, dirt paths | Sahelian savanna, T |
| P1 | `AF-SAHEL-S02` — **Niger river city** | Districts on flood-protected islets/levees, markets | Djenné and Niger valley, A/M |
| P1 | `AF-SAHEL-S03` — **Sahelian merchant city** | Dense adobe core, craft and caravan districts | Western Sahel, M |
| P1 | `AF-SAHEL-S04` — **Hausa earthen-walled city** | Streets to gates, large compounds and palace | Hausaland, M/T |
| P1 | `AF-SAHEL-S05` — **Seasonal pastoral hamlet** | Livestock enclosures, spaced tents/huts | Semi-arid areas, T |
| P2 | `AF-SAHEL-S06` — **Dogon escarpment village** | Small stepped hamlets and settlements beneath cliffs | Dogon country, M/T |
| P2 | `AF-SAHEL-S07` — **Earthen town on mound** | Buildings on slight elevation, surrounding agriculture | Floodplain, M/T |
| P2 | `AF-SAHEL-S08` — **Potter/smith craft village** | Tight compounds around work courts | Sahel, T |
| P3 | `AF-SAHEL-S09` — **Shell-house village** | Grouped conical earth volumes | Northern Cameroon and Musgum region; late-documented form |

### Building / complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
| --- | --- | --- | --- | --- |
| P0 | `AF-SAHEL-B01` — **Round Sahelian hut** | Disk with adjacent court, one floor | Earth, posts and plaster | Conical thatch roof |
| P0 | `AF-SAHEL-B02` — **Banco terrace house** | Compact rectangle around court | Mud brick, cob, earthen mortar | Flat pole/plaster roof |
| P1 | `AF-SAHEL-B03` — **Sahelian family compound** | Walled court and several round/square rooms | Earth walls and vegetal fences | Thatch cones + terraces |
| P1 | `AF-SAHEL-B04` — **Djennenké urban house** | One- or two-story rectangle, street frontage | Adobe brick and earthen plaster | Flat roof, buttresses and relief decoration |
| P1 | `AF-SAHEL-B05` — **Hausa courtyard house** | Compartmented rectangular enclosure | Mass earth, decorated plaster | Terrace, porticoes and vaulted rooms by region |
| P1 | `AF-SAHEL-B06` — **Sudano-Sahelian mosque** | Large prayer hall + court, massive volumes | Banco, buttresses, projecting timber | Terraces and turrets; strong variation |
| P1 | `AF-SAHEL-B07` — **Cylindrical earthen granary** | Small independent cylinder, sometimes raised | Earth / plastered basketry | Earthen dome or thatch cone |
| P1 | `AF-SAHEL-B08` — **Stepped Dogon house** | Small clustered rectangles on slope | Stone and earth | Earthen terraces and conical granaries |
| P2 | `AF-SAHEL-B09` — **Chief's house with large vestibule** | Court and hierarchical room sequence | Plastered earth, carved posts | Combined flat or conical roofs |
| P2 | `AF-SAHEL-B10` — **Regional Fulani tent camp** | A few mobile ovals and livestock enclosures | Masts, poles, mats | Vegetal/textile coverings by group |
| P3 | `AF-SAHEL-B11` — **Musgum shell house** | Small to large round plan, shaped walls | Earth with vertical ribs | Ogival earthen shell; dated use requires documentation |

**Caution:** “Sudano-Sahelian” is a **group of traditions**, not a uniform recipe. The present Great Mosque of Djenné is an early 20th-century reconstruction: select a regional/medieval variant rather than systematically copying its exact silhouette.


## 11. Forested West Africa and the Gulf of Guinea — Yoruba, Edo, Akan, Fon, etc. `AF-WEST`

**Scope and signature:** M → later traditions. The **courtyard compound** is central in several regions; large cities and palaces existed, but some iconic surviving complexes date chiefly to the seventeenth–nineteenth centuries (tag L).

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AF-WEST-S01` — **Village of lineage compounds** | Enclosures around courtyards, organic paths, plantations | West African forest zones, T |
| P1 | `AF-WEST-S02` — **Yoruba town with neighbourhoods** | Large residential compounds and routes leading to market and palace | Southwest Nigeria, M/T |
| P1 | `AF-WEST-S03` — **Walled royal city** | Palace and markets in a protected core, peripheral neighbourhoods | Edo/Yoruba area depending on period, M/T |
| P1 | `AF-WEST-S04` — **Village of large thatched roofs** | Rectangular dwellings with open courtyards and groves | Forest and humid savanna, T |
| P1 | `AF-WEST-S05` — **Town of compound-lined streets** | Rows of walls and gates; buildings hidden from the street | Sudanian and forest zones, T |
| P2 | `AF-WEST-S06` — **Akan royal centre** | Court/palace and clan houses with ceremonial spaces | Ghana, precolonial and later traditions |
| P2 | `AF-WEST-S07` — **Village of painted houses** | Decorated compounds with geometric façades | Select specific cultures and periods |
| P3 | `AF-WEST-S08` — **Abomey palace complex** | Large enclosure and successive nested courtyards | Fon/Dahomey, **seventeenth–nineteenth centuries: L** |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AF-WEST-B01` — **Courtyard house with gallery** | L/U-shaped rectangles, shared courtyard | Earth/timber and plaster | Vegetal roofs or terraces depending on climate |
| P1 | `AF-WEST-B02` — **Yoruba family courtyard** | Square/rectangle enclosing a central courtyard | Earthen masonry and timber | Steep thatch, later regional tiles |
| P1 | `AF-WEST-B03` — **Large post-supported communal hall** | Long rectangle with sheltered eaves | Timber frame, woven partitions | Wide thatched roof |
| P1 | `AF-WEST-B04` — **Forest house with deep overhangs** | Low rectangle with protected openings | Timber posts and plastered wattle | Thick hipped thatch |
| P1 | `AF-WEST-B05` — **Chief's house with successive courtyards** | Several buildings arranged towards a central courtyard | Earth, carved wood and fencing | Large thatched roofs |
| P2 | `AF-WEST-B06` — **Geometric relief façade** | Rectangular volume with prominent entrance | Cob/sculpted plaster | Thatch or low roof |
| P2 | `AF-WEST-B07` — **Akan clan courtyard house** | Walled compound and pavilions | Earth/timber, pillars and plaster | Thatched roofs, façade decoration |
| P2 | `AF-WEST-B08` — **Domestic courtyard shrine** | Small dedicated pavilion/cell within compound | Earth, timber, posts | Light thatched roof |
| P2 | `AF-WEST-B09` — **Craft worker's house in a compound** | Work cells linked to courtyard | Unfired earth and timber | Thatch, sheds and open spaces |
| P3 | `AF-WEST-B10` — **Abomey palace** | Large sequences of three hierarchical courtyards | Cob, polychrome reliefs, high walls | Roofs adapted to each hall; **L** |

## 12. Central and southern Africa — pastoral enclosures, stone kingdoms, forests `AF-SOUTH`

**Scope and signature:** M → T. Includes the **kraal** as a southern African pastoral pattern, residential enclosures, round huts, rondavels and Great Zimbabwe's dry-stone architecture. “Kraal” can mean a livestock enclosure **or**, in historical English usage, a group of dwellings: record both senses.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AF-SOUTH-S01` — **Pastoral village with kraal** | Huts around or adjoining a livestock yard | Southern Africa, T |
| P1 | `AF-SOUTH-S02` — **Nguni umuzi** | Concentric/semicircular arrangement of huts and enclosures | Southern Africa; models observed mainly in later periods |
| P1 | `AF-SOUTH-S03` — **Village of circular compounds** | Separate family compounds and curved paths | Savanna zones and valleys, T |
| P1 | `AF-SOUTH-S04` — **Dry-stone royal enclosures** | Large curved or elliptical walls and internal courtyards | Zimbabwe region, eleventh–fifteenth centuries |
| P1 | `AF-SOUTH-S05` — **Great Zimbabwe settlement** | Major enclosures, scattered dwellings, hill core | Zimbabwe plateau, eleventh–fifteenth centuries |
| P2 | `AF-SOUTH-S06` — **Rondavel village** | Regular discs with small courtyards and paths | Southern Africa, long tradition, variable details |
| P2 | `AF-SOUTH-S07` — **Forest hut village** | Oval/rectangular vegetal units with modest courtyards | Equatorial Central Africa, diverse traditions |
| P2 | `AF-SOUTH-S08` — **Mobile hunting/forest settlement** | Small light shelters scattered near water | Specific groups and locations, seasonal |
| P3 | `AF-SOUTH-S09` — **Great enclosure with conical tower** | Monumental elliptical wall with passages and internal spaces | Great Enclosure, Zimbabwe, fourteenth century |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AF-SOUTH-B01` — **Round earth and thatch hut** | Standalone disc, one storey | Posts/earth, sometimes stone | Conical thatch |
| P0 | `AF-SOUTH-B02` — **Kraal fence** | Circular enclosure without a roof | Thorn branches, timber, earth or stone | Oriented gate, open interior for livestock |
| P1 | `AF-SOUTH-B03` — **Masonry rondavel** | Disc with thick wall, one storey | Cob, adobe or stone depending on region | Very regular conical thatch |
| P1 | `AF-SOUTH-B04` — **Vegetal dome hut** | Disc with walls and roof sometimes almost continuous | Timber hoops, woven vegetation | Thick thatched dome |
| P1 | `AF-SOUTH-B05` — **Family compound of several huts** | Group of discs around a courtyard | Vegetal/earth enclosure, small outbuildings | Cones of different sizes |
| P1 | `AF-SOUTH-B06` — **Daga house** | Disc/rectangle of rooms around communal space | Earth, decomposed granite and clay | Thatch, spaces on terraces |
| P1 | `AF-SOUTH-B07` — **Zimbabwe monumental wall** | Long curved walls, dogleg entrances | Dry-laid granite blocks | No roof, masonry chevrons |
| P2 | `AF-SOUTH-B08` — **Timber/vegetal forest house** | Low rectangle or oval | Posts, bark, woven material | Hipped thatch/foliage |
| P2 | `AF-SOUTH-B09` — **Enclosed storage granary** | Small square or circle protected from animals | Cob and raised timber | Conical thatch |
| P3 | `AF-SOUTH-B10` — **Zimbabwe conical tower** | Small solid, uninhabitable circle | Dry granite, regular courses | Truncated masonry tip |

**Note:** The **kraal** primarily concerns the organisation of pastoral space. It should neither be treated as a roofed building nor used to imply that all African societies live in round huts.

## 13. East Africa, the Horn of Africa and the Swahili coast `AF-EAST`

**Scope and signature:** A → M. A mixture of coral-stone ports, stone/adobe highlands, Ethiopian monuments and semi-arid pastoral camps. Long-standing Indian Ocean contacts help explain some Swahili courtyards and vaulted halls.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AF-EAST-S01` — **Highland hut village** | Round/square huts spaced among crops | Agricultural East Africa, T |
| P1 | `AF-EAST-S02` — **Swahili stone town** | Dense plots, mosques and squares, waterfront | Kilwa/Songo Mnara, ninth–fifteenth centuries |
| P1 | `AF-EAST-S03` — **Vegetal Swahili coastal village** | Sandy lanes, courtyard houses and gardens | East African coast, M/T |
| P1 | `AF-EAST-S04` — **Ethiopian highland town** | Sloping lanes and stone/earth complexes | Highlands, M |
| P1 | `AF-EAST-S05` — **Ethiopian stone/tukul village** | Circular huts and rectangular houses in gardens | Ethiopia, T |
| P1 | `AF-EAST-S06` — **Pastoral boma camp** | Animal enclosures, small groups of huts | Savanna and Horn regions, T |
| P2 | `AF-EAST-S07` — **Aksumite town** | Stone building complexes, stela monuments | Aksum, A |
| P2 | `AF-EAST-S08` — **Rock-hewn church hamlet** | Hillside dwellings around excavated spaces | Lalibela and highlands, M |
| P2 | `AF-EAST-S09` — **Island trading port** | Mosque, palace and houses along compact streets/squares | Kilwa and coastal islands, M |
| P3 | `AF-EAST-S10` — **Baganda palace village** | Courtyard sequences and monumental circular building | Uganda, long tradition, Kasubi example **L** |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AF-EAST-B01` — **Highland tukul** | Round hut with small veranda | Earth/stone and timber posts | Conical thatch |
| P1 | `AF-EAST-B02` — **Swahili coral house** | Dense rectangle with rooms in sequence, small courtyard | Coral/coral limestone, lime and timber | Flat roof or local timber roof |
| P1 | `AF-EAST-B03` — **Vegetal Swahili house** | Rectangle with courtyard and veranda | Wattle, mud, timber and palms | Palm/thatch roof |
| P1 | `AF-EAST-B04` — **Highland house** | Massive rectangle or round plan | Stone and earth, timber | Conical/thatch roof or regional terrace |
| P1 | `AF-EAST-B05` — **Ethiopian rock-hewn church** | Cross or rectangle excavated into plateau | Entirely carved from living rock | Roof at ground level, access trenches |
| P1 | `AF-EAST-B06` — **Vaulted Swahili hall** | Rectangular prestige hall | Coral limestone and mortar | Masonry vaults/domes |
| P1 | `AF-EAST-B07` — **Pastoral boma** | Circle/ellipse with no prescribed central building | Thorn branches, palisades | Livestock enclosure, narrow access |
| P2 | `AF-EAST-B08` — **Recessed Aksumite house** | Composite plan, stepped elevations | Stone and timber in horizontal bands | Hypothetical flat/terraced roof depending on building |
| P2 | `AF-EAST-B09` — **Bayed coastal mosque** | Rectangle with rows of small rooms | Coral limestone and columns | Vaults, domes, terrace |
| P2 | `AF-EAST-B10` — **Semi-open savanna hut** | Oval beneath a large canopy | Posts, earth and basketry | Thatch with wide overhang |
| P2 | `AF-EAST-B11` — **Monumental Aksumite stela** | Tall upright rectangular slab | Carved stone monolith | No roof; square feature |
| P3 | `AF-EAST-B12` — **Large vegetal Baganda building** | Monumental circular plan, entrance courtyard | Timber posts, hurdles, reeds | Very wide thatched dome; surviving example **L** |

## 14. Indian subcontinent — Indus Valley, ancient and medieval India, Sri Lanka `AS-IND`

**Scope and signature:** A → M. Do not merge Indus urbanism (third millennium BCE), medieval kingdom cities, Dravidian/Nagara temples and tropical village houses.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AS-IND-S01` — **Courtyard-house village** | Clusters of rectangular enclosures, organic streets | India, Pakistan, Bangladesh, Sri Lanka depending on climate, T |
| P1 | `AS-IND-S02` — **Planned Harappan city** | Grid and street hierarchy, brick neighbourhoods, drains | Indus civilisation, A |
| P1 | `AS-IND-S03` — **Fortified royal town** | Palace/fort district, markets and suburban extensions | Indian kingdoms, M |
| P1 | `AS-IND-S04` — **Dravidian temple town** | Nested sacred enclosures, large ritual streets | South India, M |
| P1 | `AS-IND-S05` — **Nagara temple town** | Compact sanctuary with dense surrounding courtyard fabric | Northern and central India, M |
| P1 | `AS-IND-S06` — **Monsoon village** | Houses with overhanging roofs, courtyards, dirt paths | Humid tropical plains, T |
| P1 | `AS-IND-S07` — **Rajasthan desert village** | Compact houses, forts, water stores and courtyards | Dry regions, M/T |
| P2 | `AS-IND-S08` — **Tank and ghat town** | Ritual quays/steps around a large reservoir | Urban India, M/T |
| P2 | `AS-IND-S09` — **Deccan royal town** | Fortified courtyard complexes, shrines and markets | Deccan, M |
| P2 | `AS-IND-S10` — **Ancient Sri Lankan plantation village** | Courtyard house, irrigation reservoir and separate temples | Sri Lanka, A/M |
| P3 | `AS-IND-S11` — **Stepwell town** | Deep masonry basin and surrounding neighbourhoods | Dry zones, regional works, M |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AS-IND-B01` — **Rectangular Indian house** | One-storey rectangle, optional courtyard | Adobe/brick, earth and timber | Tiles, thatch or flat roof depending on monsoon |
| P1 | `AS-IND-B02` — **Harappan brick house** | Enclosed rooms around a small courtyard | Fired and unfired brick | Terrace/timber structure, drainage |
| P1 | `AS-IND-B03` — **Inner-courtyard house** | Ring of rooms around central void | Brick, stone and timber | Tiles or terrace depending on region |
| P1 | `AS-IND-B04` — **Wet-region stilt house** | Rectangle with raised floor and external stairs | Timber/bamboo, woven panels | Steep hipped palm/thatch roof |
| P1 | `AS-IND-B05` — **Rural conical hut** | Modest round/square plan | Cob/earth and bamboo | Thick vegetal cone |
| P1 | `AS-IND-B06` — **Nagara temple with shikhara** | Square sanctuary, axial antechambers | Stone or brick | Curvilinear tower / stone spire above cella |
| P1 | `AS-IND-B07` — **Dravidian temple with vimana** | Square cella with halls and enclosure courtyards | Dressed stone | Pyramid of diminishing tiers above sanctuary |
| P1 | `AS-IND-B08` — **Buddhist stupa** | Circle or axial square with circumambulation path | Brick/stone, plaster | Solid dome, balustrades and gateways |
| P1 | `AS-IND-B09` — **Hypostyle mandapa** | Rectangular hall articulated by pillars | Carved stone | Slabs / stepped stone volumes |
| P2 | `AS-IND-B10` — **Merchant house with balcony** | Courtyard rectangle, upper floor facing street | Brick/stone, timber beams, lattice | Flat roof or tiles |
| P2 | `AS-IND-B11` — **Baoli / stepwell** | Long excavated well, galleries and multiple stairways | Masonry stone | Open to sky, pavilions |
| P2 | `AS-IND-B12` — **Rural laterite house** | Low rectangle with patio | Laterite blocks and timber | Sloping tiles, deep eaves |
| P3 | `AS-IND-B13` — **Multiple-courtyard palace** | U-shaped blocks and successive courtyards | Stone, brick, timber ceilings | Terraces, pavilions and towers varying by region |

**Note:** The enormous **gopurams** of major southern complexes and many famous **havelis** have later forms. Do not automatically apply the best-known silhouette to an ancient town.

## 15. Himalayas — Tibet, Newar Nepal, Ladakh, Bhutan `AS-HIM`

**Scope and signature:** M and long-standing traditions. Stone, earth, thick whitewashed walls, sloping streets, courtyards and Tibetan flat roofs; Nepal has **brick and timber** towns with multi-roofed temples. Well-preserved large Bhutanese dzongs date mainly to the seventeenth century and later.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AS-HIM-S01` — **Terraced mountain village** | Stepped houses connected by stairs and roofs | High-altitude Himalayas, M/T |
| P1 | `AS-HIM-S02` — **Tibetan flat-roof village** | Clustered rectangular volumes, enclosed courtyards | Dry, cold Tibet/Ladakh, M/T |
| P1 | `AS-HIM-S03` — **Newar city with palace squares** | Dense brick blocks, ritual square with pavilions | Kathmandu Valley, M |
| P1 | `AS-HIM-S04` — **Hillside monastic town** | Temple enclosures on a promontory, stepped housing | Tibet and Himalayas, M |
| P1 | `AS-HIM-S05` — **Steep-roofed valley village** | Less compact units, fields and granaries | Central Nepal and humid slopes, T |
| P2 | `AS-HIM-S06` — **Fortified Himalayan monastery** | Large complex of courtyards and enclosures on a ridge | Tibet/Ladakh, M |
| P2 | `AS-HIM-S07` — **High-altitude caravan town** | Single street with houses and trading courtyards | Himalayan passes, M |
| P3 | `AS-HIM-S08` — **Monumental Bhutanese dzong** | Massive fortress-monastery with courtyards and towers | Iconic form mainly **seventeenth–eighteenth centuries: L** |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AS-HIM-B01` — **Whitewashed Tibetan house** | Rectangular block of 2–3 storeys, small courtyard | Massive plastered stone/earth, timber | Flat roof with parapet |
| P1 | `AS-HIM-B02` — **Stepped Ladakhi house** | Terraced rectangular volumes on a slope | Stone/adobe, branches and earth | Terraces at different heights |
| P1 | `AS-HIM-B03` — **Newar town house** | Narrow tall rectangle, often 2–4 storeys | Fired brick, timber frame/roof | Sloping roof of small tiles, carved windows |
| P1 | `AS-HIM-B04` — **Himalayan gallery house** | One- or two-storey rectangle | Stone plus timber frame and galleries | Steep gable roof in shingles/slate |
| P1 | `AS-HIM-B05` — **Multi-roofed Newar temple** | Square pavilion, nested diminishing tiers | Brick and timber with carved beams/struts | Several superimposed tile roofs |
| P1 | `AS-HIM-B06` — **Gompa / Tibetan monastery** | Cluster of volumes with halls and courtyard(s) | Plastered stone/earth, large timber halls | Flat roofs, painted edges and banners |
| P1 | `AS-HIM-B07` — **Chorten / Tibetan stupa** | Square base and domed central volume | Stone, adobe, white plaster | Spire made of discs |
| P2 | `AS-HIM-B08` — **Himalayan tower house** | Small tall square, stacked volumes | Massive stone and beams | Flat roof / local covering |
| P2 | `AS-HIM-B09` — **Newar palace pavilion** | Rectangular or U-shaped galleries around courtyard | Brick, carved wood and stone base | Multi-level tile roof |
| P2 | `AS-HIM-B10` — **Cliff cave dwelling** | Excavated cells with galleries | Conglomerate/rock cliffs | Natural cover |
| P3 | `AS-HIM-B11` — **Dzong with battered walls** | Large enclosures and towers around central courtyard | Massive whitewashed stone, timber framing | Slightly upturned roofs and broad bands; **L** |

## 16. Ancient and medieval China — imperial capitals, towns, regional villages `AS-CHI`

**Scope and signature:** A → M, with L extensions. **The most important pack for multi-storey buildings and nested roofs**: axial timber pavilions, *siheyuan* courtyards, deep eaves, northern earth houses, southern stilt houses and rock-cut structures. Provide several substyles (Han/Tang/Song/Yuan/Ming) rather than a vague “Chinese” style.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AS-CHI-S01` — **Rural Chinese courtyard village** | Groups of rectangular pavilions, structured paths | North and centre, T |
| P1 | `AS-CHI-S02` — **Orthogonal imperial capital** | Great enclosure, north–south axes, districts and axial palace | Chang'an/Tang and Dadu/Yuan, specific periods |
| P1 | `AS-CHI-S03` — **Fortified district town** | Rectangular/irregular walls, gates, merchant streets | Medieval China, M |
| P1 | `AS-CHI-S04` — **Canal trading town** | Street and bridge network, long plots | Jiangnan / lower Yangtze, M |
| P1 | `AS-CHI-S05` — **Southern mountain village** | Terraced buildings, winding paths and galleries | South/Southwest, T |
| P1 | `AS-CHI-S06` — **Town of successive courtyards** | Narrow lane, shared walls, several patios | Han urban areas, M |
| P2 | `AS-CHI-S07` — **Stilt-house village** | Houses aligned along slopes and rivers | South and minority regions, T |
| P2 | `AS-CHI-S08` — **Yaodong cave village** | Dwellings excavated in slopes/plateau, sunken courtyards | Loess Plateau, T |
| P2 | `AS-CHI-S09` — **Chinese coastal port town** | Warehouses, commercial streets and quays | Southern coasts, Song/Yuan, M |
| P2 | `AS-CHI-S10` — **Enclosed village of large clans** | Composite family enclosure, hierarchical dwellings | Southern China, late M → L |
| P3 | `AS-CHI-S11` — **Tulou village** | Several very large inhabited rings/squares with courtyards | Fujian, **fifteenth–twentieth centuries**, mainly L |
| P3 | `AS-CHI-S12` — **Palace city with successive enclosures** | Layered enclosures, gates and squares on an axis | Imperial capital, rare at map scale |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AS-CHI-B01` — **Gabled timber house** | One-storey rectangle, regular bays | Timber frame, earth/brick infill | Grey tiles with eaves |
| P1 | `AS-CHI-B02` — **Siheyuan courtyard house** | Four pavilions in a square around an axial courtyard | Timber frame, brick and enclosure walls | Gabled tile roofs |
| P1 | `AS-CHI-B03` — **Timber pavilion on a base** | Rectangle/square, 1–2 storeys | Timber posts, beams and dougong brackets according to status | Hip or gable roof, deep overhangs |
| P1 | `AS-CHI-B04` — **Street-facing merchant house** | Narrow rectangle, 1–3 storeys with backyard | Timber and brick | Tiles, roof connected to annexes |
| P1 | `AS-CHI-B05` — **Adobe peasant house** | Rectangle with courtyard and agricultural outbuildings | Massive earth walls, timber | Flat roof or tiles depending on region |
| P1 | `AS-CHI-B06` — **Multi-storey pagoda** | Square, hexagon or octagon, 3–9 or more storeys | Timber, brick or stone depending on period | Separate roofs at each level, setbacks and eaves |
| P1 | `AS-CHI-B07` — **Great palace hall** | Wide rectangle raised on platform | Timber frame on masonry terrace | Huge tiled hip roof, ornamented ridges |
| P1 | `AS-CHI-B08` — **Southern stilt house** | Rectangle raised over slope/water, gallery | Timber/bamboo posts, woven partitions | Steep vegetal roof or regional tiles |
| P2 | `AS-CHI-B09` — **Chinese watchtower** | Square/rectangle, 2–4 storeys | Brick/timber on masonry | One or more roofs with eaves |
| P2 | `AS-CHI-B10` — **Excavated yaodong** | Vaulted cells in a cliff face | Excavated loess or brick vaults | Natural earth cover |
| P2 | `AS-CHI-B11` — **Clan residence with successive courtyards** | Blocks and courtyards in axial sequence | Brick and timber | Nested roofs at different levels |
| P2 | `AS-CHI-B12` — **Covered bridge with pavilions** | Long rectangular bridge with built bays | Timber frame and stone piers | Sloping roof with occasional pavilions |
| P3 | `AS-CHI-B13` — **Circular / square tulou** | Large closed ring or square, 3–5 storeys | Thick rammed-earth walls, timber interior | Annular tile roof, **mostly L** |
| P3 | `AS-CHI-B14` — **Complex pavilion with nested roofs** | Central square body plus recessed wings/galleries | Timber with complex joints and brackets | 2–4 superimposed, intersecting roofs, prestigious |

**Note:** The **Beijing** axis originates in Dadu/Yuan (thirteenth century), with later Ming/Qing heritage. Listed **tulou** date from the **fifteenth to twentieth centuries**; many of their best-known silhouettes are modern. Place them at P3/late.

## 17. Korean peninsula — ancient kingdoms, Goryeo and early Joseon `AS-KOR`

**Scope and signature:** A → M. Village layouts adapted to terrain, *madang* courtyards, timber buildings, ondol/underfloor heating and tile or thatch roofs, mountain monasteries. Distinguish elite and rural houses.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AS-KOR-S01` — **Korean courtyard village** | Houses arranged around fenced courtyards | Korean peninsula, M/T |
| P1 | `AS-KOR-S02` — **Valley market town** | Market street and clusters of domestic courtyards | Agricultural valleys, M |
| P1 | `AS-KOR-S03` — **Fortified kingdom town** | Stone/earth enclosure, gates and palace | Silla/Goryeo/early Joseon, varying dates |
| P1 | `AS-KOR-S04` — **Hillside village** | Terraced courtyards, roofs facing the sun | Temperate mountains, T |
| P2 | `AS-KOR-S05` — **Mountain sansa monastery** | *Madang* courtyard between hall, pavilions and cells | From seventh–ninth centuries, M |
| P3 | `AS-KOR-S06` — **Palace with hierarchical courtyards** | Gates, great halls and courtyards on an axis | Capital or royal seat, M |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AS-KOR-B01` — **Korean timber and earth house** | One-storey rectangle, external courtyard | Timber frame and earth infill | Hipped thatch roof |
| P1 | `AS-KOR-B02` — **Courtyard hanok** | L- or U-shaped wings around a *madang* | Timber frame on stone base, earth | Tiles or thatch according to status |
| P1 | `AS-KOR-B03` — **Open Korean pavilion** | Rectangle on stilts/base, open sides | Timber pillars, jointed beams | Large overhanging roof, often tiled |
| P1 | `AS-KOR-B04` — **Sansa monastery hall** | Bayed rectangle facing courtyard | Timber, stone base | Hipped/gabled tile roof |
| P1 | `AS-KOR-B05` — **Peasant house with ondol** | Low rectangle, insulated rooms and heated room | Earth, timber, mineral base | Vegetal hip roof / tiles |
| P2 | `AS-KOR-B06` — **Bell tower/palace pavilion** | Square on raised base | Exposed timber frame | Optional double roof, tiles |
| P2 | `AS-KOR-B07` — **Korean stone pagoda** | Square base and 3–5 slab tiers | Cut stone | Superimposed stone roofs, low silhouettes |
| P3 | `AS-KOR-B08` — **Aristocratic residential complex** | Several wings in successive courtyards | Timber/plastered earth brick | Tile roofs, differentiated gates |

## 18. Japanese archipelago — Yayoi, Kofun, Heian, Kamakura, Muromachi `AS-JAP`

**Scope and signature:** A → M. Village and town inhabitants lived under **timber frames**, with thatch/bark/shingle/tile roofs and raised outbuildings. Do not uncritically project every **Edo machiya**, large castle tower and iconic pagoda onto Japan in 800 CE.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AS-JAP-S01` — **Open-courtyard house village** | Small timber units surrounded by gardens/rice fields | Rural Japan, A/M |
| P1 | `AS-JAP-S02` — **Heian-kyō capital** | Chinese-inspired grid, districts and palace | Kyoto from 794, M |
| P1 | `AS-JAP-S03` — **Temple and monastery town** | Routes to shrines, streets and gardens | Kansai and other centres, M |
| P1 | `AS-JAP-S04` — **Japanese port town** | Narrow plots backing onto quay, markets | Medieval ports, M |
| P1 | `AS-JAP-S05` — **Coastal fishing village** | Bands along shore with boat spaces | Archipelago, M/T |
| P2 | `AS-JAP-S06` — **Mountain village** | Separate houses, terraces and paths | Wooded regions, M/T |
| P2 | `AS-JAP-S07` — **Shinto shrine town** | Approach axis and religious enclosure within inhabited fabric | Local periods, M |
| P2 | `AS-JAP-S08` — **Warrior residence centre** | Enclosed residences, small fort on commanding terrain | Kamakura–Muromachi, M |
| P3 | `AS-JAP-S09` — **Castle town with monumental keep** | Fortified ring and extensive ordered districts | Large typical silhouette chiefly **sixteenth–seventeenth centuries: L** |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AS-JAP-B01` — **Timber and thatch peasant house** | One-storey rectangle, outbuildings | Timber posts, daub/wattle | Large gable or hipped vegetal roof |
| P1 | `AS-JAP-B02` — **Archaic rural minka** | Rectangle with several rooms on a floor | Timber frame and earth | Steep hipped thatch; details vary by period |
| P1 | `AS-JAP-B03` — **Shinden-style aristocratic house** | Central pavilion with wings and galleries | Timber on low stilts, movable partitions | Bark/timber roof, deep eaves |
| P1 | `AS-JAP-B04` — **Timber row house** | Narrow deep rectangle, rear courtyard | Timber, earth, shopfront gallery | Gabled tiles/shingles, simplified medieval style |
| P1 | `AS-JAP-B05` — **Raised takayuka granary** | Small square raised on posts | Timber posts and cladding | Thatch/bark roof |
| P1 | `AS-JAP-B06` — **Buddhist temple pagoda** | Vertical square of 3–5 storeys | Timber frame with possible central post | Superimposed overhanging roofs |
| P1 | `AS-JAP-B07` — **Shinto shrine with gallery** | Raised rectangle with prominent entrance | Structural timber, stone base | Tall bark/thatch/shingle roof, decorated ridge |
| P1 | `AS-JAP-B08` — **Courtyard Buddhist monastery** | Series of rectangular halls around axes | Timber and stone base | Tiled roofs, multiple bodies |
| P2 | `AS-JAP-B09` — **Early enclosed samurai house** | Courtyard pavilion and small outbuildings | Timber/earth, timber fence or masonry | Multiple thatch/tile roofs |
| P2 | `AS-JAP-B10` — **Pavilion with nested timber storeys** | Tall square and recessed pavilions | Timber frame, brackets | 2–3 successive roofs; elite/religious |
| P2 | `AS-JAP-B11` — **Late machiya town house** | Narrow strip and rear courtyards | Timber, earthen fire walls | Tiles and gable/eaves towards street; surviving models mainly **L** |
| P3 | `AS-JAP-B12` — **Tenshu keep with receding levels** | Tall tower with diminishing plans | Stone base plus timber frame | Multiple projecting roofs; **sixteenth–seventeenth centuries: L** |

## 19. Mainland Southeast Asia — Khmer, Thai, Lao, Mon, Burmese, Cham, Viet `AS-SEA`

**Scope and signature:** A → M. **Stilts and vegetal materials** in ordinary dwellings in humid areas; **large stone/brick complexes** are mainly religious/political. Inhabited Angkor was not a forest of stone temples: most ordinary buildings were perishable.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AS-SEA-S01` — **Riverside stilt village** | Rows on banks, paths/walkways, gardens | Monsoon valleys and plains, T |
| P1 | `AS-SEA-S02` — **Khmer hydraulic capital** | Great axes and enclosures, barays, canals and dispersed districts | Angkor, ninth–fifteenth centuries |
| P1 | `AS-SEA-S03` — **Enclosed Khmer temple city** | Square enclosure, cardinal gates, axial temple | Medieval Cambodia, M |
| P1 | `AS-SEA-S04` — **Burmese plain city** | Streets, earth/brick fortifications and stupas | Pagan/Bagan, eleventh–thirteenth centuries |
| P1 | `AS-SEA-S05` — **Lakeside stilt-house village** | Houses aligned along channels, canoes and walkways | Lake and delta zones, T |
| P1 | `AS-SEA-S06` — **River market town** | Quays, streets parallel to water and shrine | Mekong/Chao Phraya/Irrawaddy, M/T |
| P1 | `AS-SEA-S07` — **Cham shrine-tower centre** | Ritual buildings on high ground and dispersed housing | Champa, seventh–fifteenth centuries |
| P2 | `AS-SEA-S08` — **Lao/Thai monastery town** | Temple in enclosure, compact town near rice fields | Thirteenth–fifteenth centuries and later traditions |
| P2 | `AS-SEA-S09` — **Dry plateau village** | Lower buildings, open courtyards and wells | Mainland highlands, T |
| P3 | `AS-SEA-S10` — **Hydraulic island/lagoon metropolis** | Causeways, dikes, artificial islands and broad basins | Rare, strongly site-dependent |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AS-SEA-B01` — **Monsoon stilt house** | Rectangle on posts, one raised floor, stairs | Timber and bamboo, woven panels | Steep gable/hip thatch |
| P0 | `AS-SEA-B02` — **Low bamboo house** | One-storey rectangle, gallery | Bamboo posts and partitions | Palm/thatch, long overhangs |
| P1 | `AS-SEA-B03` — **Thai/Lao stilt house** | Rectangles grouped around open platform | Timber on stilts, boards | Large steep gable roof, regional details |
| P1 | `AS-SEA-B04` — **Traditional Vietnamese courtyard house** | Long rectangle, courtyard and outbuildings | Timber, earth/brick, bamboo | Tiles and eaves |
| P1 | `AS-SEA-B05` — **Khmer village house** | Rectangle on stilts, exterior stairs | Timber and light panels | Vegetal hip or gable roof |
| P1 | `AS-SEA-B06` — **Khmer prasat** | Square sanctuary, nested galleries and courtyards | Sandstone/laterite/brick | Towers in receding tiers, corbelled vaults |
| P1 | `AS-SEA-B07` — **Burmese stupa / zedi** | Square or round base, diminishing terraces | Masonry brick and plaster | Dome and slender spire |
| P1 | `AS-SEA-B08` — **Cham brick tower** | Square with axial door and decorated base | Laid fired brick | Receding tower, carved facing |
| P1 | `AS-SEA-B09` — **Timber-pavilion monastery** | Rectangular halls around courtyard | Timber, posts and raised floor | Multiple steep roofs, tiles or thatch |
| P2 | `AS-SEA-B10` — **Ceremonial hall with superimposed roofs** | Rectangle/long volume on base | Timber or masonry depending on tradition | 2–4 superimposed roofs, sharp gables |
| P2 | `AS-SEA-B11` — **Rice granary on stilts** | Small isolated square/rectangle | Timber/bamboo on tall posts | Very large overhanging vegetal roof |
| P2 | `AS-SEA-B12` — **Floating pavilion or water hall** | Long rectangle on floats or piles | Bamboo and timber | Light palm roof |
| P3 | `AS-SEA-B13` — **Raised ritual library** | Small square on base/stilts | Timber/stone depending on temple | Slender roof, peripheral building |

**Note:** Angkor urbanism combines **basins, dikes, canals, causeways and monumental cores**. Ordinary housing materials must remain distinct from temple materials.

## 20. Insular and maritime Southeast Asia — Java, Bali, Sumatra, Sulawesi, Borneo, Philippines `AS-ISL`

**Scope and signature:** Local A → M/T. Timber or bamboo, stilts, large communal houses, curved/very tall roofs, courtyard pavilions, stone temples in Java. Many surviving vernacular examples are late: medieval reconstructions require caution.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AS-ISL-S01` — **Austronesian stilt village** | Separate houses linked by paths, quays/walkways | Tropical archipelagos, T |
| P1 | `AS-ISL-S02` — **Borneo longhouse village** | A few long houses parallel to river, landing stages | Borneo, long traditions documented late |
| P1 | `AS-ISL-S03` — **Toraja family-house village** | Facing rows of houses and granaries, ceremonial square | Sulawesi, T |
| P1 | `AS-ISL-S04` — **Balinese compound village** | Multi-pavilion family enclosures, regular paths | Bali, long tradition |
| P1 | `AS-ISL-S05` — **Javanese courtyard village** | Family courtyard, main house and workshops | Java, M/T |
| P1 | `AS-ISL-S06` — **Malay riverside village** | Spaced stilt houses around orchards | Malaysia/Sumatra, T |
| P1 | `AS-ISL-S07` — **Javanese royal town** | Palace enclosures, public squares and separate temples | Hindu-Buddhist kingdoms, eighth–fifteenth centuries |
| P2 | `AS-ISL-S08` — **Aligned Nias village** | Large central/paved axis, rows of houses | Nias, historical traditions, late examples |
| P2 | `AS-ISL-S09` — **Fortified Indonesian highland village** | Ridge houses and enclosures, megaliths | Several islands, local traditions |
| P2 | `AS-ISL-S10` — **Nusantaran coastal trading town** | Stilt houses/warehouses, wooden quays | Archipelago ports, M |
| P3 | `AS-ISL-S11` — **Village on a large shared platform** | Communal house(s), pontoons and courtyards | Localised archipelago traditions |
| P3 | `AS-ISL-S12` — **Monumental saddle-roof village** | Highly ordered rows of large pavilions | Typical Toraja imagery; date historical configuration |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AS-ISL-B01` — **Austronesian stilt house** | Rectangle on platform, one habitable storey | Timber posts, bamboo, vegetal partitions | Very steep palm gable roof |
| P1 | `AS-ISL-B02` — **Borneo longhouse** | Very long rectangle of dozens of bays | Timber on stilts, partitioned into cells | Long thatch/shingle covering |
| P1 | `AS-ISL-B03` — **Toraja tongkonan** | Tall rectangle on stilts, platform between columns | Timber frame, decorated panels | Very large saddle roof with upturned ends |
| P1 | `AS-ISL-B04` — **Alang (Toraja granary)** | Small rectangle facing tongkonan | Timber on posts | Smaller saddle roof |
| P1 | `AS-ISL-B05` — **Balinese compound house** | Separate small rectangles inside enclosure wall | Low masonry, timber and bamboo | Vegetal/clay tiles, small roofs |
| P1 | `AS-ISL-B06` — **Javanese joglo (central hall)** | Central square with four pillars plus annexes | Timber frame on major posts | Tall central pyramid with compound slopes |
| P1 | `AS-ISL-B07` — **Raised Malaysian house** | Rectangle with gallery and veranda, raised floor | Timber/bamboo on posts | Large palm/tile gable roof |
| P1 | `AS-ISL-B08` — **Javanese candi temple** | Square sanctuary on stepped base | Volcanic stone, dressed blocks | Ascending stepped volumes |
| P2 | `AS-ISL-B09` — **Nias house / omo hada** | Rectangle or oval on strong stilts | Large slanting timber posts and joints | Very tall gable roof with raised ends |
| P2 | `AS-ISL-B10` — **Minangkabau rumah gadang** | Wide rectangle, several bays | Timber frame with pillars | Curved horn roofs; known forms mainly late |
| P2 | `AS-ISL-B11` — **High-gabled Batak house** | Large rectangle on stilts | Timber, decorated façades | Tall curved roof and projecting gables |
| P2 | `AS-ISL-B12` — **Multi-tier Balinese hall/temple** | Square/small rectangle on base | Timber pillars and masonry | *Meru* roof stacked in diminishing tiers |
| P3 | `AS-ISL-B13` — **Large tambaran-like house** | Very tall rectangular gathering space | Timber frame and woven panels | Exceptionally tall façade/ridge, specify region |
| P0 | `AS-ISL-B14` — **Javanese kampung house** | Enclosed rectangular residential body, one storey; artistic procedural dimensions | Timber frame, timber/bamboo walls; inspired assembly | Gable roof and triangular gables; tile covering |
| P1 | `AS-ISL-B15` — **Javanese limasan house** | Enclosed rectangular residential body, one storey; artistic procedural dimensions | Timber frame, timber/bamboo walls; inspired assembly | Four slopes with ridge; tile covering, without joglo tumpang sari |

B14/B15: see the [source dossier and artistic parameters](sources/javanese-domestic-architecture.md). Late surveys establish forms and examples, not a universal range or strict ancient/medieval reconstruction. Initial recipes remain simple bodies without generated emper, gallery or annex.

**Note:** The **longhouse** and **tongkonan** are *social complexes*, not merely distinctive roofs: orient rows, river access, granaries and ritual spaces accordingly.

## 21. Oceania and the Pacific — Melanesia, Polynesia, Micronesia, Aotearoa `OC-PAC`

**Scope and signature:** Local A → M/T; examples studied through recent periods. Many buildings use perishable materials, but there are also megalithic monuments, *marae/ahu* and the island city of Nan Madol. Oceanian types vary greatly between islands.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `OC-PAC-S01` — **Polynesian coastal village** | Rectangular/oval houses near trees and beach | Polynesia, T |
| P1 | `OC-PAC-S02` — **Melanesian central-square village** | Houses and large ritual house around shared space | Melanesia, varies by island |
| P1 | `OC-PAC-S03` — **Canoe / mangrove village** | Stilts/bridges and boat launching areas | Humid coastal areas, T |
| P1 | `OC-PAC-S04` — **Fortified Māori pā** | Ridge terraces, palisades, ditches, dwellings | Aotearoa, pre-contact and later |
| P1 | `OC-PAC-S05` — **Unfortified Māori village** | Houses in enclosures, gardens, storage areas | Aotearoa, pre-contact |
| P1 | `OC-PAC-S06` — **Papuan plateau village** | Houses near gardens, major ridge routes | New Guinea, local traditions |
| P1 | `OC-PAC-S07` — **Polynesian ceremonial centre** | Scattered dwellings around *marae* or sacred terrace | Polynesian islands, T |
| P2 | `OC-PAC-S08` — **Stone-platform house village** | Lava terraces and enclosures, ritual sites | Volcanic islands, T |
| P2 | `OC-PAC-S09` — **Spirit-house village** | Large ceremonial hall separate from dwellings | Papua, local traditions |
| P3 | `OC-PAC-S10` — **Nan Madol — megalithic islets** | 100+ artificial islets, canals and large basalt walls | Pohnpei, c. 1200–1500 |
| P3 | `OC-PAC-S11` — **Ritualised island chiefs' village** | Elite enclosures, courtyards and canal access | Micronesia, specific sites |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `OC-PAC-B01` — **Open Samoan fale** | Oval/rectangle under a roof, open sides | Timber posts and vegetal lashings | Domed/hipped thatch roof |
| P1 | `OC-PAC-B02` — **Polynesian thatched house** | Rectangle/oval and low terrace | Timber posts, mats and vegetation | Very steep hipped palm roof |
| P1 | `OC-PAC-B03` — **Pre-contact Māori whare** | Small low rectangle with threshold and porch | Timber frame, vegetal panels | Thatched/reed gable roof |
| P1 | `OC-PAC-B04` — **Raised Māori pātaka** | Small square/rectangle on carved posts | Timber frame | Vegetal gable roof |
| P1 | `OC-PAC-B05` — **Fijian chief's house / bure** | Fairly large rectangle or oval | Timber, weaving and vegetation | Steep palm/thatch roof |
| P1 | `OC-PAC-B06` — **New Guinea ritual hall** | Very long/tall rectangle with prominent façade | Timber, bamboo, weaving | Extremely pronounced gable roof |
| P1 | `OC-PAC-B07` — **Marae / ahu platform** | Large stone rectangle, open square | Stone/basalt blocks | No roof; ritual enclosure |
| P2 | `OC-PAC-B08` — **Lagoon stilt house** | Light rectangle on piles | Local timber and bamboo | Vegetal hip roof, adjoining pontoon |
| P2 | `OC-PAC-B09` — **Melanesian vegetal-shell house** | Oval with low entrance | Vegetal arches, branches | Continuous thatched vault |
| P2 | `OC-PAC-B10` — **Rapanui hare paenga** | Very long boat-shaped plan, front threshold | Basalt base, timber and reeds | Low vegetal-shell roof |
| P2 | `OC-PAC-B11` — **Carved ceremonial house** | Long rectangle with front gallery | Carved timber posts and panels | Decorated gable roof; surviving forms often late |
| P3 | `OC-PAC-B12` — **Nan Madol megalithic enclosure** | Tall rectangular walls on artificial islet | Basalt columns and coral | Open spaces, occasional built features |
| P3 | `OC-PAC-B13` — **Funerary monument on platform** | Stone base and access wall | Basalt/coral stone | Unroofed structure, depends on local ritual |

**Note:** For a **Māori pā**, palisades and terraces are constituent settlement elements. At **Nan Madol**, the islet/canal is the primary module rather than an individual house plot.

## 22. Aboriginal Australia and the Torres Strait Islands `OC-AUS`

**Scope and signature:** Long prehistory → fifteenth century and later continuity. **Great local diversity**: temporary shelters, waterside villages, stone structures and extensive aquaculture systems. Avoid treating “nomadic camp without architecture” as a universal model.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `OC-AUS-S01` — **Camp of vegetal hut groups** | Small shelters spaced around hearths with paths to water | Varying regions and seasons, T |
| P1 | `OC-AUS-S02` — **Lagoon fishing settlement** | Clusters near banks and capture points | Wet and coastal regions, T |
| P1 | `OC-AUS-S03` — **Gunditjmara aquaculture landscape** | Hierarchical canals, dams, ponds and dikes in lava flows | Budj Bim, southeastern Australia, several millennia |
| P1 | `OC-AUS-S04` — **Village with stone structures** | Groups of small enclosures and huts near stable resources | Specific southeastern sites, T |
| P2 | `OC-AUS-S05` — **Coastal village of large vegetal houses** | Oval/long volumes around a beach | Tropical Australia, local variations |
| P2 | `OC-AUS-S06` — **Torres Strait island village** | Vegetal houses on high ground and coastal paths | Torres Strait, T |
| P2 | `OC-AUS-S07` — **Rock-shelter camp** | Dwellings partly against cliffs, separate hearths | Continental rocky areas, T |
| P3 | `OC-AUS-S08` — **Settlement integrated with fish traps** | Discontinuous habitation linked to pond/channel networks | Specialised wetlands, T |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `OC-AUS-B01` — **Branch and bark shelter** | Small oval/rectangle, sometimes very open | Poles and bark sheets | Lean-to or low vegetal vault |
| P0 | `OC-AUS-B02` — **Domed foliage shelter** | Disc/oval, side entrance | Branch hoops and leaves | Rounded vegetal shell |
| P1 | `OC-AUS-B03` — **Local stone hut** | Small round or oval plan, low wall | Dry-laid basalt/local rock | Hypothetical/configurable vegetal covering |
| P1 | `OC-AUS-B04` — **Aquaculture canal wall** | Curved/branching linear structure | Dry-laid volcanic stones | No roof; sills and sluices |
| P1 | `OC-AUS-B05` — **Stone fish trap** | Basins/annular footprints in water | Low stone walls and dikes | Landscape structure, not a building |
| P2 | `OC-AUS-B06` — **Plateau post shelter** | Light rectangle with sheltered side | Timber posts, fibres, vegetation | Simple gable roof |
| P2 | `OC-AUS-B07` — **Large coastal vegetal hut** | Elongated oval | Arched frame and vegetal matting | Continuous thick-leaf roof |
| P3 | `OC-AUS-B08` — **Outdoor meeting platform** | Prepared square/earth platform, grouped hearths | Ground, stone and temporary structures | No fixed roof |

**Note:** **Budj Bim** is primarily **hydroecological infrastructure**. Its elaborate networks developed over millennia; specific dwelling forms require local sources.

## 23. Arctic and Subarctic America — Inuit, Yupik, Aleut and neighbouring peoples `AM-ARC`

**Scope and signature:** Local A → M/T. Housing is **highly seasonal**, often semi-subterranean in winter, with tents for travel and snow shelters in some areas. Snow igloos are not universal year-round Inuit dwellings.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-ARC-S01` — **Summer tent camp** | Small spaced units around shore or resource | Arctic and Subarctic, warm season |
| P1 | `AM-ARC-S02` — **Semi-subterranean winter village** | Clusters of dwellings with narrow vestibules, separate storage | Alaska and Arctic, T |
| P1 | `AM-ARC-S03` — **Aleut maritime village** | Partly buried dwellings in a coastal strip | Aleutian Islands, T |
| P1 | `AM-ARC-S04` — **Sea-ice hunting camp** | Small temporary units on snow or coast | Winter, particular regions |
| P1 | `AM-ARC-S05` — **Subarctic river village** | Timber/bark huts and drying areas | Boreal forests, T |
| P2 | `AM-ARC-S06` — **Communal-house hamlet** | Large divided houses, shared entrances | North American Arctic, local traditions |
| P2 | `AM-ARC-S07` — **Transitional tent and snow camp** | Mixed light shelters and seasonal storage | Spring/autumn travel |
| P3 | `AM-ARC-S08` — **Dune-backed turf village** | Houses in depressions near shore | Specific Arctic sites |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-ARC-B01` — **Arctic skin tent** | Disc/oval, one sleeping space | Poles/bones and stretched skins | Textile dome or cone |
| P1 | `AM-ARC-B02` — **Semi-subterranean turf house** | Rectangle/oval below ground, entrance tunnel | Turf, stones, driftwood/bone | Massive insulated turf roof |
| P1 | `AM-ARC-B03` — **Driftwood and earth house** | Low rectangle with vestibule | Driftwood, earth and stones | Turf covering |
| P1 | `AM-ARC-B04` — **Qarmaq / seasonal shelter** | Small semi-subterranean rectangle/oval | Stone/turf/skin and timber supports | Skin roof or mixed covering |
| P1 | `AM-ARC-B05` — **Snow igloo** | Small disc with entrance corridor and dome | Compacted snow blocks | Snow dome, temporary/seasonal |
| P1 | `AM-ARC-B06` — **Aleut semi-subterranean house** | Large buried oval/rectangle | Driftwood, turf and bone | Vegetated dome/terrace |
| P2 | `AM-ARC-B07` — **Subarctic bark shelter** | Oval or low tent | Poles, bark and skins | Cone or lean-to |
| P2 | `AM-ARC-B08` — **Coastal drying structure** | Long open rectangle on posts | Driftwood/bone | Slatted surfaces without continuous roof |
| P2 | `AM-ARC-B09` — **Raised cache** | Small square on posts | Driftwood or poles | Light covering, difficult access |
| P3 | `AM-ARC-B10` — **Long Arctic communal dwelling** | Large low semi-excavated rectangle, bays | Timber/earth/stone/bone | Turf roof with access tunnels |

## 24. North America — Northeast Woodlands, Great Lakes and Plains `AM-WOODS`

**Scope and signature:** Local A → M/T. **Longhouses** in farming communities, palisaded villages, wickiups/wigwams in some areas, tipis on the Plains. Wigwams and tipis have different geometries; tipis were not universal before the arrival of horses.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-WOODS-S01` — **Forest hut hamlet** | Small units under trees, paths and gardens | Woodlands, varying periods |
| P1 | `AM-WOODS-S02` — **Longhouse farming village** | Large parallel houses and gardens, optional palisade | Haudenosaunee and neighbouring societies depending on period |
| P1 | `AM-WOODS-S03` — **Palisaded Northeast village** | Palisade ring/oval with long dwellings inside | Iroquoian regions, M/T |
| P1 | `AM-WOODS-S04` — **Mobile Plains camp** | Tipis in circle or arc, livestock/resources and circulation | Plains, varying traditions and seasons |
| P1 | `AM-WOODS-S05` — **Plains earth-lodge village** | Large round huts grouped with fields and square | Mandan/Hidatsa and neighbours, local traditions |
| P1 | `AM-WOODS-S06` — **Lakeside forest village** | Huts and light docks under vegetation | Great Lakes region, T |
| P2 | `AM-WOODS-S07` — **Subarctic hunting camp** | Small portable shelters and raised stores | Boreal regions, T |
| P2 | `AM-WOODS-S08` — **Council-house village** | Enlarged ceremonial longhouse and gathering square | Northeast, local traditions |
| P3 | `AM-WOODS-S09` — **Fortified promontory village** | Ditches, palisade and short internal streets | Defensive sites, T |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-WOODS-B01` — **Domed wigwam / wickiup** | Small round/oval plan | Sapling hoops, mats/bark | Low bark/vegetal shell |
| P1 | `AM-WOODS-B02` — **Iroquoian longhouse** | Very long rectangle, successive hearths | Hoops/posts and bark panels | Barrel vault or rounded gable |
| P1 | `AM-WOODS-B03` — **Plains tipi** | Circular plan with oriented entrance | Long poles and skins, later other fabrics | Tall portable textile cone |
| P1 | `AM-WOODS-B04` — **Plains earth lodge** | Large-diameter circle, vestibule | Timber posts, hurdles, thick earth | Low turf-covered dome |
| P1 | `AM-WOODS-B05` — **Bark longhouse** | Long rectangle with low frames | Post frame and large bark sheets | Very shallow gable roof |
| P1 | `AM-WOODS-B06` — **Council house** | Widened long rectangle | Posts and bark/timber | Curved roof, communal hearth/entrance |
| P2 | `AM-WOODS-B07` — **Branch wickiup** | Small oval | Poles and thatch/brush | Simple dome |
| P2 | `AM-WOODS-B08` — **Raised food cache** | Small rectangle on 4–6 posts | Timber and ropes | Light roof, removable ladder |
| P2 | `AM-WOODS-B09` — **Village palisade** | Thick ring with one or more gates | Planted logs, defensive ditch | No continuous cover |
| P3 | `AM-WOODS-B10` — **Ceremonial sweat lodge** | Small low dome | Flexible arches, blankets/skins | Temporary shell, ceremonial feature |

**Note:** *Tipis* were mobile dwellings attested before colonisation in several regions, but later imagery of equestrian camps must not be applied everywhere or to every period.

## 25. North American Southwest — Ancestral Pueblo, Hohokam, Mogollon `AM-PUEB`

**Scope and signature:** Local A → M. **Adobe/stone** buildings, stacked cells, courtyards/kivas, mesa and cliff villages; irrigation in desert basins. Chaco (ninth–thirteenth centuries) and Taos (late thirteenth century onward) are distinct complexes.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-PUEB-S01` — **Terraced-house pueblo** | Clustered rectangles/storeys around courtyards | Arizona/New Mexico, M |
| P1 | `AM-PUEB-S02` — **Chacoan Great House** | Huge segmented arc/rectangular plan, large courtyard and kivas | Chaco Canyon, ninth–thirteenth centuries |
| P1 | `AM-PUEB-S03` — **Mesa Verde cliff village** | Dense cells under rock overhangs, vertical passages | Twelfth–thirteenth centuries, Colorado Plateau |
| P1 | `AM-PUEB-S04` — **Mesa pueblo** | Cluster of blocks on a flat summit | Arid Southwest, M |
| P1 | `AM-PUEB-S05` — **Irrigated Hohokam town** | Residential clusters near canals, courtyards and platforms | Arizona, local ancient/medieval periods |
| P1 | `AM-PUEB-S06` — **Riverside pueblo** | Two or more multi-storey masses separated by courtyard/river | Rio Grande, thirteenth century onward |
| P2 | `AM-PUEB-S07` — **Semi-subterranean pithouse village** | Small excavated oval/rectangular cells | Earlier forms, local A |
| P2 | `AM-PUEB-S08` — **Central-kiva village** | Dwellings around edge, round ritual chambers in centre | Chaco/Pueblo, M |
| P3 | `AM-PUEB-S09` — **Giant cliff palace** | Large alcove complex beneath cliff | Mesa Verde, exceptional site |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-PUEB-B01` — **Adobe pueblo house** | Compact rectangle, 1–3 storeys | Adobe and earth plaster | Flat timber and earth roof |
| P1 | `AM-PUEB-B02` — **Stepped multi-storey pueblo block** | Stepped cells, ladder access | Adobe or stone/earth | Flat roofs used for circulation |
| P1 | `AM-PUEB-B03` — **Masonry Great House** | Large curve/square with hundreds of rooms | Dressed sandstone and earth mortar | Flat roofs with timber beams |
| P1 | `AM-PUEB-B04` — **Ritual kiva** | Semi-subterranean disc, benches and pit | Stone and earth, timber pillars | Flat roof/frame, vertical access |
| P1 | `AM-PUEB-B05` — **Cliff dwelling** | Adjoining rectangles under natural vault | Sandstone and earth masonry | Overhang shelter, flat roofs |
| P1 | `AM-PUEB-B06` — **Pithouse** | Excavated rounded rectangle | Earth, posts and timber | Low branch/earth covering |
| P1 | `AM-PUEB-B07` — **Hohokam platform and courtyard** | Enclosed courtyard or earthen terrace | Adobe / unfired brick | Open above, perimeter walls |
| P2 | `AM-PUEB-B08` — **Pueblo tower house** | Narrow square/rectangle, 2–3 storeys | Sandstone/stone and earth | Compact flat roof |
| P2 | `AM-PUEB-B09` — **Cliff granary** | Small rectangle high in alcove | Stone/earth | Rock-protected roof |
| P3 | `AM-PUEB-B10` — **Combined houses and kiva** | Rectangular block against large disc | Stone/earth | Perimeter terraces, central opening |

## 26. North America — Mississippian tradition and major mound centres `AM-MISS`

**Scope and signature:** Mainly c. 800–1400. Large **mounds** are artificial topography to incorporate into generation; ordinary dwellings are smaller and made of timber/earth/thatch. Cahokia was not a city of stone pyramids.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-MISS-S01` — **Palisaded house village** | Rectangular houses around small squares | Central/eastern North America, local M |
| P1 | `AM-MISS-S02` — **Mississippian mound centre** | Open plaza, platform mounds, palaces/temples on top | Cahokia and related sites, c. 800–1400 |
| P1 | `AM-MISS-S03` — **Mound satellite village** | Houses and gardens linked to major ceremonial centre | River valleys, local M |
| P1 | `AM-MISS-S04` — **Palisaded Mississippian settlement** | Defensive ring and central ceremonial plaza | Localised sites, local M |
| P2 | `AM-MISS-S05` — **Alignment/astronomy centre** | Plazas, mounds and post circles | Mississippian tradition depending on region |
| P2 | `AM-MISS-S06` — **Levee riverside village** | Houses near river with granaries and fields | Mississippi/Ohio, M |
| P3 | `AM-MISS-S07` — **Large Cahokia-type regional city** | Hierarchical platforms, production areas and suburbs | Exceptional site, eleventh–thirteenth centuries |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-MISS-B01` — **Rectangular Mississippian house** | One-storey rectangle, interior hearth | Posts/earth, wattle and daub | Thatched gable roof |
| P1 | `AM-MISS-B02` — **House on a mound** | Ceremonial rectangle on artificial platform | Timber and daub | Sloping vegetal roof |
| P1 | `AM-MISS-B03` — **Great chief's hall** | Large rectangle with portico | Strong posts, daub | Large gable roof |
| P1 | `AM-MISS-B04` — **Platform mound** | Large terraced rectangle/oval with earthen slopes | Fill, steps or ramps | Open summit or light building |
| P1 | `AM-MISS-B05` — **Enclosure palisade** | Closed curve and gates | Timber logs, ditch | No continuous roof |
| P2 | `AM-MISS-B06` — **Funerary platform** | Small round or conical mound | Earth fill | No permanent roof |
| P2 | `AM-MISS-B07` — **Woodhenge post circle** | Ring of aligned posts | Large timber posts | No roof |
| P2 | `AM-MISS-B08` — **Associated granary house** | Small rectangle separate from houses | Timber, earth, raised storage | Small thatched roof |
| P3 | `AM-MISS-B09` — **Large multi-tier mound** | Stepped truncated earthen pyramid | Compacted fill mass | Upper esplanade, possible temple |

## 27. Mesoamerica — Olmec, Teotihuacan, Zapotec, Maya, Toltec, Mexica `AM-MESO`

**Scope and signature:** Local A → fifteenth century. Beyond **stepped temples**, there are thatch and earth villages, domestic courtyard complexes, ritual plazas, ball courts and some canal cities. Never replace ordinary neighbourhoods with pyramids.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-MESO-S01` — **Mesoamerican dispersed-house village** | Small houses around patios and gardens, organic paths | Mexico/Central America, T |
| P1 | `AM-MESO-S02` — **Maya city with ceremonial plazas** | Platform/pyramid core and plazas, dispersed peripheral dwellings | Maya areas, Classic and Postclassic periods |
| P1 | `AM-MESO-S03` — **Orthogonal Teotihuacan** | Monumental axes, repeated residential quadrangles | Central Mexico, first–seventh centuries |
| P1 | `AM-MESO-S04` — **Zapotec mountain city** | Summit terraces, great plaza, platforms | Monte Albán and related sites, local A |
| P1 | `AM-MESO-S05` — **Mexica island and causeway city** | Lakeside districts, canals, dikes and sacred precinct | Tenochtitlan, fourteenth–sixteenth centuries |
| P1 | `AM-MESO-S06` — **Lowland Maya village** | Houses on small platforms, patios and vegetation | Yucatán/Guatemala, T |
| P1 | `AM-MESO-S07` — **Fortified Postclassic Maya town** | More compact core, defensive walls and plazas | Postclassic, local M |
| P2 | `AM-MESO-S08` — **Olmec earth-platform centre** | Esplanades, mounds and ceremonial core | Gulf of Mexico, local A |
| P2 | `AM-MESO-S09` — **Puuc-style Maya town** | Palace quadrangle sequences with elaborate façades | Yucatán, eighth–tenth centuries |
| P2 | `AM-MESO-S10` — **Central-ballcourt town** | Plazas with large I-shaped courts, ritual districts | Several civilisations, specific periods |
| P3 | `AM-MESO-S11` — **Jungle Maya city with causeways** | Separate monumental temples, *sacbeob* and dispersed dwellings | Major sites, exceptional pattern |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-MESO-B01` — **Rural vegetal Maya house** | Rounded rectangle or oval, patio | Timber posts, wattle/plaster | Large hipped palm/thatch roof |
| P1 | `AM-MESO-B02` — **Mesoamerican platform house** | Light rectangle on earth/stone base | Timber, earth, small rubble stones | Steep vegetal roof |
| P1 | `AM-MESO-B03` — **Teotihuacan residential compound** | Large rectangle with several courtyards and room suites | Stone/adobe and painted plaster | Flat terraces and composite volumes |
| P1 | `AM-MESO-B04` — **Urban adobe house** | Small adjoining rectangles and patios | Unfired brick and stone | Flat or shallow-pitched roofs |
| P1 | `AM-MESO-B05` — **Mesoamerican temple pyramid** | Square/rectangular base, steps to small cella | Faced earth/stone | Flat summit, roofed sanctuary |
| P1 | `AM-MESO-B06` — **Corbel-vaulted Maya temple** | Small massive rectangle on base | Stone masonry and stucco | Corbelled vault, possible large roof comb |
| P1 | `AM-MESO-B07` — **Many-doored Maya palace** | Very long rectangle, galleries and courtyards | Stone/stucco, masonry supports | Flat roofs and corbelled vaults |
| P1 | `AM-MESO-B08` — **Ball court** | Long open I or double T, side walls | Masonry stone and plaster | No roof, sloping walls |
| P1 | `AM-MESO-B09` — **Double Mexica temple** | Large platform with two summit shrines | Stone and plastered masonry | Axial steps, two small buildings |
| P2 | `AM-MESO-B10` — **Maya house on limestone base** | Rectangle with porch | Limestone rubble, timber beams | Vegetal thatch |
| P2 | `AM-MESO-B11` — **Puuc façade with geometric mosaics** | Rectangular palace block | Cut stone and carved facing | Dense upper façade frieze |
| P2 | `AM-MESO-B12` — **Great quadrangle palace** | Central courtyard and peripheral rooms | Stone/adobe/stucco | Porticos, flat roofs |
| P3 | `AM-MESO-B13` — **Chinampa lake complex** | Dwellings on islets, rectangular gardens and canals | Stakes, imported earth, plants | Light houses with vegetal roofs |

## 28. Andes — Tiwanaku, Wari, Moche/Chimú and Inca Empire `AM-AND`

**Scope and signature:** Local A → fifteenth–early sixteenth centuries. **Kancha** (courtyard surrounded by rectangular buildings), Andean masonry, hillside terraces, state plazas; on the desert coast, substantial adobe cities. An Inca city is not a Maya pyramid city.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-AND-S01` — **Terraced Andean village** | Small stone/earth rectangles grouped on slope | Andean highlands, T |
| P1 | `AM-AND-S02` — **Inca imperial city** | Large plazas, kancha blocks, ceremonial areas | Fifteenth–early sixteenth centuries, Andes |
| P1 | `AM-AND-S03` — **Inca ridge centre** | Concentric/linear terraces, stairs, residential areas | Machu Picchu, fifteenth century |
| P1 | `AM-AND-S04` — **Inca valley town** | Relatively orthogonal grid adapted to relief, kancha courtyards | Ollantaytambo and state centres, fifteenth century |
| P1 | `AM-AND-S05` — **Chimú city of citadels** | Large walled rectangular complexes and controlled streets | Chan Chan, thirteenth–fifteenth centuries |
| P1 | `AM-AND-S06` — **Planned Tiwanaku centre** | Ritual platforms on cardinal axes, adobe districts | Altiplano, fourth–tenth centuries |
| P1 | `AM-AND-S07` — **Coastal earthen ceremonial city** | Large platforms and enclosures, adjacent housing areas | Pre-Inca Peruvian coast, local A |
| P2 | `AM-AND-S08` — **Wari partitioned-block centre** | Large orthogonal units and separate enclosures | Peruvian highlands, sixth–eleventh centuries |
| P2 | `AM-AND-S09` — **Inca agricultural estate** | Kanchas/terraces, isolated granaries and canals | Valleys and slopes, fifteenth century |
| P2 | `AM-AND-S10` — **Inca road stop / tambo** | Large enclosure, a few blocks and reception plaza | Andean road network, fifteenth century |
| P3 | `AM-AND-S11` — **Clay citadel with successive courtyards** | Strong enclosures, partitioned courtyards with controlled access | Chimú, monumental character |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-AND-B01` — **Rectangular Andean house** | One-storey rectangle, minimally partitioned interior | Rubble stone or adobe | Thatched gable roof |
| P1 | `AM-AND-B02` — **Inca kancha** | Rectangular enclosure with 3–8 buildings facing courtyard | Stone or adobe, trapezoidal door frames | Thatched gable roofs on separate bodies |
| P1 | `AM-AND-B03` — **Inca polygonal stone house** | Rectangle with precise facing | Dressed polygonal stone (prestige), or ordinary rubble | Vegetal gable roof |
| P1 | `AM-AND-B04` — **Inca kallanka** | Very long rectangle, several doors facing plaza | Stone/adobe, large timber frame | Large thatched gable roof |
| P1 | `AM-AND-B05` — **Qollqa / Inca granary** | Small ventilated circle or rectangle, regular rows | Stone/earth, dry floor | Thatch cone or gable |
| P1 | `AM-AND-B06` — **Andean agricultural terrace** | Long supported strip/polygon | Stone retaining walls, earth | No roof; channel |
| P1 | `AM-AND-B07` — **Chimú courtyard house** | Rectangle of rooms, courtyards and stores | Adobe / sculpted earth | Terraces, platforms and high walls |
| P1 | `AM-AND-B08` — **Inca plaza ushnu** | Rectangular platform with stairs | Masonry stone | Open summit, ritual context |
| P2 | `AM-AND-B09` — **Semi-subterranean Andean temple** | Sunken square courtyard | Monoliths and stone blocks, drainage | Open to sky |
| P2 | `AM-AND-B10` — **Prestige Inca polygonal wall** | Long wall with fitted joints, trapezoidal openings | Highly fitted irregular dressed stone | Façade, not a roof |
| P2 | `AM-AND-B11` — **Funerary chullpa** | Round or square tower, several metres high | Stone/adobe, internal chamber | Stone dome/terrace; burial |
| P2 | `AM-AND-B12` — **Platform Tiwanaku temple** | Large square with steps and courtyard | Dressed sandstone/andesite | Open summit and monument(s) |
| P3 | `AM-AND-B13` — **Stepped coastal huaca** | Mass of earthen terraces | Millions of unfired bricks, plaster | Platforms and ramps, not a dwelling |

**Note:** The assumption that the whole Inca Empire used grid streets is false: settlements are **adapted to topography**. A domestic **kancha** is first a *compound*, not a single building.

## 29. Amazonia, Orinoco, Caribbean and South American lowlands `AM-TROP`

**Scope and signature:** Before 1500 and long traditions, with highly variable archaeological evidence. Large vegetal communal houses, ring villages, riverside dwellings and earthworks. Do not assume absence of planning or hydraulic networks.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-TROP-S01` — **Tropical vegetal-house village** | Houses around a clearing or shared plaza | Amazonia/Caribbean, specific traditions |
| P1 | `AM-TROP-S02` — **Upper Xingu circular village** | Ring of dwellings around very large plaza, radial paths | Xingu basin, documented ancient traditions |
| P1 | `AM-TROP-S03` — **Amazonian large-house village** | A few malocas and adjoining gardens | Forest areas, local traditions |
| P1 | `AM-TROP-S04` — **Amazonian riverside village** | Houses along bank, canoes and crops | River basins, T |
| P1 | `AM-TROP-S05` — **Orinoco palafitte village** | Stilt houses and canoes, timber walkways | Delta/lagoons, local traditions |
| P1 | `AM-TROP-S06` — **Taíno batey village** | Houses around public plaza/ritual court | Greater Antilles, before 1492 |
| P2 | `AM-TROP-S07` — **Amazonian mound settlement** | Dwellings/plazas on artificial levees and mounds | Marajó and other regional systems, local A |
| P2 | `AM-TROP-S08` — **Forest longhouse village** | Separate large buildings, clearings and paths | Specific societies, T |
| P2 | `AM-TROP-S09` — **Savanna village with radial paths** | Core surrounded by ditches/levees and straight routes | Particular pre-Columbian sites |
| P3 | `AM-TROP-S10` — **System of causeway-linked villages** | Housing rings, geometric roads, earthworks | Southwestern Amazon / Upper Xingu depending on site |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-TROP-B01` — **Light palm house** | One-storey rectangle/oval | Timber posts, mats and hurdles | Deeply overhanging hipped palm roof |
| P1 | `AM-TROP-B02` — **Amazonian maloca** | Large communal rectangle/oval, hearth(s) and bays | Timber posts, poles, woven vegetation | Long continuous palm roof |
| P1 | `AM-TROP-B03` — **Circular Taíno house / bohío** | Disc, prominent entrance | Timber posts, woven vegetation | Palm cone/hip roof |
| P1 | `AM-TROP-B04` — **Taíno chief's longhouse / caney** | Large rectangle/oval facing plaza | Timber and fibre panels | Very large vegetal roof |
| P1 | `AM-TROP-B05` — **Lagoon stilt house** | Rectangle with raised platform | Timber piles, weaving | Light hipped palm roof |
| P1 | `AM-TROP-B06` — **Long Xingu house** | Oval or rounded rectangle, great height | Woven timber frame | Large hipped vegetal shell |
| P1 | `AM-TROP-B07` — **Batey plaza/court** | Large open quadrangle, possible stone borders | Compacted earth/stones | No roof |
| P2 | `AM-TROP-B08` — **Semi-open forest house** | Oval volume with incompletely enclosed side | Timber, posts, interior hammocks | Steep vegetal ridge |
| P2 | `AM-TROP-B09` — **Artificial Amazonian platform** | Large raised terrace polygon | Imported earth, edges | Light dwellings on top |
| P2 | `AM-TROP-B10` — **Raised granary/drying structure** | Small separate rectangle | Timber/bamboo on posts | Small palm roof |
| P3 | `AM-TROP-B11` — **Levee and causeway work** | Long raised earthen strip between districts | Earthworks, drains | No cover |

**Note:** **Maloca**, **bohío**, **caney** and **Xingu house** are not synonyms: their volumes may look similar from above, but community composition and placement rules differ.

## 30. Siberia and the boreal Far East — taiga, tundra and coasts `AS-SIB`

**Scope and signature:** Local A → M/T. Modular coverage of mobile and semi-permanent forms **specific to particular groups and climates**: chum, yaranga, log huts, raised caches; avoid calling everything a “yurt”.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AS-SIB-S01` — **Forest conical-tent camp** | A few units around a hearth/watercourse | Siberian taiga, T |
| P1 | `AS-SIB-S02` — **Large-tent tundra camp** | Spaced volumes, room for sledges/reindeer | Northern Siberia, seasonal |
| P1 | `AS-SIB-S03` — **Coastal semi-subterranean village** | Turf/timber dwellings side by side near shore | Chukotka and coasts, specific regions |
| P1 | `AS-SIB-S04` — **Taiga log village** | Low buildings along bank, wood stores | Forested regions, T |
| P2 | `AS-SIB-S05` — **Transhumant reindeer camp** | Portable tents, tethering circles, seasonal routes | Tundra/taiga, T |
| P2 | `AS-SIB-S06` — **Raised-house hamlet** | Raised dwellings/storage against damp/snow | Humid forest zones, T |
| P3 | `AS-SIB-S07` — **Underground-house village** | Excavated cells, protected corridors, hearths | Specific Far Eastern archaeological sites |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AS-SIB-B01` — **Conical chum** | Circle with implicit central post | Long poles, bark/skins/fabric | Portable sharp cone |
| P1 | `AS-SIB-B02` — **Chukchi yaranga** | Large circle with complex frame | Timber, reindeer skins, cables | Low dome/cone with interior insulation |
| P1 | `AS-SIB-B03` — **Taiga log house** | Small rectangle raised off ground | Corner-jointed logs | Bark/timber gable roof |
| P1 | `AS-SIB-B04` — **Coastal turf house** | Low partly buried rectangle | Driftwood and turf | Low vegetated vault/terrace |
| P1 | `AS-SIB-B05` — **Cache on posts** | Small square above ground | Timber and piles | Bark gable roof |
| P2 | `AS-SIB-B06` — **Compact skin tent** | Portable oval | Poles and skin membranes | Low stretched shell |
| P2 | `AS-SIB-B07` — **Split-wood hut** | Low rectangle, small vestibule | Timber slats and mud | Bark covering |
| P3 | `AS-SIB-B08` — **Complex semi-subterranean house** | Network of small excavated rooms | Timber, stone and earth | Flat vaults beneath mound |

## 31. North American Pacific Northwest — cedar coast and plank villages `AM-PNW`

**Scope and signature:** Before 1500 and later historical tradition. Large permanent lineage houses in **cedar planks**, beach axes and villages connected by canoe. Monumental façade totem poles are variably documented and partly late: make them an optional visual module.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-PNW-S01` — **Coastal longhouse village** | Rows of large rectangles parallel to shore, canoe space | British Columbia/Alaska/Washington State, T |
| P1 | `AM-PNW-S02` — **Continuous waterfront village** | Large houses near coast, woods and streams behind | Pacific Northwest, T |
| P1 | `AM-PNW-S03` — **Sheltered-bay village** | Long buildings aligned along beach, fishing stations | Bays and estuaries, T |
| P1 | `AM-PNW-S04` — **Seasonal fishing village** | Simple huts, drying racks and wooden docks | Seasonal migrations, T |
| P2 | `AM-PNW-S05` — **Large-clan village** | Several monumental houses associated with lineages | Specific cultures and places, T |
| P2 | `AM-PNW-S06` — **Salmon-river village** | Linear dwellings and capture/drying facilities | North Pacific rivers, T |
| P3 | `AM-PNW-S07` — **Potlatch ceremonial centre** | Prestige house and gathering plaza | Regional traditions, historical documentation |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-PNW-B01` — **Coastal plank longhouse** | Very large rectangle, bays and hearths | Cedar posts/beams, vertical planks | Long timber-plank gable roof |
| P1 | `AM-PNW-B02` — **Tall clan house** | Wide rectangle with axial façade | Large split timbers, carvable posts | Large timber gable roof |
| P1 | `AM-PNW-B03` — **Semi-subterranean coastal house** | Slightly excavated rectangle, common room | Cedar, earth backfill | Low plank roof |
| P1 | `AM-PNW-B04` — **Salmon drying rack** | Long open rectangle | Timber posts, wattle | Light plank/bark roof |
| P1 | `AM-PNW-B05` — **Shore windbreak** | Line of posts and panels | Timber planks | No roof or canopy |
| P2 | `AM-PNW-B06` — **Painted-façade house** | Long rectangle and central porch | Massive timber, decorated panels | Large gable roof with eaves |
| P2 | `AM-PNW-B07` — **Canoe shed** | Long rectangle open towards beach | Posts and planks | Shallow-pitched roof |
| P3 | `AM-PNW-B08` — **Nested house complex** | Large square/rectangle with added rooms | Cedar posts, planks | Joined roofs, varying heights |

## 32. Southern Cone and southern American foothills — Mapuche, Guaraní, Patagonia `AM-SOUTH`

**Scope and signature:** Before 1500, then traditions observed much later. Vegetal architecture, timber and earth in forested valleys; portable structures on cold plains. These ethnonyms encompass very strong differences.

### Settlement morphologies

| Priority | ID and archetype | Layout | Setting and period |
|---|---|---|---|
| P0 | `AM-SOUTH-S01` — **Forest-clearing hamlet** | Small units and fields, footpaths | Forested Southern Cone, T |
| P1 | `AM-SOUTH-S02` — **Mapuche ruka village** | Large spaced houses around communal space | South-central Chile/Argentina, T |
| P1 | `AM-SOUTH-S03` — **Guaraní large-house village** | Large communal house(s) and central clearing | Tropical/subtropical regions, T |
| P1 | `AM-SOUTH-S04` — **Mobile cold-plain camp** | Small skin shelters, seasonal arrangements | Patagonia, localised periods |
| P1 | `AM-SOUTH-S05` — **Guaraní riverside hamlet** | Dwellings along water and gardens | Paraná/Paraguay basin, T |
| P2 | `AM-SOUTH-S06` — **Lagoon-side village** | Low houses on high ground, canoes | Southern continent, depending on ecosystem |
| P2 | `AM-SOUTH-S07` — **Fuegian coastal camp** | Small spaced huts near shore | Tierra del Fuego, T |
| P3 | `AM-SOUTH-S08` — **Large ceremonial clearing** | Peripheral dwellings and open communal area | Verify site/culture for configuration |

### Building and complex morphologies

| Priority | ID and archetype | Footprint and elevation | Structure / walls | Roof / distinctive details |
|---|---|---|---|---|
| P0 | `AM-SOUTH-B01` — **Rural vegetal house** | Low oval/rectangle, one storey | Timber, earth/daub depending on region | Steep hipped thatch |
| P1 | `AM-SOUTH-B02` — **Mapuche ruka** | Large oval/rounded rectangle, communal room | Timber posts and vegetal panels | Very large continuous thatch roof |
| P1 | `AM-SOUTH-B03` — **Guaraní longhouse** | Very long rectangle with bays | Timber, foliage, lashed frame | Large hipped palm roof |
| P1 | `AM-SOUTH-B04` — **Patagonian toldo** | Small rectangle/oval with low access | Poles and stretched skins | Sloping or rounded membrane |
| P1 | `AM-SOUTH-B05` — **Fuegian domed hut** | Small disc/oval | Arched poles and bark/vegetation | Light vegetal dome |
| P2 | `AM-SOUTH-B06` — **Forest-village granero** | Small rectangle on supports | Posts and vegetation | Vegetal gable roof |
| P2 | `AM-SOUTH-B07` — **Coastal fishing shelter** | Elongated oval, sometimes open | Poles and skins/vegetation | Short lean-to |
| P3 | `AM-SOUTH-B08` — **Large gathering house** | Long rectangle, adjoining plaza | Large timber posts | Wide hip roof, group-dependent details |

---

# III. Prioritised index: styles to implement in the engine

**Primitive** priority and **cultural pack** priority are separate axes. A regional P1 style is not culturally “less important”: it contributes a strong signature but depends on general primitives already implemented. The levels below describe **development** order, not archaeological frequency or heritage value.

## III.1. P0 — Essential global architectural foundation

Before all 32 packs are fully operational, these **18 silhouettes/assemblies** already support diverse maps without artificially multiplying 3D objects.

| No. | Visual style | Shape | Structure / walls | Covering | Generator / related families |
|---|---|---|---|---|---|
| 01 | **Round earth and thatch hut** | Disc; one volume | Posts + daub or massive earth | Vegetal cone | European Iron Age, rural Africa, regional variants; `FP-ROUND` + `RF-CONE`. |
| 02 | **Oval hut with high hip roof** | Oval; single room | Timber, vegetation, earth plaster | Hipped thatch | Southern Africa, Oceania, vegetal traditions. |
| 03 | **Rectangular timber and daub house** | Rectangle; one storey | Timber framing, wattle | Thatched gable | Europe, temperate Asia, modest dwellings. |
| 04 | **Rural stone house** | Rectangle; 1–2 storeys | Local rubble | Gabled tiles, thatch or stone slabs | Europe, Mediterranean, Andes (adapt roof). |
| 05 | **Flat-roofed earth house** | Rectangle or square | Adobe, cob, rammed earth | Terrace and parapet | North Africa, Sahel, Middle East, northern India, Pueblo with variants. |
| 06 | **Shingled timber house** | Rectangle | Logs or frame | Steep wooden gable | Northern Europe, Siberia, Asian forests. |
| 07 | **Narrow multi-storey town house** | Narrow rectangle | Timber/daub, stone or brick | Gable roof; gable or eaves facing street | Dense European and Asian towns with variants. |
| 08 | **Stilt building** | Rectangle, raised terrace | Piles + posts/beams | Vegetal hip roof or tiles | Southeast Asia, southern China, Oceania, coasts. |
| 09 | **Enclosed courtyard house** | Ring, U or pavilions around void | Earth, stone, brick or timber | Peripheral roofs | *Siheyuan*, *kancha*, patio houses, compounds. |
| 10 | **Enclosed hut compound** | Several discs/ovals | Huts + earth, branch or timber fence | Separate conical roofs | Kraals, West African compounds, dispersed villages. |
| 11 | **Large communal house** | Very long rectangle | Large posts, timber, earth or vegetation | Long gable or hip roof | Eurasian, American and Asian longhouses. |
| 12 | **Dome / circular tent** | Disc | Timber/lattice frame, felt/skin membrane | Textile dome | Steppes, seasonal camps, many distinct variants. |
| 13 | **Partly subterranean dwelling** | Excavated rectangle/oval | Timber + earth + stone | Turf, earth or light covering | Cold regions, Arctic, ancient Europe, northern Asia. |
| 14 | **Palace house with axial pavilions** | Separate rectangular pavilions | Timber frame and enclosed courtyard | Roofs with deep eaves | China, Korea, Japan: specific dimensions and profiles. |
| 15 | **Tile-roofed temple house** | Rectangle/square on platform | Stone/brick + frame or timber posts | Hip or gable roof with overhangs | Sinicised world and neighbouring regional variants. |
| 16 | **Dense house with party walls** | Composite footprints, reduced courtyard | Stone, brick or earth | Connected terraces or several small roofs | Medina, Roman city, towns and fortified cities. |
| 17 | **Terraced monumental platform** | Nested rectangles | Earth, unfired brick, stone | Generally open to sky; possible summit temple | Mesoamerica, pre-Inca Andes, Mesopotamia (distinct forms). |
| 18 | **House with carved / very tall gable** | Large rectangle on posts or stilts | Carved timber, panels | Steep roof / tall gable | Insular Southeast Asia, regional Oceanian and Asian societies. |

**Rule:** a conical roof does not always imply an “African hut”, just as upturned eaves are not a generic attribute of all Asia. *Style* comes from combining **plan + material + roof + building composition + plot + environment**.

## III.2. P1 — Cultural packs essential for recognition

The following **20 presets** can provide an initial representative global coverage. Each row identifies an archetype to combine with its detailed pack in II.

| Desired signature | Reference settlement | Preferred building bodies | Decisive spatial cues |
|---|---|---|---|
| Pastoral enclosure village (*kraal*) | `AF-SOUTH-S01` and families | `AF-SOUTH-B01`, `AF-SOUTH-B02` | Circular/elliptical fences, livestock area, peripheral huts. |
| Sahel village | `AF-SAHEL-S01` | `AF-SAHEL-B01`, `AF-SAHEL-B02` | Earth compounds, rounded walls, open spaces. |
| Ancient Sahelian earth town | `AF-SAHEL-S03` | `AF-SAHEL-B05`, `AF-SAHEL-B07` | Compact plots, sculpted adobe masses, lanes. |
| Ksar or oasis village | `AF-MAG-S01`, `AF-MAG-S02` | `AF-MAG-B01` to `B04` | Clustered dwellings, party walls, terraces, palm grove. |
| Medieval European town | `EUR-MED-S01` | `EUR-MED-B01` to `B05` | Market street, deep plots, pitched roofs. |
| Iron Age oppidum | `ATL-CEL-S03` | `ATL-CEL-B01`, `ATL-CEL-B02` | Ramparts following terrain, low houses, enclosures. |
| Greco-Roman city | `MED-ANT-S02`, `MED-ANT-S03` | `MED-ANT-B01` to `B07` | Grid/axes, civic squares, courtyards, tile roofs. |
| Mesopotamian town | `AS-MIDE-S01` onward | `AS-MIDE-B01` to `B04` | Adobe blocks, inner courtyards, flat roofs. |
| Imperial Chinese city | `AS-CHI-S02` | `AS-CHI-B02`, `B03`, `B07` | N–S axis, hierarchical enclosures, courtyards and large roofs. |
| Southern Chinese village | `AS-CHI-S05`, `S07` | `AS-CHI-B08`, `B11` | Relief, courtyards/clans or stilts depending on subregion. |
| Ancient/medieval Japanese town | `AS-JAP-S02` onward | `AS-JAP-B01` to `B07` | Street-oriented plots, tile/timber roofs. |
| Ancient Indian city | `AS-IND-S01`, `S02` | `AS-IND-B01` to `B05` | Brick blocks and courtyards, drainage, structured streets. |
| Khmer temple city | `AS-SEA-S01` | `AS-SEA-B01` to `B05` | Water, large basins, causeways, enclosures and shrines. |
| Austronesian stilt village | `AS-ISL-S01`, `S02` | `AS-ISL-B01` to `B06` | Large vegetal roofs, stairs, shared courtyards. |
| Pacific coastal village | `OC-PAC-S01`, `S02` | `OC-PAC-B01` to `B07` | Aligned huts/pavilions, communal spaces. |
| North American pueblo | `AM-PUEB-S01`, `S02` | `AM-PUEB-B01` to `B05` | Terraced volumes, flat roofs, courtyards/plazas. |
| Mississippian mound city | `AM-MISS-S01`, `S02` | `AM-MISS-B01` to `B04` | Large earth platforms, plazas and surrounding dwellings. |
| Maya city of hills and plazas | `AM-MESO-S03` | `AM-MESO-B03` to `B08` | Ceremonial plazas, pyramids, palace groups. |
| Inca mountain city | `AM-AND-S02`, `S03` | `AM-AND-B01` to `B06` | Terraces, stone, *kanchas*, sloping vegetal roofs. |
| Amazonian large-house village | `AM-TROP-S01`, `S02` | `AM-TROP-B01` to `B05` | Central clearing, communal houses, forest paths. |

## III.3. P2 — Distinctive variants to introduce next

- **American Northwest:** large communal **cedar-plank** rectangles facing the beach (`AM-PNW`).
- **Newar Nepal:** **brick and carved timber** houses, courtyards and pagodas (`AS-HIM`).
- **Tibetan Himalayas:** compact stone/earth volumes, **flat roofs** and fortified villages (`AS-HIM`).
- **Medieval Swahili:** **coral and lime** masonry courtyards, coastal streets (`AF-EAST`).
- **Japan before 1500:** *machiya* and regional timber-frame houses, **without a modern-period castle keep by default** (`AS-JAP`).
- **Insular Southeast Asian great houses:** *tongkonan*, Minangkabau houses, Batak dwellings — **distinct saddle/horn roofs** (`AS-ISL`).
- **Hausa:** courtyard houses with earth volumes and regional decoration (`AF-SAHEL`).
- **Cliff Pueblo:** **cliff houses** and excavated/backed cells (`AM-PUEB`).
- **Chimú:** immense **walled adobe compounds** and successive courtyards (`AM-AND`).
- **Central Asian oases:** earthen districts, domes, caravanserais and courtyards (`AS-STEP`).
- **Nubia:** unfired-brick volumes and enclosures, various flat/vaulted roofs (`AF-NILE`).
- **Iroquoian complexes:** multiple large *longhouses* inside palisades (`AM-WOODS`).
- **Polynesia:** *marae* and assembly houses, open/closed depending on archipelago (`OC-PAC`).
- **Aboriginal Australia:** **fishing works, basins and canals** in inhabited landscapes rather than a fictitiously orthogonal city (`OC-AUS`).

## III.4. P3 — Rare, complex, exceptional or chronologically late

| Case | Why P3 | Required filter |
|---|---|---|
| `AS-CHI-B13` — Monumental tulou | Highly distinctive fortified multi-storey ring/square | Fujian; possible medieval origins, iconic examples mostly after 1500. |
| `AS-MIDE` — Shibam tower houses | Multi-storey unfired-brick elevation | UNESCO urban silhouette mainly **sixteenth century onward**. |
| `AS-JAP` — *Tenshu* castle keep | Large volume with tiered roofs | Keep-castle period, mainly **sixteenth–seventeenth centuries**. |
| `AF-MAG` — Large surviving ksour | Complex fortified earth plans | Visible construction/repairs often late; classify tradition and example separately. |
| `AM-PUEB` — Cliff-excavated dwellings | Subtractive volumetric geometry, vertical access | Site terrain and chronology required. |
| `AM-MESO` — Large monumental Maya complex | Multiple platforms, temples, friezes, ball courts | Culture/period and capital size; do not generate in every village. |
| `AM-AND-B10` — Prestige Inca polygonal masonry | Expensive details, invisible at small zoom | Reserve for high-status sites and exceptional facings. |
| `AS-CHI-B14` — Pavilion with nested roofs | Connected roofs, brackets and multiple galleries | High status; regional profile and period. |
| `AF-SOUTH` — Great Zimbabwe monumental enclosures | Curved dry-stone masses | Specific place/power, not a generic African village. |
| `OC-PAC` — Monumental funerary platforms | Massive, megalithic or island geometries | Specific island traditions, not all archipelagos. |
| `OC-PAC` — Nan Madol | Artificial islets and basalt walls | Unique site, specific waterside environment and chronology. |
| `AS-IND` — Excavated rock-cut temple | Negative volumes, terrain sculpture | Suitable geology and monumental construction. |

---

# IV. Ready-to-use generation presets

These **12 reference scenes** describe what a player should recognise on a village or city map. They are independent of individual building functions: cottages, granaries, temples, palaces, barracks and so on can then be instantiated. The suggested ratios are **visual heuristics**, not archaeological measurements.

| Preset | Settlement / structure | Top-down signature | Building modules / materials | Restriction and pitfall |
|---|---|---|---|---|
| **Pastoral kraal** | Circular/elliptical enclosure, livestock in centre or adjoining pen, controlled access | Large nested circles, 5–30 small round volumes around courtyard | Round earth/daub huts, conical/rounded thatch roofs, timber/branch fences | Depending on group, *kraal* may primarily mean livestock enclosure; **do not automatically equate domestic unit and village**. |
| **Sahel village** | Clustered compounds, central courtyard and irregular passages | Round and square volumes separated by large earth walls | Rammed earth, cob, adobe, timber frame and vegetal cover | Many differences between Mandé, Dogon, Hausa and other villages. |
| **Imperial Chinese city** | Main enclosure, N–S axis, palace zones, courtyard districts | Oriented rectangles, successive gates, large axial voids | Square/rectangular pavilions, 2/4-pitch tile roofs, timber/earth/brick | Do not fill every block with pagodas; status and period govern sophisticated roofs. |
| **Inca city** | Plazas, enclosed *kanchas*, streets/stairs adapted to relief | Rectangular blocks against terraces and courtyards | Stone/rubble/adobe; **thatched gable roofs**, not flat stone | Surviving walls are often roofless: reconstruct lost frames and coverings. |
| **Dense medieval town** | Main street, market, narrow blocks, sometimes a wall | Deep plots, small adjoining rectangles, alternating roofs | Timber frame/daub, stone, tiles, slate, thatch depending on setting | Distinguish northern timber towns and southern masonry towns; no universal European style. |
| **Hellenic polis / ancient city** | Agora, sanctuaries, more or less orthogonal districts | Domestic central courtyard, porticos on large plaza | Stone/earth masonry, stucco, tiles, courtyards | An ancient city does not necessarily have a perfect grid. |
| **Oasis medina** | Network of narrow lanes and dead ends, high compactness | Clusters of flat roofs and discreet patios | Unfired earth, stone/earth masonry, plaster, flat roofs | Distinguish Maghreb, Mashreq, southern Arabia and Sahara. |
| **Swahili stone city** | Network of lanes, gates and courtyards near coast | Small adjoining rectangles, patios, mosque and harbour frontage | Coral limestone, lime, timber, flat roofs and regional framing | Architecture specific to coastal towns, not all East Africa. |
| **Khmer hydraulic city** | Reservoirs/barays, dikes, causeways and temple enclosures | Long water lines, large rectangular walls, forest mass | Timber stilt/vegetal houses; stone monuments | Perishable residential buildings were very different from surviving temples. |
| **Terraced pueblo** | Compact multi-level cell complex | Stepped adjoining rectangles, courtyard voids and ladders | Adobe or stone and earth, flat roofs of beams/vegetation/earth | Cliff dwellings are a regional subtype, not the norm. |
| **Maya acropolis city** | Ceremonial plaza groups, platforms and dispersed residential zones | Pyramids/steps around plazas, paths across terrain | Monumental stone masonry and stucco, ordinary vegetal/timber houses | Avoid depicting every house as a small stone pyramid. |
| **Austronesian stilt village** | Spaced/aligned family houses, platform or communal space | Long rectangles with stairs/galleries; large roofs | Timber/bamboo, palm leaves, sometimes regional tiles | Great diversity between Java, Bali, Borneo, Sulawesi, Philippine islands and Pacific. |

## IV.1. Defining a style in a data file

**Do not simply store** `style: chinese`. Minimum generation data should distinguish:
```yaml
schema_version: '0.1'
pack_id: AS-CHI
label: "Chinese imperial capital (Yuan period, simplified)"
chronology:
  from_year: 1271
  to_year: 1368
  temporal_flag: M
cultural_context:
  region: "Northern China"
  subtradition: "Yuan imperial capital / Dadu"
environment:
  landform: plain
  hydrology: [river, canal]
  material_availability: [timber, rammed_earth, fired_brick, clay_tile]
settlement:
  archetype: AS-CHI-S02
  base_geometry: SET-AXIAL
  optional_geometry: [SET-GRID, SET-WALLED]
  layout_rules:
    primary_axis: north_south
    outer_wall: true
    gates_align_with_major_routes: true
    ceremonial_compound_on_axis: true
    neighborhood_courtyards: true
  parcel_mix: [LOT-SIHEYUAN, LOT-MULTIYARD, LOT-COMPOUND]
building_palette:
  common:
    - archetype: AS-CHI-B01
      weight: 50
    - archetype: AS-CHI-B02
      weight: 35
    - archetype: AS-CHI-B04
      weight: 15
  landmarks:
    - archetype: AS-CHI-B07
      count_range: [1, 5]
    - archetype: AS-CHI-B06
      count_range: [0, 2]
constraints:
  forbidden_if_strict_before_1500: [AS-CHI-B13]
  notes: "Weights are purely illustrative, not demographic."
```

```yaml
schema_version: '0.1'
pack_id: AF-SOUTH
label: "Pastoral compound / kraal, illustrative variant"
chronology:
  temporal_flag: T
environment:
  landform: rolling_plain
  material_availability: [wood, earth, grasses]
settlement:
  archetype: AF-SOUTH-S01
  base_geometry: SET-CIRCULAR
  compound_geometry: LOT-KRAAL
  layout_rules:
    perimeter: oval_or_round
    livestock_enclosure: center_or_adjacent
    residential_units: peripheral_clusters
    entrance_count_range: [1, 3]
    orient_access_by_terrain_and_social_rule: true
building_palette:
  common:
    - archetype: AF-SOUTH-B01
      footprint: FP-ROUND
      roof: RF-CONE
      weight: 70
    - archetype: AF-SOUTH-B02
      weight: 30
constraints:
  notes: "Abstract example; specify community/region before historical reconstruction."
```

```yaml
schema_version: '0.1'
pack_id: AM-AND
label: "Inca mountain centre, late fifteenth century"
chronology:
  from_year: 1450
  to_year: 1500
  temporal_flag: M
environment:
  landform: steep_mountain
  hydrology: [spring, irrigation_canal]
  material_availability: [stone, earth, thatch, timber]
settlement:
  archetype: AM-AND-S03
  base_geometry: SET-TERRACE
  layout_rules:
    contour_following_paths: true
    stairs_between_levels: true
    retain_walls_as_first_class_features: true
    ceremonial_plaza: true
    residential_compounds: LOT-KANCHA
building_palette:
  common:
    - archetype: AM-AND-B01
      weight: 65
    - archetype: AM-AND-B02
      weight: 35
  landmarks:
    - archetype: AM-AND-B04
      count_range: [0, 2]
    - archetype: AM-AND-B08
      count_range: [0, 1]
constraints:
  do_not_replace_thatch_with_stone_roof: true
  reserve_fine_polygonal_stone_for_prestige: true
```

## IV.2. Example **building recipe**, separate from the pack

```yaml
id: BLD-HUT-ROUND-WATTLE
label: "Round daub hut with conical thatch roof"
priority: P0
form:
  footprint: FP-ROUND
  plan_radius_m: [2.0, 4.5]   # rendering heuristic, not a universal typology
  floors: 1
  entrance_count: 1
  orientation: towards_courtyard_or_path
structure:
  frame: MAT-TIMBER-POST
  wall_infill: MAT-WATTLE-DAUB
  coating: MAT-MUD-PLASTER
  base: earth_or_stone
roof:
  type: RF-CONE
  cladding: MAT-THATCH
  overhang_m: [0.15, 0.65]
  pitch_deg: [35, 60]
usage_tags: [domestic, utility, workshop]
allowed_regions: [ATL-CEL, AF-SAHEL, AF-SOUTH, AF-WEST]
constraints:
  must_match_region_specific_variant: true
  note: "Generic: actual dimensions and forms depend on culture."
```

```yaml
id: BLD-TIMBER-TIERED-PAVILION
label: "Tiered pavilion with nested timber/tile roofs"
priority: P2
form:
  footprint: FP-SQUARE
  floors: [2, 3]
  volumes: stacked_offset_rectangles
  upper_floors_setback: true
structure:
  frame: MAT-TIMBER-POST
  joinery: MAT-WOOD-MORTISE
  wall_infill: regional_timber_or_brick
  platform: stone_or_brick
roof:
  type: RF-TIERED
  underroof_form: RF-EAVES
  cladding: MAT-TILE-CLAY
  each_tier_gets_own_roof: true
  ridge_upturn: culture_specific_only
allowed_regions: [AS-CHI, AS-KOR, AS-JAP]
constraints:
  role: [pagoda, pavilion, palace_gate]
  rarity: exceptional
  culture_specific_profiles_required: true
  note: "Geometric archetype, not a historically interchangeable model."
```


---

# V. Spatial composition and compatibility rules

## V.1. Seven mandatory style fields

1. `settlement_pattern`: overall geometry and circulation network.
2. `compound_pattern`: division of properties, walls, courtyards and outbuildings.
3. `footprint_family`: square, round, long, L/U-shaped, composite or excavated plans.
4. `elevation_family`: 1–N storeys, setbacks, overhangs, platforms, stilts.
5. `structure_system`: load-bearing earth/stone walls, posts/beams, logs, bamboo, etc.
6. `roof_system`: type, pitch, orientation, covering and details.
7. `surface_language`: plaster, pigments, openings, exposed framing and mouldings.

**Wall material** alone does not identify its **load-bearing structure**: white plaster can conceal daub, stone or adobe; thatch can cover complex framing or a simple hut.

## V.2. Minimum constraints for a realistic-looking map

| Constraint | Generator effect |
|---|---|
| Relief | Hillside city → terraces, stairs, buildings oriented along contours, narrower access. |
| Hydrology | River village → bank paths, quays, bridges; basins and canals for relevant hydraulic cultures. |
| Climate | Rain/snow → suitable pitches; dry climate → flat roofs possible, without making this universal. |
| Local materials | Regional and period probabilities for stone/earth/timber/bamboo/thatch; imports limited to high status. |
| Density | Pastoral village → spaced volumes and enclosures; metropolis → party walls and compact streets/courtyards. |
| Social hierarchy | Monument, temple, palace and notable residence can use large spans and costly decoration. |
| Urban age | Organic growth, intersecting grids, successive walls; planned foundation when justified by context. |
| Plot | The generation unit can be a **family enclosure of eight huts**, not just eight independent houses. |
| Settlement size | A hamlet does not receive an imperial palace or ziggurat through a uniform random draw. |
| Time | No silhouette known mainly after 1500 in a strictly ancient/medieval world. |
| Monuments | Distinguish everyday housing and architecture of power; do not derive every building from monumental remains. |
| Roof assembly | Render ridges, overhangs, level hierarchy, shadows and openings, or all styles look alike. |

## V.3. Recommended generation order

1. Select `culture_pack`, chronological window, subtradition, climate, terrain and resources.
2. Generate the **envelope** (valley, plateau, banks, ridges, arable land, possible defences).
3. Instantiate the **settlement pattern** (axes, paths, plazas, water, walls, canals, terraces).
4. Divide **large blocks into compounds/plots** using the regional model (courtyard, strips, compound, longhouse, *kancha*, etc.).
5. Generate **structuring volumes** first: communal house, palace, temple, large enclosure, platform, mound; reserve their margins and access.
6. Instantiate admissible **building recipes** within each plot, respecting entrance orientation to streets/courtyards.
7. Resolve roofs and elevations; model **roof overhangs** as geometry distinct from wall footprint.
8. Add interfaces: stairs, ladders, galleries, porticos, walkways, low walls, banks and retaining structures.
9. Render period materials and details; strengthen top-down readability with shadow, colour and roofs.
10. Measure diversity, coherence and density; check that no building blocks a route/gate or violates pack constraints.

## V.4. Controlled cultural mixing for role-playing games

The engine may offer three modes chosen for the campaign:

- `historical_strict`: compatible cultures, materials, buildings, layouts and periods, with documented exceptions.
- `historical_inspired`: stable cultural foundation, latitude in size and variants; useful for a pseudo-historical setting.
- `fantasy_mix`: free combinations that are **technically and spatially coherent** (for example, a merchant city with Chinese courtyards, Sahelian thatched huts and an Andean stone wall), using coherence parameters rather than random visual fusion.

**Do not automatically merge** China, Korea and Japan into one `East Asian` style, sub-Saharan Africa into `African huts`, or Mesoamerica and the Andes into `Pre-Columbian pyramids`. Differences in planning, structure and roofing are precisely why this atlas exists.

---

# VI. Glossary of terms that actually change geometry

| Term | Useful procedural meaning | Do not confuse with |
|---|---|---|
| **Kraal** | Enclosure, especially pastoral; depending on linguistic usage, a compound or fenced village. | Every round African hut; livestock enclosure ≠ entire settlement in every context. |
| **Rondavel** | Round house, usually with conical roof; archetype associated with southern Africa. | Circular village: it is a **building**, not an urban pattern. |
| **Compound / concession** | Plot with several dwellings, courtyards, fences, outbuildings. | A simple individual house. |
| **Oppidum** | Fortified Iron Age centre, plan constrained by ramparts and relief. | Any palisaded village. |
| **Castro** | Fortified Iberian settlement, often elevated, locally variable morphology. | Feudal castle. |
| **Ksar / ksour** | Fortified earth/stone complex, often in an oasis or pre-Saharan setting. | Kasbah as citadel/fortified residence; the words are not exact synonyms. |
| **Medina** | Historic urban fabric with streets, courtyards and multiple functions. | “All adobe” or necessarily labyrinthine. |
| **Siheyuan** | Pavilions framing an ordered rectangular courtyard. | Single square building or pagoda. |
| **Pagoda** | Religious tower/building with superimposed storeys/roofs depending on country. | Every temple or every Chinese house. |
| **Tulou** | Large defensive communal earth volume, circular **or square**, with inner courtyard. | Yurt, round-hut village, simple enclosure wall. |
| **Kancha** | Andean enclosure containing several rectangular buildings around a courtyard. | A single Inca building. |
| **Kallanka** | Long Inca great hall often associated with administrative centres. | Ordinary house. |
| **Qollqa / colca** | Andean storage granary, often repeated in rows. | Residential tower. |
| **Huaca** | Sacred Andean site/feature; sometimes a monumental platform complex. | A “pyramid” of any American civilisation. |
| **Baray** | Large artificial reservoir in some Khmer urban systems. | Simple defensive moat. |
| **Longhouse** | Large elongated dwelling or communal house. | A single type: framing and organisation vary greatly. |
| **Tongkonan** | Raised Toraja house with expressive saddle roof. | Generic house of all Indonesia. |
| **Marae** | Polynesian ceremonial space, often platform or courtyard. | Residential house. |
| **Pueblo** | Architectural complex of dwelling cells, often terraced earth/stone in the American Southwest. | Any adobe house in the world. |
| **Ziggurat** | Mesopotamian monumental terraced mass with upper sanctuary. | Egyptian funerary or Maya pyramid. |
| **Maloca** | Large communal house of some Amazonian societies. | Every Indigenous Amazonian dwelling, or every longhouse. |
| **Great house (Chaco)** | Monumental multifamily/functional masonry complex with courtyards and several storeys. | All houses in a Pueblo village. |

---

# VII. Periods and historical safeguards

| Potential confusion | Generation rule |
|---|---|
| **Fujian tulou** | Ancient tradition, but the listed series includes fifteenth–twentieth-century buildings and the most elaborate examples are mainly seventeenth–eighteenth century; filter the iconic profile as *late* by default. |
| **Shibam city** | Older settlement, but surviving vertical earth-tower urbanism is associated with the sixteenth century; do not treat it as a typical ancient setting. |
| **Beijing imperial axis** | Main axis begun under the Yuan; many current buildings are Ming/Qing; do not project today's visible palace onto ancient China. |
| **Machu Picchu** | Fifteenth-century Inca complex; stone walls often survive but **vegetal roofs have disappeared**; reconstruction is required. |
| **Japanese castle keeps** | Do not automatically introduce the sixteenth–seventeenth-century *tenshu* silhouette into a Heian/Kamakura setting. |
| **Ksar of Aït-Ben-Haddou** | The site attests an old tradition, but much surviving fabric was renewed or rebuilt late. |
| **Abomey palaces / Kasubi tombs** | Famous examples are mainly modern; use forms within their relevant traditions without automatically inventing greater age. |
| **Americas** | Before 1500 there is no automatic equivalence “medieval = European feudal”. Use local chronologies and architectural traditions. |
| **Monuments vs ordinary houses** | Stone remains give a biased image of ancient cities: many homes were earth/timber/vegetation and survive poorly. |

---

# VIII. Starting sources and documentary checks

Institutional sources useful for **validating morphologies and dates**, not for faithfully reconstructing every building. Some atlas entries are deliberately synthetic or heuristic; strict historical reconstruction requires excavation plans and monographs for the relevant cultures.

### Asian urbanism, courtyards and cities

- UNESCO — [Beijing Central Axis](https://whc.unesco.org/en/list/1714/): north–south axis, Yuan origin and Ming/Qing phases.
- UNESCO — [Fujian Tulou](https://whc.unesco.org/en/list/1113/): earth rings and squares, communal housing, often late chronology.
- UNESCO — [Historic Monuments of Ancient Kyoto](https://whc.unesco.org/en/list/688/): timber architecture, ritual and urban spaces.
- UNESCO — [Kathmandu Valley](https://whc.unesco.org/en/list/121/): courtyards, carved timber, brick and Newar temple forms.
- UNESCO — [Angkor](https://whc.unesco.org/en/list/668/): hydraulics and monuments in a landscape setting.
- UNESCO — [Archaeological Ruins at Moenjodaro](https://whc.unesco.org/en/list/138/): urban layout, infrastructure and brick in the Indus civilisation.
- UNESCO — [Sansa, Buddhist Mountain Monasteries in Korea](https://whc.unesco.org/en/list/1562/): regional religious buildings and complexes (many later phases).
- UNESCO tentative list — [Traditional Settlement of Tana Toraja](https://whc.unesco.org/en/tentativelists/5462/): houses and regional architecture.
- UNESCO tentative list — [Traditional Settlement of Nias](https://whc.unesco.org/en/tentativelists/5463/): forms and layout; recheck tentative-list URL for academic use.

### Africa, Arabia and the Mediterranean

- UNESCO — [Old Walled City of Shibam](https://whc.unesco.org/en/list/192/): unfired-brick walls and sixteenth-century tower houses.
- UNESCO — [Ksar of Aït-Ben-Haddou](https://whc.unesco.org/en/list/444/): fortified earthen complex in southern Morocco.
- UNESCO — [Old Towns of Djenné](https://whc.unesco.org/en/list/116/): Sahelian earthen urban traditions.
- UNESCO — [Great Zimbabwe National Monument](https://whc.unesco.org/en/list/364/): dry-stone masonry and curved enclosures.
- UNESCO — [Koutammakou, the Land of the Batammariba](https://whc.unesco.org/en/list/1140/): earthen fortress houses and landscape organisation.
- UNESCO — [Ruins of Kilwa Kisiwani and Songo Mnara](https://whc.unesco.org/en/list/144/): coastal Swahili city, coral stone and lime.
- UNESCO — [Tombs of Buganda Kings at Kasubi](https://whc.unesco.org/en/list/1022/): monumental vegetal construction, late historical example.
- UNESCO — [Royal Palaces of Abomey](https://whc.unesco.org/en/list/323/): earthen royal complexes, mainly seventeenth–nineteenth centuries.
- Oxford Learner's Dictionaries — [*Kraal*](https://www.oxfordlearnersdictionaries.com/definition/english/kraal): range of meanings.

### Americas and Oceania

- UNESCO — [Historic Sanctuary of Machu Picchu](https://whc.unesco.org/en/list/274/): Andean terraces, functional zones, Inca chronology.
- UNESCO — [Chan Chan Archaeological Zone](https://whc.unesco.org/en/list/366/): adobe districts/building works, large compounds.
- UNESCO — [Tiwanaku](https://whc.unesco.org/en/list/567/): Altiplano ceremonial architecture.
- UNESCO — [Pre-Hispanic City of Teotihuacan](https://whc.unesco.org/en/list/414/): monumental layout, temples and compounds.
- UNESCO — [Pre-Hispanic City and National Park of Palenque](https://whc.unesco.org/en/list/411/): Maya palaces and temples.
- UNESCO — [Chaco Culture](https://whc.unesco.org/en/list/353/): *great houses* and courtyards.
- UNESCO — [Cahokia Mounds State Historic Site](https://whc.unesco.org/en/list/198/): Mississippian mound urbanism.
- UNESCO — [Taos Pueblo](https://whc.unesco.org/en/list/492/): clustered terraced adobe cells.
- UNESCO — [Nan Madol](https://whc.unesco.org/en/list/1503/): artificial islets and massive basalt structures.
- UNESCO — [Budj Bim Cultural Landscape](https://whc.unesco.org/en/list/1577/): constructed Aboriginal aquaculture landscape.
- UNESCO — [Jomon Prehistoric Sites in Northern Japan](https://whc.unesco.org/en/list/1632/): ancient dwellings and occupation.
- Smithsonian National Museum of the American Indian — [*Infinity of Nations*, Northwest Coast](https://americanindian.si.edu/exhibitions/infinityofnations/northwest-coast.html): peoples and materials of the Northwest Coast.
- Yale eHRAF — [Inca Summary](https://ehrafarchaeology.yale.edu/traditions/se80/summary): ethnographic context and organisation of complexes.

---

# IX. Data contract / catalogue maintenance

- Atlas `ID`s are **internal identifiers for the application**, not standard scientific classification terms.
- A recipe definition **must apply to a dwelling or a building with a different function**; function (`house`, `granary`, `temple`, etc.) is an independent field.
- A `pack_id` should eventually include `sources`, `confidence`, `start_year`, `end_year`, `biome`, `materials`, `roof_variants`, `compound_rules`, `settlement_rules`, `asset_requirements` and `exceptions`.
- Use three confidence levels: `attested` (documented plan/text/remains), `reconstructed` (plausible elevation/roof), `stylized` (RPG abstraction).
- Names of peoples, regions and periods **do not replace** a description of architectural form: two cultures can share a primitive without sharing urban organisation.
- Extend with new subtraditions without breaking shared primitives: an `AF-SAHEL/hausa` pack inherits unfired-earth vocabulary but retains its own courtyards and silhouettes.
- Do not turn iconic examples into general frequency: **one monumental temple per city type**, not one temple in every group of five houses.
- Test presets at three scales: **regional map** (village pattern), **city plan** (layout/plots), **building zoom** (roofs/materials).

**Summary:** generate the **settlement form**, then **compounds/blocks**, then **volumes** and their **structures/roofs**. Cultural identity emerges from a constrained combination of these levels, not merely a set of textures.
