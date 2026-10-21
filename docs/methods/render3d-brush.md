# Render3DBrush: biome brushes in the forest material

Render3DBrush (`style=render3d-brush`) replaces the analytic crown silhouettes
with painted watercolor sprites: overhead tree crowns and low shrubs. It
retains Render3D's ground, water palette, forest control field, clearing
controls, applied occupation, world-space crown candidates and distance
filtering. It changes display only.

## Artwork and tint

`web/scripts/pack_forest_brushes.mjs` packs 48 layers, eight variants per
family: pines (0), broadleaf (1), tropical (2) and dry-climate trees (3) from
`families/canopy-overhead.png`, a dedicated atlas of crowns seen from almost
directly above; temperate shrubs (4) and dry scrub (5) from
`families/shrubs.png`, wide low bushes without trunks. Both sources and their
generation prompts (`*.prompt.md`) are stored beside them. The packer trims
each cell's transparent margin before normalising the sprite to 128 by 128
texels, so the source gutter cannot shrink a crown's world diameter. The RG8
channels contain alpha coverage and luminance centred on that sprite's
alpha-weighted mean. Source hues are discarded: the material multiplies its
climate/stand/crown colour by this luminance, retaining the Render3D palette.
The original Fantasy side-view sheets remain intact for the Fantasy styles.

| Family | Mean alpha of the frame | Alpha extent | Area-equivalent diameter |
|---|---|---|---|
| pines | 0.524 | 0.93 | 0.82 |
| broadleaf | 0.579 | 0.94 | 0.86 |
| tropical | 0.589 | 0.93 | 0.87 |
| dry trees | 0.543 | 0.94 | 0.83 |
| shrubs | 0.410 | 0.94 | 0.72 |
| dry shrubs | 0.388 | 0.93 | 0.70 |

The packed asset is compressed once, bundled locally and decoded synchronously
on first use. It needs no network fetch, image decoder, DOM images or worker
messages. The texture array occupies about 2.0 MiB including mipmaps, once per
rendering context; the compressed source is about 751 KiB (1001 KiB base64).
Regenerate with:

```sh
cd web
node scripts/pack_forest_brushes.mjs
```

## Selection, placement and LOD

The canonical forest field supplies cover, potential height, needleleaf fraction
and stand tone in metres. The same seeded crown hash selects a motif and a
horizontal mirror. Needleleaf probability selects pines, other temperate trees
use broadleaf motifs, warm wet stands use tropical motifs, and warm dry stands
mix in dry-climate trees. These are illustrative families, not species
predictions. Motifs are mirrored but not rotated, so their painted light stays
consistent. Their square support is bounded by the same 3 by 3 crown
neighbourhood.

**Stature: shrubs and trees.** A crown's family also follows its physical
height `h` (m), sampled at its fixed centre with its per-crown jitter
(×0.82–1.18), never its size on screen:

```text
shrub share = 1 − smoothstep(3, 5.5, h)            (an independent crown hash < share → shrub)
dry share   = smoothstep(0.2, 0.7, dry) · (0.3 on river banks, else 1)
```

Low canopies therefore draw genuine bush sprites instead of miniaturised tree
icons, on every map: desert scrub, riparian galleries, short marginal stands.
Trees take over smoothly by 5.5 m. Dry scrub dominates arid ground; riverbank
shrubs are mostly the greener temperate family. A zoom never changes the
choice, because neither input depends on the footprint.

**Crown sizes.** Height and crown diameter are distinct. The crown radius `r`
follows the allometry in the vegetation note; a sprite frame spans
`2·min(1.22 r, 1.12 s)` for lattice spacing `s` (about `2.2–2.4 r`). Its
painted alpha extent is about 93 % of the frame and its area-equivalent
diameter 86 % (broadleaf), that is about `2.1 r`. A sprite therefore covers
about the area of its physical crown disc, which is what the Boolean coverage
table assumes; no extra perceptual enlargement is applied. Typical physical
crown diameters and sprite frames are 15 and 18.6 m for a 27.7 m oceanic
broadleaf, 17 and 21 m for a 32 m tropical tree, 7 and 9 m for a 20 m pine,
and 3–4 m and about 5 m for a 2 m shrub. The small sizes seen with the earlier
side-view artwork came from its small foliage inside the frame.

**Closure.** Overlapping translucent sprites combine as a union,
`cover = 1 − (1 − cover)·(1 − alpha)`, rather than the former maximum, which
under-represented painted overlap. Before this union change, root measured mean crown alpha 0.986 (covered
fraction 0.994) on a dense tropical window and 0.982 on an oceanic one with
the overhead art. Wet tropical cover also fluctuates less (see the
vegetation note), so closed rainforest stays closed at high zoom. Density is
not raised globally.

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
between 2 and 5 pixels of radius (analytic crowns use 0.9 to 2): painted
alpha holes need more pixels than an analytic shape. Until crowns are legible
the whole material stays within 6 % of the Render reference (vegetation note). Patch contrast
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

Both Render3D styles keep the original Render colour, macro woods included,
as the unresolved reference. The canonical forest is revealed between 32 and
2 m per pixel (half at 8 m/px). While partly revealed, stands use a coarser
mean-preserving mip, so clearings start as a soft, muted guide. Crown colours
are residuals of Render's canopy colour, and the open ground is Render's
own colour without canopy. Render's rock-coloured slopes, perennial snow and
ground above its treeline carry almost no candidate tree. The Render3D
vegetation note describes this guide and its validation.

Both Render3D styles also soften the 56 m procedural stand threshold when crowns
become unresolved: minimum patch contrast is 0.18 instead of 0.45, and threshold
feathering grows to 0.16 in the normalized coverage domain. At resolved crown
scales it returns to a narrow 0.015 feather. Applied fields and settlement
boundaries retain their independent signed-distance mask. These display
changes do not fill the canonical clearings or change their geographical
location.

Riverbank vegetation is a narrow envelope beside the displayed banks (8–32 m
on the arid probe, smoothly varied), not a broad moisture halo; at distance it
is a weak, area-filtered tint over the Render reference, and near the ground
low shrubs and occasional gallery trees without stand clearings. Gallery
density follows the same density control as trees, without widening the
banks; 0 % removes both resolved gallery crowns and the distant hint.
Unresolved sparse arid cover tapers continuously towards its square, so its outer fringe
is finer at distance. Near-view cover is retained. Both styles allow resolved crowns to overhang actual water while
rejecting tree centres in it; contour lines are composed last. The distant
analytic forest mean never masks the river. Raster exports carry the same
resolved crown alpha as an inverse mask on the water-only group.

## Limits and validation

Short trees near Render's rock or treeline limit stay unresolved longer; Brush
shows them as a soft dark tone until their crowns span 2 to 5 pixels.
These are flat, near-overhead illustrations sampled on the terrain, not
upright 3D trees. Their silhouettes and holes differ from the circular
coverage model used to calibrate Render3D's density lookup; local visible
coverage can therefore differ, particularly for sparse twiggy shrubs (alpha
about 0.4 of the frame). They share
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
above both. Seeded CPU regressions check water-buffer independence,
sea/disabled exclusions, the narrow arid bank envelope and the shrub height
thresholds. Those earlier GPU timings and visual checks predate the overhead
atlas, the shrub families and the bank envelope.
