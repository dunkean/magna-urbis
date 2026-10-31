# Generation stage registry contract (V2)

Shared by the V2 UI (`web/src/v2/stageRegistry.ts`) and the scientific atlas
(`docs/scientific/index.html` EN, `docs/scientific/fr.html` FR). Every stage id
below has a UI row with a discreet "?" linking to `scientific/<lang>.html#stage-<id>`
(EN page: `index.html#stage-<id>`, FR page: `fr.html#stage-<id>`). Ids are stable;
if an implementation discovers a stage is wrong or missing, update this file first.

`when` = availability condition (source/backend). `opt` = can be toggled off.

2026-10-29 (V2 staged UI): `relief-refine` added (the fractal refinement controls had no stage);
`relief-conditioning`, `relief-aeolian` and `relief-coasts` narrowed to the sources where the
engine applies them. `city-trim` and `city-houses` are optional in the contract, but the engine has
no independent switch yet: the UI shows a locked switch with the reason.

The V2 sidebar has four sections: **Region** (relief, water and natural cover),
**Settlements** (placement and regional roads), **Cities** (urban construction for all
places or a checked subset in the right-hand list), and **Map** (appearance,
naming and export). Climate and the land/sea mask are initial conditions in Region's
top frame; biome remains a separate choice. The late coast row only exposes procedural
coastal finishing. Stage ids remain stable for atlas links and progress attribution.

2026-10-31: `relief-coast-cut` separates the initial land/sea deformation from
coastal finishing. It follows initial noise by default and can move after regional
relaxation, amplitude calibration, ridged detail, surface erosion or normalization.
The final geographic cut remains in coastal finishing to preserve a coast.
Retained checkpoints expire from the first changed computational dependency.
The stage LED is grey when disabled, green for an available valid output, orange
when an output is missing or outdated, and pulses while that stage executes.

## Region — initial conditions and relief
| id | name | when | opt |
| --- | --- | --- | --- |
| relief-source | Source: procedural / neural (browser or Python) / imported heightmap / library heightmap; seed, width, scale, backend | always | no |
| relief-climate | Input climate: preset, temperature, seasonality and precipitation | not classic | no |
| relief-mask | Custom mask (zones, brushes, import/export) | procedural | yes |
| relief-grids | Grids and buffers | procedural | no |
| relief-noise | Initial noise and uplift | procedural | no |
| relief-coast-cut | Coast formation (movable; after initial noise by default) | procedural | yes |
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
| relief-refine | Fractal refinement (slope-dependent detail below the source cell) | procedural / neural / heightmap (not classic) | yes |
| relief-conditioning | Posterior fluvial conditioning | procedural (the posterior operators read the decomposed procedural recipe) | yes |
| relief-aeolian | Aeolian transport | procedural (same recipe) | yes |
| relief-coasts | Coastal finishing (land/sea mask in the top frame; zero cycles disables coastal erosion) | procedural | no |

## Region — water and natural cover
| id | name | when | opt |
| --- | --- | --- | --- |
| water-hydrology | Hydrology: depressions, lakes water budget, drainage graph, rivers, riverbed cuts | always | yes |
| cover-climate | Natural cover: forest and clearings (reads the input climate) | always | yes |

## Settlements
| id | name | when | opt |
| --- | --- | --- | --- |
| settle-sites | Site placement and urban reserves | after relief | no |
| settle-hierarchy | Place hierarchy | after sites | no |
| settle-roads | Regional roads (cost fields, A*, bridges) | after sites | yes |

## Cities — city construction (all places or a selected subset)
| id | name | when | opt |
| --- | --- | --- | --- |
| city-composition | Composition: footprint, macroplan, harbour, fortification | city | no |
| city-roads | Urban roads and streets (shares the native layout output with quarters) | city | no |
| city-quarters | Quarters and block subdivision (shares the native layout output with streets) | city | no |
| city-trim | Trim of unbuilt blocks | city | yes |
| city-parcels | Parcels (cadastre) | city | no |
| city-programme | Programme allocation (roles, demands) | city | no |
| city-buildings | Building sites and massing | city | no |
| city-houses | Architecture / detailed houses | city | yes |

## Map — display, naming and export
| id | name |
| --- | --- |
| display-terrain | Terrain shading and palette |
| display-water | Water |
| display-vegetation | Vegetation |
| display-roads | Roads and ground |
| display-buildings | Buildings (2D/3D, LOD, colours) |
| display-labels | Labels and icons |
| map-naming | Map title and toponyms |
| map-export | Export the current map or project |
