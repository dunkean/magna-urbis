# Continuous ground response

Compiler `surface-1.6.0` adds an optional, grouped `groundResponse`. It reconstructs physical parameters before evaluating the bare-ground recipe. It does not interpolate a baked colour across a nonlinear recipe boundary. Low cover, canopy, heightfields, source hydrology, lithology contacts, physical soil fields and candidate inventories retain their existing values.

This addresses the artificial 78.125 m colour contours observed in the retained V12 regional ground diagnostic. It supplies a continuous inferred response to coarse evidence, not observed fine soil or geology. An actual refined source heightfield and its geometry-support constraints remain separate in `SurfaceGeometryDetail`.

## Contract and interpretation

The group carries a fixed canonical grid, source identity, environment/material versions, a SHA256 identity, and seven typed columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `alluvial` | Float32 | Original HAND/distance/slope-based alluvial support potential |
| `gravity` | Float32 | Original routed colluvial potential and physical decay law |
| `wind` | Float32 | Declared aeolian supply, constrained by slope |
| `coastal` | Float32 | Effective declared coastal sediment potential |
| `aridity` | Float32 | Original precipitation/temperature ratio; finite and nonnegative, possibly above one |
| `moisturePreSaturation` | Float32 | Original moisture response before standing-water saturation |
| `rockRecipe` | Uint16 | Discrete recipe consistent with source rock/process evidence |

The first five fraction-like potentials other than aridity are bounded to [0,1]. The existing stoniness, slope in radians and organic fraction are also interpolated before the recipe. Substrate, transported source, rock recipe and occupation remain nearest categories. Crop retains its declared cultivated recipe. Occupation does not invent paving. Colour for exposed rock uses its source lithology; transported gravity material uses the transported rock source.

The evaluator first partitions rock versus remaining support, then the latter into soil/deposit processes, and soil into mineral/humus/arid components. Partitions are within the ground layer. Herbs and trees are not competing fractions of this partition.

The original stored primary/secondary IDs, blend and sRGB8 mean are returned at exact canonical knots. Between knots the full recipe mixture supplies linear mean colour; a deterministic top-two pair supplies compact PBR recipe selection. This preserves node evidence. The possible knot discontinuity is explicitly bounded by the stored sRGB8 half-step plus Float32-potential rounding; it is not hidden by smoothing. The independent authored corpus measured a maximum linear RGB norm difference of 0.00186044 near its knots.

`interpolation` is `bilinear-physical-before-recipe`; `quantization` is `float32-potentials; uint16-recipe; stored-srgb8-at-canonical-knots`. The group version is `surface-ground-response-1`, and its identity namespace is `gr-sha256-1:`. Source/native spacing and the canonical grid spacing are both retained; they describe different things.

## Identity, compatibility and bounds

The SHA stream frames strings by UTF16LE byte length and typed columns by dtype and byte length, with UInt32LE lengths. Numeric grid/source metadata uses Float64 bytes. Pure synchronous TypeScript SHA256 is checked against Node crypto at padding boundaries, random chunk boundaries, offsets and the real 6,815,744-byte column size. Native `HashingContext` consumes the same framed stream. The existing generic fingerprint and physical context version remain unchanged.

Absent legacy groups remain absent and retain their prior binary/field values. A partial group, wrong type, Float32 overflow, edited hash, source/frame/version mismatch, or incompatible water/seasonal/vegetation ground recipe is rejected. No group is reconstructed from legacy top-two colours during hydration. `groundResponse:false` explicitly compiles the prior optical path.

Canonical compilation stores 26 additional bytes per sample: 6,815,744 bytes at 512². The compile/hydration memory estimate includes them before allocation. Retargeted worlds borrow the canonical table; compact known-context packets omit it. The native adapter prepares three RGBAF images, 48 bytes per sample (12,582,912 bytes at 512²), and reuses the validated immutable context/images. The native canonical group currently accepts at most 1,048,576 samples. The existing 512 MiB binary packet bound is retained.

## Native presentation

`surface_ground_response.gd` validates the group and prepares textures; `ground_response.gdshaderinc` evaluates the same response law. The ground shader consumes the resulting compact pair and physical mean. Aerial mode uses source/recipe linear colours. Cartographic and blueprint modes still use `SurfacePresentation`'s presentation palette by recipe; a physical brown mean does not replace a blue mapper palette. Diagnostic 7 deliberately reports the intrinsic physical mean in every presentation. Low cover, canopy and city geometry/style branches are unchanged.

The authored native CPU suite checks JSON/binary, canonical/refined worlds, rebasing by ±10⁹ m, strict errors, legacy fallback, colour roles, framing and response-law parity. Its 1,935 assertions pass; maximum mean-channel difference versus TypeScript was 5.69e-8, blend difference 5.56e-17. Blueprint/aerial profile bindings and headless shader-language parse/reflection pass. These are not GPU numerical or artistic acceptance claims; GPU regional/source-detail checks are a separate root-controlled step.

## Reproduction

From `web`:

```powershell
node --import tsx scripts/generate_ground_response_fixture.ts --out out/surface/ground-response-fixture
npx vitest run surface
```

From the repository, using the Godot executable selected for the native viewer:

