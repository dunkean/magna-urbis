# Urban redesign — proposed improvements

This is an English translation of section 3 of [the October 13, 2026 urban redesign study](REFONTE_GENERATION_URBAINE_2026-10-13.md). The [current-workflow analysis](URBAN_REDESIGN_CURRENT_WORKFLOW_2026-10-13.md) and [literature review](URBAN_REDESIGN_LITERATURE_2026-10-13.md) translate sections 1 and 2. These are proposals from the study, not a claim that every feature was implemented; see the later [implementation report](REFONTE_URBAINE_IMPLEMENTATION_2026-10-13.md).

## 3. What could improve the current system

### 3.1. Priority: clarify responsibilities before expanding styles

I propose separating seven intentions, without yet imposing seven classes or permanent data formats:

1. **Site and constraints:** land, water, terrain, hazards, crossings and corridors.
2. **Program:** target population, activities, major domains and desired areas.
3. **Centers and history:** cores, relationships, extension order and inherited elements.
4. **Footprint:** growth reserve and land actually allocated.
5. **Framework and fabrics:** destinations, primary roads, local morphologies and shared spaces.
6. **Blocks and land units:** subdivision and access, with explicit reserves.
7. **Final parcels:** frontages, backland, access and rights or statuses required for future construction.

Social, functional or administrative neighborhoods could be groups of blocks and parcels, or regions of influence. They need not necessarily be the same polygons as subdivision sectors.

### 3.2. Distinguish four urban surfaces

One contour is insufficient. It would be useful to display separately:

| Surface | Question answered |
|---|---|
| Growth reserve / envelope | Where is the generator allowed to urbanize? |
| Allocated urban land | Which streets, parcels, squares and domains already belong to the plan? |
| Fortified boundary | Where is each physical enclosure? |
| Built occupation, later | Where are the buildings actually produced? |

At the current stage we can speak of an **allocated urban footprint** without waiting for buildings. Holes, gardens, enclaves and separated cores must be representable. Convexification or arbitrarily retaining only the largest piece could destroy precisely the archipelago, lobed and branched families.

Rural space should be reserved from land actually allocated and intended reserves, not an ambiguous template. A deliberately empty area and a generation failure must remain distinguishable.

### 3.3. Produce the footprint through mechanisms rather than twelve algorithms

I recommend comparing four main mechanisms.

**A. Planned foundation.** A contour and framework are intentional: orientation, axes, boundaries, reserves and subdivision rhythm. Terrain can deform the plan or make it partially infeasible. The generator should explain that compromise rather than silently clip a perfect shape.

**B. Accessibility-driven growth.** One or more cores extend their influence according to access, terrain costs and land availability. Anisotropic growth enables elongation, fans and arms. Attraction to a shore must be distinguished from a prohibition on building in water or certain wetlands.

**C. Accretion along a network.** Urbanization starts at served frontages of paths, roads or quays. Strips thicken near centers and join when accessibility permits. This suits ribbons and suburbs; it avoids always starting with a disk that is then stretched.

**D. Core merging.** Multiple centers have their own budget, orientation and history. Their union can remain discontinuous, become lobed, then fill some gaps. Connections are access and growth choices, not mere polygon bridges to force a connected silhouette.

Composite form becomes a sequence of these mechanisms. The twelve families then serve as presets, descriptions of results and reference examples.

### 3.4. Relate population, area and density clearly

Explicitly define **gross** density over the urban footprint and **net** density over residential land. Building capacity will be a third concept, added later.

For simple planning, target gross area can be estimated by `population / gross density`, with consistent units. Major domains, squares and infrastructure can then be reserved explicitly if their cost is not already included in that density. Avoid double-counting them.

The result should report target area, available dry area, allocated area, shares of roads and reserves, planning population and any shortfall. A manual radius can remain an artistic tool if it is clear that it forces an area which may contradict the demographic budget.

Before houses, these figures provide planning consistency. They do not yet prove accommodation capacity.

### 3.5. Give neighborhoods and fabrics distinct roles

A **fabric** could be a local recipe for streets, blocks, shared spaces and parcels. A **neighborhood** could carry an identity: market, port, community, function, origin or phase. A **calculation sector** would simply be a domain used to construct the plan.

This distinction could represent:

