# Building morphology — Codex sub-agent

Implemented in `rust/crates/houses/src/morphology.rs`, with narrow helpers in `layouts.rs` and the explicit opt-in `engine::adapt_resolved_architecture` entry point. Existing native layout generation, historical strict mode, and House Bench defaults retain their original route.

## Integration

`adapt_resolved_architecture(&ResolvedArchitecture, &Surface, Option<&Surface>) -> Result<ResolvedArchitecture, String>` expects a metric envelope in the building's local orientation. An optional imposed footprint is in the same frame. It clones retained parameters and replaces the plan atomically, clearing any entrance bound to the old geometry. New frontage attachment is the caller's responsibility. The root's `plans.rs` route supplies the frame and roof-right clearance.

The catalogue capability index calls `morphology::supports` and `supports_imposed` directly. No culture or recipe name infers a geometric permission.

## Implemented families

- Rectangular/long single bodies and row houses: whole habitable body, retained yard and side access for rows.
- Declared L/U/courtyard plans: independent wing dimensions, preserved drawn courtyard ratio and physical room/stair minima, real open court, ground gateway for closed courts.
- Declared additive complex plans: bounded trees of independently sized rectangular ranges; retained source body count.
- Heterogeneous declared Main/Adjacent components: retained component identities, quantities, separate materials, roof systems, floors, square tower geometry, and native 1.4 m inter-body clearance. Generic typed programme handling includes `EUR-MED-B07` (house plus tower). Adjacent side/corner position and dimensions vary by seed. No fabricated manor recipe or source attribution was added.
- Exact imposed orthogonal footprints for compatible rectangular/L/U/complex subsets. Decomposition preserves the occupied union; incompatible topology, widths, source counts, required access or reserved holes produce an explicit refusal.

Every candidate is checked against the actual polygon and its holes. Finished houses are never clipped. Single/row/court composition keeps its original 64 candidates and adds at most 16 candidates at physical minima after those fail (80 total); heterogeneous component assembly remains bounded to 64 candidates. Each candidate has at most 8 ranges/components. Polygon validation is bounded to 256 vertices. These are complexity bounds, not a performance benchmark.

## Explicit limits

- Authored ranked courts, galleries, non-ground supports, shells/vaults/corbels, special structural programmes and unsupported component placements retain native templates.
- Closed-court imposed footprints and heterogeneous component unions need explicit access/component-domain information and currently refuse.
- The envelope constrains building bodies, courts and paths. Roof rights and urban frontage remain the plan API's responsibility.
- Exterior realization uses the native roof builder with retained body/level geometry. Detailed interior enrichment remains independently certified; it may refuse atomically.
- In the regression seed, native `EUR-MED-B07` already refuses detailed interior enrichment because the existing roof-surface audit detects a difference. The adapted house/tower preserves that guard and remains available as a native exterior. No roof audit was relaxed.

## Verification

Focused regression suite covers true concavity/holes, exact imposed L, rejected incompatible geometry, physical minimum widths and courts, deterministic replay and variation, source body/component count retention, historical strict refusal, unchanged native source plan, native roof replay for row/courtyard/additive/house+tower, successful row detailed enrichment, and atomic refusal of the unsupported tower interior.

Latest check: `cargo test -p magna-urbis-houses --lib morphology::tests -- --nocapture` — **10 passed**, 0 failed, test execution 0.06 s. `git diff --check` passed for the owned changes. Root owns broader regression/integration runs.

## Review issue 15 — real burgage refusal replay

The saved `web/out/city-bench/b/city-01-river-plain-s-*` layout and partition, with the frozen native engine on `:8794`, produce 745 requests: 340 accepted, 294 refused, 111 open spaces. Requests/results are retained in `_agents_blackboard/compact-refusals/`; this is an actual parcel corpus, not a rectangular synthetic benchmark. The initial refusal categories were 194 exhausted geometry searches, 51 unsupported authored-template failures (including 3 eave failures), 39 frontage connection failures, and 10 invalid microscopic reserve polygons. City-side cleanup of the latter belongs to Opus.

The geometry search previously never shrank below 55% of the occupation target. Coverage and aspect can describe a large desired house even when a tapered lot only contains a smaller legal range. The new final 16 candidates use the existing physical room/stair/court/access minima. The first 64 candidates and their seeds are unchanged. After a free-envelope fit fails, `plans.rs` also tries the supplied admission witness as another envelope, intersected with the real available domain. All cadastral, reserve, roof, terrain, neighbour and frontage checks still apply. An imposed footprint never takes this fallback.

Focused regression: `cargo test -p magna-urbis-houses --lib real_tapered_burgage_lots_keep_constraints_and_replay -- --nocapture` — **1 passed**, 0.02 s. It replays two small actual city requests (8.5 KB fixture), retains their terrain and physical rights, checks deterministic output and three storeys, and realizes their native exterior roofs after a cold JSON round-trip. No broad suite was added. The reusable `plan_replay` example runs a saved request against the library without rebuilding/restarting the local server; `web/scripts/city_compact_refusals.mjs` captures requests from saved city parcels on an existing native service.

Final source replay of the exact saved 745 requests:

| Selection | Before accepted/refused | After accepted/refused | Open spaces |
|---|---:|---:|---:|
| Existing pinned B02/B05 | 340 / 294 | 506 / 128 | 111 |
| Domestic/mixed recipe null | 284 / 350 | 567 / 67 | 111 |

The automatic result includes the independent style-index correction: explicit native parameter compatibility is filtered before spending the four-recipe geometry budget. This eliminates attempts at one/two-storey source programmes when the request explicitly requires three storeys. No previously accepted ID is lost in either replay. Pinned recipes keep their previous footprint geometry within 0.000000066 m boundary difference (JSON/API versus direct-library numerical round-trip); no old pinned footprint changes by 1 mm. Automatic reruns can select different recipes after filtering changes the weighted candidate set: 67 previous recipes and 68 footprints change, while already retained plans are never rerolled.

Remaining automatic refusals: 45 unsupported source-template geometry cases, 10 microscopic invalid city reserves, 8 genuine unsuccessful frontage connections, 3 exhausted bounded shape searches, 1 insufficient physical minimum width. These are kept explicit. Reports and exact requests/results: `_agents_blackboard/compact-refusals/final-report.json` and `_agents_blackboard/compact-refusals-auto/final-report.json`. This is one European river-town corpus, not a claim for every culture or city.

Replay commands (working directory `rust`):

```powershell
cargo run -p magna-urbis-houses --example plan_replay -- ..\_agents_blackboard\compact-refusals\requests.json ..\_agents_blackboard\compact-refusals\final-results.json
target\debug\examples\plan_replay.exe ..\_agents_blackboard\compact-refusals-auto\requests.json ..\_agents_blackboard\compact-refusals-auto\final-results.json
```
