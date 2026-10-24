# Native stdout diagnostic

The real V10 review invalidated the earlier interpretation of 11-second uploads: those were Node/CDP observation intervals. Godot had already received the packets in 1.685 s and 1.115 s. The V9 interval 13.928 s is also a driver observation interval, not an isolated Worker CPU duration. The separate direct Chromium Worker population speedup remains valid.

## Bounded harness correction

Tour, navigation and layer-probe processes now inherit actual stdout/stderr file descriptors. Node does not drain their output through pipes. Raw logs remain byte-exact; tour events are parsed after exit with an explicit observation label. Native ticks, captures, source checks and display gates are retained.

The deterministic control test blocks the parent Node event loop for 2 s while a child emits large UTF-8 stdout/stderr. The file-logged child finishes during the parent's pause with exact output SHA. The pipe control remains blocked until the parent resumes. This proves removal of the parent-drain dependency; it does not establish why the driver paused during V10.

## Same-session real navigation A/B

The diagnostic uses one fresh generated source, one browser/SSE session and one registration, then runs nominal 20 s navigation twice on the frozen ROOT 6cf2b8d/native f4 runtime. Only Godot output transport differs. Both retain the original quality gates. No tour or layer captures run, and no global qualification is claimed.

| Native observation | A: legacy pipe | B: inherited files |
|---|---:|---:|
| Current display gates | pass | pass |
| Live worlds actually displayed during nominal 20 s |1|2|
| Actual motion wall time |20.018s|20.019s|
| Reported maximum input gap |3.178s|2.004s|
| Maximum frame wall time |3146.971ms|2468.790ms|
| Maximum inferred interval before decode start |2866ms|20ms|
| Preview inferred intervals before decode start |1–2866ms|4ms|

The inferred interval subtracts the measured decode duration from native decoded/http ticks. It includes synchronous print and nearby setup; it is not a direct print timer. A did not reproduce the 10 s stall. The fixed sequence also changes neural-cache/coalescing history. This is therefore supporting evidence for robust transport, not a statistically controlled attribution of the internal Node cause. Multi-second pauses remain, and fluidity is not qualified.

PAGE clocks were enabled equally in both modes and saved afterward: 549 small events, zero dropped. Preview upload spans were about 0.19–0.37 s. Worker post-to-main-reception spans include browser scheduling; one near request took 10.546 s amid repeated PAGE long tasks. These spans must not be relabeled Worker CPU time. The recorded 140.7 MB initial context transfers still took 12.85 s/19.24 s.

See [native-stdout-navigation-ab.json](evidence/native-stdout-navigation-ab.json). Complete source packets, raw logs, metrics, PAGE rows, frozen runtime manifests and executed diagnostic script are retained under `web/out/surface/stdout-navigation-ab/` in the integration worktree. The actual script SHA and known differences from V10 are recorded. The new C timing/counter DTO was not retroactively applied to the old f4 probe.

Tests: `node --test web/scripts/surface_process_logs.test.mjs web/scripts/surface_page_timing.test.mjs`. The PAGE table is bounded at 4096 events and preserves buffer ownership and acknowledgement values. New runs additionally enforce `verifyNavigationTiming` with the new probe DTO.
