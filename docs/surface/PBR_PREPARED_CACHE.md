# Verified prepared PBR cache

The initial CPU/headless measurement of the real 15-material manifest took **6327.473 ms**. This exceeds five seconds, but does not establish the cause or dominant share of the roughly 50-second full viewer warmup. No GPU startup/render timing is inferred from it.

`MaterialLibrary.load_manifest` now optionally reuses prepared AH16F and NR8 Images, including **all existing mip bytes**, and the exact float32 linear mean. The pixel conversion, resize, packing, mip generation, neutral fallback, recipe/family bindings, shader configuration and path-independent asset digest are unchanged. Runtime `library.cache_stats` is separate from `asset_version` and `asset_digest`.

Default cache directory: `user://surface-pbr-prepared-v1`, outside the source asset directory. `prepared_cache_enabled=false` disables it; `prepared_cache_directory` is configurable for diagnostics. A cache directory inside the source manifest directory is refused. No source image/manifest is written.

Each logical asset has one final content record. Its key contains the existing pixel pipeline version, atlas dimensions, actual SHA256 of each of the four inputs, and the pinned Godot decoder version/build/OS. Paths and declared hashes do not substitute for actual input bytes. Inputs are rehashed after a hit or a cold preparation; a changed source prevents reuse/persistence of that record.

The wire record has strict dimensions/formats/mip lengths, a payload SHA256 and a checksum binding its key and fallback flag to that payload. Mean components are raw float32 bytes, not lossy JSON numbers. Missing, corrupt, incompatible or stale records rebuild from source. Source-height fallback still reports its original explicit flat material-height fallback and remains in the unchanged asset descriptor.

Writes use a separate temporary file and atomic replacement. An atomic directory lock serializes writers; a busy/stale lock simply stops writing while rendering proceeds. Known final/pending files are bounded together to **32 files and 512 MiB**, including the temporary write peak. Full cache, excessive directory scan, lock or I/O failure stops writes instead of evicting files. There is no recursive deletion or unbounded version directory growth. This is a disk-cache limit, not a renderer RSS/VRAM limit.

CPU validation compared the untouched frozen loader with a new cold cache and a warm cache over all 15 real assets. All AH/NR pixels, mipmaps, mean bytes, recipe/family bindings and asset descriptor match exactly. The repeated measured times were **6806.295 ms reference**, **7885.234 ms cold build/write**, and **2007.243 ms warm**, with 15 verified hits. Thus the cold build costs extra work; the warm component saves about 4.8 seconds in that run. These standalone timings do not qualify full startup, streaming or FPS.

Tests:

```text
Godot --headless --audio-driver Dummy --path viewer-local --script tests/surface_pbr_cache_test.gd -- <new-owned-cache-test-dir>
Godot --headless --audio-driver Dummy --path viewer-local --script tests/pbr_real_cache_parity.gd -- <manifest> <frozen-material_library.gd> <new-owned-cache-dir> <report.json>
```

The first real comparison had a test-only non-static hash call error; its negative log is preserved. After correcting the probe call, all 41 real comparisons pass with empty stderr. The smaller 18 checks cover exact bytes, key changes, payload/fallback corruption, atomic replacement, byte/file budgets and writer locking. No GPU was used. See [the compact CPU evidence](evidence/pbr-prepared-cache-cpu.json).
