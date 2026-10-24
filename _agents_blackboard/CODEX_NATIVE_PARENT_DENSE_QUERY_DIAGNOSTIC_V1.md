# Dense query0045: root diagnostic handoff

Freeze implementation-freeze-dense-diagnostic-v1.json SHA25685dc52513f5344db0084d3accea43792021b760fad75cb120226336bde39d766.263inputs,4deltas ALL cfg(test), no production runtime algorithm/threshold/cap/query order change. New copy from immutable minimal Java benchV1; its already root-normalized Cargo.lock e039ed14... is separately recorded. Original bench/source/product remain untouched. No author build/test/native/server execution.

The full Java run is INCOMPLETE:45 batches/2,880 requests ACKed,2,180 parents/270assemblies/2,450members;0045 failed administratively, not OOM. This test is an expressly targeted diagnostic restore, NOT a product resume API, fresh whole-city run, successful capacity result or new performance measurement.

```powershell
$env:CARGO_TARGET_DIR = 'D:\workspace\self\magna-urbis\web\out\native-parent-dense-diagnostic-target-v1'
$env:PARENT_DENSE_RESTORE_PLAN = 'D:\workspace\self\magna-urbis\web\out\houses-native-parent-dense-diagnostic-workspace-v1\restore-plan.json'
$env:PARENT_DENSE_DIAGNOSTIC_OUT = 'D:\workspace\self\magna-urbis\web\out\native-parent-dense-diagnostic-proof-v1\dense-query.json'
cargo test --manifest-path web/out/houses-native-parent-dense-diagnostic-workspace-v1/candidate/rust/Cargo.toml -p magna-urbis-houses --lib native_parent_dense_query_original_0045_restored_prefix_diagnostic -- --ignored --nocapture
```

Source identity must use actual package/manifest/src/fresh=false artifact in this distinct target. No local/Wasm/Core target is needed. Restore plan SHA4c051faefb26f71d9591e3411bb76ac54d9c6585b6931c0fd2d09c4695b5ba21 is compiled into the test.

Custody: all45 response/archive/spool/ACK artifacts SHA-pinned; response SHA, opaque batch_json SHA and NDJSON archive SHA checked; per-parent encoded archive equals the corresponding response archive, in original native order. Geometry comes ONLY from canonical native lossless unpack, never decimal world view. The exact existing occupation_parts/skip-empty/make_leaf order is replayed; ownership is prior parent ordinal. No oldSingle actor/graph or requested programme is substituted. All six native index counters must match EACH original ACK, ending2,180parents/2,450members/9,768leaves/60,573vertices/11,841refs/2,550,024accountedbytes. restored-prefix.json records native lossless leaf-order digest and owner IDs. Only this 2D index persists; archives/parent native graphs are transient.

Then raw original Core0045 is decoded with the SAME scoped Std reader and original parcel_fit settings; both current cfg(test) growth modes explicitly true. No request/neighbors/source/seed/pose/guard/budget changed. Scope is private/test-only, no run/session client is resumed. The test expects the original dense-budget failure; PASS means reproduced failure, NOT fixed generation.

First failure export <=8MiB: current request ID and phase (necessary/static/path+base/final), query kind, actual geometry+losslessf64 copy, bbox, global prefix counters, accumulated/next/total bbox-hit leaves/polygons/vertices, and optional FIRST actual native intersection>.0001 witness from the bounded hit set. Additional diagnostic scan does not alter original query/result/counters. Bbox hits are not actual collisions. Inspect the summary/scalars first; do not dump the full geometry.

Next decision must use this actual trace. Candidate hypotheses: invalid outside-walk connector queries prefix before the old cheap physical refusal; or a dense clearly-colliding candidate could be rejected by a real intersection witness before an unnecessary union. No hypothesis is promoted to cause yet. No cap increase/truncation/actor drop/repartition/retry. A later correction requires unit negatives (cumulative small contacts and duplicate overlaps preserve UNION policy) and a NEW full132batch run after any targeted restore test.
