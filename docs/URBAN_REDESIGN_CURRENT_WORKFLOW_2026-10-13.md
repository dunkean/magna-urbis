# Urban redesign — current workflow as of October 13, 2026

This is an English translation of section 1 of [the French urban redesign study](REFONTE_GENERATION_URBAINE_2026-10-13_FR.md). The [literature review](URBAN_REDESIGN_LITERATURE_2026-10-13.md) translates section 2. This is a dated description of the code examined for the study; see the [implementation report](REFONTE_URBAINE_IMPLEMENTATION_2026-10-13.md) for later work.

## 1. Detailed current operation

### 1.1. Two pipelines to distinguish

There are currently two relevant urban implementations.

| Pipeline | What it does today | Role in this study |
|---|---|---|
| Historical TypeScript application | Complete site and settlement generation, with phases, streets, blocks, parcels, buildings and amenities | Richest reference for behaviors and special cases |
| Rust Terrain Bench / Urban Bench | Settlement composition, neighborhoods, streets and blocks, then parcels; geography and roads come from terrain or an imported decor | Current prototype for stages to reconsider, independent of houses |

General READMEs still say Rust urban generation is forthcoming, whereas the [Rust urban-stage guide](../rust/crates/core/src/urban/README.md) and sources already contain it. For this analysis, the sources and specialized guide take precedence over that general presentation.

The Watabou heritage explains the project's origin, but the current TypeScript engine is no longer just a set of Voronoi cells. Its central organization is now a succession of guided partitions.

### 1.2. Vocabulary actually used

An initial difficulty is the overlap between several related concepts.

| Concept | Meaning in current operation | Distinction to retain |
|---|---|---|
| Site | Position, terrain, water, environment and regional access | The site exists before the city |
| Planned envelope / footprint | Area intended to host phases and their population | Not necessarily the area ultimately occupied |
| Enclosure | Wall, palisade or other physical boundary | An open city also has a footprint |
| Phase | Region associated with a growth stage and cultural recipe | Dividing into phases is not itself a historical simulation |
| Neighborhood | Large plan piece separated by axes and phase boundaries | Primarily a generation sector, not necessarily a social or administrative district |
| Block | Land available after subtracting street space | A dead end can cut into a block without dividing it in two |
| Parcel | Unit divided from a block, with orientation and possible frontage | A parcel is not a building |
| Garden / backland | Land kept in the partition without recognized residential access or left open | Automatic garden classification is often a geometric fallback, not a demonstrated historical attribution |

“Footprint” also occurs at building scale in the historical engine. It is therefore necessary to specify whether it means the settlement footprint, an enclosure, land occupation or a building.

### 1.3. Inputs and generation intentions

The plan depends mainly on seed, population, place size and culture, terrain and water, regional roads and morphology settings.

Culture provides more than appearance: preferred core, core and extension recipes, orientations, enclosure logic, block dimensions, street widths, parceling methods and reserve types. Explicit settings can override these values. Core, middle, edge, village and suburb zones modulate dimensions and densities.

The Rust catalogue is a versioned export of resolved TypeScript recipes. The current guide reports 53 cultures and 326 presets. This richness represents a catalogue of available rules, **not 326 independent generation systems**, nor historical validation of all combinations.

Randomness is deterministic and divided into substreams. Stage seeds allow parcels to be rerun without rebuilding streets. Coordinates are metric. This makes comparison and replay possible with identical versions and inputs.

### 1.4. Historical TypeScript workflow

The main flow can be summarized as:

```text
Site and regional roads
        ↓
Culture, population, settlement type and growth recipes
        ↓
Phase regions and planned footprint; suburbs along approaches
        ↓
Core, reserved major amenities, primary axes and enclosures
        ↓
Sectors / neighborhoods
        ↓
Guided subdivision into secondary streets and block pieces
        ↓
Local access, dead ends and subtraction of street width
        ↓
Parcels from frontages; backland and reserves
        ↓
Buildings and final corrections that can affect the partition
```

This is the common trunk. Small settlements, street villages, camps and some cultures also use specialized branches. The repository also contains a large-scale “mega” planning branch; it must not be confused with the ordinary composition described here or assumed active in every workflow.

#### Population and area

Population estimates gross area from phase densities. A share can be assigned to suburbs. Gross density implicitly includes spaces needed for urban operation; it is not just the area of residential parcels.

The planner seeks sufficiently large growth regions on available land. On constrained terrain, it can relax some limits, moderately increase planned density and report a shortfall. Bounded replans try to compensate for area lost to cutting or smoothing. This remains a spatial-budget search, not proof that generated housing accommodates exactly the requested population.

#### Footprint formation

Organic growth uses a site-dependent cost field. Water and some impassable land are excluded. Slope, habitability, roads, banks, moisture and spatial noise modulate the field. Settings favor elongation along an axis or a second core.

