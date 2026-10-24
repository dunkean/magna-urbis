# Native height batch: retained-chain budget repair

CPU validation passes for runtime `0d26dac`. This repairs the source-sample
ceiling that stopped V14 at its 40 m view. V14 remains a failed campaign; these
tests do not qualify a new campaign, image, navigation window or GPU path.

The logged failing child is 214² samples. Its six valid retained 512² parents
bring the total to **1,618,660**, exceeding the old 1,572,864 ceiling by 45,796.
The 160 m view had reached exactly the old ceiling. Removing parents would
change real source support, so the repair keeps every layer and every height.

`height-source-chain-2` permits at most **7,340,032 samples** (seven 1024² grids
in total). The 7-layer/domain maximum, 512 MiB input, 1 MiB manifest and 4096²
output bounds remain unchanged. The GD adapter checks the whole source chain
before allocating wire copies and supports cancellation between source layers.
Rust checks the chain before promoting controls, keeps the original ordered
f64 interpolation/seam/hole logic, and bounds its known numeric buffers plus
a 32 MiB metadata allowance at 384 MiB. This estimate is not process RSS or
renderer VRAM. The returned source counts, bytes, budget namespace and known
buffer estimate are checked by the adapter and evidence gate.

Validation includes:

- 3 Rust tests: full seven-grid limit, refusal above it and above seven layers,
  malformed input/source/hash/kernel checks, atomic output and known hole bits.
- 41 GD assertions: all RF and control bytes match scalar GD for eight cases,
  including the exact failing chain shapes and the seven-1024² F64 boundary;
  preallocation refusal, serialization cancellation, owned-process cancellation,
  timeout and cleanup are checked.
- 3 Node tests: historical small-chain evidence remains readable; expanded
  chains require the new checked metadata; malformed or excessive budgets fail.
- A retained-relief test uses the original V14 512² B-spline controls, unchanged,
  and queries them on the six logged regional grids. **All 262,144 output RF
  samples and control bits match scalar GD byte for byte**, including seams.
  All seven source buffers and the original retained packet remain unchanged.

The failed original 214² neural response body was not archived. The last test
is an explicitly derived **retained-control query fixture**, not recovery or
byte replay of that neural response, and adds no observed fine terrain. Fixture
construction took 5,022.854 ms, scalar reference 2,015.110 ms, and native total
520.421 ms in this local sample. Those are wall-time observations, not a latency
or FPS guarantee. Production does not derive new parent grids, prune parents,
coarsen the source or change source/physics/compiler/population identities.

Exact executable, source, code and payload hashes, measured cases and limits
are in [height-source-chain-budget.json](height-source-chain-budget.json).
The OWN executable hash differs from ROOT's separately rebuilt executable;
each build is pinned independently. No GPU or neural service was used here.

Reproduction from the worktree root:

```powershell
cargo test --offline --manifest-path viewer-local/native-height/Cargo.toml
cargo build --release --offline --manifest-path viewer-local/native-height/Cargo.toml
node --test web/scripts/surface_height_evidence.test.mjs
& $godot --headless --audio-driver Dummy --path viewer-local --script tests/surface_height_batch_test.gd -- $helper
& $godot --headless --audio-driver Dummy --path viewer-local --script tests/surface_height_chain_retained_test.gd -- $helper $retainedV14Packet $reportPath
```

Use the retained V14 `live-refinement.surfacebin` for `$retainedV14Packet`.
`$helper` is the rebuilt native executable's absolute path. Logs, temporary
process files and generated fixtures remain outside tracked source files.
