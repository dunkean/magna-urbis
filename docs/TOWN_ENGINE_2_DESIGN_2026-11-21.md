# Town engine 2: growth by dated steps on a graph

21 November 2026. Design document, written before any code. Nothing described here is implemented. Revised the same day after two independent reviews (one by Fable 5.2, one by Astra 6.2) checked the first draft against the code; their findings are folded in, and the points still open are listed in section 14. It replaces, for the new engine, the roadmap of `STREET_GRAPH_DESIGN_2026-11-20.md` (steps 2 to 13) and the repair plan of `PLANNER_STABILITY_DESIGN_2026-11-21.md`, whose diagnosis it keeps as the list of what not to rebuild. It extends `GROW_UNTIL_HOUSED_2026-11-15.md`. Paths without a prefix are in `rust/crates/core/src/urban/`.

## 1. Summary

- The present layout engine stays as it is ("classic"), frozen: bug fixes only. A second engine is written beside it, chosen by a layout option; classic remains the default until the owner approves the new towns on review sheets.
- The new engine replaces the layout stage: land, armature, quarters, streets, blocks, walls. The stages that follow (lots, programme, building sites, display) are reused, but not untouched: they read far more from the layout than its geometry, they key everything on indices, and they recompute pressure and allocation over the whole town. Section 9 lists what they read; section 10 what must change in them, now and for the later chronology.
- A town is a planar graph: streets, walls, bridges and quays are typed edges between shared nodes, blocks are faces, quarters are lineage roots of faces, lots are a split tree inside a face. Every element has an identity derived from its lineage and a birth date.
- A town is built by dated events; the clock is the housed population. Growth advances where building is possible, ranked by a cost, and stops when the households are housed. There is no capacity forecast, no replan, no whole-town trim loop, no global slope slider.
- Walls, the fate of regional roads through the centre, and the ageing of the core are dated events. The journal is designed so that later events can pierce streets and merge blocks and lots; that mechanism is not built now.
- The first milestone after the base is a spike: one occupied quarter with today's street look, exported, counted, resumed, shown in the V2 on native and WebAssembly. The estimate is 50 to 70 sessions, not 30 to 45.

## 2. Scope

**Replaced, in the new engine only.** `footprint.rs` and `footprint/*` (except what section 9 keeps), `composition.rs`, `quarters.rs`, `network.rs`, `trim.rs`, the trace and gate decision of `fortification*.rs`, `macroplan*.rs` except the harbour planner, `slopes.rs`, `footprint/capacity.rs`, the ladders of `mod.rs`. These files total about 39,000 lines (not 50,000 as first written).

**Ported, not rewritten: the street look.** The organic street shapes the owner likes come from the street field and its tracing in `quarters.rs` (`Field`, `Field::angle` at `quarters.rs:879`, `trace`, the recursive `split_quarter` at `quarters.rs:1569`). The new engine ports that code as `tissue/organic` and makes it write edges and faces into the graph instead of polylines. The same holds for each tissue later: the present cutters are the reference look, ported one at a time.

**Reused through an interface.** The lot cut (`parcels*`), the programme (`programme.rs`), building sites, massing, roles, the culture catalogue and forms, harbour furniture, the packs and the bridge, the whole display. The wall works (towers, gate houses, moat pieces, `fortification::build`) are reused; section 5 says what they require of a trace.

**Kept on classic at first, through the engine option**: camps, stilt and lagoon towns, tree dwellings, the Underdark, isolated structures and farms, informal quarters, and harbour towns until the harbour planner (`macroplan/harbour*.rs`, 3,905 lines, which produces the `structure.quays` that harbour furniture and roles consume) is ported behind the new armature. They move over one by one, or never.

**Existing street graph.** `street_graph.rs` (1,039 lines, used by `network::clean_terrain`) is classic's junction owner: it rebuilds a graph from polylines. The new engine does not reuse it as its model (its ids are rebuilt on each call and it holds no faces), but its node merging and tests are a starting point for `graph`.

## 3. The model

### 3.1 The graph

A half-edge structure. Elements carry:

