# Applied urban buildings in 2D and perspective

## Objective and inputs

Draw one accepted native architectural scene as SVG, Canvas and WebGL2. The
inputs are stable building/parcel IDs, metric footprints with holes, native
level elevations and heights, native roof faces, foundations, structural
features, and neutral material references. No camera, style or visibility
setting chooses a recipe or changes a placement.

## Coordinates and display geometry

Plan coordinates `(x,y)` and absolute physical altitude `z` become GL
`(x,z,y)`. A 256 m sector origin is removed before uploading horizontal
coordinates. Camera-relative offsets are supplied per draw. Display vertical
exaggeration multiplies both ground and building altitude; exported metres
remain unscaled.

Walls join the exact boundaries of each native level between `z_m` and
`z_m + height_m`. Open envelopes retain their native supports instead of
receiving artificial solid walls. Roof vertices and faces are copied from the
native roof builder. Foundations and support features are part of that scene.
Courtyards remain holes. Flat display caps use horizontal trapezoids split at
boundary vertex ordinates, paired by the even-odd rule; this is a small display
triangulation, not a parcel or architectural generator.

Housebench and the city call the same exterior SVG renderer and catalogue
material/pattern resolver. Native roof facets, ridges, roof groups and structural
features are preserved. Pattern definitions are shared once per scene. Previous
`geometric`/`cartographic` settings remain readable, but no longer introduce an
independent invented palette. Usage, entrance/refusal and physical-height
diagnostics remain independent choices.

## Picking, scale and resources

Picking intersects the same physical triangles using the double-sided
Moller-Trumbore barycentric test, then rejects hits occluded by displayed
terrain. A ray hit solves `O+tD=A+u(B-A)+v(C-A)` with `u,v>=0` and `u+v<=1`.
Display exaggeration is removed from the ray before testing metric triangles.

The pass indexes the retained instances into 256 m sectors and rejects sector
bounding spheres outside the camera clip planes before traversing native roof
faces or allocating GPU geometry. Buffers are prepared lazily, grouped by
catalogue paint and sector. Preparation yields between sectors after an 8 ms
budget; one sector can exceed that budget. Existing geometry stays visible
while a different LOD is prepared. Non-visible buffers are evicted by least
recent use above a 96 MiB target; visible geometry can exceed this soft target.

Let `w` be the sector's mean building width in metres, `f` the focal length in
CSS pixels, `d` the clip-space depth in metres, and `r` the bounding-sphere
radius. The approximate projected width is `p = w*f/max(1,d-r)`. Below 7 pixels,
native curved/faceted roofs use a coarse display cap on each native body
outline; above 10 pixels the native roof returns. The intervening hysteresis
avoids repeated switches. These are initial display thresholds, not a claimed
geometric error bound. The coarse cap retains holes and the exact maximum
physical height of each volume; it omits eave overhang and roof profile detail.
Foundations, levels and native structural features remain. It is a rendering
proxy, never a replacement architectural plan or an interior generator.

Picking first rejects sector and instance boxes, then intersects the same
native or overview triangles that were drawn. Scene identity, count, resolved
plans and physical heights do not change with camera or LOD. Buffer and vertex
array objects are released on eviction, scene replacement, context restoration
and disposal. This adapts spatial working sets and projected-detail selection
from Clark's hierarchical visibility work, without implementing its full
recursive hierarchy or general scene engine.

## Assumptions and limitations

This first pass uses simple diffuse shading and does not implement cast
building shadows, facade textures or a general scene engine. Native roof
faces are already triangulated or convex. Sparse high-detail terrain is a
presentation surface, never the source for architectural foundations. The
urban workshop retains the original physical terrain grid and delegates mesh
LOD to the terrain viewer; it no longer resamples the grid to 256 cells before
display. Terrain exclusions cover body and structural foundations. Large-city
transport uses deterministic bounded native batches and exact previous-batch
neighbours; capacity reconciliation sends only the capacity fields it reads.
The complete retained per-instance plans still consume memory. Neither these
changes nor a population field establish that a million-inhabitant scene is
validated; generation, transfer, rendering and navigation need measured stages.

## Reproduction and validation

In Urban, generate streets and parcels, then **Implanter les bâtiments**.
Inspect a building, toggle the independent diagnostics and **3D**, orbit the
same scene and return to 2D. Exported scene JSON retains physical metres.
`npx vitest run --project fast tests/urbanBuildingGeometry.test.ts` checks a
concave footprint with a courtyard, both ring windings, physical ray heights,
overview roof height/courtyard picking, structure ground exclusions and the
appearance/data boundary. `tests/architectureBatch.test.ts` checks transport
past the old 10,000-request cap, exact previous-batch neighbours and superseded
work cancellation. The integrated browser check records the
actual generated cases and console errors in ignored `web/out/`.

