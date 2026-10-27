# Relationships between map information and visible ground materials

Design study for Test-Render, October 24, 2026.

> English translation of the [French original](GROUND_MATERIAL_MAPPING_FR.md).

The target is a **natural ground composition map**, visible from above when plants, trees, and buildings are removed. Already generated information supports a first version: it constrains exposed rock, earth, sand, stony material, deposits, and wet states. It does not determine one unique material everywhere. Output must retain several admissible materials, their proportions, and local organization.

The proposal is a small rule compiler over existing fields. It requires neither a new engine, geological simulation, nor complete generation of catalog landscapes. **Rules determine what is possible; stable spatial randomness chooses among remaining possibilities.** Cases needing missing information receive an explicit scenario or stay disabled. Dry climate alone cannot create sand, salt, or gypsum; basaltic rock alone cannot identify a recent lava flow.

The contract below concerns material decisions. PBR textures, fine synthesis, and lighting consume those decisions later. It is not a new rendering implementation.

## 1. Sources and scope

### 1.1. Reference documents

The documents have complementary roles:

| Document | Contribution retained |
| --- | --- |
| [MATERIALS_REVIEW.md](MATERIALS_REVIEW.md), §§1–5 | Catalog of appearances, variants, contexts, and patterns to cover |
| [RENDER_SURFACE_DESIGN.md](RENDER_SURFACE_DESIGN.md), §§5 and 7 | Relationships among forms, substrate, deposits, water, soil, and recipes; context/rendering separation |
| [RENDER_REVIEW.md](RENDER_REVIEW.md), §§3 and 7–9 | Probabilistic `{weight, orientation, scale}` composition, component arrangement, material-specific techniques, and zoom stability |
| [SURFACE_RENDER_LAYERS.md](SURFACE_RENDER_LAYERS.md) | Physical separation between support, low cover, and trees; litter distinct from humus |

Input state is that of the [Test-Render compiler](../../magna-urbis-render-godot-original/godot-render/tools/surface_context.py) and its [tile contract](../../magna-urbis-render-godot-original/docs/surface/TILE_VIEWER.md) in worktree `magna-urbis-render-godot-original`. Its `ground.version=2` schema must not be confused with SurfaceWorld contracts developed in other worktrees.

Proposed rules and values are **appearance synthesis** rules derived from the organization in these documents. They are neither soil classification nor a calibrated transport model. No additional external source is required for this package.

### 1.2. What removing vegetation means

Remove occlusion and drawing of living organisms: crowns, grasses, shrubs, mosses, lichens, algae, and aquatic vegetation. Retain the support at their locations. A forest does not automatically become sand or a grassland rock; support composition stays the same when living matter is hidden.

Humus and peat are soil materials. **Thin dead litter** — leaves, needles, small twigs, and dead wrack — may belong to the requested appearance but remains a layer separate from support. This study uses `includeDeadLitter=true` when its presence is known or declared; `false` yields bare support. Without litter information, display support without inventing a forest carpet from climate alone. Large logs, standing dead trees, animals, and associated objects remain out of scope.

Also remove artificial building, road, and paving layers. If terrain was already graded, earlier natural relief cannot be reconstructed by masking: support beneath the improvement is then an explicitly identified assumption.

### 1.3. Water and solids at the surface

Water retains its mask and level. Permanently submerged areas do not become dry ground when vegetation is hidden. Output distinguishes:

- **Exposed ground:** support composition, deposits, and surface states.
- **Underwater bed:** distinct composition only if the bed is qualified; visibility depends on depth and transparency.
- **Water occluding the bed:** no ground color replaces the liquid surface.
- **Declared snow or ice:** state layer or icy support depending on case; never an automatic consequence of annual temperature.

The catalog also contains water phenomena and living cover. The appendix assigns them explicit status rather than renaming them ground materials.

## 2. What the map must contain

A ground area is described by five independent elements:

| Element | Question | Example |
| --- | --- | --- |
| Materials | What occupies the support surface? | 60% gravel, 25% sand, 15% silt |
| Provenance | Where do materials come from? | Local rock, granite fluvial inputs, cliff debris |
| Arrangement | How are they distributed? | Bars, clusters, matrix between stones, fracture pockets |
| State | How does the surface look now? | Dry, wet, muddy, crusted, frozen, or snow-covered |
| Variation | Which compatible variants are present? | Fine or coarse gravel, rounded pebbles, local mineral tint |

“Dune,” “cliff,” “delta,” “moraine,” and “doline” are not materials. They are forms and contexts carrying materials. “Polygonal” is a pattern that can belong to clay, salt, rock, or frost; pattern alone does not reveal its cause. “Wet” is a state shared by many materials.

### 2.1. Fractions that must not be confused

`bedrockGranite..bedrockBasalt` describe synthetic lithological context. `sand+silt+clay=1` describes the fine mineral matrix. Stoniness describes fragment-presence potential, not yet measured pebble coverage. Visible material fractions describe **surface area share**. These numbers do not replace one another.

Likewise, `organic` enriches matrix description; it does not directly give the surface share of a bare humus carpet. Dominant organic cover must be permitted by support exposure and nature in N1.

For support, target `sum(surfaceAreaFraction)=1`. Litter and snow layers have their own coverage. With only these two layers, one possible visible composition is:

```text
visible snow   = snowCover
visible litter = (1 - snowCover) * litterCover
support i      = (1 - snowCover) * (1 - litterCover) * supportWeight[i]
```

This sums to 1 in the exposed domain. It does not impose `ground + trees + grass = 1`. Support exists beneath other layers. Ice is handled according to its function: glacial support, layer on ground, or frozen water.

### 2.2. Proposed output

```text
VisibleGround
  domain: emerged | qualified_bed | water_occluded | unresolved
  support[]: {materialId, recipeFamily, group, areaWeight, parentComposition,
              arrangement?: {process, direction, physicalScales, clustering, featureId?}}
  state: {surfaceWetness, snowCover, iceState, crustState}
  deadCover?: {litterKind, cover, thicknessClass}
  variantSeed: stable world address
  explanation: {supportingInputs, exclusions, assumptions, missingInputs}
  evidence: {inputCompleteness, providedOrDerivedOrSynthetic}
```

A dominant material can be computed for the legend but does not replace proportions driving rendering. The inspector must explain “fluvial gravel and sand, exposed bar, low fines fraction,” including when underlying rock is marly.

Each component may have its own arrangement: slabs oriented with strata, pebbles along flow, and ripples in sandy patches. “Provided, derived, or synthetic” status is distinct from input completeness. Neither status nor current `confidence` is a probability of geological correctness.

## 3. Available information and its actual scope

Test-Render grids have 1334² samples for 40 km, approximately 30 m. Finer patterns will be conditioned synthesis; interpolating the grid creates no new terrain observation.

| Current inputs | Material use | Limitation to retain |
| --- | --- | --- |
| `height.f32`, slope, aspect, curvatures | Support, stability, exposure, relative accumulation | DEM names neither material nor landscape history |
| `geomorphon150/600/2000`, `tpi150/600/2000` | Ridge, slope, hollow, slope foot; preference strength | Classes must not draw hard material boundaries; a depression is not necessarily a lake, sinkhole, or peatland |
| Five bedrock fractions, `bedrockVariation` | Outcrop/residue compatibility; property variation | Only granite, limestone, sandstone, clay-marl, and basalt; no gneiss, quartzite, salt, gypsum, pumice, or ash identification |
| `hardness`, `weatherability`, `structureAzimuth` | Relative resistance, weathering, strata direction | Synthetic proxies; no dip, fracture networks, or detailed color mineralogy |
| Receivers, basins, `contributingArea`, accumulation | Drainage connection, inputs, fluvial context | Runoff-weighted accumulation is not geometric area; no measured instantaneous discharge |
| `hand`, reference and reference type | Height above connected drainage | HAND is sometimes undefined; neither flood elevation nor flood duration |
| `distanceToWater`, `channel`, `sea`, `lake`, `lakeLevel`, `lakeKind` | Exposure constraints, water proximity, open or closed lakes | Distance combines all waters; `channel` is graph diagnostic, not exact footprint of drawn rivers |
| `alluvialPotential`, `colluvialPotential`, `aeolianPotential`, `coastalPotential`, `frostPotential` | Process preferences | Potentials, not evidence of deposits. Current alluvial uses proximity to any water; it does not prove connection to fluvial supply |
| `upstreamGranite..upstreamBasalt`, `sedimentProvenance` | Fluvial provenance of reworked material | Mixture weighted by erosion potential. Lateral mixture comes from nearest water; hydraulic connection must be checked. Current gravity transport carries no lithological composition |
| `depositDepth`, `soilDepth`, `stoniness` | Preferences for deposit, matrix, and exposed support | Synthetic thicknesses; depths are not independent layers to add. Stoniness gives neither fragment size, shape, nor surface share |
| `sand`, `silt`, `clay` | Compatibility of fine matrices, sand, clayey or silty earth | Sand fraction is not available loose stock; no gravel, pebble, or block distribution |
| `organic`, `moisture`, `drainage`, `storage`, `permeability` | Humus, retention capacity, wet-soil potential | No history of waterlogging, water table, peat, litter, or observed instantaneous moisture |
| Temperature, precipitation, aridity, regional wind at 70° | Climate and directional preferences | Annual climate and simplified wind; no complete seasons, recent rain, wind regime, or frost history |
| `soilMask`, `boundaryAffected`, `confidence` | Data validity and decision confidence | `soilMask` excludes sea and lakes; values archived under masks are not a qualified underwater bed. External upstream basins are unknown |

Base terrain remains `height.f32`. `surface.f32` raises lake cells to water level for display: do not use it as bathymetry.

## 4. Minimum additions and optional information

### 4.1. Four blocks for ordinary ground

These additions enrich the existing compiler. Relative availability indices or declared state suffice at this stage; transported volumes or simulated weather are unnecessary.

