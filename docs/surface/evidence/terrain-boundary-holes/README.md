# Terrain boundary: vertex-hole diagnostic

Standalone probe `viewer-local/diagnostics/terrain_boundary_holes_probe.gd` uses the minimal native Terrain3D shader, replacing only fragment colour to measure coverage and height error. No production file is modified. The control is a **synthetic flat fixture at 1,000 m**, not a replay of Magna V5 terrain.

The native shader transforms a vertex to NaN when its control has the “hole” bit. Any incident triangle may then disappear. A source rectangle ending just before a coarse vertex line can lose an entire band of triangles inside its bounds.

## Forward+ / RTX 4090 results

Vertical 40 km view, 2048² pixels; same 1024² height image, spacing 77.972412109375 m, import origin −39,921.875 m, 256 regions, mesh 32, 10 levels. Five pixel rows distributed across terrain are probed.

| Source half-width | Mask | Expected probes missing / 10,220 | Retreat from each edge |
| --- | --- | ---: | ---: |
| 19,960 m | Holes at out-of-domain vertices | 318 | 31–32 px |
| 19,960 m | Controls without holes + fragment discard at exact rectangle | 0 | 0 px |
| 19,960.9375 m | Holes at out-of-domain vertices | 0 | 0 px |
| 19,960.9375 m | Controls without holes + exact fragment discard | 0 | 0 px |

Imported height bytes are identical in all four cases. Height error encoded on present fragments remains zero. The observed 31–32 pixel retreat is approximately 605–625 m, comparable in magnitude to the sky strip reported in V5. However, the case exactly aligned to `256 * spacing` has no loss: the phenomenon depends on boundary phase.

## Comparison with real V5 parameters and limits

[v5-frame-phase.json](v5-frame-phase.json) read-only extracts world `72041dc7…` from `native-tour/stdout.log` and its recorded bounds. Its X/Z render origin is 20,038.9862060547 m, height image **2048²** and spacing 77.972412109375 m. Source bounds are 39.0625–39,960.9375 m; in this local frame they correspond to approximately −256.5 and +255.5 steps, with camera at −0.5 steps. Phase therefore differs from the aligned control.

The diagnostic proves the native mechanism and its possible magnitude. It **does not yet prove** the cause of V5's east ≈33 px / west ≈5 px asymmetry or a production fix. Any change must preserve the source-bounds contract, consider the union of parents and check nonlinear terrain at the edge; this planar control does not guarantee all boundary interpolations remain identical. No source offset, new terrain, control change or production shader is delivered here.

[Original French version](README_FR.md).
