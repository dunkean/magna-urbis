# Revue 2 - Opus 5.5

Verified model: claude-opus-5-5. Requested effort: high. Read-only review; the reviewer did not run tests.

Original verdict is preserved. Subsequent corrections are tracked in the implementation report.

# Phase 2/6 review: environment compiler and population layer

**Verdict: CHANGES REQUIRED**

This was a read-only static review. I made no edits and ran no tests, builds or benchmarks. Every performance or memory figure below is an estimate from reading the code, not a measurement.

**What holds up:**
- The canonical heights are copied once and stored unchanged (`compiler.ts:207`).
- With no geology map, the compiler uses an explicit granite scenario and says so in a warning (`:213-214`).
- Source routing is checked for valid indices and cycles, using a topological sort (`:131-160`).
- Provenance is normalised by area before any source-supplied contributing area replaces the computed one (`:161-169`).
- HAND follows the drainage network; distance to water is only a proximity measure (`:177-199`).
- Sand + silt + clay is renormalised to 1, and organic content is a separate field (`:288-289`, `:308`). Bilinear sampling keeps that sum at 1.
- Population cells use absolute world coordinates, rank thinning is nested, and population output does not depend on season (test `:100-114`).

The stated limits (TPI instead of geomorphons, D8 fallback, heuristic deposits) are declared accurately in `assumptions` and `warnings` at `:228-235`.

---

## Blockers

### B1. Floodplain deposits take their provenance from their own small catchment, not from the river
**Where:** `compiler.ts:272-279`, plus the overwrites at `:271` and `:284`

**Problem:** Origin is classed as alluvial from HAND and distance (`:257`), but the mineral mix is built from `f.provenance[u][i]`, which is the cell's *own* upslope mixture. A floodplain cell next to a channel only drains its local hillslope. So a granite floodplain below a basalt headwater gets `sourceRock = granite`. That contradicts design §5.2/§5.3 ("une plaine alluviale peut recevoir des matériaux différents de sa roche sous-jacente").

The only test (`surfaceWorld.test.ts:59-75`) checks the channel cell 7 itself, so it can't catch this.

A second problem: the main loop overwrites `f.provenance` in place with one-hot local rock for residual, colluvial and aeolian cells. Steep torrent cells (`flat` ≈ 0.14 means alluvial stays below 0.28) therefore lose their transported mixture too. The field's own doc ("transported source fractions", `model.ts:92`) is then false.

**Fix:**
1. In the reverse-topological pass at `:178-187`, store `drainageCell[i]` (the first water cell downstream) next to `drainageElevation`.
2. Keep a `transportedProvenance` field that is never overwritten, separate from the deposit provenance.
3. Build alluvial (and optionally coastal) mixtures from `transportedProvenance[drainageCell[i]]`, optionally blended with the local mixture by HAND or distance.

**Validation:** a fixture with a basalt headwater, a granite valley floor and a supplied network. Assert that a non-channel floodplain cell has `depositOrigin = Alluvial`, `sourceRock = basalt` and basalt provenance > 0.5. Also assert that a steep channel cell still carries its upstream mixture in `transportedProvenance`.

### B2. Cache identities miss two real dependencies
**Where:** `compiler.ts:344-348`, `:325-341`

**Problem 1 — derived hydrology version is constant.** `hydrologyVersion = fingerprint(input.hydrology ?? 'derived-d8-1')`. When routing is derived, the hydrology version is the same for every terrain. If you supply only `waterClass`, it hashes that alone. Design §4.3 requires separate identities and says "modifier la topographie invalide aussi les dérivés de drainage". Any cache keyed on `versions.hydrology` will serve stale routing.

**Problem 2 — material IDs are list positions.** `fields.material` stores raw positions in `SURFACE_MATERIALS` (literals 1…17). Reordering or inserting a recipe changes what every compiled cell means. But `environment` doesn't include `materialLibrary`, and `SURFACE_COMPILER_VERSION` is a constant that nobody is forced to bump.

