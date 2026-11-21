# Town engine 2: implementation plan

Abandoned on 21 November 2026: the growth towns did not reach the look of the classic engine. The code is archived under the tags `archive/town-engine-2-growth-2026-11-21` and `archive/town-engine-2-shape-2026-11-21`; the planar graph and the geometry kernel were kept.

21 November 2026. The order of work for `TOWN_ENGINE_2_DESIGN_2026-11-21.md` (the design; section numbers below refer to it). One session is two to three hours of agent work plus the supervisor's build, tests and review. Estimates are judgements; each milestone ends on measures and, where towns change, a V2 sheet against classic.

## 1. How the work runs

Owner's rules of 21 November 2026:

- **Three checkpoints for tests.** The work is coded in three batches: A = M0, M1, M2; B = M3, M4, M5; C = M6, M7, M8. Tests run only at the end of each batch, with a full integration (unit tests, replay suite, V2 in native and WebAssembly) and visual sheets for the owner; then fixes, landing on `main`, and the owner tests before the next batch starts.
- **Look and feel, not bits.** The port does not chase byte-identical output. A change that makes the code more logical, more understandable or more maintainable is preferred, provided the towns keep the look and feel of classic (judged on sheets at the checkpoints).
- **Models.** Sonnet for simple lots; Opus 5.5 high and Codex Sol 6.2 high for the rest; Fable or Astra only for a hard problem that Opus and Sol could not solve.
- **Agents.** Independent agents, one lot each, time-boxed. Agents do not compile and do not run tests. After each milestone (M0, M1, … M8) the supervisor compiles and fixes the code until it compiles.
- **Where.** The batch is coded in the worktree `D:\workspace\self\mu-wt\engine2`, branch `work/town-engine-2`, with its own `rust/target` (the worktree's default; a second worktree must not share the main checkout's target, see the stale-build note in the project memory). Each lot is committed locally by the supervisor (as dunkean) when its agent reports. At the checkpoint the branch is rebased on `origin/main`, built, tested, fixed and pushed to `main` (fast-forward). Classic stays the default engine, so landing changes no town until the owner switches.
- **Agents never stop or restart the engine on port 8791, never use the owner's browser, never publish.** Nothing is published (site, desktop release) without the owner's approval.
- **Code rules** (design 9): the `magna-urbis-town` crate knows nothing of classic; only `journal` writes the graph; modules depend only as listed; no file over about 800 lines; English code and comments that say what the code does and why; Prettier on every touched TypeScript file; `docs/DESKTOP_RELEASE_NOTES.md` updated for every user-visible change, in English with a French translation of user-facing text.
- **Checkpoint measures** (design 13): the replay suite of `web/out/perf-2026-11-14/` (`runcase.py`, `quality.py`, `budget.py`) and `web/out/roads-2026-11-20/roads_metrics.py` with growth against classic; V2 sheets; timings on a quiet machine.

## 2. Milestones

### M0. Extraction and plumbing (3 sessions)

Classic keeps working unchanged in behaviour (checked at checkpoint A: replay suite, `urban::` tests, WebAssembly packages).

| Lot | Content | Model |
| --- | --- | --- |
| 0.1 | Geometry kernel crate `magna-urbis-geom`: `Point` (from `settlements/mod.rs:19`), `Shape` (`urban/mod.rs:80`), the polygon operations of `urban/geometry.rs` that do not use `Surface`; core re-exports them so classic's paths do not change. | Sol |
| 0.2 | Surface view: height, slope and water sampling and dry clipping split out of `Surface` (`urban/mod.rs:1274`) and `geography.rs` into the kernel or a sibling crate; stilt planning, parcels and routing stay in core. | Sol |
| 0.3 | Crate `magna-urbis-town` (workspace member, native and WebAssembly with and without threads); the `Capacity` trait; plain-data spec types (charter, phase, tissue, wall, harbour); `urban/town_adapter/` stub in core; the option `layout.engine` (`classic`, `growth`) through `LayoutConfig`, the bridge, the V2 contract and City Bench, with `cityParity.test.ts` extended; `growth` returns a clear one-line warning "Growth engine: not available yet" and falls back to classic. | Sol |

### M1. The spike (7 sessions)

Goal: prove the three unknowns on one quarter before building growth: the face-to-block offset, the organic look inside a quarter outline, capacity at birth. End: a harness that lays one quarter at a replay site, through the native engine, WebAssembly and the V2 behind the option; its sheet is part of checkpoint A.

