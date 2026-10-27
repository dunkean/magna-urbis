# Intermediate terrain and material

This iteration bridges the gap between regional Render colour and PBR photographs at a few metres. DEM, hydrology and tree-placement fields remain retained. New details are deterministic appearance residuals conditioned by support, not erosion or vegetation-growth simulation.

## Terrain and mesh

`prepare_mesoscale.py` produces native RGBA32F context of 1334² cells: coarse/fine amplitudes in metres, fragment fraction and visible matrix cover. Rock, roughness and fragments strengthen relief; sand, snow and forest cover attenuate it. Amplitudes are bounded to 2.4 m and 0.6 m. Total residual remains bounded to ±3 m.

Four unit-gradient Perlin fields with 64 / 27 / 9.5 / 3.75 m cells are combined in two normalised groups. The 31-bit integer hash, world seeds and formulas are shared between GLSL and GDScript. Gradient gain retains the [-1,1] envelope. Coordinates do not depend on the camera. Gradients include bilinear amplitude changes and geometric-filter derivatives.

The 27 m band now receives massive rock, layered rock, fragment and soft-support profiles blended according to geology and weathering. A 150 m presence envelope gently varies amplitude. Their derivatives and the ±3 m limit are retained. See [Profiles, conifers and coastline](SUPPORT_SHORES_REFINEMENT.md).

The mesh remains a single 1334²-cell plane, with global hyperbolic-sine redistribution around the observed point. The transformation and inverse are continuous, including when focus is off-centre; edges remain exactly 0 and 40 km. Refinement arrives earlier: at the observed point, spacing at approximately 1.8 km view width changes from roughly 17.5 m to 2.1 m. At 160 m width it falls to about 0.6 m.

Each band leaves geometry when local spacing no longer resolves it (transition between six and three vertices per field cell). Material then reconstructs filtered normals per pixel. Macro and residual slopes are passed separately from vertices: interpolated residual slope is removed exactly before adding filtered physical slope, avoiding double relief and approximate cancellation of normalised normals.

## Water and elevation reading

Water protection combines native waters and the conservative maximum of 4K vector alpha. A sub-pixel river therefore does not disappear during reduction. The mask is dilated by one native cell. Amplitudes attenuate over physical distances around this protected footprint, then are strictly zeroed after all operations. The validator checks all native and 4K wet positions, not just a few cell centres.

CPU queries actually deformed triangles. Their node coordinates are rounded to float32 like vertices: this fixes rays exactly on an edge that could select the neighbouring cell with the float64 inverse. Vertical and culling bounds include the residual.

In close oblique view, an 8×8-cell block traversal eliminates areas definitely outside the ray. Bounds use the full footprint of required B-spline controls, expanded by the residual upper bound: they therefore bound every vertex, then its convex triangles. RF source rectangles are stored in a cache bounded to 8,192 entries. Candidate triangles remain tested exactly and compared with exhaustive traversal in the GPU test.

## Material and transitions

Intermediate computation is shared once per fragment:

- Physical fields slightly modulate colour and supply missing filtered slopes.
- Clump/fragment caps at 6 m and 1.75 m scales share height, normals, roughness and cavities. Hollows reveal earth. This modulation consumes only matrix: rock/fragment budgets remain intact. Mineral support view excludes cover clumps.
- On rock, oriented depressions of at most 10 cm use four fixed 48 m patches and local structure axis. Their height and normals share patch and weight derivatives. Their filter accounts for groove width, smaller than the 8×2.5 m carrier. This is material height and normals, not mesh displacement.
- A ±28 cm world warp uses the same Jacobian for UVs, derivatives and normals of all PBR maps. It is not interrupted at a zoom where photographs remain resolved.

Material filtering is tied to pixel footprint, fading to regional response between 8 and 24 m/pixel. The existing 4–24 m/pixel Render transition remains retained. Small details are applied before canopies, snow and ice; grain is attenuated beneath snow and water retains its own final response. Roughness compensation for unresolved detail is a bounded approximation, not a complete LEAN model.

## Preparation, validation and reproduction

After N1–N4 layers and `forest_placement.py`:

```powershell
python godot-render/tools/prepare_mesoscale.py
python godot-render/tools/validate_mesoscale.py
./Test-Render.ps1 -Check
```

