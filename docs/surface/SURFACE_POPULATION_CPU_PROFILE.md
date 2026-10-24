# V9 population worker CPU profile

The failed V9 navigation remains failed. Its first large preview had a 13.928 s interval between the neural tile response and the worker result. Its 9.35 MB upload completed 618 ms later. A near preview spent 563 ms in that interval; the following final request spent 461 ms. The earlier 140.66 MB warmup/context packet took 19.503 s between compilation and completed upload, a separate cost.

A CPU replay from the actual retained V9 canonical fields isolates the expensive family-page generation. The 4 km tree page scans roughly 1.3 million potential slots to retain about 64,000 trees, plus nearby family records. The patch preserves every random key, arithmetic expression, accepted record and order. It computes FNV-1a of the stable ID prefix once per slot, appends the same one-digit channel byte, and applies the same avalanche. It avoids repeated hex-string conversions. Eligibility reads only slope and the one family potential needed by that slot, preserving nearest category checks and the same finite bilinear fallback. No population recipe/version, densities, ranks, budgets or inventory extents change.

The recorded comparison verifies all candidate records, page metadata and complete encoded packet fingerprints. Existing 206 surface tests pass, including historical population fingerprints. See [v9-worker-population-profile.json](evidence/v9-worker-population-profile.json). These are Node CPU measurements; browser/native acceptance requires the next independent campaign. The original large-context transfer, neural tile latency and native preparation are not fixed by this patch.

Reproduce in a private checkout; do not change a shared repository to obtain the baseline:

```powershell
cd web
npx tsx scripts/benchmark_surface_population.ts --source-dir <native-e2e-40km-v9> --pages-module <baseline-ab3c499>/web/src/surface/candidatePages.ts --out <before.json>
npx tsx scripts/benchmark_surface_population.ts --source-dir <native-e2e-40km-v9> --out <after.json>
npx vitest run tests/surface
npx tsc --noEmit
```

The source directory supplies the archived `live-refinement.surfacebin` and `fresh-source.surfacebin`. Child support samples are resampled from the same parent only to exercise transport/retarget paths; they are explicitly not new neural terrain. Input SHA hashes and output record/page/packet fingerprints are persisted by the benchmark.