| Code | Information to produce | Proposed lightweight construction | What it enables and fallback |
| --- | --- | --- | --- |
| N1 | Support exposure and matrix cover: `exposedRock`, `matrixCover`, structural roughness | Combine effective cover depth, slope, curvature, weathering, and small stable variations; calibrate together, not blindly subtracting `soilDepth` and `depositDepth` | Massive rock, rock–earth mosaic, thin soil. If unknown: compatible generic mosaic and reduced confidence |
| N2 | Available loose materials: sand, dust/fines, gravel, pebbles, blocks; sizes, roundness, and origin | 0..1 indices conditioned by weatherable rock, slope source, and network; retain gravity provenance; permit declared inherited deposit. Roundness conditioned by transport mode | Distinguishes sandy earth from sand sheet, gravel from scree. If large elements unknown: no boulder field; mineral soil with small inclusions only |
| N3 | Typed waters and bank areas: separate river/lake/sea distances, connection to source reach, wet footprints and exposed bars | Reuse retained vectors and levels; rasterize footprints at useful spacing; retain signed distances for near detail | Distinct bank soils, river bars, lakeshores, and coasts. Without identified bar: generic shore, no invented gravel crescent |
| N4 | Declared display state: dry / medium / wet, possible cold season, and wet–dry cycle if used | Map preset and local corrections from current proxies; pattern coordinates remain stable when state changes | Dry, wet, and muddy variants. Without state: explicitly synthetic mean view; snow, ice, and large historical cracks remain disabled |

N1 and N2 are new synthetic fields. Part of N3 can be derived from archived data. N4 can initially be a scene parameter. Crack patterns, fragment arrangement, and bar boundaries can be evaluated on demand; no giant centimeter-resolution map is required.

### 4.2. Extensions unlocking only certain variants

| Code | Optional information | Relevant cases | Value absent declaration |
| --- | --- | --- | --- |
| O1 | Additional lithologies and mineral characteristics: foliation, quartzite, conglomerate, mineral colors, oxides, secondary carbonates, gypsum, salts | Special rocks, red soils, carbonate crusts, gypsum and salt | Unknown; current generic rock remains allowed, not specific chemical variants |
| O2 | Inherited deposits and relative age: loess, terraces, till/moraine, paleochannel, stable pavement, weathering stage | Fluvial, aeolian, desert, and glacial legacies | No inherited history claimed; use compatible current material |
| O3 | Waterlogging duration, intermittence, water table or persistent saturation, peat potential | Peat, persistent hydromorphy, marshes, temporary lakes | Wet potential only; no thick peat or permanent pond inferred from `moisture` |
| O4 | Coastal context: sediment supply, salinity, water/wave energy, tides, sea-level state | Mudflats, tidal flats, sorted beaches, sebkhas, shell deposits | Generic rocky or sedimentary coast according to stock; no named tidal flat without declared tide |
| O5 | Declared volcanic and hydrothermal units: lava form, scoria, ash, pumice, tuff, silica, sulfur | Volcanism and geothermal deposits | Generic basalt; no ropy lava, pumice, or sulfur from basalt weight alone |
| O6 | Cold regime and history: freeze–thaw, permafrost, snow cover, ice, glacial legacy | Snow, ice, periglacial patterns, moraines | Compatible cold ground and potential frost debris; no automatic glacier or pingo |
| O7 | Dead biological source and disturbances: litter, wrack, shells, dead coral, guano, fire | Litter, natural debris, biogenic deposits, ash and charcoal | No invented specific carpet or deposit; `organic` can still modify soil |
| O8 | Qualified underwater bed, depth, transparency, suspended load | Visible sandy, rocky, or muddy bottoms | Water occludes bed; do not use soil values outside `soilMask` |
| O9 | Identified form/event and compatible geometry: dune, cone, bar, landslide, karst, reef, crater | Catalog types that are landscapes, not materials | Parent material possible; named form not produced. A flag alone does not create corresponding geometry |
| O10 | Specific surface properties: shrink–swell, cementation, fracture network, dip, sorting, varnish | Large cracks, slabs, foliated schist, pavements and patinas | Generic discreet pattern; strongly structured variants remain conditional |

These inputs can be masks, region attributes, or once-drawn scenarios. They do not necessarily require new simulations. Their absence must remain visible in the recipe explanation.

## 5. Common decision rules

### 5.1. Resolution order

1. **Set the domain** from water authorities and data validity. Remove living/building occlusion without modifying support inputs.
2. **Determine exposed support and available materials** using N1 and N2. Bedrock constrains origin, but a deposit may completely cover it.
3. **Combine processes**, retaining potentials: residual, slope, fluvial, aeolian, coastal, inherited. Do not rely only on dominant `process`. Check source, stock, and connection before placing a named deposit.
4. **Establish admissible recipes** using section 6 conditions. Randomness cannot repair an absent necessary condition.
5. **Compute continuous proportions within coverage budgets**, then an organization: matrix, slabs, clusters, bars, pockets, or oriented fragments.
6. **Apply state and permitted dead cover**. Moisture can darken a material or turn fine matrix into mud without changing provenance.
7. **Produce map and explanation**, then let the renderer realize grains and patterns resolved at its scale.

### 5.2. Necessity and preference

N1 and fragment coverage from N2 first set, or bound if uncertain, **exposed rock, loose fragment, and matrix** shares. Matrix may be mineral or organic. These shares form the visible-support budget. Preferences then choose materials within each share: randomness cannot erase known rock exposure to install sand without a deposit.

A rule separates strong eligibility, available stock, and gradual preferences. For support group `g`, a starting expression is:

```text
score[m in g] = eligible[m] * availability[m] * suitability[m]
score[m] *= stableVariation(m, worldPosition)   # positive, e.g. 0.85..1.15
supportWeight[m] = cover[g] * score[m] / sum(score[k in g])
```

`eligible` denotes a domain/scenario fact: gypsum source, declared glacial deposit, qualified bed, etc. `availability` prevents fabricating a sand or boulder sheet without stock. `suitability` combines slope, position, water, and climate preferences. These are synthesis scores, **not independent physical probabilities**: slope, TPI, and geomorphons correlate and must not count the same signal three times.

Normalization applies to support materials emitted by recipes, not all M01–M28 IDs as competitors. States, patterns, dead layers, and assemblies are resolved according to section 6 roles.

Missing data is “unknown,” distinct from “present” and “absent.” An unknown specialized case does not activate; a generic material remains possible with explanation and reduced confidence. If scores of a nonempty group are all zero, fallback remains compatible with domain, exposure, and source: generic rock on exposed rock, generic matrix on loose mantle, generic fragments if known present. Otherwise retain `unresolved`. Fallback does not turn water or unknown bed into earth or activate a specialty.

Preferences are smoothed over ranges, not cut by classes. Slope ramps around 10–25° or relative depths of a few tens of centimeters can support initial calibration but are not universal thresholds. Exact values will be adjusted on the 42 tiles.

### 5.3. Role of randomness

| Decision | Rule | Permitted randomness |
| --- | --- | --- |
| Lithology and special unit | Known regional scenario | Stable scenario choice before classification, never different lithology per pixel |
| Material among multiple possibilities | Weighted draw among admissible candidates | At deposit-patch or local-unit scale, with continuous joins |
| Proportions in similar context | Bounded score and relative-stock variation | Coherent fields preserving dominance of constraints |
| Element size, orientation, and clustering | Distribution conditioned by source, slope, transport, and scale | Deterministic candidates, clusters, and textons |
| Color and wear | Material palette, mineralogy, and state | Variation within compatible family; white salt, black soil, and red earth are not freely interchangeable colors |
| Dune, peat, glacier, hydrothermal spring | Explicit necessary information | No draw substitutes for missing stock, history, or form |

A random key resembles `hash(worldSeed, recipeFamily, canonicalRegionOrCell, candidateId)`. It depends neither on camera, screen pixel, LOD, nor request order. A moisture change does not reroll every stone position. A displayed tile is not a geological unit.

### 5.4. Avoiding thresholded noise and material soup

Continuous proportions are not a uniform average of PBR colors. Following RENDER_REVIEW §8, “60% gravel, 25% sand, 15% silt” should become fragments, interstices, and patches. In this example fragments occupy 60% of support and the 40% matrix is divided between sand and silt. Matrix fills gaps between stones; a deposit covers support; rock slabs emerge through cover. Arrangement operator depends on process.

Class boundaries serve the legend. Within a compatible domain, exposure, stocks, and weights vary gradually. Water masks and explicit physical footprints may keep localized boundaries; this does not mean blurring a shore or moving terrain authorities. Fine details also vary within a unit rather than concentrating in a noise halo around its edge. Data at 30 m determine context; 1–50 m and centimeter details are stable recipes identified as synthetic. Fractures, ripples, and bars use causal direction or geometry.

Distant representation retains surface fraction and average detail appearance. An outcrop or stone does not change identity when representation changes. This constraint follows RENDER_REVIEW §9; it does not require precomputing a centimeter image.

## 6. Materials and production conditions

M01–M28 identify **visible-ground recipe families**. Some correspond to a material; others add state, pattern, or assembly to existing materials. They do not require 28 independent shaders. N/O IDs refer to section 4 information.

References such as `N2/N3/N4` or `O1/O3/O4` identify relevant information depending on origin and variant, not a mandatory conjunction of every input. Necessary-condition columns specify alternatives. Likewise, `M04/M05` denotes candidates to combine according to data, not mandatory presence of both.

| Recipe families | Role in surface budget |
| --- | --- |
| M01–M10, M13–M20, and M25 | Emit support materials in rock, fragment, or matrix groups. A recipe such as M19 expands into fine ash, granular pumice, or rocky tuff by subtype; these variants are not one interchangeable class |
| M11 and M12 | State or variant of parent matrix: e.g. muddy or cracked-crust clay. Do not add a mud or crack weight to the already present clay weight |
| M21 and M23 | Dead cover and snow, separate from support budget as in §2.1 |
| M24 | Icy support, ice layer on ground, or frozen-water state depending on domain. Névé/firn remains M23 when described as transformed snow mantle; it becomes M24 only when scenario describes icy support. One location does not count both for the same layer |
| M26–M28 | Assembly, pattern, or origin organizing and qualifying parent materials. A moraine deposit emits its earth, sand, and fragments with glacial origin; “moraine” is not an extra fraction counted twice |

### 6.1. Mineral matrices and rocky support

