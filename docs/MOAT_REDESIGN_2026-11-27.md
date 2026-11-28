# Moat redesign — diagnosis and plan (2026-11-27)

Status (2026-11-27, 15:00): P0, P1 and P2 are implemented in the working tree on `18a4f0d5`, uncommitted; section 11 gives the state and what is left. The plan was reviewed by Astra (gpt-6.2-astra, read-only) before implementation; section 10 lists what the review changed. Line references in sections 1 to 9 are to the code before the change (`276baadd`).

## 1. What the user sees

1. Moats are cut by local configurations: a river or a road at an odd angle, a quarter, a faubourg front.
2. Standard views are too complex; detailed views still have defects (texture holes on slopes, geometric lines and edges). The dig is perfectly geometric: the outer bank copies every tower and turn of the wall.
3. Water is close to random: reaches that should be wet are dry, unconnected ones are wet.
4. Road / gate / moat interactions are sometimes chaotic.

Constraint: limited compute. The fix must be cheaper than what it replaces, in generation and in display.

## 2. Diagnosis

Thirty commits in two months patched symptoms (chronology in section 9). They all kept the same model, and the model is the defect.

### 2.1 The moat has no identity: it is what is left of a band after subtractions

`dig_moat` (`fortification/moat.rs:127`) builds `offset(core, berm + width) − offset(core, berm)`, tiles it (200 m, then 24 m for the per-tile tests) and subtracts, in order: ravelins, the inner core, **the ribbon of every street near the curtain that overlaps the band, wall-lanes aside** (`build.rs:71`, `street_clearance.rs:133`), steep runs, water-side runs (probed out to 70 m), shore gaps and natural water. Each tile is then dropped if a street lies between it and the curtain (`severed`, `moat.rs:492`), if it sits in a shore gap (`off_gap`), on a far-bank salient (`far_bank`), or is under 20 m². `short_of_water`, `rounded_ends` and `continuous_moat` follow (`build.rs:134-135`). `settle` cuts the result again with the final street ribbons, up to four times (`settle.rs:177-278`).

Consequences, all verified in code:

- Any street near the wall removes moat, not only gate streets. A road running alongside, a faubourg lane or a bridge ramp opens a gap away from every gate.
- The moat is dug at `build`, on the armature streets, at *predicted* widths. Tissue streets, exits, bridges, gate closures (`drop_dead_gates`), regional access and refits come later. A ditch removed for a street that later disappears stays removed (Medina, measured in `web/out/round-1126b/wall-audit-owner`). A road added later crosses an uncut moat with no bridge.
- Steep and wet are flags per curtain segment (`build.rs:75-80`: relief > 0.15, more than 30 % of samples wet). A river at an oblique angle either deletes the ditch of a whole segment or leaves an arbitrary clip.
- `continuous_moat` hides the damage by deleting runs under 30 m and the whole moat under 35 % cover: "interrupted" becomes "absent".

### 2.2 The outer bank is an offset of the towers

`moat_core` is the union of the curtain body, towers, gatehouses, bastions and outworks (`outworks.rs:27-30`). Both banks are offsets of that union, so the counterscarp reproduces each turret at berm + width. Real ditches are dug to a rough line; towers stand in or over the scarp.

### 2.3 Water is drawn per tile, not routed

- A circuit is wet if water is near *anywhere* and mean relief is low (`moat.rs:70-83`).
- With the wetness parameter or dry-ditch option, each 24 m or 48 m tile draws its own kind with an RNG (`parameters.rs:252`, `options.rs:24`): wet and dry tiles alternate in one connected reach.
- `reaches` (`moat.rs:396`) places dams on 12 m stations of the *nominal* centreline, once, at `build`; `settle` re-cuts the ditch and keeps the old dams.
- If half the wet area is embedded in blocks, every wet piece of the circuit dries (`settle.rs:269-278`).
- Rust sends no water level. The renderer invents one per vertex: lowest ground within one ditch width in eight directions, floored to 0.5 m (`city3dMoat.ts:104-115`), while Rust steps reaches at 0.8 m. The sheet is then a patchwork of 0.5 m steps that the dug ground is meant to hide; on a slope it shows through or disappears. This is the likely source of the "holes", to be confirmed on a shot in the spike (section 8).
- The renderer then picks the fill (full, low, stagnant, marsh…) from a hash of each piece's first vertex (`moatBucket`, `moatModel.ts:105`): one connected moat mixes states by construction.