| Lot | Content | Model |
| --- | --- | --- |
| 1.1 | `graph`: half-edge structure per level; insert, split, dangling, remove and merge; face walks; versioned attributes; lineage keys; spatial index; invariant property tests (Euler per level, closed walks, no crossing, stable ids under shuffled insertion). | Opus |
| 1.2 | `journal`: event enum (design 3.2), the single writer validating operation lists, replay to any event, checkpoint and resume, JSON dump per event; the canonical commit order of parallel drafts. | Opus |
| 1.3 | `tissue/organic` A: port of classic's street field and trace (`quarters.rs`: `Field`, `Field::angle`, `trace`) as a pure function from an outline, the survey view and a spec to edges. Test: on a fixed outline, the traced streets have classic's look (comparable directions, spacing and curvature; not byte-identical). | Opus |
| 1.4 | `tissue/organic` B: port of the recursive split (`split_quarter`) into faces; faces to buildable outlines by per-face offset (design 3.1); robustness tests on sharp corners, short edges, dangling edges. If the offset is not robust: per-face ribbon fallback, reported. | Opus |
| 1.5 | Adapter, ordinary town: chains to streets, faces to blocks, quarters, phases, minimal structure, claim; the tail of design 10 run as listed; `Capacity` implemented in core with the probe cadastre on one quarter with frozen inputs. | Sol, reviewed by Opus |
| 1.6 | Spike harness: one hand-placed quarter at a replay site, through native engine, WebAssembly and the V2 behind the option; resume from a checkpoint; sheet against classic; timings. | Opus |

### M2. Growth (7 sessions)

Goal: an ordinary unwalled organic town grows from founding to its target. End: unwalled organic towns of the suite and two new cases on growth, all housed, timed against classic, on a sheet.

| Lot | Content | Model |
| --- | --- | --- |
| 2.1 | `survey`: slope, cliffs, breaks of slope, banks and their components, masks (neighbours, pinned radius), cost field with slope factor and water charge; tests on synthetic terrains. | Opus |
| 2.2 | `charter` and phases: specs built in core from the catalogue (founding focus, form, defensive intent, thresholds and their spread, circumstance modifiers); `Promote`; the planned-founding-cohort rule (design 3.2). Catalogue values added per culture. | Opus, catalogue values by Sol |
| 2.3 | Rings and armature: frozen cost levels, armature extension (regional roads kept, tissue axes), sectors, boundary edges, quarters per sector, truncated ring by station order. | Opus |
| 2.4 | Count and stop: clock from capacities, 90 % rule, one reopening, stop checkpoint and resume; ageing (intramural first), fill schedule; prefix tests and the stop-at-every-event tests. | Opus |
| 2.5 | Staged occupation: a fixed set of lots per block occupied progressively, tested offline on classic's cuts for European organic, Chinese grid and medina (design 3.3); the allocation reads the fill share. | Opus |
| 2.6 | Integration: growth on the unwalled organic cases of the suite and two new cases (a 1,500 village, a 20,000 open town); measures and sheet. | Sol, measures by the supervisor |
| 2.7 | **Checkpoint A**: build, tests, replay suite, sheets (spike and growth), fixes, landing on `main`; the owner tests. | supervisor |

### M3. Slope, water and harbour (9 sessions)

| Lot | Content | Model |
| --- | --- | --- |
| 3.1 | Slope: cost and density by slope, terraced tissue spec, `stairs` links across contours by the owner's rule; hill and flank cases. | Opus |
| 3.2 | Water: `CrossWater` (bridges and fords square to the flow, on the armature), far banks opened by cost; river and meander cases. | Opus |
| 3.3 | Harbour survey: fronts (port of `shore_runs`, gentleness and navigability tests, `harbour_shelter.rs`) within the culture's reach; harbour as founding focus; harbour road; front discount; distant harbour as part of the town (graph, districts, claim). | Opus |
| 3.4 | Regional placement: a front claimed by a town receives no other settlement (`rust/crates/core/src/settlements/placement.rs`); tests. | Sol |
| 3.5 | `OpenHarbour`, `ExtendHarbour`: quay edge, apron, landing nodes, waterfront tissue front, √P quay length, works thresholds from `harbours.json`; port districts by lineage; export of `structure.quays` and districts for harbour furniture and roles. | Opus |
| 3.6 | Cases: the 7 water towns, `q-eo-2500-harbor`, `q-hanseatic-10000-harbor`, an inland port 400 m from its harbour, a detached harbour on a cliff coast, prepared for checkpoint B. | Sonnet |

### M4. Walls, castles, nested circuits (9 sessions)

| Lot | Content | Model |
| --- | --- | --- |
| 4.1 | Tracers: port of `parameter_trace`, `village_trace`, `hill_trace`, `square_trace`, `bastioned_trace`, `straight_across`, `attach` as pure functions on a precinct candidate, with the charter's stiffness, adherence, crest limit and style; golden tests against classic on fixed outlines. | Opus |
| 4.2 | `SurveyPrecinct`: sizing (`step` × housed at compact density, founding cohort for enclosed charters), cheapest cells, gates on the armature, wall street, ditch and works reserves, neighbour clearance with local pull-back; only the precinct's sectors open; intramural pressure in frozen inputs. | Opus |
| 4.3 | `RaiseWall`: retype when full; the `fortification::build` adapter with every input it needs (design 5.2); works faces committed before adjacent lots; intramural gain. | Opus |
| 4.4 | Water sides: sea wall, open front, harbour outside and its lobe; channels on flow-normal spans with water gates; bank identity from survey components; quay extensions adding water gates. | Opus |
| 4.5 | Grown regime (precinct around aged quarters, youngest ring outside), lobes and concentric steps, fossil rule by `RetypeChain`, nested circuits, citadel. | Opus |
| 4.6 | Hilltop castle: strong points in the survey, castle focus, castle circuit and bailey, castle road, town at the foot; join at two nodes or apart. | Opus |
| 4.7 | Measures: `quality.py` additions (inside share, precinct void, occupied frontage along the wall street, wet curtain outside gate spans, landing streets on a curtain without a gate, castle rate); new cases (walled village of 1,000, hilltop castle town, two-circuit city). | Sol |
| 4.8 | Cases: all walled cases of the suite and the new ones, prepared for checkpoint B. | Sonnet |