| ID and recipe | Necessary conditions | Favorable conditions | Exclusions and variants | Information to add |
| --- | --- | --- | --- | --- |
| M01 Mineral earth and earth–sand mixture | Exposed fine matrix, outside water occluding bed | Stable cover; weathering and fine deposits; low/moderate slope | Brown, ocher, beige; specific black/red only with compatible source. Sand fraction ≠ loose sand sheet | N1/N2; O1 for specific mineral color |
| M02 Clay earth | Significant clay fraction in exposed matrix | Local clay-marl or reworked fines; calm areas | Compact/crusted by state; swelling and large cracks require O10. Neither every plain nor every marl implies bare clay | N1/N4; O10 |
| M03 Silt and dust | Available silty fines, exposed cover | Fine alluvium, low-energy deposits; declared dust input | Loess requires inherited aeolian silt or declared source; light soil alone does not identify it | N2/N3; O2 for loess |
| M04 Loose sand or sand sheet | Available free sand, weakly cohesive matrix, exposed surface | Fluvial/coastal sorting, wind transport, reworked grus | Dry/wet by N4. White shell/gypsum, volcanic black, ferruginous red require corresponding provenance. Aridity alone is insufficient | N2/N3/N4; O1/O4/O5/O7 for variants |
| M05 Gravel and pebbles | Coarse stock and sufficient surface share | Channels and coarse bars, energetic beaches, reworked deposits | Fine/coarse by size; rounded pebbles by transport history. Current stoniness alone distinguishes neither size nor roundness | N2/N3; O2/O4 by context |
| M06 Angular stones and blocks | Available rock fragments, source or inherited deposit, compatible support | Slope break, cliff foot, convergence and slope runout | Flat blocks by foliation; giant blocks and boulder fields require dimensions and support. Steep slope without source creates no scree | N1/N2, gravity provenance; O2/O10 |
| M07 Exposed massive rock | Accessible rock and low effective cover | Ridges, shoulders, cliffs, thin soils, abrasion or stripping | Continuous local lithology: current granite, limestone, sandstone, marl, basalt. Schist, slate, gneiss, quartzite, conglomerate, mineral bands require O1. Cold/dry is not lithology | N1; O1/O10 for subtypes/patterns |
| M08 Weathered rock, grus, saprolite | Weatherable substrate and compatible weathering/age | Climate and stability allowing weathering; rock–matrix transitions | Grus stays tied to parent rock. Deep saprolite or tors/boulder fields cannot be inferred from `weatherability` alone | N1/N2; O2/O9 for inherited profile and form |

For M07, lithology chooses material and fracture families, not a flat color. Schist foliation, gneiss bands, conglomerate cemented pebbles, and sandstone beds remain distinct structures. “Layered,” “multicolored,” “cracked,” “slabby,” or “polished” are conditional variants, never an obligation to generate a different complete shader.

### 6.2. Organic soil and surface states

| ID and recipe | Necessary conditions | Favorable conditions | Exclusions and variants | Information to add |
| --- | --- | --- | --- | --- |
| M09 Organic soil and exposed humus | Support organic matter, accessible surface | Organic accumulation and preservation; stability; little stripping | Black earth/humus does not mean peat; humus does not replace silt in mineral texture | `organic` + N1; qualify organic origin if dominant |
| M10 Exposed peat | Known peat deposit or persistent formation/preservation scenario | Long-term waterlogging and accumulation; compatible cold or tropical context | High `moisture`, high TWI, or low temperature alone insufficient; structured peatlands also require form/microrelief | O3; O9 for raised bogs, strings, hummocks |
| M11 Mud, silt, and hydromorphic matrix | Available fine matrix and sufficiently wet/saturated state; exposed domain or qualified bed | Depressions, low slopes, alluvial/lake/coastal fines, slow drainage | Mud is a state/assembly of M01–M03. Hydromorphic mottling and organic mud require specific history/origin | N2/N3/N4; O3/O4/O8 |
| M12 Desiccation crust and cracks | Compatible cohesive matrix and declared desiccation cycle | Clay, calm fine deposit, wet–dry contrast | Dry state alone does not prove a cycle; large shrink–swell requires O10. Do not indiscriminately reuse salt/frost patterns | N4; O10; stable physical pattern |
| M13 Ferruginous earth and duricrust | Declared oxide source/stock and weathering level or ferruginous deposit | Long weathering, stable surfaces; compatible regional climate | Wet tropics alone do not imply laterite. Loose red earth and hardened duricrust are different states/profiles | O1/O2/O10 |
| M14 Carbonate soil and limestone crust | Available carbonates and declared accumulation/cementation | Circulation then evaporation, compatible deposit or legacy | Limestone is not automatically calcrete; distinguish M07 rock, M14 deposit, M20 travertine | O1/O2/O10; N4 |
| M15 Saline soil and salt crust | Salt source and declared saline concentration/stock | Evaporation, compatible closed basin or coast, wet–dry alternation | Neither endorheism nor aridity alone suffices. A playa may remain clay without salt | O1/O3/O4; N4 |
| M16 Gypsiferous soil and deposit | Available gypsum or declared gypsum unit | Evaporites, inherited deposits and compatible reworking | White gypsum ≠ white shell sand ≠ snow; shared color, different causes | O1/O2; N2 for gypsum sand |


### 6.3. Volcanism and specific deposits

| ID and recipe | Necessary conditions | Favorable conditions | Exclusions and variants | Information to add |
| --- | --- | --- | --- | --- |
| M17 Compact lava with declared structure | Known flow unit and surface type | Compatible ropy, lobate, or folded form | Basalt alone permits M07.basalt, not pāhoehoe/ʻaʻā distinction. Material does not create flow or crater | O5/O9; direction and scale |
| M18 Scoria and brecciated lava | Declared scoriaceous stock or fragmented lava surface | Volcanic deposits, ʻaʻā, flow fronts/fragments | Black/red/brown by source and weathering; not simply randomly drawn dark gravel | O5; N2; O9 for form |
| M19 Ash, pumice, tuff, ignimbrite | Declared volcanic product nature and deposit | Pyroclastic deposits, consolidation, reworking | Fine ash, granular pumice, and rocky tuff share neither size nor cohesion. Basalt fraction alone does not supply them | O5/O2; N2; O9 for plateau/form |
| M20 Hydrothermal or precipitated carbonate deposit | Declared source and substance: silica, sulfur, carbonate, altered clays | Compatible hydrothermal spring or resurgence | Travertine and calcareous tufa differ from M19 volcanic tuff. Colored pools are also waters, not freely chosen ground spots | O5 or O1+O3; O9 |
| M21 Thin dead litter and wrack | Known dead source, declared cover and type; option active | Accumulation in pockets and near source, trapping, bank | Leaves, needles, twigs, dead algae are cover distinct from M09. Large logs and living matter excluded | O7; transport/location; separate cover |
| M22 Burned soil, charcoal, and wildfire ash | Declared fire event and residue | Relative age, ash deposit, accessible burned substrate | No fire inferred from dry climate or dark earth; wildfire ash distinct from volcanic ash | O7; N4 and previous support |
| M25 Biogenic debris and animal deposits | Declared source/shells/dead coral/guano | Shell beach, known reef support, local accumulation | Living matter and animals not rendered; dead coral may be mineral support. Guano is not a ground color drawn without source | O7; O4/O8/O9 by case |

### 6.4. Cold and landscape assemblies

| ID and recipe | Necessary conditions | Favorable conditions | Exclusions and variants | Information to add |
| --- | --- | --- | --- | --- |
| M23 Snow and névé | Declared snow presence/stock | Compatible retention, exposure, wind, altitude, temperature | Fresh, old, granular, windblown, refrozen by state/history. Low annual temperature alone gives neither cover nor thickness | O6 + state; O9 for drift/cornice |
| M24 Exposed ice or icy support | Ice present and identified domain: ground, glacier, frozen water | Compatible cold regime and history | Blue ice, firn, and lake ice are different variants. Sea ice and icebergs remain objects/waters outside ground; recipe creates no glacier | O6; O8/O9 by domain |
| M26 Desert pavement and patina | Available fragments, stable surface, declared stripping/legacy context | Deflation, low cover, declared residence time | M01/M05/M06 assembly, with varnish if O10; aridity alone insufficient | N2; O2/O10 |
| M27 Frost-structured ground | Mineral soil and declared freeze–thaw/permafrost regime according to pattern | Available water, compatible fragment sizes and slope | Sorted circles/stripes, ice-wedge polygons, solifluction lobes have distinct conditions/structures; `frostPotential` alone does not identify them | O6/O9/O10; N2/N4 |
| M28 Glacial and proglacial deposit | Declared glacial legacy/deposit and available materials | Moraines, till, reworked outwash, deglaciated surface | M01–M06 assembly and M07 support. Moraine does not follow from current cold; distinguish poorly sorted till from sorted fluvioglacial deposit | O2/O6; N2/N3; O9 for form |

Soils under the catalog's living cover remain combinations of these families. A forest does not create one universal “forest soil” family. Ground under mangrove notably needs sedimentary and hydric context; canopy does not decide whether matrix is sandy, muddy, or organic.

## 7. From context to composition

Appendix B reprises the 28 MATERIALS_REVIEW §3 contexts. General rule: **context selects candidates; stocks and exposed surface choose proportions**.

### 7.1. Six complete decision examples

| Map inputs and additions | Plausible composition | Permitted variants and randomness | Decisions forbidden without input |
| --- | --- | --- | --- |
| Limestone shoulder/slope, thin soil, low water potential, exposed support | M07.limestone with M01/M02 pockets and M06 by fragments | Pocket size, joint/stone spacing, compatible tints | No automatic calcrete, dolines, or limestone pavement without O1/O9/O10 |
| Basalt cliff foot, connected gravity path, coarse stock | Basaltic M06 and M01/M04 matrix from same input | Clusters, longitudinal sorting and sizes; local interstitial residue | No scoria or ʻaʻā merely because parent is basaltic |
| Exposed river bar, low HAND, upstream granite input, coarse sorting | M05/M04/M03: e.g. 60/25/15 by surface | Pebble and fine-patch position; moisture by state | Local underlying rock does not replace pebble provenance; no bar without exposed footprint |
| Arid plain, clay matrix, no free sand or declared salt | M02; M12 only with compatible wet–dry cycle and shrinkage | Compact patches and small variations; conditional cracks | No erg, salar, or uniform sand |
| Wet hollow under hidden forest, known fine and organic matrix | M01/M02/M09, M11 by state; M21 only if litter declared | Moisture pockets, distribution of allowed dead debris | No thick peat, moss, or leaf carpet inferred from climate alone |
| Low coast near water, declared fine stock and low energy | M11/M03, possibly M04, on exposed parts | Existing channels, grain size, organic tint and moisture | No automatic sandy beach; no tidal flat without O4 |