### 2.4 Renderers reverse-engineer the polygons

Because the contract is a list of anonymous polygons (`Enclosure.ditch: Vec<Work>`), every consumer re-derives the structure:

- banks = edges not shared by two tiles, matched by rounding to 5 cm (`moatSharedEdges`);
- counterscarp = edges farther than the mid distance from the curtain (`moatOuterEdges`);
- width = upper quartile of 64 soundings (`moatWidth`);
- gate crossing = scan of 29 directions × 39 steps of point-in-polygon tests to guess where the hole is (`moatSpans`, `city3dMoat.ts:285`), only at gatehouses; a plain gate keeps a bare gap;
- 2D detail = up to 18 part kinds built on every bank edge every 7 m (`moatParts`): shoals, plots, channel, track, dashes, fringe, patches, lilies, reeds, shadows, hachures. Thousands of small polygons per large circuit (count to be measured in the spike), all built for the WebGL mesh whatever the level and drawn from the mid level down; at the far level the moat is hidden entirely. There is no simple form for standard views.
- 3D = the terrain grid (2 m ground shape, coarser patches further away) is lowered point by point through polygon parity tests (`urbanGroundCuts.ts:181`), and the 2D plan texture is draped on it. A masonry scarp runs 1.35 m, under the grid step: lips come out as stair-steps. Parchment hachures draped on the 3D bank are the "brown bars".

### 2.5 Crossings do not exist as objects

A crossing is the hole a street ribbon left in the polygons. Nothing says where it is, how wide, or of what kind. The road diverted round a moat (`gate_budget.rs:782-817`) is offset to "farthest ditch vertex + 4 m" along segment normals and is not checked against the ditch, bastions or outworks.

## 3. Principle of the fix

One authoritative object per circuit, a **moat line**: an axis with stations. Everything that today is a 2D boolean operation on tiles becomes a 1D operation on intervals of stations. Renderers read stations; they derive nothing.

Invariants (audited, see section 7):

- I1. A moat run ends only at a natural stop (water, slope too steep to dig, rock) or at another work of the circuit. Streets, quarters and gates never end it.
- I2. Every street that meets a moat has a crossing record. A crossing does not remove moat.
- I3. A reach is wet only if it is connected to a source and not above it. No random draw. One reach, one water level, one fill.
- I4. Lips never self-intersect; the outer lip is smooth at the scale of the ditch width.
- I5. 2D, 3D, the reserve and the diverted roads read the same stations.

## 4. Generation (Rust)

New modules in `fortification/`: `moat_line.rs` (axis, lips, status, runs, ends, crossings), `moat_water.rs` (profile, reaches, supply), `moat_audit.rs`. `moat.rs` keeps `choose_moat`, forms and ravelins.

### 4.1 Axis and lips

1. Guide ring: one round-join buffer of the **curtain polygon alone** at `face + berm + width/2`. Not of the union with towers.
2. Resample at a uniform arc step (6 m; 4 m under 600 m of perimeter). Low-pass the closed ring (binomial passes, window ≈ 2 × width) so re-entrant corners round off.
3. Per station, two offsets from the guide. The inner one keeps the berm from the wall face and 1 m from any work footprint (towers may stand at the scarp). The outer one is the nominal half width, plus a clearance term where a tower, bastion or gatehouse projects (max-filter then low-pass: wide enough at the tower, no copy of its outline), plus low-frequency noise by form. Widening goes outwards only.
4. Explicit validity test, since `g::normalized` only fixes winding: consecutive station quads keep their orientation, and no quad overlaps a non-neighbour (grid index). Where the test fails (narrow neck, wide ditch on a tight re-entrant) the ditch narrows locally or the run splits. This is done before the land is reserved.
5. `outline` is data per form in `fortifications.json`: `rough` (earth, fossa, ringfort, double: noise 15–20 % of width, lip wander), `regular` (revetted, timbered, canal: smooth, 5 %), `traced` (bastioned: follows the bastion trace; ceremonial: corners pinned, the rectangle of a Chinese, Khmer or Japanese moat is kept). A generation parameter "moat regularity" can override it later; both looks stay available.
6. Fixed points of the guide: wengcheng court and barbican exits. Detached works keep loops of their own: ravelin trench, citadel ditch, glacis band. The arc step and the minimum run scale with the width, so a village ditch of a few metres is sampled finely enough.

