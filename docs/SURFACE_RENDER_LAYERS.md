# Ground, low cover, trees, and canopy representation

English translation of the [French original](SURFACE_RENDER_LAYERS_FR.md).

The `surface-layers-1` contract (compiler `surface-1.5.3`, physical analysis `surface-1.5.2`) distinguishes three physical layers. Their optical representation is a rendering choice separate from canonical data. The V5 campaign covered `surface-1.4.0`: it **does not validate** this new contract, its shader, or visual quality. The [V8 campaign](surface/evidence/native-e2e-v8.json) technically qualifies live integration: four distinct visibilities, identical physical data and inventory. The [complete V12 campaign](surface/evidence/NATIVE_V12.md) now qualifies controls at 10 km and 160 m on frozen snapshot `bc6579f`, with nominal 20-second navigation and seven zoom captures. [Structured evidence](surface/evidence/native-e2e-v12.json) retains all 584 identical runtime hashes before/after. It is not artistic acceptance; V9–V11 failures remain recorded.

1. **Ground/support:** rock, deposits, mineral soil, and soil organic matter. Soil carbon/humus remains distinct from dead surface litter. This support also exists under grasses, crowns, and water; water has its own class/level/authority and is not a ground recipe.
2. **Low cover:** grasses, low shrubs, and dead litter. Existing physical fields `grassCover`, `shrubCover`, and `litter` remain unchanged. The projected layer has explicit recipes, linear mean, and opacity.
3. **Trees:** canonical crown projection potential `treeCover`, stable `family:'tree'` inventory, supports, sizes, and crown radii. Distant canopy/instances represent these trees, never a new lithology or mineral soil component.

A mineral soil's material budget is `sand+silt+clay=1`, with separate `organic`. A material pair is normalized **within its layer**. There is no global partition requiring `ground+grass+trees=1`: grass and a crown may occupy the same point at different heights.

## Compact transport

The new arrays are in `world.fields`, aligned with that world's grid. Projected grids retain canonical context just like other SurfaceWorld fields.

| Field | Type | Meaning |
| --- | --- | --- |
| `groundMaterial`, `groundMaterialSecondary` | `Uint16Array` | Rock/deposit/soil support indices, excluding litter and living matter. |
| `groundMaterialBlend` | `Float32Array` | Support pair: `primary*(1-blend)+secondary*blend`. |
| `groundMaterialMeanColor` | `Uint32Array` | Linear mean of all support weights before top-two reduction; same sRGB8 packing as legacy. |
| `lowCoverMaterial`, `lowCoverMaterialSecondary` | `Uint16Array` | Low-cover recipe indices, normalized within that layer. |
| `lowCoverMaterialBlend` | `Float32Array` | Mixture of the two low-cover recipes. |
| `lowCoverMaterialMeanColor` | `Uint32Array` | Low-cover linear mean, obtained directly from recipes. |
| `lowCoverOpacity` | `Float32Array` | Projected `[0,1]` fraction of low cover on available support. |

Additional cost: **28 bytes per sample**, or 28 MB per million samples, before any canonical-context copy in an export. Memory budget is checked before allocation. Binary retains types; JSON restores exact constructors and remains subject to its size limit.

`world.surfaceLayers` declares `version:'surface-layers-1'`, `groundAvailability`, `lowCoverAvailability`, and `fieldsVersion`. A new compilation uses `explicit`. `fieldsVersion` binds the current grid's nine arrays; `versions.surfaceLayers` binds canonical arrays. Retargeting preserves the latter and carries `canonicalContextRef.surfaceLayersVersion`. These versions contribute to IDs.

Recipes have an optional role for old catalogs, `surfaceRole:'ground'|'low-cover'|'water'|'seasonal'`. New bundled catalogs declare it explicitly. Normals, roughness, and cartographic palette must be resolved from **the relevant layer's recipe**. The legacy `vegetation` family is insufficient to choose between grass and litter.

Stored low-cover color is an unpremultiplied mean with separate alpha. Any interpolation of color/IDs/roughness/normals uses `bilerp*lowCoverOpacity` weights, then normalizes by the alpha sum. A transparent texel never contributes its fallback color. The GPU must multiply linear RGB by alpha **before** filtering/mipmaps, then recover color if alpha is positive. A zero sum remains neutral and invisible.

## Construction and invariants

Support is calculated from the compiler's same rock/deposit/soil scores before cover. It retains contacts, outcrops, and deposits; it is not replaced by uniform soil color. Rocky support recipes use declared substrate; gravity deposits use their fragment source. Humic soils use the new brown `organic-soil` recipe, appended to the catalog; `wetland-organic` keeps its legacy ID and color but no longer abruptly replaces support.

