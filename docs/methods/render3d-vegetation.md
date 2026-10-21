# Render3D: forest field, crowns and applied occupation

Render3D draws its forest from one canonical, deterministic control field. The
top-down map, the perspective view and the raster export all sample it in world
metres, so they show the same stands. Per fragment, the field becomes one of
two renderings, depending on the pixel footprint:

- stand patches, explicit crowns and their shadows;
- or their analytic mean.

The forest is display-only: it never changes relief, hydrology or settlements.
With **Canopée détaillée** (`forestEnabled`) off, Render3D keeps its previous
ground material, including its coarse macro forest tint. Water and contour
composition still follow the corrected layer order described below.
The original Render style never compiles this path.

## Inputs, controls and units

| Input | Unit / range | Source |
|---|---|---|
| Height grid | metres, square `{x, y, width, n}` | Retained terrain (the grid the renderers show) |
| Water codes | 0 land, 1 sea, 2 lake, 3 river | Retained decor raster or `settlementRaster` |
| Climate | sea-level annual mean °C, annual precipitation mm | Terrain climate preset or custom values |
| Seed | uint32, `seedHash(seed)` | Same seed as the ground material |
| Occupation | signed-distance RGBA8 in the metres frame | Applied rural plan (Settlements stage only) |

| Control | Id | Range | Effect |
|---|---|---|---|
| Canopée détaillée | `forestEnabled` | on/off | Off: exact legacy Render3D |
| Densité | `forestDensity` | 0–200 % → 0–2 | `c ← 1 − (1 − c)^density` |
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
- **Passes:** terrain and climate terms are evaluated on a half-resolution base
  grid and cached by terrain key. Clearings use full resolution, so
  slider edits rebuild only that last pass.

### Visible water boundaries

Freshwater labels guide riparian moisture; they do not cut the canopy. The
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
forest exclusions remain intact. A third seeded regression uses a straight
river on flat ground in an arid climate, with procedural clearings disabled:
its integrated canopy width varies along the river instead of forming a
constant ribbon, and repeated builds remain byte-identical. All three tests
pass. At resolved crown scales, river pixels deliberately change where
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
- **Riparian forest.** A chamfer distance to lakes and rivers adds riparian
  humidity where the climate is too dry. Seeded 1100 m and 210 m noises vary
  the exponential distance scale from about 55 to 275 m and its strength from
  0.35 to 1.2. Gallery forest therefore varies along a channel instead of
  forming a constant-width band. At unresolved crown scales, arid cover is
  smoothly tapered towards its square (`mix(c, c², arid * (1-crownVisibility))`),
  making the sparse fringe thinner at distance without changing near crowns.
- **Steep slopes.** Slope above about 0.75 rise/run removes cover.
- **Bogs.** Flat, wet, cold valleys open into bog.

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
cover   = thermal · moisture · steep · coverMax · (1 − 0.6·bog) · stand mosaic · disturbance
height  = (3 + 31·humidity_term^0.8 · thermal_term) · stand · disturbance · valley/ridge · treeline   (m)
needle  = cold climate + conifer admixture noise + dryness − tropical − riparian broadleaf
```

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

## Per-fragment appearance and level of detail

`applyForest(m, world, footprint, light)` runs after the Render3D ground
material is built and before it is shaded.

- **Macro canopy.** Inside Neural Earth's macro material, a compile-time guard
  (`RENDER3D_FOREST`) with a runtime `uForest` switch removes the macro canopy,
  but only while the new forest is active.
- **Field sampling.** The field is sampled with explicit mip levels,
  `lod = log2(footprint / field texel)`. Box mipmaps preserve mean cover.

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

**Far field.** Beyond the crown band, the material is the analytic expectation:

```text
albedo = mix(forest floor, mean canopy colour, canopy)
normal = tilted away from the sun by the mean crown self-shading
```

One extra field fetch, offset sunwards by `0.6·h·cot(sun elevation)`, darkens
the ground beside stand edges.

### Footprint bands

| Feature | Visible when |
|---|---|
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
- **Forest floor.** Under stands, a litter colour replaces part of the ground
  albedo. Snow stays, at reduced strength, on needleleaf crowns.

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
  potential height `h` in metres. Above that floor the natural field keeps its
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
  height and water bytes, the settings and the occupation key.
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
simulators.

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
   point.
3. In the Settlements stage, load a retained terrain artifact, then generate
   the settlements and the land use (`landuseEnabled`). With Render3D, the
   Canvas woods disappear and the fields cut into the material forest. Other
   styles keep the drawn woods.
4. For the calibration, run the commands in
   `rust/experiments/forest-chm/README.md`. The raw windows go to
   `web/out/render3d-forest/chm/`.