- A historic neighborhood crossed by several calculation sectors.
- A planned extension containing religious domains and housing.
- A riverside neighborhood with a local grid and strip parcels.
- Compounds organized around a shared square without a through grid.

Neighborhood count can remain an artistic setting, but should not always impose the same number of large balanced cuts. Centers, barriers, uses and phases can suggest boundaries; the network must then remain consistent across them.

### 3.6. Prepare connections before generating each fabric

Boundary problems between neighborhoods are not solved solely by correcting the last buildings. Interfaces must be prepared upstream.

For each boundary where continuity is desired, the plan can define crossing points, road importance, width and permissible orientation. Both fabrics use the same points. A closed boundary instead has explicit gates or prohibits passage.

The primary framework remains shared. Local streets can be built by guided subdivision, branch growth or pattern adaptation, but their interfaces respect the same network. Public, collective and private status matters from the access stage onward.

This does not mean every street must cross every neighborhood. Low permeability can be intentional; an accidental break at a seam must be distinguished from that intent.

### 3.7. Make local streets and parcels cooperate

Proposed local loop, inspired by co-generation:

```text
Candidate block with existing streets and protected reserves
        ↓
Measure frontages, depth and possible land units
        ↓
Can the land program be served?
     ├─ Yes → subdivide parcels
     └─ No → compare three responses
                 • add permitted access
                 • retain a deep domain / shared space
                 • reduce or move the program
        ↓
Local recalculation, partition and access checks
        ↓
Accept, or retain an explained partial result
```

The loop must be bounded and operate only inside an authorized region. Primary axes, gates and already frozen parcels remain constraints. Each variant can be evaluated by added street length, land consumed, number of served units, cultural compatibility and geometric quality.

Inaccessible backland should therefore neither always be “repaired” as a garden nor always served by a street. The choice depends on program and fabric.

### 3.8. Retain multiple parcel operators under a shared contract

| Proposed operator | Favorable cases | Essential check |
|---|---|---|
| Frontage strips | Long narrow lots, road or shore frontages | Actual width, depth, corners and rear access |
| Oriented subdivision | Compact lots in planned fabrics | Access for each child and consistent orientation |
| Skeleton / distance frontage territories | Complex blocks with competing frontages | Robustness, corner weighting and cost |
| Whole domain | Palace, monastery, compound, reserve | Gates and deferred internal organization |
| Groups around a common | Aggregated settlements | Collective access and ownership of shared space |
| Inherited transformations | Extension, subdivision, parcel merging | Preservation of previous boundaries and traces |

Every operator should produce the same useful information: geometry, parent, intended use, frontage or access, orientation, backland, service status and protected elements. This avoids a different engine for every culture.

Dimensions should depend on fabric and use, with coherent distributions. Adding independent randomness everywhere does not necessarily improve realism: neighboring series can share module, orientation and depth, then vary gradually.

Future building generation would receive these units as constraints. A construction difficulty would trigger an explicit local change request, not a silent cadastral edit.

### 3.9. Introduce light, verifiable history

A complete economic simulation is unnecessary to produce readable inheritance. A few events suffice for a comparative prototype: foundation, road extension, enclosure enlargement, absorption of a core, subdivision of a large domain, lot merger or opening access.

Each event retains some elements and transforms others. An old enclosure can remain a wall, become a road or land boundary, or disappear. Recipes should choose among these possibilities rather than applying one universally.

Current concentric phases can remain a preset, but unilateral extensions and added centers are also needed. Chronology would then explain composite form instead of making it merely a noisy asymmetric silhouette.

### 3.10. Geographic precision and robustness

The regional raster suits site selection and coarse costs. At urban scale, compare vector water and obstacle contours or local refinement to obtain boundaries at the right scale. Smoothing pixel stairs does not restore a shoreline lost from the mask.

A reasonable approach is hybrid: regional raster cost, local vector constraints, validation on available relief. This remains to be measured and designed with the future terrain interface.

Geometry needs a shared policy: coordinate precision, tolerances, ring orientation, interior points of concave domains, handling of holes, remnants and errors. “Exact partition” must mean topology and coverage checked to a documented tolerance; floating-point coordinates and boolean operations do not become mathematically exact constructions by name.

Robustness must preserve information: an unresolved hole must not be filled; an inaccessible region must not receive artificial frontage; a repair must not discard a separated core without explanation.

### 3.11. Optimize after establishing responsibilities

