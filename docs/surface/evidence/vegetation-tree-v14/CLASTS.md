# Bounded source-rock clast preview

This renderer follow-up replaces aerial boulder glyph meshes with six irregular
procedural clast variants,80triangles each. It is not a scan, an observed rock
shape or a new population. Variant choice is stable FNV1a over candidate ID and
the existing variant number; camera, source/tile versions and ranks do not enter
it. All original prepared MultiMesh rows (including position, size, yaw, rank and
linear source color) are copied byte-for-byte. Source arrays/acceptance are not
edited. Existing visible support adjustments, if any, are not changed.

Each mesh fits the old declared box XZ`±0.5`, Y`±0.35`, centred at the old pivot.
The existing buffer's`+0.35×size` elevation therefore retains its original bottom.
Clockwise triangles and outward facet normals produce irregular clasts instead
of a uniformly shaded low-sided sphere. No shape enlargement, re-seating, scatter
or budget increase is hidden in the change. At most80triangles per existing
boulder are submitted; the existing2000-instance family cap is unchanged.

The material is selected from **sourceRock**, not the dominant soil/alluvial ground
recipe. Source geology unit IDs and lithology choose carbonate-karst for limestone,
volcanic-crust for basalt, fractured-bedrock for other/unknown units. Canonical
source-rock RGB is already in the unchanged instance color buffer. Runtime-only
batch metadata names the source unit IDs, recipe, real loaded asset, physical scale,
fallback and renderer version. Cartographic glyphs/palette paths remain unchanged.

## Shared PBR and coordinate policy

The existing material library exposes its loaded color/height and normal/roughness
texture arrays, registered linear means and authored physical extent. No map is
downloaded, resized to a boulder or reclassified as geology. Missing photography
uses the existing explicit analytic-neutral fallback. Height remains a registered
sampled channel and is **not** geometric displacement.

The terrain hash/rotation/noise/stochastic sampler block was extracted verbatim
into`pbr_stochastic.gdshaderinc`. Its canonical-LF SHA256 is
`ff3fb479583f5341e23ea6dd026342d49e45c7705411f1e2dfba201bddc59f2c`.
Expanding that include reconstructs the full original terrain uniform source from
ROOT`1eee770` byte-for-byte after line-ending normalization, SHA256
`9828e6c4a4a1fa8d7d505579f82c84d62a5cda122c9ff51086cf67c71586391d`.
No terrain formula, texture weight, source field or material response is changed.

Clasts use triplanar coordinates in physical metres, anchored at their own centre
with a stable renderer-variant phase. `mat3(MODEL_MATRIX)*VERTEX` excludes translation
before projection, so large-world rebasing cannot move the texture pattern. It is
world-oriented at each clast centre, not a claim that photo grains follow the
geological strike or align continuously with terrain texture. All maps share the
same stochastic coordinates/rotations/weights and explicit derivatives.

The sampled color residual is centred on the registered photo mean. Its amplitude
is analytically bounded by target source-rock RGB and the available0..1range,
rather than an empirical darkening gain. It preserves the target mean in the
registered zero-residual limit and avoids a clamp-induced tint. Finite stochastic
realizations and physical lighting need GPU checks; exact finite-image RGB equality
is not claimed.

NormalGL perturbations use an inverse-transposed geometric normal, transformed
tangent/binormal and Gram-Schmidt orthogonalization under nonuniform scale. Alpha
uses the **main camera** view/projection/viewport uniforms in both visible and
shadow passes; no light-camera LOD can resurrect a hidden rock shadow. Ground-layer
visibility still controls all boulders independently of low cover and trees.

## CPU evidence and current limits

`tests/surface_clast_test.gd` checks six deterministic/distinct80-triangle meshes,
legacy bounds/pivot, outward CW winding, nonuniform normal/TBN math,100retained IDs,
18material/variant groups, byte-exact20-float instance rows, source lithology,
JSON/binary variant equivalence, rebasing, real resource/physical-scale binding,
linear vector mean uniforms, range bounds and the exact sampler extraction.
`diagnostics/check.gd` parses the native addon/shader anchors. These are CPU/parser
checks, **not** GPU art, roughness/normal-direction or shadow-pass qualification.

```powershell
godot --audio-driver Dummy --headless --path viewer-local --script tests/surface_clast_test.gd
godot --audio-driver Dummy --headless --path viewer-local --script diagnostics/check.gd
```

No GPU was used while ROOT reserved its oblique/fresh campaign. After its explicit
release, the following real-source controls were performed. Shrubs, debris and
other legacy glyphs remain intentionally outside this small lot.

## Dedicated GPU controls

[clasts-gpu.json](clasts-gpu.json) records six sequential runs, baseline frozen
`1eee770` versus`a5993fe`, with actual native source hashes before/after each run.
The small diagnostic wrapper was untracked during the runs and is explicitly
included in those maps. Source/terrain-asset manifests and the pinned Rust height
batch executable are checked unchanged at the end. ROOT itself was never edited.

The same retained V13 packet is used throughout, focusing on existing candidate
`1905266606:boulder:2001:1998:1`: position20014.029683487024 /19983.486032686196,
size2.380960226m, sourceRock4 **mudstone**. No boulder was added or moved. Actual
rendered groups retain five existing instances and use the already loaded `rock`
asset via `recipe:fractured-bedrock`, with the manifest's actual physical extent
**8m**. The fallback was not used. Other lithology-to-recipe mappings are covered
by CPU tests, not falsely presented as separately rendered source cases.

TOP8m and OBLIQUE8m show the changed shape/grains and real engine-cast shadow.
The captured images were opened: surfaces are irregular/textured, but flat facets
remain conspicuous at this very close scale. This is a bounded procedural preview,
not photogrammetry or final artistic quality. Cartographic blueprint keeps the
original glyph, with all four visibility states pixel-identical.

For **each** pose, source/ground/GR/parent/detail/inventory fingerprints and all
non-boulder instance buffers are unchanged. A dedicated `no-boulders` state hides
boulder nodes **and disables their casting** in both profiles: the entire resulting
image is pixel-identical, proving the terrain sampler extraction did not alter
the surrounding render. Ground/no-trees states that still contain boulders are
not incorrectly required to match. All family instance counts stay unchanged.

Actual adapter: RTX5090, Forward+, Godot4.7.2 / Terrain3D1.0.2, Dummy audio. All six
runs completed with no shader/runtime errors; the existing Terrain3D deprecated
interpolation warning remains. The explicit native height sampler SHA is
`1d2c1652ff6711c1a6c78677d3c6158bd497c93e1fad5a5609c952aef7a4f6ec`.
Process durations19–24s include initialization/five captures and are not FPS.
No full navigation or fresh-generation qualification is claimed. The rock is
fully resolved in this view; subpixel shadow-fade thresholds and an independent
GPU normal-direction oracle were not exercised. CPU math/code checks cover the
main-camera fade and inverse-transpose construction without relabelling them GPU
proof. All processes exited and the GPU was explicitly released.

- [TOP before](clast-top-before.png) / [after](clast-top-after.png)
- [Oblique before](clast-oblique-before.png) / [after](clast-oblique-after.png)
- [Blueprint unchanged](clast-blueprint.png)

`web/scripts/surface_clast_gpu.mjs` reproduces the six controls with separate
`--before` /`--after` worktrees, `--world`, `--assets`, `--godot`, `--height-batch`,
`--style-catalogue` and `--out`. It uses only the retained packet, verifies runtime
hashes, preserves raw failures, and does not generate or modify source data.
