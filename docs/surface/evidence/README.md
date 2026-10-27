# CPU and transport evidence scope

These reports measure transport of retained native plans and CPU preparation. They qualify neither rendering of the whole city, nor its FPS, nor live navigation. Source files were read without modifying the main repositories.

## Complete native city: 6,683 buildings

[native-city-6683-transport.json](native-city-6683-transport.json) covers the 6,683 existing architectural plans, 236,140 triangles and 39 materials. The source cache retained its SHA-256 `78b9a0eb1d19bb9c553dcf632af113f8e16c0cd32347e1bec93a889f78facd92`. The round trip was compared against the complete urban DTO, IDs, native floors and material catalogue, with exact equality.

| Transport case | JSON manifest | Typed payload | Total binary |
|---|---:|---:|---:|
| City alone | 13,567,344 bytes | 30,957,152 bytes | 44,524,512 bytes |
| City + 100,000 stress candidates | 16,557,231 bytes | 35,157,152 bytes | 51,714,400 bytes |

The manifest limit is **16 MiB = 16,777,216 bytes**. The second case passes with only **219,985 bytes** of headroom. The 100,000 candidates are synthetic transport input, not evidence of a generated physical population. This is an **urban-only** envelope: a complete terrain world, more metadata or longer candidate IDs may exceed the limit. Qualification of a full city-world packet cannot be inferred from this result.

The test with all comparisons took 14.319 s. Observed peak RSS is **1,488,461,824 bytes, approximately 1.49 GB**; this describes the validation process with multiple representations in memory, not packet size or a production memory-budget guarantee. Building and occupancy metadata account for 7,476,773 and 6,081,024 bytes respectively; these are leads for future reversible manifest reduction, without changing transport in this delivery.

## Cubic kernel and CPU preparation

[cpu-packed-sampling.json](cpu-packed-sampling.json) compares the old kernel with the optimised PackedFloat32 branch on an actual teacher refinement packet: 64 samples per side, source spacing 0.625 m, sourceLOD -6. Settled preparation remains **512 × 512, four Terrain3D regions**, with 256 alignment. The measurement gives 2,667.258 ms before and 2,437.241 ms after, or 1.094× on this run. Complete height and control images have identical bytes. Display spacing of 0.3125 m remains interpolation, not improved source resolution. No GPU was run for this benchmark.

Kernel parity was also checked on 4,048 points, seams and bilinear/cubic combinations, and 4,030 PackedFloat32 comparisons against the Array path, with NaN and infinities: zero double error and identical Float32 results. The representation retains the native Terrain3D 1.0.2 clamp of 0.25–100 m.

The old MIN256/one-region result is **withdrawn**: the CPU byte test did not establish `import_images` alignment. It must not be presented as a valid optimisation. The alignment fix is `7b0785a`; the exact PackedFloat32 optimisation is `dc11d36`.

Hashes of report copies and their LF-normalised hashes, stable across Windows/Linux checkouts, appear in [SHA256.json](SHA256.json).

## Next transport step, not implemented in V4

A reversible typed UTF-8 archive **per record** could move large metadata out of the manifest. IDs, native/proxy representation and bounds would remain accessible; other fields would be decoded on demand after culling. Archiving the whole city in one block would require parsing it entirely before selecting visible buildings.

Deduplicating floors or metadata should require **exact equality**, not a shared ID: accepted occupancy and a visual overlay may carry different states. UTF-8 columns with Uint32 offsets for candidate IDs are another option for reducing the approximately 3 MB stress manifest. Each change would require a versioned format, explicit memory bounds and round-trip tests retaining floors, materials, styles, opaque keys and source identities. Transport for this batch remains unchanged.

[Original French version](README_FR.md).