### 4.2 Where the moat runs (1D)

Each station gets a status from point samples on its cross-section (inner lip, axis, outer lip):

- `water`: wet, or within `MOAT_SHORT` of water;
- `steep`: digging the section would leave one bank more than a form-dependent height above the other (replaces the per-segment relief flag);
- `blocked`: harbour front, quay, cave rock, the map edge, the works of another circuit (attached pair, inner ring: clearance against its works, not exclusion of its whole interior);
- `dig` otherwise.

Cave rock and off-map points read as wet in `Surface`; they are told apart here and are never a water source. Where the status changes between two stations, the quad between them is clipped against the shore outline (one local polygon operation), so an oblique channel is cut where it is and not at the nearest station. Runs are grouped by dry-land component of the circuit; the far-bank salient rule becomes a property of the component.

Then interval operations: close `steep` gaps shorter than 25 m (the ditch is dug through), drop runs shorter than `MIN_MOAT_RUN`, keep the existing coverage threshold. Each run end is typed: `water` (mouth or sluice by form), `slope` (depth tapers to zero over 1.5 × width), `work` (square against a quay or wall). Streets and quarters do not appear in this step.

### 4.3 Streets and gates

- **The reserve is the owner.** At `build`, each accepted trace reserves its whole earthwork envelope: the band of every `dig` station (lips widened by the outer bank) and one approach corridor per gate. Quarters, blocks, lean-tos, peripheral roads and farms already honour the reserve. A circuit replaced later (`fit_enclosures`, join, water split, wall override) is rebuilt with its line and its envelope, as it is rebuilt today; block edits clip against the real reserve instead of a narrow curtain ribbon.
- **Crossings are decided with the gates.** Gate budgeting (`gate_budget.rs`) fixes, for each land gate, the crossing corridor on the real approach tangent of its street: gate passage, straight across the ditch, bridgehead 3 m beyond the outer lip, at the street's final width. The corridor is part of the reserve, so later stages cannot build in it. Kind by form and supply: `bridge` (wet, revetted or deep), `causeway` with a culvert (dry earth ditch: Roman, earthwork), `drawbridge` as near-view detail. No normal bend is forced on the street afterwards.
- **Other streets keep off.** A street that is no gate street never enters the envelope: the two diversion stages (`way_round` / `divert`) are checked against the full reserve and follow the real outer lip instead of "farthest ditch vertex + 4 m"; the later producers (`access::refine`, `ensure_regional_access`, bridge heads) get the same corridor check and trim or reroute. There is no automatic footbridge: a street left in the band is an audit failure, to be fixed where the street is made.
- **Resolve late, inside the envelope.** Crossing records, reaches, dams and sluices are recomputed from the final gates in `settle` and once at the end of `complete` (after `drop_dead_gates` and gate resynchronisation). A closed gate loses its record and the ditch is simply continuous there. This is 1D and stays inside land already reserved; nothing is frozen at `build` except the envelope.

### 4.4 Water

Per run, on the real lips:

1. Rim profile `rim(s) = min(ground(inner lip), ground(outer lip))`; bed profile `bed(s)` = rim − depth, then smoothed and made piecewise monotone so the bottom has no bumps.
2. Reaches: greedy split so that within a reach `max(rim) − min(rim) ≤ REACH_STEP`; a dam between two reaches. `level = min(rim) − freeboard(form)`.
3. Sources, each with a surface height: the sea (datum 0), a river or lake (level of the wet cells of that water body, from the raster water level the bridge already carries), a joined canal (`level_m` of the lagoon waterway; candidate canal joins are found before supply is resolved, not after).
4. Supply by propagation over the reach graph of the circuit, downhill only: a reach is `fed` if a chain of adjacent fed reaches links it to a source and its level is not above the head available there (source level plus the allowed lift at the intake, then never rising again; a reach below an open outlet does not refill a higher one). Every wet reach satisfies `bed < level ≤ lowest rim`. A solid causeway passes water through its culvert; without one it ends the chain. The wetness parameter becomes the allowed lift (deterministic). A culture with wet moats and no source gets `pool` on every reach, handled apart from fed water (climate and season choose the look, uniformly). Everything else is `dry`.
5. `embedded` applies per run, not per circuit.