- **identity**: a lineage key, never an allocation counter. A quarter's key is `(ring, station)`, where the station is the position of its host on the armature (the node it hangs from and the arm it opens), so that the same quarter gets the same key whatever order the ring is computed in and whether the ring is complete or truncated. A block's key is its quarter's key plus its path in that quarter's split; an edge's key is the key of the event that created it plus its rank in that event. Numeric handles for speed are an index into a table keyed by those keys.
- **`born`, `died`**: clock values. `died` is set by events that retire an element (a split edge retires and is replaced by two; a demoted road stretch retires).
- **`parents`**: the elements it came from (one for a split, several for a merge).
- **mutable attributes are versioned**: a rank or a role that changes at a date is a list of `(from, value)`, so that the town at any date is a filter.

Kinds:

- **Node**: position; kind (junction, street end, gate, water gate, bridge end, landing, town entry, dead end); arms in angular order.
- **Edge**: its two nodes; its polyline as drawn (shape kept, only the ends shared); `class` (street, lane, wall, quay, bridge, regional road, canal, **boundary**: the provisional outer limit of a ring, see 4.3); rank; width profile; `level` (ground, deck, terrace); the quarter that owns it; its chain.
- **Face**: its boundary cycles; kind (block, plaza, reserve, water passage, unbuilt). Faces are flat: the graph is one planar subdivision. A quarter is not a face but the lineage root of the faces it created.

**Decks**: a bridge or a raised road over a street is two edges at different `level`s that do not meet; planarity is checked per level, and a crossing of levels creates no node.

**Dangling edges** are allowed (a cul-de-sac, a derb): an edge whose end node has one arm lies inside a face, which then has an inner tree in its boundary walk.

**Water** stays in the survey as a mask with bank components; only quays, bridges, fords and canal banks are edges.

**From faces to buildable land.** A face is bounded by centrelines. A block's buildable outline is the face minus the half-widths of its boundary edges (with their width profiles), minus wall and works reserves, minus plazas carved inside it. This offset is computed per face from its own boundary only, so it never produces the hairlines of classic's ribbon differences; its robustness on sharp corners and very short edges is the first thing the spike must show (classic never established it: step 11 of the street-graph roadmap).

