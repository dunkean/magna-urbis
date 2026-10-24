# Inferred spatial detail for soil and low cover

`surface-detail-distribution-3` is a renderer component. It arranges existing
material probabilities at fixed metric scales, independently of camera tiles.
It does **not** add a DEM, observed soil/lithology, physical water, candidates or
population density. The canonical 78.125 m context, compiler/schema versions,
ground-response means, source heights and population IDs remain unchanged.

This is a CPU-validated prototype awaiting a new native visual check. The first two native prototypes are explicit artistic failures: [R1](evidence/SOIL_COVER_DISTRIBUTION_R1.md)
and [R2](evidence/soil-cover-distribution-r2.json), each preserved with 28 images.
Their technical checks do not qualify version 3 visually. GPU access requires
a handoff and a one-second watcher that yields to the user V15 demo.

## What and where

The shader reuses all eight probabilities already computed by ground response:
rock, residual mineral soil, humus, dry surface, and the four transported
processes. Stoniness, slope, organic content, moisture, aridity and the existing
process potentials therefore constrain which supports can appear. Substrate
and transported-rock colour roles still come from the explicit source geology.
No missing lithology is inferred from climate or a random colour.

The former compact pair remains the public GR pair. The full internal weights
only prevent small existing gravel/rock/deposit contributions from disappearing
in renderer top-two reduction. Exact stored-knot ids and quantised GR means are
still returned by `ground_response_sample`. Diagnostic 7 remains the original
ground mean; diagnostics 8, 9, 11 and 17 remain source-cover/mean diagnostics.

Low cover has its own probability budget, including uncovered support. Repeated
corner slots are merged **per recipe** and sorted by recipe id before spatial
allocation, so a different first raster-corner primary id cannot move a patch.
Ground retains its fixed physical-role ordering. A material interval is not
repeated for every interpolation corner. Ground, low cover and canopy are not
normalised together into a single artificial vertical partition.

Existing grass/litter PBR maps are selected by these probabilities. The colour
correction follows the existing component colours and premultiplied coverage;
there is no random RGB multiplier or fitted colour gain. The former arbitrary
RGB macro modulation is disabled on this explicit GR path. All 15 registered
PBR inputs, their prepared bytes, means, maps, physical scales and cache identity
are reused unchanged. Ground without explicit GR retains its old mixture. Explicit low-cover
probabilities can still be arranged independently; absent legacy low-cover
fields are not reconstructed. The cartographic palette path remains unchanged.

## Calibrated stochastic arrangement and filtering

Nominal bands are **12 m, 1.7 m and 0.17 m**, with weights **0.40, 0.35, 0.25**.
For every lattice vertex and band, separate uint32 hashes feed Box–Muller:
`u=(uint+0.5)/2^32`, avoiding `log(0)`. The trig expression transforms a hash
sample, never a periodic spatial coordinate. Four Gaussian vertex values are
interpolated with positive smoothstep weights, then divided by
`sqrt(sum(weight²))` **before** applying an explicit normal CDF.

Under an ideal independent-Gaussian seed model, this produces a uniform rank
conditional on any fixed point/interpolation weights. It is an **ensemble**
statement, not exact area/mass in each realised cell or viewport. The
implementation uses deterministic pseudorandom hashes and float32 GPU maths;
their approximation is measured, not asserted to be a proof of independence.
The normal CDF approximation is independently checked by quadrature.

This replaces R2's area-calibrated curved cells, whose shared high-rank
boundaries still made visible ribbons. There are no trigonometric coordinate
shears, forced rank-one cell boundaries, or homothetic-cell patterns in R3.
Gaussian values and their first derivatives are continuous across cell edges.
Different bands use different vertex/lane salts. A final integer avalanche on
the layout-seed hash removes the lane correlation found by the first ensemble
test; the initial failed 3.119% bound is kept in the ignored pre-avalanche log.

Each existing probability is allocated one contiguous rank interval. Circular
box convolution filters that interval, including wraparound and probabilities
0/1. Its integral is still the input probability. A constant two-times footprint
guard is an explicit rank-space antialiasing approximation. Each band tends continuously to its input
fraction when unresolved; all bands equal the input by a 3 m footprint. This
is a declared rank-space filter, **not** an exact ray/pixel area integral or a
claim of perfect antialiasing under every perspective.

