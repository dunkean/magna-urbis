# Explicit Orogen / NeuralEarth regional context

`web/src/surface/adapters/regionalCompiler.ts` exposes
`compileRegionalSurfaceWorld(regionalPackage, mapping, options)` independently of
the web renderer and Godot. The same resulting SurfaceWorld serves the mapper,
city editor, existing styles and optional native adapter.

`options.terrain` preserves a primary Infinite Generation heightfield and source
identity unchanged. Regional climate/geology are sampled in that terrain's
explicit shared frame. Fine heights are never invented from climate or replaced
with noise. The caller must reproject external packages before import; the current
compiler accepts east/up/south (+Z azimuth 180 degrees) with square metric cells.

## Upstream audit (read only, 2026-10-23)

Audited `infinite_map/native/orogen/pipeline.mjs`, `PROVENANCE.md`,
`vendor/temperature.js`, `vendor/precipitation.js`,
`backend/terrain_orogen.py`, `terrain_orogen_stages.py` and `terrain_pedology.py`.
The headless original Orogen pipeline writes `graph.json` + `fields.f32`;
the Python pipeline writes NPZ `height_m`, `physical_ocean`, `layer_*` and metadata.
Graph positions lie on a unit sphere; persisted atlases are pixel-centred,
40,000,000 by 20,000,000 procedural metric equirectangular maps (+Z south).
This atlas is distorted geographically, particularly near the poles. It does not
become a surveyed local CRS merely because values are expressed in metres.

Original temperature is normalized `(T + 45) / 90` and already includes a
moisture-dependent altitude correction. Original rainfall is p95-calibrated to
1,000 mm **per half year**; values may exceed one. Summer + winter give the
annual rainfall. These are procedural climates, not observations.

Neither audited Orogen output exposes explicit lithology or a directed hydrology
graph. Plates/crust/uplift are not lithology. The existing pedology uses climate
and regional parent noise, and its three fractions are sand, clay and **humus**;
humus must never be relabelled silt. Consequently this importer requires an
independent categorical geology layer, explicit code-to-rock mapping and sourced
rock catalogue. It refuses to synthesize that missing information.

## Conversion and import

The exporter reads existing NPZ files or original headless graph directories. It
never writes upstream code, models or caches. Python needs NumPy; graph input
also needs SciPy. Graph conversion uses declared nearest spherical regions and
records the true approximate region spacing (sphere area / region count), even
if the output raster is finer. It applies the audited original elevation-to-metre
conversion; it adds no relief.

```powershell
python web/scripts/export_orogen_region.py SOURCE.npz region.surfacebin --crop 1000,500,32,32
# Or a genuine original headless graph:
python web/scripts/export_orogen_region.py GRAPH_DIRECTORY region.surfacebin --seed 374192 --atlas-width 256 --crop 130,50,8,8
cd web
npx tsx scripts/import_regional_surface.ts region.surfacebin mapping.json result.surfacebin --geology explicit-geology.surfacebin --report import-report.json
```

`--terrain primary.surfacebin` imports regional context onto an existing primary
heightfield. Its unchanged coordinates must explicitly share the regional frame.
The CLI does not rotate or translate a primary source implicitly.

The mapping has `format: "surface-regional-mapping"`, `version: 1`, `height`,
`geology: {layer, catalogue: {id, version, provenance, units, codeToUnit}}`, and
`climate`. Orogen exporter field names are `height`, `temperatureSummer`,
`temperatureWinter`, `precipitationSummer`, `precipitationWinter`; set
`climate.elevationPolicy="preserve-source"` for this climate. An optional
`correct-to-target` policy requires an explicit source elevation-reference layer;
it applies the declared lapse once. `compiler-lapse` accepts only source
temperatures explicitly marked uncorrected.

When exported, `waterClass` uses source codes 0=dry, 1=ocean. Set
`hydrology: {waterClass:"waterClass", waterCodeToClass:{"0":0,"1":3},
waterLevel:"waterLevel", boundary:"truncated"}`. Procedural sea level is zero;
dry levels remain NaN. Aligned imported downstream indices are supported, but
indices cannot be interpolated. Without them the compiler reports its D8 fallback
and truncated catchment limitations explicitly. All unit conversions, source keys,
season flags, native spacings, georeference and upstream features survive in
`world.regionalSource`. The binary container keeps typed numeric arrays.

## Executed proof and limits

Ran the genuine original Node Orogen pipeline in read-only source mode, with seed
374192 and 20,000 requested regions (20,001 returned), output only into this
worktree's ignored `web/out/surface/orogen-proof/`. Generated graph SHA256:
`dbd86d036a22633992a8532ab0069beb2f609238c4c40e32c32ec984d5478829`.
Converted a native 8x8 atlas crop (156,250 m cells, approximate true graph spacing
159,572.923 m), then ran the binary import CLI successfully. The proof used a
separate explicitly authored granite **test scenario**, labelled accordingly;
it is not evidence of lithology provided by Orogen. No planetary generation,
geology survey, hydrological calibration or fine climate accuracy is claimed.

Behavioral tests cover physical units, rainfall totals, explicit rock contacts,
altitude correction once, primary height/source preservation, georeference and
coverage rejection, directed-index alignment, budgets, climate identity and abort.
Remaining scientific approximations are reported in each exported world: midpoint
annual temperature, spatial-mean seasonal amplitude and interpolated coarse context.
