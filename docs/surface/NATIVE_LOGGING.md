# Native JSON logging modes

`--native-log-mode synchronous` remains the native viewer default. The fresh
source driver forwards `--viewer-native-log-mode synchronous|threaded` to each
native phase and records the requested mode. No source, rendering or gate option
changes with this flag.

The optional `threaded` mode serializes each event on the main thread, after
capturing its event clocks, and enqueues the completed immutable string. A single
writer uses FIFO order and the existing stdout file descriptor. Startup, capture,
interactive events and metrics share that sink. Godot engine headers, warnings
and errors are outside this application JSON ordering contract.

The queue admits at most 16 MiB of UTF-8 bytes including newlines and 8192 pending
messages, including the message currently being written. This is a transport
budget, not a claim about total resident String memory. It never waits for I/O
while holding the queue mutex. Overflow stops admission, records a rejection and
fails the native process; already accepted messages are drained, not silently
dropped. The test-only injected sink is never configured by the runtime CLI.

Main-thread `native-log-timing-1` keeps `serializeMs` and `printMs` in synchronous
mode. `native-log-timing-2` records `serializeMs`, `enqueueMs` and `mainWallMs` in
threaded mode. Writer statistics separately record actual `printWallMs`,
queued-to-print `queueWaitMs`, pending counts/bytes, high-water marks and rejected
messages. No enqueue duration is labelled as print time. Event timing history is
bounded to 512 entries; writer event buckets are bounded to 64.

`_write_metrics` flushes only when no input is pressed and the interactive
preview interval has expired. The writer snapshot precedes serialization of the
metrics event itself and therefore excludes that later line. `_exit_tree` closes,
flushes and joins before the native process finishes. These final waits can still
wait on OS output and are not promised to have bounded latency. Metrics-file I/O
and JSON serialization also remain on the main thread.

CPU validation exercises real stdout UTF-8 over inherited file descriptors,
message order, byte and message pressure, closed-state rejection, repeated
flushes, accepted-message drain after overflow, bounded statistics and clean
join/resource release. This is not evidence of improved navigation, a cause for
the historical stalls, or a global real-time performance qualification. A/B
navigation on the same retained source/session is a separate required proof.
## V13 A/B diagnostic: two strictly failed phases

The [compact report](evidence/native-log-modes-v13.json) retains the diagnostic run on `cf760322364c5efa94ad58bebecbfa2aeb40234b`, with **613 identical runtime hashes** and clean before/after snapshots. Both native processes exit zero and their timing/source criteria pass, but both phases remain **FAILED**: each contains the real `SCRIPT ERROR` in `SurfaceGroundResponse.expected_wire_dtype`, comparing a float JSON array index to a String. The later `e75e54a` fix and its successful CPU decoding do not retroactively change these verdicts. `diagnostic-complete` and supervisor exit zero mean only that collection finished.

A single fresh generation supplies the same 91,626,097-byte packet to both modes, in the same browser, context and session. Order is fixed: synchronous, then threaded. Caches may therefore be warmer on the second pass. Requests and displayed worlds differ slightly with input timing; this is not a causal comparison with identical requests. Both use Forward+ on RTX 5090, Dummy audio and the same PBR manifest. No experimental tree or grass asset flag is enabled.

| Diagnostic measurement | Synchronous | Threaded |
| --- | ---: | ---: |
| Nominal / actual movement | 20 / 20.006 s | 20 / 20.015 s |
| Maximum input gap | 0.302 s | 0.429 s |
| Distinct live worlds displayed during 20 s | 2 | 2 |
| First / second new display | 11.436 / 16.583 s | 11.653 / 16.921 s |
| Maximum main-thread `printMs` | 33.700 ms | absent, measurement moved |
| Maximum main-thread `enqueueMs` | absent | 0.033 ms |
| Maximum writer `printWallMs` | absent | 45.415 ms |
| Maximum writer `queueWaitMs` | absent | 42.743 ms |

The first two displayed responses are previews: native 30 m support with `decoderUsed=false`, then 0.9375 m with `decoderUsed=true`. Final native 0.46875 m support arrives during drain. These timing/source improvements never waive runtime-error checks.

The threaded writer snapshot reports **64 accepted and written, 0 rejected, 0 pending and no failure**, after the out-of-input flush. All 64 sequence numbers and event names exactly match the first 64 application JSON lines. The following `metrics` line is its own emission, excluded from the snapshot: **64 + 1 = 65 application lines**. The diagnostic script's `navigation-proof`, outside the viewer FIFO, brings the total to 66. Synchronous mode also produces 65 + 1 lines. Snapshot fields `closed:false` and `joined:false` are pre-exit; they are not relabelled as proof of completed joining. A later check of exact names and owned PIDs finds no survivors; it does not stop or inspect third-party processes.

`navigationFrameWallMs` comes from `all_frame_times`, which covers warmup, movement and drain after `_ready`, not only the 20 seconds of input. Its maxima of 3,630.672 / 741.844 ms are therefore neither a measurement of freezes during movement nor proof of 60 FPS. Reducing enqueue span does not prove physical I/O is faster. Fixed order, shared caches, different requests and the runtime defect prevent causal conclusions, artistic qualification or validation of a complete fresh campaign.

[Original version, including the French diagnostic](NATIVE_LOGGING_FR.md).
