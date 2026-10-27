# Declared regional water symbols

`--water-mode source-map --water-symbol-width-px 1.25` requests a renderer-only
vector outline of retained water polygons. It is recommended as a regional
cartographic control for evaluation. The mapper source-map profile defaults to
1.25 pixels; `--water-symbol-width-px 0` preserves the previous unexpanded
contour rendering and its sampling settings. The raw bake helper still defaults
to 0. Physical `source-levels` mode never enables symbols. The fresh-source harness
uses `--viewer-water-symbol-width-px 1.25` (the shorter name is also accepted).
Nothing automatically changes historical V8 artifacts or their verdicts.

This is an **all-vector-water** symbol because the polygons do not reliably
identify river-only boundaries. It neither constructs a centreline nor widens a
physical river. No source contour, triangle/index array, level, routing edge or
hydrological field is edited. Lake, river and hole boundaries are outlined.
The original sea-cell union remains fill-only when no sea contours were supplied;
the renderer never invents a shoreline from the sea raster.

Hydrology retains the clipped source rings in `PackedFloat64Array` XZ columns.
After the original triangle fill, a 2D pass draws those vector rings with closed,
rounded, antialiased Line2D strokes. World coordinates are subtracted in double
precision before conversion to renderer vectors. Two banks of a thin channel
overlap naturally, even if its fill received no raster samples. There is no
centreline extraction. A single declared fallback water tint is used for the
outline, without asserting an unavailable river/lake classification. This is a
display recipe, not a measured width or physical water surface. Clip-window
closing edges describe the data window, not surveyed banks.

For a top orthographic map, screen metres per pixel is the actual camera width
divided by the viewport width. The nominal symbolic padding is half the requested
diameter times that scale. Projection overscan does not define screen scale.
An oblique projection can only use a declared ground-scale approximation with
this uniform texture-space operator; it is not a constant-width perspective
stroke. Camera scale, approximation policy, symbol width, palette and the actual
Float64 contour bytes invalidate the cache.

Positive mode selects MSAA4 and a bake texel no larger than one screen pixel's
ground footprint. The padded bake is limited to4096²; a request needing more
fails instead of silently undersampling. Readback/coverage/final-mip image
workspace is estimated before allocation and capped at 256 MiB. Vector outlines
have separate limits: 500,000 points, 8,192 nodes, and a conservative render
workspace estimate capped at 256 MiB. An incomplete/over-budget contour inventory
cannot be used for positive symbol mode; mode 0 retains the original fill.
Engine-owned GPU
framebuffer, MSAA/depth attachments, texture-cache entries and the rest of the
scene are additional allocations, not included in that image-workspace figure.

Version 1 used post-raster dilation and could not recover a segment absent from
the initial fill raster. Version 2 strokes the original vectors before sampling.
It preserves source steps, intersections and data limitations; it does not repair
topology or establish flow. A geometric area total alone does not establish
pixel-level continuity. Actual regional images remain part of qualification.

Diagnostics keep the original geometric source areas and missing-triangle counts.
They add `waterSymbolVersion`, policy, requested pixel width, screen scale and
scale policy, nominal padding, image budget, and separate source/symbol image
digests, plus the contour hash, Float64 precision, counts, completeness, node and
workspace budgets. `sourceGeometryUnchanged:true` and `symbolicPhysicalWidthClaim:false` are
required. Source geometry also has its own digest. Empty views still declare the
requested symbol policy and sampling plan, but do not claim an allocated image.

The evidence validator requires an explicit matching harness request before it
accepts symbolic coverage. It continues to reject source-vector omissions,
missing levels, budgets/fallbacks, source edits and roof projection. The symbol
area is never substituted for source area. Mode0 does not accept hidden symbols.

CPU checks cover dimensions, scale, image budget, invalid requests, cache
invalidation and negative evidence. `water_symbols_real_probe.gd` provides the
separate retained 40 km GPU control: original source triangles, production mode 0,
historical post-only at identical fill sampling, vector 1.25 mode and a layer 2
roof. Its receiver and blue palette are controlled;
it does not qualify a new neural generation, Terrain3D, final styling or physical
water/bed consistency. See the accompanying report for whether that GPU control
has actually run; code availability alone is not a passing result.

The historical post-only control remains preserved in
[the version 1 evidence](evidence/water-symbols-v9-gpu.json).
The vector control passed on Forward+/RTX 4090: 182,735 bank samples were checked
at half-screen-pixel spacing, with a 3x3 visibility neighbourhood. All were visible
under vector symbols; 863 had been absent under post-only. All 13,392 newly
visible pixels lay within the independent two-pixel source-bank AA/filter band.
No sampling budget was exhausted. Mode 0 and the historical post-only reference
PNG bytes exactly match their earlier captures. Geometry, levels, arrays and
areas remained identical, with zero missing triangles. The roof covered 103
previously water-colored pixels; zero remained blue. Vector bake cost was 593 ms.
The images were opened and the recovered branches follow the original traces.
This is a bounded display control, not a survey/topology or production-style
claim. Exact digests and scope are in
[the vector evidence](evidence/water-vector-symbols-v9-gpu.json).

## Teinte des polygones non typés : option de comparaison

`--water-vector-tint source-classes` reste le défaut. Il conserve la couleur de
la grille de classes source et le fallback déclaré. Le mode explicite
`--water-mode source-map --water-vector-tint uniform` applique ce même fallback
aux remplissages des polygones retenus non typés et à leurs symboles de rive.
Il ne leur invente aucune classe rivière/lac. L'union de cellules de mer conserve
sa teinte de mer. Le harnais expose `--viewer-water-vector-tint uniform`.

Le DTO distingue un préfixe de vertices vectoriels et un suffixe de mer,
avec comptes explicites, bornés et divisibles par trois. L'option refuse une
partition absente, partielle, incohérente ou un fallback générique ; elle est
interdite en mode physique `source-levels`. Les cache keys et diagnostics
`sourceVectorTintVersion:source-vector-tint-1` distinguent les deux politiques.
Contours, niveaux, classes archivées, aire et support alluvial restent inchangés.
Ce choix harmonise une représentation ; il n'est ni une correction hydrologique
ni une preuve de débit. Sa comparaison GPU reste une preuve distincte.
