# A2 cache correction

A1all602inputs remain exact; root evidence `web/out/cold-city-derived-cache-first-proof` is preserved (69/70tests plus TS7006). New copy `web/out/cold-city-derived-cache-A2-workspace`.

Cause: optional lookup was still awaited when absent, inserting an extra microtask before native read startup. The existing invalidation case expects startup after its original one-microtask boundary; release therefore remained undefined, then its pending rejection had no assertion handler because the test had already failed. Fix conditionally awaits only the enabled lookup, retaining legacy startup, coalescing/cap/disposal behavior. All old test bytes unchanged; two added cases exercise enabled lookup coalescing and cap2 plus disposal while lookup resolves OR rejects, with no post-disposal constraint read. Two explicit callback types repair contextual typing lost under Array.isArray; guards and data are unchanged.

No tests executed by author. Exact source freeze/commands are in the new workspace. No production mutation or claim of bounded visual residence; B preparation is separately reserved.