The 60/25/15 example is an illustrative RENDER_REVIEW recipe, not a constant for all rivers.

### 7.2. Questions resolving ambiguity

| Possible appearance | Deciding information |
| --- | --- |
| Sandy plain or sandy earth | Free-sand availability and coverage, not only `sand` |
| Massive rock or stony soil | Support exposure, matrix thickness, fragment distribution |
| Rounded gravel or angular scree | Deposit origin and path, sizes, roundness |
| Dry clay or salar | Salt source and concentration; closed basin insufficient |
| Black soil, basalt, peat, or charcoal | Mineral matter, organic accumulation, waterlogging history, or fire |
| Limestone, calcrete, travertine, or shell sand | Rock, secondary accumulation, precipitation, or biogenic input |
| Old basalt, ropy lava, or scoria | Volcanic-unit identity and state |
| Current mud, hydromorphic mottling, or peat | Synthetic instantaneous state, waterlogging duration, organic history |
| Clay, salt, frost, or rock-fracture polygons | Cause, support, state; do not choose from pattern alone |
| Sandy or muddy shore | Nature and stock of supply, energy and immersion, not just water distance |

## 8. Arrangement by material

This table translates RENDER_REVIEW §§3 and 7 without choosing mandatory technology for this study.

| Recipes | Arrangement requested from renderer | Recipe inputs |
| --- | --- | --- |
| Fine earth, silt, grus, sand without major form | Stochastic material and filtered grains | Composition, grain scale, variation, moisture |
| Gravel, pebbles, stones, scoria, pumice | Fragments or textons, distributed sizes, matrix between elements | Coarse stock, coverage, sizes, roundness, clustering, provenance |
| Massive, foliated, or layered rock | Rock material with oriented structures and coherent fractures | Lithological parent, exposure, orientation, dip/fractures if known |
| Cracks, pavement, large polygons | Connectable network or structured pattern | Cause, scale, state, orientation; not new material selection |
| Sand ripples and striations | Coherent directional pattern | Wind/current, moisture, grains, support |
| Fluvial, gravity, and coastal deposits | Bars, clusters, sheets, tongues connected to sources | Footprints, signed distances, transport direction, stocks |
| Dead litter | Small elements and clusters separate from support | Debris type, cover, size, trapping |
| Snow/ice | Layer or support coherent with domain | Presence, relative thickness, state, wind, accumulation |

A sand photo does not create a dune; a fracture pattern does not create a cliff; a gravel texture does not create its supporting cone. Forms are recognized if present or supplied by a geometrically compatible scenario. Their creation is not a dependency of the first material compiler.

## 9. Proposed incremental delivery

### 9.1. First visible-ground map

1. Add N1–N4 and validity explanations to current data.
2. Produce M01–M09 and M11 for common cases with current lithological parents. M12 remains state-dependent; special types are not drawn by default.
3. Show “ground composition,” “dominant material,” “origin,” “state,” and “missing information” in Information. Keep existing explanatory layers.
4. First check that support data stays identical when living/building visibility changes. Compare the new material map with historical background as reference; it does not require separating components already flattened in that image afterward. When layers are rendered separately, also compare the image at identical framing with and without occlusion.

This first map can display a recipe palette and proportions. It does not require assembling the entire PBR library. Current Render maps already contain composited appearances; their pixels are not the source of new material decisions.

### 9.2. Catalog expansion without changing the contract

Then activate specialized families with O1–O10 according to desired landscapes. A map can declare loess deposit, gypsiferous area, scoria unit, or glacial legacy without simulating formation. The same rules consume these inputs. An absent form remains absent even if its material is available.

Material work can remain in `compileVisibleGround(context, sceneState, declaredScenarios, worldSeed)`. This document's tables serve as the rules/conditions catalog with N/O references; copying them into independent lists in several renderers would cause divergence.

## 10. Validation criteria

| Check | Expected result |
| --- | --- |
| Catalog coverage | Every type and variant references a material, form, state, or explicit exclusion in appendix A; no claim of 235 independent materials |
| Separate budgets | Lithological proportions, fine texture, stocks, and visible coverage not confused; each applicable mixture normalized |
| Deposits | Available material and compatible source; retain reworked provenance; gravity and fluvial not equated |
| Water | Exposed bar distinct from wet channel; sea, lake, river typed; unqualified masked data not used as bed |
| Ambiguities | Dry plain without sand stock ≠ erg; closed basin without salt ≠ salar; basalt alone ≠ scoria; wet hollow alone ≠ peat |
| Continuity | Gradual variation in compatible domain and stable patterns across camera, zoom, boundaries; respect explicit footprints and water masks |
| No-cover counterfactual | Hiding tree, grass, or building preserves support material and identity |
| State | Dry-to-wet does not move every stone; snow layer does not change lithology |
| Missing information | Explicit fallback, reduced confidence, list of disabled specialized cases; no silent noise fill |
| Forms | Named dunes, moraines, cliffs, reefs, and fan deposits have compatible form; texture alone does not claim existence |

The 42 tiles provide useful comparisons: same geology across six climates of a family, arid versus tropical, coast versus inland, summit versus valley, deposit area versus local rock. Additional targeted scenarios can test rare materials without injecting them arbitrarily into every map.

## 11. Reading the appendices

Appendix A covers the **235 type rows** of MATERIALS_REVIEW §1 with variants retained. M references give inverse conditions from §6; N/O specify information to produce. Other appendices cover 28 contexts, 22 patterns, and 12 exceptional families from §§2–4.

Statuses: **C** = current foundation combination with N1–N4; **O** = optional information/scenario needed; **F** = form to recognize or supply, without generating it from material; **W** = water authority or qualified bed; **E** = living appearance/object outside scope. F or E does not prevent calculation of underlying mineral support. All references are proposed rules; they do not assert recipes are already implemented.



## Appendix A. Coverage of catalog types and variants

Each row repeats the type and all variants from MATERIALS_REVIEW §1. Full conditions are those of section 6 M families; the middle column specifies row-specific prerequisites. Vegetation terms in variants are retained for traceability, but their drawing is excluded.

### Catalog 1.1. Plains and bare mineral soils

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Dry fine earth** — Brown, ocher, red, beige, black | M01 | N1/N2/N4; compatible mineral palette; M09 humic or M13 ferruginous variant if qualified | C/O |
| **Clay soil** — Compact, cracked, swelling, crusted | M02/M12 | N4; swelling and large cracks: O10; no cracks underwater | C/O |
| **Silty soil** — Loess, dust, alluvial silt | M03 | Alluvial: N3; aeolian loess/dust: N2/O2 | C/O |
| **Bare organic soil** — Black earth, humus, exposed peat | M09/M10 | Humus distinct from peat; peat: O3 | C/O |
| **Ferruginous soil** — Laterite, ferrallitic duricrust, red earth | M13 | O1/O2/O10; declared laterite and duricrust | O |
| **Carbonate soil** — Calcrete, limestone crust, caliche | M14 | O1/O2/O10; no automatic caliche on limestone | O |
| **Gravelly soil** — Fine gravel, coarse gravel, scattered pebbles | M05 | N2; fragment sizes and coverage; pebbles according to transport | C |
| **Stony soil** — Flat stones, scattered blocks, near-surface rock | M06/M07 | N1/N2; flat stones according to O10; outcrop through cover | C/O |
| **Waterlogged soil** — Saturated, muddy, mottled | M11 | N4; persistent hydromorphy and mottling: O3 | C/O |
| **Saline soil** — Efflorescence, white crusts, saline clay | M15 | Salt source O1/O4; state and concentration N4/O3 | O |
| **Gypsiferous soil** — White gypsum, gypsum-bearing earth | M16 | Gypsum O1; grain according to N2; white alone insufficient | O |
| **Sandy soil** — Fine sand, coarse sand, sand-earth mixture | M01/M04 | N2; matrix sand proportion distinct from free loose sand | C |

### Catalog 1.2. Rock outcrops and geological substrates

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Massive granite** — Polished, weathered, fractured, slabs | M07/M08 | Exposed granite N1; slabs/fractures/polish: O10; weathering M08 | C/O |
| **Granite boulder fields** — Rounded boulders, blocks, tors | M06/M07/M08 | Granite source and weathering; tors/boulders/boulder field: O9 | C/O/F |
| **Sandstone** — Red, yellow, white, stratified | M07 | Sandstone source; color and beds O1/O10 | C/O |
| **Massive limestone** — White, gray, beige, fractured | M07 | Exposed limestone N1; fractures/pavement O10 | C/O |
| **Schist and slate** — Foliated, inclined, fractured | M07 | Schist/slate unit O1; foliation and inclination O10 | O |
| **Gneiss and metamorphic rocks** — Banded, folded, strongly deformed | M07 | Metamorphic unit O1; bands/folds O10 | O |
| **Quartzite** — Massive, ridged, fractured | M07 | Quartzite unit O1; compatible ridges and fractures | O/F |
| **Conglomerate** — Cemented pebbles, eroded rock | M07 | Cemented conglomerate O1; elements and erosion O10 | O |
| **Layered sedimentary rock** — Horizontal, inclined, folded layers | M07 | Beds and orientation O1/O10; steps only if form exists | C/O/F |
| **Multicolored rocks** — Ferruginous, clay, mineralized layers | M07/M13/M16 | Mineralized palettes/layers O1; no free colored stripes | O |
| **Rock pavement** — Regular slabs, polygonal fractures | M07 | Exposed rock N1; slab and joint network O10 | C/O |
| **Strongly weathered rocks** — Grus, saprolite, residual outcrops | M08/M07/M01 | Weathering linked to parent; inherited saprolite or residue: O2 | C/O |