Operations, all local, each with invariant tests (Euler's relation per level, closed boundary walks, no crossing on a level, ids stable under re-ordering): insert an edge between two nodes in one face (split); insert an edge whose end falls on an edge (split that edge: it retires, two children are born); insert a dangling edge; remove an edge (merge two faces into one with two parents); merge two nodes; retype or rerank an edge at a date; query arms, sectors and the faces along a chain; a spatial index over edges per level. The removal and merge operations get one real caller in the first version: the demotion of a regional road through the centre (4.6).

### 3.2 The journal and the order of events

The town is the fold of an append-only list of events. Each event records its clock value, its inputs, the stream it draws from (keyed on the town seed and the event's lineage key, not its rank) and the ids it created.

| Event | What it does |
| --- | --- |
| `Found` | Inserts the regional roads crossing the site as chains; opens the founding quarter at the crossing, ford, castle or harbour the culture founds on, with the founding extent of 4.2. |
| `ExtendArmature` | Prolongs main chains outwards from existing nodes. |
| `OpenQuarter` | Lays a quarter between armature edges and boundary edges (4.3), with its streets by its tissue and its blocks. |
| `AgeQuarter` | Raises the fill level of a quarter's blocks by one step. |
| `RaiseWall` | Inserts a wall circuit around the faces existing at that date, with gates and reserves. |
| `CrossWater` | Inserts a bridge or a landing and opens the far bank. |
| `RetypeChain` | Changes the state of a stretch of a regional road (kept, demoted, ended) at a date: the first event that retires edges. |

Reserved, not implemented: `PierceStreet`, `MergeFaces`, `MergeLots`, `Rebuild`, `Demolish`.

**Order within one clock step**, fixed and tested: (1) the ring's armature extensions; (2) its quarters, laid in parallel into drafts and committed in canonical order of their station keys; (3) the count; (4) ageing of older quarters; (5) dated events whose threshold was crossed during this step (road fates, then walls, then water crossings), in that order; (6) the stop test.

**Stop and resume.** The stop is not an event but a checkpoint: the journal plus a cursor (ring, last station committed, the frozen cost field of that ring). Resuming continues the same ring from the cursor with the same frozen field. A ring's cost field and candidate order are frozen when the ring starts; armature built during the ring affects only the next ring.

**Prefix property**, restated: generating to P1, then resuming to P2, gives the same graph and the same journal as generating to P2 directly, at ring granularity. It holds if ring boundaries depend on the cost field and the graph only, ids come from lineage, every quarter's capacity is fixed at its birth (3.3), and the target population enters only the stop test. Lot occupancy across the whole town is *not* prefix-stable (3.3); the prefix property is a test on the graph and the journal, not on the final allocation.

### 3.3 Capacity, the clock and the count

Classic has two measures of housing (the layout probe sums allocated households; the slope check regenerates parcels, reallocates and caps by demand, `mod.rs:2342,2384`, `slopes.rs:98`), and the allocation redistributes households over the whole town on every call (`programme.rs:2578`): adding a quarter can move people out of old ones. A growth engine cannot stop on such a count.

The design therefore separates the clock from the final allocation:

- **Capacity at birth.** When a quarter is born, its blocks are cut with the existing lot cut on that quarter alone (the probe cadastre path), with the pressure, recipe, zone and density frozen at their value at birth (today pressure is scaled by total block area, `parcels/pressure.rs:108`, and raised inside any enclosure, `parcels.rs:393`). The households those lots hold, at the fill level of the quarter's age, are its capacity. It never changes afterwards except by `AgeQuarter`, which adds a precomputed increment.
- **The clock** is the sum of the capacities of the quarters born so far. Growth stops when it reaches the requested households.
- **The final allocation** runs once at the end, as today, over the whole town. It is checked against the clock: a town housing at least 90 % of its households is accepted with a one-line warning (owner, 21 November); below that, the gap is reported and the engine reopens growth at the cursor, at most once. The only hard floor is the standing rule: no town without houses.
- **Lots are cut twice** in the first versions: once per quarter for its capacity (cheap, frozen inputs), once at the end by the reused lot stage on the whole town. Reusing the birth cuts as final lots needs a new entry in `generate_parcels` that accepts retained cuts after block preparation, with explicit invalidation rules (seed, settings, geometry, frontage, cut-relevant programme inputs); that is milestone 7, not a premise.
- **Fill levels** are an occupation share applied by the allocation per quarter age. The hierarchical lot split (a child inside its parent, which the later chronology needs) is not assumed: European organic cuts burgage strips, the organic cutter relaxes a whole-block Voronoi, Roman and Chinese grids use courtyard operators, the medina cuts shop strips and subdivides the rear (`parcels/organic.rs`, `parcels.rs:4707,4725`, `parcels/families.rs:505`), and none keeps a parent tree through repairs and consolidation. Milestone 2 tests whether a fixed set of leaves per block, occupied progressively, is enough; nested subdivision is a later decision.

### 3.4 Single writer

Only `journal` mutates the graph. Every other module is a function from a read-only view of the graph and the survey (and its spec) to a list of operations; `journal` validates and applies them. This is the rule that prevents classic's tangle, where nearly every function takes `&mut Layout`: no module can depend on another's side effects, and every change is visible as an operation in the journal.

## 4. One generation, step by step

### 4.1 Survey

Once per site, from the terrain alone: slope, cliffs, water and its connected bank components, the neighbours' claims, the pinned centre and the imposed radius. Result: a cost field over open land and a mask of closed land (neighbours' land, water, cliffs, outside an imposed radius).

Cost of a cell: distance to the centre along the graph and across open ground, times a slope factor (flat 1, rising steeply towards the culture's terrace limit), plus a charge per water crossing. Slope is a cost and a density, not a gate: flat land opens first, a steep cell opens only when cheaper land is used up, with a lower density and the culture's terraced tissue; only cliffs are closed.

### 4.2 Founding

The founding quarter is placed at the site's focus (crossing of regional roads, ford, castle, harbour), chosen by the culture's founding rule. Its extent is a **founding population** read from the culture (a market village, a castrum, a planned grid, a castle town), not from the target population: the target only says when to stop. A castrum or a planned grid founds a larger extent at once and may raise its wall at founding (5).

### 4.3 Rings and quarters

- **Ring.** The cells whose cost lies between two levels. The levels are fixed steps of the cost field (in effective metres), not fractions of the target, so ring boundaries never depend on the population asked.
- **Armature first.** At the start of a ring, main chains are extended across it from existing nodes: regional roads first, then the tissue's axes (radials, rings, grid axes). They split the ring into **sectors**.
- **Quarter.** A sector of the ring, between two armature chains, the previous ring's outer boundary and a new **boundary** edge along the ring's outer cost level, simplified and snapped to the nearest terrain feature (bank, contour, field line). A boundary edge is a provisional limit: when the next ring opens on the other side, the quarter laid there either keeps it as a street (back lanes of a ring road, a common case in grown towns) or the tissue's streets cross it and it retires. Concentric rings are avoided because the tissue lays the streets inside the quarter, and the boundary is only kept when the tissue says so.
- **Truncated ring.** The stop keeps the ring's quarters up to the one that reaches the target, in station order; the others are discarded before their lots are cut.

### 4.4 The tissue

The tissue lays a quarter's streets and blocks inside its outline. `tissue/organic` is the port of classic's field and trace (2); other tissues follow in milestone 6. A tissue reads the outline, the survey (contours for streets along slopes), the armature and its spec; it returns edges and faces. Stepped links on steep ground are short edges of role `stairs`, placed only across a contour where the slope exceeds the street grade, by the owner's rule (no long clusters of flights).

### 4.5 Ageing

Older quarters gain one fill step at each ring; when land runs out (pinned radius, island, neighbours), ageing continues without new rings until the core reaches its last fill step or the target is housed. A walled interior ages one step further than the outside.

### 4.6 Regional roads

A regional road enters the graph at `Found` as a chain, with its source segment ids and station intervals carried through the import (today `rust/bridge/urbanRoads.ts` splits regional segments into anonymous urban streets). Inside the town each stretch has a dated state:

- **kept**: a main street (grown towns: the road was there first);
- **absorbed**: carried by the nearest grid axis (planned grids);
- **demoted or ended**: when the town grows past a culture- and size-dependent threshold, a `RetypeChain` event demotes the central stretch to ordinary streets, cuts it at a plaza or precinct, or ends the road at a gate or an entry node. This is the usual fate of a road through the centre of a large town, and it happens late, not at founding.

The engine returns, per regional road, its entry nodes and the intervals kept, redirected or ended. The regional network must then update its endpoints, connectivity, crossings and lengths, and the display and the road editor must use that result (`rust/bridge/urbanNetwork.ts`, `web/src/render/cityBridges.ts`, `web/src/v2/urbanRoadEditing.ts`): hiding a stroke while the regional graph keeps a routable edge across the town would be wrong. This is milestone 5.

### 4.7 Water and slope

Each bank is a connected component of the survey. A far bank opens by `CrossWater` when its land is cheaper than what is left on the near side; the crossing is placed on the armature, square to the flow. Quays are edges along a bank inside the town; harbour basins wait for the ported harbour planner (2).

### 4.8 Finish

After the stop: fringe (exits, gate villages, fields handed to the land-use stage), neighbour claim, the adapter (9), then the final lot cut, programme and building sites. Finish work is outside the journal: it is recomputed from the final graph and never resumed.

### 4.9 Warnings and constraints

A pinned centre stays exactly where it was put; an imposed radius closes the land beyond it; a town that runs out of land is delivered smaller. Warnings are one short line in English with their French translation: the fact, the figure, the cause in three words ("Housing 91 % — steep site", "No wall — neighbour too close"); the detail goes to the journal.

## 5. Walls: when, where, and what the works need

- **When.** At a population read from the culture, as a new catalogue value per culture (today `profiles::fortification`, `profiles.rs:117`, is a yes or no on the final population), or at founding for a castrum, a planned town or a castle town. A second circuit may come when the population outside reaches a set share of the inside.
- **Where.** Around the faces existing at that date, through land not yet opened: the wall cuts no block and is never refitted. Along water it stands back from banks and shores, crosses a channel on a flow-normal span with a water gate, and keeps both occupied banks in one circuit; these rules failed three times in classic only because classic had to refit an existing plan (`web/out/roads-2026-11-20/walls-water/NOTES.md`).
- **Neighbour clearance** is checked on the final joined circuit, after any rounding, and the circuit is pulled back locally where it touches a claim; a wall is never dropped for a local overlap. (Classic lost a medina's wall because the rounding of a joined circuit crossed a claim by 95.72 m² while every piece cleared it.)
- **Gates.** The edges leaving the town at that date are ranked (regional roads, then main streets); the best, up to the number the circuit's length allows, become gate nodes; the others end at the wall; the curtain turns square to its street at a gate.
- **What `fortification::build` requires** (`fortification.rs:1428` and its callees): an explicitly closed path; land gates first, then ordered entry and exit waterline intercepts; the actual street segments at each gate (it searches within 0.1 m for direction and width); the physical surface; the resolved style; the event population; predicted widths and dwelling dimensions; a random stream. It returns lanes and writes works and reserve polygons. The adapter supplies all of it from the graph, and the works and reserves are inserted as faces *before* any lot next to the wall is cut.
- **After.** Inside, quarters only age. New quarters are born outside, attached to gate nodes: the faubourgs. The moat reserve is closed land. An older wall stays in the graph.

## 6. What disappears

The capacity forecast, its donor probes and the replan; the slope relaxation levels and the household ladders; the whole-town trim loop and its second run after a wall; the fit of the wall to the built land; the junction repairs (`planarize`, `join_close_ends`, `drop_stubs`); the display's own joining of street ends once it reads nodes. Every knife-edge of the stability diagnosis sat in one of these.

## 7. The later chronology: what is anticipated, what is not

**Built now:** lineage ids; `born`, `died` and versioned attributes; the operations that retire and merge (with a real caller, 4.6); the journal as the only way to change a town; finish outside the journal.

**Not solved by this design, and to be rewritten when the chronology comes** (honest list; both reviews found it):

- Everything downstream is keyed by index: `Parcel.block` (`mod.rs:456`), `ParcelContact.street` (`mod.rs:470`), programme reservations by block and street (`programme.rs:118`), block environments (`programme.rs:170`), districts by quarter (`mod.rs:311`), block override keys (`mod.rs:1114`), building site access (`building_sites.rs:20`), the parcel pack (`parcel_pack.rs:592`). `Street`, `Block` and `Quarter` have no id field.
- Lot identity is a hash of the block outline (`parcels.rs:734`): piercing a block would re-identify and re-roll all its lots.
- Lot cut and allocation run over the whole town (`mod.rs:2509`): one pierced street would reshuffle who lives where.

So the first versions carry graph ids into the `Layout` as new optional fields and keep the index fields; moving the downstream stages to ids, a per-block cut and allocation, and lot identity from face lineage are a separate project before any core-modifying event. The design commits to making that project possible, not to doing it.

## 8. Code organisation

A new crate, `magna-urbis-town`. Before it, a mechanical extraction below both engines:

- a **geometry kernel** crate: `Point`, `Shape`, the polygon operations of `urban/geometry` (today it imports `Surface`, and `dry_clip` calls vector geography: those calls stay in core);
- a **surface view**: sampling of height, slope and water, and dry clipping, split from the town policy in `geography.rs` (which also holds stilt planning, parcel generation and routing: those stay in core);
- the random streams already have a leaf crate (`rust/crates/random`).

Specs are resolved in core and passed as plain data: tissue, occupancy, admission and fortification specs built from the catalogue and the profiles (`profiles.rs`, `culture.rs`). Counting lots needs the lot cut, which stays in core: the town crate defines a `Capacity` trait that core implements (a quarter's blocks and frozen inputs in, households out). The dependency stays one-way, core → town.

| Module | Holds | Reads |
| --- | --- | --- |
| `graph` | half-edge structure per level, operations, invariants, spatial index | geometry |
| `journal` | events, the single writer, replay, checkpoints, dumps | graph |
| `survey` | slope, banks, cliffs, masks, cost field | geometry, surface view |
| `armature` | main chains, regional roads and their fate | graph, survey |
| `tissue/*` | one file per pattern: organic (ported field and trace), grid, radial, medina, ward, string | graph, survey |
| `walls` | when, where, gates, water fronts, clearance | graph, survey |
| `water` | crossings, quays | graph, survey |
| `growth` | the orchestrator: rings, order of events, count through `Capacity`, stop, resume | all of the above |
| `export` | the plan handed out: graph, faces, dates, warnings | graph, journal |

Rules: dependencies only as listed; only `journal` writes; no file over about 800 lines; no function that takes the whole town when it needs one face; no culture lookup inside the crate. Where complexity will pile up anyway, and the guard for each: `tissue/organic` (split the port by step: field, trace, split, blocks), `walls` (trace, gates and water fronts in separate files), `growth` (only order and stop; all geometry in the modules it calls), the adapter in core (one file per consumer family, section 9).

**Debugging.** Every run can write its journal; `replay --until <event>` rebuilds the graph at any step; a dump per event (JSON, and later an SVG) shows what it added. A fault is found by bisecting the journal.

**Tests.** Per module on small hand-made inputs; graph invariants as property tests; ids stable under shuffled worker completion; the prefix property on three towns; stopping inside a ring just before ageing and just before a wall threshold, with exhausted land and with zero admissible homes; then the replay suite of `web/out/perf-2026-11-14/`.

## 9. The contract with the rest of the chain

The adapter (in core, `urban/town_adapter/`, one file per consumer family) writes a `Layout` that the reused stages accept. It is not thin. Beyond streets, blocks, quarters and enclosures, the later stages read:

- **Lots** (`parcels*`): phase culture, recipe and zone, which select the cutter (`parcels.rs:4228`); district membership, which selects tissue (`parcels.rs:4397`); planned population and optional capacity data (`parcels.rs:4251`); `archetype` and `config`; block kind (buildable or `reserve:*`) and axis; street paths, per-sample widths, ranks and roles for frontage and kerb contact (`parcels.rs:290-310,374,3032`, `parcels/contacts.rs:142,173`: `boundary` and `bridge` excluded, `derb`, `hutong`, `roji`, `close` change access); `programme.environment` and gate pressures (`parcels.rs:4194,4201`).
- **Programme, building sites, massing**: centres and streets for network pressure (`parcels/pressure.rs:52`); slope, wetness and navigable quay frontage; district roles and wealth; blocks turned into `reserve:programme`; zone, pressure and distance to the centre for massing (`programme.rs:586,624,637,1089`, `building_sites.rs:144,310,1221`, `massing.rs:250,516`).
- **Structure**: centres, districts, allocated and reserve masks, metrics, history, quays and port districts, springs, gate village centres (read by the bridge and the page, for example `web/src/v2/roadTownAccess.ts`).
- **Neighbours and edits**: the claim (held land, outward street stubs, programme reservations, enclosed interiors, works, quays; `neighbours.rs:20,621`); the quarter edit baseline (`edits/quarter_baseline.rs`).
- **Packs and bridge**: block and street indices in the parcel pack; district role and wealth joined to blocks in the display pack; structure version, mechanism, family, phases with kind, population, target area and shapes (`rust/bridge/urban.ts:62,95`).

**The tail of classic's layout stage** (`mod.rs:1986-2166`, about 25 calls) is decided call by call:

| Call | On a growth layout |
| --- | --- |
| `kinds::stamp`, `kinds::finish` | run (kind bookkeeping) |
| `trim::prepare`, `trim::run`, `trim::finish`, `trim::bridgeheads`, `trim::footprint` | dropped: growth keeps only what it built |
| `access::refine`, `access::summarize` | run: access lanes and deep-block lanes, districts (`access.rs:409-451`) |
| `fortification::enforce`, `settle`, `sync_gates`, `drop_dead_gates` | replaced by `walls` |
| `fortification::prepare_options`, `finish_options` | run (wall options read by the programme) |
| `composition::fit_enclosures`, `join_side_by_side`, `fit_built_circuits` | dropped |
| `network::polish_ends`, `clear_water`, `bridge_water_on_ground`, `select_bridges_graded`, `tie_banks_to_road`, `ensure_regional_access`, `reserved_streets`, `remap_reservations` | replaced by `armature` and `water` (the graph guarantees what they repair) |
| `programme::prepare` | run, once, after the adapter |
| `springs::reserve` | run |
| `lagoon::apply`, `shanty::extend` | not on growth layouts (those kinds stay on classic) |
| `harbour_furniture::furnish` | run once the harbour planner is ported |
| `neighbours::settle`, `neighbours::claim` | run |
| `edits::with_quarter_edits` | not available on growth towns until milestone 8 |

## 10. Interfaces

- **Option**: `layout.engine` = `classic` (default) or `growth`, shared by the V2 and City Bench through the city contract, with the parity test extended.
- **New optional fields** in `Layout`: the graph (nodes, edges, faces, ids, dates, levels) and the regional road result (4.6). Index fields stay.
- **Bridge and packs**: one optional field each; the WebAssembly packages and the native engine are rebuilt together when it lands (a contract change breaks the page otherwise).
- **Display**: unchanged at first; later it reads nodes and drops its own end joining.
- **Saved projects**: a town saved with one engine is regenerated by that engine; nothing is migrated.

## 11. Performance

Classic today (quarters stage, 8 threads, `runs-main1`): about 2 s at 10,000 inhabitants, 4.5 s at 20,000, 11 s at 50,000, 13 s at 100,000; towns paying a redraw take 12 to 60 s.

The saving must come from not redrawing and not trimming, and can be eaten by per-quarter repetition of global work: in classic the street split of a 20,000 town costs 1.4 s, one bridge request lap 0.6 s, the final cut 0.2 s; at 100,000 the final cut and the first allocation cost 0.8 and 0.2 s. Rules: the birth cut of a quarter reads frozen inputs and never a town-wide quantity; the cost field is updated per ring, not per quarter; rings are wide enough to keep the parallel pool busy (classic cuts 109 quarters in one parallel pass), and a thin ring is merged with the next one for the parallel work while keeping its own clock steps.

Targets, measured on layout plus parcels (the birth cuts move lot work into the layout stage), on the replay suite, natively and in single-thread and threaded WebAssembly: never slower than classic on a supported town; at most 70 % of classic from 20,000 inhabitants, as an experiment to confirm per tissue; no town over 1.5 times the median of its size class. Also measured: journal and graph memory and their transfer to the page.

## 12. Roadmap

Each milestone is one or more sessions of two to three hours, one at a time, ending on measures and, where towns change, a sheet.

| | Milestone | Delivers | Sessions |
| --- | --- | --- | --- |
| 0 | Extraction | geometry kernel and surface view below both engines; classic unchanged (replay suite identical) | 2 to 3 |
| 1 | Spike | `graph` (the operations needed), `journal` minimal, one hand-placed quarter with the ported organic field, faces to buildable blocks, capacity through `Capacity`, the adapter for an ordinary town, a sheet against classic on native, WebAssembly and in the V2; resume from a checkpoint | 6 to 8 |
| 2 | Growth | survey and cost field, rings, sectors, boundary edges, the stop, ageing, the prefix tests; a fixed set of leaves per block occupied progressively, on three cultures | 6 to 8 |
| 3 | Slope and water | cost and density by slope, terraced tissue, stepped links, banks, crossings, quays | 5 to 7 |
| 4 | Walls | dates in the catalogue, trace, gates, works through `fortification::build`, faubourgs, water fronts, clearance | 6 to 8 |
| 5 | Regional roads | segment ids through the import, dated fates, the regional network and display update, the editor | 4 to 6 |
| 6 | Tissues | grid, medina, wards, radial, street village, each ported from classic's look | 8 to 12 |
| 7 | Retained cuts | `generate_parcels` accepts the birth cuts, with invalidation; one cut instead of two | 3 to 4 |
| 8 | Product | V2 edits on growth towns, harbour planner port, neighbours and pinned sites at scale, performance pass, review sheets against classic | 6 to 10 |

About 50 to 70 sessions. A first town is visible at the end of milestone 1 (about two weeks at the present pace). What can be cut if needed: the second circuit, SVG dumps, V2 edits on growth towns (they stay on classic), retained cuts.

## 13. Risks

- **The spike may show that faces offset into buildable blocks are not robust** on sharp corners and short edges. Then the face stays the model and the buildable outline is computed by classic's ribbon method per face; the engine still gains the graph and the growth, not the hairline fix.
- **The ported field may not behave inside small quarter outlines** as it does inside classic's large ones (look of the streets). The spike's sheet decides.
- **Capacity at birth versus final allocation**: if the gap is often above 10 %, the final allocation must become per quarter, which touches `programme.rs`.
- **Two engines to keep.** Accepted: classic is frozen, and the kinds that never move stay there.
- **The long tail** (edits, harbours, special kinds) is where a rewrite usually stalls: it is last on purpose and may stay on classic.

## 14. Open questions for the owner

1. Wall dates: per culture in the catalogue (recommended), with one global setting to advance or delay them?
2. Fate of regional roads inside towns: decided by culture and size (recommended), with a per-town override in Advanced?
3. First tissue after organic: grid (Roman, Chinese) or medina?
4. Harbour towns on classic until milestone 8 (recommended), or the harbour planner earlier?

## 15. Not verified

Nothing was built or run for this document. Not established: that the face offset is robust (milestone 1); that the organic field ports to quarter outlines without losing its look (milestone 1); that a fixed set of leaves per block supports staged occupation on three tissues (milestone 2); the gap between capacity at birth and final allocation; laptop and WebAssembly latency. The reviews did not read in full `programme.rs`, `trim.rs`, `edits.rs`, `parcels/occupation.rs`, `kinds*.rs` or the V2 edit tools beyond their index keys. The session estimate is a judgement.