`--tile mountains--temperate` limits preparation; `--workers 2` is the default. All 42 floating-point contexts occupy 1,195,861,632 bytes on disk, plus profile PNGs. Only the active tile is retained: 28,472,896 bytes of CPU context, 7,118,224 bytes of profiles and native RGB structure, with their GPU textures. Loading checks format, size, generator hash, DEM, geology, structure, N1–N4, placement, river and data. Missing, malformed or stale cache is cleared and disabled; it cannot reuse the previous tile's context.

GPU tests run with Godot and `--script res://tests/<name>.gd`:

| Test | Check |
| --- | --- |
| `meso_geometry_test` | CPU/GPU fields, complete gradients, water, invalid cache, off-centre focus, actual triangle height and accelerated/exhaustive picking |
| `meso_normal_test` | Final normals on flat terrain/constant context at five mesh/pixel transitions |
| `meso_material_test` | Grassland/sand/rock, temporal stability, Jacobian, normal transport, derivatives and fracture height |
| `meso_transition_test` | Orthographic and oblique zoom/pan round trips, second coastal terrain, local sub-pixel variation |

Reports and images are in `godot-render/evidence/`, outside Git. Existing tests continue checking snow, water, cover, 47 information layers, PBR palettes and navigation of all 42 tiles. Photographic repetition comparison isolates PBR by explicitly disabling new procedural material.

## Measurements of this iteration

Historical figures below compare this stage with commit `338efaf428ccd1f3aa6724c5749bf4f2f7fbb8ab`. The baseline preparer is now pinned to `69527c7` for the next iteration: see [Close-range rock](ROCK_CLOSE_DETAIL.md) for current measurements and commands. GPU protocol is ABBA, 30 warmup frames then 45 measurements per case, with identical camera, resolution, seeds and palette hashes. Measured times are GPU viewport times, not total application latency. Initialisation and file reads are excluded.

```powershell
python godot-render/tools/prepare_meso_baseline.py
godot --path godot-render --audio-driver Dummy --script res://tests/meso_benchmark.gd
godot --path godot-render --audio-driver Dummy --script res://tests/meso_picking_benchmark.gd
```

On RTX 4090 at 1280×800, profiles, conifers and waters of this iteration are compared with intermediate renderer `338efaf`. Palette hashes match across all four passes; levels and grid spacing are shared. Each value is the mean of medians of the two ABBA passes:

| Case | Baseline GPU median | Intermediate GPU median |
| --- | ---: | ---: |
| Grassland, full view | 1.68 ms | 1.83 ms |
| Sand, full view | 3.75 ms | 1.64 ms |
| Rock, full view | 1.73 ms | 1.88 ms |
| Grassland, 1.8 km width | 4.41 ms | 5.07 ms |
| Sand, 1.8 km width | 4.37 ms | 4.83 ms |
| Rock, 1.8 km width | 8.18 ms | 9.40 ms |
| Forest, 1.8 km width | 8.37 ms | 9.93 ms |
| Water, 1.8 km width | 4.01 ms | 4.49 ms |
| Grassland, 160 m width | 3.70 ms | 4.28 ms |
| Sand, 160 m width | 3.41 ms | 3.89 ms |
| Rock, 160 m width | 3.58 ms | 4.07 ms |
| Water, 160 m width | 3.14 ms | 3.31 ms |

At medium zoom, this iteration's overhead is 0.46–1.56 ms in these scenes, approximately 11–19%. Triangle count remains constant. The baseline full-view sand measurement is highly variable; its high mean must not be interpreted as a general performance gain. Per-pass details, P95 and palettes are in `evidence/meso-benchmark.json`.

Elevation reading is timed separately, with vertex cache cleared before each of five rays. In perspective at 1.8 km: median 1.98 ms (2.80 ms max), versus 1.77 ms (2.59 ms max) in baseline. At 160 m, cold queries remain more costly: median 7.77 ms and 14.52 ms max, versus 5.91 / 12.26 ms. Hierarchical bounds can be reused. These figures concern this hardware and scenes; they do not predict cost at every resolution or performance on another machine.

GPU triangle readback differs from picking by less than 2 mm over 24 top/perspective checks. HDR fields differ by less than 4 mm (probe half-precision storage). Round-trip zoom reproduces complete images exactly, byte for byte, in three sequences; measured sub-pixel movement remains below 0.012 at the 99th percentile of RGB channel changes.

[Original French version](TERRAIN_MESOSCALE_FR.md).
