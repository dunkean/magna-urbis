# Two failed goldens: capture-only V2

Freeze implementation-freeze-two-golden-capture-v2.json SHA256594a1c43e1452518257192ea209a892adcdd0202d9fe873df46b8591c77e176f.265inputs,2cfg(test) deltas only. Runtime V1, all original requests/references and the original TWO failing test bodies/assertions remain intact. Failed V1 proof/freeze/product are unchanged. No author build/test/native/server/browser. This copy does NOT approve new golden hashes.

Static triage:0002 fails its need-OFF baseline hash before it even runs need-ON; growth earlier in plan_one is therefore the stage changing that transport.0080 fails its whole-batch candidate hash before checking the particular fallback witness. Neither hash alone proves that changed geometry is safe or that the target fallback is broken.

Exact old outputs exist and are SHA-pinned in capture-plan.json:
- old0002baseline490601d4... /candidate053c9570...
- old0080baselinea61434c0... /candidate208b1628...

Historical REQUEST decoding deliberately remains serde_json::from_slice, exactly as the existing tests and their CLI references. Old OUTPUT decimals are read through the scoped Std reader solely to recover writer f64 bits without a rounding repair/normalization; raw original transport bytes are copied unchanged too. New outputs are captured as actual typed native PlanBatch BEFORE any transport decode, with lossless encoding and native parent archives for altered objects. Recovery is not a new admission certification.

Root-only command (new compile required because V1 exits on the hash before export):

```powershell
$env:CARGO_TARGET_DIR = 'D:\workspace\self\magna-urbis\web\out\single-growth-golden-capture-target-v2'
$env:GROWTH_GOLDEN_CAPTURE_PLAN = 'D:\workspace\self\magna-urbis\web\out\houses-single-growth-golden-capture-workspace-v2\capture-plan.json'
$env:GROWTH_GOLDEN_CAPTURE_OUT = 'D:\workspace\self\magna-urbis\web\out\single-growth-golden-capture-proof-v2\run-01'
cargo test --manifest-path web/out/houses-single-growth-golden-capture-workspace-v2/candidate/rust/Cargo.toml -p magna-urbis-houses --release --lib single_growth_descriptor_two_golden_stage_contract_capture -- --ignored --nocapture
```

Exact test path plans::single_need_continuation::tests::single_growth_descriptor_two_golden_stage_contract_capture. OUT must not exist. Manifest/src/fresh=false source artifact identity is mandatory, irrespective of target/cache choice. Capture-plan SHAecbfc4dba4bc4855563c1543192f50ccbcf30a013b2b85fa91833711bb6b42d8.

Per0002/0080: save actual currentNeedOFF/ON transport+lossless native batches, four raw old golden transports+Std recovered lossless outputs, all current need events/checks, changed parent IDs/area/native-entry/source/config/orientation/levels/dimension-stage diagnostics and native archives. Per changed parent old/new audits run actual foundation queries, complete land-land/both roof-land pair checks against every other finalized member in THIS batch, plus same-pose native preparation/admission and parent-archive source validation. Extra diagnostic native prep/admit costs are distinct from generation budgets; they do not grant new tries. Readmission errors/identity differences are EXPORTED, not silently normalized or declared harmless. Prior neighbor inputs remain exact; unavailable historical prior roof actors are not invented.

All artifacts saved BEFORE the final contract assertions. The new test still requires all existing per-need checks true, no admitted IDs lost in the two witness stages, and0080 WHOLE ACTUAL currentNeedOFF parent equals currentNeedON parent. The historical28-29m2 assertion is not rewritten: its old transport remains preserved and the original failing test remains unchanged. A different earlier incumbent must be audited as such, not made to match the old shape. Bounded32MiB/file; at most these2lots, no all-city native graph.

Next: review actual changed parents/physical results, explain early-growth vs deferred-stage effects, then root alone may approve deterministic stage-specific reference updates. No disabling growth/guards/skipping case or blind hash replacement. Full132V1 diagnostic completed but remains NONPROMOTABLE while these regressions are unresolved; its+4610.718m2gross (<1%) and5fewer insufficient reports do not close the Java deficit or certify useful area/households. Runtime/performance claims remain unapproved.