### 4.5 Contract

```
MoatSpec {
  form, state,
  runs: [{ closed, stations: [{ inner: P, outer: P, rim: f32, bed: f32 }],
           ends: [kind, kind],
           reaches: [{ from, to, supply: fed|pool|dry, level: f32? }] }],
  crossings: [{ run, at, a: P, b: P, half_width, kind, gate?, street? }],
  dams, sluices
}
```

About 350 stations for a 2 km circuit. `Enclosure.ditch` stays for now, **derived** from the runs (one clean strip polygon per reach, kind = supply), so the reserve, forest clearance, rural reserve, canal moats and wall edits keep working on day one. `rust/bridge/urban.ts` gains the `moat` field it lacks today.

### 4.6 Removed

`severed`, `off_gap`, `far_bank`, `rounded_ends`, `short_of_water`, `continuous_moat` (as polygon passes), the street clearance of the ditch, the second cut in `settle`, both random `ditch_kind` draws, `natural_stops` boxes, the 24 m tiling.

## 5. Display (TypeScript)

### 5.1 2D

Strips built from stations; no tile tessellation, no edge matching.

| Level | Content |
|---|---|
| far (today: nothing) | bed ribbon in one tint (water or dry), nothing else |
| mid = standard views | bed, water surface per reach, two bank strips (lit / shaded), dams, crossings |
| near / close | plus restrained detail by fill: fringe, reeds, a channel at low water; built lazily |

Engraved styles: wash and one edge line at mid; hachures as regular strokes along stations at near. Plots, shoals, tracks, dashes, patches and lilies go, or stay only at the closest level if the before/after sheet shows a loss. Fill is per reach; variety between reaches stays within one water class.

### 5.2 3D

The single terrain surface is kept (picking, trees, forest clearance, patch morphing and the drape all rely on it).

- Terrain cut from stations: nearest axis segment through a cell index → (s, across) → section of the form against the **absolute bed height** interpolated along s. Level bottom across the ditch, smooth along it, higher bank on the uphill side. No parity tests, no loop over spans. The scarp run is never narrower than the grid step of the level being built, so lips do not stair-step.
- Moat paint simplified at its source: what is draped on the dug ground is the bed and bank tints of section 5.1, never hachures or detail parts.
- Water: one flat strip per reach at the engine's level, clipped to the wetted width. Dams where levels step.
- Crossings from the records: bridge deck over a continuous ditch, or a causeway filled across it with ramps. `moatSpans` goes.
- Revetment faces (masonry, timber, stone) at close range only, from the stations.
- Natural look for `rough` forms: scarp slope varies ±15 % along s, lips rounded, slight slump at the foot.
- **Deferred:** a dedicated bank mesh over an under-cut terrain. It would give crisp lips at any distance, but it brings seams with morphing patches, depth fighting, picking under the visible bed and a second shadow path. It is considered only if a visible defect remains on the before/after sheet.

### 5.3 Removed

`moatSharedEdges`, `moatOuterEdges`, `moatWidth`, `moatSpans`, `moatBucket`, most of `moatParts`, the per-vertex water level, the polygon indices of `urbanGroundCuts`.

## 6. Compute

| | Today | After |
|---|---|---|
| Generation | 3 buffers of the core ∪ towers union, 24 m tiling, chained polygon differences, per-tile `severed` against all streets, per-tile dry clip, water polygonisation per piece, two unions for continuity, second cut × up to 4 `settle` | 1 buffer of the curtain polygon, ~350 stations × ~10 height samples, 1D interval passes, one polygon assembly per run; late resolve is 1D |
| 2D | ~10⁴ polygons per large circuit from mid down | ~10² strips at mid; detail only near |
| 3D cut | per terrain sample: all spans, row parity, edge distances | per terrain sample: one cell lookup, one segment |
| 3D water | per-piece triangulation with per-vertex rim search | one strip per reach |

These savings are expected, not measured. Acceptance measures, before and after, on the same fixtures: total layout time, size of the serialised town, cold build of the 2D and 3D display, warm frame time. No slower anywhere; the `ditch` polygons are dropped from the payload once nothing reads them.