### M5. Regional roads (5 sessions)

| Lot | Content | Model |
| --- | --- | --- |
| 5.1 | Import with source segment ids and station intervals (`rust/bridge/urbanRoads.ts`, the regional road model). | Sol |
| 5.2 | Dated fates by phase spec: kept, absorbed, demoted or ended by `RetypeChain`; entry nodes; the per-road result exported. | Opus |
| 5.3 | Regional network update from the result (endpoints, connectivity, crossings, lengths); display and road editor (`rust/bridge/urbanNetwork.ts`, `web/src/render/cityBridges.ts`, `web/src/v2/urbanRoadEditing.ts`). | Opus |
| 5.4 | **Checkpoint B**: build, tests, replay suite with water, harbour, walled and road cases, sheets, fixes, landing on `main`; the owner tests. | supervisor |

### M6. Tissues and planned towns (10 sessions)

In the owner's order: the Chinese grid first.

| Lot | Content | Model |
| --- | --- | --- |
| 6.1 | Planned charter: frame drawn for a planned capacity (design 5.4), axes, gates and wall line from founding, blocks opened from centre and axes; the visible town setting (planned: auto or on, planned capacity) in the V2 and City Bench, English and French; catalogue shares. | Opus, UI by Sol |
| 6.2 | `tissue/grid` Chinese: port of the classic Chinese grid cutter and ward module into the frame; second circuit as the cycle gives it. | Opus |
| 6.3 | `tissue/medina`: derbs as dangling edges, shop strips on gate-to-market streets, enclosed charter. | Opus |
| 6.4 | Other grids (Roman, colonial, bastide), wards, radial. | Opus |
| 6.5 | `tissue/string` (street villages) and hamlets. | Opus |
| 6.6 | `tissue/camp`: port of the camp tessellation and kinds; flat figure and daughter lobes; defensive site (scarp and cross-rampart, common share). | Opus |
| 6.7 | Cases per tissue (planned Chinese town, colonial grid with capacity above population, camp on a flat site, camp on a spur), prepared for checkpoint C. | Sonnet |

### M7. Product (8 sessions)

| Lot | Content | Model |
| --- | --- | --- |
| 7.1 | Neighbours, pinned sites, imposed radius at scale; several growth towns on one map. | Opus |
| 7.2 | V2 quarter edits on growth towns as events replayed from the point they touch (or kept on classic if the owner prefers). | Opus |
| 7.3 | Performance pass: native and WebAssembly (single thread and threaded), journal and graph memory and transfer; the targets of design 12. | Opus |
| 7.4 | Sheet scripts for every suite case and the new ones, classic against growth, 2D clean and a few 3D, ready for checkpoint C. | Sonnet |
| 7.5 | After checkpoint C, decision with the owner: growth as default, per culture or everywhere; classic kept for the kinds that did not move. | — |

### M8. Retained cuts (4 sessions)

`generate_parcels` accepts the birth cuts after block preparation, with explicit invalidation (seed, settings, geometry, frontage, cut-relevant programme inputs); one cut instead of two. Then **checkpoint C**: build, tests, full replay suite, all sheets, fixes, landing on `main`; the owner tests.

### Side lot W. Short warnings (1 to 2 sessions, any time)

The owner approved one-line warnings (21 November). Today about 40 messages, many in French hard-coded in Rust and up to 240 characters. Replace them by a catalogue of short English keys with figures and their French translations, detail to the diagnostic log; both engines use it. Sol, reviewed by the supervisor.

## 3. Totals

| Milestone | Sessions |
| --- | --- |
| M0 Extraction and plumbing | 3 |
| M1 Spike | 7 |
| M2 Growth | 7 |
| M3 Slope, water, harbour | 9 |
| M4 Walls, castles, nested circuits | 9 |
| M5 Regional roads | 5 |
| M6 Tissues and planned towns | 10 |
| M7 Product | 8 |
| M8 Retained cuts | 4 |
| W Short warnings | 1 to 2 |
| **Total** | **about 63** (range 55 to 75) |

Owner tests: at checkpoints A (after M2), B (after M5) and C (after M8).

## 4. What starts first

M0.1, M0.2, M0.3 (Sol, in that order), then M1 and M2 lot by lot in the engine worktree, compiled and fixed after each milestone, tested at checkpoint A (after M2).