A common achromatic gamut gain uses only the original target, original
probabilities and min/max source component colours. The same gain applies to
**every** possible outcome; it never reads the realised rank/delta. The active
mean is `originalTarget + S × (localPhysicalMean − originalPhysicalMean)`,
not a mixture of asset means. This preserves the original sRGB8 knot target
and keeps the correction within the existing display gamut. Photo maps remain
registered zero-mean residuals; those residuals fade to zero when unresolved.
The 3 m probability/alpha horizon is returned directly, avoiding weighted
float32 roundoff.

The linear band mixture preserves nonnegative fractions and their total. Low
cover may total below one, preserving bare support. Expected premultiplied
recipe colour follows those same masses; colours are not renormalised to force
a photograph. Finite viewports can contain different proportions of patches.
Conservation is a seed-ensemble/probability statement and an exact unresolved horizon,
not a requirement that every 10 m crop have the regional average colour.

## Frame, budgets and provenance

World-space cells stay fixed when the camera moves or a source patch refines.
Double-precision origin subtraction/modulo happens before shader float32
coordinates. Three `vec4` uniforms contain fractional origins and integer-cell
origins modulo 4096: **48 bytes, no new raster image**. A versioned layout
seed comes from `world.seed` and the band/lane, never the camera, request or
current world-id. Its fraction and integer carry are transported together.
This is a non-cryptographic visual seed, not a source/candidate identity. Individual bands have a
finite 4096-cell hash period; the complete multi-band pattern repeats only beyond this
40 km source. Float32 phase/local-coordinate rounding remains a declared
representation limit, not new observed source information.

The data contract is `SurfaceDetailDistribution.metadata()` and is exposed in
`metrics.renderSourceVersion.materialDistribution`. Diagnostics 21/22/23 show
the local procedural ground mixture, local low-cover opacity and local composed
material mean separately from the retained physical diagnostics.

`surface-low-cover-geometry-2` replaces only aerial shrub/debris spheres with
authored multi-stem leaves/twigs and fallen leaves/twigs. They are botanical
approximations, not scanned plants. Source-sized normalised support stays
bounded. Four variants per family use at most **210 triangles/shrub** and
**54 triangles/debris instance**, with the same existing candidates and every
20-float transform/colour/custom-data record byte-identical. There are at most
eight shared meshes, approximately 152 KiB of vertex streams plus existing
instance buffers. Grass retains its existing CC0 asset and candidate count;
trees/boulders are untouched. Twig/leaf PBR is an explicitly approximate reuse
of the existing grass/litter surface maps, not a new leaf-scan claim.

Clockwise triangle winding is tested against outward normals. That fixes the
front-face inversion seen in R1. These shader/mesh changes can increase GPU
work and draw calls; no performance or interactive QoS claim is made before
measurement. Prototype source remains isolated from the frozen user demo.

## CPU checks and remaining validation

Nine Node tests cover independent Gaussian-CDF quadrature, vertex/band moments,
conditional seed-ensemble distributions, recipe-slot/corner-order invariance,
nonrepetition and cell-edge continuity, probability 0/1 and wrapped filters,
seed-block recipe fractions, zoom/tile/rebase at ±1e9 m, shared JS/GD phase bytes
and the common-gain counterexample with 100,000 extreme-colour draws.

For 32,768 pseudorandom layout seeds at three fixed points and three bands, the
maximum empirical CDF error is **0.006679**; adding the pointwise 95% DKW
half-width gives **0.014182** (1.419 percentage points). That DKW statement
assumes independent seeds and is **not** simultaneous confidence over all
profiles or a rigorous confidence certificate for the deterministic hash.

A separate 64-seed/four-filter test uses 512 spatial positions per seed, with
uncertainty computed across seed blocks, not by pretending correlated spatial
positions are independent. Its maximum mean error is **0.006616**; maximum
error plus the seed-block 95% interval is **0.013680**. The realised min/max
fractions are retained in the log. No exact per-patch mass is claimed.

The GD CPU test passes **7439 assertions** for eight meshes: bounded support,
finite unit normals/tangents, clockwise/front-face agreement, exact source IDs
and instance-buffer slices, plus nine byte-exact phase fixtures shared with JS.
The extreme-colour test keeps a deliberately different target with maximum
measured mean error 0.000552662; the unresolved target bits are exact. Targeted TypeScript strict checking and GD main
parse pass. These are small CPU checks, not native visual or FPS qualification.

After ROOT hands back the GPU, the same retained V15 source/camera will be used
at 2560/160/40/10 m. The native check must reject source/inventory/buffer changes,
keep diagnostic-7 pixel identity, inspect actual shrub/grass/litter appearance,
and preserve the negative R1 and R2. Version 3 is not ready for artistic acceptance
until those images have been produced and reviewed.