**Fix:**
- For derived routing, set the hydrology version to `fingerprint(['derived-d8-1', terrainVersion])`, or hash the computed `downstream` and `waterClass` fields.
- Resolve material IDs through an id → index map built from `SURFACE_MATERIALS` (e.g. `MATERIAL['alluvial-bars']`).
- Add a hash of the ordered recipe-id list to `environment`, or carry a recipe-id table in the world. Index-only categorical data then can't drift.

**Validation:**
- Change one height with no hydrology input and assert `versions.hydrology` changes.
- Permute a copy of the library through an injectable catalogue and assert that either the stored ids still resolve to the same recipe ids or `environment` changes.

### B3. JSON serialisation can't handle 1024² worlds
**Where:** `compiler.ts:387-389`, called through `adapters/export.ts:22,40` (`JSON.parse(serializeSurfaceWorld(world))`)

**Estimate (not executed):** at 1024² with 5 units there are about 33 float layers, roughly 35M numbers. Float32 values widened to doubles print about 18-20 characters each (e.g. `0.10000000149011612`). That gives roughly 650M+ characters, above V8's maximum string length (about 2²⁹ ≈ 537M). So the packet path would most likely throw `RangeError: Invalid string length`. Even below that limit, the parse-after-stringify round trip doubles peak memory.

**Fix:** use a binary container: a JSON manifest plus little-endian typed-array buffers with dtype and length per field, ideally chunked. Keep the JSON form for small fixtures only, with an explicit size guard that fails with a clear message.

**Validation:** a 1024² synthetic compile → serialise → deserialise test (it can be marked slow). Record peak heap and wall time, and assert byte-exact round-trip of `fields` and `versions`.

---

## Major (fix in this phase, but they don't block the contract)