Regions may therefore extend more readily along a valley or near an approach than up a slope. Planned forms also apply enclosure templates: rectangles, cardinal orientations, ovals and other variants. Successive phases occupy growth bands; suburbs use strips around outer roads.

The planner discards unserved components. Land isolated by water therefore does not automatically become a neighborhood merely because it fits the budget. This protects access consistency, but can also reduce the achievable footprint.

#### Core, axes and neighborhoods

The core may be a market, castle, religious site or other cultural center. Axes reuse regional approaches and connect gates and centers. Former enclosure boundaries can contribute to phase and street structure according to the recipes. Major programs are reserved early enough not to require insertion into small blocks afterward.

Neighborhoods are pieces resulting from phase bands and their division by axes. Their morphology can vary by phase. This allows an old core and a more regular extension, but geometric subdivision and neighborhood identity remain closely coupled.

#### Secondary streets and blocks

The engine recursively subdivides each neighborhood. **A subdivision cut at this level represents a street.** Candidates follow a local orientation field: grid, radial or tangential direction, proximity to axes, terrain curves and low-frequency irregularity.

Cuts are evaluated by resulting sizes and proportions, angles, connections and site constraints. Subdivision stops when pieces are acceptable or no valid cut is found. Some acute or small pieces become squares rather than difficult-to-fill blocks.

Dead-end accesses then serve deeper land: derbs, closes, hutong, roji and other variants. A new through street that separates pieces must be distinguished from an access slit that cuts into an existing piece.

Axes do not have zero width. The final block results from subtracting road strips. The desired rule partitions land among streets, blocks and reserved spaces without independently placing polygons that might overlap.

#### Parcels

The first operation identifies edges actually fronting a street. Open boundaries, water and walls are not automatically frontages. Compatible segments are grouped into frontage sequences.

Strip subdivision then works as follows:

1. A frontage obtains an inward territory bounded by depth and block geometry.
2. Priority frontages, notably on major roads, are handled first; they influence corner allocation.
3. That territory is subdivided by frontage widths and a shared frame, optionally tilted in organic fabrics.
4. Other frontages use the remaining land.
5. Unallocated backland is retained; small remnants are merged where possible.

Burgage and machiya strip parcels, courtyards and compounds, siheyuan variants, gardens and whole-block units therefore do not all share the same operator.

An important point: the archived design document proposed a straight skeleton to allocate frontage territories. Current `plots.ts` sources describe its **replacement by priority strips**, and mention excessive cost of the old CGAL/WASM integration. That repository note does not establish that every straight skeleton would be too slow; no benchmark of that integration was reproduced here.

#### Corrections after construction

The full engine then adds buildings, passages, boundary finishes and density repairs. Several operations can still change land allocated to a parcel or released as garden. The exported footprint also tries to remove large planned areas left unserved while retaining neighborhoods, streets and walls.

The structural difficulty is real: **parcels exist before buildings, but some final land decisions still depend on building success**. For the requested redesign, it would be preferable to validate a city through parcels without running houses.

### 1.5. Current Rust workflow

The Rust bench pipeline receives a site, a terrain and obstacle raster, and previously calculated roads. It distinguishes complete settlement composition from isolated working scenes.

#### Settlement composition

Automatic selection distinguishes hamlet, street village, clustered village and town. The decision uses population, cultural recipe and road proximity in particular. Thresholds observed in this composition are 200 inhabitants for the smallest settlements and 1,200 for town composition; these are generator thresholds, not universal historical definitions.

The core is divided among cultural phases. Population shares and densities determine **area weights**. These weights redistribute the indicative radius received from the site between core and suburbs. Radius can also be forced: the spatial budget therefore does not derive exclusively from population and density.

Phases are obtained from successive contours and differences from previous regions. Suburbs are strips around approaches actually connected to the core; length and depth follow available budget, recipe and obstacles. They can extend beyond the indicative radius. The enclosure remains associated with the core.

This composition is a synthetic description of growth. It does not yet simulate land decisions across centuries with detailed preservation and transformation of old parcels.

#### Macroplan construction

The initial footprint is mainly a contour around the site center: geometric for some planned fortified towns, elongated for some settlements, or modulated by a few angular variations and approach directions in open places.

The plan is then cut by dry land, regional corridors and cultural axes. Orientations can come from cardinal directions, roads, the local terrain gradient or the shore. Radial axes and a ring are available where appropriate.

To obtain the desired sector count, the macroplan tries to cut large pieces with routable axes, seeking a relatively balanced division. **The number of neighborhoods is therefore partly a subdivision target**, rather than the result of an explicit community, function and centrality model.

Current quays are roads following dry edges beside water. The prototype does not yet solve a complete port, its basins, navigation, piers and land organization.

#### Street constraints

Local routing checks water and longitudinal slope on the physical surface. Defaults are 12% for streets, 18% for lanes and 65% for stairs. They are configurable and do not claim to represent historical standards.

