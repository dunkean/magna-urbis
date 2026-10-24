# Independent CPU tree-optical review

The optical-mean LUT prepared by `ffa0328` / `7ec8d78` passes the requested ±2 percentage-point stationary marginal check. This is a CPU result, not renderer or artistic acceptance. A separate pre-fix camera/filter counterexample is retained below; it requires a certified whole-view geometry guard or matching filters before a general C/V claim.

## Independent measurements

The test independently implements FNV/mixing and the actual canonical 20 m, 32-slot generator, with its jitter, acceptance, uniform 4–18 m heights, radius=0.42×height, yaw, rank and variants. It compares all 692,224 potential candidate records and IDs against the unchanged TypeScript generator, including negative cells and seeds. Two seeds additionally exercise all twelve actual generator density selections: all 24 accepted inventories, attributes and IDs match exactly. The process-source hashes equal those recorded by the asset calibration.

Eight seeds each supply 200,000 independent spatial queries in a 1 km² interior domain. Real neighboring candidate cells and the actual root-pivot 1024² A8 mask determine coverage, using bilinear data sampling followed by the declared 0.5 cutout. A minimum acceptance value at each covered query permits all density thresholds to share the same physical realization; this is not `cover × isolated-mask mean`.

Intervals use variability between eight independent seeded process/probe realizations, rather than only a binomial point-sampling error. The additional 95% simultaneous twelve-density interval uses Student t7 with Bonferroni correction (critical 4.174314971). This is approximate large-area inference, not a pointwise finite-page guarantee.

| Envelope potential | LUT optical mean | Monte Carlo optical mean | Absolute error + simultaneous 95% half-interval, percentage points |
| --- | --- | --- | --- |
| 0 | 0 | 0 | 0 |
| .005 | .001120 | .001088 | <.04 |
| .02 | .004480 | .004738 | <.07 |
| .05 | .011322 | .011519 | <.06 |
| .10 | .023107 | .023339 | <.12 |
| .20 | .048249 | .048169 | <.14 |
| .35 | .090895 | .089538 | <.28 |
| .50 | .141873 | .140710 | <.32 |
| .70 | .232544 | .230563 | <.40 |
| .85 | .339488 | .337140 | <.44 |
| .95 | .477539 | .474398 | <.55 |
| 1 | .747236 | .744675 | .594475 |

The LUT is not statistically unbiased: at potential .95, its error is about +.3141 percentage points relative to Monte Carlo. This small measured bias remains well within the requested bound; the audit does not refit the LUT or change candidate acceptance. At potential 1 the original generator saturates at expected envelope cover .998535, not an invented full-coverage population.

## Coordinate, data and C/V checks

The minZ-first A8 is byte-identical to the prepared top PNG alpha and agrees with the independently decoded GLB's projected bounds. The rooted GLB has maximum horizontal radius .999999985; its bottom-stem median XZ is approximately (-.00102209,.00053497) in normalized coordinates. The small measured vertical fit residual is retained. There is no crown-bounding-box recentering or new root placement.

Native headless CPU checks compare 6,160 mask addresses/coverage/classifications against an independent four-term Python interpolator: zero classification mismatches, maximum coverage difference 2.3432e-8, input buffer unchanged. Another 1,010 radius/bin cases cover both endpoints and ties; 28 LOD-weight cases pass.

The stable WIP canopy function (`f70f8314…`) is compiled verbatim except for removal of its global class registration. Its actual CPU C/count atlas matches 5,000 independent rotated-mask texels, including selected versus unselected trees and all four bins. Exact pure plan/instance-buffer methods from the WIP library (`b2f0497e…`) preserve all thirty test IDs under a 14-high/16-middle budget, and preserve root positions after scalar-double rebasing at ±10⁹ m. No ImageTexture, imported mesh render or GPU is used.

The Monte Carlo realizations also test rank thresholds .2/.5/1, four phases and five physical pixel footprints. V≤C and residual reconstruction hold with a common positive filter applied **after** each per-texel count response. A negative control with counts [0,4] gives filtered C=.5, correct filtered V=.46875, but incorrectly averaging counts before pow gives V=.75>C.

## Pre-fix filter/camera counterexamples

The shared shader permits C mip levels above three while selected V is capped at three. If geometry is active at footprint/atlas-spacing>8, those kernels need not match. The actual mask/layout provides a CPU counterexample at spacing .03125 m, footprint 1 m, phase 1: C level 5 versus V level 3 gives V−C up to .587899 at 2,408 of 50,000 queries. Matching both at level 5 gives no overshoot. Clamping V to C is not a proof that actual geometry and paint conserve coverage.

`main._canopy_guard` already contains a ratio>8 phase cap. However, its prior maximum comes only from the four viewport corners. The actual Camera3D/SurfaceCanopyView CPU probe finds a missed maximum at the far-edge midpoint in oblique views. With the current main oblique direction ratio (.73/.68), camera=(0,55,51.2328758), FOV48, viewport200×125 and a valid spacing .25 m atlas, the guard reports ratio5.62248/phase2 while pixel(100,0) reaches ratio8.49990. Its frustum plus the existing 128 m request padding fits the corresponding .25 m atlas construction. The height50 control stays below the actual bound (ratio7.72304).

These are preserved pre-certificate counterexamples, not claims that any prior 2048-pixel capture reached the condition. The viewer owner is formalizing the maximum/certificate and immediate geometry-zero state. Validation of that subsequent fix is separate; the archived evidence does not silently adopt it.

## Reproduce

From `web`:

```powershell
node --import tsx scripts/export_tree_process_audit.ts --out out/surface/tree-optical/generator
```

From the repository, with the resolved prepared asset cache (read-only):

```powershell
python viewer-local/tools/audit_tree_optical_mc.py --prepared PREPARED --generator web/out/surface/tree-optical/generator --out web/out/surface/tree-optical/mc --points 200000
python viewer-local/tools/qualify_tree_optical_mc.py --prepared PREPARED --input web/out/surface/tree-optical/mc/report.json --out web/out/surface/tree-optical/qualified
godot --headless --audio-driver Dummy --path viewer-local --script tests/tree_optical_independent_test.gd -- PREPARED ABSOLUTE_ORACLE_JSON ABSOLUTE_NATIVE_REPORT [ABSOLUTE_STABLE_WIP_CANOPY_GD]
python viewer-local/tools/audit_tree_filter_limit.py --prepared PREPARED --oracle web/out/surface/tree-optical/qualified/native-oracle.json --out web/out/surface/tree-optical/qualified/filter-limit.json
godot --headless --audio-driver Dummy --path viewer-local --script tests/tree_footprint_corner_probe.gd -- ABSOLUTE_REPORT main-ratio 55
```

The [versioned evidence](evidence/tree-optical-independent-v13.json) retains the exact asset/process/WIP hashes, Monte Carlo realizations, intervals, native checks and counterexamples. The LUT is a homogeneous top-down optical marginal. Sharp density gradients, finite-page local coverage, oblique parallax/silhouettes, BRDF, energy and shadows are outside this statistical qualification. Geometry C/V and whole-frustum continuity still require their renderer controls. No canonical treeCover, seed, source, ID, rank or acceptance algorithm was changed, and no runtime profile was enabled by this audit.