## 7. Verification, cheap first

- `MoatAudit` (Rust, like `WaterAudit`): runs, coverage, gap stations without a natural reason (= 0), street–moat intersections without a crossing (= 0), gates without a crossing (= 0), wet reaches without a source path (= 0), eligible reaches left dry (= 0), lip self-intersections (= 0), a smoothness figure for the outer lip.
- `examples/moat_probe.rs`: replays a saved request, writes the audit as JSON and an SVG (stations, status, reaches coloured by supply and level, crossings, streets). Iteration happens here, with no browser.
- Fixtures: the archived Chinese and Medina 10k requests (`web/out/round-1126b/wall-audit-owner`), the river fixtures in `rust/crates/core/*.json`, one bastioned, one Khmer / Japanese wet moat, one hill town, one coastal town, one canal town.
- Unit tests of the 1D passes (status closing, reach split, supply propagation, lip clamp). Existing tests that assert the removed mechanisms are replaced, not adapted.
- One before/after sheet at the end: about eight 20k towns, one 2D style, one 3D view, plus close-ups of gates and of a slope. The user judges the look.

## 8. Phases

Agents write code; the supervising session compiles and tests once per phase.

- **P0 Spike, probe only (no engine change).** `moat_probe` computes the proposed lips, runs, crossings and one water level beside the current output, on the archived Medina and on one wet town with an oblique gate, and draws them over the existing reserve and the final street ribbons. It answers, before anything is rewritten: do the lips escape the land reserved today, do they overlap frontage, do crossings line up with the gate streets, what does it cost. It also records the baseline (gap counts, timings, polygon counts). The owner sees the SVGs and decides.
- **P1 First working slice, both sides together.** Rust: contract, `moat_line`, `moat_water`, envelope and corridors in the reserve, crossings at gate budgeting, diversions on real lips, late resolve, audit. TypeScript in the same slice: crossings and water levels read from the records in 2D and 3D (the current `moatSpans` guess cannot work on a continuous ditch), terrain cut from stations. Derived `ditch` polygons stay for the reserve consumers only.
- **P2** 2D from stations with the three levels, shared by Canvas, WebGL and SVG; close detail built on demand.
- **P3** Hydraulic finish (canal joins, culverts, pools), forms `traced`, detached works, wall overrides and edits.
- **P4** Sheet, user review, corrections, release notes, parity test, commit. The bank mesh is decided here, on evidence.

Risks:

- The envelope is wider at towers and smoother than today's band: lots and streets near the wall move.
- The crossing corridor fixed at gate budgeting constrains the last metres of gate streets.
- Unmerged moat commits on side branches (`work/todo-six-batch-1127` and others: `stopped_intervals`, `MoatBanks`, `causeways.rs`, one level per reach) patch the old model. This plan supersedes them; they are not merged.
- The classic TypeScript engine (`gen/urban/moat.ts`) is out of scope.

## 9. History in one table

| Date | Commit | Patch |
|---|---|---|
| 10-23 | d5c2ad6c | Rust port: ditch round every projecting work; streets cut it |
| 10-24 | 9609f336 | `severed` |
| 11-04 | 72f28d31 | `dry_clip`, per-tile `severed`, `embedded`, shore-gap hook rule |
| 11-05 | c61a82bb | `far_bank` |
| 11-17 | 2cb95421 | `continuous_moat`, 3D dig, `moatSpans` |
| 11-20 | ece716d2 | gateless road diverted round the moat |
| 11-24 | d4af32a6 | `short_of_water`, round ends |
| 11-26 | a67c1e2a, cb329bbc, 3382e028 | forms, fills, reaches, dams, sluices, canal moat |
| 11-26/27 | side branches | `stopped_intervals`, `MoatBanks`, provisional causeways, one level per reach |

Open after all of them (TODO.md, `web/out/round-1126b/A-JUGER.md`): visible ditch breaks, bank profile round towers, wet reaches and dams, water elevations, draped hachures.

## 10. What the Astra review changed

The review agreed with explicit banks, crossings and water levels, and refuted or narrowed the following.