### Catalog 1.3. Sandy deserts and aeolian landforms

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Sandy erg** — Uniform sand, sand mixed with rock | M04/M07 | N2: sand mantle; rock mixture by N1; declared field O9 | C/F |
| **Barchan dunes** — Isolated, aligned, coalescing | M04 | N2 + wind; barchans O9; isolated/aligned/coalescing = form | C/F |
| **Transverse dunes** — Single, multiple, superimposed | M04 | N2 + wind; ripples/ridges and superposed dunes O9 | C/F |
| **Longitudinal dunes** — Seifs, giant linear dunes | M04 | N2; wind regime/direction and longitudinal ridges O9 | C/O/F |
| **Star dunes** — Complex, pyramidal | M04 | N2; wind regime and star shape O9 | C/O/F |
| **Parabolic dunes** — Fixed or semifixed by vegetation | M04 | N2/O9; retained inherited fixed geometry, plants removed | C/O/F |
| **Dome dunes** — Rounded, no dominant ridge | M04 | N2; rounded dune mounds O9 | C/F |
| **Composite dunes** — Dunes on dunes, nested fields | M04 | N2; nested forms O9, not created by sand grain | C/F |
| **Rippled sand** — Wind ripples, megaripples | M04 | N2/N4; wind/current and support; structured megaripples O9 | C/O/F |
| **Interdune corridors** — Compact sand, gravel, wetlands | M04/M05/M11 | N2/N3/N4; identified interdune depression O9 | C/F |
| **Desert reg** — Gravel, stones, desert pavement | M26 | Available fragments N2; pavement/age O2/O10 | O |
| **Hamada** — Bare rocky plateau, fractured rocks | M07/M06 | Rock support N1; existing plateau/forms O9 | C/F |
| **Loess desert** — Dust deposits, dissected relief | M03 | Dust/loess O2; dissected forms O9 | O/F |
| **Colored sand desert** — Red, volcanic black, gypsum white | M04 | Red palette/source O1; black via basalt provenance N2; white gypsum M16/O1; grain N2 | C/O |

### Catalog 1.4. Eroded landforms, rocky deserts, and arid surfaces

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Badlands** — Clayey, marly, multicolored | M02/M07/M13 | Marl/clay matrix; colors O1; gullies O9 | C/O/F |
| **Yardangs** — Small, long, giant | M07/M03 | Substrate and erosive wind; ribs/form O9/O10 | O/F |
| **Inselbergs** — Domes, residual massifs, monoliths | M07/M06 | Source and exposure; residual dome/monolith O9 | C/F |
| **Mesas** — Isolated plateaus, tableland buttes | M07/M01 | Layers and cover; tabular form O9 | C/F |
| **Dissected plateaus** — Canyons, ravines, escarpments | M07/M06/M01 | Substrate, exposure, and slope; canyon/gullies O9 | C/F |
| **Deflation plains** — Wind hollows, scoured surfaces | M01/M03/M05/M26 | Deflation and stock N2; scoured surface/legacy O2/O9 | O/F |
| **Playas** — Dry clay, hardened mud, salt | M02/M11/M15 | Fines and state N4; salt only with O1/O3; basin O9 | C/O/F |
| **Salars** — Uniform salt, polygons, wet basins | M15 | Saline stock O1; state N4/O3; patterns and basin O9/O10 | O/F |
| **Sebkhas** — Coastal or inland saline depressions | M02/M11/M15 | Salinity O1/O3/O4; wet fines or crust by state | O/F |
| **Desiccation crusts** — Fine cracks, large polygonal plates | M12 | Cohesive matrix, N4 cycle and O10 shrinkage; plate sizes | O |
| **Desert flood deposits** — Sandy spreads, gravel, mud | M04/M05/M11 | Supply and flood event O2/O3; channels/fans O9 | O/F |
| **Dry wadi networks** — Simple, dendritic, anastomosing | M04/M05/M03 | Declared dry/intermittent network N3/O3; legacy O2 | O/F |
| **Desert pavements** — Dark varnish, stones on light ground | M26 | Fragment stock N2; varnish and stable surface O2/O10 | O |

### Catalog 1.5. Mountains, slopes, and gravity deposits

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Rocky slope** — Smooth, fractured, stratified, foliated | M07 | N1; smooth/fractured/layered/foliated according to O10 | C/O/F |
| **Inland cliff** — Vertical, stepped, fractured | M07/M06 | Existing cliff O9; lithological parent and fragments N2 | C/F |
| **Scree** — Fine, coarse, giant blocks | M06/M05/M01 | Gravity source, N2; fine/coarse/giant by size | C |
| **Rockfall cone** — Isolated, coalescing | M06/M01 | Source and deposit path N2; cones/coalescence O9 | C/F |
| **Block flow** — Stable, recent, vegetated | M06/M01 | Inherited runout and deposit O2/O9; plants removed | O/F |
| **Landslide** — Translational, rotational, complex | M06/M01/M02 | Scar and displaced mass O2/O9; preserve source | O/F |
| **Debris flow** — Mud, rock, mixture | M06/M11 | Deposit/event O2/O9; fine matrix and state N4 | O/F |
| **Avalanche chute** — Rocky, grassy, crossing forest | M07/M06/M01 | Identified chute O9; remove living contrast without inventing material | C/O/F |
| **Vegetated scree** — Grasses, lichens, pioneer shrubs | M06/M01 | Source deposit N2; grass, lichens, shrubs removed | C |
| **Rocky ridges** — Jagged, rounded, stratified | M07/M06 | Existing ridge O9; rock and fracturing O10 | C/F |
| **Eroded alpine surface** — Thin soil, small stones, exposed rock | M01/M06/M07 | Thin soil N1; small fragments N2; living matter removed | C |
| **Moraine formations** — Terminal, lateral, ground | M28 | Glacial legacy O2/O6; ridges O9; sorting N2 | O/F |
| **Natural slope terraces** — Structural, erosional, ancient deposits | M07/M01/M05 | Structural/erosional/inherited origin O2/O9; materials by source | O/F |

### Catalog 1.6. Karst landforms and dissolution

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Limestone pavement** — Fractured, grooved, runneled | M07/M01 | Soluble rock and dissolution O1/O10; grooves/runnels O9 | O/F |
| **Doline** — Small, large, dry, wet | M07/M01/M11 | Doline O9; dry/wet from water N3/O3, not limestone alone | O/F |
| **Uvala** — Several merged dolines | M07/M01/M11 | Merged karst depressions O9; bottom by deposit and state | O/F |
| **Polje** — Closed karst plain | M01/M02/M11/M07 | Karst plain O9; distinct supply and drainage O3 | O/F |
| **Tower karst** — Isolated towers, densely grouped peaks | M07/M06 | Rock and peaks/towers O1/O9; shadows outside material decision | O/F |
| **Cone karst** — Clustered or isolated cones | M07/M01 | Existing cones and depressions O9; surface materials N1/N2 | O/F |
| **Cockpit karst** — Adjacent depressions between hills | M07/M01/M11 | Karst hollows O9; bottom according to drainage and deposits | O/F |
| **Karst collapse** — Sinkhole, shaft, recent collapse | M07/M06 | Collapse/shaft O9; absent volume not simulated by dark color | O/F |
| **Karst spring** — Resurgence, turquoise pool | Water and qualified bed; M20 conditional | Resurgence O3/O9; bed O8; M20 only for declared carbonate/mineral deposit | O/F/W |
| **Travertine** — Stepped pools, limestone terraces | M20 | Spring carbonate deposit O1/O3; terraces and pools O9 | O/F/W |
| **Calcareous tufa** — Porous deposits, petrifying waterfalls | M20 | Precipitated calcareous tufa O1/O3; porosity/form O9/O10 | O/F |

### Catalog 1.7. Volcanic and geothermal terrain

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Pāhoehoe basalt lava** — Ropy, lobed, folded | M17 | Pāhoehoe unit O5; ropy/lobate/folded O9/O10 | O/F |
| **ʻAʻā lava** — Scoriaceous, chaotic | M18 | ʻAʻā unit O5; fragments and roughness N2/O10 | O/F |
| **Solidified flow** — Old, recent, superimposed | M17/M18/M07 | Flow and age O5/O9; declared old/recent succession | O/F |
| **Scoria field** — Black, red, brown | M18 | Scoria O5; grains N2; black/red/brown by source | O |
| **Ash plain** — Fine, consolidated, reworked | M19 | Ash O5; fines/consolidation/reworking N2/O2/O10 | O |
| **Pumice deposit** — White, beige, gray | M19 | Pumice O5; granularity N2; compatible palette | O |
| **Tuff and ignimbrite** — Compact, layered, gullied | M19/M07 | Tuff/ignimbrite O5; consolidation and gullies O9/O10 | O/F |
| **Volcanic cone** — Scoria, ash, bare rock | M18/M19/M07 | Cone O9 and volcanic products O5; existing radial slopes | O/F |
| **Caldera** — Dry, lake-filled, vegetated | M07/M19/M01 | Caldera O9; dry/lake state via N3/N4; living matter removed | O/F/W |
| **Secondary crater** — Small cones, maars, vents | M18/M19/M07 | Cone/maar/vent O5/O9; maar water independent | O/F/W |
| **Lava dome** — Compact, fractured, scree-covered | M17/M07/M06 | Dome O9; rock and scree N1/N2/O5 | O/F |
| **Lahar** — Dry, wet, old | M19/M11/M06 | Lahar deposit O5/O9; state and age N4/O2 | O/F |
| **Hydrothermal field** — Altered clays, sulfur, silica | M20 | Hydrothermalism and substances O5; distinct clays/sulfur/silica | O |
| **Geothermal pools** — Hot, siliceous, multicolored | M20 ; qualified bed | Basin/spring O5/O9; hot/mineral water outside ground material | O/F/W |
| **Solfataras and fumaroles** — Mineralized, crusted | M20 | Solfatara/fumarole O5; mineral crusts allowed, steam outside scope | O/F/E |

