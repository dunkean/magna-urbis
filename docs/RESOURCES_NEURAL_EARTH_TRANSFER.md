# Resources: transferring Neural Earth's methods to Magna Urbis

Date: 2026-11-03. Sources read: `../infinite_map/docs/RESOURCE_LAYERS.md` (R3k, compiler 14), `../infinite_map/backend/terrain_resource*.py` (structure), `docs/RESOURCE_TILE_REFINEMENT.md` and `godot-render/tools/surface_context.py` from this repository, `docs/catalogue_implantation_review.md`.

Goal: give the Magna Urbis map (a tile of a few km to 40 km) a **low-cost** resource model with **the same contract** as Neural Earth, so that it can then drive the placement of settlements, neighbourhood roles and scattered activity sites. On the day of integration, the synthetic parent is replaced by Neural Earth without changing the consumers.

## 1. The quintessence of Neural Earth

Eight ideas hold the whole system together. The rest (GPU, LOD, USGS, 111 views) is implementation at world scale.

1. **Ontology of 4 natures × 4 regimes.** Each layer is a *potential* (index 0–1, averaged), a *stock* (integer, summed), a *flow* (integer per year/month, summed) or a *calendar* (months). Regime: exhaustible, regenerable with a delay, annual, quasi-fossil. This grid immediately tells you how to aggregate, conserve and evolve a value.
2. **One authority, refinements that never contradict the parent.** Extensive quantities are integers committed once (LOD 10), then distributed exactly to the children by `apportion` (largest remainders, ties broken by identifier). The finer level reveals or hides; it neither creates nor destroys.
3. **Addressed randomness.** `key(seed, domain, lod, cell)` (FNV-1a + splitmix64, identical to Chronos): the result depends neither on computation order nor on the window. Two adjacent tiles join up seamlessly.
4. **Hierarchical geological chain.** Tectonic context → *expected* rock shares → *realised* geology (`argmax_k log E_k + b_k + province noise + rock noise`, elongated along the structural azimuth) → prospectivity by family → **province → district → deposit**. A district groups deposits without adding stock.
5. **Drawing a deposit.** Count `Poisson(density × prospectivity × area)`, log-normal tonnage around a family median, shared grade factor, log-normal top depth, position by **exponential race** `argmin(−ln u / w)` over the weights of the child cells. Everything is deterministic and independent of order.
6. **What is recoverable counts, not what is contained.** Medieval access = reachable depth (40 m + relief) versus top depth and extent, then yield. A deposit is *outcropping* if its top is < 5 m. For materials (stone, lime, clay, sand): "stocks are not limiting; only access, quality and transport matter."
7. **Flow sites derived from geometry + climate + fuel.** Coastal salt (R3k) is the best model for our activity sites: candidates on low coast, spacing by exclusion (12/6 km), production = `min(resource ceiling, labour ceiling, fuel ceiling of the neighbourhood)`, productive months as a mask. This is exactly an `ActivitySite` with capacity and season.
8. **Immutable natural state + dated delta.** The natural state never changes. History (clearing, extraction) is a delta. Clearing follows a **canonical order** of cells: the area cleared at a given date is a *prefix* of this order, monotonic and identical at every scale. This is the same idea as our prefix-stable accretive growth (memory `city-growth-accretion`).

To this are added simple, sourced biological formulas, directly reusable at the scale of a village territory (finage): Miami NPP, cereal suitability via Ecocrop trapezoids (most limiting factor), fodder = NPP × herbaceous share × 0.25 → LSU, wood: increment = NPP × 0.4 × 0.5 / 0.55, stock = increment × 60 years × cover, Damuth game, inland fishing by floodplain (4.2 t/km²/year), coastal fishing on the shelf, peat, bog iron. And a separation rule: **an appearance field (rendering) never modifies a resource.**

## 2. What Magna Urbis already has

