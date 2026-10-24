# Early Strip V2: constructive success, unresolved CPU cost

Read-only analysis of `web/out/affine-strip-early-v2-proof/{pilot.json,early-tests.log}` and the frozen early V2 sources. Root reports all5 targeted and429 library tests pass, zero ignored. All238 V2 inputs still match their manifest. This note changes no source or manifest and runs no Cargo/native code.

## Measured result and limits

The unchanged21-case corpus has4 previous admissions bit-exact,17 previous refusals→16, one recovered real513, zero reported issues. The actual initial source and first frontage pose for513 equal the previous frozen-best diagnostic (`same_previous_best_style=true`, `same_previous_first_native_pose=true`); those archival values never select routing. The hybrid tries the original programme-conforming first ordinary pose, sees its refusal, then constructs/adopts the affine winner. Target86.8m², actual86.8068961526m² (about0.00794% error), retained source EUR-MED-B02::brick_walls, wealth0.25,3floors.

| Invocation count / wall time | 513 ordinary | 513 early | All21 ordinary | All21 early |
|---|---:|---:|---:|---:|
| selected_draws |9|1|125|117|
| source fingerprints |0|4|0|12|
| build_layout |9|2|118|111|
| prepare_foundation |7|1|101|95|
| physical admission |51|2|661|612|
| measured wall time |3.9157ms|56.2910ms|97.1417ms|136.5866ms|

Two layouts on513 mean its one existing source layout plus one constructive rebuild. Two admissions mean the first original ordinary pose plus the unique reconstructed native admission. No source redraw or extra constructive try occurs. The early route spends only three selected attempts: two unsupported concave rights (zero native rebuild), then513. One other owned source admits its first ordinary pose; another static choice is never reached.

The recovered row is14.38× slower in this sample (+52.3753ms), despite much less native search. All21 are40.6% slower in this sample. Median row time4.2670→4.1244ms does not establish an improvement: it hides the expensive recovered tail. Removing the conspicuously cold first row gives82.7588→133.6082ms. These are descriptive numbers, not repeatable CPU benchmarks: one old-then-new pass, cache order, optimized test profile+debuginfo, logging/formatting and system scheduling are included. Other targeted tests interleave at the start (they finish before513 in this log). There is no phase profiler, repeated sample, release/native/wasm/browser comparison or CPU allocation attribution. No CPU speedup is claimed.

## Why exactly four fingerprints

Each call serializes the same source identity/config/non-dimensional draws/plan geometry/context/entrance (diagnostic prose excluded), then SHA256:

1. `retained_strip_rebuild::observe_actual_resolution`: engine mints provenance using the actual local native layout seed.
2. `plans::plan_one_initial_pass`→`take_actual_provenance`→`Provenance::check`: immediate resolver event must correspond to the returned source.
3. `native_strip_affine_fit::solve_and_admit`→`validate_for_source`: bind the solver to that source before solving.
4. `retained_strip_rebuild::rebuild`→`check`: engine revalidates before using its owned seed/construction capability.

`native_snapshot::observe_with_provenance` receives the already checked token; its clone adds no fingerprint. Observed counts agree with these boundaries: conforming first-pose control2, each unsupported rights case3, constructive winner4; total12. They are legitimate checks, not accidental hidden redraws. Their individual cost is unmeasured; differences on the unsupported rows cannot isolate hash cost from noise. Removing validations blindly would weaken provenance.

## Conservative optimization order

**1. Eliminate diagnostic recomputation before changing mathematics.** `direct_affine_fit::solve` unconditionally formats `primal_diagnostic(minimum)` and `primal_diagnostic(maximum)` inside `eprintln!`. On513 the log records max strict polygon empty and a valid original-boundary residual1.03917e-12<EPS1e-9. Thus the diagnostic itself calls `original_boundary_candidates(max)` (exact rational row intersections), and the subsequent mandatory extremum primal check computes that recovery again. Make expensive diagnostics lazy on Unsupported/explicit trace, or emit the actual certificate already computed. Keep both extremum primal validations, all original-row checks, and diagnostic evidence on failure. This removes real duplicate work without changing candidate/order/certificate at all; no speed magnitude is yet known.

**2. Cache exact coefficient/cone work while keeping every original constraint in original order.** The actual513 rights are identical seven-edge polygons for B/A/R. Four affine rectangles therefore emit28rows with seven exactly repeated XY normal pairs. Current `projected()` computes378 pair determinants (four repeated `BigRational::from_float` conversions each), scans3276 triples, clones determinant rationals and repeatedly normalizes cone weights. The unique-normal table needs21 pair determinants. Cache each original f64 normal as exact rational once, determinant/sign data per exact normal pair, and normalized f64 cone weights per **ordered** normal-ID tuple. Still instantiate every original row combination through the same `add` arithmetic in the same index order, with the same residual correction, caps and underflow/Unsupported rules. Ordered keys preserve summation order/rounding; a hash map must never determine output order. No angular tolerance, near-parallel merge, plane deletion, convex hull or altered EPS is needed. Repeated normals across different parts retain different u/v/rhs rows and must NOT be collapsed into one constraint. This is the primary algorithmic optimization proposal.

**3. Reuse exact primal recovery, retaining ties.** `original_boundary_candidates` reconverts all row coefficients and dimensions, recomputes pair determinants and rational RHS values at every dimension query. Reuse immutable exact row/determinant data; convert each queried dimension once. Cache translation results by the exact two f64 bit patterns within one Prepared solve, or deduplicate only bit-identical repeated dimensions from retained vertices/stationary extrema/roots. Keep ALL distinct ties/roots and the complete closest-translation ranking. Exact cache entries do not change extrema, primal guard or scalar-grid coverage. The theoretical work remains bounded by the existing512 dimension vertices; no new truncation should be introduced.

**4. Reduce serialization only with an owned/lifetime-bound certificate.** An engine-private `VerifiedSource<'a>` can perform one source check, hold an immutable borrow of that exact source+seed capability, and pass through solve and rebuild; Rust ownership then prevents intervening source/draw/geometry mutation. This could replace repeated whole-source hashing with a checked bound object while retaining stale-token/geometry/seed tests. It needs a deliberate contract change and regression proof, so it follows the pure kernel/cache changes. Do not simply delete checks3/4 or key a global cache only by recipe/seed. Hash optimization is not yet proven to dominate.

## Next proof if authorized

Use a new copy; keep V2 executable/reference frozen. Add test-only phase timers/counters for projection rational conversions/determinants/weight normalizations, diagnostics, extrema primal recovery, target candidates, four scalar corners and native preparation/admission. Run only the21-case A/B test serially, warm both paths, alternate A/B order over repeated samples; report median/p95 and deterministic calls. First compare lazy diagnostics+exact caches against V2 for full winning/archive bits, selected source/frame, preserved4 controls, unchanged16 refusals, near-parallel/repeated-normal/degenerate primal fixtures and all429 tests. Certificates, all original rows, exact cone signs, EPS1e-9, extrema/ties, four-corner unknown status, source bounds and final native physical admission must remain unchanged. A faster approximate grid or skipping the maximum-primal certificate is outside this proposal.