### Catalog 1.8. Rivers, torrents, and alluvial plains

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Natural stream** — Straight, winding, incised | Bed M04/M05/M07/M11 | Network and footprint N3; separate water; bed only if O8 | C/F/W |
| **Meandering river** — Weakly or strongly sinuous | M04/M05/M03 ; bed | Existing meanders N3/O9; deposits by source and sorting | C/F/W |
| **Braided river** — Few channels, very dense network | M05/M04/M03 | Channels and exposed bars N3/O9; water between bars | C/F/W |
| **Anastomosing river** — Multiple stable vegetated channels | M04/M03/M11 | Stable channels O9; remove living matter from islands, retain deposits and water | C/F/W |
| **Mountain torrent** — Rocky, gravelly, waterfalls | M07/M06/M05 | Coarse source and network N2/N3; waterfalls/water outside material | C/F/W |
| **Alluvial bars** — Sand, gravel, pebbles | M04/M05 | Exposed bar footprint N3; curvature alone insufficient | C/F |
| **River islands** — Sandy, wooded, rocky | M04/M05/M07 | Existing island N3/O9; sand/rock by source, woodland removed | C/F |
| **Abandoned meanders** — Oxbows, horseshoe lakes | M11/M03/M04 ; bed | Abandoned channel O2/O9; water/state N3/O3; living matter removed | O/F/W |
| **Paleochannels** — Wet, dry, filled | M03/M04/M11 | Paleochannel O2/O9; wet/dry/filled by state, not HAND alone | O/F |
| **Floodplain** — Silty, marshy, wooded | M03/M02/M11 | Connected plain N3 and flooding O3; woodland removed | C/O/F |
| **Natural levees** — Riverside ridges, elevated banks | M04/M03 | Natural levee O9; fluvial sorting/deposit N2/N3 | C/O/F |
| **Alluvial fans** — Small, giant, active, fossil | M05/M04/M03 | Alluvial fan O9; supply N2/N3; active/fossil O2/O3 | C/O/F |
| **Bajadas** — Coalescing piedmont fans | M05/M04/M03 | Coalescing fans O9; stock and supply N2/N3 | C/O/F |
| **River terraces** — Old, recent, stepped | M05/M04/M03/M01 | Terrace/legacy O2/O9; declared recent/old state | O/F |
| **Gullies and rills** — Shallow, deeply incised | M01/M02/M07 | Existing incision O9; material by substrate/deposit N1/N2 | C/F |
| **Waterfalls and rapids** — Rocky, stepped, with sills | M07/M06 ; bed | Sills and geometry N3/O9; foam and water animation outside material | C/F/W |

### Catalog 1.9. Lakes and inland waters

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Clear deep lake** — Dark blue, blue-black | Bed not visible | Clear deep water: W; support only if O8 bed and sufficient visibility | W |
| **Shallow lake** — Sandy, rocky, muddy bottom | M04/M07/M11 | Bed and depth O8; lake mask alone does not qualify bed | O/W |
| **Glacial lake** — Turquoise, milky, sediment-laden | M28 ; possible bed | Sediment-laden glacial water: W; glacial support only O2/O6/O8 | O/W |
| **Volcanic lake** — Acidic, mineralized, hot | Possible qualified bed | Water chemistry/temperature outside soil; O5/O8 for deposits and bed | O/W |
| **Salt lake** — Permanent, seasonal, hypersaline | M15/M11 ; bed | Salinity and immersion O1/O3; no automatic salt in closed lake | O/W |
| **Organic lake** — Tannin-laden water | M09/M11 ; bed | Tannins/color belong to water; separate bottom organic matter O3/O8 | O/W |
| **Turbid lake** — Clay or silt load | M03/M02/M11 ; bed | Suspended load in water; deposit/bed only N2/O8 | O/W |
| **Lake with aquatic vegetation** — Submerged, floating plants | Possible qualified bed | Floating/submerged plants removed; water and O8 bed retained | E/W |
| **Naturally dammed lake** — Glacial, volcanic, landslide | M06/M28/M17 depending on obstacle | Declared natural obstacle and origin O2/O5/O6/O9; water W | O/F/W |
| **Temporary lake** — Puddles, seasonal basins, flooded playa | M02/M11/M15 | Temporarily flooded state O3/N4; exposed per mask, salt conditional | O/F/W |
| **Forest pond** — Clear, dark, leaf-covered | M11/M09 ; M21 optional | Pond and bed O3/O8; dead leaves O7; canopy removed | O/W |
| **Lake network** — Thermokarst, glacial, peaty | Possible qualified bed | Thermokarst/glacial/peat O2/O3/O6/O9; network ≠ material | O/F/W |
| **Lake with shore deposits** — Beaches, bars, lake deltas | M04/M05/M03 | Lake deposits and supply N2/N3; delta/beach/bar O9 | C/O/F/W |

### Catalog 1.10. Marshes, peatlands, and wetlands

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Herbaceous marsh** — Dense, sparse, flooded | M01/M02/M09/M11 | Grass removed; mineral/organic bed by N2/O3; flooding W | C/O/E/W |
| **Reed marsh** — Uniform or fragmented reedbeds | M01/M11/M09 | Reeds removed; bed and state by N2/O3, not plant density | C/O/E/W |
| **Wooded swamp** — Scattered trees, flooded forest | M01/M09/M11 | Trees removed; water retained; peat only if O3 | C/O/E/W |
| **Raised bog** — Sphagnum, pools | M10/M11 | Peat and raised form O3/O9; sphagnum removed; ponds W | O/F/E/W |
| **Reticulated peatland** — Aapa string mire | M10/M11 | Peat and strings O3/O9; living matter removed; bands not created by texture | O/F/E/W |
| **Hummock peatland** — Sphagnum hummocks, wet hollows | M10/M11 | Peat and hummocks/hollows O3/O9; sphagnum removed | O/F/E/W |
| **Wet meadow** — Rushes, grasses, waterlogged areas | M01/M02/M09/M11 | Rushes/grasses removed; waterlogging O3 and state N4 | C/O/E |
| **Salt marsh** — Salt meadows, glasswort, channels | M11/M03 ; M15 conditional | Saline regime O4; vegetation removed; channels water W | O/F/E/W |
| **Inland mudflat** — Bare mud, shallow water | M11/M03/M02 | Fine matrix N2; saturation/emergence N3/N4; underwater bed O8 | C/O/W |
| **Seasonally flooded plain** — Floodable savanna, grassy hollow | M01/M03/M11 | Seasonal flooding O3/N4; vegetation removed | O/E/W |
| **Papyrus swamp** — Dense, fragmented, floating | M09/M11 ; bed | Papyrus and floating mats removed; peat not automatic; bed O3/O8 | O/E/W |
| **Tropical peat swamp** — Forested or open peatland | M10/M11/M09 | Tropical peat deposit O3; wood/vegetation removed | O/E/W |

### Catalog 1.11. Sandy, muddy, and sedimentary coasts

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Sandy beach** — White, golden, black, red, coarse | M04 | Stock/provenance N2/O4; white or golden by light palette, black via basalt supply; O7 if shell, O1 for special color; grain N2 | C/O/F |
| **Pebble beach** — Fine, coarse, mixed with sand | M05/M04 | Coarse stock, roundness, sorting, energy N2/O4 | C/O/F |
| **Shell beach** — Shell debris, shell sand | M25/M04 | Shell supply O7; shell sand and debris by N2 | O/F |
| **Upper beach** — Dry sand, natural wrack, pioneer vegetation | M04 ; M21 optional | Emergence N3/N4; wrack O7; living pioneers removed | C/O/F/E |
| **Sandy intertidal flat** — Dry, wet, crossed by channels | M04/M11 | Tidal flat and tide O4; dry/wet/channels via level and state | O/F/W |
| **Muddy intertidal flat** — Gray, brown, black mud | M11/M03 | Available fines and low energy O4; tide/level N3/N4 | O/F/W |
| **Coastal sandbar** — Emergent, submerged, mobile | M04 | Identified bar O9; emergence/immersion N3/O4; declared mobility | C/O/F/W |
| **Spit** — Straight, recurved, multiple | M04/M05 | Coastal supply/transport O4; straight/recurved/multiple form O9 | O/F |
| **Tombolo** — Single, double, temporarily submerged | M04/M05 | Existing coastal connection O9; level/tide O4 | O/F/W |
| **Barrier island** — With dunes, lagoon, back-barrier marsh | M04/M11 | Barrier island O9; dunes/lagoon by form, marsh by O3/O4 | O/F/W |
| **Dune ridge** — Embryonic, high, stabilized dune | M04 | Sand N2; dune ridge O9 and history O2; living matter on fixed dunes removed | O/F/E |
| **Beach-ridge plain** — Successive beach ridges | M04/M05 | Inherited ridges O2/O9; source and grain N2/O4 | O/F |
| **Interdune depression** — Dry, wet, marshy | M04/M11/M09 | Depression O9; state N4/O3; M10 peat only if declared | C/O/F |
| **Coastal lagoon** — Open, closed, salty, brackish | Qualified M04/M11 bed | Lagoon O9; salinity and connection O4; bed O8 | O/F/W |
| **Delta** — Bird-foot, lobate, arcuate, estuarine | M04/M05/M03/M11 | Delta O9; supply/sorting N2/N3; coastal regime O4; separate water | O/F/W |
| **Estuary** — Muddy, sandy, multiple bars | M04/M03/M11 | Estuary O9; mixture and energy O4; turbidity in water | O/F/W |
| **Tidal channels** — Straight, winding, dendritic | M11/M04 | Tidal channels O4/O9; bed/bank by supply and emergence | O/F/W |
| **Coastal sabkha** — Saline, wet, crusted | M15/M11/M02 | Salinity and concentration O1/O4; crust only by state | O/F |
| **Mangrove coast** — Dense, fragmented, crossed by channels | M11/M04/M09 | Mangrove removed; bed by N2/O3/O4; peat only if declared | O/F/E/W |

### Catalog 1.12. Rocky coasts, cliffs, and indented shores

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Low rocky coast** — Slabs, blocks, fractured surfaces | M07/M06 | Accessible rock N1; slabs/fractures O10; shore state N3/N4 | C/O/F |
| **Sea cliff** — Limestone, sandstone, granite, volcanic | M07/M06 | Existing cliff O9; lithological source or unit O1/O5 | C/O/F |
| **Wave-cut platform** — Bare rock, algae, pools | M07 ; possible bed | Platform O9; algae removed; water pools N3/O4 | C/O/F/E/W |
| **Boulder coast** — Scree, rock fields, large pebbles | M06/M05 | Stock and source N2; roundness by O4 reworking | C/O/F |
| **Fjord coast** — Narrow, branching, glacial | M07/M28 ; bed | Fjord and legacy O6/O9; separate water | O/F/W |
| **Ria coast** — Drowned river valleys | M07/M03 ; bed | Drowned valley O2/O9; current water N3/O4 | O/F/W |
| **Calanque coast** — Limestone, narrow, deep | M07/M06 ; bed | Limestone source and form O9; bed O8 if visible | O/F/W |
| **Skerry coast** — Rocky islets, emergent reefs | M07 ; bed | Islets/emergent reefs O9; water mask N3/O4 | O/F/W |
| **Arch and pinnacle coast** — Arches, needles, stacks | M07/M06 | Existing arches/pinnacles/stacks O9; material creates no volume | O/F |
| **Volcanic coast** — Black basalt, flows, cliffs | M07/M17/M18 | Current basalt O1; specific flow/cliff O5/O9 | C/O/F |
| **Uplifted coast** — Former beaches, marine terraces | M04/M05/M07 | Uplift and inherited beach/terrace O2/O9 | O/F |
| **Rocky polar coast** — Bare rocks, snow, coastal ice | M07/M06 ; M23/M24 optional | Rock by source; snow/ice by O6 state, not polar name alone | C/O/F |
| **Ice-rafted boulder shore** — Stranded blocks, ice-reworked sediments | M06/M28 | Ice supply/legacy O2/O6; blocks and reworking N2 | O/F |