Checking is not limited to elevations at a segment's endpoints: it inspects the interpolated surface and can detect an intermediate ridge. Local search accounts for slope and turns to reroute a path. Water crossings remain those of the regional network; the dry urban router does not freely create new bridges.

Intersections are normalized to shared nodes and isolated fragments removed. This construction guarantees properties **relative to the supplied terrain**, whose resolution remains a limitation: a 512² water mask over 40 km represents about 78 m per cell, insufficient to distinguish a lane or small canal. The map may display a finer vector shoreline without that detail being authoritative for urban calculation.

#### Neighborhoods, local streets and blocks

Neighborhoods inherit phases and recipes. Refinement uses guided recursive cuts, with variants for grids, organic fabrics, terraces and local access. Area, width and proportion targets bound cuts. Inability to subdivide can leave a large block.

The network is materialized as strips of real width, then subtracted from land. Monument reserves and squares are retained as free units. The monument itself is not built at this stage.

#### Parcels

Parcel calculation receives and retains the completed layout. It detects frontages on retained streets, uses block orientation and applies the cultural operator for its phase unless explicitly overridden.

Frontage strips, courtyard and compound subdivision, siheyuan refinement and whole-block retention are available. Frontage contact below the current 3 m threshold does not justify an ordinary residential parcel. Residential depths are bounded; unserved backland remains garden. A block without retained frontage does not receive fictitious access.

Holes are retained in boolean operations. An area-sum check reports partition remnants. **A good area sum alone does not prove a correct partition**: overlap and a gap could cancel. Unions, intersections and exclusions must also be checked.

### 1.6. User workflow and dependencies

In Terrain Bench, neighborhoods depend on terrain, water, settlements and roads. Parcels depend on the resulting layout. Recomputing parcels retains streets and blocks; changing an upstream dependency invalidates downstream results.

Urban Bench can work on an exported decor: terrain, places and roads are then fixed for comparing urban variants. The workshop also offers isolated scenes and can import the map's exact plan. Isolated mode is useful for a local method but insufficient to judge a settlement silhouette.

Applied settings are distinguished from drafts. Links preserve seeds, selection, applied settings and display. Rendering does not trigger generation. Stale worker responses must not replace the current result. These properties must survive a redesign.

### 1.7. What is already solid and what remains ambiguous

| Point | Observation | Implication |
|---|---|---|
| Partition rather than free placement | Central principle already present | Retain: land has explicit spatial ownership |
| Scale hierarchy | Phases → neighborhoods → blocks → parcels | Good basis, but neighborhood semantics need clarification |
| Composable culture | Multiple recipes and phases can coexist | Make more explicit and less dependent on global categories |
| Frontage and depth | Orientation and access are already used | A parcel is more than a random polygon |
| Growth | Phases and suburbs available | History is still often encoded as bands around a center |
| Rust footprint | Central template then geographical adaptation | Limited diversity for archipelagos, merged cores and complex branches |
| Access | Physical rules and cleanup present | Some impossibilities handled late, with backland becoming garden |
| Density | Planning budget and corrections | Distinguish gross, net and capacity concepts |
| Deferred buildings | Rust can stop at parcels | Historical engine has more feedback from buildings to land allocation |

Archived bugs on neighborhood boundaries, ports, open contours and streets without destinations correspond to several of these tensions. They suggest regression cases, but old notes do not establish the current state of every problem.

### 1.8. Traceability

The main materials consulted are:

- [TypeScript orchestration](../web/src/gen/urban/index.ts), [phase planning](../web/src/gen/urban/phases.ts), [axes and neighborhoods](../web/src/gen/urban/primary.ts).
- [Orientation fields](../web/src/gen/urban/field.ts), [subdivision and blocks](../web/src/gen/urban/blocks.ts), [parcels](../web/src/gen/urban/plots.ts), [served footprint](../web/src/gen/urban/footprint.ts).
- [Rust guide](../rust/crates/core/src/urban/README.md), [composition](../rust/crates/core/src/urban/composition.rs), [macroplan](../rust/crates/core/src/urban/macroplan.rs), [neighborhoods](../rust/crates/core/src/urban/quarters.rs), [parcels](../rust/crates/core/src/urban/parcels.rs), [routing](../rust/crates/core/src/urban/routing.rs), [network](../rust/crates/core/src/urban/network.rs).
- Archived documents: [HANDOFF](../.local-archive/publication-2026-10-09/repository/HANDOFF.md), [BUGS](../.local-archive/publication-2026-10-09/repository/BUGS.md), [urban geometry](../.local-archive/publication-2026-10-09/repository/web/URBAN_GEOMETRY.md), [urban morphology](../.local-archive/publication-2026-10-09/repository/web/URBAN_MORPHOLOGY.md).
- [Local historical settlement catalogue](catalogue_settlements_antiquite_moyen_age_rpg.md), to retain distinctions between form, use, environment and origin.

Archived documents sometimes express older intentions different from observed current methods; they were used as context, not sole proof of implementation.