Plausible initial optimizations are local: indexes of segments and frontages, batched strip calculations, reuse of fields and terrain, caching unchanged geometry and recomposition limited to the modified sector. If a skeleton is useful, it can be computed once per block and reused.

Measurements must separate footprint, framework, refinement, parcels, transfers and rendering preparation. Compare the same inputs and level of detail; a gain obtained by producing fewer parcels is not equivalent computational improvement.

GPU use might be relevant for regular fields or raster costs. It is not a demonstrated priority for graph topology and local boolean operations. Profile before making that boundary more complex.

### 3.12. How to compare methods

The redesign needs a small representative corpus, not merely attractive maps. I propose an initial case matrix:

| Case | What it should reveal |
|---|---|
| Rectangular foundation on flat ground | Regularity, consistent areas and lots |
| Open compact town at a road crossing | Edges, growth arms and absence of false destinations |
| Street village on a curved axis | Frontages, depth and thickening near the center |
| Valley town | Elongation, passable streets and unserved land |
| Waterfront town with fixed crossing | Separation of land masses, quay and bridge access |
| Town on a peninsula or spur | Strong constraints and explained spatial shortfall |
| Three cores merging | Components, connections and heterogeneous fabrics |
| Old core plus grid extension | Interfaces and inherited orientations |
| Large block with branching access | Service needs and treatment of backland |
| Compound groups around a common | Collective land and non-through network |

Current isolated scenes suit parcel comparisons; fixed decors serve silhouettes and geography. The same scenes should be produced by the current reference and each variant.

**Essential checks:** no significant overlaps, correct union of units, preservation of holes and reserves, correctly noded network intersections, continuous access to a destination or allowed component, respected slopes and reproducible results.

**Shape measures:** compactness `4πA/P²` under the chosen contour convention, elongation, number of components, voids, arm width, street orientation, intersection degrees, cycles, dead ends, distributions of block area, parcel frontages and depths. For discontinuous silhouettes also publish per-component measures: a single global number hides their organization.

**Visual judgment:** diversity at identical settings, readable centers, fabric continuity and credible transitions. Metrics must not force every city toward maximum compactness or connectivity: a dead end and a void can be intentional.

Historical references should be dated and carry a confidence level: survey, archaeological reconstruction, old plan, reconstructed contour or purely artistic example. Modern cities test measurement tools, not certify pre-Renaissance realism.

### 3.13. Recommended work order

| Step | Concrete deliverable | Condition to continue |
|---|---|---|
| 1. Clarify vocabulary | Definitions of surfaces, neighborhoods, fabrics, sectors and access | Each object has an understandable role |
| 2. Freeze a reference | Small corpus of decors and scenes, outputs through parcels | Replay and diagnostics available |
| 3. Compare footprints | Current template, accessible growth, strips and multiple cores | Real variety and explainable budgets |
| 4. Compare local networks | Guided cuts, branches and patterns, with shared interfaces | Connections and constraints preserved |
| 5. Compare parceling | Current strips, oriented variants, targeted skeleton tool | Valid partition and access on difficult cases |
| 6. Test a co-generation loop | Locally added access according to land need | Fewer failures without destroying the framework |
| 7. Add a few growth events | Extensions and mergers leaving inheritance | Understandable and controllable contrasts |
| 8. Stabilize then profile | Choice of methods and engine boundaries | Quality established before deep optimization |

This order avoids fully porting historical repairs into a new architecture before deciding which remain necessary. The reference application and workflows remain available during comparisons. The retained UI and temporary renderer must not dictate the final model by themselves.

### 3.14. Design decisions to make together

The questions that really structure the next steps are:

- Is a neighborhood primarily a historical/functional identity, a fabric region or a group of blocks? Can it carry several dimensions separately?
- Does population set target area, or does an artistic contour set available space with an adjusted demographic budget?
- Is explicit history desired, or only plausible fabric contrasts?
- Which access types are accepted: public street, collective lane, private passage, shared courtyard, water access?
- Are the twelve silhouettes guided presets, strong constraints or descriptions of results?
- How important is manual editing of centers, boundaries, axes and large land units?

**Starting recommendation:** retain the proposed families as user vocabulary; distinguish form, site, centers, history, network and parcels; compare a few footprint mechanisms on fixed decors; then test local access/parcel co-generation. This is the path most directly tied to observed weaknesses while reusing the solid foundations already present.