| # | Location | Issue | Fix / validation |
|---|---|---|---|
| M1 | `compiler.ts:49`, `:184`, `:371`, `:379` | `handM` uses `-1` to mean "unknown". That value is finite, so `bilinear` blends it: halfway between HAND 0.5 and an unknown cell you get −0.25. `distanceToWaterM` (Infinity) and `waterLevelM` (NaN) avoid this through the non-finite fallback; HAND doesn't. | Use NaN for unknown HAND (deserialise `null` as NaN for `handM`), or fall back to nearest whenever any corner is < 0. Test: sample between a known and an unknown HAND cell and assert the result is either the known value or NaN, never negative. |
| M2 | `compiler.ts:96-107`, `:111-113`, `:232`, `:291` | **TPI edge bias.** Clipped windows aren't centred, so a *plane* gets TPI ≈ ±(r/2)·d·gradient near edges. On a 30 m DEM with a 600 m layer (r = 20) and a 0.1 gradient, that's about 30 m: a false Valley on the low edge and a false Ridge or Shoulder on the high edge (r = 5 gives about 7.5 m against a 2.25 m tolerance). It also feeds `soilDepthM`. The warning only fires when a radius exceeds half the extent, but the bias is present for *every* radius within r cells of an edge. | Emit an edge-band confidence mask (cells closer than r_max to an edge), or compile with an exterior halo of r_max from the generator and crop (design §8.3). Always warn when any window is clipped. Test: on a tilted plane, assert TPI ≈ 0 and Flat/Slope landform everywhere, or that edge cells are flagged. Same issue, smaller: `curvature` at the edges (`:92`) is one-sided and gives g/d instead of 0 on a plane. |
| M3 | `compiler.ts:172`, `:257`, `:245` | **Results depend on extent and resolution.** The river threshold `n·d²·0.004` is 0.4 % of the *export area*, so the same terrain gets a different network depending on window size. The floodplain scale `4d+30` m and the colluvial decay (×0.82 per *cell*) both change with grid spacing. | Use physical thresholds (m², m, a decay length in m converted per cell step), optionally scaled by climate. Test: compile a sub-window and the full grid of the same terrain, then assert identical `waterClass` and `depositOrigin` inside the shared interior, away from truncated basins. |
| M4 | `compiler.ts:320-339` | **Season is baked into the permanent material field.** `snow > 0.3` sets material 14, and the periglacial override depends on `seasonalTemp`. `fields.material` therefore changes with `state` while `environment` stays the same, and the substrate under snow is lost. Design §4.2/§8.4 says the snow layer is composited separately over compatible supports. | Keep `material` state-independent and expose snow and wetness as overlays only (they already are). Map periglacial to a permanent recipe, not `snow-ice`. Test: compile the same input in summer and winter and assert `fields.material` is identical. |
| M5 | `compiler.ts:391-415` | **Deserialisation trusts the file.** Categorical values aren't range-checked: `new Uint8Array([300])` wraps silently, and an unknown `sourceRock` or `material` makes `find(...)!` and `world.materials[...]` return `undefined`, which crashes `evaluateMaterialPattern`. `downstream` isn't re-checked for cycles or range. `geology.bedrock` length and `climate` array lengths aren't checked. `versions` and `id` are accepted as-is, so an edited file keeps its old cache identity. | Validate ranges (waterClass ≤ 3, occupation ≤ 7, landform, depositOrigin, material < materials.length, bedrock/sourceRock ∈ unit ids), rerun the downstream checks, and recompute `versions.terrain` (or all fingerprints) and reject on mismatch. Tests: tampered category, tampered height with unchanged versions, wrong-length climate field. |
| M6 | `compiler.ts:84,99,152,253`; `population.ts:44` | **Cancellation can't fire mid-run.** Compile and populate are synchronous, so `controller.abort()` can't run until they return. The periodic `assertNotAborted` checks can only ever see an abort that happened before the call started. A 1024² compile (probably seconds, not measured) blocks its thread. | Run in a worker and either yield between phases (make it async) or poll a `SharedArrayBuffer` + `Atomics` flag. Otherwise, document that only pre-start cancellation works; the session-level stale-result filter in `provider.ts` stays the actual safeguard. |
| M7 | `population.ts:42-69` | **The population budget only counts accepted candidates.** A large, sparse query (desert, retention 1) enumerates every slot, with a `hashString` call and a full `sampleSurface` each. Grass alone over a 30 km world is about 118M slots, and the loop won't throw before finishing. | Before the loop, compute `Σ cells × slots` per family and reject when it exceeds `maxCheckedSlots`. Optionally sample only the fields the families need instead of building a full `SurfaceSample` (which allocates the provenance array and does two `find` calls per candidate). |
| M8 | `compiler.ts:53-63`, `:175-176`, `:182` | **Hydrology input gaps.** `waterLevelM` isn't checked: `±Infinity` passes, and a wet cell can have NaN or a level below its bed. When `waterClass` is supplied without levels, `:176` sets the level to the bed height for Lake and Ocean (zero depth) and gives no warning. HAND uses the bed height of the first water cell rather than its water level. | Require a finite level on wet cells, or warn about the fallback explicitly. Reject non-finite non-NaN values. Use `waterLevelM` as the HAND reference where it's finite. |
| M9 | `compiler.ts:28`, `:223`, `:350` | **The memory limit allows ~16.7M samples, but the check runs after allocation.** About 150 B/cell with 5 units (+4 B per extra unit), plus about 30 B/cell of temporaries, gives roughly 190 MB at 1024² (estimate). At the cap that's multiple GB. | Compute `estimatedBytes` before `createFields` and check it against an `options.memoryBudgetBytes`. |

## Minor and optional improvements

