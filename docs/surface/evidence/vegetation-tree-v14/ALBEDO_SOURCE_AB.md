# Source V13 / ground-response artistic control

Four sequential GPU runs compare the old exported tree asset with the corrected
[sRGB product](../vegetation-tree-v13/ALBEDO_ENCODING.md), under the **same** native
consumer, camera, source and lighting. The isolated worktree starts from frozen
ROOT`6ef8d3c`, retaining its real canonical ground-response bindings. It adds the
transformed-support high selection and albedo provenance metadata. ROOT itself
and its V13 campaign remain untouched. These are controls for a future V14, not a
relabelled full campaign.

The packet is ROOT's retained V13`live-refinement.surfacebin` (76,589,841bytes),
world`e75bf305b8cbe68b9247d835dce25759`. Its complete480m tree page covers both
TOP views plus their guard. The original local40m fine grid and real parent are
unchanged. Canonical ground-response is available and comes from the original
512²/78.125m parameter grid, native39.0625m; it is not newly observed fine soil.
No generation, registration, height or candidate change is made by these runs.

[source-albedo-ab.json](source-albedo-ab.json) records commands, source/manifest
hashes, actual native runtime hashes **before and after each run**, physical/GR
fingerprints, actual instance buffers, layer images, component hashes and raw logs.
The native HEAD is`ead9d56`; the small diagnostic-only wrapper was untracked during
the captures and is explicitly included in the runtime hash map. No production
WIP is hidden under a clean-snapshot claim.

| View | Same selected products in old/fixed | Result |
| --- | --- | --- |
| TOP40m,2048×1280 | 6high /805,770triangles +20impostors | Visible high foliage changes from erroneous dark RGB to the pinned source response |
| TOP160m,2048×1280 | 402impostors, no high | Entire all-layers PNG is byte-identical |

The steady global phases are1.7833313375 and1.7560139570 respectively: exact optical
weight1, partial geometry transfer. They are not reported as phase2. The high
budget remains below2Mtriangles and no retained candidate is dropped. Centre-based
counts remain separate from support intersections and GPU coverage.

For **both** widths, terrain, parent, ground, canonical context, geometry detail,
GR and inventory fingerprints match. Actual population transform buffers match.
Coverage, selected counts, normal and color **atlas image bytes** match exactly.
The aggregate atlas/asset digest changes legitimately because the imported GLB
and renderer asset identity change; this is not mistaken for a C/V source change.
No-trees/ground central pixels match exactly. The correction changes only high
tree albedo. Grass assets are disabled in both profiles to isolate it, so the small
legacy low-cover prisms visible in these controls are explicitly unchanged.

Actual adapter: RTX5090, Forward+, Godot4.7.2 / Terrain3D1.0.2, Dummy audio. All four
runs completed without shader/runtime errors; the existing Terrain3D deprecated
interpolation warning remains. Process durations include loading and five captures,
not FPS. No new performance or full-navigation gate is claimed. All owned Godot
processes exited and the GPU was released for the oblique-plan work.

- [TOP40 old asset](40m-old.png)
- [TOP40 corrected RGB](40m-fixed.png)
- [TOP160 unchanged impostor control](160m-control.png)

The images were opened. The large close-tree darkening is visibly removed; this
does not certify complete artistic quality, normal/roughness parity under arbitrary
light, or oblique depth. The separate diagnostic still reports a29° normal
difference and a hardcoded impostor roughness0.9 versus source mean0.4755. The
new corrected cache is separate from the preserved V13 negative cache and should
be copied into a new destination rather than overwriting it.

Reproduce with `web/scripts/surface_tree_color_gpu.mjs`, passing `--godot`, `--world`,
`--assets`, `--old-tree-assets`, `--fixed-tree-assets` and `--out`. The diagnostic
wrapper adds immutable atlas component fingerprints to the existing five-image
layer probe; it does not modify production shading or source data.