The derived humus fraction varies continuously (C1) with moisture between 0.72 and 0.88, decreases with slope between 0.08 and 0.16 **radians**, and uses the existing organic fraction between 0.02 and 0.16. These intervals are authoring choices for appearance potential, not calibrated pedological classification thresholds. They depend neither on zoom nor added UV filtering. Mineral/humus weights share the same support; the mean retains all weights before top-two reduction. Physical fields remain unchanged.

Since 1.5.3, Road, Yard, and Built occupation cells retain this natural support. Their raster footprint is a conservative exclusion, not proof that pavement covers the entire cell. Vector roads and buildings carry their own materials. Explicit crops and cover exclusions are retained. The legacy composite remains identical, including its old infrastructure materials. See [the chosen policy and migration](surface/URBAN_GROUND_SUPPORT.md).

Low-cover opacity successively considers non-rocky support, litter, shrubs, then grasses. This priority is a declared approximation of the layer's projection. It does not change physical fields or subtract from `treeCover`. Grass uses the legacy `vegetation-litter` recipe, linked to PBR `grass`; litter uses `forest-litter`, linked to PBR `litter`. Shrubs currently use the low-vegetation recipe as a proxy, without claiming a specific leaf PBR asset. Roads, construction, and water block low cover; rock reduces its support.

Source heights, minerals, physical soils, climate, canonical cover, support masks, and candidate IDs/acceptances/ranks do not change under this contract. `sampleSurface(...).surfaceLayers` exposes the three layers. `selectSurfaceLayerView(sample,{lowCover:false,trees:false})` only selects visibility; returned ground remains the same object and no field, support, or inventory is edited. Distant canopy color, footprints, and transitions belong to representation.

## Honest compatibility

Historical `material`, `materialSecondary`, `materialBlend`, and `materialMeanColor` fields are retained **exactly**: the support+litter+grass composite, without canopy or snow. They must not be presented as a bare-ground diagnostic. Historical preclassification based on `treeCover+grassCover` is subsequently replaced by this natural composition; by itself it does not prove a duplicate canopy in the ground.

An old package without the nine arrays carries `groundAvailability:'legacy-composite-unavailable'` and `lowCoverAvailability:'legacy-composite-unavailable'`, with an explicit warning. Hydration does not attempt subtraction or reconstruction from its mixed top two. The sample returns `ground:undefined`/`lowCover:undefined`; a viewer may show the legacy composite while declaring this fallback. A partial group, false availability, wrong type/role, out-of-range blend/alpha, or edited field version is rejected.

## Checks and remaining qualification

Tests compare every old field and 6,422 complete candidates against pre-layer snapshot `f6a45af`: identical geometry, acceptances, positions, supports, IDs, and ranks. They also check toggles without mutation, rocks under cover, exclusions, seasons, overlapping patches, binary, JSON, budgets, and legacy/malformed metadata.

The Godot integration has separate **bare ground**, **grass and litter**, **trees**, and **optical canopy** diagnostics with independent visibility controls. V8 proved their isolation at 10 km without qualifying actual near-instance masking. V12 runs both probes, each with five images: all layers, without trees, without low cover, ground only, and unlit mean ground. At 160 m, CPU counts actually alpha-positive in the frustum are **64 trees / 64 trunks, 288 grasses, 17 shrubs, 61 debris, and 31 rocks** in the complete state. Without trees, trees/trunks fall to zero, as do canopy and optical shadow. Without low cover, grasses/shrubs/debris fall to zero; the 31 rocks persist. Submitted allocations remain fixed across toggles. These buffer and CPU frustum counts are not counts of visible pixels after GPU occlusion.

Physical fields, context, heights, ground arrays, and inventory footprints remain identical across visibility states of one view. Inventories at two different view widths are not assumed identical. Pre-freeze checks pass: **224 Surface tests in 42 files**, full typecheck, and a 445-module build.

V12 navigation applies **one distinct new preview**, requested at 128 and delivered at 128², twice during the nominal window. Its native spacing is 30 m and `decoderUsed=false`: this proves stream progress, not learned neural refinement during movement. Genuine fine support at native 0.46875 m, `decoderUsed=true`, arrives only during final drain. The canonical environmental grid remains **78.125 m**; layers and small objects do not turn that resolution into fine physical measurement.

V12 qualifies neither photorealism, 60 FPS, nor low-latency interaction. Uniform proxy crowns and blocky small vegetation remain visible in the 10 m capture. Forest shadows remain optical. The retained city of 419 native realizations is separate evidence, on a 15.625 m parent / unknown LOD, without new neural urban generation. V5 captures qualify neither these layers nor this built scene.
