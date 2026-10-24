# Inferred soil and low-cover detail â€” R4 candidate

`surface-detail-distribution-4` is an isolated renderer experiment. It arranges
existing physical recipe probabilities at12m,1.7m and0.17m; weights are
0.40/0.35/0.25. It adds no DEM, observed lithology, soil evidence, water,
population density or candidates. Ground, low cover and canopy remain separate.

R1, R2 and R3 are preserved **artistic failures**, despite their source/mean
invariants passing. See the three `soil-cover-distribution-r*.json` evidence
files. R3's ordered intervals of a single Gaussian rank still formed ribbons.
The authored CPU model comparison is in `soil-detail-model-comparison.json`.
It is not a retained-source PBR or native-quality proof.

## What and where

The shader exposes the same eight internal GR contributions: source rock,
residual mineral soil, humus, dry surface and the four source-compatible
transport processes. The existing parameters constrain their probabilities;
no random RGB chooses a geology. Exact stored GR knots/top-two ids and means
are untouched. No canonical field, height, source version, seed, candidate id,
acceptance, radius, position or instance-buffer record changes.

On the actual retained V15 focus20000/20000, the ground is approximately
21.86%source rock and78.14%mineral soil. The other six contributions are zero,
not fabricated for variety. Existing low-cover opacity is about41.12%, split
between grass/litter recipes independently of the ground and trees.

## R4 spatial law

For each recipe/band/lattice vertex, independent hash lanes feed Boxâ€“Muller
with `(uint+0.5)/2^32`. Positive separable cubic B-spline weights reconstruct
16 Gaussian vertices; division by `sqrt(sum(weightÂ²))` occurs **before** the
normal CDF. Under ideal independent Gaussian seeds the rank is uniform at
any fixed point, including different interpolation phases.

A hard exponential race selects `argmin(-log(U_i)/p_i)`. It has categorical
probabilities `p_i` under that ideal ensemble. There is no ordinal material
interval, softmax, temperature or random RGB multiplier. Low cover includes
an explicit uncovered outcome, so its mass can remain below one. Recipe ids
are deduplicated before sampling and determine stable low-cover field channels.

Four positive spatial taps at(Â±footprint/4,Â±footprint/4), each weight1/4,
reduce pixel aliasing. Each tap has the same ensemble probabilities. A smooth
blend to the original probabilities uses **only** footprint/band scale, from
scale/8 to scale/4. Fully unresolved bands and zero-probability recipes skip
their Gaussian work. At a3m footprint the original probabilities/opacity are
returned directly. This is not exact pixel-area quadrature or exact realised
patch mass. The finite GPU CDF floor is1e-7; deterministic hashes and float32
rounding require measured validation, not an independence claim.

The active colour remains `originalTarget + S*(localPhysicalMean-originalMean)`.
The common achromatic gain S depends only on the original target/probabilities
and component colour extrema, never on the realised race outcome. All15 PBR
inputs and registered means/scales remain unchanged; their existing zero-mean
residuals fade at their own metric horizon. Probability closure at3m is distinct
from the larger PBR-map filtering horizon. Diagnostic7 remains the old physical
mean;8/9/11/17 keep their physical cover meanings.21/22/23 expose renderer detail.
Cartographic palette paths are unchanged.

## Frame, support and budgets

World seed/origin transport uses three vec4 uniforms:48bytes, no new raster.
Double modulo/subtraction occurs before shader float32; the same9 JS/GD phase
fixtures cover0 andÂ±1e9m. Hard category boundaries can move within representation
rounding, not source/candidate identity. The finite4096cell hash period is
explicit; the combined metric-band repeat exceeds this40km source.

The naive correctness-first race has a worst case1728 Gaussian vertex evaluations
per pixel (9 outcomesÃ—3bandsÃ—4tapsÃ—16vertices). Real inputs skip zero recipes and
closed bands; this is **not** a performance or interactive-QoS claim. No image
allocation is added. Shrub/debris remain the same authored4variants/family from
R2 (210/54triangles), with corrected winding and unchanged source buffers.
The next visual test hides all objects, trees and engine shadows to qualify
only ground+low-cover texture; it does not qualify these meshes botanically.

## CPU checks and native gate

Five new tests cover C2 value/derivative seams, empty/full/uncovered support,
exact closure, input immutability, seed-ensemble recipe fractions, finite gamut,
original target retention andÂ±1e9m phase reconstruction. At8192seeds/fixedpoint,
the largest measured fraction error is0.305pp; error plus a pointwise95%standard
error is0.823pp. This assumes ideal independent seeds and is not simultaneous
confidence or exact mass in a deterministic patch. The low-cover test is an
authored41%case, not an exact extraction of every retained low recipe fraction.
Nine earlier calibration tests and7439 GD mesh/phase assertions also pass.
Targeted TS checking and GD probe parse pass. The short real native40m check ran next; it is not an artistic PASS.

`preview_retained_ground_race.ts` generates mean-only CPU previews from actual
saved GR fields at40m. It does not render PBR/normal/lighting and explicitly
reports its sampling/footprint mismatch. The next native gate is a short40m
TOP test, no objects/trees/shadows, four A/B no-trees/diagnostic7 images. Source,
context, GR, inventory and buffers must remain exact; diagnostic7 must match.
The user demo always has priority through a one-second owned-process watcher.


## First real R4 texture-only image

[The short native40m proof](evidence/soil-cover-distribution-r4-40m.json) records
4PNG in41.989s, exit0, no engine errors, no user-demo hit and no owned survivors.
Frozen runtime/source hashes, all source/buffer fingerprints and raw-mean pixels
are exact across A/B. All objects, trees and engine shadows were hidden.
R4 removes the ordinal contour ribbons and C1 square cells. Its real PBR image
still has broad camouflage-like green/brown patches. It remains an experimental
soil renderer, not an accepted artistic result or a replacement for Render.
Only this one pose was captured; no longer campaign or new terrain was used.
