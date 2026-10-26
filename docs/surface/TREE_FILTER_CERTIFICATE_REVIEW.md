# Independent follow-up: tree filter certificate

The finite-step filter certificate in viewer commit `4a1b6c2d2bc51170cf47b15158ff5ed0fafa15ee` addresses the CPU counterexamples preserved in [the initial review](TREE_OPTICAL_INDEPENDENT_REVIEW.md). No blocker was found in this bounded mathematical/caller review. This conclusion does not qualify GPU leaf silhouettes, oblique C/V energy, performance or artistic output.

Reviewed `surface_canopy_view.gd` SHA256:
`72001db30f19b7451b24f29f549b77efa93723ee85f9eb3fac2a4bcd36d43b59`.
Reviewed `main.gd` SHA256:
`db7a063dfc5ba01a451e38f8969c87027a5869f640f43c4ae1867ef515a1ae3f`.

## Derivation

On the fixed reference plane, write the clip-coordinate functions as
`W=a*x+b*z+c`, `X=d*x+e*z+f`, `Y=g*x+h*z+j`. The exact one-metre east screen difference has numerator

```
(sx*((d*b-a*e)*z+d*c-a*f),
 sy*((g*b-a*h)*z+g*c-a*j))
```

and positive denominator `W*(W+a)`. Its numerator norm is affine-vector norm in z. The code minimizes that norm analytically over the whole z interval, including an interior minimum. South is the corresponding affine-vector norm in x. W extrema occur at rectangle corners, so `Wmax*(Wmax+abs(a or b))` bounds the denominators when all unit-step endpoints stay in front of the camera. The constant-W-axis cancellation is exact. Combining the two bounds is conservative; it does not mistake corner sampling for a complete maximum.

The real-arithmetic derivation is sound. The additional .1% plus 1e-6 m Float32 allowance is explicitly recorded and empirically checked; this review is not a formal IEEE754 proof for arbitrary ill-conditioned matrices. Invalid/degenerate projections disable geometry. Yaw/roll may produce a deliberately loose bound.

## Independent reruns

The independent probe dynamically loads the exact reviewed module, changing only its global class registration. It queries 97² viewport positions at two height planes per case. The prior counterexample files remain unchanged.

| Camera / viewport | Actual maximum / active spacing | Analytic bound / active spacing | Certified phase |
| --- | --- | --- | --- |
| Main direction, h55, 200×125, spacing .25 | 8.499904 | 8.599237 | 1: geometry off |
| Generic 45°, h100, 200×125, spacing .5 | 9.232835 | 9.293349 | 1: geometry off |
| Main direction, h50, 200×125, spacing .25 | 7.723038 | 7.821614 | 2: geometry permitted |

All 56,454 queries stay below the analytic maximum. Repeating these cases with the asset's 32 m height envelope supplies another 56,454 covered queries and the same decisions. The latest main code uses 32 m for the asset profile in both atlas requests and active guards, covering the declared 28.8 m maximum instance AABB; legacy retains 20 m. The earlier 20 m observation was made before that change and is not an open finding against this commit.

The certificate uses the **active** atlas spacing/grid, including a stale atlas, rather than requested future resolution. If the filter budget is exceeded, global phase≤1 makes geometry weight=max(phase−1,0)=0 while the full optical C representation remains. Source IDs and cover fields do not change. `min(C,V)` is not used as the mathematical justification.

Actual pure phase/material-weight methods were also executed with CPU parameter recorders. Six cases combine pending/no-pending atlas with delta0/.016/1. Terrain, high, middle and retired geometry all receive zero immediately after a cap, including delta0; there is no delayed fade that leaves incompatible geometry visible. Main source was unchanged during the test. Static review confirms all high/middle/retired material surfaces are registered in the common update list. These recorders are not a GPU uniform-upload/visibility test.

## Reproduce

From the repository, using the prepared viewer source path under review:

```powershell
godot --headless --audio-driver Dummy --path viewer-local --script tests/tree_footprint_corner_probe.gd -- ABSOLUTE_REPORT main-ratio 55 ABSOLUTE_REVIEWED_VIEW_GD 32
godot --headless --audio-driver Dummy --path viewer-local --script tests/tree_footprint_corner_probe.gd -- ABSOLUTE_REPORT main-ratio 50 ABSOLUTE_REVIEWED_VIEW_GD 32
godot --headless --audio-driver Dummy --path viewer-local --script tests/tree_footprint_corner_probe.gd -- ABSOLUTE_REPORT generic 100 ABSOLUTE_REVIEWED_VIEW_GD 32
godot --headless --audio-driver Dummy --path viewer-local --script tests/tree_filter_phase_independent.gd -- ABSOLUTE_REVIEWED_MAIN_GD ABSOLUTE_REPORT
```

The [follow-up evidence](evidence/tree-filter-certificate-independent-v13.json) records the six projection runs and actual-method phase cases. In the initial filter counterexample, the diagnostic field `phase=1` means **geometry weight 1**, corresponding to global phase2; it does not describe the safe global phase1 paint-only state. The statistical optical-LUT qualification and all historical pre-fix counterexamples remain separate and unchanged. No GPU or Blender execution occurred in this follow-up.