- Diagnosis: wall-lanes are not cut, faubourg fronts exist only without a ditch, the first tiling is 200 m, the torn water sheet and the polygon count were not proven by the code. Section 2 is corrected; both figures are measured in P0.
- Reserve: resolving late is only safe inside land reserved early. The envelope and the gate corridors are now reserved at `build` (4.3).
- Streets: no bend forced on gate streets after the fact, no automatic footbridge. The corridor is chosen at gate budgeting; other streets are trimmed or rerouted where they are produced (4.3).
- Geometry: explicit overlap test, outward-only widening, pinned corners, separate loops for detached works, shore clipping between stations, rock and map edge told apart from water (4.1, 4.2).
- Water: source levels named, downhill-only propagation, culverts, `bed < level ≤ rim` (4.4).
- 3D: the dedicated bank mesh is deferred; the single terrain surface is kept (5.2).
- Phasing: the old P1 (engine alone, renderers unchanged) could not ship, because the gate-span guess needs the gaps. A probe-only spike comes first, then one slice across engine and display (8).
- Savings are to be measured on four figures, not assumed (6).

## 11. State after the first implementation day

Done and checked (unit tests, probe replays of the archived Chinese and Medina 10k towns, V2 shots on the native engine):

- Engine: `fortification/moat_line.rs` (stations, lips, status, runs, reaches, crossings), `moat.rs` (decision, assembly, late resolve), `moat_audit.rs`; `MoatSpec.runs` / `crossings`; `Enclosure.ditch` derived from the runs. The polygon passes of section 4.6 are gone.
- 3D: `web/src/render/moatLine.ts`, `urbanGroundCuts.ts` (dig from stations, level bottom, causeways not dug), water per reach, decks from crossing records. The plan's moat detail and hachures are no longer draped on a dug ground in the V2 tilted view (`dugMoats`).
- 2D: three levels (`far` plain band, `mid` bed and banks, detail near and close), fill per reach, lighter hachures.
- Gates, found while replaying: minimum gap between land gates (`GATE_GAP`), stubs and stray street pieces at walls removed, wall-lanes anchored on gate streets, a street shut at the wall linked to the gate street on both sides and kept out of the moat band, closed gates restoring the reserve.
- Tools: `examples/moat_probe.rs` (SVG, audit, streets per gate), shot script `web/out/moat-redesign/shots/v2-moat.mjs`, before/after sheet `web/out/moat-redesign/shots/sheet.html`.

Measured on the two replays: every gate has one crossing and no street crosses a run elsewhere; outer lip turn 20–36° per 6 m before, 2–7° after; whole layout generation 2.4 s → 1.6 s (Chinese) and 4.2 s → 2.9 s (Medina), partly from the changed street layout.

Left open:

- One red test: `trim::tests::fringe_rows_are_occupied_and_empty_connections_are_paths`, one vacant 55 m² courtyard lot inside the norse-ringfort river town. A lots matter; not yet attributed.
- The Chinese outer wall keeps one land gate for three regional roads (present before this work). Hypothesis only: roads re-laid after the gate decision, then closed by `enforce` because the crossing lies more than 8 m from the gate point. Needs a trace of `decide` and `reconcile_gates`.
- Water source level: `Surface` carries no water level at this stage; a source takes the height of the nearest wet cell.
- Not replayed yet: concentric and bastioned circuits, canal moats through water gates, a wet moat on level ground, Khmer and Japanese wide moats, cave circuits, wall overrides and edits.
- Harbour works are not in the `blocked` input.
- Cadastre style shares one sheet between the top and the tilted view: it keeps its moat drawing in 3D.
- A tile seam in tint shows on the dug ditch between the closest drape tile and the next.
- WASM packages must be rebuilt (mono and threads) before a web deployment: `rust/bridge/urban.ts` gained the moat fields.

## 12. Second pass, 27 November evening: walls and moats first

The owner rejected the Chinese town of section 11 (one gate on the outer wall, the moat stopped at a stream and on the south slope) and set the rule: walls and moats come first, streets, lots and natural water adapt. Astra reviewed the state, then fixed its own findings; the supervising session compiled, corrected and replayed.

