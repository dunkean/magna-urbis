# CHMv2 canopy statistics: Render3D forest calibration

A bounded, reproducible measurement of canopy structure in public canopy height
maps. It grounds the procedural Render3D forest parameters. It is **not** a
trained model and does not run in the application.

## Data

- **Product:** Meta / World Resources Institute global canopy height map v2,
  `dinov3_global_chm_v2_ml3`, AWS Open Data `dataforgood-fb-forests`. Licence
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Location:** one Cloud-Optimised GeoTIFF per zoom-10 quadkey:
  `https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/<quadkey>.tif`.
  `metadata/<quadkey>.geojson` lists the imagery acquisition dates.
- **Format:** uint8 heights in whole metres, EPSG:3857.
  - Mercator pixel 1.1943 m; ground pixel 1.1943·cos(latitude) m.
  - Heights are **model estimates from Maxar RGB imagery**, not lidar. The
    method of the earlier v1 product is in
    [Tolan et al. 2024](https://doi.org/10.1016/j.rse.2023.113888).
- **Sample:** 8 sites in 4 biomes, 2 windows of 1024 m × 1024 m (ground) each,
  read as HTTP range requests (about 5 MB in total).
  - Sites are flux towers or permanent plots: Fontainebleau and Hainich
    (temperate), Hyytiälä and BOREAS NSA (boreal), Manaus K34 and Danum
    (tropical), Majadas de Tiétar and Tonzi Ranch (Mediterranean savanna).
  - The second window lies 1.5 km east. At Danum it lies 1.5 km west instead:
    the east window contained a flat rectangular fill artefact.

## Files

- `chm_stats.py`: downloads the windows and computes the statistics.
- `quicklook.py`: renders contact sheets for visual inspection.
- `chm_reference.json`: compact per-biome medians, ranges, pooled quantiles and
  1 m height histograms. This is the only result kept in the repository.

Raw windows (`.npz`), the full `report.json` and the contact sheets go to an
ignored output directory. For each window, the report records its URL, ETag,
pixel window, longitude/latitude box, image dates and the SHA-256 of the uint8
array.

## Run

The command uses an existing Python environment with numpy, scipy, rasterio,
pyproj, shapely, requests and Pillow. Run it from a neutral directory with
`-I`:

```text
python -I chm_stats.py ../../../web/out/render3d-forest/chm chm_reference.json
python -I quicklook.py ../../../web/out/render3d-forest/chm
python -I chm_stats.py --summary ../../../web/out/render3d-forest/chm/report.json chm_reference.json
```

## Statistics

All statistics are computed per window.

| Statistic | Definition |
|---|---|
| Cover | Fraction of pixels with CHM ≥ 2 m (also ≥ 5 m). |
| Height distribution | Percentiles and 1 m histogram of canopy pixels (≥ 2 m). |
| Gaps | 4-connected components of CHM < 2 m. Reported as area fractions in < 100 m², 100 m²–1 ha and ≥ 1 ha classes. |
| Gap-size exponent | Continuous power-law MLE above 10 m² ([Clauset et al. 2009](https://doi.org/10.1137/070710111)). |
| Autocorrelation | Normalised radial autocorrelation by FFT. Reported for the 1 m CHM (e-folding and first minimum, up to 60 m) and for 4 m block means (e-folding, up to 400 m). |
| Tree tops | Connected plateaus of local maxima of the CHM smoothed by a 1 m Gaussian, in a 5 m window, above 5 m. They give tops per hectare, mean spacing and an equivalent disc radius `√(canopy area / (tops·π))`. |
| Stand variability | Standard deviation of cover and of mean height in 32 m blocks. |

## Limits

- CHMv2 is smooth. It merges narrow crowns and fills small gaps: no gap under
  2 m appears in the tropical windows. Tops per hectare are therefore lower
  bounds and crown radii upper bounds, especially for conifers.
- Mosaic seams and changes in image date occur inside some windows.
- Sixteen windows show the order of magnitude of differences between biomes.
  They do not establish ecological accuracy for any region.
- The windows are centred in woodland, so cover is biased towards forest.
  Openings of 1 ha or more include roads, rides, fields and wetlands that lie
  within the windows.
