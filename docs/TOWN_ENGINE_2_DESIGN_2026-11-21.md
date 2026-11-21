# Town engine 2: growth by dated steps on a graph

21 November 2026. Definitive design, approved by the owner on 21 November after two rounds of independent review (Fable 5.2 and Astra 6.2) and three rounds of discussion. Nothing described here is implemented yet; the order of work is in `TOWN_ENGINE_2_PLAN_2026-11-21.md`. It replaces, for the new engine, the roadmap of `STREET_GRAPH_DESIGN_2026-11-20.md` (steps 2 to 13) and the repair plan of `PLANNER_STABILITY_DESIGN_2026-11-21.md`, whose diagnosis it keeps as the list of what not to rebuild. It extends `GROW_UNTIL_HOUSED_2026-11-15.md`. Paths without a prefix are in `rust/crates/core/src/urban/`.

## 1. Summary

- The present layout engine stays as it is ("classic"), frozen: bug fixes only. A second engine ("growth") is written beside it, chosen by a layout option; classic stays the default until the owner approves growth towns on review sheets.
- Growth replaces the layout stage (land, armature, quarters, streets, blocks, walls, harbour plan). The later stages (lots, programme, building sites, display) are reused through an adapter that is not thin: section 10.
- A town is one planar graph. Streets, walls, quays and bridges are typed edges between shared nodes; blocks are faces; a quarter is the lineage root of its faces. Every element has an identity derived from its lineage and a birth date.
- A town is built by dated events. The clock is the housed population. The **charter**, decided at founding, holds only what never changes (culture, site, founding focus, planned or grown, defensive intent, the town's own draws). The **phases** (hamlet, village, market town, town, city) are dated promotions at thresholds drawn per town around the culture's values and moved by circumstances; a promotion changes what is born afterwards, never what exists.
- Growth draws a classic street skeleton (main axes and quarter streets) ahead of the houses, opens its cells as quarters in the order of an anisotropic cost field, and stops when the households are housed. There is no capacity forecast, no replan, no whole-town trim loop, no global slope slider.
- A wall's land is **surveyed before it is built**: a closed precinct is traced on open land, by today's tracers (stiffness, relief, square, bastioned), with its gates; only its sectors open, in compact tissue, up to the wall street; the wall is **raised when the precinct is full**. Density and wall therefore come from one prior decision, as in classic, and the town adapts to its wall.
- Harbour fronts are surveyed before founding. A harbour can found the town; otherwise a harbour road is part of the armature from founding and growth stretches along it to the water. The harbour is decided before the wall in every step, and the wall takes it as a constraint. A distant harbour belongs to its town.
- Fortified camps, hilltop castles and nested walls follow from the same model: a camp is an enclosed charter with a camp tissue; a castle on a height is a founding focus; an inner circuit is a former outer wall.
- Planned towns (imperial Chinese capitals, colonial grids built for 100,000) are a charter choice offered in the visible town settings: their frame is drawn for a planned capacity and filled over time.
- About 55 to 75 sessions. The first milestone after the extraction is a spike: one occupied quarter with today's street look, exported, counted, resumed, shown in the V2.

## 2. Scope

**Replaced, in the growth engine only** (about 39,000 lines of classic): `footprint.rs` and `footprint/*` except what section 10 keeps, `composition.rs`, `quarters.rs`, `network.rs`, `trim.rs`, the trace and gate decision of `fortification*.rs`, `macroplan*.rs` including the harbour plan, `slopes.rs`, `footprint/capacity.rs`, the ladders of `mod.rs`.

**Ported, not rewritten.** The look is classic's, ported piece by piece:
- streets: the organic field and its tracing (`quarters.rs`: `Field`, `Field::angle` at line 879, `trace`, the recursive `split_quarter` at line 1569) become `tissue/organic`; each other tissue is ported from its classic cutter;
- wall traces: `parameter_trace` (`fortification_params.rs:41`), `village_trace`, `hill_trace`, `square_trace`, `bastioned_trace` (`fortification.rs:1271`), `straight_across`, `attach` (`fortification_extension.rs`), the castle contour of `fortification_heights.rs`;
- harbour siting and fronts: `shore_runs`, the gentle-bank and navigability tests, `harbour_shelter.rs`, the quay rules of `macroplan/harbour.rs` (one continuous quay between water and the first row of lots, length `quayPerSqrtPop`·√P, a landing street about every 120 m, never behind a bank street);
- camp figures: the tessellation of `parcels/camp.rs` and the camp kinds of `kinds.rs`.

**Reused through an interface.** The lot cut (`parcels*`), the programme (`programme.rs`), building sites, massing, roles, the culture catalogue and forms, harbour furniture, wall works (`fortification::build`), the packs and the bridge, the whole display.

**Kept on classic**, through the engine option, until they move or for good: stilt and lagoon towns, tree dwellings, the Underdark, isolated structures and farms, informal quarters (shanty extension). Camps and harbour towns move in milestones 3 and 6 (plan).

**Existing street graph.** `street_graph.rs` (1,039 lines, classic's junction owner) rebuilds a graph from polylines on each call and holds no faces; it is not the model, but its node merging and tests are a starting point for `graph`.

## 3. The model

### 3.1 The graph

A half-edge structure, one planar subdivision per `level` (ground, deck, terrace).

Every element carries:
- **identity** from lineage, never from allocation order. A quarter's key is `(step, station)`, the station being the position of its host on the skeleton (the node of its walk's smallest edge and that half's rank among the node's arms), so the same quarter gets the same key whatever order a step is computed in and whether the step is complete or truncated. A block's key is its quarter's key and its path in the quarter's split; an edge's key is the key of the event that created it and its rank in that event. Numeric handles are indices into a table keyed by those keys.
- **`born`, `died`** (clock values); an element that is split or merged retires and its children are born.
- **`parents`**: one for a split, several for a merge.
- **versioned attributes**: a rank, role or class that changes at a date is a list of `(from, value)`; the town at any date is a filter.

Kinds:
- **Node**: position; kind (junction, street end, dead end, gate, water gate, landing, bridge end, town entry, castle gate); arms in angular order.
- **Edge**: two nodes; its polyline as drawn (the shape is kept, only the ends are shared); `class` (street, lane, stairs, wall, precinct, quay, bridge, regional road, harbour road, castle road, canal, boundary); rank; width profile; level; owner quarter; chain.
- **Face**: boundary walks; kind (block, plaza, reserve, works, apron, common, bailey, unbuilt).

Rules:
- **Decks**: a bridge over a street lies on another level; no node where levels cross.
- **Dangling edges** are allowed (cul-de-sac, derb): the face keeps an inner tree in its walk.
- **Water** stays a survey mask with bank components; quays, bridges, fords and canal banks are edges.
- **Buildable outline of a block**: the face minus the half-widths of its boundary edges (with their width profiles), minus works and reserves, minus plazas carved inside, computed per face from its own boundary. It cannot produce the hairlines of classic's ribbon differences; its robustness on sharp corners and very short edges is the first thing the spike proves.

Operations, each with invariant tests (Euler per level, closed walks, no crossing on a level, ids stable under re-ordering): insert an edge in a face (split); insert an edge ending on an edge (that edge retires, two are born); insert a dangling edge; remove an edge (two faces merge, one face born with two parents); merge nodes; retype or rerank at a date; query arms, sectors, faces along a chain; spatial index per level. Retire and merge have real callers from the start: road demotion (4.6), precinct retype (5.3).

### 3.2 The journal

The town is the fold of an append-only list of events. Each records its clock value, inputs, its random stream (keyed on the town seed and the event's lineage key) and the ids it created.

| Event | What it does |
| --- | --- |
| `Found` | Applies the charter: regional roads as chains, founding focus (crossing, ford, castle, harbour, planned frame), harbour road or castle road if any, the founding precinct if the charter is enclosed, the founding quarter. |
| `Promote` | Moves the town to its next phase: new regime for what is born afterwards (5.1). |
| `ExtendArmature` | Draws the street skeleton: at founding over the land the focus reaches, later over a far bank a crossing reached (4.4). |
| `OpenQuarter` | Lays a quarter in a cell of the skeleton: streets by its tissue, blocks; builds the planned streets along it. |
| `AgeQuarter` | Raises the fill level of a quarter's blocks by one step. |
| `SurveyPrecinct` | Traces the next precinct on open land, with its gates, wall street and reserves (5.2). |
| `RaiseWall` | Retypes a full precinct into a wall of the phase's kind; creates no geometry. |
| `RetypeChain` | Changes a chain's class or rank at a date (road demotion, old wall into boulevard, fossil). |
| `OpenHarbour` | Inserts the quay edge, apron face and landing nodes on a surveyed front. |
| `ExtendHarbour` | Lengthens the quay, adds piers, moles and basins at their thresholds, adds water gates at new landings. |
| `CrossWater` | Inserts a bridge or a ferry landing and opens a far bank. |

Reserved, not implemented: `PierceStreet`, `MergeFaces`, `MergeLots`, `Rebuild`, `Demolish`.

**Order within one growth step**, fixed and tested:
1. the cost field is frozen; a far bank newly reached by a crossing gets its skeleton;
2. the frontier cells within the step's cost span of the cheapest (at most eight), laid in parallel into drafts, committed cheapest first, ties by station key;
3. the count;
4. ageing, intramural first;
5. dated events whose threshold was crossed during the step, in this order: promotions; road fates; harbour (open, extend); wall (raise a full precinct, then survey the next); water crossings;
6. the stop test.

A step is split at the first quarter whose commit crosses a threshold, so that dated events see the town exactly as it stood.

**Stop and resume.** The stop is a checkpoint, not an event: the journal and a cursor (step, last station committed, the step's frozen cost field). Resuming continues from the cursor. A step's cost field and candidate order are frozen when it starts; streets built during the step affect the next step only.

**Prefix property.** For a given charter, generating to P1 then resuming to P2 gives the same graph and journal as generating to P2 directly. It holds because the skeleton depends on the site, the charter and the seed only, the opening order on the cost field and the graph only, ids come from lineage, capacities are fixed at birth (3.3), thresholds are drawn from the seed, and the target enters only the stop test. Two exceptions, both decided by the owner on 21 November: a planned charter draws its frame for a planned capacity (5.4); and a town asked smaller than its culture's planned founding cohort is founded in the culture's village form. The final allocation is not prefix-stable and is not tested as such.

### 3.3 Capacity, the clock and the count

Classic has two measures of housing and its allocation redistributes households over the whole town on every call (`mod.rs:2342,2384`, `slopes.rs:98`, `programme.rs:2578`). Growth separates the clock from the final allocation.

- **Capacity at birth.** When a quarter is born, its blocks are cut by the existing lot cut on that quarter alone, with pressure, recipe, zone, density and the intramural regime frozen at their values at birth (today pressure is scaled by total block area, `parcels/pressure.rs:108`, and raised inside any enclosure to 0.65 + 0.35·p, `parcels.rs:393`). The households its lots hold at its fill level are its capacity. Ageing adds a precomputed increment.
- **The clock** is the sum of capacities born so far. Growth stops when it reaches the requested households.
- **The final allocation** runs once at the end over the whole town. A town housing at least 90 % of its households is accepted with a one-line warning; below that, growth reopens at the cursor once and the gap is reported. The only hard floor: no town without houses.
- **Lots are cut twice** in the first versions (birth cut for capacity, final cut by the reused lot stage). One cut is milestone 9 of the plan (retained cuts with explicit invalidation).
- **Fill levels** are an occupation share per quarter age, applied by the allocation. Milestone 2 tests that a fixed set of lots per block, occupied progressively, is enough on three tissues; a hierarchical lot split is not assumed.

### 3.4 Single writer

Only `journal` mutates the graph. Every other module is a function from a read-only view (graph, survey, spec) to a list of operations, which `journal` validates and applies. No module depends on another's side effects; every change is visible in the journal.

## 4. One generation

### 4.1 Survey

Once per site, from the terrain alone:
- slope, cliffs, breaks of slope, crests;
- water, its connected bank components, navigability;
- **harbour fronts**: gentle, navigable shore runs of usable length with a shelter score, each keyed by bank component and station, within the culture's harbour reach of the site (not only next to it);
- **strong points**: prominent, level-topped, dry heights reachable at lane grade, scored as classic's knoll test;
- neighbours' claims, the pinned centre, the imposed radius.

Result: a cost field over open land and a mask of closed land. Cost of a cell: distance to the centre along the graph and across open ground, times a slope factor (flat 1, rising towards the culture's terrace limit), plus a charge per water crossing, minus a fixed-length discount around a chosen harbour front. Slope is a cost and a density, not a gate: steep land opens late, less dense, terraced; only cliffs are closed.

The field is **anisotropic and irregular**: a metre along a regional road costs 0.3, along a built main street 0.5, along any other built street 0.8 (`GrowthSpec::regional_road_cost`, `axis_cost`, `street_cost`), so the town runs out along its roads first and fills between them afterwards; open ground is scaled by a seeded two-octave noise of ±25 % (`cost_noise`, wavelength `cost_noise_wavelength` 350 m), so that it does not grow alike in every direction. Planned streets of the skeleton not built yet carry no discount.

### 4.2 The charter

Decided at founding, never changed afterwards. Plain data resolved in core from the culture, the site and the town's seed:
- **founding focus**: crossing of regional roads, ford, bridge, harbour front, strong point (castle), planned frame;
- **form**: grown, or **planned** (a frame drawn for a planned capacity: castrum, Chinese imperial or prefectural grid, bastide, colonial grid). Drawn from the culture's share, and settable by the user (5.4);
- **defensive intent**: enclosed from founding, walled when grown, or never; drawn from the culture, the site archetype (a spur, a hilltop, a meander raise it) and the per-site draw that exists today (`kinds.rs:429`);
- **the town's draws**: promotion thresholds (5.1), precinct steps and gains (5.2), wall kind ladder, fossil rule (whether an old wall stays, becomes a boulevard or disappears), extension habit (lobes or concentric), harbour enclosure habit.

The charter never reads the target population, except for the two exceptions of 3.2.

### 4.3 Founding

`Found` places the focus and the founding quarter. If the focus is a harbour front, the founding quarter lies between the quay and the market. If the town's best front is not at the focus but within reach, a **harbour road** is laid from the focus to it as an armature chain. If the focus is a strong point, the castle circuit is traced on its contour and raised at once (its interior is a bailey, outside the housing budget), a **castle road** switches back down to the regional road, and the founding quarter opens on the first buildable shelf below the castle gate. If the charter is enclosed, the founding precinct is surveyed (5.2) before the founding quarter is laid in it. If the charter is planned, the frame is drawn (5.4).

### 4.4 Skeleton, frontier, quarters

The first sheet (checkpoint A, 21 November) condemned ring bands: iso-cost rings on a plain are circles, their boundaries became streets, and the town read as concentric circles with straight rays, growing alike in every direction. Classic owes its realism to a street skeleton: regional roads, main streets curving out from the centre, and quarter streets cutting the land between them into irregular cells (`macroplan.rs`: `cultural_spines`, then the recursive balanced split of the largest region by routed cuts); its organic field then lays a spider web inside each large cell, and its edge is ragged because only what is built is kept. Growth keeps that mechanism and dates it: quarters are delimited by a classic street skeleton laid ahead of the houses, and opened between its streets in cost order.

- **Skeleton, laid ahead of the houses** (`growth/skeleton.rs`, `ExtendArmature { ring: 0 }`, after `Found`): over all the land the focus reaches within the survey (holes filled), (1) the land's limits (banks, cliffs, neighbours, the reach) as boundary edges that never become streets; (2) the main axes of 4.2, each traced from the focus through the organic street field (the field the tissue uses), pulled back towards its bearing so it keeps running outwards, turned aside by closed land, across regional roads, up to the land's limit or an earlier axis; (3) quarter streets: the organic tissue's own recursive split, run on each region between roads and axes with quarter-sized targets (`quarter_area` 1.5 ha at the focus, drawn from 0.9 to 1.9 times, widened by one quarter every `quarter_growth` 250 m from the focus: 4 to 6 ha at 600 m, about 10 ha at the reach). The cuts are traced through the field, so junctions come out as T's and oblique crossings and the cells are irregular. A far bank gets its skeleton when a crossing reaches it.
- **Planned, then built**: axes and quarter streets are boundary edges with their street rank and width. Opening a cell turns every axis along it into a street (ribbon development along the main streets), and each quarter street it shares with an older quarter; its other edges stay provisional and are not exported. The town's outer edge is what the last quarters' tissue drew, with blocks fronting only their own streets on that side: classic's ragged edge, without a trim.
- **Frontier and order**: the frontier is the unopened cells that touch the town (the focus at first, a far landing on a far bank). A cell's cost is the mean of the cheapest third of samples taken along its edges and at its interior point, so a cell along a road or a built street is cheap even when its far side is not. Each step opens the frontier cells within `step_span` (60) of the cheapest, cheapest first: tentacles along the roads, then infill between them.
- **Quarter**: one cell, laid by the tissue of the phase at its birth inside the cell's outline; the core's quarters are small and old (denser fill and compact rebuild with age, 3.3 and 4.7), the outer ones wide.
- **Inside an open precinct** only the precinct's cells open, and its wall street bounds them (5.2); the precinct line splits the cells it crosses.
- **Truncated step**: the stop keeps the step's quarters up to the one that reaches the target, cheapest first.

Because cost is measured along the graph, growth stretches along the harbour road and the castle road: the town grows towards the water or under its castle without a special rule.

### 4.5 Tissue

A tissue lays a quarter's streets and blocks inside its outline. It reads the outline, the survey (contours for streets along slopes), the armature, the wall street and gates of its precinct, the quay of its harbour, and its spec (from the culture and the current phase). Waterfront quarters receive the quay as their front: streets square to it at the landing nodes, the first row of lots on the quay. Stepped links on steep ground are short `stairs` edges across a contour where the slope exceeds the street grade (owner's rule: no long clusters of flights).

### 4.6 Regional roads

A regional road enters at `Found` as a chain, with its source segment ids and station intervals carried through the import (today `rust/bridge/urbanRoads.ts` splits regional segments into anonymous urban streets). Each stretch inside the town has a dated state: **kept** as a main street; **absorbed** by a grid axis (planned towns); **demoted or ended** by a `RetypeChain` when the town passes a phase whose spec says so (the usual fate of a road through the centre of a large town), cut at a plaza or precinct, or ended at a gate or entry node. The engine returns per road its entry nodes and the intervals kept, redirected or ended; the regional network, the display and the road editor apply that result (`rust/bridge/urbanNetwork.ts`, `web/src/render/cityBridges.ts`, `web/src/v2/urbanRoadEditing.ts`), so that no routable edge crosses a town where its road was ended.

### 4.7 Ageing

Older quarters gain one fill step at each growth step, intramural quarters first and one step further. When land runs out (pinned radius, island, neighbours), ageing continues without new quarters until the core reaches its last fill step or the target is housed.

### 4.8 Finish

After the stop: fringe (exits, gate villages, fields handed to land use), neighbour claim (it includes a detached harbour and its road), the adapter (10), then the final lot cut, programme and building sites. Finish is outside the journal: recomputed from the final graph, never resumed.

### 4.9 Constraints and warnings

A pinned centre stays exactly where it was put; an imposed radius closes the land beyond it; a town out of land is delivered smaller. Warnings are one short line in English with their French translation: fact, figure, cause in three words ("Housing 91 % — steep site", "No wall — neighbour too close"); the detail goes to the journal.

## 5. Phases, walls, planned towns

### 5.1 Phases as dated promotions

The phases (hamlet, village, market town, town, city, and the culture's own names) are no longer a class fixed by the target. Each is reached by `Promote` when the housed population crosses the town's threshold for it. A threshold is drawn per town around the culture's value (spread about ±30 %, a catalogue value) and moved by circumstances read from the survey and the graph: a crossing of regional roads or a navigable harbour lowers the market-town threshold, an isolated or steep site raises it.

A promotion changes, for what is born afterwards:
- the tissue and density of new quarters (and their fill schedule);
- the wall kind of the next raise (hedge or ditch, palisade, wall, bastioned) and the precinct step;
- the programme's thresholds (market, hall, cathedral) as read by the reused programme;
- the fate of regional roads through the centre;
- the harbour's works thresholds.

What exists keeps the form of its birth and only densifies. A city's core is therefore a former village or market town, dense by age; its outer quarters carry the tissue of their own phase. A town is never "designed as a city" unless its charter is planned (5.4).

### 5.2 Precincts: surveyed before built, raised when full

This is what makes a walled town dense and makes it adapt to its wall, as classic does with `enclosed` (`footprint.rs:176`: the enclosed land uses the culture's compact core tissue, floor 150 inhabitants per hectare at `footprint.rs:511`) and `fill_enclosures` (`composition.rs:2190`).

- **`SurveyPrecinct`** traces a closed `precinct` chain on open land. It encloses the existing precinct (if any) plus land for `step` × the households housed at that date, at the phase's compact density, taken from the cheapest cells of the cost field so that slope and water shape it. The founding precinct of an enclosed charter is sized for the culture's founding cohort. The wall tracer of the charter regularises the line (stiffness, terrain adherence, crest limit, square or bastioned style, attachment for lobes), checks neighbour clearance on the final joined line (pulling it back locally, never dropping it) and keeps clear of a harbour's approach and service row (5.5). Gates are decided at once on the armature; the curtain, the wall street along the inside, the ditch and the works enter as faces and edges.
- **While a precinct is open**, only its sectors open; quarters are born with compact tissue and the intramural pressure in their frozen inputs; the tissue lays its streets to the wall street and the gates. The town has the shape of a walled town before the wall stands.
- **`RaiseWall`** fires when every sector of the precinct is born and the phase allows a wall of that kind; it retypes the precinct chain into a wall of the phase's kind and calls the reused works (`fortification::build`, which needs an explicitly closed path, land gates first then ordered waterline intercepts, the street segments at each gate within 0.1 m, the physical surface, the resolved style, the event population, predicted widths and dwelling dimensions, a random stream; its works and reserves are faces committed before any lot next to them is cut).
- **Then** intramural ageing runs up to the charter's `gain`, then the next survey.

By construction: a wall never encloses a sector that was never opened (no reserve, no half-empty enclosure); density does not jump at the wall date; the share of households outside the standing wall stays below `1 − 1/step`. Starting values (to be tuned on sheets): masonry step 1.4 to 1.6, gain 0.25 to 0.35; hedge, palisade and earthwork step about 1.2 with the old line retired. Below about 10,000 inhabitants enlargements are lobes on the cheapest side, beyond concentric, per the charter's extension habit.

**A town walled when grown** (a market town walled at its promotion): the first precinct is surveyed around the quarters aged at least one step; the youngest quarters stay outside as a faubourg; it is raised at once.

**Cases**:
- *European walled village of 1,000*: enclosed charter, founding precinct for the cohort, hedge or palisade steps; at 1,000 about 6 to 7 ha walled, 80 to 90 % of households inside, the rest a compact start of the next lobe at the main gate.
- *Walled medina*: enclosed from founding, derbs laid to the wall, attached lobes, old line retired.
- *Planned grid*: see 5.4.
- *Large city*: concentric precincts; the old circuit is kept, becomes a boulevard or disappears per the fossil rule.

### 5.3 Nested walls, citadels, camps, castles

- **Nested walls are what the cycle leaves, never a request.** An inner circuit is a former outer wall, with its gates, its wall street and its older tissue. With lobes, only the shared stretch becomes inner. A `RetypeChain` applies the fossil rule at the next raise; a new main chain crossing a kept wall adds a gate node.
- **Citadel**: the founding castle, or, for cultures whose spec calls for one without a height, a precinct surveyed on open land astride the town line at its strongest corner, with a field gate.
- **Hilltop castle with its town**: a strong point as founding focus (4.3). The town grows at the foot and up the gentler slopes along the castle road. At each precinct survey the town wall either joins the castle circuit at two nodes (the castle chain becomes a fixed arc of the precinct, the castle keeps a field gate) or stays apart when unopenable slope separates them, linked by the road.
- **Fortified camps**: an enclosed charter with a cheap wall kind and the `camp` tissue (the ported tessellation; the figure is the precinct). On a flat site, a regular figure sized for one unit of the culture (not for the target); a daughter figure is a lobe, a concentric row is a step, the rampart re-raised without a fossil. On a defensive site (spur, hilltop, meander, island) the precinct is the scarp line plus a cross-rampart at the neck, at full terrain adherence; this is the one case where enclosed land may stay open, typed as common up to the culture's share.

### 5.4 Planned towns

A planned charter draws a **frame** at founding for a **planned capacity**: the rectangle of wards and its gate axes for a Chinese imperial or prefectural town, the grid of a colonial or bastide town, the castrum. The planned capacity defaults to the requested population and can be set explicitly; the setting is a visible town option (not hidden in Advanced), with the culture's share as the default draw. The frame's main axes, gates and wall line (if any) exist from founding; its blocks open over time from the centre and the axes, densest first, each quarter in the frame's tissue. With the default capacity the population fills the frame. A capacity set above the population is the intended case of a town built for more people than it holds (a colonial grid laid out for 100,000, an imperial capital with fields inside its walls): the frame's streets stand, its outer blocks stay unbuilt plots or fields, as the culture's spec types them. Growth beyond a full frame extends it by further frame modules. A town asked below the culture's planned founding cohort is founded in the culture's village form (3.2).

### 5.5 Harbour and wall together

The harbour is decided before the wall in every step, and every precinct survey takes fronts, harbour road, quay edges, apron and service row as constraints. The water side of a precinct takes one of three forms, chosen from the charter's harbour enclosure habit and the site:
- **sea wall**: the curtain runs on the land side of the quay; each landing node is a water gate;
- **open front**: the curtain ends on the waterline at both ends of the quay, with terminal towers (cheap wall kinds, sheltered basins);
- **harbour outside**: the curtain passes behind the service row with a port gate on the harbour road; when the harbour quarter grows to a step, it becomes its own lobe precinct (the "separate" harbour is this ordinary cycle).

A later quay extension adds water gates at new landing nodes and never moves a curtain. Channels: the curtain crosses on a flow-normal span with a water gate, both occupied banks in one circuit, bank identity from survey components and bridge nodes. **A distant harbour** (a front within reach but not at the focus) belongs to its town: its quarter is born at the end of the harbour road (a second nucleus when the coast between is unbuildable), it is part of the town's graph, districts and claim, and the regional placement does not place another settlement on that front.

## 6. Harbours

- `OpenHarbour` fires when a built street first reaches the chosen front, or at the culture's landing population when the harbour founded the town. It inserts the quay edge, the apron face and the landing nodes.
- `ExtendHarbour` lengthens the quay with √(housed); piers, moles and basins are dated edges at the thresholds of `harbours.json`; the current phase's spec decides the works.
- Port districts are the quarters whose lineage hangs on harbour nodes; no geometric search.
- The reused harbour furniture and roles read the quays and platforms exported by the adapter (`structure.quays`, port districts).

## 7. What disappears

The capacity forecast, its donor probes and the replan; the slope relaxation levels and the household ladders; the whole-town trim loop and its second run after a wall; `fit_enclosures`, `fit_to_built`, `join_side_by_side`, `fit_built_circuits`; the harbour's refit of walls (`port_walls`, `open_gates`); the castle searched inside the built town (`heights_castle`); the moved centre of an inland port (`harbour::sited`); the junction repairs (`planarize`, `join_close_ends`, `drop_stubs`); the display's own joining of street ends once it reads nodes; the fixed population classes.

## 8. The later chronology

**Built now**: lineage ids; `born`, `died`, versioned attributes; retire and merge operations with real callers; the journal as the only way to change a town; finish outside the journal.

**Not solved, to be done before any core-modifying event**: the downstream stages are keyed by index (`Parcel.block` `mod.rs:456`, `ParcelContact.street` `mod.rs:470`, programme reservations `programme.rs:118`, block environments `programme.rs:170`, districts by quarter `mod.rs:311`, block overrides `mod.rs:1114`, site access `building_sites.rs:20`, the parcel pack `parcel_pack.rs:592`); lot identity is a hash of the block outline (`parcels.rs:734`); lot cut and allocation are whole-town (`mod.rs:2509`). Moving them to ids, a per-block cut and allocation, and lot identity from face lineage is a separate project; this design makes it possible, it does not do it.

## 9. Code organisation

A new crate, `magna-urbis-town`. Before it, an extraction below both engines (classic unchanged, replay suite identical):
- a **geometry kernel** crate: `Point` (today `settlements/mod.rs:19`), `Shape` (`urban/mod.rs:80`), the polygon operations of `urban/geometry.rs` (1,352 lines; its `Surface` uses and the `dry_clip` call into vector geography stay in core);
- a **surface view**: height, slope and water sampling and dry clipping split out of `Surface` (`urban/mod.rs:1274`) and `geography.rs` (stilt planning, parcels and routing stay in core);
- the random streams already have a leaf crate (`rust/crates/random`).

Specs are resolved in core and passed as plain data: charter, phase specs, tissue specs, wall specs and harbour specs, built from the catalogue, `fortifications.json`, `harbours.json` and the profiles. The lot cut stays in core: the town crate defines a `Capacity` trait that core implements. Dependency one-way, core → town.

| Module | Holds | Reads |
| --- | --- | --- |
| `graph` | half-edge structure per level, operations, invariants, spatial index | geometry |
| `journal` | events, the single writer, replay, checkpoints, dumps | graph |
| `survey` | slope, banks, fronts, strong points, masks, cost field | geometry, surface view |
| `charter` | the charter and phase thresholds from the specs and the seed | survey |
| `armature` | main chains, regional roads and their fates, harbour and castle roads | graph, survey |
| `tissue/*` | one file per pattern, ported: organic, grid, radial, medina, ward, string, camp | graph, survey |
| `walls/*` | precincts, tracers (ported), gates, water sides, clearance, raise | graph, survey |
| `harbour/*` | fronts, quays, extensions | graph, survey |
| `water` | crossings | graph, survey |
| `growth` | the orchestrator: skeleton, frontier, order of events, count through `Capacity`, stop, resume | all above |
| `export` | graph, faces, dates, warnings, road results | graph, journal |

Rules: dependencies only as listed; only `journal` writes; no file over about 800 lines; no function that takes the whole town when it needs one face; no culture lookup inside the crate. The adapter in core lives in `urban/town_adapter/`, one file per consumer family.

**Debugging**: every run can write its journal; `replay --until <event>` rebuilds the graph at any step; a JSON dump per event, later an SVG. **Tests**: per module on hand-made inputs; graph invariants as property tests; ids stable under shuffled worker completion; prefix tests; stops just before and after ageing, a survey, a raise and a promotion; exhausted land; zero admissible homes; then the replay suite.

## 10. The contract with the rest of the chain

The adapter writes a `Layout` the reused stages accept. Besides streets, blocks, quarters and enclosures, they read:
- **lots** (`parcels*`): phase culture, recipe and zone (cutter choice, `parcels.rs:4228`); district membership (tissue, `parcels.rs:4397`); planned population and optional capacity data (`parcels.rs:4251`); `archetype` and `config`; block kind and axis; street paths, per-sample widths, ranks and roles for frontage and kerb contact (`parcels.rs:290-310,374,3032`, `parcels/contacts.rs:142,173`); `programme.environment` and gate pressures (`parcels.rs:4194,4201`);
- **programme, sites, massing**: centres and streets for pressure (`parcels/pressure.rs:52`); slope, wetness, navigable quay frontage; district roles and wealth; `reserve:programme` blocks; zone, pressure and distance to centre (`programme.rs:586,624,637,1089`, `building_sites.rs:144,310,1221`, `massing.rs:250,516`);
- **structure**: centres, districts, allocated and reserve masks, metrics, history, quays and port districts, springs, gate village centres (read by the page, for example `web/src/v2/roadTownAccess.ts`);
- **neighbours and edits**: the claim (`neighbours.rs:20,621`), the quarter edit baseline (`edits/quarter_baseline.rs`);
- **packs and bridge**: block and street indices in the parcel pack; district role and wealth in the display pack; structure version, mechanism, family, phases (`rust/bridge/urban.ts:62,95`).

Phases map onto `GrowthPhase` (kind, recipe, zone, population, target area, shapes) by phase of birth.

**Classic's layout tail** (`mod.rs:1986-2166`) on a growth layout:

| Call | Growth |
| --- | --- |
| `kinds::stamp`, `kinds::finish` | run |
| `trim::*` | dropped |
| `access::refine`, `access::summarize` | run (access and deep-block lanes, districts) |
| `fortification::enforce`, `settle`, `sync_gates`, `drop_dead_gates` | replaced by `walls` |
| `fortification::prepare_options`, `finish_options` | run |
| `composition::fit_enclosures`, `join_side_by_side`, `fit_built_circuits` | dropped |
| `network::polish_ends`, `clear_water`, `bridge_water_on_ground`, `select_bridges_graded`, `tie_banks_to_road`, `ensure_regional_access`, `reserved_streets`, `remap_reservations` | replaced by `armature`, `water`, `harbour` |
| `programme::prepare` | run once, after the adapter |
| `springs::reserve` | run |
| `lagoon::apply`, `shanty::extend` | not on growth layouts |
| `harbour_furniture::furnish` | run |
| `neighbours::settle`, `neighbours::claim` | run |
| `edits::with_quarter_edits` | not on growth towns until the plan's product milestone |

## 11. Interfaces

- **Options**: `layout.engine` = `classic` (default) or `growth`; `layout.planned` (auto from the culture, or planned with a planned capacity) as a visible town setting. Shared by the V2 and City Bench through the city contract, with the parity test extended.
- **New optional `Layout` fields**: the graph (nodes, edges, faces, ids, dates, levels), the journal summary (phases and their dates, precincts, raises), the regional road result. Index fields stay.
- **Bridge and packs**: one optional field each; the WebAssembly packages and the native engine are rebuilt together when it lands.
- **Display**: unchanged at first; later reads nodes and drops its own end joining.
- **Saved projects**: regenerated by the engine they were saved with; nothing migrated.

## 12. Performance

Classic (quarters stage, 8 threads, `runs-main1`): about 2 s at 10,000, 4.5 s at 20,000, 11 s at 50,000, 13 s at 100,000; towns paying a redraw 12 to 60 s. Growth saves by not redrawing and not trimming, and can lose it by repeating global work per quarter (classic: street split of a 20,000 town 1.4 s, one bridge request lap 0.6 s, final cut 0.2 s; at 100,000 final cut 0.8 s and first allocation 0.2 s). Rules: a birth cut reads frozen inputs, never a town-wide quantity; the cost field is updated per growth step; a step's quarters are laid in parallel.

Targets, on layout plus parcels, natively and in single-thread and threaded WebAssembly: never slower than classic on a supported town; at most 70 % of classic from 20,000 inhabitants (an experiment to confirm per tissue); no town over 1.5 times the median of its size class. Journal and graph memory and their transfer to the page are measured.

## 13. Measures and acceptance

The replay suite (`web/out/perf-2026-11-14/`, 26 towns and 7 water towns) gains: a walled village of 1,000; a planned Chinese town; a hilltop castle town; a camp on a flat site and one on a spur; an inland port town with a harbour 400 m away; a town with a distant detached harbour. `quality.py` gains: share of households inside standing circuits, precinct void, occupied frontage along the inner wall street, wet curtain outside gate spans, landing streets ending on a curtain without a gate, castle rate on hilltop sites, outgrowth to the harbour (a continuous built path from centre to quay, main lobe within 30° of the harbour road). Reference values from classic (`runs-main1`, `runs-water-main1`): walled land built 62 to 80 %, households per walled hectare 28 to 57 by culture, zero empty walled blocks. Every milestone that changes towns ends on a V2 sheet against classic.

## 14. Risks

- The face-to-block offset may not be robust on sharp corners: then blocks are computed per face by classic's ribbon method; the graph and growth are kept.
- The ported organic field may not behave inside small quarter outlines: the spike's sheet decides.
- Capacity at birth against final allocation: if the gap is often above 10 %, the final allocation becomes per quarter, which touches `programme.rs`.
- Precinct steps and gains, promotion spreads: judgement values, tuned on sheets.
- The organic tissue against a stiff precinct may leave slivers along the wall street: measured from milestone 4.
- Two engines to keep: accepted; classic is frozen.
- The long tail (edits, special kinds) may stay on classic.

## 15. Decisions taken (21 November 2026)

- Growth by dated steps on a graph; classic frozen beside it; small modules, single writer.
- Losing up to 10 % of housed households is accepted with a warning; warnings are one short line.
- Pinned sites and imposed radius are respected exactly.
- Slope is a growth cost, not a global slider.
- Second tissue after organic: the Chinese grid.
- Harbours: surveyed before founding, harbour road and outgrowth, decided before walls, distant harbours belong to their town; the harbour plan moves early (plan milestone 3).
- Walls: charter at founding, precinct surveyed before built, wall raised when full; camps, hilltop castles and nested walls follow from it.
- Phases are dated promotions at thresholds drawn per town and moved by circumstances, not classes fixed by the target.
- A town asked below its culture's planned founding cohort is founded in its village form.
- Planned towns are kept and offered as a visible town setting with a planned capacity.
- Wall dates and phase thresholds per culture in the catalogue; regional road fates by phase spec.

## 16. Not verified

Nothing was built or run for this document. To be established by the plan's milestones: the face offset's robustness; the organic field inside quarter outlines; staged occupation of fixed lots on three tissues; the gap between capacity at birth and final allocation; precinct values on sheets; laptop and WebAssembly latency. The reviews did not read in full `programme.rs`, `trim.rs`, `edits.rs`, `parcels/occupation.rs`, `kinds*.rs`, `fortification::build`'s callees, `fortification_extension.rs`, `roles.rs` port districts, the harbour works or the camp forms.