### Catalog 1.13. Visible seabeds, reefs, and ocean surfaces

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Deep ocean water** — Dark blue, almost black | No visible material imposed | Deep water; bed only if O8 actually establishes visibility | W |
| **Coastal ocean water** — Blue, green, turbid | Possible qualified bed | Water color/turbidity W; independent bed composition O8 | O/W |
| **Submerged sandy bottom** — White, beige, rippled | M04 | Available sandy bed O8; source color; ripples by current/pattern | O/W |
| **Submerged rocky bottom** — Rocks, slabs, blocks | M07/M06 | Rocky bed and depth O8; blocks/slabs by N2/O10 | O/W |
| **Seagrass beds** — Dense, fragmented, mosaic | Qualified mineral support | Living seagrass removed; O8 bed unchanged | E/W |
| **Kelp forest** — Dense, scattered, fringed | Qualified mineral support | Living kelp removed; O8 bed unchanged | E/W |
| **Fringing reef** — Continuous, discontinuous | M25/M07/M04 | Declared reef support O7/O9; living matter removed; visibility O8 | O/F/E/W |
| **Barrier reef** — Linear, cut by passes | M25/M07/M04 | Barrier and passes O7/O9; bed O8; living matter removed | O/F/E/W |
| **Atoll** — Simple, complex, interrupted ring | M25/M04/M07 | Ring and lagoon O9; biogenic support O7; water O8 | O/F/E/W |
| **Inner coral reefs** — Coral heads, patch reefs | M25/M07/M04 | Inner reefs and forms O7/O9; living matter removed; bed O8 | O/F/E/W |
| **Reef flat** — Dead coral, algae, sand | M25/M04 | Dead coral allowed O7; living algae removed; reef flat O9/O8 | O/F/E/W |
| **Spur-and-groove reefs** — Coral spurs and grooves | M25/M04/M07 | Support and grooves/spurs O7/O9; living matter removed; bed O8 | O/F/E/W |
| **Underwater sandbars** — Mobile, rippled, channeled | M04 | Sand stock N2; bars and current O4/O9; bed O8 | O/F/W |
| **Sediment plume** — River, coastal, glacial | No new ground material | Suspended particles and water column; later deposit requires N2/N3 | W |
| **Plankton bloom** — Phytoplankton, cyanobacteria | No new ground material | Living plankton/cyanobacteria outside ground view; water retained | E/W |
| **Floating sargassum** — Scattered, concentrated | No new ground material | Living/floating sargassum excluded; dead wrack only M21/O7 | E/W |
| **Waves and swell** — Small waves, breakers, long waves | No new ground material | Waves/swell/foam in water; do not select bed | W |
| **Marine eddies and fronts** — Convergences, turbidity fronts | No new ground material | Fronts and eddies in water; any bed independent O8 | W |
| **Water with drifting ice** — Ice pieces, small floes, brash ice | No new ground material | Floating ice and floes: water state/objects O6, outside land support | O/E/W |

### Catalog 1.14. Natural vegetation cover

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Closed broadleaf forest** — Continuous, irregular, layered canopy | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Open broadleaf forest** — Spaced trees, visible understory | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Closed conifer forest** — Regular or irregular conifers | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Open conifer forest** — Larches, scattered pines | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Tropical forest with complex canopy** — Multiple crowns, emergent trees | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Dry forest** — Deciduous, thorny | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Riparian forest** — Dense, discontinuous, gallery | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Swamp forest** — Dense, open, flooded | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Mangrove** — Dense, low, high, zoned | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Natural palm forest** — Dense, scattered, mixed | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Natural bamboo stand** — Dense, mixed, in groves | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Stunted forest** — Krummholz, twisted trees | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Tall scrub** — Dense, bushy | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Maquis or matorral** — Dense, sparse, rocky | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Thorn scrub** — Acacias, thorny shrubs, dry bushes | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Low shrub vegetation** — Continuous, scattered | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Isolated trees** — Solitary, small groups, clumps | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Continuous grassland** — Tall, short, dense, dry | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Tufted grassland** — Tussocks, tall grasses | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Alpine meadow** — Short, flowering, rocky | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Sparse steppe** — Low grass, small bushes | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Scattered desert vegetation** — Isolated bushes, succulents | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Banded vegetation** — Tiger bush, banded scrub | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Tree–grass mosaic** — Scattered trees, continuous grass | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Mosses and lichens** — Carpets, patches, biological crusts | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Heathland** — Heather, low woody plants | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Floating aquatic vegetation** — Water lilies, duckweed, floating mats | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |
| **Pioneer vegetation** — Lichens, moss, grass on new deposits | Unchanged support and declared states | Living matter hidden; humus retained if present; M21 litter only via O7 | E |

### Catalog 1.15. Snow, ice, and periglacial landscapes

| Catalog type and variants | Ground recipes or treatment | Specific condition and information required | Status |
| --- | --- | --- | --- |
| **Fresh snow** — Continuous, powdery, little wind | M23 | Snow stock and state O6; powdery/windblown by state, not altitude alone | O |
| **Old snow** — Metamorphosed, granular, refrozen | M23 | Snow and transformation O6; declared grain/refreezing | O |
| **Windblown snow** — Drifts, cornices, sastrugi | M23 | Stock, wind, and forms O6/O9; cornices do not come from albedo | O/F |
| **Discontinuous snow** — On grass, forest, rock | M23 on retained support | Snow cover O6; grass/forest removed, rock/soil retained | O/E |
| **Névé and firn** — Compact, old, accumulating | M23/M24 | Old stock and transformation O6; accumulation by form O9 | O/F |
| **Valley glacier** — Clean, striated, debris-laden | M24 ; M28/M06 as debris | Existing/declared glacier O6/O9; striations and debris by origin | O/F |
| **Crevassed glacier** — Parallel, transverse, intersecting | M24 | Glacier and crevasses O6/O9; line network does not generate glacier | O/F |
| **Seracs** — Fractured, icefalls | M24 | Seracs and ice support O6/O9; existing volumes | O/F |
| **Debris-covered glacier** — Moraine deposits, blocks, dust | M28/M06/M01 on ice | Debris stock and footprint O2/O6; preserve ice under cover | O/F |
| **Rock glacier** — Active, fossil, vegetated | M06/M28/M01 | Active/fossil tongue O2/O6/O9; living matter removed, possible ice separate | O/F/E |
| **Ice cap** — Uniform, fractured, crossed by flows | M23/M24 | Ice cap and flows O6/O9; snow or ice by surface state | O/F |
| **Blue ice** — Compact, exposed, polished | M24 | Exposed ice O6; compact/polished/striated by O10 | O |
| **Lake ice** — Smooth, cracked, snow-covered | M24 on frozen water ; M23 if snow-covered | Declared freezing and snow O6; separate snow cover; retain water domain and level | O/W |
| **Compact sea ice** — Continuous, hummocked | Outside land support | Sea ice O6; ice/water and hummocks, not earth recipe | O/F/W |
| **Fragmented sea ice** — Floes, open-water channels, pressure ridges | Outside land support | Floes/channels/pressure ridges O6/O9; objects and water | O/F/E/W |
| **Shore ice** — Fixed, fractured, partly broken | M24 in shore domain | Fixed ice O6; level/coast N3/O4; declared breakup state | O/F/W |
| **Polynya** — Open water within sea ice | No new ground material | Open water in ice O6/O9; water authority | O/F/W |
| **Icebergs** — Isolated, numerous, tabular | Outside land support | Icebergs O6; floating/stranded objects not generated in ground map | O/E/W |
| **Periglacial polygon ground** — Ice-wedge polygons, high- or low-centered | M27 with M01/M02/M05 | Permafrost/ice wedges O6; high/low polygons O9/O10 | O/F |
| **Frost-sorted ground** — Stone circles, stone stripes | M27 with M05/M06/M01 | Freeze–thaw O6 and grains N2; circles/stripes O9/O10 | O/F |
| **Permafrost mounds** — Palsas, lithalsas, pingos | M27/M10/M01 | Permafrost/water table and form O3/O6/O9; distinguish palsas/lithalsas/pingos | O/F |
| **Thermokarst** — Subsidence, ponds, thaw lakes | M27/M11 ; bed | Degradation and subsidence O6/O9; separate ponds/waters | O/F/W |
| **Microrelief tundra** — Grassy hummocks, moss, ponds | M01/M09/M10/M27 | Microrelief O6/O9; moss/grass removed; peat only O3 | O/F/E/W |
| **Solifluction** — Lobes, terracettes, slow flows | M27/M06/M01 | Freeze–thaw/water and slope O6; lobes/terracettes O9 | O/F |
| **Glacial striations and deposits** — Roches moutonnées, moraines, drumlins | M28/M07 | Glacial legacy and direction O2/O6; moraines/drumlins O9 | O/F |


## Appendix B. Map contexts to ground compositions

This direct reading reprises the 28 MATERIALS_REVIEW §3 situations. It does not turn landscape names into material classes.

