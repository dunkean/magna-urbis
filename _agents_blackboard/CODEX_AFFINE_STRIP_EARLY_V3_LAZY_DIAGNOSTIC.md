# V3: lazy primal diagnostic, no mathematics change

Separate copy: `web/out/houses-affine-strip-early-v3-workspace/rust`, from tested earlyV2 (429library tests,21actual A/B). V2 remains bit-exact across all238inputs. Only `direct_affine_fit.rs` and its test file differ. `solve` now invokes the identical algorithm with diagnostic tracing OFF; explicit `solve_with_primal_diagnostics(target,true)` restores the old successful-solve trace. Unsupported error diagnostics remain mandatory. No extremum-primal verification, exact row/cone calculation, candidate/root/tie, source/native admission, EPS, ordering, or scalar-grid rule was removed or changed.

New `affine_lazy_` test counts diagnostic calls: a successful default solve makes0, opt-in makes2. It compares every returned Fit field bit-for-bit, and verifies the previously delicate touching maximum against every original row at existing EPS. All previous proofs/fixtures remain. No agent Cargo/native/test run.

Root-only commands (new proof directory/output):

```powershell
$env:HOUSES_AFFINE_EARLY_PROBE_OUT = 'ABSOLUTE_NEW_PROOF_FOLDER/pilot.json'
cargo test --manifest-path web/out/houses-affine-strip-early-v3-workspace/rust/Cargo.toml -p magna-urbis-houses --lib affine_lazy_ -- --nocapture --test-threads=1
cargo test --manifest-path web/out/houses-affine-strip-early-v3-workspace/rust/Cargo.toml -p magna-urbis-houses --lib affine_early_actual_full_pipeline_frozen_21 -- --nocapture --test-threads=1
```

Then native4 / direct_convex_fit / full library regression as root chooses. Compare actual513 output and source/frame/controls/refusals with earlyV2, not just its call count. A single wall-time sample remains descriptive; repeated warm alternating V2/V3 runs are needed for CPU attribution. No speed improvement is claimed before root measurement. No rational cache tranche is included; production memory/transport audit follows this small freeze.

Root result:16affine-filter tests PASS (not19); previous4admissions exact and gain513 retained. Single sample recovered row about45.9ms versus earlyV2 sample56.3ms, still about3.9ms ordinary refusal. This is not a repeated/isolated CPU speedup claim and no larger rational optimization is authorized here.
