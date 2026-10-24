# Exact source hydrology memoization

The [V11 CPU attribution](NATIVE_V11_CPU_PROFILE.md) measured repeated archive
JSON decoding and validation of the same immutable water classes. The adapter
now memoizes those two pure operations, independently of display preparation.

- One geometry JSON attachment is keyed by exact copied `PackedByteArray`
  contents, not a scene ID or hash alone. The existing 64 MiB encoded-input limit
  remains before cache lookup. The decoded dictionary is private read-only input;
  translation creates new points, and clipping/sweeping consume those new arrays.
- One successful byte-class predicate is keyed by an exact copied class column.
  Other sequence types keep the original element-validation loop. The production
  shape check bounds this copied byte column to 4096² bytes.
- Mutexes protect lookup/replacement. JSON decoding occurs outside the lock.
  Only one geometry and one class entry are retained. Decoded-object memory is
  additional; no measured RSS budget or allocation speedup is claimed.

Grid shape, width, origin, levels, source-to-world translation, source class
semantics, clipping, sea union, source-point/vertex/work budgets and diagnostic
generation remain evaluated on every call. There is no cache of a mesh, clipped
contour, water level, frame, hydrological network or spatial result. A common
translation therefore never requires editing or reusing translated source points.

[CPU evidence](evidence/hydrology-source-cache-cpu.json) contains 51 passing checks:
all buffers, image bytes, metadata and rejection/fallback outputs match the frozen
adapter, excluding only elapsed `buildMs`. Cases include cold/hot repetition,
alternating ±1e9 m frames, a one-byte source edit under the same ID, changed valid
and invalid classes, malformed sizes/origin/width/JSON, absent levels, non-byte
fractional classes, cavern ambiguity and the 500001-point source budget rejection.
Original source data remain unchanged. Real retained V11 previews21/204 are also
compared; their clipped near outputs are empty, while the authored cases exercise
non-empty mesh/contour outputs. Five existing CPU hydrology tests also pass.

A separate 12-call profile on the retained near21 source measured 976 ms cold,
then 636–674 ms hot (median 644 ms). JSON decode went from 175 ms to about 0.4 ms,
class validation from 147 ms to about 0.19 ms. Remaining clipping, sea construction
and class-image work is unchanged. These headless times are not concurrent V11
runtime measurements and do not establish a navigation-gate result.

The first comparison run also contains an **unattributed 8289 ms hot-call outlier**
after the large source-budget stress case. Every timing row is retained; the
separate repeat did not reproduce it. No GC, OS or cache-causality claim is made.
V11's strict FAILED result remains unchanged, and the independently investigated
browser/Worker delay remains a separate issue.

To reproduce the parity tests, preserve the pre-cache adapter (SHA256
`827a864e8d0b26d91c44b12190efc9ae67e039311e283ee1139fe9275b1a8790`), then run:

```text
Godot --headless --path viewer-local --script tests/hydrology_source_cache_test.gd -- <frozen-surface_hydrology.gd>
```

For the real replay comparison, additionally pass the saved V11 initial packet,
reconstructed preview21, preview204, navigation metrics JSON and output report
path, in that order. For the isolated sub-phase repeat, first generate private
instrumented copies using `diagnostics/make_native_prepare_profile.py`, then run
`diagnostics/hydrology_cache_replay_profile.gd -- <the CPU profile config.json>`.
Neither diagnostic requires a GPU, fresh generation or a modified source packet.
