# Source-bound native solar shadows — experimental controls

This is a partial correction after the [V15 review](../../reviews/phase06-followup-v15.md),
not a new campaign or artistic acceptance. Use `--tree-shadow-mode native-solar`
with a verified tree product and Forward+. Default remains `optical`. No source
heights, physical fields, candidates, IDs, sizes, yaw or ranks are changed.
Cartographic glyphs do not use this product.

## What changes

The old near shadow translated the TOP canopy texture by one9.8m reference
height and multiplied terrain colour. The new path renders the actual corrected
high asset from the current sun direction into32 yaw views. Each1024² RG16F
image stores solar depth and source cutout, not beauty colour. A constant0.25
channel verifies the HDR/readback transfer before packing; measured readback was
linear HDR. Leaf alpha uses the source0.5 threshold. Branches remain opaque.

The complete source tree page supplies rootXYZ, height and orientation. It is
independent of the colour geometry's10,000 retention budget. Radius/height must
equal0.42 within1e−6; a different ratio is refused rather than stretched into an
incorrect sun frame. Yaw quantization is at most5.625°. The real mesh AABB's
enclosing sphere must fit the bake support, including depth.

Shadow-only MultiMeshes use the same native backend as buildings/terrain. The
fragment reconstructs the source surface along the sun axis and writes native
shadow depth; it is not a flat billboard at an average height. This uses Godot's
[shadow-only casting](https://docs.godotengine.org/en/stable/classes/class_geometryinstance3d.html)
and [spatial fragment depth output](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html).
Colour meshes keep casting OFF to avoid duplicate shadows.

The viewport guard includes the entire receiver rectangle, actual loaded
receiver minimum and maximum of transported positive-kernel source controls.
The catalogue's18m height limit and the asset's conservative normalizedY≤1.3
bound potential upstream casters. This23.4m **support bound** never substitutes
for the individual root/height/depth when rendering. A missing page, source,
epoch, compatible asset/sun or covered halo gives whole-view optical fallback.
There is no local page-edge shadow fade. Native transfer is also capped by
the exact optical phase, avoiding exact-position shadows over a wholly meso
canopy. A transient whole-view transfer is not an energy-conserving transport
claim. At full native weight, the old colour multiplication is zero.

The final code also honours the same renderer-private unsupported-tree mask as
C/V, reports its exclusions separately and retains the source count/records.
No rank thinning is applied. Maximum budget is100,000 casters /200,000 triangles
**per shadow pass**; multiple cascades can repeat their work. Submitted counts
are not GPU occlusion counts. The page-wide AABB deliberately includes false
positives, and invisible shadow support does not raise the TOP camera.

## Existing GPU evidence — before final ledger hardening

[proof.json](proof.json) records actual commands, native file maps, input hashes,
camera matrices, source/colour-buffer comparisons and the unmodified source
components. The retained V12 replay SHA is
`e9646f0aadfc2d69cac78e64977389201ff8ef87360ff2f52f72bc37cb079d2c`:
67,221 trees on the complete4km page, original local40m child/grid0.625m,
native0.46875m, real78.125m parent elsewhere. No new Neural generation,
registration or fine soil observation occurred.

| Control | Actual result |
| --- | --- |
| TOP160m | 67,221 native casters /134,442 triangles, versus402 colour impostors; native weight1, optical shadow0 |
| TOP640m | Same complete caster inventory, native weight1; source/C/V/colour buffers unchanged |
| Oblique160m at the preserved1eee framing | Phase2, complete native shadows active; source/C/V/colour buffers unchanged |
| Blueprint160m | Four visibility PNGs exactly identical between flags; no solar bake/instances |
| Source high versus solar-depth proxy | Two sun angles, flat and sloped receivers; ground-shadow IoU0.944–0.953 |
| Receiver through the crown at8m | Depth IoU0.896–0.906, versus0.474–0.777 for the preserved planar negative |

The real high-shadow reference uses the same source geometry and cutout, with
double-sided casting matching the bake. The last control demonstrates actual
light-pass depth, but not exact3D transport. Bias, rasterization, yaw and finite
resolution errors remain; these figures are not the earlier±2pp TOP C/V gate.

The native camera projection is identical in every paired source control.
Terrain/parents/context/ground/detail/inventory and actual **colour** instance
buffers match. Coverage/count/normal/colour C/V image bytes match. With trees
disabled, entire PNGs match, including non-tree shadows. Images were opened:

- [TOP160 before](top160-before.png) / [after](top160-after.png)
- [TOP640 before](top640-before.png) / [after](top640-after.png)
- [Oblique before](oblique160-before.png) / [after](oblique160-after.png)
- [Blueprint unchanged](blueprint160-after.png)
- [Raised reference](raised-reference.png), [depth proxy](raised-solar-depth.png),
  [planar negative](raised-planar-negative.png)

The large grey TOP texel blocks are replaced by detailed native leaf silhouettes
and native shadow colour. Shadows can still dominate sparse crowns. The upper
right oblique green sheets/streaks remain visible: **not corrected or accepted**.
Five-view colour/parallax,29° normal difference and roughness0.9 versus source
mean0.4755 remain distinct limitations. At focus20000/20000 the old oblique
reference-plane guard stays phase0; that failed native-activation test is
preserved, not relabelled as success.

Actual GPU was RTX5090/Forward+, Godot4.7.2/Terrain3D1.0.2, Dummy audio. The solar
texture is128MiB; two-angle standalone bake times were about2.02/2.04s, retained
runs about1.7–2.0s. Full native processes took24–35s including load, preparation,
five images and readback, not FPS or navigation latency. No shader/runtime error
occurred; the existing Terrain3D deprecation warning remains.

## Final CPU guards and memory are a later stage

The captures above use the recorded `c479952`, `c5071d6` and `93ac5b1` native file
maps. Initial clean flags and per-run file-map equality are recorded; continuous
whole-worktree cleanliness was not attested. Unused diagnostics were prepared
separately during the sequence. Final crop, source/scene binding, private support
exclusions and budget hardening came afterwards and are **CPU-tested, not an
integrated final GPU qualification**.

The oblique2GiB known-working-buffer ceiling now adds a named feature ledger.
Solar accounts128MiB persistent texture plus bounded old/new source arrays,
ID references, CPU/server/upload/GPU instance rows and8MiB metadata reserve.
Copy/grow factors are explicit upper accounting allowances, not measurements of
undocumented engine allocation or RSS. ROOT's native raster transient reserve
must be added, not substituted. A formerly passing near-limit oblique plan may
now refuse. No source coarsening, silent quality drop or raised ceiling is used
to disguise this. TOP and the complete process remain outside an RSS guarantee.

CPU442 solar assertions and888 visibility-plan assertions pass; main parses.
The fully offscreen-source GPU boundary probe and final integrated budget/render
rerun are tracked separately. User demo processes always have GPU priority;
the owned-run watcher marks interruption incomplete and never stops that app.

No full fresh campaign, temporal pan/zoom qualification, artistic pass or default
profile change is claimed. Historical V13/V14/V15 verdicts and all negatives
remain intact.