- Gates come from the roads the town must serve. Before the gates of a circuit are decided, a main road ending on or near the curtain is carried through it and the moat band (`gate_budget::reach_through`), along the request's regional road when one matches, straight on otherwise (regional roads, or any street when a gate count is requested). Extensions the budget shuts are taken back. The armature of the Chinese town ended exactly ON the wall trace, which no crossing test counted.
- The moat stops only at a water body or a cliff. A stream is an inlet: the ditch takes it in and is fed there; a slope is dug, the bed bounded under the higher lip. A dam stands between two fed reaches and where held water would run out into a dry one. Minimum run capped at 60 m for wide moats.
- Water inside a moat band is the moat's for `clear_water`; a regional deck standing in a band is not drawn; a captured stream is cut at the outer lip (GPU ground water only).
- A shut road never crosses the ditch: it stops beyond the outer lip and is led to the neighbouring gate. The ground between a wall and a road led round it is reserved.
- Reserve respected by slope wards, redrawn quarters and edited blocks; harbour works block the ditch; a canal join keeps the land gatehouse; rebuilt circuits keep their gates; detached ravelin and citadel ditches are dug in 3D.
- Audit: dry curtain covered by the moat with the reason of each gap, regional roads of the request without a gate, crossings matched to their gate.

Chinese 10k after the pass: 3 land gates on the outer wall and 4 on the inner one, one closed moat run covering the whole dry curtain, 3 bridges, one fed reach held by two dams. Medina 10k unchanged (2 and 3 gates, closed dry moats). Tests: `urban::` 849 passed, 0 failed.

Still open: an explicit gate count above the feasible approaches; the cadastre style and the ink styles for the captured stream; `roads_without_gate` still lists a road that was diverted to a neighbouring gate; forms not replayed (bastioned, concentric, canal, wide wet moats); the tile tint seam on a dug ditch; WASM rebuild before any web deployment.

## 13. Third pass, 27 November night: the other forms, the waterside, the streets after a retrace

The owner validated the Chinese and the Medina towns of section 12 and asked for the three wall and moat lines of the task list: the forms not replayed, the waterside, and what was left open on the two reference towns. Every form was replayed on the two reference sites, a harbour site and ten archived river and coast towns of the performance campaign (`web/out/moat-redesign/verify.ps1`, one line per circuit from `summary.py`, drawings rasterised by `svg2png.mjs`).

What the replays showed, and the rule that answers each:

- **A circuit retraced round the built town left its streets where they were.** Streets laid for the earlier trace lay in the new ditch, crossed it away from the gates, or reached a kept gate a few metres off its point, so the gate lost its road and closed. Rule (`fortification/obey.rs`, run wherever a circuit gets its works): a kept gate moves onto the crossing of its road (`gate_budget::choose`); a gate street passes the gatehouse passage and crosses the ditch straight along the gate axis, meeting its old line again outside the works; a gate street that ends in the band is carried over the ditch to the street outside; a street running along the band without reaching the wall (a road led round to a gate) moves out beyond the outer bank; every other street is cut at the band.
- **A street vertex lying on the curtain was no crossing** for `composition::gates` (one segment stops a hair short of the wall, the next starts on it): the gate of such a road closed. The vertex now counts when its neighbours lie on either side.
- **Bastioned trace**: a ravelin cut the ditch in two. It is an island now: the ditch runs on between ravelin and curtain and swings round it; its gate street crosses both.
- **Wet moats** (Khmer, Japanese, Aztec): a rain pool dried section by section where houses stood beside it, and a stream reaching the moat left a short pond between two dams and the rest dry. A culture that keeps wet moats holds its pool wherever no source reaches; a stream alone feeds a moat only when it reaches a quarter of the run; only a moat the town has grown round dries, whole.
- **Waterside**: a ditch was dug on the beach or the bank between a wall and the water, parallel to it. Where open water at least a ditch width across starts within 60 m beyond the outer bank, over 40 m of wall or more, that water guards the front and no ditch is dug; the ditch on the land side stops at the strip and is fed across it. A corner that merely looks at the water is dug on to it. A sea-fed moat stands at sea level.
- **Two gatehouses a few metres apart** (Roman coastal town): every stage that opens a gate keeps `GATE_GAP` from the others.
- The fortification style selector belongs to the composition stage of the V2 page (`stageRegistry.ts`).

Measured on the last build (probe, then replay bench of fifteen archived towns):