| Layer | Where | Status |
|---|---|---|
| Relief, slope, hydrology (accumulation, receivers, rivers, widths, lakes, sea) | Rust `erosion/`, `hydrology*.rs`, `settlements/grid.rs::Fields` | solid, this is our foundation |
| Climate | `HydrologyConfig.temperature` / `.precipitation` (annual, gradient −6.5 °C/km), Turc–Pike balance | scalar per map, sufficient |
| Biome | web enum (`temperate`, `forest`, `desert`…) | declarative |
| Field soil | `web/src/gen/landuse/rural.ts:301`: `soil = fbm(x/380)` | **pure noise, to be replaced** |
| Geology (5 rocks, hardness, azimuth), HAND, TWI, alluvial, colluvial, aeolian, coastal, soil depth, stoniness, sand/silt/clay texture, moisture, organic matter, drainage | `godot-render/tools/surface_context.py` (Python, Godot rendering) | **rich but outside the engine**: neither settlements nor urban code reads it; noise is not address-keyed (not addressed randomness), proportions are fixed (findings of `RESOURCE_TILE_REFINEMENT.md` §2) |
| Programme resources | `programme_tokens.json`: timber/stone/ore/clay → `craft.workshop` | declarative triggers |
| Tile refinement contract | `docs/RESOURCE_TILE_REFINEMENT.md` | proposed, not coded |

We therefore have all the **physical ingredients**, but scattered (Rust, TS, Godot Python), and no resource layer that the engine can consume.
## 3. Proposed transfer: a Rust `resources` module

A module `rust/crates/core/src/resources/`, a native step after hydrology and before `settlements::placement`. It computes on a grid of **blocks** (60–120 m, not the DEM grid) to keep costs low. Target: **< 150 ms native for 40 km**, computed once per terrain and cached like the checkpoints.

### R0 — Parent (the branch point)
`RegionPrior { rock_shares[8], context, temperature, precipitation, family_densities, district_flags }`.
- Today: synthesised from the seed, the terrain scenario and the biome (a few presets: granite basement, limestone basin, basalt plateau, clay delta, metamorphic collision…).
- Tomorrow: read from Neural Earth (LOD 10 interpolated + LOD 3 deposits falling within the tile).
- Consumers only see the prior: the integration changes nothing downstream.

### R1 — Addressed randomness
Port Chronos' `key()` (~20 lines) alongside `magna_urbis_random::Rng`. Our `Rng` is a stream per label (`fork`): good for towns, poor for spatial fields. Every draw in R2–R5 goes through `key(seed, domain, block)`.

### R2 — Realised geology and soil (port of `surface_context.py`, subset)
- Geology: structure of `geology()` (folds, intrusions, flows) but with addressed noise, and shares **conditioned by the prior** (proportional adjustment `α_k`, 3–5 iterations). 8 classes. Outputs: `bedrock`, `hardness`, `structure_azimuth`.
- Derived terrain, all in O(n) plus one distance transform, from our Rust receivers: `hand`, `twi`, `alluvial`, `colluvial`, `soil_depth`, `stoniness`, `clay`/`sand`, `moisture`, `organic`, `drainage`.
- Replaces the `fbm` in `rural.ts`: fields, meadows and marshes finally read a soil.

### R3 — Potentials (intensities 0–1)
They name exactly the `required_context` entries of the V0.2 catalogue:

| Potential | Formula (simplified from Neural Earth / surface_context) | Used for |
|---|---|---|
| `arable` | Ecocrop trapezoid (annual T, P) × `exp(−slope/10°)` × soil depth × (1 − stoniness) × drainage | open-field territories (finages), farms, granaries |
| `pasture`, `upland_pasture` | NPP × herbaceous share × 0.25; summer pasture (estive) = highland fodder × lowland deficit | sheepfolds, summer pastures |
| `wood`, `timber_share` | woody cover (biome × moisture); sawlog share according to slope and moisture | felling, charcoal burning, sawmills |
| `water_power` | local height difference × flow (accumulation) on reaches | mills, fulling mills, trip hammers |
| `wind_exposure` | positive TPI × clearance | windmills, watchtowers |
| `stone_ashlar`, `lime`, `slate` | Neural Earth lithology table × exposed rock × hardness | quarries, lime kilns |
| `clay`, `sand` | marls / alluvium × low slope | clay pits, tile works, potters |
| `fish_river`, `fish_coast` | floodplain (low HAND × flow); sheltered coast | fisheries, huts |
| `peat`, `bog_iron` | drainage 1 × organic × low HAND; wet zones × upstream iron-bearing rock | peat cutting, small forges |
| `salt_coast` | low coast (height, slope) × hot dry months (derived from annual T/P) | salt marshes / boiling (fire-heated) salt works |
| `game` | Damuth × NPP | hunting lodges |

### R4 — Discrete deposits at finage scale
Only **small populations** from R3h are transferred (densities of 20–100 per 10,000 km²): `bog_iron`, `local_ironstone`, `small_pb_ag`, `small_sn`, `small_coal`, `salt_spring`, `gypsum_quarry`, `placer_au/sn`. Over 1,600 km², this gives 3 to 16 occurrences per family: the right scale for village mines. The large USGS families (0.1–0.8 / 10,000 km²) only come from the parent.

Same draw: Poisson → log-normal → cap → exponential race on prospectivity × host rock → medieval access → outcrop. Two non-metallic objects are added, derived from potentials rather than a draw: **exploitable outcrops** (stone, lime, slate) and **clay pits**. These are local maxima of potential × access, spaced by exclusion, as with coastal salt.

`apportion` is coded right away (10 lines), even without a real parent, so that the contract is already the one for integration.

### R5 — Capacity and season of sites
Each site carries `annual_t` = `min(resource ceiling, labour ceiling, fuel ceiling)` (coastal salt model) and a `season_mask` (felling, snow haulage, fishing, salt marsh work). This distinguishes `attached_external` (year-round) and `remote_seasonal` (partial mask, far from the parent) without an ad hoc rule.

### Output contract
Reuse as is `ResourceLayer { id, nature, regime, aggregation, quantum, unit }` and `Deposit { id, family, owner, position, ore_t, depth_top_m, recoverable, outcrop }` from RESOURCE_LAYERS §9, plus `ActivityAnchor { id, kind, position, potential, annual_t, season_mask, access_point }`. Exposed to the web as inspection layers (same mechanism as `roads_inspect`) and as diagnostic views of the V2 map.

## 4. What we do not transfer

- Computed tectonic contexts, Orogen atlas, spherical areas: at 40 km, the context is data from the prior.
- Monthly water balance and 12 values per cell: we keep the annual value, and derive two seasons if a mask requires it.
- GPU / WGSL evaluator, display LOD, symbol grouping.
- Large USGS grade-tonnage models, gossans and oxide textures: natural rendering, user scope; we only provide the extent and the flag.
- Full Chronos deltas: we only retain the **canonical clearing order** as the basis for extending finages with the age and size of the town.

## 5. Cost and verification

- One O(blocks) pass for R2–R3, one distance transform, one draw per family for R4: on the order of 50–150 ms native over 40 km at 60–120 m, cached with the terrain.
- One test: conservation (`Σ children == parent`) plus window-independent determinism (two sub-windows give the same values over their overlap).
- A quick look: 3 diagnostic views (realised rock, arable, activity sites) on a bench map.

## 6. Order and link with the catalogue plan

R1 → R2 → R3 replace phase **P2** of `catalogue_implantation_review.md`, which proposed ad hoc predicates. R4–R5 feed **P3** (`settlements/activities.rs`). Phases P0/P1 (data and urban roles) remain independent.

Next step, to be discussed: how these layers modify
1. the settlement placement score (arable finage, water, wood, stone within transport range; specialised hamlets near a deposit);
2. the district roles (`programme.resources` reads values instead of tokens; number of workshops proportional to flows);
3. scattered buildings (activity sites anchored on R4–R5).