| Context | Candidate recipes or treatment | Conditions and scope | Status |
| --- | --- | --- | --- |
| Dry continental plain | M01/M02/M03; M04/M05/M06 by stock | N1/N2/N4; localized moisture; salt and loose sand not automatic | C |
| Wet continental plain | M01/M02/M09/M11 | N1/N4; ponds by N3/O3; peat only if declared | C/O |
| Rocky plateau | M07/M06/M01 | N1/N2; accessible rock, thin cover and earth pockets | C |
| Dissected plateau | M07/M06/M01/M03 | N1/N2; layering and forms if O1/O9/O10 | C/O/F |
| Rounded hills | M01/M08/M07/M11 | N1/N4; localized outcrops and small valleys; no uniform soil | C |
| Temperate mountain | M01/M09/M07/M06; M23 optional | Living matter removed; snow O6; stone stock N2 | C/O |
| Tropical mountain | M01/M09/M11/M07 | Living matter removed; wet by N4; ferruginous M13 only O1/O2 | C/O |
| Arid high mountain | M07/M06/M01; M23 optional | N1/N2; dust if available; snow only O6 | C/O |
| Polar high mountain | M07/M06/M28; M23/M24 conditional | O6 for ice/permafrost; cold alone insufficient | C/O |
| Piedmont | M05/M04/M03/M06 | Supply N2/N3; fans and gullies O9; legacy O2 | C/O/F |
| River valley | M05/M04/M03/M02/M11 | Connection and footprints N3; terraces O2; living matter removed | C/O/F/W |
| Endorheic basin | M02/M11; M15/M04 conditional | Saline/sand stock O1/N2; basin/levels O3/O9 | C/O/F/W |
| Sandy desert | M04; M05/M11 in interdunes | Sand stock N2; dunes O9; declared wind and state | C/O/F |
| Rocky desert | M07/M06/M26; localized M04 | Exposure N1; fragments N2; pavement O2/O10 | C/O |
| Wet karst | M07.limestone/M01/M11 | Karst and water O3/O9; vegetation removed; dissolution O10 | C/O/F |
| Tropical karst | M07.limestone/M01/M11 | Towers and depressions O9; actual cover, not bare limestone everywhere | C/O/F |
| Sandy coastal plain | M04/M05/M11 | N2/O4; dunes/lagoons/marshes according to O3/O9; water W | C/O/F/W |
| Temperate rocky coast | M07/M06/M05; local M04 | N1/N2/O4; algae removed; small beaches by supply | C/O/F/E |
| Tropical coast | M04/M11/M25/M07 | O4/O7/O9; living matter removed; reefs and mangroves do not dictate white sand | O/F/E/W |
| Glacial coast | M07/M28/M06; M23/M24 | Legacy O2/O6; fjord O9; declared snow/ice | O/F/W |
| River delta | M04/M05/M03/M11 | Supply N2/N3; delta O9; separate water and living matter | C/O/F/W |
| Estuary | M04/M03/M11 | O4/O9; bars by footprint and sorting; turbidity in water | O/F/W |
| Rocky archipelago | M07/M06; qualified bed | Islets and water O9/N3; source rock N1; bed O8 | C/O/F/W |
| Coral archipelago | M25/M04/M07; bed | Biogenic support O7/O9; living matter removed; bed O8 | O/F/E/W |
| Active volcanic area | M17/M18/M19/M20 | Units and deposits O5; activity not inferred from basalt alone | O/F |
| Arctic plain | M01/M09/M11/M27; M10 conditional | Cold regime O6; peat O3; living matter removed; lakes W | O/F/E/W |
| Ice sheet | M23/M24; M28 at margins | Ice and forms O6/O9; texture alone does not draw ice sheet | O/F |
| Shallow sea | M04/M07/M11/M25 | Bed O8; living matter removed; water retains visibility and levels | O/E/W |


## Appendix C. Patterns compatible with materials

The 22 MATERIALS_REVIEW §2 patterns specify arrangement. Their cause belongs to material and scenario rules.

| Pattern and variants | Candidate recipes or treatment | Conditions and scope | Status |
| --- | --- | --- | --- |
| **Homogeneous** — Smooth, slightly noisy | M01/M03/M04/M23 | Scale and internal variation; water outside ground; no new cause | C/O |
| **Granular** — Fine, coarse, multiscale | M05/M06/M18/M19 | Grain distribution N2; forest cover excluded | C/O |
| **Patchy** — Small spots, large patches, clusters | M01/M07/M09/M11 | Patches linked to exposure/state/stock; living patches excluded | C/O |
| **Point-like** — Random, clustered, repulsive | M06; small depressions | Blocks by N2; ponds by water; trees/shrubs excluded | C/O/F |
| **Striped** — Parallel, wavy, interrupted | M07/M04 | Strata or ripples with source and direction; vegetation bands excluded | C/O/F |
| **Ribbed** — Parallel, divergent, convergent | M07/M24 | Compatible direction and form O9/O10; existing yardangs | O/F |
| **Wavelike** — Ripples, ridges, superimposed waves | M04/M23 | Wind/current, grains/stock, and scale; waves remain water | C/O |
| **Polygonal** — Regular, irregular, hierarchical | M12/M15/M27/M07 | Separate cause and scale: desiccation/salt/frost/fracture | O |
| **Reticulated** — Fine, broad, irregular meshes | M10/M07/M11 | String/fracture/channel network O3/O9/O10 | O/F |
| **Dendritic** — Branching, fractal, hierarchical | M01/M03/M11 with network | Existing flow or incision N3/O9; not itself a material | C/O/F |
| **Radial** — Divergent, convergent | M18/M19/M05/M28 | Identified volcano/fan/glacier O9; direction from its form | O/F |
| **Concentric** — Rings, arcs, partial crowns | M04/M05/M03 | Ridges/deposits and history O2/O9; rings not created by texture | O/F |
| **Lobate** — Tongues, flows, fingers | M17/M06/M24 | Flow/landslide/glacier O9; material by source and state | O/F |
| **Fan-shaped** — Radiating, superimposed | M05/M04/M03/M06 | Source, transport, and fan form N2/N3/O9 | C/O/F |
| **Ribbon-like** — Continuous, winding, interrupted | M04/M05/M11 | Bands follow network/footprints N3; gallery forest removed | C/O/F |
| **Cellular** — Adjacent or separate cells | M27; reef support M25 | Cells from frost or structure O6/O9; canopy excluded | O/F/E |
| **Fractured** — Straight, angular, branching | M07/M24/M12 | Fractures and cause O10; rock/ice/clay remain distinct | C/O |
| **Multiscale speckled** — Fine texture on large patches | M01/M07/M09 | Multiscale support variation; canopy/steppe removed | C/O/E |
| **Braided** — Interlaced channels | M05/M04 | Channel form O9/N3; deposit between waters, not water turned to gravel | C/O/F/W |
| **Directional** — Aligned with slope, wind, or flow | M04/M07/M06 | Physical wind/slope/flow direction; vegetation removed | C/O |
| **Gradual** — Progressive transition, halos | M01/M11/M15 | Stock/state transitions; salinity only if declared | C/O |
| **Chaotic** — Scree, debris, multiple fractures | M06/M18/M24 | Known source and sizes; conditioned disorder, not free noise | C/O |


## Appendix D. Special phenomena and ground scope

The 12 MATERIALS_REVIEW §4 families are covered by a recipe, scenario condition, or exclusion of living matter/water/objects.

| Family and examples | Candidate recipes or treatment | Conditions and scope | Status |
| --- | --- | --- | --- |
| **Biological soils** — Desert biological crusts, biofilms, microbial mats | Support beneath living matter; possible mineral deposit | Living biofilms/mats/crusts excluded; support minerals retained by source | E/O |
| **Spontaneous vegetation patterns** — Fairy circles, banded vegetation, scrub mosaics | Unchanged support | Plants removed; support differences only with their own data | E |
| **Animal formations** — Large termite mounds, biogenic reefs, bird colonies and guano deposits | M25/M01/M02 | Guano and biogenic support O7; termite mounds/structures O9; animals excluded | O/F/E |
| **Dead wood** — Windthrow, log accumulations, logjams, dead forests | M21 for small debris | Large logs/windthrow/logjams and standing trees outside ground; dead deposit separate | O/E |
| **Natural fires** — Burned ground, charred canopy, ash, vegetation regrowth | M22/M01; possible M21 | Fire and age O7; charred canopy/living regrowth excluded | O/E |
| **Recent erosion** — Mudflows, landslide scars, new gullies | M06/M11/M01 | Event and footprint O2/O9; support/source and state retained | O/F |
| **Flooding** — Submerged ground, deposited sediment, vegetation debris | M03/M04/M05/M11; possible M21 | Water and event O3; post-flood deposit N2; dead debris O7 | O/F/W |
| **Biological blooms** — Surface algae, floating mats, plankton blooms | Possible qualified support | Living algae/plankton/floating mats excluded; water independent | E/W |
| **Coastal organic deposits** — Stranded algae, natural wrack, shell accumulations | M21/M25/M04 | Dead wrack/shells O7 and coastal input O4; living matter excluded | O |
| **Exceptional mineral deposits** — Sulfur, silica, hydrothermal crusts, iron oxides | M20/M13/M15/M16 | Substance and footprint O1/O5; no free mineral patches | O |
| **Crater textures** — Impact craters, ejecta deposits, debris rings | M06/M07/M01 | Declared impact, ejecta, and rings O2/O9; no crater by color | O/F |
| **Glacial events** — Lake outburst floods, proglacial outwash, stranded icebergs | M28/M04/M05; water state | Outburst/outwash O2/O6/O9; iceberg remains object outside ground | O/F/E/W |


## Appendix E. Coverage check

| MATERIALS_REVIEW section | Rows covered | Scope |
| --- | --- | --- |
| 1.1 | 12 | All variants in each row retained |
| 1.2 | 12 | All variants in each row retained |
| 1.3 | 14 | All variants in each row retained |
| 1.4 | 13 | All variants in each row retained |
| 1.5 | 13 | All variants in each row retained |
| 1.6 | 11 | All variants in each row retained |
| 1.7 | 15 | All variants in each row retained |
| 1.8 | 16 | All variants in each row retained |
| 1.9 | 13 | All variants in each row retained |
| 1.10 | 12 | All variants in each row retained |
| 1.11 | 19 | All variants in each row retained |
| 1.12 | 13 | All variants in each row retained |
| 1.13 | 19 | All variants in each row retained |
| 1.14 | 28 | All variants in each row retained |
| 1.15 | 25 | All variants in each row retained |
| Total §1 | **235** | Types and variants associated with a material, form, state, or exclusion |
| §2 | 22 | Patterns |
| §3 | 28 | Contexts |
| §4 | 12 | Special phenomena |

Catalog coverage does not mean all surfaces appear on a given map or that their forms and materials are already implemented. It means every entry has an explicit place in the selector, a production condition, and a response when information is missing.
