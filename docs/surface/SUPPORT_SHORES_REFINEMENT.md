# Sparse conifers, support profiles and continuous coastline

This iteration extends intermediate terrain from `338efaf`. It adds discreet tree cover in favourable cold/mountain areas, differentiates ground-detail shapes, and fixes stepped beaches and repetitive water textures. Hydrological fields and DEM are retained.

## Conifers: separate, measurable supplement

`forest_placement.py` retains the original filtered field in `forest-base-field.png`. The `montane-forest.png` supplement describes its own cover, height, conifer proportion and tone. It is merged into `forest-placed-field.png` using weighted canopy moments. Attributes of cells without supplement remain identical; in a shared cell, attributes represent the mixture of both covers. The 1334→1024 reduction also interpolates these moments, avoiding dilution of edge conifer height with empty pixels into small shrubs.

The suitability proxy uses local temperature, moisture, soil thickness, matrix, fragments, slope and geomorphons. Local annual temperature +11 °C is a declared favourable-season proxy, not simulated summer temperature. Hollows and footslopes are favoured as a topographic-shelter proxy; no wind field is claimed. Theoretical maximum cover is 6%, with no filling target where terrain is ineligible. Heights: 4.5–9 m; conifer proportion: 97%.

Ridges, slopes ≥32°, very thin soil, deposits with high fragment fraction, water, beaches and dominant snow are excluded. Exposure is the maximum of the Render guide and N1. A physical 100–170 m margin and conservative reduction protect crown support and sub-pixel vector rivers.

Crown GLSL remains that of pinned original Render. The supplement's colour guide uses its conifer palette. Mean contribution is added only to the model's unresolved branch: it does not tint ground between nearby crowns. The same mean accompanies the distant reference, without sudden appearance while zooming.

Measured prepared additional cover: about 0.93% of the cold-hills tile, 0.47% of the cold plateau and 0.074% of temperate mountains. Snow-dominated cold mountains remain without supplement. Across four close cold-hills control framings, actually rasterised cover is about 1.85%.

## Support-specific shapes within the same envelope

`meso-profiles.png` contains a convex RGBA8 blend: massive rock, layered rock, fragments, remaining soft support. Lithological fractions, weathering, fragment roundness and colluvial potential determine weights. Their quantised sum is exactly 255, without threshold material selection or changing the map's selected PBR variants.

The 27 m band uses these profiles: asymmetric bumps for massive rock, more pronounced shoulders for fragments, oriented elongated forms for layered rock, smooth response for other supports. Orientation is read from the structure field at four fixed anchors of 256 m patches. Heights and their gradients are blended with weight derivatives; rotating coordinates by a variable axis would have produced shear.

Other 64 / 9.5 / 3.75 m bands remain shared. A deterministic envelope on a 150 m grid gently modulates amplitudes between 76% and 100%, without directly drawing coloured patches. Its gradients pass through native context. Profiles replace part of the existing field: the total envelope remains ±3 m, with the same picking and culling bounds.

Colour and roughness follow these forms with weak modulation. PBR detail, snow and outcrop/fragment budgets remain retained. Cache adds a decoded 7,118,224-byte profile image per tile; CPU also loads the native RGB structure needed for the same calculations as GPU. Geology, structure and profile hashes are checked at loading.

## Beaches and water at multiple scales

`prepare_surface_water.py` produces a separate signed coastal field for sea and lakes. DEM crossings of sea or lake level position contours inside cells rather than always bisecting their edges. Signs at native centres are constrained; interpolating B-spline coefficients are then stored at 16 bits per distance, to 1/32 m.

The shader reconstructs this continuous contour and antialiases according to pixel footprint. Tests cover a one-cell island/lake, one-cell isthmus and channel, separation of two lakes and a known diagonal coast. The validator checks reconstructed signs at every centre on all 42 tiles. This is display reconstruction: simulation levels, bed and masks remain unchanged.

The Render transition uses two maps derived from dry/wet colours, with certified donors, separate components and bounded search. A small component without an interior donor retains its own colours. Correction is limited to a 60–120 m coastal band and respects vector-river priority. Both maps carry `source_color`, like the Render map, to avoid a second interpretation of their sRGB RGB as linear values.

Water now uses procedural world-coordinate gradients at 233 / 61 / 13 / 2.7 / 0.6 m scales. Each band fades when unresolved; roughness approximately compensates for lost fine detail. Old ripple files remain historical prepared resources, but the current shader no longer repeats those two images as its main pattern.

Sea and lakes have wind drift. Rivers use three fine bands advected downstream in four fixed 64 m frames, with derivatives of height-blend weights. Time therefore does not multiply the spatial gradient of a variable flow field. Water amplitude and geometric levels are unchanged: this spectrum affects appearance and normals.

## Reconstruction and controls

After N1–N4 data and original exports are already present:

```powershell
python godot-render/tools/forest_placement.py
python godot-render/tools/prepare_mesoscale.py
python godot-render/tools/prepare_surface_water.py
python -m unittest discover -s godot-render/tools -p 'test_*.py'
python godot-render/tools/validate_mesoscale.py
python godot-render/tools/validate_surface_finish.py
./Test-Render.ps1 -Check
```

Preparers accept `--tile <id>`. Derived data and reports remain outside Git. Godot tests, without `--headless`:

| Test | Control |
| --- | --- |
| `montane_forest_test.gd` | Rasterised canopy, no mean tint on nearby ground, distant contribution, identical image after zoom |
| `meso_support_test.gd` | 1,440 CPU/GPU points, pure/mixed profiles, frame boundaries, gradients and bounds |
| `meso_support_view_test.gd` | Captures with/without profiles, four supports, temporal stability |
| `water_surface_test.gd` | Distinct sea/lake, near/far shoreline, colour decoding, multiscale spectrum, flow at 0/60/3600 s |

Existing geometry, normals, material, transition, cover, shadow/snow, palette and navigation tests supplement these controls.

GPU comparison uses commit `338efaf`, ABBA protocol at 1280×800, 30 warmup frames and 45 measurements. `prepare_meso_baseline.py` extracts earlier sources, rebuilds their amplitudes and redirects only their caches and base forest field; native data and palettes are shared. Results concern viewport GPU time, excluding loading. Final figures are reported in [TERRAIN_MESOSCALE.md](TERRAIN_MESOSCALE.md).

[Original French version](SUPPORT_SHORES_REFINEMENT_FR.md).
