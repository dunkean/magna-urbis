# Native snapshot geometry — diagnostic export proposal

2026-10-23. **Prepared, uncompiled; no author-side Cargo/native invocation.** New copy: `web/out/houses-native-snapshot-geometry-workspace/rust`. Both previous proposal freezes remain intact; product/export are untouched. This tranche adds diagnostics only, with no new source, candidate choice, dimensions, angle, pose, translation solver or alternative portal.

Root's preceding native proof (`web/out/native-snapshot-isolated-proof/pilot.json`) preserved four admissions and 17 refusals with zero gains. Three conforming EUR-MED-B02 snapshots reached one native preparation each and two existing frontage poses each; all six refused the initial body/plan/occupation guard before access. Their parcels are `a71f31f2438f58c9`, `a7aa26a199e8dc6f`, and `513465e42378834d`. This establishes neither programme impossibility nor fixed-angle translation impossibility.

## Exact exported evidence

`native_snapshot_geometry.rs` exports one header per actually prepared snapshot, and one record **after each actual existing admission call**. The original result and transform are retained; the export never selects or modifies a pose.

- Exact raw archived request and typed consumed request; prior archived occupation records; the actual occupied input and combined neighbour/occupation surface used by admission.
- True selected `ResolvedArchitecture`, its metrics, and a compact archive retaining the already prepared native portal if available. Archive creation reuses the same cached physical preparation and does not resolve or construct another layout. The archive certifies no placement/interior.
- Local body/plan surfaces, separate cartographic body/feature roof parts, native features, occupation/bearing parts and test unions, and the prepared body/site portals and cut-wall solids.
- Each unchanged transform and selected declared frontage; world body/plan/roof footprints; native feature XY surfaces, transformed-before-union native occupation/bearing parts, and world portals/passages/solids.
- Raw buildable/reserves/cadastre/roof rights and their exact boolean-derived allowed surfaces, plus the actual frontage guide domain. No hull, clipping approximation, coordinate quantization or geometry compression is introduced.

The initial guard is decomposed exactly into: body outside `buildable − reserves`, plan outside `cadastral − reserves`, and plan intersection with combined occupation. Each includes its actual violation surface, area, tolerance and boolean result. Inclusion tolerance is `max(shape_area × 1e−8, 0.0001)` m²; collision tolerance is 0.0001 m², matching `plans::contains` and ordinary admission. Later native occupation and cartographic roof rights are exported as diagnostics even when admission short-circuited before them; they are not evidence that those later stages executed.

Roof fields are explicitly **cartographic admission envelopes**, not a native roof realization/projection. No roof mesh is generated. World geometry is XY only where terrain admission never ran; full native features retain their original local Z without inventing a placed ground altitude.

## Frozen-case regression and execution handoff

The unchanged 21-site test now compares the three selected IDs, complete best-snapshot metrics, styles, pose counts and refusal strings against `native-snapshot-geometry-expected.json`, extracted from the preceding native report with its source hash. It requires the same four preserved admissions/17 refusals/zero gains, three preparations and six poses; each exported first guard must actually fail. A changed choice/outcome fails instead of silently exporting a different search.

Root can run the existing single `native_snapshot_f6_pilot_uses_only_prior_main_resolution_and_native_portal_poses` test with its centralized Cargo target. `HOUSES_NATIVE_SNAPSHOT_GEOMETRY_OUT` writes the dedicated geometry JSON; `HOUSES_NATIVE_SNAPSHOT_PROBE_OUT` optionally writes the full 21-site report. Detailed geometry stays out of stderr summaries. Freeze identities are in `web/out/houses-native-snapshot-geometry-workspace/proposal-freeze.json`. All literal include paths exist and source delimiters balance; compilation and exported numeric areas remain pending root's run.

## Expected float identity repair

Root compiled the diagnostic copy. Its first run stopped at the expected-metric comparison: the actual depth remained `12.261000000000001`, while Rust rereading the expected decimal JSON produced `12.261` (one ULP). The original native pilot and actual selected geometry did not change. The preceding fixture/test/freeze are preserved in `web/out/native-snapshot-geometry-proof/expected-f64-before-f6994dba/`; the original native proof hash remains `6a87388e2cedf4664a23b4d59bf2cc9c25218145e0ccbb9bafd7370c3bfd46cb`.

Only the expected fixture and its test reader changed. A signature generated with Python `struct.pack(">d", value).hex()` directly from the original pilot replaces each floating field by its 16 hexadecimal IEEE-754 bits. Rust compares actual in-memory `f64::to_bits()` signatures; every non-floating field/type stays exact. The first depth identity is `402885a1cac08313`. Display decimals remain for humans and are not the identity reference. No tolerance, geometry, pose, source or native admission code changed; exports still write only after identity/guard assertions pass. Rerun is pending root.
