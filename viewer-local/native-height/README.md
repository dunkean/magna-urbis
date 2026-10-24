# Ordered native height batch (explicit opt-in)

Build with the repository's Rust toolchain, independently of the other workspaces:

```text
cargo build --release --locked --manifest-path viewer-local/native-height/Cargo.toml
cargo test --locked --manifest-path viewer-local/native-height/Cargo.toml
```

Pass the resulting executable explicitly to the viewer:

```text
node web/scripts/surface_viewer.mjs --godot <Godot4.7.2> --world <packet.surfacebin> --height-batch <magna-surface-height-batch.exe> --top
```

The flag also supports oblique VisibilityPlan preparation. Without it TOP keeps the former GDScript path. Data uses the subprocess only for newly built residents of at least 262,144 pixels; resident reuse and ineligible cases are reported. Explicit executable failure does **not** silently fall back or substitute terrain. The previous rendered source is retained with a preparation failure.

This is a CPU sampler, not a terrain generator, neural decoder, texture resizer, service or GDExtension. The existing Rust hydrology B-spline is f32 and neural resampling is bilinear; neither implements the renderer's f64/parent-seam contract. This helper therefore implements that small scalar contract directly: the same double coordinates, shortened-last-sample rule, ordered sixteen B-spline products, nested bilinear interpolation, positive parent/child feather and nearest **real** source filler under hole bits. No fast-math, Catmull-Rom, invented support or source writes.

## Process and wire contract

Only the preparation worker starts the executable, with an argument array (no shell). Input/output are unique job files under Godot's writable `user://height-batch/` directory. The helper is silent on success; its result and timings are files, and errors are bounded stderr messages.

Input `MUHIN001` and output `MUHOUT01` each contain an eight-byte magic, little-endian u32 JSON/payload lengths, JSON and zero padding to eight-byte alignment. JSON floats use full precision. Input contains exact f32/f64 controls with contiguous typed descriptors and source/domains/kernel metadata. Output contains the RF f32 height plane followed by exact u32 terrain control bits (0 supported, 4 hidden off-source).

The input SHA256, opaque job and output payload SHA256 bind the response to the source world/version/context, source/scene epochs, origin/grid, optional visibility camera and executable SHA256. The receiver verifies lengths, job, dimensions and payload hash before creating Images. The executable refuses an existing output path and publishes success by atomic rename. No binary or fields of the original SurfaceWorld are modified, so there is no compiler/world version change.

Limits: source wire ≤512 MiB, JSON ≤1 MiB, ≤7 layers/domains, ≤1,572,864 source samples and output ≤4096² (128 MiB for both planes). Invalid lineage, kernel, dtype, footprints, nonfinite controls/RF values and no supported sample are refused. The helper's source/control memory and data-plane limits are distinct from the renderer's estimated working-buffer budget; neither is a whole-process RSS/VRAM guarantee.

The worker polls only its own subprocess. The existing cancellation token remains in charge: newly accepted, unrendered source jobs cannot be cancelled merely by camera activity. An eligible cancellation or timeout kills that owned process, waits a bounded interval and cleans only its job files. Default process timeout is 30 seconds, bounded to 10 ms…120 s for explicit test/configuration. There is no global process search or termination.

## Evidence scope

Six small CPU fixtures compare every output RF/control byte against GDScript, including f32/f64 B-splines, seams, disjoint domains/nearest ties, irregular last samples and ±1e9 rebasing. Separate tests exercise real owned-process cancellation/timeout and Rust boundary/atomic-output rejection. TOP default and explicit native output are compared with the frozen base's six Images/mipmaps.

The retained V12 4096² case compares **all 16,777,216 RF pixels and controls** to frozen `f20184e` GDScript. The measured Data preparation was 2.016 s native versus 105.863 s scalar; the earlier 114.914 s scalar result is preserved. These are local standalone wall-time samples, not isolated CPU-cycle measurements or an interactive QoS/FPS claim. The Rust `sampleMs` covers decode, tap preparation, ordered sampling and output digest; it excludes process/file transport. The latest release is also checked against the saved reference payload hash after production guard changes.

The retained source is not newly generated. Outside its small native 0.46875 m child, support remains the real 78.125 m B-spline parent. Filling a 4096² image adds no observed information. Full engine import, GPU rendering, streaming and artistic qualification remain separate gates. See `docs/surface/evidence/native-height-batch-cpu.json` for hashes, exact timings, binary provenance and caveats.
