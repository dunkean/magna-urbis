# Ground texture map from terrain information

Palette and classification proposal for Test-Render, October 25, 2026.

> English translation of the [French original](GROUND_TEXTURE_MAPPING_V1_FR.md).

The package selects **90 visual types** associated with **142 candidate textures** from Poly Haven and ambientCG. It includes earths, sands and fragments, **22 rock types**, forest soils and litter, grasslands, steppes, savannas, mosses, snow, and surface ice. Trees, their crowns, and buildings remain separate. Ground-level cover textures are part of this map, as requested for this scope.

The four **N1–N4 blocks of section 4.1** of the [comprehensive study](GROUND_MATERIAL_MAPPING.md) are assumed available. Its section 4.2 physical and historical extensions are not required. Types are appearance choices: forest ground, veined rock, or transformed snow can be represented without simulating their formation.

**One asset is selected per type for the entire map** from compatible candidates. Terrain conditions then select types and transitions; they do not draw another texture at every location. Every `F04` occurrence, for example, uses the same needle-litter material. Another seed can select a different F04 candidate on another map.

The [associated catalog](GROUND_TEXTURE_PALETTE_V1.json) contains types, conditions, pools, and asset references. It describes the proposed selection; it does not modify the generator or renderer.

## 1. Sources and scope reduction

The selection starts from libraries in [RENDER_REVIEW.md from the height-chain-budget worktree](../../magna-urbis-height-chain-budget/docs/RENDER_REVIEW.md), §§6–9. Poly Haven and ambientCG cover this catalog; MatSynth remains a reserve, not a dependency. The 15-source library already declared in [surface/materials/catalogue.json](../../magna-urbis-height-chain-budget/surface/materials/catalogue.json) can be partially reused but does not limit the number of types.

