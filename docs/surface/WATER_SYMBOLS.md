# Declared regional water symbols

`--water-mode source-map --water-symbol-width-px 1.25` requests a renderer-only
symbol around the retained source-water coverage. It is recommended as a regional
cartographic control for evaluation. The default is0, preserving the previous
unexpanded contour rendering and its sampling settings. The fresh-source harness
uses `--viewer-water-symbol-width-px 1.25` (the shorter name is also accepted).
Nothing automatically changes historical V8 artifacts or their verdicts.

This is an **all-water** symbol because the polygon coverage does not reliably
identify river-only boundaries. It neither constructs a centreline nor widens a
physical river. No source contour, triangle/index array, level, routing edge or
hydrological field is edited. Lakes and sea coverage receive the same symbol.

The module first bakes the original source triangles, then a separate GPU pass
places an antialiased disk of the requested screen diameter around nonzero
coverage samples. The finite shader uses exact texel fetches and a four-texel
radius limit; it adds no undeclared bilinear dilation. Source colors are retained
from a contributing coverage sample. This is a display recipe, not a measured
hydrological width or a physical water surface.

For a top orthographic map, screen metres per pixel is the actual camera width
divided by the viewport width. The nominal symbolic padding is half the requested
diameter times that scale. Projection overscan does not define screen scale.
An oblique projection can only use a declared ground-scale approximation with
this uniform texture-space operator; it is not a constant-width perspective
stroke. Camera scale, approximation policy and symbol width invalidate the cache.

Positive mode selects MSAA4 and a bake texel no larger than one screen pixel's
ground footprint. The padded bake is limited to4096²; a request needing more
fails instead of silently undersampling. Readback/coverage/final-mip image
workspace is estimated before allocation and capped at256MiB. Engine-owned GPU
framebuffer, MSAA/depth attachments, texture-cache entries and the rest of the
scene are additional allocations, not included in that image-workspace figure.

An important limit remains: a segment that receives no sample in the initial
antialiased source raster cannot be recovered by post-process dilation. A source
triangle count or geometric coverage total alone cannot establish pixel-level
network continuity. Actual regional images must be inspected and measured.

Diagnostics keep the original geometric source areas and missing-triangle counts.
They add `waterSymbolVersion`, policy, requested pixel width, screen scale and
scale policy, nominal padding, image budget, and separate source/symbol image
digests. `sourceGeometryUnchanged:true` and `symbolicPhysicalWidthClaim:false` are
required. Source geometry also has its own digest. Empty views still declare the
requested symbol policy and sampling plan, but do not claim an allocated image.

The evidence validator requires an explicit matching harness request before it
accepts symbolic coverage. It continues to reject source-vector omissions,
missing levels, budgets/fallbacks, source edits and roof projection. The symbol
area is never substituted for source area. Mode0 does not accept hidden symbols.

CPU checks cover dimensions, scale, image budget, invalid requests, cache
invalidation and negative evidence. `water_symbols_real_probe.gd` provides the
separate retained40km GPU control: original source triangles, production mode0,
requested1.25 mode and a layer2 roof. Its receiver and blue palette are controlled;
it does not qualify a new neural generation, Terrain3D, final styling or physical
water/bed consistency. See the accompanying report for whether that GPU control
has actually run; code availability alone is not a passing result.

The retained V8 40km GPU control passed on Forward+/RTX4090: mode0 produced
114,995 blue-classified pixels and1.25 produced141,730, a23.25% increase. Source
geometry/levels/arrays and geometric areas remained identical, with zero missing
triangles. At the actual roof interior,32 previously water-colored pixels became
zero water pixels. Bake costs were344ms and723ms respectively. The images were
opened: the regional network is easier to follow, but some thin branches remain
intermittent. This control does not establish complete network continuity or
artistic acceptance. Exact digests, dimensions and scope are recorded in
[the GPU evidence](evidence/water-symbols-v9-gpu.json).