- **Flat aspect (`:91`, `:294`, `:319`):** on flat cells `atan2(-0,-0)` returns −π. That arbitrary aspect drives ±7 % of the precipitation exposure term and the alluvial orientation. Weight exposure and orientation by `clamp(slope/0.1)`.
- **Wind and angle convention undocumented:** `windRadians` ("from" or "toward") and the aspect frame (radians from +X toward +Z) aren't stated, and exposure (`:294`) and ripple orientation (`:319`) depend on them agreeing. Document both in `model.ts`.
- **`closedBasin` on D8 flats (`:121-129`, `:181`):** every flat cell becomes a one-cell "closed basin". This is in line with the declared scope, but tag derived pits as *unresolved* rather than endorheic. Optional upgrade: priority-flood plus flat resolution (O(n log n)).
- **Population seams (`population.ts:49`):** query bounds are closed on both sides, so a candidate exactly on a shared tile edge appears in both tiles. Use half-open `[min, max)` and close only the world's max edge.
- **Density versus cover (`population.ts:14,55`):** 3 tree slots per 400 m² × 0.8 gives about 47 % crown cover at `treeCover = 1`, so near-field instances and the far-field statistic disagree (§7.4 handover). Calibrate density so expected crown-area fraction ≈ cover, and test it.
- **Rock-unit validation (`validateGeology` `:70`):** `strikeRadians` and `colorLinear` aren't checked for finiteness. A NaN there spreads into `orientation` and the pattern colour. `nativeSpacingM = Infinity` passes `:31`.
- **Radii (`:221-222`, `:109`):** the order isn't checked, but landform assumes `[0]` is the small radius and `[1]` the large one. Effective radii (rounded to cells, minimum 1) aren't reported. Validate ascending order and store the effective radii.
- **Precipitation check (`:297`):** the negative-precipitation check runs mid-loop. Move it into `validateAligned`.
- **Hash width (`:10-25`, `model.ts:137`):** cache keys use 32-bit FNV. Consider 64-bit (two lanes) for long-lived cache keys. Keys present with value `undefined` hash differently from absent keys, which causes spurious misses only.
- **Performance (optional):** the chamfer pass allocates a neighbour array per cell (`:193`). Several hot loops repeat `ids.get(...)` lookups (`:239`, `:254`); a precomputed `Uint8Array` unit index per cell would avoid them.
- **Post-compile check:** add a cheap pass asserting every field is finite except the documented sentinels.

## Invariants for the in-flight canonical-context retarget

I treated this work as not done. These are the properties it needs to keep:

1. **Fields stay on the canonical grid.** `sampleSurface` indexes `fields` with `world.terrain.width` (`:367-370`). If a finer patch replaces `world.terrain`, every lookup silently misaligns. Keep the canonical grid and the refined heights separate, and assert `fields.*.length === canonical n` in `sampleSurface`.
2. **`environment`, `population` and `stableId` don't change when patches arrive.** Give refinements their own version (e.g. `terrainDetail`) and include it only in render-page keys. Never recompute TPI, drainage, provenance or cover on patch grids (design §8.3).
3. **Candidates:** existence, x/z, size and variant come from the canonical context. Only the support `y` is re-evaluated on the refined surface (§8.2), and it must use the same reconstruction the renderer and picking use.
4. **Water stays canonical:** water class and level don't change with refinement. Refined bed heights above `waterLevelM` inside wet cells should be reported, not used to reclassify the cell.
5. **Edge cells:** the edge bands from M2 should keep their reduced-confidence flag after retargeting, rather than being re-derived from patch edges.

## Tests to add

- B1 floodplain provenance (basalt source over a granite valley floor).
- B2 derived-hydrology version and material-catalogue identity.
- B3 1024² binary round trip, with timing and peak heap recorded.
- M1 HAND interpolation at an unknown/known boundary.
- M2 TPI and landform on a tilted plane, all the way to the edges.
- M3 sub-window versus full-grid consistency.
- M4 material unchanged between summer and winter.
- M5 rejection of tampered or out-of-range packets.
- M7 the checked-slot budget actually throws.
- An all-fields finiteness sweep over randomised fixtures, including rough terrain with flats and pits.
- A seam test with a candidate placed exactly on a tile boundary.