Assets are supplied under CC0 according to [Poly Haven's terms](https://polyhaven.com/license) and [ambientCG's terms](https://docs.ambientcg.com/license/). The catalog retains each provider and asset link. This license must be distinguished from API access terms.

Availability of color, normal, roughness, and height channels for the 142 candidates was checked in provider download metadata. Poly Haven albedos and official ambientCG previews were also examined for some candidates; the JSON records that scope per asset. **Availability in a library and visual preselection do not constitute artistic validation in Test-Render.** Not all full packs are downloaded or integrated.

The reduction concerns simulation needs and texture selection, not visible diversity:

| Group | Types |
| --- | ---: |
| Earths and matrices | 12 |
| Sands and fragments | 12 |
| Rocks | 22 |
| Forest soils | 12 |
| Grasslands, steppes, savannas, and other low cover | 16 |
| Wet ground and mosses | 6 |
| Snow and surface ice | 10 |
| **Total** | **90** |

Not every map is intended to show all 90 types. A rich catalog covers differing climates and terrain; a given map loads only types present and needed by the view.

## 2. Information used

| Input | Role in texture selection |
| --- | --- |
| N1: rock exposure, matrix cover, and structural roughness | Rocky support, rock–earth mosaic, or loose ground; compact, coarse, or fractured appearance |
| N2: sand, fines, gravel, stones, sizes, roundness, and origin | Loose sand, sandy earth, gravel, pebbles, or fragments; deposit color from its source |
| N3: typed water, connections, banks, and wet footprints | Wet bed, exposed bar, bank, lakeshore, and coast; retain water masks and levels |
| N4: display state and season | Dry/wet, green/dry grass state, fresh/old/windblown/partial snow, ice if requested by preset |
| Available bedrock and weathering | Compatibility of rock appearances and mineral tints; transition to loose residues |
| Climate, altitude, slope, aspect, curvatures, and geomorphons | Appearance and retention preferences; wet/dry, cold/warm, stable/exposed, hollow/slope/ridge context |
| Available moisture, drainage, and organic matter | Dark earth, mud, wet or mossy mat; these proxies do not become a peat classification |

N4 snow and ice categories are **scene appearance presets**, locally modulated by relief and moisture. Compared with minimal N4 in the comprehensive study, this broadens preset vocabulary; it requires neither new simulation nor section 4.2 extensions. These presets are not glacial-history maps, permafrost maps, or accumulation balances. Without a snow/ice preset, cold alone does not cover the map in white.

### 2.1. Forest, grassland, savanna, and other contexts

Cover context selects ground textures without requiring generation of trees or grass blades. Two paths are possible:

1. Reuse existing canonical land use or cover potential supplied by the generator: broadleaf/conifer/mixed forest, open herbaceous cover, etc. Do not reconstruct these by reading colors from the Render image.
2. Otherwise compute **appearance preferences** from existing inputs, then resolve them using a stable global profile. This produces a plausible map; it does not claim to recover a canopy already painted into a flattened image exactly.

| Appearance context | Preferences computable from available inputs |
| --- | --- |
| Wet forest | Favorable available water and climate, soil cover, stability and organic matter; adapt broadleaf/conifer/mixed to local climate and global profile |
| Dry forest | Retained forest potential, dry N4 state or drier climate; dry litter and matrix |
| Grassland | Stable soil, sufficient water for herbaceous cover, selected open context |
| Steppe | Limited water, visible mineral soil, sparse herbaceous cover; do not automatically convert to sand |
| Savanna | Warm context and selected seasonal herbaceous profile; N4 distinguishes green and dry phases without drawing trees |
| Cold low cover | Low local temperature, exposed ground, compatible moisture and stability; no permafrost history required |
| Moss | High available water and relatively stable favorable surface; rock or matrix according to N1 |

Preferences remain continuous. In ambiguous forest/grassland or broadleaf/conifer cases, an **appearance profile drawn once per map** can bias admissible scores. This draw is distinct from per-type asset selection and does not create per-pixel biome noise. The profile, its biases, and selected textures are saved.

This version's litter and grass are contextual surface appearances. Their presence does not require the detailed biological history of the old O7 extension. If exact correspondence with the generator's trees is desired, its existing cover field must be connected; climate-only inference cannot guarantee exact equality.

### 2.2. Twenty base rock appearances and two colonized appearances

The five current parents — granite, limestone, sandstone, clay-marl, and basalt — remain unchanged in the data. Each carries four appearance profiles: compact, coarser/structured, fractured, and weathered, adapted to its case. This yields twenty base rock types plus two moss/lichen types.

These are **visual types**, not twenty new lithologies inferred from five fractions. Library names do not always certify petrography: an example is selected for grain, structure, and coloring options. Physical terrain provenance remains separate from the photograph's name.

One possible distribution among four profiles for each parent is:

```text
compact  = (1 - alteration) * (1 - rugosite)
grossier = (1 - alteration) * rugosite * (1 - expositionForte)
fracture = (1 - alteration) * rugosite * expositionForte
altere   = alteration
```

These weights sum to 1. They are then multiplied by the parent fraction and N1 rock exposure. `rugosite` and `expositionForte` are appearance proxies, not measurements of crystal size or geological fracturing. The legend can show a dominant type while the renderer retains transitions between types.


## 3. Map information to texture table

Each row below is one persistent type. **PH** means Poly Haven, **ACG** ambientCG. Linked candidates on one row are alternatives; only one is selected for the entire map. An asset may occur in multiple pools, but its settings may differ by type.

Conditions are appearance rules to calibrate, not universal laws. “Warm forest,” “savanna,” and “alpine” identify visual context; photographs do not certify species or capture region. Color and state parameters complement the texture without replacing a different structure with mere tint.

### Earths and matrices

| Type | Map information / conditions | Candidate textures | Adaptation |
| --- | --- | --- | --- |
| **B01 — Fine brown earth** | Dominant exposed matrix, neither loose sand nor selected low cover | [PH brown_mud](https://polyhaven.com/a/brown_mud), [ACG Ground048](https://ambientcg.com/a/Ground048) | Mineral tint and moisture |
| **B02 — Dark organic-rich earth** | Stable matrix, high organic matter, no dense forest carpet | [PH dirt_floor](https://polyhaven.com/a/dirt_floor), [ACG Ground051](https://ambientcg.com/a/Ground051) | Organic darkening; no claim of peat |
| **B03 — Light silty earth** | Available silty fines, low stoniness, stable surface | [ACG Ground102](https://ambientcg.com/a/Ground102), [ACG Ground103](https://ambientcg.com/a/Ground103) | Very fine detail and parent color; no historical loess |
| **B04 — Compact clay earth** | Dominant clay, exposed fines, no active desiccation | [ACG Ground026](https://ambientcg.com/a/Ground026), [PH brown_mud](https://polyhaven.com/a/brown_mud) | Low relief, variable moisture |
| **B05 — Cracked clay earth** | Clay matrix, dry N4 and permitted wet–dry cycle | [PH dry_ground_01](https://polyhaven.com/a/dry_ground_01), [PH mud_cracked_dry_03](https://polyhaven.com/a/mud_cracked_dry_03) | Modest crack scale; no inferred vertisol |
| **B06 — Dry dusty earth** | Available fines, low moisture, exposed loose surface | [ACG Ground104](https://ambientcg.com/a/Ground104), [ACG Ground099](https://ambientcg.com/a/Ground099) | Light palette and low relief |
| **B07 — Cloddy earth** | Irregular loose matrix, intermediate moisture, low rock exposure | [ACG Ground104](https://ambientcg.com/a/Ground104), [PH brown_mud_dry](https://polyhaven.com/a/brown_mud_dry) | Clod granularity; no agricultural furrows |
| **B08 — Dry stony earth** | Matrix with scattered fragments, moderate coarse stock | [PH brown_mud_dry](https://polyhaven.com/a/brown_mud_dry), [ACG Ground091](https://ambientcg.com/a/Ground091) | Stoniness at sample scale |
| **B09 — Wet fine mud** | Exposed fine matrix, wet/saturated N4, outside open water | [ACG Ground036](https://ambientcg.com/a/Ground036), [ACG Ground083](https://ambientcg.com/a/Ground083) | Reduced roughness; open water handled separately |
| **B10 — Dried mud plates** | Cohesive fines, N4 wet–dry cycle, desiccated surface | [PH mud_cracked_dry_riverbed_002](https://polyhaven.com/a/mud_cracked_dry_riverbed_002), [PH mud_cracked_dry_03](https://polyhaven.com/a/mud_cracked_dry_03) | Calibrated plates and cracks; no new soil history |
| **B11 — Warm ocher or reddish earth** | Compatible mineral source and palette, dry exposure | [PH red_dirt_mud_01](https://polyhaven.com/a/red_dirt_mud_01), [ACG Ground098](https://ambientcg.com/a/Ground098) | Appearance variant; does not imply laterite or duricrust |
| **B12 — Friable mineral residue** | High weathering, exposed residual mantle, available fines | [PH dirt](https://polyhaven.com/a/dirt), [ACG Ground105](https://ambientcg.com/a/Ground105) | Parent color and roughness; no deep geological profile |

### Sands and fragments

| Type | Map information / conditions | Candidate textures | Adaptation |
| --- | --- | --- | --- |
| **S01 — Fine light sand** | Available dominant loose sand, few coarse particles | [PH sand_02](https://polyhaven.com/a/sand_02), [ACG Ground052](https://ambientcg.com/a/Ground052) | Compatible sand palette, dry or wet |
| **S02 — Fine ocher sand** | Dominant loose sand, warmer parent/palette | [PH sand_03](https://polyhaven.com/a/sand_03), [ACG Ground080](https://ambientcg.com/a/Ground080) | Chosen tint without creating a mineral province |
| **S03 — Gravelly sand** | Sand stock with abundant small fragments | [PH gravelly_sand](https://polyhaven.com/a/gravelly_sand), [PH sandy_gravel_02](https://polyhaven.com/a/sandy_gravel_02) | Photographic sand–gravel premix |
| **S04 — Compact wet sand** | Sand stock, wet N4, typed proximity or retention | [PH damp_sand](https://polyhaven.com/a/damp_sand), [PH damp_beach_sand](https://polyhaven.com/a/damp_beach_sand) | Remains a ground surface, not a water plane |
| **S05 — Sand with fine ripples** | Loose sand, relevant wind or current, no large dune to create | [PH sand_02](https://polyhaven.com/a/sand_02), [PH sand_03](https://polyhaven.com/a/sand_03) | PBR base and fine directional ripples; set selected once |
| **S06 — Firm lightly textured sand** | Compact sand or stable fine mixture, low roughness | [ACG Ground092C](https://ambientcg.com/a/Ground092C), [ACG Ground101](https://ambientcg.com/a/Ground101) | Low relief; no inferred salt or gypsum |
| **G01 — Fine angular gravel** | Fine coarse stock, high angularity, substantial cover | [PH gravel_stones](https://polyhaven.com/a/gravel_stones), [ACG Gravel043](https://ambientcg.com/a/Gravel043) | Calibrate physical element size |
| **G02 — Coarse gravel** | Larger angular stock, connected deposit or slope | [PH rock_ground](https://polyhaven.com/a/rock_ground), [ACG Gravel022](https://ambientcg.com/a/Gravel022) | Fragments and matrix already present in photograph |
| **G03 — Small rounded pebbles** | N2 rounded small sizes, reworked deposit | [PH clean_pebbles](https://polyhaven.com/a/clean_pebbles), [ACG Gravel020](https://ambientcg.com/a/Gravel020) | Deposit provenance; no imposed local rock |
| **G04 — Medium and large pebbles** | N2 rounded larger sizes, sufficient reworked stock | [PH dry_river_pebbles](https://polyhaven.com/a/dry_river_pebbles), [PH ganges_river_pebbles](https://polyhaven.com/a/ganges_river_pebbles) | Consistent scale, no arbitrary grain enlargement |
| **G05 — Ground with scattered stones** | Fragments on matrix, intermediate coverage | [PH rocks_ground_03](https://polyhaven.com/a/rocks_ground_03), [ACG Rocks009](https://ambientcg.com/a/Rocks009) | Premixed area texture |
| **G06 — Rock and fragment mosaic** | N1 partial rock with loose mantle and fragments | [PH rocks_ground_06](https://polyhaven.com/a/rocks_ground_06), [PH rocks_ground_05](https://polyhaven.com/a/rocks_ground_05) | Do not add matrix twice or introduce large new volumes |

### Rocks

| Type | Map information / conditions | Candidate textures | Adaptation |
| --- | --- | --- | --- |
| **R01 — Compact fine granite appearance** | Granite parent, low weathering and roughness | [PH rock_01](https://polyhaven.com/a/rock_01), [ACG Rock024](https://ambientcg.com/a/Rock024) | Rock grain and color; samples not petrographically certified |
| **R02 — Coarse-grained granite appearance** | Granite parent, intermediate roughness, exposed rock | [PH rock_boulder_dry](https://polyhaven.com/a/rock_boulder_dry), [ACG Rock048](https://ambientcg.com/a/Rock048) | Preserve mineral detail and granite tint |
| **R03 — Highly fractured granitic rock** | Granite parent, high structural roughness or exposed slope | [ACG Rock058](https://ambientcg.com/a/Rock058), [PH rock_05](https://polyhaven.com/a/rock_05) | Sample fractures, no added geological fault |
| **R04 — Weathered granitic rock** | Granite parent and high weathering, transition to fines | [PH rock_surface](https://polyhaven.com/a/rock_surface), [PH rock_08](https://polyhaven.com/a/rock_08) | Reduced relief and weathering palette |
| **R05 — Massive light carbonate rock** | Limestone parent, compact exposed rock | [ACG Rock018](https://ambientcg.com/a/Rock018), [PH rock_08](https://polyhaven.com/a/rock_08) | Light color, no new karst |
| **R06 — Bedded carbonate rock** | Limestone parent, exposed oriented structure | [ACG Rock019](https://ambientcg.com/a/Rock019), [ACG Rock017](https://ambientcg.com/a/Rock017) | Orient pattern; no additional bedding dip required |
| **R07 — Cracked carbonate rock** | Limestone parent, high roughness or exposure | [ACG Rock027](https://ambientcg.com/a/Rock027), [PH rock_boulder_dry](https://polyhaven.com/a/rock_boulder_dry) | Local texture cracks, no sinkholes |
| **R08 — Weathered or pitted carbonate rock** | Limestone parent, weathering and thin cover | [ACG Rock032](https://ambientcg.com/a/Rock032), [PH rock_08](https://polyhaven.com/a/rock_08) | Generic eroded appearance; no simulated dissolution |
| **R09 — Layered sandstone** | Sandstone parent, exposed oriented structure | [PH cliff_side](https://polyhaven.com/a/cliff_side), [ACG Rock061](https://ambientcg.com/a/Rock061) | Align beds; avoid random rotations |
| **R10 — Massive ocher sandstone** | Sandstone parent, compact rock and warm palette | [PH rock_face](https://polyhaven.com/a/rock_face), [ACG Rock029](https://ambientcg.com/a/Rock029) | Preserve structure without claiming precise chemistry |
| **R11 — Light weathered sandstone** | Sandstone parent, compatible weathering and light tint | [PH worn_rock_natural_01](https://polyhaven.com/a/worn_rock_natural_01), [ACG Rock052](https://ambientcg.com/a/Rock052) | Tint and asperity scale |
| **R12 — Coarse fractured sandstone** | Sandstone parent, high roughness and exposed slope | [PH rock_boulder_cracked](https://polyhaven.com/a/rock_boulder_cracked), [ACG Rock056](https://ambientcg.com/a/Rock056) | Large relief limited to texture representation |
| **R13 — Compact clay-marl rock** | Clay-marl parent, accessible compact rock | [PH rock_surface](https://polyhaven.com/a/rock_surface), [ACG Rock041](https://ambientcg.com/a/Rock041) | Fine visual substitute, softened and recolored |
| **R14 — Platy clay-marl rock** | Clay-marl parent, rough structural texture | [ACG Rock060](https://ambientcg.com/a/Rock060), [ACG Rock034](https://ambientcg.com/a/Rock034) | Visual plates; no inferred physical schistosity |
| **R15 — Finely layered clay-marl rock** | Clay-marl parent, oriented structure, moderate weathering | [ACG Rock027](https://ambientcg.com/a/Rock027), [ACG Rock038](https://ambientcg.com/a/Rock038) | Provided direction, limited relief variation |
| **R16 — Friable clay-marl rock** | Clay-marl parent, high weathering and available fines | [ACG Rock062](https://ambientcg.com/a/Rock062), [PH rock_2](https://polyhaven.com/a/rock_2) | Transition to B12/B04, no dry class alternation |
| **R17 — Compact dark basaltic rock** | Basalt parent, low weathering and roughness | [PH dark_rock_02](https://polyhaven.com/a/dark_rock_02), [ACG Rock031](https://ambientcg.com/a/Rock031) | Dark rock appearance, not recent lava |
| **R18 — Cracked dark basaltic rock** | Basalt parent, high roughness or exposure | [PH dark_rock](https://polyhaven.com/a/dark_rock), [ACG Rock035](https://ambientcg.com/a/Rock035) | Material fracture network, no invented flow |
| **R19 — Very rough basaltic rock** | Basalt parent, high roughness and fragmentation | [ACG Rock047](https://ambientcg.com/a/Rock047), [ACG Rock048](https://ambientcg.com/a/Rock048) | Generic massive or brecciated appearance; no identified scoria |
| **R20 — Weathered basaltic rock** | Basalt parent, high weathering, compatible moisture and deposits | [ACG Rock033](https://ambientcg.com/a/Rock033), [ACG Rock037](https://ambientcg.com/a/Rock037) | Patina and weathering tint, no mineralogical diagnosis |
| **R21 — Mossy rock** | Exposed rock, wet low-cover context, favorable aspect | [ACG Rock064](https://ambientcg.com/a/Rock064), [PH mossy_rock](https://polyhaven.com/a/mossy_rock) | Texture already combines rock and moss; context identified |
| **R22 — Rock with lichens or vegetation speckles** | Exposed rock, cool and relatively stable low-cover context | [PH lichen_rock](https://polyhaven.com/a/lichen_rock), [ACG Rock046S](https://ambientcg.com/a/Rock046S) | Surface appearance without a new biological map |

### Forest soils

| Type | Map information / conditions | Candidate textures | Adaptation |
| --- | --- | --- | --- |
| **F01 — Dense dry broadleaf litter** | Broadleaf context, dry or N4 dry season, accessible mantle | [PH forest_leaves_03](https://polyhaven.com/a/forest_leaves_03), [PH forest_leaves_04](https://polyhaven.com/a/forest_leaves_04) | Leaves and ground already mixed; no painted tree |
| **F02 — Light broadleaf litter** | Broadleaf context, light palette or declared leaf-fall season | [ACG ScatteredLeaves008](https://ambientcg.com/a/ScatteredLeaves008), [ACG ScatteredLeaves009](https://ambientcg.com/a/ScatteredLeaves009) | Global seasonal choice, not change per pixel |
| **F03 — Dark wet broadleaf ground** | Broadleaf context, high moisture and organic matter | [ACG Ground023](https://ambientcg.com/a/Ground023), [PH mud_forest](https://polyhaven.com/a/mud_forest) | No claim of physical peat |
| **F04 — Dense needle litter** | Conifer context, stable needle mantle | [PH forrest_ground_03](https://polyhaven.com/a/forrest_ground_03), [ACG Ground082S](https://ambientcg.com/a/Ground082S) | Needle detail without generating conifers |
| **F05 — Sandy conifer ground** | Conifer context, available sandy matrix | [PH forrest_sand_01](https://polyhaven.com/a/forrest_sand_01), [ACG Ground084](https://ambientcg.com/a/Ground084) | Retain sand and debris, not uniform green |
| **F06 — Mixed forest ground** | Mixed forest context or mixed appearance profile | [PH leaves_forest_ground](https://polyhaven.com/a/leaves_forest_ground), [ACG Ground078](https://ambientcg.com/a/Ground078) | Mixture already in texture |
| **F07 — Stony forest ground** | Forest context, N1/N2 fragments or partial rock | [PH forest_ground_04](https://polyhaven.com/a/forest_ground_04), [ACG Ground085](https://ambientcg.com/a/Ground085) | Not reclassified as massive rock |
| **F08 — Mossy forest ground** | Wet forest context, mossy low cover permitted | [PH forest_leaves_02](https://polyhaven.com/a/forest_leaves_02), [ACG Ground024](https://ambientcg.com/a/Ground024) | Moss and leaves from one sample |
| **F09 — Forest ground with exposed roots** | Forest context, thin mantle or relative stripping | [PH roots](https://polyhaven.com/a/roots), [ACG Ground076](https://ambientcg.com/a/Ground076) | Ground roots, not trunk or crown |
| **F10 — Forest clearing earth** | Open forest context, little litter, exposed matrix | [ACG Ground071](https://ambientcg.com/a/Ground071), [PH dirt_floor](https://polyhaven.com/a/dirt_floor) | Transition to grass and bare ground |
| **F11 — Dry forest ground** | Warm/dry forest context or N4 dry phase | [PH dry_decay_leaves](https://polyhaven.com/a/dry_decay_leaves), [PH winter_leaves](https://polyhaven.com/a/winter_leaves) | Dry debris, bounded recoloring |
| **F12 — Warm wet forest ground** | Warm/wet forest context, organic matrix and litter | [PH leaves_forest_ground](https://polyhaven.com/a/leaves_forest_ground), [ACG Ground106](https://ambientcg.com/a/Ground106) | Ground appearance approximation, not identification of tropical species |

### Grasslands, steppes, savannas, and low cover

| Type | Map information / conditions | Candidate textures | Adaptation |
| --- | --- | --- | --- |
| **P01 — Dense green grassland** | Herbaceous context, medium to high moisture, stable matrix | [ACG Grass001](https://ambientcg.com/a/Grass001), [ACG Grass002](https://ambientcg.com/a/Grass002) | Ground-level texture, no trees |
| **P02 — Very short turf or grassland** | Short herbaceous context, regular stable surface | [ACG Grass005](https://ambientcg.com/a/Grass005), [ACG Grass006](https://ambientcg.com/a/Grass006) | Appearance use, not evidence of human mowing |
| **P03 — Heterogeneous green grassland** | Herbaceous context, variable soil and moisture | [ACG Grass003](https://ambientcg.com/a/Grass003), [ACG Grass004](https://ambientcg.com/a/Grass004) | Sample heterogeneity, stable identity |
| **P04 — Broadleaf grassland** | Relatively warm/wet herbaceous context | [PH leafy_grass](https://polyhaven.com/a/leafy_grass), [ACG Grass001](https://ambientcg.com/a/Grass001) | Small low-cover plants, no canopy |
| **P05 — Dense tall-looking grassland** | Productive wet herbaceous context | [PH leafy_grass](https://polyhaven.com/a/leafy_grass), [ACG Grass004](https://ambientcg.com/a/Grass004) | Top-down appearance; texture does not create volumetric stems |
| **P06 — Matted dry grassland** | Herbaceous context, dry N4, low available water | [PH withered_grass](https://polyhaven.com/a/withered_grass), [PH grass_ground](https://polyhaven.com/a/grass_ground) | Retain dry structure, not merely recolored lawn |
| **P07 — Sparse grass on earth** | Open herbaceous cover, visible matrix | [PH sparse_grass](https://polyhaven.com/a/sparse_grass), [ACG Ground003](https://ambientcg.com/a/Ground003) | Premixed plant/earth texture |
| **P08 — Dry steppe** | Dry herbaceous context, limited water, little dense cover | [PH sparse_grass](https://polyhaven.com/a/sparse_grass), [ACG Ground013](https://ambientcg.com/a/Ground013) | Straw and earth palette, density suited to type |
| **P09 — Stony steppe** | Open cold/dry herbaceous context, fragments/partial rock | [PH aerial_grass_rock](https://polyhaven.com/a/aerial_grass_rock), [ACG Ground067](https://ambientcg.com/a/Ground067) | Mineral/herbaceous premix, not bare rock material |
| **P10 — Green wet-season savanna** | Warm seasonal context, dominant herbaceous cover, wet N4 | [PH leafy_grass](https://polyhaven.com/a/leafy_grass), [ACG Grass004](https://ambientcg.com/a/Grass004) | No trees in this ground texture |
| **P11 — Dry savanna with continuous grasses** | Warm seasonal context, dry N4, continuous herbaceous cover | [PH withered_grass](https://polyhaven.com/a/withered_grass), [PH grass_ground](https://polyhaven.com/a/grass_ground) | Dry grasses without converting all ground to sand |
| **P12 — Open savanna with visible earth** | Warm context, limited water and discontinuous grass | [PH sparse_grass](https://polyhaven.com/a/sparse_grass), [ACG Ground003](https://ambientcg.com/a/Ground003) | Visible matrix tinted according to source |
| **P13 — Stony savanna** | Warm open herbaceous context and coarse stock | [PH brown_mud_rocks_01](https://polyhaven.com/a/brown_mud_rocks_01), [ACG Ground067](https://ambientcg.com/a/Ground067) | Grass/earth/stones as one area recipe |
| **P14 — Short alpine meadow** | Cold high-altitude context, exposed snow-free ground, low cover | [ACG Grass003](https://ambientcg.com/a/Grass003), [ACG Grass004](https://ambientcg.com/a/Grass004) | No inferred permafrost or glacier |
| **P15 — Cold grass and moss mat** | Cold wet context, low cover and stable matrix | [ACG Moss003](https://ambientcg.com/a/Moss003), [ACG Grass003](https://ambientcg.com/a/Grass003) | Tundra-like appearance without permafrost history |
| **P16 — Herbaceous heath mixed with debris** | Cool open context, medium moisture, mixed low cover | [ACG Ground037](https://ambientcg.com/a/Ground037), [PH forrest_ground_01](https://polyhaven.com/a/forrest_ground_01) | Small plants and debris, no volumetric shrubs or trees |

### Wet ground and mosses

| Type | Map information / conditions | Candidate textures | Adaptation |
| --- | --- | --- | --- |
| **H01 — Dark wet grass** | Herbaceous cover, hollow or retention, wet state | [ACG Grass002](https://ambientcg.com/a/Grass002), [ACG Ground037](https://ambientcg.com/a/Ground037) | Fines and dark green, no floating vegetation |
| **H02 — Exposed wet organic ground** | Organic-rich matrix and wet N4, outside open water | [ACG Ground051](https://ambientcg.com/a/Ground051), [PH mud_forest](https://polyhaven.com/a/mud_forest) | Organic appearance, not thick peat |
| **H03 — Dense cushion moss** | Wet low-cover profile and stable support | [ACG Moss002](https://ambientcg.com/a/Moss002), [ACG Moss004](https://ambientcg.com/a/Moss004) | Complete moss texture, not forest |
| **H04 — Moss mixed with litter** | Wet context, mixed debris and low cover | [ACG Moss001](https://ambientcg.com/a/Moss001), [PH forest_leaves_02](https://polyhaven.com/a/forest_leaves_02) | One premix, not two layers counted twice |
| **H05 — Wet stones and moss** | Partial rocky support or fragments and wet low cover | [ACG Ground068](https://ambientcg.com/a/Ground068), [ACG Ground086](https://ambientcg.com/a/Ground086) | Rock/moss, retain local mineral identity |
| **H06 — Wet bank with small debris** | N3 typed bank, wet fine matrix and low cover/debris | [ACG Ground024](https://ambientcg.com/a/Ground024), [PH mud_forest](https://polyhaven.com/a/mud_forest) | No tide, salinity, or peatland required |

### Snow and surface ice

| Type | Map information / conditions | Candidate textures | Adaptation |
| --- | --- | --- | --- |
| **N01 — Fine fresh snow** | N4 fresh-snow preset and positive local retention | [ACG Snow005](https://ambientcg.com/a/Snow005), [ACG Snow001](https://ambientcg.com/a/Snow001) | Surface mantle, not glacier |
| **N02 — Irregular fresh snow** | N4 snow preset, less regular surface | [ACG Snow002](https://ambientcg.com/a/Snow002), [ACG Snow004](https://ambientcg.com/a/Snow004) | Calibrated surface relief |
| **N03 — Compact snow** | N4 compact or naturally packed snow preset | [ACG Snow007A](https://ambientcg.com/a/Snow007A), [ACG Snow010A](https://ambientcg.com/a/Snow010A) | Candidates without explicit human tracks |
| **N04 — Granular transformed snow** | N4 old/transformed snow preset | [ACG Snow003](https://ambientcg.com/a/Snow003), [ACG Snow010A](https://ambientcg.com/a/Snow010A) | Appearance variant, not metamorphism simulation |
| **N05 — Windblown rippled snow** | N4 windblown-snow preset and available regional direction | [ACG Snow008A](https://ambientcg.com/a/Snow008A), [ACG Snow009A](https://ambientcg.com/a/Snow009A) | Align pattern, no new cornice |
| **N06 — Dirty or melting snow** | N4 melt preset, exposed mineral or organic support | [ACG Snow014](https://ambientcg.com/a/Snow014), [PH snow_04](https://polyhaven.com/a/snow_04) | Coverage and moisture separate from bedrock |
| **N07 — Patchy snow on grass** | N4 partial-snow preset, underlying herbaceous context | [ACG Snow015](https://ambientcg.com/a/Snow015) | Premix already snowy; do not add a second full snow layer |
| **N08 — Patchy snow on mineral ground** | N4 partial-snow preset, rocky/mineral support | [ACG Snow014](https://ambientcg.com/a/Snow014), [PH snow_05](https://polyhaven.com/a/snow_05) | Mineral patches and support transition; no glacial history |
| **I01 — Ice with small fractures** | N4 surface-ice preset, explicitly selected frozen ground or water | [ACG Ice002](https://ambientcg.com/a/Ice002), [ACG Ice003](https://ambientcg.com/a/Ice003) | Retain water level in aquatic domain |
| **I02 — Ice with large fractures** | N4 fractured-ice preset and compatible domain | [ACG Ice001](https://ambientcg.com/a/Ice001), [ACG Ice004](https://ambientcg.com/a/Ice004) | Texture selection generates no sea ice or glacier crevasse |

## 4. Resolving choices and covering the whole map

### 4.1. Classification order

1. **Water domain:** retain water and its N3 levels. N4 ice states explicitly concern this domain or exposed support; they do not change lake height. Without a qualified bottom, deep water is not repainted with sandy ground.
2. **Mineral support:** N1/N2 determine rock/matrix/fragment possibilities. Parents and deposit proportions constrain R, B, S, and G types. Earth over basalt is not necessarily a black slab.
3. **Surface context:** select F, P, and H possibilities from provided cover or §2.1-derived preferences. Exposed rock areas remain rocky; a wet climate does not paint leaves on a cliff.
4. **N4 state:** apply dry/wet variants and allowed N/I types. Snow can mask support while the latter is retained underneath.
5. **Transitions and color:** produce type weights, tint, and moisture. None of these calculations redraws the global asset choice.

Climate alone therefore does not select a material: savanna on sand, savanna on stony earth, and wet-phase savanna may yield different types without new simulation.

To convert table conditions into weights, distinguish necessary constraints from preferences. A type without admissible support receives zero: no pebbles without rounded stock, no litter without forest context, and no snow without a preset. Other criteria yield continuous scores with transition ranges to calibrate: moisture, cold, weathering, cover openness, roughness. Normalize admissible scores **within the relevant support budget**, then apply contextual and state cover; do not normalize all catalog rows together. If no score is admissible, use the §4.3 fallback.

Cases sharing inputs can remain a mixture or be resolved by the saved global profile. For example, tall grassland and dense grassland are not two measured observations if no height information exists: they are then appearance options. No new random field is fabricated to distribute them locally. Numeric score thresholds and texture scales still need calibration against actual layer ranges; this table does not present them as already validated in the renderer.

### 4.2. Homogeneous and premixed textures

A forest texture often contains earth, leaves, and twigs; an open-savanna texture contains grass and earth; G06 already contains rock and matrix; N07 already contains grass and snow. These types are **premixed area recipes**. Their weights are not exact grain-size fractions.

When such a type is used, do not add everything it contains a second time. In particular, do not add N07 and full snow, F01 and full litter, or G06 and a full matrix. It can gradually transition to palette neighbors at its edges. If exact physical shares or separate coloring of each component become necessary, prepare material masks or separate components; that is not an entry requirement for this package.

N1/N2 set or bound support coverage; textures are chosen among types compatible with this budget. Transitions cannot remove known exposed rock to arbitrarily increase grassland. The exact budget can be approximated by a premixed photographic recipe; that approximation remains identified as such.

### 4.3. Fallback without holes

| Situation without a specialized candidate | Fallback type |
| --- | --- |
| Ordinary exposed mineral matrix | B01; B08 if small fragments are known |
| Known loose sand | S01; do not invent sand when unavailable |
| Coarse stock without a more precise appearance variant | G01/G02 by size; known roundness leads to G03/G04 |
| Exposed rock | Compact type of dominant parent, preserving parent proportions |
| Herbaceous context without a selected subtype | P01 wet, P06 dry, P07 open according to N4/N1 |
| Forest context without a selected subtype | F06; F10 if matrix is mostly exposed |
| Requested snow without other detail | N01; coverage mask comes from N4 preset |
| Water without a described bottom | Water authority, without a false bottom material |

This fallback covers valid map surfaces; out-of-domain regions and missing data remain flagged. Download problems are handled during palette preparation with a compatible recorded fallback candidate; they do not cause a new draw when the camera moves.

Specialized saline, gypsiferous, peat, hydrothermal, or pyroclastic types are not enabled by default without section 4.2 information. This does not prevent organic-looking soils, numerous rocks, or requested scene snow. Glaciers, major dunes, and cliffs remain terrain forms, not effects produced by choosing a photograph.

## 5. One draw per type for the entire map

```text
for each type T:
    candidates = validated pool[T], sorted by stable identifier
    index = hash(worldSeed, paletteVersion, T.id) modulo len(candidates)
    palette[T] = {chosen asset, scale, reference tint, state parameters}
    save result and image hashes

for each position x:
    typesAndWeights = classify(mapInfo(x), N1(x), N2(x), N3(x), N4, globalProfile)
    textures = palette[typesAndWeights.types]
    synthesize those same textures in physical coordinates
```

The global surface profile draw, when necessary, has its own seed key. It is not hidden in image selection. Candidate lists are versioned; a saved map retains its resolved assets even if the library or selection changes.

The same texture can be offset or rotated locally to break tiling without changing identity. All its PBR channels undergo the same transformations. Oriented textures — rock beds, ripples, snow striations — retain a consistent direction rather than unrestricted rotation per patch. One seed and version produce the same palette independently of camera and LOD.

Version 1 can use equal probabilities among admissible candidates. Preference weights can later favor better-suited sources; they are global per type, not recalculated with a different photo preference in every area.

## 6. Recoloring and multi-scale texturing

### 6.1. Reference color and detail

Source albedo is converted to linear light. Its mean `mu` is measured after preparation. For a compatible target `C`, a first adjustment is:

```text
gain = clamp(C / max(mu, epsilon))
recoloredAlbedo(x) = sourceAlbedo(x) * gain
```

Gain stays bounded to preserve contrast and avoid amplifying nearly black channels. An incompatible target requires another admissible asset, not extreme gain. Recalculate the prepared/recolored material mean: that mean is displayed at distance. Do not use arbitrary diagnostic-layer colors as ground colors.

For minerals, the target comes from type, rock source or N2 deposit, organic matter, and moisture. Grassland greens, leaves, moss, snow, and ice have their own palettes; they do not inherit bedrock tint. Premixed textures without internal masks use moderate recoloring or none if it distorts their components.

Changing normal-map blue or a roughness value is not recoloring. Normals, heights, and roughness follow their own conventions and scales. Moisture modifies material response; by itself it does not create ponds or a new water surface.

### 6.2. From flyover to detail

| Regime | Value to display |
| --- | --- |
| Texture unresolved in flyover | Recolored material's linear mean, combined using the same type weights |
| Detail becoming resolved | Filtered appearance of color residual, normals, roughness, and height |
| Close texture | Same asset and physical scale, coherent stochastic synthesis |
| Detail finer than the photograph | Grains, fine ripples, or small debris compatible with type; not identical rock noise applied to every material |

Mean and detail are not two separately selected palettes. Distant green grassland must not become different ground when zoomed in; white snow must not disappear as its grains appear. Type transitions are filtered while respecting N3 shores and footprints. PBR channels are blended using consistent weights and comparable physical amplitudes.

Capture dimensions and rendering scales are not interchangeable. Legacy catalog `physicalExtentMetres` values are author settings, not proof of capture size. During ingestion, retain provider metadata and calibrate recognizable element sizes. Do not stretch gravel to represent meter-scale blocks or enlarge fine-grained snow to create a cornice.

## 7. Produced map and checks

The output can remain compact:

```text
global palette: typeId -> assetId + channels + scale + parameters + hashes
map: dominant type + transition neighbors/weights + tint + moisture
domains: water / ground / display snow-ice + validity masks
diagnostic: applied rule + cover profile + possible fallback
```

Full classification weights remain the reference. Reducing to two or three types for display must not cause abrupt changes at junctions or alter the distant mean. Map export can bake the view or texture pages; it does not require one centimeter-resolution image of the entire territory.

| Check | Expected |
| --- | --- |
| Diversity | All 90 types accessible through their rules; a map need not show all of them |
| Real references | Every candidate points to an existing asset and the four stated channels; no wall/paving texture confused with natural ground |
| Global draw | One resolved asset per type across the map; pan and zoom do not change it |
| Forest and herbaceous | Leaves, needles, mosses, green/dry grasses, and open soils remain distinct; no crown painted into ground |
| Rock | Five parents retain physical identity; 22 surface appearances do not invent 22 lithological observations |
| Snow and ice | Explicit N4 preset, retained support, no new glacial history required |
| Coverage | No holes in valid domain; water treated explicitly; support-compatible fallback |
| Premixes | A texture already containing earth/grass/stones/snow is not doubled by identical layers |
| Asset quality | Inspect repetition, human traces, residual lighting, and scale; unsuitable candidates leave pool before draw |
| Multiple scales | Distant mean and close texture derive from the same assets, tints, and proportions |

## 8. Examples of examined sources

These plates show library albedos or previews to compare material diversity. The ambientCG spheres are provider-lit previews, not our map's rendering or a mean color to copy. They illustrate some candidates, not full qualification of all 142 packs in the engine.

### Forest soils: needles, leaves, roots, earth, and mosses

![Forest soils: needles, leaves, roots, earth, and mosses](surface/evidence/ground-texture-palette-v1/forest-sources.png)

### Low cover: grasslands, open ground, and mosses

![Low cover: grasslands, open ground, and mosses](surface/evidence/ground-texture-palette-v1/herbaceous-sources.png)

### Rocks: structures, grains, fractures, and colonized surfaces

![Rocks: structures, grains, fractures, and colonized surfaces](surface/evidence/ground-texture-palette-v1/rock-sources.png)

### Snow and ice: fine textures, ripples, and partial cover

![Snow and ice: fine textures, ripples, and partial cover](surface/evidence/ground-texture-palette-v1/snow-sources.png)