```powershell
godot --headless --path viewer-local --script tests/ground_response_test.gd -- ABSOLUTE_FIXTURE_DIRECTORY
godot --headless --path viewer-local --script tests/ground_response_shader_parse.gd
godot --headless --path viewer-local --check-only --script scene/main.gd
```

`augment_retained_ground_response.ts` is an **explicit diagnostic replay**, not automatic migration. It requires an original canonical packet and a declaration that no external process masks were supplied. It recomputes the actual original alluvial, gravity, aridity and moisture parameters from the retained physical context/climate/source, requires all four original ground arrays to match exactly, and preserves every original field, terrain, source archive and candidate record. It refuses refined/cropped inputs needing unknown original canonical compile parameters. The only population metadata change is the declared canonical context binding, because the derived response has a new identity.

```powershell
node --import tsx scripts/augment_retained_ground_response.ts --source ORIGINAL_CANONICAL_PACKET --out NEW_DIRECTORY --processes-none
node --import tsx scripts/benchmark_ground_response.ts --world NEW_DIRECTORY/packet.surfacebin --legacy ORIGINAL_CANONICAL_PACKET --out DIRECT_CPU_REPORT.json
```

For retained V12, all 52 prior fields and nine prior versions remain unchanged; the output is 91,626,289 bytes versus 84,802,873 original bytes. Its new response and compiler/context identities are declared. This replay is neither fresh generation nor a reconstructed original initializer byte stream.

Direct Node retarget medians after reducing per-sample allocations were 84.262 ms for 128² and 1,301.822 ms for 512², versus 84.685/1,317.518 ms for the corresponding legacy control in the same alternating run. The earlier unoptimized response measured 110.677/1,713.370 ms. Ten thousand sampler cases matched the frozen pre-optimization implementation exactly; a valid saturated-fraction interpolation roundoff case is handled separately. These wall spans do not attribute historical scheduler pauses or establish browser/native navigation latency.

Native framed SHA alone measured 63.768 ms for 512², versus the previous interpreted four-lane hash microprobe at 1,331.455 ms. Full retained packet decode/validation measured 15,186.870 ms with the response and 14,909.644 ms for the legacy control; neither span is isolated response CPU. Cold image preparation measured 791.256 ms, while 100 known-context validate/prepare calls took 0.937 ms total with the same image references. These single-run measurements are retained as observations, not latency guarantees.

## Bounded GPU control

The frozen OWN snapshot `c8db2a642f5df72272c156723746441d2d2a7563` was then checked on the actual NVIDIA RTX 5090 reported by Godot/Vulkan. All 592 selected runtime file hashes, tracked status, source packet hashes and asset-manifest hash remained unchanged. Ten native processes exited successfully and no owned Godot process remained.

The numerical probe runs the same pure GLSL function with the native adapter's RGBA32F textures and Float32 output buffers. It evaluates 2,573 points across canonical/refined grids and rebasing by ±10⁹ m, including every authored canonical knot and nearby points. It does not use an 8-bit screenshot as a numeric oracle.

| Measurement | Maximum |
| --- | --- |
| Mean linear RGB norm error away from knots | 2.383e-7 |
| Mean linear RGB norm error at/near quantized knots | 0.00212012, within the per-point stored sRGB8 half-step bound plus Float32 allowance |
| Compact blend difference | 1.251e-6 |
| Compact recipe ID mismatches | 0 |
| Independent blue presentation palette channel difference | 2.384e-8 |

The real Terrain3D adapter also produced four visibility states and diagnostic 7 for retained legacy and GR packets at both 10 km and 160 m, plus blueprint, aerial-oblique and a second 160 m same-category transect A/B. All 24 PNGs are 2048×1280. `--ground-only` deliberately excludes source-water meshes/Decals and all population instance meshes; these controls do not qualify actual tree/grass geometry. Terrain, ground arrays, geometry detail, inventories and instance-buffer fingerprints stay identical between toggles and between the corresponding A/B views. The new GR/context identity remains explicitly different.

The 10 km A/B shows the earlier rectangular baked-colour steps becoming parameter-derived continuous contours. Coarse regional structure and actual categorical substrate contacts remain. Blueprint remains blue through its recipe presentation palette. Diagnostic 7 emits the intrinsic physical mean, but the existing aerial filmic display transform remains active before PNG8-bit output. Thus the PNGs compare displayed contour shape; the separate Float32 compute probe supplies linear numerical parity.

No spatial script/shader error occurred. The isolated compute harness preserves an `OpArrayLength` reflection warning and three ObjectDB instances reported at process exit in its logs; this is not represented as production-renderer behaviour or silently removed. Known Terrain3D deprecation warnings are also retained. A subsequent independent audit identified a microscopic synthetic-slope Float32(PI/2) validation boundary; fix `b18d100` is separate and is not included in this frozen GPU snapshot.

The versioned [bounded evidence](evidence/ground-response-v13.json) records exact replay/PNG hashes, CPU measurements, numerical outputs and limits. These checks qualify this response implementation's numerical/rendered behaviour within the stated controls. They are not a browser/native navigation campaign, a latency guarantee, observed fine-soil data, or independent artistic/full-production acceptance. V12's prior artistic failure remains historical evidence; this implementation does not retroactively qualify its images.
