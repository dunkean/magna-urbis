# Regional water: source contours and occlusion

The actual `native-e2e-40km-v5/fresh-source.surfacebin` packet is read without mutation. The test generates no network and raises no water levels. Retained Magna contours remain authoritative for the map; the validated physical raster serves a different representation. The old `resolvedBedConflicts` field counts only cells of that raster, not contour vertices.

## CPU diagnostic

`viewer-local/tests/surface_hydrology_visibility_test.gd` passes with the real packet and an explicitly synthetic control fixture: a surveyed polygon below a flat bed remains complete despite an entirely dry physical raster. Source levels, classes and geometry are unchanged.

| Requested view | Displayed groups | Triangles without level | Probes below bed / probes | Maximum probed Δ |
| --- | ---: | ---: | ---: | ---: |
| 10,000 m | 702 | 0 | 2,670 / 4,087 | 46.0716 m |
| 2,560 m | 59 | 0 | 3,647 / 3,961 | 27.8235 m |

These probes are deterministic, bounded to 4,096 vertices and **not area-weighted**: they measure neither pixel percentage nor flow. The 10 km view's cache window here covers the entire 40 km source. It represents 48,038,663.75 m² after GPU conversion versus 48,038,668.53 m² for double-precision source triangulation. It uses 719,184 vertices and 480,887 sweep visits, below respective caps of 999,996 and 12,000,000. No fallback or missing level causes the observed breaks. One exactly duplicated source group is deduplicated only for display.

## Forward+ / RTX 4090 GPU control

Standalone probe `viewer-local/diagnostics/hydrology_source_map_probe.gd` displays the same real contours and levels in a vertical 10 km view, 1024² pixels. Control terrain is a mesh reconstructed on CPU from the packet; **this is not proof of Terrain3D integration**. The blue palette is diagnostic, not a final style. Results are in [gpu-report.json](gpu-report.json).

| Representation | Water pixels |
| --- | ---: |
| Source contours alone | 6,495 |
| Source levels subject to terrain depth | 263 |
| Overlay without depth test | 6,495 |
| Decal projection limited to terrain (`cull_mask=1`) | 6,495 |

Projection retains the reference GPU footprint exactly (zero differing pixels) and paints no water pixels on the layer-2 control roof. Direct overlay instead paints **52 water pixels on that roof**. It remains a diagnostic / texture-preparation tool and is not an acceptable final resolution for the urban map. Source-map mode must project onto terrain only; physical water retains its levels and explicit conflicts. Moving source levels or contours is not an occlusion solution.

Background coverage textures must come from `groundMaterial*`, which excludes water recipes, to avoid retaining blue cells behind source contours. The original safety raster remains archived unchanged.

At this scale, one pixel represents approximately 9.77 m: some narrow reaches remain sub-pixel in the reference itself. These results therefore do not prove continuous legibility of every watercourse. Any minimum cartographic width must be declared as display width, separate from physical width. Already-documented limits of flattened source contours and invalid rings remain; no topological repair, flow conservation or equivalence to a hydraulic survey is claimed.

## Viewer projection module

`SurfaceWaterProjection.bake(parent, geometry, origin, focus, widthM, colors, options)` is a GPU coroutine to call on the scene thread. `geometry` is the result of `SurfaceHydrology.prepare`; `river`, `lake`, `sea` and `fallback` colours are **linear Vector3s**. `options.sourceKey` is required. Options bound resolution to 64–2048 (1024 default) and declare canonical `minHeightM`/`maxHeightM` of the projected volume. `msaa` can be 0, 2, 4 or 8. No minimum stroke is applied.

The result contains `texture`, `bounds`, `worldCenter`, `position`, `size`, `cullMask=1`, `cacheKey`, `diagnostics`, or an `error` field. The caller retains its cache, rejects stale-generation responses and creates the Decal with `create_decal(result, currentRenderOrigin)`: rebasing thus also applies to cached textures. The SHA-256 cache depends on geometry bytes, classes, coverage, palette, window and resolution. Compatibility does not support Decals, so this backend returns an explicit error; the caller must retain a declared fallback.

The production module's GPU control is distinct from the regional proof above: it is a **declared synthetic fixture**, with water at −20 m, terrain at 0 m, roof at 10 m and canonical coordinates around 10⁹ m. It passes on Forward+ / RTX 4090: decoded tint within one byte, contour alpha, exact rebase before Float32, intact red roof and unchanged source. See [projection-module-report.json](projection-module-report.json). The CPU cache control separately checks class, coverage, source identity, scale and canonical position changes. Bake time of 137.7 ms applies to the 256² fixture and does not measure regional production performance.

[Original French version](README_FR.md).
