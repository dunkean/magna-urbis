# Close-range rock: projection and detail at bounded cost

This iteration makes outcrops more legible at distances of a few metres, especially on slopes. It reuses existing PBR photographs, geological profiles and mesh. No new asset or prepared context is required.

## Slope projection

Each photographic patch receives a tangent frame fixed to its world anchor. The reference slope comes from four native DEM reads; the frame gradually transitions from the XZ plane to the tangent plane between 25° and 55°. Actual fragment height contributes to coordinates, avoiding vertical stretching of photographs on slopes. The three existing stochastic patches continue blending with fixed rotations.

Screen derivatives follow this projection to select mipmaps. PBR normals are reconstructed from their gradients and transported into the current physical frame using the warp Jacobian. A neutral normal map thus preserves the terrain normal. The frame does not depend on the camera; structural angles remain fixed to the patch anchor.

The PBR read count is unchanged: three patches per material, colour, normals/roughness and height. Full triplanar projection would have multiplied those reads. Here only four additional RF reads per active mineral patch construct the frame.

Projection and detail gain is determined by native recipe: transition between 35% and 65% rock/fragment support. The four neighbouring responses remain interpolated without interpolating material IDs. DEM reads are avoided for weak mineral traces, water and pixels with footprints over 8 m, where photographs are already blended out.

## Moderate detail

- The 3.75 m geometric band receives a slightly more angular profile on massive/stratified rock: `1.4*n - 0.4*n³`, blended by native profiles. No extra noise; full CPU/GPU gradients and total ±3 m displacement envelope are retained.
- Existing oriented grooves use an 8 × 2.5 m carrier and material depth bounded to 10 cm. They modulate normals and cavities; they do not displace the mesh or create real geometric occlusion. Their four noise evaluations are reused.
- Photographic normals gain at most 35% strength, with contrast compensation bounded during patch blending. Already-read PBR height very slightly modulates colour and roughness. Existing zoom filters retain a gradual transition to distant Render.

## Validation and measurements

Astra High review: no blocker identified. `rock_chart_test` checks 56 cases on planes from 0° to 80°, two azimuths and two warps: metric UVs, derivatives, neutral and tilted normals, then final normals from the actual terrain shader. Maximum final-normal error: 0.00555 in RGB8 readback.

`rock_detail_view_test` captures a lit native slope of 56.58° at 40 m and 160 m widths, plus a synthetic plane at 80°. Images are stationary when idle and identical after a zoom/pan round trip. A local 2.5 cm pan yields P99 RGB change of 0.01176. This checks a local area; it is not a constructed test crossing a recipe boundary.

The benchmark compares commit `69527c79913afef13d60ab9174134831b07c5957` to current code with identical palettes and cameras: ABBA order, 60 warmup frames then 120 measurements, RTX 4090, Vulkan Forward+, 1280×800, without VSync. Values are means of medians from each version's two passes.

| Case | Before, GPU | After, GPU | Difference |
| --- | ---: | ---: | ---: |
| Native slope 58.45°, width 40 m | 3.157 ms | 3.131 ms | −0.026 ms |
| Same slope, width 160 m | 3.712 ms | 3.882 ms | +0.170 ms / +4.6% |
| Same slope, width 1.8 km | 4.332 ms | 4.367 ms | +0.035 ms |
| Forest, width 1.8 km | 9.944 ms | 10.192 ms | +0.249 ms / +2.5% |
| Grassland, width 1.8 km | 5.060 ms | 4.582 ms | −0.478 ms |
| Water, width 1.8 km | 4.363 ms | 4.156 ms | −0.208 ms |
| Distant view, width 65 km | 1.356 ms | 1.378 ms | +0.022 ms |

Synthetic rock planes cost an extra 0.03–0.13 ms; the maximum relative increase is +13.2% on the flat plane at 160 m. Gains in some cases are not a general guarantee. Measurements cover the GPU viewport, not loading or total latency, and are specific to this hardware and these scenes. No additional triangles or persistent textures are introduced.

Reproduce after preparing the usual local data:

```powershell
python godot-render/tools/prepare_meso_baseline.py
godot --path godot-render --script res://tests/rock_chart_test.gd
godot --path godot-render --script res://tests/rock_detail_view_test.gd
godot --path godot-render --script res://tests/rock_detail_benchmark.gd
```

Tests using `frame_post_draw` require a rendered viewport, without `--headless`. JSON reports, P95, palette hashes and captures remain in `godot-render/evidence/`, outside Git. Existing regressions cover gradients, actual triangles/picking, transitions, snow, water, shadows and canopy.

[Original French version](ROCK_CLOSE_DETAIL_FR.md).
