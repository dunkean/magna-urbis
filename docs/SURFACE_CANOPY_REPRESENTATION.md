# Shared canopy coverage, canopy-r1

The renderer-neutral reference is `web/src/surface/canopyRepresentation.ts`.
The optional Godot adapter is `surface_canopy.gd` and its shared shader include
is `canopy.gdshaderinc`. Existing city mapper styles remain independent.

Canopy is the union of actual candidate crown discs, including every provided
tree which is excluded from geometry by rank, family budget or pixel selection.
No value-noise threshold is interpreted as physical cover. Counts and candidate
positions remain unchanged as the camera moves.

Four stable classes use representative radii `[2.5,4,5.5,7]` metres, selected by
nearest physical crown radius. Geometry and ground use the same per-pixel weight
`w=smoothstep(1.25,3,2*classRadius/footprintM)`. The footprint projects one metre
east and south on a common horizontal reference plane; both shaders use the same
view/projection, viewport and reference altitude every frame. It is a display
metric, not a source LOD or physical-resolution claim. Steep terrain away from
the reference plane is an explicit approximation of that metric.

Given selected-disc overlap counts `n[b]`, visible coverage is
`V=1-product((1-w[b])^n[b])`. Ground coverage is `(C-V)/(1-V)`, so the composite
`V+(1-V)*G=C`; overlap is included. Counts are never interpolated or mipmapped
before the powers. Instead the shader interpolates the resulting transmittances.
Coverage images use linear float values and linear mipmaps. Both ground and crown
albedo are linear `(0.055,0.105,0.036)`; the crown shader's `linear_tint` has no
`source_color` annotation. Main renderer shadow and exposure policies still apply;
this coverage contract does not claim invariant shaded radiance.

The 1024-cell atlas only covers the declared candidate query. It fades through a
C1 16-metre halo to the canonical mean `treeCover` outside that query. Selected
crowns must lie entirely inside the full-confidence interior. Unselected crowns
remain in the atlas. This avoids a square termination of the forest and avoids
claiming that a local candidate query instantiated all regional forests.

## Adapter contract

`SurfacePopulation.prepare(...)` returns `canopy` in addition to families and
counts. Family caps total 16,000 but reserve slots independently: tree10,000,
shrub2,500, boulder2,000, grass1,000, debris500. Tree records have `canopyClass`.
The worker builds `coverageImage` (RF with mips) and `countsImage` (RGBAF, no
mips). The UI only creates GPU textures and assigns uniforms:

- `canopy_enabled=available`; `canopy_coverage`, `canopy_counts` from those images.
- `canopy_origin=origin-currentWorldOrigin.xz`, `canopy_grid_size=gridSize`,
  `canopy_spacing_m=spacingM`, `canopy_fallback_blend_m=fallbackBlendM`.
- `canopy_bounds` is `(minX,minZ,maxX,maxZ)` rebased by the same origin.
- `canopy_reference_y` is the common display reference altitude minus origin.y;
  refresh for both terrain and tree/trunk materials whenever the camera changes.
- `canopy_linear_albedo` is linear RGB above. No sRGB conversion.

Terrain includes `canopy.gdshaderinc` and replaces the former noise canopy block
with `ground=mix(ground,canopy_linear_albedo,surface_canopy_residual(v_vertex.xz,
canopy_pixel_footprint(v_vertex.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE),state.r))`.
Tree crown/trunk materials use `canopy_instance.gdshader`; custom data is
`[sizeM,canopyClass,rank,1]`. The shader computes alpha every pixel, independently
of the preparation/replacement schedule. Crown tint uses the shared green;
trunk tint may use its own declared linear brown. Other families retain their
own representation. Do not use the old frozen per-replacement tree alpha.

## Validation and limits

Monte Carlo tests compare actual physical discs plus residual ground against
the unthinned union at three coverages, nine zoom footprints and 20% retained
geometry: mean error stays below two percentage points. Tests also cover
overlaps, excluded budgets, C1 halo, and interpolation after transmittance.

`godot --path viewer-local --script diagnostics/canopy_probe.gd -- --report FILE`
runs an actual OpenGL readback, including the spatial instance shader and two
geometric alpha crowns overlapping a third budget-excluded crown. On pinned
Godot4.7.2 / RTX5090, errors were 0.03–0.49 points at 0.25–9 m/pixel, 0.067 at12
and1.72 at40. This is an unlit coverage test, not a photometric forest benchmark.

The atlas discretizes physical discs, and blending local coverage to a regional
mean deliberately changes unresolved local statistics near the query boundary.
These are measured display approximations, not exact per-ray crown geometry.
At large footprints the coverage mip filter and analytic halo can spread/lower
a small isolated grove; the probe bounds that error for its fixture. Local tests
do not certify every perspective camera, every source coverage frontier or
temporal shadows. Full integrated viewer captures must validate those cases.
