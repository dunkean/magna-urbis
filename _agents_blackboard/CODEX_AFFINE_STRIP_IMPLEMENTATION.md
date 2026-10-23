# Affine Strip implementation — isolated, awaiting root execution

2026-10-23. Actual implementation is in `web/out/houses-affine-strip-proposal-workspace/rust`; **no production mutation or author-side Cargo/native command**. The earlier proposal and all diagnostic copies remain frozen. Compilation and native outcomes are pending.

The new child kernel `direct_convex_fit::affine` constructs a feasible dimension region from source-owned affine rectangle parts and their real convex rights. It projects free XY translation using nonnegative pair/triple normal obstructions, includes a bounded cancellation-residual relaxation, and requires primal translations for both reported area extrema and every returned candidate. Near-degenerate uncertain normal cones and finite-budget exhaustion are `Unsupported`. The old rectangle solver body is unchanged; only its child-module declaration was added. Its original tests remain present.

Area takes priority, then the explicitly labelled coherent catalogue/wealth-centre aspect preference, then distance from the supplied reference translation, with numeric/coordinate ties deterministic. Quantization checks at most four scalar W1mm/D4mm corners and recovers their exact linear feasible translations before selecting one. **Four-corner exhaustion is a bounded heuristic failure, not global grid impossibility or optimality.** Empty continuous domains describe only this fixed source/frame/affine envelope and source bounds; nonconvex domains are unsupported without a hull.

The Strip adapter uses actual retained non-dimensional parameters and existing source bounds/minima/×2 inspired allowance. It excludes explicit/exact/imposed/strict controls, minimum contracts, active seeded infill, unsupported roof/support/layout programmes and arcades. It reconstructs once with `layouts::build_layout` using the verified non-minimum automatic unit-0 seed format, without calling any resolver/draw function. One native preparation and one full admission use **Some(preselected_front)**; no second construction or source follows failure. Native orientation is street-frame angle +180°, and real portal/roof/terrain checks remain authoritative. Compact exterior replay is asserted on a synthetic-rights native positive fixture.

The 21-case pilot keeps the preceding three selected sources and first exported frames. Float frame/front inputs use hexadecimal f64 identities. Canonical frame angle is exported native angle −180°, with its origin at the exported native body's `(u,D)` corner, so the reference body origin is `(0,0)`. The two concave real cases must stay unsupported with zero construction. No real-corpus gain count is presumed.

Changed files relative to the 228-input baseline:

- `src/direct_convex_fit.rs`: child declaration only.
- `src/plans.rs`: test-only adapter declaration.
- New `src/direct_affine_fit.rs`, `src/direct_affine_fit_tests.rs`.
- New `src/native_strip_affine_fit.rs`, `src/native_strip_affine_fit_tests.rs`.
- New `tests/fixtures/affine-strip-first-frames.json`.

Root execution commands, from `web/out/houses-affine-strip-proposal-workspace/rust`, with root's chosen `CARGO_TARGET_DIR`:

```powershell
cargo test -p magna-urbis-houses --lib direct_convex_fit -- --nocapture
cargo test -p magna-urbis-houses --lib affine_native_ -- --nocapture
```

The first runs old rectangle tests plus two new affine kernel cases (constructive triangle off the preferred aspect curve; obstruction/concavity cases). The second runs the native one-construction/admission fixture and the fixed 21-case pilot. Set `HOUSES_AFFINE_STRIP_PROBE_OUT` to an absolute JSON path for the latter report. Static verification only: literal includes exist, delimiters balance, no adapter resolver/draw calls, previous solver text matches its baseline after removing the child declaration. Freeze identities: `web/out/houses-affine-strip-proposal-workspace/implementation-freeze.json`.

Final source checkpoint: every minimum/maximum area level enumerates all boundary roots and ideal candidates; primal recovery may use any valid tied point. Continuous candidates on the same theoretical area level rank by aspect/translation after a numerical level check, so root ULP errors do not accidentally override aspect. Quantized corners still rank their real area errors first. Explicit exact/imposed context is supplied to the adapter and closes it before solving. Before promotion, move the verified non-minimum unit-0 seed derivation into an engine-owned helper and add a provenance contract test; the current derivation is restricted to this isolated pilot, not declared a public retained-archive guarantee.

## First native run and numerical v2

Root compiled the first frozen 233 inputs: six of seven scoped kernel tests passed (all five old rectangle tests plus affine obstruction); the constructive triangle failed. Both native tests passed: the synthetic true Strip fitted 86.8 m² and replayed its exterior with one construction/preparation/admission; the real corpus preserved four admissions/17 refusals, selected the same three sources and gained zero. Two actual rights were unsupported by the convex scope; 513465 stopped at the conservative near-degenerate-cone threshold. Full first inputs/logs remain in `web/out/affine-strip-first-proof/`.

V2 changes only the affine kernel and its tests. An offline replay identifies the stationary-maximum mechanism: inverse quadratic discriminant rounds to −1.1368683772161603e−13 even though the already constructed edge-stationary point (4.375,3.28125) is feasible. Preserve every original polygon vertex/stationary candidate on its area level; do not clamp the discriminant or change the domain. This also retains every tied extremum without relying only on inverse roots.

Near-parallel/repeated normal cones now use exact rational determinants of their unchanged binary64 normal components (existing num-rational/num-traits dependencies). Exact signs classify pairs/triples; normalized positive rational weights convert to finite floats, with underflow explicitly unsupported. The existing cancellation-residual bound, projected caps and all original primal checks stay active. No normal/coordinate merging, tolerance relaxation, hull or physical-admission change is introduced. The triangle failure prints its actual Outcome and a new repeated/near-parallel-rights test checks projection plus every returned original row.

New manifest: `web/out/houses-affine-strip-proposal-workspace/implementation-freeze-v2.json`. Root should rerun the same two scoped commands above; V2 compilation/results remain pending.

## V2 result and V3 degenerate XY recovery

Root preserved all V2 inputs under `web/out/affine-strip-v2-proof/frozen-sources`: seven of eight kernel tests passed, the same triangle stopped at extrema primal recovery, and both native tests passed (real corpus still zero gains). An offline replay of the actual binary64/rational triangle coefficients gives maximum dimensions `[4.375000000000001,3.2812499999999996]`, area `14.355468750000002`. Strict XY clipping empties, although an original-line intersection `(1.25,−1.2433061056483718e−16)` has worst original residual only `1.2433061056483718e−16`, below the existing `EPS=1e−9`.

V3 keeps strict clipping as a fast path. If it produces no verified point, recover reference projections onto original boundary lines and exact rational pair intersections of the original XY coefficient rows. Every candidate must satisfy every original row with the unchanged EPS; non-finite candidates are rejected. No line is shifted, no dimension is clamped, and no physical tolerance, source, angle or fixture changes. Candidate counts are bounded by the existing 64-row limit. A new focused point/segment fixture reproduces strict collapse with an acceptable original-row residual and also refuses a genuinely larger contradiction. The Rust run prints actual extrema dimensions, source-bound status, strict vertex count and best original-boundary residual/point before verification, so remaining failures are diagnostic rather than opaque.

Only the affine kernel/tests changed. New manifest: `implementation-freeze-v3.json`; root can rerun the same two targeted commands. No author-side Cargo/native execution.
