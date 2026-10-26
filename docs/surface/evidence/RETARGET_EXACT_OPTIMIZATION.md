The retarget optimization preserves the `surface-1.5.3` API, versions, identities and arithmetic results. It does not change resolution, filtering, geology, physical fields, layer roles or population rules.

Three repeated costs are removed:

- A private Float64 lookup table evaluates the existing sRGB transfer expression once for each of the 256 stored channel values. It introduces no approximation.
- Continuous interpolation reads four scalars instead of allocating a four-element array for every field. Its expression grouping and nearest-value fallback for non-finite corners are unchanged.
- Four-corner material sampling accumulates at most eight uint16 IDs in insertion order, then selects the first two with the existing weight/ID comparator. It avoids eight tuples, a Map and a sort per layer. The public generic `dominantMaterialPair` is unchanged. Low-cover alpha is still premultiplied, added left to right, then normalized; a fully transparent layer retains its original invisible fallback.

`retarget-exact-optimization.json` contains the complete comparison results and timings. The frozen reference was bundled before the edits from commit `83114a5aa977a996fcd47a713aef1c892b8a6b4d`. Both compared modules use identical esbuild settings. Every returned typed-array byte, object key, scalar, version, world ID and metadata field was compared, together with sampled surfaces. No timings were removed from a world object. Nine rejected inputs retain identical error constructor, name and message. The historical 6422 candidate records and fingerprint are unchanged.

The corpus covers mapped lithology contacts, four seasonal states, 33/128/512 grids, duplicate material IDs, ties, opacity 0/1/fractional, arbitrary transparent colors, NaN/Infinity fallback and unavailable legacy layers. The V11 retained request replays are actual 129/129/140 grids, including the final request for 512 capped by the source to 140. They reproduce original terrain/world/version summaries but are not archived original BODY bytes. The separately labelled 512 grid is synthetic.

In the five-repetition pass, direct retarget median wall spans were 217→134 ms, 208→120 ms and 243→142 ms for the three V11 replays; the synthetic 512 case was 2500→1361 ms. These are local synchronous Node calls, not an end-to-end browser result or a CPU-cycle measurement. Host contention was not controlled. A second three-repetition validation pass preserves two 512 outliers of 13.523 s and 13.733 s, with a private typecheck also running during that pass. The initial exploratory bundled-versus-TS timing comparison was biased and is excluded. These results do not explain or resolve the 9.485 s profiled browser span, its sampling gaps, delivery delays, GPU time or the strict 20 s navigation gate.

Reproduction from an unchanged checkout containing the correction:

```powershell
cd web
node scripts/bundle_surface_retarget_reference.mjs --revision 83114a5aa977a996fcd47a713aef1c892b8a6b4d --out out/surface/retarget-reproduction
node --import tsx scripts/benchmark_surface_retarget_exact.ts --baseline out/surface/retarget-reproduction/baseline.mjs --optimized out/surface/retarget-reproduction/optimized.mjs --out out/surface/retarget-reproduction/report.json --rounds 5
```

Add `--replay PATH_TO_VERIFIED_V11_PREVIEW_REPLAY` when the retained `preview-21-standalone.surfacebin`, `preview-204-standalone.surfacebin` and `preview-253-standalone.surfacebin` artifacts are available. The script never queries a service, registers a field or invents missing source inputs. Run it while other profiling work is idle.

Validation completed before the requested CPU quiet window: 25 existing tests across retarget, composition, layers and continuous ground; two new tests checking all 256 transfer values and 400 deterministic configurations across three layers. The private typecheck reports only the ten pre-existing missing generated WASM binding errors; no error references the changed files. No GPU or full campaign was run.
