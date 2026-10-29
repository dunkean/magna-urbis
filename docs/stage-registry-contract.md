# Generation stage registry contract (V2)

Shared by the V2 UI (`web/src/v2/stageRegistry.ts`) and the scientific atlas
(`docs/scientific/index.html` EN, `docs/scientific/fr.html` FR). Every stage id
below has a UI row with a discreet "?" linking to `scientific/<lang>.html#stage-<id>`
(EN page: `index.html#stage-<id>`, FR page: `fr.html#stage-<id>`). Ids are stable;
if an implementation discovers a stage is wrong or missing, update this file first.

`when` = availability condition (source/backend). `opt` = can be toggled off.

## Relief
| id | name | when | opt |
| --- | --- | --- | --- |
| relief-source | Source: procedural / neural (browser or Python) / imported heightmap / library heightmap; seed, width, scale, backend | always | no |
| relief-mask | Custom mask (zones, brushes, import/export) | procedural | yes |
| relief-grids | Grids and buffers | procedural | no |
| relief-noise | Initial noise and uplift | procedural | no |
| relief-regional | Regional evolution (uplift, drainage, incision, thermal, diffusion) | procedural | no |
| relief-relax | Final regional relaxation | procedural | yes |
| relief-reconstruct | Reconstruction (bicubic / B-spline, domain warp) | procedural | no |
| relief-calibrate | Amplitude calibration (p99) | procedural | yes |
| relief-detail | Ridged detail | procedural | yes |
| relief-surface | Surface erosion | procedural | yes |
| relief-datum | Datum normalisation (p1) | procedural | yes |
| relief-phasor | Phasor detail | procedural | yes |
| relief-neural-coarse | Neural coarse diffusion | neural | no |
| relief-neural-base | Neural base diffusion | neural | no |
| relief-neural-decoder | Neural decoder / amplification | neural | no |
| relief-heightmap-fit | Heightmap fit (resample, vertical scale, datum, crop) | heightmap / library | no |
| relief-conditioning | Posterior fluvial conditioning | always | yes |
| relief-aeolian | Aeolian transport | always | yes |
| relief-coasts | Coasts (marine mask, coastal erosion) | always | yes |

## Water and natural cover
| id | name | when | opt |
| --- | --- | --- | --- |
| water-hydrology | Hydrology: depressions, lakes water budget, drainage graph, rivers, riverbed cuts | always | yes |
| cover-climate | Climate and biomes / natural cover (forest) | always | yes |

## Settlements
| id | name | when | opt |
| --- | --- | --- | --- |
| settle-sites | Site placement and urban reserves | after relief | no |
| settle-hierarchy | Place hierarchy | after sites | no |
| settle-roads | Regional roads (cost fields, A*, bridges) | after sites | yes |

## City (per selected place)
| id | name | when | opt |
| --- | --- | --- | --- |
| city-composition | Composition: footprint, macroplan, harbour, fortification | city | no |
| city-quarters | Quarters: streets, split, blocks, bridges | city | no |
| city-trim | Trim of unbuilt blocks | city | yes |
| city-parcels | Parcels (cadastre) | city | no |
| city-programme | Programme allocation (roles, demands) | city | no |
| city-buildings | Building sites and massing | city | no |
| city-houses | Architecture / detailed houses | city | yes |

## Display
| id | name |
| --- | --- |
| display-terrain | Terrain shading and palette |
| display-water | Water |
| display-vegetation | Vegetation |
| display-roads | Roads and ground |
| display-buildings | Buildings (2D/3D, LOD, colours) |
| display-labels | Labels and icons |
