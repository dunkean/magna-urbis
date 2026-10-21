# Render3DBrush: biome brushes in the forest material

Render3DBrush (`style=render3d-brush`) replaces the analytic crown silhouettes
with the existing Fantasy watercolor artwork. It retains Render3D's ground,
water palette, forest control field, clearing controls, applied occupation,
world-space crown candidates and distance filtering. It changes display only.

## Artwork and tint

`web/scripts/pack_forest_brushes.mjs` derives 32 layers from the existing Fantasy
runtime sheets: eight pines, eight broadleaf trees, eight tropical motifs and
eight cypresses. Each layer is 128 by 128 texels with a transparent gutter.
The RG8 channels contain alpha coverage and luminance centred on that sprite's
alpha-weighted mean. Original hues are discarded. The material multiplies its
existing climate/stand/crown colour by this luminance, retaining the Render3D
palette rather than the Fantasy watercolor palette.

The packed asset is compressed once, bundled locally and decoded synchronously
on first use. It needs no network fetch, image decoder, DOM images or worker
messages. The texture array occupies about 1.33 MiB including mipmaps, once per
rendering context; the compressed source is about 425 KiB (567 KiB base64).
Original Fantasy assets remain intact. Regenerate with:

```sh
cd web
node scripts/pack_forest_brushes.mjs
```

## Selection, placement and LOD

The canonical forest field supplies cover, potential height, needleleaf fraction
and stand tone in metres. The same seeded crown hash selects a motif and a
horizontal mirror. Needleleaf probability selects pines, other temperate trees
use broadleaf motifs, warm wet stands use tropical motifs, and warm dry stands
mix in cypresses. These are illustrative families, not species predictions.
Motifs retain their original orientation; arbitrary rotations would invert
the illustrated trunks. Their square support is bounded by the same 3 by 3
crown neighbourhood.

The two world-anchored crown lattice levels are retained. A texture-array
lookup replaces the analytic outline; centred brush luminance replaces the
trigonometric leaf-cluster detail. Crown selection, scale and height are fixed
from the field sample at each crown centre. This avoids fragment-dependent
cuts and isolated slivers when occupancy changes across an illustration.

Brush motifs already contain oblique contact shading. Projecting a second copy
of their silhouette created detached, repeated tree shadows; that extra shadow
probe is disabled for Brush. A shallow (25 %) analytic normal retains volume
and the source luminance provides its fine painted detail. The circular litter
halo is also disabled for Brush. Analytic Render3D keeps softened cast shadows.
Explicit texture LOD follows pixel footprint / motif size. Each array layer
owns its complete mip chain, avoiding neighbouring motif bleed. Unresolved
crowns blend into the same stand/forest mean as Render3D, so distant views do
not stamp thousands of unreadable tiny icons. Brush crown visibility grows
between 2 and 5 pixels of radius (analytic crowns use 0.9 to 2): illustrated
trunks and alpha holes need more pixels than an analytic shape. Patch contrast
follows the same visibility, avoiding a tiny regular dot pattern at mid range.
The map, perspective material
and raster export use the same shader and packed artwork.

The texture-array and mipmap operations follow the
[Khronos WebGL 2.0 specification](https://registry.khronos.org/webgl/specs/2.0.0/).
This is an adaptation of ordinary filtered texture sampling to the existing
forest material, not a neural texture synthesis method or a billboard mesh.
The forest field and analytic distant mean are described in the bundled
Render3D vegetation note.

## Distant clearing contrast

Both Render3D styles soften the 56 m procedural stand threshold when crowns
become unresolved: minimum patch contrast is 0.18 instead of 0.45, and threshold
feathering grows to 0.16 in the normalized coverage domain. At resolved crown
scales it returns to a narrow 0.015 feather. Applied fields and settlement
boundaries retain their independent signed-distance mask. These display
changes do not fill the canonical clearings or change their geographical
location.

In arid climates the riparian distance scale and strength vary along channels
with seeded world-space noise. Unresolved sparse cover tapers continuously
towards its square, so its outer fringe is finer at distance. Near-view cover
is retained. Both styles allow resolved crowns to overhang actual water while
rejecting tree centres in it; contour lines are composed last. The distant
analytic forest mean never masks the river. Raster exports carry the same
resolved crown alpha as an inverse mask on the water-only group.

## Limits and validation

These are flat, gently oblique Fantasy illustrations sampled on the terrain,
not upright 3D trees. Their silhouettes and holes differ from the circular
coverage model used to calibrate Render3D's density lookup; local visible
coverage can therefore differ, particularly for narrow cypresses. They share
the same far mean. Baked artwork detail does not relight like scanned canopy
geometry. The tint preserves the palette, not exact per-pixel brightness.

Performance must be compared on the same terrain, field, camera and GPU.
The implementation retains one forest material pass and the same candidate
neighbourhoods, with one canonical centre sample per candidate and fewer shadow
probes for Brush. Actual water is prepared before the forest material. This
alone is not proof of equal frame time. Cold driver shader
compilation and atlas upload are separate from steady-state draw time.

Measured on RTX 3090 / Edge ANGLE-D3D11, 1024 by 768, synthetic 40 km terrain,
source 256 squared, forest 1024 squared, seed 428019; 1.2 s warmup per view and
median of seven `EXT_disjoint_timer_query_webgl2` samples:

| Climate (annual Celsius / mm) | Brush, 4 px/m | Render3D, 4 px/m |
|---|---|---|
| Temperate (18 / 1000) | 1.38 ms | 1.96 ms |
| Boreal (3 / 650) | 1.40 ms | 1.84 ms |
| Mediterranean (16 / 500) | 1.35 ms | 2.04 ms |

These are material fixtures, not whole-application performance guarantees.
A separate 12 km straight-river desert fixture (23 C / 150 mm, seed 728311)
measured Brush at roughly 2.1–4.9 ms versus analytic 2.5–10.4 ms across three
views while other validation was running; those absolute timings are load
dependent. In both comparisons Brush stayed within the analytic renderer's
draw budget. Cold program compilation in fresh browser contexts took about
60–93 s and remains a substantial startup limitation.

Validation also covered the actual six-pin shared map, retained SVG water,
perspective, the offline bundle and both raster styles. Overlapping raster
crops have zero RGB or crown-alpha differences; a browser SVG fixture confirms
that only water pixels change under the crown mask and contour ink remains
above both. Three seeded CPU regressions check water-buffer independence,
sea/disabled exclusions and variable arid riparian width.