- Chinese 10k and Medina 10k: unchanged from the validated state but for one gate (Medina outer ring: its fourth gate now keeps its street and has its causeway).
- Bastioned, concentric, Aztec, Roman, European 10k, forced wet moats: every gate has its crossing, no street in a ditch, no crossing away from a gate, the dry curtain fully covered.
- Fifteen archived towns: every household housed, no empty block inside a wall except the Roman coast town (25, 32 before this work); time of the quarters stage equal to or under the reference of 26 November on every town but one (Byzantine delta, 15.4 s for 13.8 s, dev profile against the `fast` profile).

Roman coast town, "wall built share 0.77 → 0.65": not a wall defect. Replays with the archived ablation binaries of 26 November (`bin-1126b-*`) show the change comes with the coast definition of that round (`nocoast`: share 0.765, wall 70.5 ha, no empty block; every other binary: 0.65, 45 ha, 26 to 33 empty blocks). With it the town builds its steep western terraces and leaves its planned eastern grid empty; the wall fits what is built.

Closed in the same night (fourth batch):

- **Water level of a source.** The vector geography now carries the water levels of the terrain raster (`Geography::set_water_levels`, given by the terrain when it attaches the geography; `Surface` is unchanged): a fed reach stands at the level the hydrology gives the river, the lake or the sea beside it. Without those levels (fixtures) the sea stands at 0 and other water at the ground of its sample.
- **A stream that flows through the town** is an inlet like any stream: only a channel 8 m across or more where it passes the curtain stops the ditch as a water body. The moat runs on across the stream, without the short pond and the two dams it left each side. On the plain Chinese town of the bench the moat is one dry band where four pieces, seven fed reaches and six dams stood.
- **Canal moats.** A canal moat holds water all round: every reach is fed, and reaches are as long as the cut allows (a level per reach, `FACE_DEPTHS` depths of cut where the bank is highest), so a 720 m ring keeps 3 reaches where 11 pieces alternated wet and dry. Seen on a gnomish canal town of the estuary site (5 km of canals laid): five canal mouths join wet reaches through water gates (`canal_moat.rs`, trace `canal moat: …`). The form is drawn once per site key: the probe takes `--key`.
- **Bridges of a wide moat.** A gate street carried over the ditch runs along the axis of its gate; it lands on the far bank even where a block or water stands right behind it; one that cannot cross loses its stub and its gate closes. A gate whose street ends dead just beyond the ditch (the dead-end length counts from the outer bank) closes too. Khmer town: five gates, five bridges, none skew.
- **A road in the ditch in front of a gate** (gnomish town, 47 m): a street that enters and leaves the band on the far side from the wall runs along it, beside a gate too; it moves out beyond the bank, or is cut at the bank where a block or water stands right behind. A street that crosses is told apart by where it comes from (the wall or its berm), on open runs as on closed ones.
- **Delta town** (Byzantine case): no crossing of a ditch or a curtain away from a gate by a land street. Decks and waterside ways that also span a short ditch pass by their water passage: the audit and the probe no longer count them.

Waterside towns of the bench, 28 November (landed after the first push): the audit names the gates a run faces without a crossing (`uncrossed_gates`), and `web/out/moat-redesign/faults.py` lists them with the stray crossings. Twenty faults on ten archived towns went to none:

- the band of an open run includes its berm for the street rules, so a gate street that ends between the curtain and the ditch is carried over or cut like the others;
- the gates follow the final network once more at the very end (`sync_gates` before `drop_dead_gates`): the late stages lay decks, move streets off the water and house squatters after the gates were last reconciled; a bridge head opens its gate there, a gate whose street cannot cross closes;
- the last pass at the walls holds main streets too, and counts as a crossing two streets that meet on a curtain or a stub hung through the wall on a street of the other side;
- a channel that flows where the ditch would be dug, over half the section and 40 m of wall, is the moat of that front;
- the audit expects a moat crossing only of a gate a ditch really faces (in front of it, or on both sides) and that does not open on natural water; the two ends of a water passage are no gates; decks and waterside ways are not counted as streets in a ditch.

Left as it is:

- Roman coast town: the planner's choice of land with the coast definition of 26 November, recorded as issue #27 (the wall follows what is built).
- `roads_without_gate` in the audit still lists a regional road of the request that the town leads round to the neighbouring gate.

Last state: `urban::` 851 passed, 0 failed, 25 ignored; web moat, stage and parity tests 114 passed; type check clean. The WASM packages (mono and threads) must be rebuilt before a web deployment.
