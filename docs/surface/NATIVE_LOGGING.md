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
