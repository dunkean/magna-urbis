# Render3D: forest field, crowns and applied occupation

Render3D draws its forest from one canonical, deterministic control field. The
top-down map, the perspective view and the raster export all sample it in world
metres, so they show the same stands. The original Render material stays the
reference: where the forest is unresolved, Render3D shows exactly Render's
colour, macro woods included, on its own ground. As the pixel footprint
shrinks, the field is revealed progressively:

- a muted, low-pass stand and clearing guide at mid range;
- stand patches, explicit crowns, forest floor and shadows near the ground.

Crown and open-ground colours are residuals of Render's own canopy and open
colours (see [Render-guided level of detail](#render-guided-level-of-detail)).
The field also carries Render's tree eligibility (rock, slope, perennial snow,
treeline), so its rock-coloured slopes stay almost treeless at every zoom
(see [Render tree eligibility](#render-tree-eligibility)).

The forest is display-only: it never changes relief, hydrology or settlements.
With **Canopée détaillée** (`forestEnabled`) off, Render3D keeps its previous
ground material, including its coarse macro forest tint. Water and contour
composition still follow the corrected layer order described below.
The original Render style is unchanged: its material code path is textually
identical outside a `RENDER3D_FOREST` compile-time guard, and its images are
byte-identical (see [Render-guided validation](#render-guided-validation)).

## Inputs, controls and units

| Input | Unit / range | Source |
|---|---|---|
| Height grid | metres, square `{x, y, width, n}` | Retained terrain (the grid the renderers show) |
| Water codes | 0 land, 1 sea, 2 lake, 3 river | Retained decor raster or `settlementRaster` (lake interiors and a fallback only) |
| River segments | metres, nine floats per segment | Displayed vector/grid rivers or retained bank paths (`riverSegments`) |
| Climate | sea-level annual mean °C, annual precipitation mm | Terrain climate preset or custom values |
| Seed | uint32, `seedHash(seed)` | Same seed as the ground material |
| Occupation | signed-distance RGBA8 in the metres frame | Applied rural plan (Settlements stage only) |

| Control | Id | Range | Effect |
|---|---|---|---|
| Canopée détaillée | `forestEnabled` | on/off | Off: exact legacy Render3D |
| Densité | `forestDensity` | 0–200 % → 0–2 | `c ← 1 − (1 − c)^density`, including bank vegetation |
| Clairières | `forestClearings` | 0–100 % → 0–1 | Target opened share `0.4·clearings`, reduced by 85 % in wet tropical climates |

Links store `forest=0|1`. They store `forestDensity` and `forestClearings` only
when these differ from the defaults (1 and 0.45). These values are not part of
`TerrainSettings`, so changing them never regenerates terrain or reloads 3D
tiles. The field is normally built in a worker. If workers are unavailable or
fail, the same builder runs on the UI thread; the control tooltip identifies
that fallback. In the tested `file://` offline bundle it took about 0.31 s.

## Canonical control field

`buildForestField` (`rust/bridge/terrainForest.ts`) builds an RGBA8 raster on
the height layer's square.

- **Resolution:** about 16 m per texel, `n = ⌈width/16⌉`, capped at 1024. That
  is 39 m per texel over 40 km.
- **Channels:** R canopy cover (0–1); G potential canopy height (0–50 m);
  B needleleaf fraction; A stand tone (age or disturbance, 0.5 neutral).
  R and G include Render's eligibility `E`: `R = c·E` (after the density
  control) and `G = h·smoothstep(0, 0.4, E)`. Inside the riparian envelope
  G carries the gallery stature instead (below).
- **Bank raster:** a second RGBA8 raster on the same texels (`field.bank`),
  described in [Riparian gallery envelope](#riparian-gallery-envelope).
  Its geometry is independent of the density control. The resolved gallery
  target uses the same coverage curve `c_D = 1 − (1 − c)^D`; its area channel
  is scaled by `c_D/c` before upload, while a scalar `bankDensity` supplies D
  to the shared candidate shader. D = 0 removes the gallery texture entirely.
  Editing density copies the cached bank raster, so returning to a prior value
  restores the same bytes. Clearings do not break the gallery into stand holes.
- **Passes:** terrain and climate terms are evaluated on a half-resolution base
  grid; `E` and the bank raster at full resolution. All are cached by terrain
  key. Clearings use full resolution, so slider edits rebuild only that last pass.

### Visible water boundaries

Freshwater routing labels neither cut the canopy nor define banks. The
settlement routing raster deliberately expands every narrow river to at least
`1.2 · cellWidth` (46.875 m for a 40 km / 1024 grid). This is a conservative
routing obstacle, rather than a bank position. Using its nearest cell labels
as a forest exclusion created broad stepped clearings and sliced individual
crowns along straight cell boundaries.

The forest retains its potential cover beneath inland water. Tree centres
are rejected using actual displayed water coverage, not the routing buffer.
Their crowns may overhang the bank. Resolved crown alpha is exposed separately:
water contributes `waterAlpha * (1 - crownAlpha)`, with contour lines composed
last. This order is **water, trees, contour lines**. The unresolved distant
forest mean contributes no occlusion alpha, so narrow rivers remain readable.

The 2D GPU material samples a water prepass; perspective uses its projected
water tiles. Retained water paths are transformed into the rebased map frame,
including nested crops, and rasterized for the displayed viewport. The raster
shader returns RGB and resolved crown alpha; SVG uses the inverse alpha as a
mask on the water-only group, leaving diagnostics and contour ink above it.
Crop water masks have a 64 m gutter so neighbouring crown-centre decisions
agree. Signed terrain heights at or below sea level still receive zero canopy.
Near perspective tiles also carry a separate globally aligned 1 m R8 water
mask with a 64 m halo. Its crown-centre queries stay coherent across adjacent
tiles without enlarging their fine colour textures; mask memory is included
in the existing texture-cache budget.

This repairs a presentation mismatch; it does not change drainage, channel
geometry, routing obstacles or the physical hydrology. In particular, a
grid-aligned bend already present in a generated river remains a river bend.
The potential forest raster alone should not be interpreted as an observed
land-cover product over lakes or rivers.

Reproduction: shared seed `1dno3ne`, 40 km, Mediterranean, `coarse4` /
`original` / `decoder64`, Rust hydrology, Render3D. Pins 1–2 are at
`(21154.9,31707.3)` and `(21233.9,31634.9)` m; pins 3–6 lie near
`(9530,17375)` and `(8196,17040)` m. The focused regression
`tests/terrainForest.water-boundaries.test.ts` verifies that routing river and
lake labels retain canopy for composition, while sea-level and disabled
forest exclusions remain intact. A third seeded regression uses the straight
arid river described below: natural cover stays near zero, the gallery lives
only in a narrow envelope beside both banks, and repeated builds remain
byte-identical. At resolved crown scales, river pixels deliberately change where
overhanging crowns cover them; unchanged water-pixel counts are not a valid
test of this layering order.

### Climate

The field follows the existing ground material, except for the growing season:

```text
t      = T − 0.0065 · max(h, 0)                (°C, 6.5 °C/km lapse rate)
grow   = t + 6 + 0.5 · max(0, 10 − T)          (growing-season proxy)
cold   = t − 6                                 (winter proxy)
humid  = P / max(20·t + 280, 120)              (Köppen-like aridity ratio, mm)
```

The annual mean plus 6 °C is a poor summer proxy in cold, continental climates.
The CHMv2 boreal sites (Hyytiälä, annual mean ≈ 3.5 °C; BOREAS NSA, ≈ −3 °C)
carry 6–13 m closed forest with July means of about 15–16 °C. Their seasonal
amplitude grows with coldness, so the proxy adds `0.5·(10 − T)` below a
sea-level annual mean of 10 °C. Warmer climates are unchanged. This compact
calibration is not a climate model: the earth material keeps `T + 6` for its own
colours, and the bench has no explicit seasonality.

### Relief

- **Valleys and ridges.** Two topographic position indices are computed,
  `(h − blur150)/150` and `(h − blur600)/600`, with triangle blurs of radius
  150 m and 600 m. They define `valley` and `ridge` weights. Valleys gain
  humidity and height; ridges lose humidity, height and cover.
- **Riparian vegetation.** Rivers add no humidity to the field itself: the
  former broad term (an exponential chamfer distance of about 55–275 m to
  routing labels, then thresholded into stands) produced fat green islands
  along desert rivers. Gallery vegetation is a separate narrow envelope beside
  the displayed banks, see [Riparian gallery envelope](#riparian-gallery-envelope).
  At unresolved crown scales, sparse arid cover is smoothly tapered towards its
  square (`mix(c, c², arid * (1-crownVisibility))`), making the sparse fringe
  thinner at distance without changing near crowns.
- **Rock and steep slopes.** Render's eligibility below replaces the former
  slope-only gate (0.75–1.4 rise/run), which kept forest on Render's
  rock-coloured slopes.
- **Bogs.** Flat, wet, cold valleys open into bog.

### Render tree eligibility

**Objective.** Trees must follow Render's material semantics: almost none on
the slopes Render paints as rock, on perennial snow, or above its treeline.
The mask must be stable in world coordinates and must apply to crown
candidates at their fixed centres, so that it cannot cut crowns or change
geography on zoom. It must not be derived from RGB.

**Implementation.** `renderEligibility` (`rust/bridge/terrainForest.ts`)
re-evaluates the semantic terms of Neural Earth's `surfaceMaterial`
(`rust/bridge/terrainMaterial.ts`) once per field texel. Its noise functions
(`surfaceNoise`, `surfaceFbm`, `surfaceCover`) are exact ports of the GLSL,
with the same unsigned hash, gradients, quintic fade and octave fade, seeded by
the same `uMaterialSeed`. With `T`, `P` the sea-level annual temperature (°C)
and precipitation (mm), height `h` (m), slope `g = |∇h|` (central differences
on the source grid) and `tpi = (h − mean_{±r}) / 6r` with
`r = max(300 m, 2 source cells)`, as in the 2D material:

```text
ts, tw   = T + 6 − 0.0065 h,  T − 6 − 0.0065 h               (°C)
tHot     = max(ts, tw) + 0.8·m2·(0.25 + 0.75·smoothstep(0.015, 0.12, |tpi|))
humid    = P / max(10·(ts + tw) + 280, 120) · exp(0.1·m1), valley/ridge adjusted
tanEff   = tan 40° · (0.55 + 0.45·smoothstep(0.3, 1.3, humid))
exposure = smoothstep(0.5 tanEff, 1.3 tanEff, g)
         + 0.45·alpine·smoothstep(0.15 tanEff, 0.7 tanEff, g)
         + 0.35·ridge·smoothstep(0.35, 0.9, g / tan 40°) − 0.3·valley
outcrop  = surfaceCover(exposure, 0.75·crag + 0.25·grove, 0.35)
rock     = smoothstep(0.3, 0.85, 1 − outcrop) · (1 − smoothstep(0.9 tan 40°, 1.6 tan 40°, g))
perennial = smoothstep(2.5, −2.5, max(ts, tw) + 0.35·m1) · supply(P, valley, ridge)
E        = rock · (1 − perennial) · smoothstep(5.5, 13.5, tHot + boost + 0.8·valley)
boost    = 0.5·max(0, 10 − T)
```

`m1`, `m2` and `grove` are Render's 64 km, 48 km and 4.8 km patterns; `crag`
is its 700 m rock pattern. The terms are those of Render's
`trees·(1 − outcrop)` and its snow, with three explicit adaptations:

- **Rock sharpening.** Render's trees scale linearly with `1 − outcrop`. The
  field sharpens it so that rock-coloured ground (outcrop above about 0.6)
  carries almost no tree, while mild outcrops keep most of their stands.
- **Continentality.** The treeline ramp is Render's summer ramp (5.5–13.5 °C),
  shifted by the field's documented growing-season correction `boost`, which
  is zero for `T ≥ 10 °C`. Without it, Render's model would leave the cold
  preset almost treeless, contrary to the field's boreal calibration below.
- **Canonical footprint.** Render evaluates these terms at the display
  footprint. The guide uses fixed fine-scale values (full locality, no
  slope compensation) at the field texel. The crag pattern is sampled every
  second texel with Render's octave fade at that spacing; grove, regional
  patterns and the TPI mean use a ~140 m lattice. All are bilinear per texel.

The field's own moisture and treeline model still sets the potential
cover `c`; `E` only removes trees. It also gates the riparian envelope (its
width by `smoothstep(0, 0.4, E)`, its area by `E`), so gallery shrubs and trees
obey the same rock and treeline limits. Applied after the density control, it cannot
be bypassed by it. Potential height keeps its full value down to `E = 0.4`,
then collapses: sparse marginal stands keep real trees, while ineligible
ground has no height. The shader gates the woods prior and open-land trees by
height (`smoothstep(2, 6, h)` m), so neither can reforest rock, snow or ground
above the treeline. Crowns read `E` through the centre sample that already
decides them, so the mask never slices a crown.

**Cost.** One evaluation per terrain key, cached with the base pass. In Node
(`tsx`), on 1024² fields from a 256² source, the first build takes 1.3–1.6 s
instead of about 0.9 s; slider rebuilds are unchanged (about 1 s).

### Treeline

Cover fades between growing-season temperatures of 5 and 8.5 °C. 520 m noise
roughens the isotherm, and sheltered gullies raise it. This approximates the
≈ 6.4 °C growing-season isotherm of
[Körner & Paulsen 2004](https://doi.org/10.1111/j.1365-2699.2003.01043.x),
which puts the treeline near 2.7 km for the temperate preset. For a cold preset
(T = 1 °C) it lies near 0.8 km, so cold highlands still open above it.

### Cover, height and needleleaf fraction

Each term below is a smoothstep of the quantities above.

```text
cover   = thermal · moisture · coverMax · (1 − 0.6·bog) · stand mosaic · disturbance · E
height  = (3 + 31·humidity_term^0.8 · thermal_term) · stand · disturbance · valley/ridge · treeline   (m)
needle  = cold climate + conifer admixture noise + dryness − tropical
```

In wet tropical climates the stand mosaic modulates cover by ±0.055 instead of
±0.22 (×(1 − 0.75·wTrop)) and height by ±0.24 instead of ±0.16, so closed
rainforest varies in height and tone rather than opening holes. On a flat
40 km fixture (26 °C, 2300 mm, seed 428019) cover is 0.886 / 0.969 / 1.0 at
the 10th / 50th / 90th percentiles; canonical clearings are unchanged.

`height` is a canopy **height**. Crown **diameter** follows the allometry in
[Mean preservation](#mean-preservation): about 15 m for a 27.7 m oceanic
broadleaf, 17 m for a 32 m tropical tree, 7 m for a 20 m pine and 3–4 m for
a 2 m shrub (before the ±20 % per-crown size jitter).

### Noise and clearings

- **Noise.** Gradient noise is domain-warped and carries five fields: stand
  mosaic (2.4 km), disturbance (1.1 km), conifer admixture (1.8 km), stand tone
  (1.3 km) and regional productivity (9 km). Every octave set is fixed and
  normalised to unit variance over its own octave count. None depends on
  footprint or resolution.
- **Clearings.** Clearings threshold noise at 400 m and 200 m, plus a
  zero-mean terrain bias: ridges and gentle ground open first, while steep
  slopes stay wooded.
- **Threshold.** The threshold is the logistic approximation of the normal
  upper quantile of the target opened share.
- **Default opened share.** About 18 % in temperate and boreal climates and
  about 2.7 % in wet tropical climates (15 % of the target). In wet tropical
  climates, disturbance also lowers and lightens the canopy (height, tone)
  rather than opening it. These are rendering choices. In the CHMv2 sample
  below, openings of 1 ha or more cover about 19 %, 10 % and 0 % of the area,
  but the tropical 0 % partly reflects the product's known smoothing of gaps,
  so the sample does not validate any particular tropical value.

### Riparian gallery envelope

**Objective.** Desert rivers carry a thin vegetation ribbon that follows both
banks, at every zoom. Noise may modulate its width, density and colour, but
must not break it into blobs. The routing labels are widened safety buffers
(often over 100 m) and cannot define that ribbon.

**Inputs.** `ForestFieldInput.riverSegments`: nine floats per segment
(`ax, ay, bx, by, widthA, widthB, r, g, b`; metres), the geometry the water
renderer draws. Live vector water uses `riverSegments`, grid hydrology
`hydrologySegments` (both through `forestRiverSegments`, with the displayed
oxbow and lake-link options). Retained decors flatten their stored water paths
in the rebased map frame, nested crop transforms included
(`forestRetainedRiverSegments`): filled bank outlines become zero-width bank
edges, stroked channels keep their stroke width, and lake paths are excluded.
Without any geometry, routing river cells give a fallback whose envelope can
be up to about half a routing cell wider. The segments enter the terrain key,
the bench's field key and the worker copy.

**Bounded closest-bank transform.** `forestBankField`
(`rust/bridge/terrainForestRiparian.ts`) splits each segment into pieces of at
most eight field texels. Each piece visits only texels within its half width
plus `range = 48 m + 3·texel`, and keeps, per texel, the capsule with the
smallest signed bank distance (for texels in the channel, their deepest
capsule): its closest centreline point and bank point `centre + r·n`. No step
evaluates all segments for all texels. On a 40 km, 1024² grid an exaggerated
80 000-segment, 4 000 km meandering network takes about 0.3 s in Node (0.17 s
for the distance pass).

**Encoding (`field.bank`, RGBA8, same texels as the field).**

```text
RG  offset from the texel centre to its reference point: 128 + 127·offset/range
B   reach W from that point, 2 per metre:  margin = W − |offset|  (> 0 inside)
A   texel area of the land band [r, r + w] on each side × crown density, box-mipmapped
```

Channels narrower than 1.5 texels (`2r < 1.5·texel`) refer to their
centreline, with `W = w + r`; wider ones to their nearest bank point, with
`W = w`. Bilinear interpolation of an offset reconstructs a closest point
exactly wherever the closest-point map is affine: across a whole straight
narrow channel (projection onto its axis), or along one bank of a wide one.
Both banks of a stream narrower than one texel (a 6 m stream on 39 m texels)
therefore keep their own sub-texel edge; on bends the error is the chord
sagitta. Two simpler encodings failed the regressions: a scalar distance
raster loses the ribbon wherever two texel centres straddle the channel, and
nearest-bank offsets mix both banks of a narrow channel (up to 2r of error,
7 m at the apex of an 8 m meander on 39 m texels).

**Width, density, stature.**

```text
w       = (7 + 19·smoothstep(−1.5, 1.5, 0.8·n400 + 0.35·n90) + min(10, 0.2·r))
          · (1 + 0.5·wet) · (1 + 0.18·shelter)                         (m, ≤ 48)
density = (0.55 + 0.35·smoothstep(8, 36, W)) · (1 − 0.6·smoothstep(0.35, 1, |offset|/W))   (crown cover)
stature = (shrub + (tree − shrub)·shelter·(0.6 + 0.4·wet)) · (1 − 0.4·d/w)   (m)
shrub   = 1.3 … 2.8 m (60 m noise),  tree = 7 + 9·wet + min(6, 0.12·r)
wet     = smoothstep(0.45, 1.6, humid),  shelter = 1.1 km noise + large rivers
```

`n400` and `n90` are seeded world-space value noises at 400 m and 90 m, `r` is
the channel half width and `d` the distance beyond the bank. The width has a
positive minimum, so noise varies the ribbon without breaking it. The outer
part thins (down to 40 % of the density at the edge), so the ribbon ends in
scattered shrubs rather than a hedge line; the area channel includes the
mean of that taper (0.805). Inside the
envelope, the stature replaces the field's height channel where natural cover
is sparse (weight `1 − smoothstep(0.2, 0.6, c)`), and the needleleaf fraction
drops by 70 %. Natural forest keeps its own height where it is closed.

**Exclusions.** Sea (height ≤ 0) and lake interiors (a routing lake cell whose
eight neighbours are lake) have zero width; offsets stay valid there so the
ribbon tapers smoothly at a coast. Render's eligibility gates width and area.
Tree centres in displayed water are still rejected, and whole crowns may
overhang the bank.

**Crowns.** A candidate whose fixed centre lies inside the envelope and whose
gallery density exceeds the natural cover takes that density with no stand
clumping (`κ = 0`, share 1). No 56 m stand threshold can then chop the ribbon
into islands. Its height is the field's at that centre. In applied open land
the gallery keeps half its density (none in built land). Fragments within
16 m of the envelope choose their crown lattice from the gallery density.
Gallery crowns are tinted greener than the dry palette, as a ratio
(`palette(dry·0.45) / palette(dry)`) over Render's canopy guide.

**Level of detail.** While resolved, the expected gallery cover is the envelope
antialiased over the footprint times its (tapered) density; beyond two texels
per pixel it is the mipmapped area channel. Over the Render reference it is a
colour hint only (no normal tilt, no stand paint, no cast shadow): weak (50 %)
at ≥ 32 m/px, so a far view shows a thin tinted thread, rising with the
footprint reveal to the full expected fraction by 2 m/px. This hint is exempt
from the crown-legibility gate, so the ribbon does not jump when its small
shrubs become legible. In the revealed material, unresolved gallery crowns
add their full expected fraction (albedo and an 8 % occlusion); resolved
crowns replace it.

**Diagnostic.** Straight 12 km arid river (23 °C, 150 mm, seed 728311, 12 m
wide, clearings 0): envelope widths beyond each bank 8–32 m (median 24 m);
stature 1.2 / 2.5 / 5.1 / 5.7 m (10th / 50th / 90th / max); about 80 % of the
centre heights select shrub brushes; natural cover stays below 0.05. The
seeded regressions `tests/terrainForest.riparian.test.ts` (continuity on both
banks, sub-texel streams, an 8 m meander with 120 m bends on 39 m texels,
bounds, sea, retained path transforms, shrub
thresholds) and `tests/terrainForest.water-boundaries.test.ts` cover these
claims.

**Limitations.** Width, density and stature are procedural, not a water
balance, flood or groundwater model. Lake shores have no gallery envelope.
Retained round caps are approximated by their chords, and retained bank
outlines act as bank references even for narrow channels, so a narrow
retained stream can lose up to its own width of envelope on one side. At confluences and
tight inner bends the nearest-bank rule can widen the ribbon slightly. Real
curved rivers have not been visually checked by this implementation pass.

## Per-fragment appearance and level of detail

`applyForest(m, world, footprint, light)` runs after the Render3D ground
material is built and before it is shaded.

- **Macro canopy.** Neural Earth's macro material keeps its canopy. Under the
  compile-time guard `RENDER3D_FOREST` it additionally exports a guide (below);
  its returned colour is unchanged.
- **Field sampling.** The field is sampled with explicit mip levels,
  `lod = log2(footprint / field texel)`. Box mipmaps preserve mean cover.

### Render-guided level of detail

The earlier version removed Render's macro canopy and painted independent dark
canopy and litter over the suddenly bare macro colour. Its far mean followed
the canonical clearings, so overviews looked like a dalmatian and contrasted
much more than Render. The current version keeps Render as the unresolved
appearance, in the spirit of the perceptual filtering used by global imagery
viewers: distant colour is coherent rather than a mean of independent detail.

**Guide.** `earthMaterial` writes four globals for the same fragment:
Render's colour `R`, its macro woods coverage `w`, the same surface without
canopy `O` (every later Render step: sediment flats, beach, snow, valley
shade) and fully canopied `C` (snow and valley shade only, since crowns stand
above sediment). Away from flats and beaches, `R = mix(O, C, w)` exactly,
because every later Render step is affine with colour-independent weights.
The guide is display RGB and costs a few mixes; no material is re-evaluated.

**Ground transfer.** `applyForest` receives the Render3D ground material built
from `R` (rock tint, clasts, strata). The ratio `k = ground / R`, clamped to
[0.25, 4], transfers that detail to the open guide, `O_g = O·k`. Crowns use
`C` directly: ground rock tint does not apply to foliage.

**Colours.** Crown colour is `C · canopy(crown) / palette(stand)`, where the
forest's own climate palette and its tone, jitter, needleleaf/broadleaf and
tropical accents act only as ratios to the stand's mean palette. Litter and
moss mix towards fixed floor colours from `O_g`, as before. The field mean is
therefore anchored on Render's canopy colour; it does not introduce a second
palette.

**Reveal.** With footprint `fp` in metres per pixel,

```text
reveal = (1 − smoothstep(1, 5, log2 fp))          (1 at ≤ 2 m/px, 0 at ≥ 32 m/px)
       · mix(0.06, 1, crownVisibility²)           (crown legibility)
material = mix(reference, forest, reveal)         (albedo, normal, occlusion, roughness)
```

`crownVisibility` is the footprint band in which crowns resolve (radius 0.9–2 px
analytic, 2–5 px Brush). Until crowns are legible only a 6 % residual of the
canonical stands shows. Root's QA found that a footprint-only reveal still
showed a dark/light spotted stand pattern at 4 m/px (and faintly at 12.5 m/px)
while Brush crowns were unreadable. The gate is smooth and acts on the
material only; crown geography and occupation decisions are unchanged, and
applied occupation still corrects the reference at every distance.

The reference is the Render3D ground material from Render's colour. The forest
response is the previous far/near model with the colours above. The whole
material response is blended, not only RGB, so normal tilt, stand occlusion,
litter, grain and cast shadows vanish with the reveal. At `reveal = 0` the
function returns before any crown work, and the result equals Render3D with the
forest off, except for applied occupation (below). Resolved crown alpha for the
water compositor is `cover · crownVisibility · reveal`, so partly revealed
crowns occlude water only partly.

**Mid range.** While `reveal < 1`, the stand statistics sample a coarser mip,
`lod + 2·(1 − reveal)`. Box mipmaps preserve the mean, so clearings first
appear as soft, low-contrast tonal variation. They sharpen to the canonical
edges as the reveal approaches 1. Crowns are unaffected: they always sample
their fixed centres at level 0.

**Applied occupation at every distance.** Inside applied open land, the
reference woods coverage becomes the land's own tree share (orchard, hedge
and scattered trees); inside applied woods it receives the weak prior. The
reference albedo is corrected by `(w_ref − w)·(C − O)·k`, so fields near
settlements stay open even where Render had macro woods, and the overview
shows them at full contrast.

**Where the field has no tree.** If the canonical field and its next mip have
no cover, the fragment moves from the reference towards `O_g` with the reveal:
Render's macro woods give way to its own open ground, without crown work.

### Mean preservation

**Stands.** A stand of cover `c` is a set of patches, each with crown density
`d ≥ c`:

```text
d = c + κ·(0.985 − c)      κ from humidity and height
patch share  s = c / d     so that s · d = c
```

Patches come from 56 m gradient noise. Its measured CDF maps it to a uniform
threshold, and its analytic gradient antialiases the patch edges. Wet tropical
canopies use a smaller κ (× 0.4), so their small deficit appears as gaps
between crowns rather than as stand holes.

**Crowns.** Inside patches, crowns sit on jittered lattices of spacing
`2·√2^L` m (L = 0…6, i.e. 2–16 m). The level follows the crown radius, which
follows height. This adapts the global height–crown allometry of
[Jucker et al. 2017](https://doi.org/10.1111/gcb.13388) as a rendering-scale
rule:

```text
broadleaf  r = (0.24·h + 1)·(1 + 0.45·dry)
needleleaf r = 0.14·h + 0.9            (m)
```

Two adjacent levels are blended so that their union keeps `d`:

```text
d0 = 1 − (1 − d)^(1 − w),   d1 = 1 − (1 − d)^w   ⇒  1 − (1 − d0)(1 − d1) = d
```

For a target `d` per level, the occupancy and radius ratio come from a table
that inverts, by Monte Carlo, the union coverage of the jittered lattice
(±0.003). The logic is that of the Boolean model: the union coverage
`1 − exp(−λπr²)` sets the cover, not the occupancy alone.

**Far field.** Beyond the crown band, the forest response is the analytic
expectation, then blended with the Render reference by `reveal`:

```text
albedo = mix(mix(O_g, litter, stand), C · tone residual, canopy)
normal = tilted away from the sun by the mean crown self-shading
```

One extra field fetch, offset sunwards by `0.6·h·cot(sun elevation)`, darkens
the ground beside stand edges.

### Footprint bands

| Feature | Visible when |
|---|---|
| Canonical forest vs. Render reference | `reveal`: none at ≥ 32 m/px, half at 8 m/px, full at ≤ 2 m/px, times `mix(0.06, 1, crownVisibility²)` |
| Riparian gallery hint | 50 % over the reference at ≥ 32 m/px, full expected cover by 2 m/px (not legibility-gated); area-filtered beyond two field texels per pixel |
| Low-pass stand guide | stand mip raised by `2·(1 − reveal)` levels |
| Explicit crowns | analytic radius grows from 0.9 to 2 px; Brush uses 2 to 5 px to resolve its illustrated trunks and alpha holes |
| Patch structure | fades out between 6 and 14 m per pixel; contrast drops to 18 % as crowns become unresolved (`smoothstep(0.6, 2.5, r/footprint)`), with a broader threshold feather |
| Sub-crown grain | between the crown band and the mean: crown-scale noise (wavelength 1.6·r) whose amplitude fades with `smoothstep(0.35, 1.2, r/footprint)` |
| Fine leaf clusters | from 8 to 20 px of crown radius |
| Crown edges | antialiased over 0.75 px |

Both the patch-contrast blend and the grain are mean-preserving: they mix the
binary mask with its expectation, or add zero-mean noise. Short stands therefore
go from crowns to a fine grain and then to the mean, instead of leaving hard,
flat patch silhouettes once their crowns vanish.

Each crown samples its canonical field at its centre. Cover, height, needleleaf
choice, lattice weight, occupancy and radius follow that centre sample; applied
occupation and true-water exclusion are also evaluated there. Neighbouring
fragments therefore agree on the entire motif. Fragment-dependent occupancy
previously sliced some crowns, sometimes leaving only a stippled sliver of
their base. Interpolating the final colour cannot repair that selection error.

### Near view

- **Crown shapes.** Broadleaf crowns are paraboloids and needleleaf crowns are
  cones, both with analytic slopes for the normals.
- **Crown detail.** Rim and trough occlusion; per-crown outline harmonics;
  leaf-clump normals and brightness once a crown spans several pixels, plus a
  finer rotated octave from 8 px of radius; straight radial branch ridges on
  conifers; per-crown colour jitter; in tropical canopies, crowns that are
  flushing or flowering.
- **Shaded crowns** keep their sky light: cast shadows tilt the crown normal
  only partly, and crown occlusion stays at 0.5 or above.
- **Shadows.** The 3×3 crowns around the sunward point cast shadows onto the
  local crown or ground height, with a soft penumbra and reduced strength.
  The Brush variant uses its artwork's contact shading and a shallow normal;
  it does not project a second copy of the oblique illustration onto the ground.
- **Stand margins** are denser and darker, following the edge-structure findings
  of [Harper et al. 2005](https://doi.org/10.1111/j.1523-1739.2005.00045.x).
- **Stand tone (A)** is independent of cover and height, so closed tropical
  canopies still vary.
- **Forest floor.** Under stands, a litter colour replaces part of Render's open
  ground `O_g`. Snow comes from Render's canopied guide `C`.

## Applied occupation

**Objective.** Fields, pastures and settlements of an *applied* rural plan must
open the forest. The plan's own woods must stay wooded, yet keep the natural
density variation and clearings. Edges must stay sharp at any zoom.

**Input.** The retained land-use scene of the Settlements stage
(`web/src/ui/urbanLanduse.ts`). Its polygons are in metres, in the frame of the
retained decor raster (`mapSize = raster.width`).

### Algorithm

The algorithm lives in `web/src/ui/forestOccupation.ts`.

1. **Select polygons.** Open land is `field`, `meadow`, `pasture`, `orchard`,
   `garden` and `commons` (classes 1–6), plus urban reserves (class 7, built).
   Forest is `forest`. `marsh` is ignored; the material handles wet ground
   itself.
2. **Size the raster.** It covers the bounding square of those polygons plus
   8 texels, with n ≤ 1536 and a cell of at least 2 m. The origin is aligned to
   the cell.
3. **Fill.** An even-odd scanline fills texel centres and respects holes. Built
   reserves are drawn last.
4. **Signed distance.** An exact Euclidean distance transform
   ([Felzenszwalb & Huttenlocher 2012](https://doi.org/10.4086/toc.2012.v008a019))
   runs to the boundary texels of each mask, i.e. those with a 4-neighbour on
   the other side.
5. **Encode.** The result is stored as a signed-distance texture
   ([Green 2007](https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf)).

The signed distance (step 4) is positive inside, and the texture (step 5)
encodes it as follows:

```text
d = ±(distance_to_boundary_texel + 1/2)        [texels]

R = clamp(128 + 16·d_open,   0, 255)
G = clamp(128 + 16·d_forest, 0, 255)
B = class id (0 none or wood, 1 field … 6 commons, 7 built)
A = 255 inside any applied polygon, else 0
```

Bilinear filtering of R and G keeps the zero iso-line within a fraction of a
texel of the polygon edge, up to ±8 texels.

### Use in the shader

The signed distances become metres, antialiased over `max(footprint, texel/2)`.

- **Open land** removes natural cover but keeps a share of scattered trees that
  depends on the class (table below).
- **Hedgerows.** A 5 m band inside field, meadow and pasture edges carries
  hedgerows, in non-arid climates where trees exceed about 3–8 m.
- **Applied woods** are a weak prior, not a forced closed canopy: inside them
  the cover is `max(c, 0.25·smoothstep(2, 6, h))`, with natural cover `c` and
  potential height `h` in metres. Since `h` carries Render's eligibility, the
  prior vanishes on rock, perennial snow and above the treeline; the shares
  kept in open classes (table below) are gated by the same height factor. Above that floor the natural field keeps its
  sparse-to-dense variation and clearings, and the climatic treeline still
  holds. Near crowns apply the same floor to the locally extrapolated natural
  cover, only for crown centres inside the woods, before the stand share
  `c/d` is computed. Open land keeps priority over woods.

| Open class | Share of trees kept |
|---|---|
| orchard | 45 % |
| garden | 22 % |
| commons | 12 % |
| pasture | 5 % |
| built | 3 % |
| meadow | 2 % |

### Rules

- **Natural cover never constrains the material.** The city-less path
  (`generateNaturalCover`) draws coarse default forest polygons. They are never
  rasterised: the callback receives `undefined`, and the climate/relief field
  stays authoritative.
- **Frame.** `cropTerrain` rebases a retained crop to its cell-aligned origin.
  `terrainFromDecor` and the GL surface then use `x = y = 0` and
  `width = raster.width`. The occupation is published only when `scene.mapSize`
  equals the displayed terrain width.
- **Canvas.** While the Render3D forest is shown, the Canvas land-use overlay
  drops its `forest` areas: fill, canopy and tree symbols. Fields, furrows,
  hedges, orchards, gardens and farms stay drawn. Every other style keeps the
  full drawing.
- **Scope boundary.** Perspective exists only in the Terrain stage, which has no
  applied occupation. Agricultural cut-outs are therefore visible in the 2D
  Render3D map of the Settlements stage, and in rasters given the same
  occupation, but not in perspective. Enabling perspective there is a separate
  request.

### Cost

Measured with `npx tsx` on a synthetic 12 km plan of 561 polygons:

- **Build time:** about 0.3 s at 1536², once per applied scene, then cached.
- **Sign errors:** 0.5 % of 200 000 random points disagree with an exact
  point-in-polygon test, all within one texel of an edge.

## Determinism

- **No `Math.random`.** Every random choice derives from `seedHash(seed)`
  through integer hashes.
- **Field key.** It covers the seed, climate, layer rectangle, a hash of the
  height and water bytes, a hash of the river segments' positions and widths,
  the settings and the occupation key.
- **Occupation key.** It is a content hash: identical inputs give identical
  bytes. Rebuilding the same scene twice gave the same key.
- **No view dependence.** Field and crown decisions depend on world position
  only, never on camera, mesh level of detail or tile.

## Empirical calibration (CHMv2)

This is a bounded measurement that grounds the procedural parameters. It is
**not** a learned model, and nothing from it runs in the application.

### Data

- **Product:** Meta/WRI global canopy height map v2
  (`dinov3_global_chm_v2_ml3`), licence CC BY 4.0, listed in the
  [CHMv2 AWS registry](https://registry.opendata.aws/dataforgood-fb-forestsv2/).
  The v2 method is [Brandt et al. 2026, *CHMv2: Improvements in Global Canopy
  Height Mapping using DINOv3*](https://arxiv.org/abs/2603.06382). See also the
  [Meta announcement](https://ai.meta.com/blog/world-resources-institute-dino-canopy-height-maps-v2).
  The earlier v1 method is described in
  [Tolan et al. 2024](https://doi.org/10.1016/j.rse.2023.113888).
- **Values:** uint8 metres, estimated by a model from Maxar RGB imagery. They
  are **pseudo-label estimates**, not lidar.
- **Resolution:** 1.194 m Mercator pixels, i.e. 0.56–1.19 m on the ground.
- **Image dates:** 2010–2020.

### Sample

- **Windows:** 16 windows of 1024 m × 1024 m, in 4 biomes with 2 sites each.
- **Download:** read by HTTP range requests, about 5 MB in total.
- **Provenance:** the full report records, per window, the URL, ETag, pixel
  window, bounding box, image dates and the SHA-256 of the array.
- **Files:** the script, its README and the compact per-biome reference are in
  `rust/experiments/forest-chm/`.

| Biome (sites) | Cover ≥ 2 m | Height p50 / p90 (m) | Tops/ha | Top spacing (m) | Gaps < 1 ha | Openings ≥ 1 ha |
|---|---|---|---|---|---|---|
| Temperate (Fontainebleau, Hainich) | 0.77 (0.72–1.0) | 22.5 / 26.5 | 40 | 16 | 1.8 % | 19 % |
| Boreal (Hyytiälä, BOREAS NSA) | 0.84 (0.60–0.87) | 8.5 / 16.5 | 77 | 11 | 5.2 % | 10 % |
| Tropical (Manaus K34, Danum) | 1.00 | 23.5 / 41.5 | 31 | 19 | ≈ 0 (smoothing) | 0 % |
| Mediterranean savanna (Majadas, Tonzi) | 0.22 (0.19–0.51) | 5.5 / 8.5 | 15 | 26 | (open matrix) | 77 % |

### Definitions

- **Tree tops:** connected plateaus of local maxima of the CHM, smoothed at
  1 m, in a 5 m window, above 5 m.
- **Gaps:** 4-connected regions below 2 m.
- **Gap-size exponent:** 1.6–1.9 above 10 m², estimated by maximum likelihood
  ([Clauset et al. 2009](https://doi.org/10.1137/070710111)).

### Use

The measurements informed four choices:

- the reduction of clearings in tropical climates;
- the default share of clearings;
- the height ranges of closed stands;
- a broadleaf crown radius of about 0.3–0.45·h.

### Comparing a field with the reference

Compare canopy heights with the 1-Wasserstein distance between 1 m histograms:

```text
W1 = Σ_h |F_field(h) − F_ref(h)| · 1 m
```

`chm_reference.json` stores the pooled histograms (`pooledCanopyHist1m_2to61`).

### Caveats

- **Smoothing.** CHMv2 merges narrow crowns and fills small gaps; the tropical
  windows contain no gap below 2 m. Tops per hectare are therefore lower bounds
  and crown radii upper bounds, especially for conifers. For that reason, the
  needleleaf allometry does not follow CHMv2.
- **Mosaics.** Seams and changes of image date occur inside some windows.
- **Sample size.** Sixteen windows give orders of magnitude between biomes, not
  regional ecological accuracy.

## Learned refinement: deferred

This version offers no learned source: no model was trained, and procedural
rendering was chosen for now. Training is planned later on a separate machine
with an RTX 5090 (32 GB) and an RTX 4090 (24 GB).

CHMv2 can supervise **canopy structure**, not foliage RGB appearance. Learning
colours and photographic texture would need separately licensed, co-registered
RGB orthophotos, with acquisition dates and lighting checked against the CHM.
The open height maps do not grant access or reuse rights to their source
satellite imagery: CHMv2 is not an RGB training dataset, and its CC BY 4.0
licence does not cover Maxar images. Learned foliage colours would need
licensed paired RGB + CHM data, or open orthophotos (for example national
aerial programmes whose licence permits training) co-registered with lidar or
CHM heights. That appearance experiment is a later step; the height
refiner below does not by itself produce a satellite-like colour material.

**Planned protocol**

1. **Data.** About 2 000 CHMv2 COG windows of 1 km, sampled by biome and
   Köppen class. Validation holds out whole sites, not tiles. Image dates and
   seam masks are kept to reject mosaic artefacts.
2. **Model.** A small conditional U-Net or GAN refiner of at most 2 MB. Input:
   CHM at 32 m, a biome/climate code and noise. Output: a 1 m canopy height
   patch. Training is self-supervised: the low-resolution input is derived from
   the target.
3. **Heterogeneous GPUs.** One data-parallel process runs per GPU. Each per-GPU
   batch fits that card's memory; gradient accumulation keeps the effective
   global batch constant, and the gradient average is weighted by each GPU's
   sample count. Both cards use bf16 autocast. Simpler alternative: train on
   the 5090 alone, and evaluate or bake on the 4090.
4. **Baking.** Offline, the model produces an exemplar atlas of micro-height
   patches, at most 1 MB. At runtime, histogram-preserving tiling
   ([Heitz & Neyret 2018](https://doi.org/10.1145/3233304)) would sample it
   under the same field contract. If a model ever runs per tile instead, tiles
   must stay deterministic: fixed weights hash in the field key, a seed derived
   from the world tile index, and overlapping tiles (for example a 64 m margin)
   blended across seams.
5. **Go criteria.** A `source` option appears only if the atlas beats the
   procedural field on held-out sites, on the metrics above (W1, gap-size
   distribution, autocorrelation), wins a blind side-by-side comparison, and
   stays within the size budgets.

## Measurements (prototype evidence)

These are the only measurements made; none is a validation against ground truth.

- **Field build, 1024² at 40 km:** 0.30–0.42 s in the bench worker (msedge,
  RTX 3090 machine), about 0.2 s after a density or clearing change, which
  reuses the cached base pass. 0.9–1.5 s in Node (`tsx`) for the probe below.
- **Root's field probe** (256² synthetic rolling relief near 80 m, 40 km,
  default settings). Cover is a region mean, not a forest-plot mean:

  | Climate (T °C / P mm) | Cover before → after | Cover-weighted potential height | Share of texels with cover < 0.05 |
  |---|---|---|---|
  | Temperate 18 / 1000 | 0.53 → 0.59 | 20.6 → 19.8 m | 0.26 → 0.18 |
  | Cold 1 / 550 | 0.15 → 0.64 | 3.3 → 14.4 m | 0.42 → 0.18 |
  | Tropical 26 / 2300 | 0.62 → 0.88 | 32.5 → 32.6 m | 0.26 → 0.013 |
  | Mediterranean 16 / 600 | 0.32 → 0.36 | 10.9 → 10.4 m | 0.18 (after) |

  "Before" is an earlier build of the same day. The potential height is the
  top height; crowns vary by ×0.82–1.18, and CHMv2 medians include crown flanks.
- **GPU** (final TerrainGl top-down fixture, 1024×768, RTX 3090 through
  ANGLE/D3D11, median of seven timer queries): 2.2–3.4 ms for forest overviews,
  5.5–10.3 ms for resolved forest views; the arid fixture without trees takes
  1.9–2.1 ms. These are machine-specific measurements, not a frame-rate guarantee.
- **Cold compilation:** constructing the final TerrainGl renderer took 39.5 s
  in a fresh headless browser. The raster shader's compile/link/first draw took
  24.5 s in an earlier final-review probe. This is separate from field building
  and steady rendering, and can block the UI during first use. Parallel shader
  compilation and a smaller crown shader remain future performance work.
- **Final regressions:** all six original Render images are pixel-identical to
  baseline. With canopy off, ten of twelve Render3D images are pixel-identical;
  across the other two, 17 pixels differ by one 8-bit level in one channel
  (about 9.4 million pixels checked in total).
- **Determinism and crops:** two builds give identical RGBA bytes; overlapping
  128 m raster crops at 1 m/pixel give identical RGB bytes. An applied test field
  changes the forest inside its bounds and changes no pixels beyond the tested
  margin. The actual rural UI case has 424 zones around four places, and its
  native occupation reaches the canonical field without browser errors.
- **Retained export:** changing density to 170 % and clearings to 20 % after
  reloading a retained artifact preserves those values in the next `.decor`.
  Height bytes and the original regeneration query remain unchanged.

### Render-guided validation

Measurements of the Render-guided level of detail and eligibility
(2026-10-21; RTX 3090 through Edge ANGLE/D3D11, headless). The probes, kept in
the ignored `web/scratch/forest-guidance/`, render the same TerrainGl fixtures
with the HEAD and the working shaders: the Render3DBrush paired fixture
(40 km, 256² source, seed 428019, temperate 18 °C / 1000 mm) and a 3 km
massif. Views are 1024×768 at 0.025, 0.1, 0.3 and 4 px/m, plus two rock-edge
views.

- **Render unchanged.** All eight `style=render` images are byte-identical
  between HEAD and the working tree.
- **Overview.** At 40 m/px Render3D and Render3DBrush follow Render's pattern
  (no canonical clearing mottle); the remaining offset is Render3D's own ground
  lighting. Luminance standard deviation at 10 m/px fell from 6.6 to 2.2
  (Render: 2.0).
- **Mountains.** Render's rock-coloured slopes carry no crown; crowns end
  intact at the rock margin in both styles, in 2D and perspective.
- **Exports.** The existing water/forest raster probe passes all its
  invariants: zero RGB and crown-alpha differences between overlapping crops
  (analytic and Brush), crown overhang, contour ink last, no crown alpha
  without a field.
- **Regressions.** `tests/terrainForest.eligibility.test.ts`: a 45° slope
  keeps no cover or height (the previous builder kept full cover there), a
  0.4 slope stays wooded, and a 3.5 km plateau has zero potential height, so
  no woods prior. The HEAD builder fails the first and last cases.

The earlier field probe table above predates `E`; on steep or high terrain
its cover is now lower.

## Implementation scope and limitations

**Scope.** This is an original, compact procedural model. The cited works
contribute concepts and parameter ranges, not code:

- the treeline isotherm;
- crown allometry;
- edge structure;
- Boolean coverage;
- signed-distance textures;
- the exact distance transform.

None of them is ported in full, and nothing is taken from GPL vegetation
simulators. The eligibility guide re-evaluates terms and noise of the Neural
Earth material already ported in `terrainMaterial.ts` (GPL-3.0); it adds no
other third-party code.

**Limitations**

- **Ecology.** No succession, competition, species composition, understorey or
  seasonal phenology.
- **Moisture.** Moisture is a proxy derived from terrain position, not a water
  balance. There is no topographic wetness index.
- **Crown geometry.** Crowns are material only: no mesh displacement and no
  silhouettes. No relief shadow falls on the forest beyond the ground
  material's own shading.
- **Field resolution.** The field resolves 16–39 m. Smaller natural structure
  comes from the per-fragment patches and crowns.
- **Occupation.** It exists only for applied rural plans and is not visible in
  perspective. Raster exports forward the canonical field and occupation through
  `renderRustTerrain` and `renderMaterialPixels`.
- **Calibration.** It rests on sixteen windows of model-estimated heights.
- **Riparian vegetation.** The gallery envelope is procedural (see its own
  limitations); lake shores have no envelope.
- **Render guide.** The reveal thresholds (2 and 32 m/px) and the 6 %
  legibility residual are perceptual choices, not measurements. Between them,
  Render's macro woods and the canonical stands are both partly visible, and
  they need not coincide. Where
  Render shows few woods (cold or dry presets), resolving the forest darkens
  the mean. Eligibility uses Render's terms at a fixed footprint and the 2D
  TPI; perspective evaluates Render with zero TPI and refined relief may add
  exposure, so near rock edges can differ by a few texels from the colour.
- **Marginal stands.** Short trees near the eligibility limit stay unresolved
  longer. Brush shows them as soft dark tone until their 2–5 px crowns
  resolve, and the existing 56 m stand-patch contrast remains visible on
  sparse treeline stands at a few metres per pixel.
- **Startup and GPU cost.** The shader is expensive to compile cold, and dense
  resolved canopies cost several milliseconds per frame even on the measured
  RTX 3090. Worker-based field construction does not remove shader compilation.
  A new graphics context can incur this cost again; changing forest settings
  within an existing renderer does not recompile its shader.

## Reproduction

1. Open `terrainbench.html` with `style=render3d`, a fixed `seed` and a climate
   preset.
2. Toggle `forest`, `forestDensity` and `forestClearings`. Compare the top-down
   view (zoom up to 128 px/m) with the perspective view at the same world
   point. Compare `style=render` at 40, 10, 3 and 0.25 m/px: the overview
   should match, rock-coloured slopes should stay treeless.
3. In the Settlements stage, load a retained terrain artifact, then generate
   the settlements and the land use (`landuseEnabled`). With Render3D, the
   Canvas woods disappear and the fields cut into the material forest. Other
   styles keep the drawn woods.
4. For the calibration, run the commands in
   `rust/experiments/forest-chm/README.md`. The raw windows go to
   `web/out/render3d-forest/chm/`.