## Primary references and scope

- James H. Clark, *Hierarchical geometric models for visible surface
  algorithms*, Communications of the ACM 19(10), 1976, pp. 547–554,
  [original article](https://doi.org/10.1145/360349.360354). The sector working
  set and projected-detail selection above are a limited adaptation, not a
  reproduction of the paper's full geometric hierarchy.

- [SVG 2, fill-rule](https://www.w3.org/TR/SVG2/painting.html#WindingRule):
  even-odd interior semantics shared by the 2D paths and flat display caps.
- Tomas Moller and Ben Trumbore, *Fast, Minimum Storage Ray-Triangle
  Intersection*, Journal of Graphics Tools 2(1), 1997,
  [paper](https://my.eng.utah.edu/~cs6965/papers/MT97.pdf). The local adaptation
  is double-sided and uses the already generated native triangle soup.
- [Khronos WebGL 2 specification](https://registry.khronos.org/webgl/specs/2.0/):
  vertex arrays, depth testing and context/resource ownership. This viewer is
  temporary presentation code, independent of native generation decisions.


## Browser transfer and persistence

The in-memory Terrain to Settlements capture returns retained decor data directly.
It no longer compresses the entire city and immediately decodes it just to pass
the same data to history. Portable files retain the existing version-1 format,
GZIP level 6 and deterministic timestamp 0. UI history and downloads use fflate's
local asynchronous compressor; only the newly allocated file buffer is consumed,
never the retained raster buffers. The synchronous codec remains available for
existing batch tools. A regression compares both encoders byte for byte and
checks exact applied urban metadata and raster preservation after decoding.

JSON metadata is still serialized and parsed as one retained scene, so these
changes do not establish a bounded-memory representation for a million-person
city. History listing visits one stored record at a time and keeps only its
display metadata. A replaced scene worker is terminated before it can dispatch
another placement chunk; an already submitted native chunk may still finish.

Ground material SVG is prepared once per texture epoch and reused for all tiles.
Building subtrees are omitted before cloning, because native house geometry is
drawn by the separate physical 3D pass. This avoids cloning and discarding all
roofs for each material tile; it does not change either the ground or the houses.

## Accepted construction and canopy exclusion

The applied scene, independently of building visibility, supplies its physical
footprints, authorized circulation and structural-feature surfaces. These exact
polygons and their holes update the shared occupation raster. Class 7 remains a
general built reserve, where scattered trees are intentional; class 8 denotes
occupied construction and permits no tree or gallery. No bounding box replaces
a courtyard, enclosure or support footprint.

Interior texel centres use the even-odd fill. A two-dimensional grid traversal
also marks every boundary cell, including corner touches, so walls narrower
than one texel cannot disappear. This adapts the cell-stepping idea of
[Amanatides and Woo, 1987](https://doi.org/10.2312/egtp.19871000) to polygon-edge
coverage; it does not add a ray tracer. Cell width is
`max(0.5 m, occupiedSpan / (1536 - 16))`, with an eight-cell border. Boundary
coverage is conservative: it may clear up to one cell per coordinate outside
the surface. Courtyard interiors retain their original occupation except for
this boundary rim; features below the raster resolution cannot retain arbitrary
sub-texel detail. The cache key includes source, position, extent and mask bytes.

The shared forest shader rejects crown centres on class 8, including riparian
births. At an occupied fragment it returns the open-ground material before
nearby crowns, gallery paint or canopy shadows are evaluated. Thus crowns born
outside a construction cannot overhang it in the top-down material, perspective
or enhanced raster export. Class lookup is nearest-texel; camera and LOD never
change the applied scene or the mask. Detailed forest disabled still means no
resolved canopy; it does not change the accepted buildings.

Local browser validation used `urban-exclusion-v1`, a 128 m flat tile at 20 m
altitude, a dense canonical forest, a 40 by 64 m footprint with a 16 by 30 m
courtyard, a 20 by 6 m passage and an external 0.15 m wall. Of 9269 occupied
raster pixels, zero retained canopy alpha, versus 96.64% mean coverage before
exclusion. The retained courtyard still had 77.55% coverage; 129 wall pixels
were protected. The shared GLSL compiled and rendered without page errors using
Chrome SwiftShader. The versioned replay script is
`web/scripts/urban_forest_exclusion_ui_check.mjs`; its paired image is ignored
output at `web/out/urban-forest-exclusion/local.png`. This is a focused geometry/material
check, not a hardware-performance benchmark or a full city vegetation survey.
