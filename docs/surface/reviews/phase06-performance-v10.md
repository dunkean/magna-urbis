# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Independent review V10: navigation blocking

# # Technical verdict

The V10 campaign remains **failed**. Artifacts involve two independent mechanisms. Neither comes from compilation, upload, decoding or validation.

1. **The two Godot freezes (10.53 s and 8.82 s) occur inside a synchronous `print()` on the main thread.** During exactly these windows, the Node driver, which reads the Godot stdout pipe, did not process any events. The “worker→upload” delays of 11.059 s and 9.777 s are therefore **driver observation delays**. The actual upload had already finished.
2. **Godot has only one preparation location, without preemption.** Re-preparations of the parent, triggered by the camera alone, occupy this location: 7.9 s, reproducible in V9 (7 948.651 ms). An accepted preview must wait, and an obsolete parent is still applied after a newer world is accepted.

Your numbers are all found in the artifacts, except two V9 values (13.928 s and 0.618 s) which I have not checked. On the other hand, the interpretation "upload takes 11 s" is **contradicted** by the data.

---

## 1. Proven sequence

### Facts, on native clock alone (stdout.log, metrics.json, navigation-report.json)

| native tick | event | source |
|---|---|---|
| 105262 | start of movement | `motionStartTickMs` |
| 106498 | gen4 applied; gen5 starts: parent, width 31200 m, `displaySamples` 128 | `preparationSnapshots`, `main.gd:708` |
| 109773 | last input sample before hole (4.511 s) | `inputSamples` |
| **109795** | `live-http-completed` #37 (9 347 316 o, `requestElapsedMs` 1685) | `main.gd:834` |
| ≈120322 | implicit start of decoding #37, i.e. 121222 − `decodeElapsedMs` 900 | `main.gd:855` |
| 120322 | input recovery (15.06 s); max frame 10 549.7 ms | `navigationFrameWallMs.max` |
| 121131 | gen5 applied (`prepareMs` 7925.9, parent, `liveSerial` 0); gen6 boots, still on parent | `main.gd:413`, `:708` |
| 121222 | #37 decoded **and accepted in the same ms** | `main.gd:696`, `:942` |
| 122729 / ≈122735 | HTTP #90 completed (1115 ms); decoding started (650 ms) | |
| 123353 | last input sample (18.091 s) | |
| **123385** | `live-packet-decoded` #90 (tick calculated before `print`) | `main.gd:696` |
| **132206** | acceptance of #90, i.e. +8821 ms | `main.gd:942` |
| 132277 | actual motion loop output (27.015 s) | probe |
| 132815 | gen6 (**parent**) applied after acceptance of #90 | |
| 134791 / 134792 | #129 decoded, then accepted 1 ms later | |
| 136864 | preview 90 finally rendered (gen7, 3448.6 ms) | |
| 140552 | final #129 rendered (gen8, 3190 ms) | |

**Location of freeze n°1.** Between `main.gd:834`, where `tickMs` is worth 109795, and `main.gd:855`, where `decodeStartedTickMs` is worth approximately 120322, it only executes:
- `print(JSON.stringify(http_event))` (`:837`);
- `_source_scene_lineage()` on a small structure (`:840`, `:1256-1258`);
- a copy of a small dictionary (`:854`).

**Location of freeze #2.** The path `:696`→`:942` took 0 ms for #37 and 1 ms for #129, against 8821 ms for #90. In both cases, `print` is the only call likely to block. This location is based only on the Godot clock.

### Facts, driver side (report.json)

| request | broker-terrain | compiled | ACKs recorded | total duration seen by Godot |
|---|---|---|---|---|
| #37 | 227271 | 228540 | 228766, **239483**, **239599** | 1685 ms |
| #90 | 240789 | 241627 | **251382**, **251404** | 1115 ms |
| #129 | 251693 | 252809 | 253134, 253160 | 1356 ms |

The broker only writes the response to Godot **after** the last block, and only then sends the final ACK to the browser (`surface_live_plugin.ts:92-107`). For #37, the entire chain (SSE, NN, compilation, 3 blocks, Godot download) therefore lasted in 1.685 s, while the driver saw it last 12.3 s. This argument does not depend on any clock comparison.

The driver timestamps the ACKs when Node processes the Playwright event `response` (`generate_surface_source.mjs:395-399`). The report does not contain **any** events between 228766 and 239483, nor between 241627 and 251382.

### Binding of clocks (by events, not by hypothesis)

The offset is calculated on the same request: start of the Godot request (tick − `requestElapsedMs`) against the `broker-terrain` observation by the driver.
- Values obtained: 119161 (#37), 119175 (#90), 119163 (#129), i.e. a difference of 14 ms between them.
- Resumption of Godot n°1: native 120322 ≈ 239483–239497 driver. The recorded ACK falls to 239483.
- Resumption of Godot n°2: native 132206 ≈ 251367–251381 driver. The registered ACKs fall to 251382.

**The driver and Godot become active again at the same time, within approximately 15 ms, twice in a row.**

### What remains hypothetical

- **Most probable mechanism: back pressure from the stdout pipe.** Godot writes in a pipe drained by `viewerProcess.stdout.on('data')` (`generate_surface_source.mjs:208-210`). If the Node event loop no longer reads, `print` blocks. This mechanism explains both observations, but the duration of each `print` is not instrumented. The exact rules for filling the pipe under Windows (buffer quota) are not measured.
- **Cause of the driver itself blocking: unknown.** Candidates, to be decided by the measurement:
  - H1: `console.log` of the driver (`:420`) blocks on its own stdout. On Windows, writes from `process.stdout` to a pipe are synchronous; it is enough that the parent process drains poorly.
  - H2: pause of the V8 garbage collector (heap swollen by the upload of 140 MB).
  - H3: CDP/Playwright processing of very large network messages.
  - H4: OS scheduling.
- A pause of the entire machine is hardly compatible with locating the freeze exactly twice in a `print`.

### “Parent preparation while a preview is accepted”: confirmed

- gen6, a parent camera re-preparation, starts at 121131, **91 ms before** the acceptance of #37.
- `_accept_packet` → `_begin_prepare` (`main.gd:956`) does nothing because `worker != null` (`:266`).
- #37 is never prepared: #90 replaced it before the slot became available.
- In frame 132206, #90 is accepted (`:697`) **before** gen6 is recovered (`:698-702`). gen6 then passes the water bake and application to 132815. `_apply_prepared` only rejects preparations older than what is **displayed** (`:301`), not what is **accepted**.
- gen5 (parent, 31200 m, height image 2048→1024) occupies location approximately 106.5k→114.6k: 7.9 s. It is identical in V9 (7948.651 ms), so it is not an artifact of the freezing.

**Estimate, not measured:** without the freezes, #37 would have been accepted around 110.7k, would have waited for the end of gen5 around 114.6k plus the bake, and would have been displayed around 118–119k, i.e. before 125262. It's passable, but fragile.

---

## 2. Main thread calls capable of blocking

**Inputs: blocking confirmed.**
- `print` to `main.gd:837` and `:696`.
- Same exposure for:
  - `main.gd:413`: `terrain-replaced` with the full snapshot and the provenance strings of several KB, repeated;
  - `main.gd:1339` (`view-satisfied`) and `main.gd:944`;
  - `push_warning`/`push_error` on the stderr pipe (`:846`, `:971`…).

**Inputs: bounded costs, not blocking here.**
- `_accept_packet` (`unpack_world`, `LiveBinding.rejection`, `_resolve_*`): ≤1 ms measured on #37 and #129. This **contradicts** the assumption of synchronous validation in Godot.
- `_apply_prepared` (`import_images`, textures, MultiMesh): `uploadAndObjectsMs` between 26 and 127 ms.
- `Thread.wait_to_finish` is only called when the thread is finished (`:692`, `:698`): no wait.
- Water bake: SubViewport 2048² in MSAA 2×, 3 frames plus `frame_post_draw`, then **synchronous readbacks** `get_image()` (`surface_water_projection.gd:92-95`, `surface_water_symbols.gd:55-57`). We observe approximately 0.5–0.8 s between recovery and application, distributed over several frames. It's not instrumented. As `water_projection_busy` blocks `_begin_prepare` (`main.gd:263`, `:707`), the bake delays the next preparation.

**ACK: no Godot or driver code is on their real path.** The path is browser ↔ Vite (`surfaceLiveUpload.ts:13-26`). The driver only **observes** the ACKs. On the page side, only the init script (`generate_surface_source.mjs:376-381`, `summarizeBinary`: `JSON.parse` from the manifest and copy of the heights from the parent) goes before the application listener. This is a plausible risk for large packets, but it is not in question in V10: the real chain lasted in less than 1.7 s.

---

## 3. Minimum measures, then limited corrective

### Short instrumented reproduction

Only the navigation-first phase: no tour, no layer probe. Same frozen runtime, same export and same real session, nominal duration of 20 s unchanged.

- **Godot:**
  - measure before/after each `print` (µs, bytes, event name) and store the maximum by type in the metrics, not in stdout;
  - measure each section of `_process` for any frame longer than 100 ms;
  - time each step of `ScenePrepare.prepare` (Data, Detail, Population, roads, buffers, hydrology, urban), because `surface_scene_prepare.gd:26`/`:91` only gives a total;
  - time the water bake (expected frames, ms of each `get_image`);
  - add `Time.get_unix_time_from_system()` next to ticks to link clocks.
- **Driver:**
  - `monitorEventLoopDelay` and a heartbeat every 50 ms written by `fs.writeSync` in a separate file;
  - a `PerformanceObserver` on the GC;
  - the timestamp and size of each `data` block received from Godot;
  - the duration of `console.log`.
- **Browser:** timestamp in the page the reception of `compiled` and the sending and ACK of each block, with transmission afterwards.
- **Broker:** timestamp the reception of each block and the end of writing the response to Godot.
- **A/B on a single variable:** (A) like V10; (B) Godot's stdout and stderr redirected to **file descriptors** (`fs.openSync`), without going through the Node loop. The mechanism is confirmed if A shows more than 8 s spent in `print` and B eliminates these long frames.

### Fix A: stdout coupling (to be done first)

- **A1, harness.** This is a measurement environment, the criterion does not change. Launch Godot with `stdio:['ignore',fd,fd]` in navigation and for the layer probe: these two phases already reread the files afterwards (`:210`, `:278`). The tour can parse the file on output.
- **A2, product.** On the interactive path, only emit compact events (ids, serials, ticks, `prepareMs`). The full snapshot already exists in `render_events`/metrics. Keep the `capture` events, emitted outside of movement, intact. A Windows console in Quick Edit also blocks `print` in real use.

### Fix B: Bounded preemption of staging location

- A cooperative cancellation token, tested between stages of `ScenePrepare`. Cancellation is allowed **only** for a camera re-preparation of the already displayed world (`worldRevision == rendered_revision`) when a more recent revision has just been accepted.
- Same rule in `_complete_prepared` before the water bake.
- Immediately follow `_begin_prepare` on the most recent world.

**Invariants to preserve:**
- never cancel the preparation of a world accepted and not yet displayed, which avoids a livelock faced with a flood of previews;
- the displayed snapshot remains intact in the event of cancellation;
- the most recent world is prepared **with its heights**;
- lineage checks remain unchanged;
- the inventory and densities do not change;
- the counters `cancelledSuperseded` and `skippedCameraRefresh` only increment at a checkpoint actually reached;
- `render_events` is populated only by `_apply_prepared`.

Only then measure why gen5 takes 7.9 s, from the times per step. I do not suggest blind optimization.

### Fix C: honesty of the proof (without lengthening the test)

- `navigation_probe.gd:105` calculates `duration − last sample`, which **hides the second hole of 8.924 s** (18.091→27.015). Add `actualMotionEndTickMs` and a hole measured in real time, keeping `motionEndTickMs` nominal, which `generate_surface_source.mjs:219` checks.
- `liveAppliedSerial` and `motionLiveApplicationCount` (`navigation_probe.gd:35`, `:79`) count **acceptances** (`main.gd:939`). Example: `motionEnd.liveAppliedSerial` is worth 90 while `rendered.liveSerial` is worth 0. They must be renamed “accepted”.
- `cpuScriptMs` excludes the 30 frames which follow each application (`main.gd:711`, `:753`), therefore precisely the expensive frames.
- The “worker→upload” delay must be calculated with the browser or broker timestamps, not with those of Playwright.

---

## 4. Ranking

**Confirmed defects**
- Freezes of 10.53 s and 8.82 s located in `main.gd:835-854` and on the path `:696→:942`, around a synchronous `print`.
- “Upload 11.059 s / 9.777 s”: this is an artifact of driver observation, contradicted by `requestElapsedMs` (1685 and 1115 ms) and by the order of the broker's writes.
- Single preparation location without preemption: gen6 parent applied after acceptance of #90, #37 never prepared, camera re-preparation of the parent of 7.9 s reproducible (V9 and V10).
- The second hole of 8.924 is hidden by the probe.
- “Application” counters actually count acceptances.

**Plausible risks**
- Synchronous readbacks of the water bake, and `water_projection_busy` which delays the next preparation.
- `_physical_lineage` → `city_identity(packet)` → `hash(packet.urban)` on the main thread on each call: `_cityIdentity` is placed on `world`, not on `packet` (`main.gd:1269`, `surface_geometry.gd:32-34`). Unmeasured cost; the p99 of 51 ms limits it.
- `summarizeBinary` of the harness placed on the critical path of the page.

**Unmeasured assumptions**
- The internal cause of the Node loop blocking (H1–H4).
- The exact mechanics of the pipe quota.
- The distribution of 7.9 s of gen5 between stages.
- The estimation of a display from #37 to 118–119k without freezes.
