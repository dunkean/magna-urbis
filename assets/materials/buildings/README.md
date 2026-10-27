# Building textures — offline collection

[Français](README_FR.md)

57 PBR sets, 283 maps, 501.1 MiB of maps. Source resolution 1K; original files unmodified.

Collection only: no engine integration or automatic assignment to buildings.

[Guide and limitations](../../../docs/BUILDING_TEXTURE_LIBRARY.md) · [Color contact sheet](contact-sheet.jpg) · [Complete catalogue](catalog.json) · [Selection and qualifications](selection.json)

Powered by [Poly Haven](https://polyhaven.com/) and [ambientCG](https://ambientcg.com/). Downloaded maps are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) under the [Poly Haven](https://polyhaven.com/license) and [ambientCG](https://docs.ambientcg.com/license/) licenses. Previews derive from color maps, not site renders.

## Available types

`MAT-*` identifiers are documentary use leads. Their `direct`, `proxy` or `missing` qualification is in the next table. Cultural profiles and construction patterns must be checked during integration.

| Texture / provider | Type | Candidate native materials | Extent (m) | Maps | Note |
|---|---|---|---|---|---|
| [clay_roof_tiles](roof/polyhaven-clay_roof_tiles/material.json) ([source](https://polyhaven.com/a/clay_roof_tiles)) | Weathered curved terracotta tiles | MAT-TILE-CLAY | 4 × 4 | base_color, normal_gl, roughness, height, ao | Orient tile rows toward the eaves; this is not an exact ancient tegula. |
| [clay_roof_tiles_02](roof/polyhaven-clay_roof_tiles_02/material.json) ([source](https://polyhaven.com/a/clay_roof_tiles_02)) | Overlapping terracotta tiles | MAT-TILE-CLAY | 2.5 × 2.5 | base_color, normal_gl, roughness, height, ao | Profile and aging variant; check module for each tradition. |
| [ceramic_roof_01](roof/polyhaven-ceramic_roof_01/material.json) ([source](https://polyhaven.com/a/ceramic_roof_01)) | Aged ceramic roofing | MAT-TILE-CLAY | 3.5 × 3.5 | base_color, normal_gl, roughness, height, ao | Rustic mossy variant. |
| [grey_roof_tiles](roof/polyhaven-grey_roof_tiles/material.json) ([source](https://polyhaven.com/a/grey_roof_tiles)) | Grey ceramic tiles | MAT-TILE-CLAY | 3 × 3 | base_color, normal_gl, roughness, height, ao | Dark base for East Asia; does not replace Chinese, Korean or Japanese profiles. |
| [roof_slates_02](roof/polyhaven-roof_slates_02/material.json) ([source](https://polyhaven.com/a/roof_slates_02)) | Weathered irregular slates | MAT-SLATE | 3 × 3 | base_color, normal_gl, roughness, height, ao | Rows oriented along the slope. |
| [roof_slates_03](roof/polyhaven-roof_slates_03/material.json) ([source](https://polyhaven.com/a/roof_slates_03)) | Regular slates | MAT-SLATE | 3 × 3 | base_color, normal_gl, roughness, height, ao | Slate, not thick limestone roofing slabs. |
| [reed_roof_03](roof/polyhaven-reed_roof_03/material.json) ([source](https://polyhaven.com/a/reed_roof_03)) | Reed thatch | MAT-THATCH, MAT-REED | 2.5 × 2.5 | base_color, normal_gl, roughness, height, ao | Reeds and crosspieces are visible in the map; inspect repetition and do not duplicate crosspieces with geometry. |
| [reed_roof_04](roof/polyhaven-reed_roof_04/material.json) ([source](https://polyhaven.com/a/reed_roof_04)) | Reed thatch, variant | MAT-THATCH, MAT-REED, MAT-PALM | 2.5 × 2.5 | base_color, normal_gl, roughness, height, ao | For PALM: fibrous approximation; no identifiable palm leaves. |
| [thatch_roof_angled](roof/polyhaven-thatch_roof_angled/material.json) ([source](https://polyhaven.com/a/thatch_roof_angled)) | Angled straw thatch | MAT-THATCH | 0.54 × 0.54 | base_color, normal_gl, roughness, height, ao | Inspect native orientation before creating UVs. |
| [WoodSiding010](roof/ambientcg-WoodSiding010/material.json) ([source](https://ambientcg.com/a/WoodSiding010)) | Weathered wood shingles | MAT-WOOD-SHINGLES | 1.4 × 1.4 | ao, base_color, height, normal_gl, roughness | Siding asset usable as a shingle surface; junctions and eaves must be built. |
| [WoodSiding013](roof/ambientcg-WoodSiding013/material.json) ([source](https://ambientcg.com/a/WoodSiding013)) | Wood shingles, variant | MAT-WOOD-SHINGLES | 1.4 × 1.4 | ao, base_color, height, normal_gl, roughness | Check overlap and module; the texture generates no silhouette. |
| [RoofingTiles015A](roof/ambientcg-RoofingTiles015A/material.json) ([source](https://ambientcg.com/a/RoofingTiles015A)) | Regular grey clay tiles | MAT-TILE-CLAY | 2.9 × 2.9 | ao, base_color, height, normal_gl, opacity, roughness | Restrained supplement for grey roofs; not historical validation of their profile. |
| [clay_plaster](wall/polyhaven-clay_plaster/material.json) ([source](https://polyhaven.com/a/clay_plaster)) | Rough earthen plaster | MAT-MUD-PLASTER, MAT-COB, MAT-WATTLE-DAUB, MAT-ADOBE, MAT-RAMMED-EARTH | 2 × 2 | base_color, normal_gl, roughness, height, ao | Direct for plaster; cob, wattle and daub, adobe and rammed earth are surface approximations without their structure. |
| [Clay005](wall/ambientcg-Clay005/material.json) ([source](https://ambientcg.com/a/Clay005)) | Smoothed clay | MAT-MUD-PLASTER, MAT-COB, MAT-ADOBE, MAT-RAMMED-EARTH | 0.2 × 0.2 | base_color, height, normal_gl, roughness | Smooth earthen base; neither adobe joints nor rammed-earth strata. |
| [patterned_clay_plaster](wall/polyhaven-patterned_clay_plaster/material.json) ([source](https://polyhaven.com/a/patterned_clay_plaster)) | Earthen plaster with decorative traces | MAT-MUD-PLASTER | 2 × 2 | base_color, normal_gl, roughness, height, ao | Reserve for facades whose tradition justifies the pattern. |
| [white_plaster_02](wall/polyhaven-white_plaster_02/material.json) ([source](https://polyhaven.com/a/white_plaster_02)) | Smooth white plaster | MAT-PLASTER-LIME, MAT-CHALK | 1 × 1 | base_color, normal_gl, roughness, height, ao | Surface lime/stucco; CHALK is a color approximation, not identified chalk. |
| [white_plaster_rough_01](wall/polyhaven-white_plaster_rough_01/material.json) ([source](https://polyhaven.com/a/white_plaster_rough_01)) | Rough weathered white plaster | MAT-PLASTER-LIME | 1 × 1 | base_color, normal_gl, roughness, height, ao | Aged variant for plastered walls and terraces. |
| [red_plaster_weathered](wall/polyhaven-red_plaster_weathered/material.json) ([source](https://polyhaven.com/a/red_plaster_weathered)) | Weathered red plaster | MAT-PLASTER-LIME | 2 × 2 | base_color, normal_gl, roughness, height, ao | Photographic pigmentation and wear retained. |
| [blue_plaster_wall](wall/polyhaven-blue_plaster_wall/material.json) ([source](https://polyhaven.com/a/blue_plaster_wall)) | Rough blue plaster | MAT-PLASTER-LIME | 2 × 2 | base_color, normal_gl, roughness, height, ao | Color is present in the asset; choose cultural use during integration. |
| [Plaster001](wall/ambientcg-Plaster001/material.json) ([source](https://ambientcg.com/a/Plaster001)) | Uniform white render | MAT-PLASTER-LIME | unknown | base_color, height, normal_gl, roughness | Neutral base for tint variants. |
| [brick_wall_001](wall/polyhaven-brick_wall_001/material.json) ([source](https://polyhaven.com/a/brick_wall_001)) | Bonded red fired brick | MAT-BURNT-BRICK | 3 × 3 | base_color, normal_gl, roughness, height, ao | Preserve the real brick and joint module. |
| [dark_brick_wall](wall/polyhaven-dark_brick_wall/material.json) ([source](https://polyhaven.com/a/dark_brick_wall)) | Weathered dark brick | MAT-BURNT-BRICK | 1.05 × 1.05 | base_color, normal_gl, roughness, height, ao | Dark variant for brick facades. |
| [sandstone_blocks_04](wall/polyhaven-sandstone_blocks_04/material.json) ([source](https://polyhaven.com/a/sandstone_blocks_04)) | Cut sandstone blocks | MAT-STONE-ASHLAR | 3 × 3 | base_color, normal_gl, roughness, height, ao | Ashlar; this sandstone must not be called limestone. |
| [white_sandstone_bricks](wall/polyhaven-white_sandstone_bricks/material.json) ([source](https://polyhaven.com/a/white_sandstone_bricks)) | Light sandstone blocks | MAT-STONE-ASHLAR, MAT-CHALK, MAT-LIMESTONE | 2 × 2 | base_color, normal_gl, roughness, height, ao | Actual sandstone; approximation for limestone/chalk without equivalent geological identification. |
| [red_sandstone_wall](wall/polyhaven-red_sandstone_wall/material.json) ([source](https://polyhaven.com/a/red_sandstone_wall)) | Red sandstone wall | MAT-STONE-MORTAR | 2 × 2 | base_color, normal_gl, roughness, height, ao | Red masonry; check module for India and arid regions. |
| [stone_wall](wall/polyhaven-stone_wall/material.json) ([source](https://polyhaven.com/a/stone_wall)) | Irregular rubble-stone wall | MAT-STONE-MORTAR | 2 × 2 | base_color, normal_gl, roughness, height, ao | Visible stones and joints; the assembly is not universal. |
| [stacked_stone_wall](wall/polyhaven-stacked_stone_wall/material.json) ([source](https://polyhaven.com/a/stacked_stone_wall)) | Stone stacked in courses | MAT-STONE-DRY | 2 × 2 | base_color, normal_gl, roughness, height, ao | Check for photographed mortar before using as strictly dry stone. |
| [japanese_stone_wall](wall/polyhaven-japanese_stone_wall/material.json) ([source](https://polyhaven.com/a/japanese_stone_wall)) | Japanese bonded stone-block wall | MAT-STONE-DRY, MAT-MEGALITH | 1.9 × 1.9 | base_color, normal_gl, roughness, height, ao | Blocks for foundations; MEGALITH approximates material without monumental scale. |
| [coral_stone_wall](wall/polyhaven-coral_stone_wall/material.json) ([source](https://polyhaven.com/a/coral_stone_wall)) | Coral-stone masonry | MAT-CORAL, MAT-SHELLSTONE | 2 × 2 | base_color, normal_gl, roughness, height, ao | Direct for coral; shellstone only approximated. |
| [volcanic_rock_tiles](wall/polyhaven-volcanic_rock_tiles/material.json) ([source](https://polyhaven.com/a/volcanic_rock_tiles)) | Dark volcanic-stone facing | MAT-BASALT, MAT-CLINKER | 1.8 × 1.8 | base_color, normal_gl, roughness, height, ao | Volcanic rock is stated; basaltic composition and clinker are not certified. |
| [mossy_stone_wall](wall/polyhaven-mossy_stone_wall/material.json) ([source](https://polyhaven.com/a/mossy_stone_wall)) | Mossy stone wall | MAT-STONE-MORTAR | 2 × 2 | base_color, normal_gl, roughness, height, ao | Wet variant for ruins and woodland settlement. |
| [rough_wood](wood/polyhaven-rough_wood/material.json) ([source](https://polyhaven.com/a/rough_wood)) | Rough wood with visible grain | MAT-TIMBER-POST, MAT-HALF-TIMBER, MAT-RAISED-POST, MAT-WOOD-MORTISE | 0.5 × 0.5 | base_color, normal_gl, roughness, height, ao | Wood texture only; posts, half-timbering and joints remain geometric. |
| [medieval_wood](wood/polyhaven-medieval_wood/material.json) ([source](https://polyhaven.com/a/medieval_wood)) | Marked aged wood | MAT-TIMBER-POST, MAT-HALF-TIMBER, MAT-WOOD-MORTISE | 2 × 2 | base_color, normal_gl, roughness, height, ao | Aged variant; surface marks retained. |
| [raw_plank_wall](wood/polyhaven-raw_plank_wall/material.json) ([source](https://polyhaven.com/a/raw_plank_wall)) | Raw plank wall | MAT-TIMBER-POST | 1.87 × 1.87 | base_color, normal_gl, roughness, height, ao | Cladding, partitions and large plank houses. |
| [weathered_plank_siding](wood/polyhaven-weathered_plank_siding/material.json) ([source](https://polyhaven.com/a/weathered_plank_siding)) | Weathered plank siding | MAT-TIMBER-POST, MAT-DRIFTWOOD | 1.57 × 1.57 | base_color, normal_gl, roughness, height, ao | DRIFTWOOD approximates weathered wood, not identified driftwood. |
| [dark_planks](wood/polyhaven-dark_planks/material.json) ([source](https://polyhaven.com/a/dark_planks)) | Dark planks | MAT-TIMBER-POST, MAT-HALF-TIMBER | 2 × 2 | base_color, normal_gl, roughness, height, ao | Tint variant already present in the maps. |
| [japanese_cedar_planks](wood/polyhaven-japanese_cedar_planks/material.json) ([source](https://polyhaven.com/a/japanese_cedar_planks)) | Japanese cedar planks | MAT-TIMBER-POST, MAT-WOOD-MORTISE | 1.13 × 1.13 | base_color, normal_gl, roughness, height, ao | Local surface; does not establish framing joints. |
| [hinoki_planks](wood/polyhaven-hinoki_planks/material.json) ([source](https://polyhaven.com/a/hinoki_planks)) | Hinoki planks | MAT-TIMBER-POST, MAT-WOOD-MORTISE | 1.89 × 1.89 | base_color, normal_gl, roughness, height, ao | Light fine-grained wood variant. |
| [wood_trunk_wall](wood/polyhaven-wood_trunk_wall/material.json) ([source](https://polyhaven.com/a/wood_trunk_wall)) | Trunk and log wall | MAT-LOG | 1.25 × 1.25 | base_color, normal_gl, roughness, height, ao | The asset’s log joints and sections do not replace geometric logs. |
| [bamboo_wall](wood/polyhaven-bamboo_wall/material.json) ([source](https://polyhaven.com/a/bamboo_wall)) | Round bamboo wall | MAT-BAMBOO | 2 × 2 | base_color, normal_gl, roughness, height, ao | Orient culms according to construction elements. |
| [Bamboo001B](wood/ambientcg-Bamboo001B/material.json) ([source](https://ambientcg.com/a/Bamboo001B)) | Dry beige bamboo | MAT-BAMBOO | 1.3 × 1.3 | ao, base_color, height, normal_gl, opacity, roughness | Light variant for walls and framing. |
| [bark_brown_01](wood/polyhaven-bark_brown_01/material.json) ([source](https://polyhaven.com/a/bark_brown_01)) | Rough brown bark | MAT-BARK | 0.999999 × 0.999999 | base_color, normal_gl, roughness, height, ao | Bark surface, not a complete wall of bark panels. |
| [Wicker013](wood/ambientcg-Wicker013/material.json) ([source](https://ambientcg.com/a/Wicker013)) | Woven bamboo | MAT-BAMBOO, MAT-WATTLE-DAUB | 0.5 × 0.5 | ao, base_color, height, normal_gl, roughness | Actual weave; approximates wattle and should be combined with earthen plaster. |
| [Fabric034](special/ambientcg-Fabric034/material.json) ([source](https://ambientcg.com/a/Fabric034)) | Light felt | MAT-FELT | unknown | base_color, height, normal_gl, roughness | Yurts and felt coverings; thickness and seams must be added. |
| [rough_linen](special/polyhaven-rough_linen/material.json) ([source](https://polyhaven.com/a/rough_linen)) | Coarse woven blue cloth | MAT-WOVEN-TEXTILE | 0.270708 × 0.2713 | base_color, normal_gl, roughness, height, ao | Original is blue; provide another variant if unbleached cloth is needed. Orient the weave. |
| [Leather039](special/ambientcg-Leather039/material.json) ([source](https://ambientcg.com/a/Leather039)) | Light suede-like hide | MAT-HIDE | unknown | base_color, height, normal_gl, roughness | Approximation of architectural hide; modern source without tent seams. |
| [brown_leather](special/polyhaven-brown_leather/material.json) ([source](https://polyhaven.com/a/brown_leather)) | Wrinkled brown leather | MAT-HIDE | 0.4 × 0.4 | base_color, normal_gl, roughness, height, ao | Modern leather variant; approximation for historic stretched hides. |
| [snow_02](special/polyhaven-snow_02/material.json) ([source](https://polyhaven.com/a/snow_02)) | Soft light snow | MAT-ICE-SNOW | 2 × 2 | base_color, normal_gl, roughness, height, ao | Approximation of compacted snow; igloo blocks and density remain to be defined. |
| [grass_ground](special/polyhaven-grass_ground/material.json) ([source](https://polyhaven.com/a/grass_ground)) | Grass-covered earth | MAT-TURF | 2.51 × 2.51 | base_color, normal_gl, roughness, height, ao | Vegetation-cover appearance; neither turf blocks nor cut sod sections. |
| [brown_mud_dry](special/polyhaven-brown_mud_dry/material.json) ([source](https://polyhaven.com/a/brown_mud_dry)) | Dry brown earth | MAT-MUD-PLASTER, MAT-COB, MAT-TURF | 1.3 × 1.3 | base_color, normal_gl, roughness, height, ao | Surface for earthen terraces; TURF only approximates the earthen section. |
| [rock_face](special/polyhaven-rock_face/material.json) ([source](https://polyhaven.com/a/rock_face)) | Natural rock outcrop | MAT-ROCKCUT, MAT-MEGALITH | 2.38 × 2.38 | base_color, normal_gl, roughness, height, ao | For excavations and monoliths, rock supplies material; volumes come from geometry. |
| [Rope001](special/ambientcg-Rope001/material.json) ([source](https://ambientcg.com/a/Rope001)) | Beige rope | MAT-CORDAGE | unknown | base_color, height, metalness, normal_gl, roughness | Rope surface; tie geometry and diameter must be supplied. |
| [cobblestone_floor_04](ground_built/polyhaven-cobblestone_floor_04/material.json) ([source](https://polyhaven.com/a/cobblestone_floor_04)) | Rounded cobble and stone paving |  | 1.5 × 1.5 | base_color, normal_gl, roughness, height, ao | Main road use; not mapped to a native building material. |
| [stone_tiles](ground_built/polyhaven-stone_tiles/material.json) ([source](https://polyhaven.com/a/stone_tiles)) | Flat stone slabs |  | 3.17 × 3.17 | base_color, normal_gl, roughness, height, ao | Squares and stone bridges; road use. |
| [gravel_ground_01](ground_built/polyhaven-gravel_ground_01/material.json) ([source](https://polyhaven.com/a/gravel_ground_01)) | Compacted gravel |  | 3 × 3 | base_color, normal_gl, roughness, height, ao | Lanes and paths; road use. |
| [dirt_floor](ground_built/polyhaven-dirt_floor/material.json) ([source](https://polyhaven.com/a/dirt_floor)) | Packed earth |  | 2.07 × 2.07 | base_color, normal_gl, roughness, height, ao | Dirt paths and fords; road use. |
| [old_planks_02](ground_built/polyhaven-old_planks_02/material.json) ([source](https://polyhaven.com/a/old_planks_02)) | Aged deck planks |  | 2 × 2 | base_color, normal_gl, roughness, height, ao | Wooden bridge decks; road use. |

## Coverage of the 39 native materials

`direct`: same material family; `proxy`: explicitly qualified approximation; `missing`: no retained file. Even `direct` certifies neither historical provenance nor construction geometry.

| Material | Status | Candidate sets | Limitation |
|---|---|---|---|
| `MAT-WATTLE-DAUB` | proxy | polyhaven-clay_plaster, ambientcg-Wicker013 | Earthen plaster plus bamboo weave; exact wattle and daub not acquired. |
| `MAT-COB` | proxy | polyhaven-clay_plaster, ambientcg-Clay005, polyhaven-brown_mud_dry | Clay and plaster approximate the surface; fibers and cob construction are not represented. |
| `MAT-ADOBE` | proxy | polyhaven-clay_plaster, ambientcg-Clay005 | Clay/plaster only; no unfired-brick texture identified in this selection. |
| `MAT-RAMMED-EARTH` | proxy | polyhaven-clay_plaster, ambientcg-Clay005 | Clay/plaster only; no stratified rammed-earth texture found in this selection. |
| `MAT-MUD-PLASTER` | direct | polyhaven-clay_plaster, ambientcg-Clay005, polyhaven-patterned_clay_plaster, polyhaven-brown_mud_dry | Surface of the same family; construction geometry must still be supplied. |
| `MAT-TIMBER-POST` | direct | polyhaven-rough_wood, polyhaven-medieval_wood, polyhaven-raw_plank_wall, polyhaven-weathered_plank_siding, polyhaven-dark_planks, polyhaven-japanese_cedar_planks, polyhaven-hinoki_planks | Surface of the same family; construction geometry must still be supplied. |
| `MAT-LOG` | direct | polyhaven-wood_trunk_wall | Surface of the same family; construction geometry must still be supplied. |
| `MAT-STONE-DRY` | direct | polyhaven-stacked_stone_wall, polyhaven-japanese_stone_wall | Surface of the same family; construction geometry must still be supplied. |
| `MAT-STONE-MORTAR` | direct | polyhaven-red_sandstone_wall, polyhaven-stone_wall, polyhaven-mossy_stone_wall | Surface of the same family; construction geometry must still be supplied. |
| `MAT-STONE-ASHLAR` | direct | polyhaven-sandstone_blocks_04, polyhaven-white_sandstone_bricks | Surface of the same family; construction geometry must still be supplied. |
| `MAT-THATCH` | direct | polyhaven-reed_roof_03, polyhaven-reed_roof_04, polyhaven-thatch_roof_angled | Surface of the same family; construction geometry must still be supplied. |
| `MAT-REED` | direct | polyhaven-reed_roof_03, polyhaven-reed_roof_04 | Surface of the same family; construction geometry must still be supplied. |
| `MAT-TILE-CLAY` | direct | polyhaven-clay_roof_tiles, polyhaven-clay_roof_tiles_02, polyhaven-ceramic_roof_01, polyhaven-grey_roof_tiles, ambientcg-RoofingTiles015A | Surface of the same family; construction geometry must still be supplied. |
| `MAT-WOOD-SHINGLES` | direct | ambientcg-WoodSiding010, ambientcg-WoodSiding013 | Surface of the same family; construction geometry must still be supplied. |
| `MAT-SLATE` | direct | polyhaven-roof_slates_02, polyhaven-roof_slates_03 | Surface of the same family; construction geometry must still be supplied. |
| `MAT-HALF-TIMBER` | direct | polyhaven-rough_wood, polyhaven-medieval_wood, polyhaven-dark_planks | Surface of the same family; construction geometry must still be supplied. |
| `MAT-BURNT-BRICK` | direct | polyhaven-brick_wall_001, polyhaven-dark_brick_wall | Surface of the same family; construction geometry must still be supplied. |
| `MAT-BAMBOO` | direct | polyhaven-bamboo_wall, ambientcg-Bamboo001B, ambientcg-Wicker013 | Surface of the same family; construction geometry must still be supplied. |
| `MAT-PALM` | proxy | polyhaven-reed_roof_04 | Reeds as a visual substitute; no woven or overlapping palm-leaf texture. |
| `MAT-RAISED-POST` | direct | polyhaven-rough_wood | Surface of the same family; construction geometry must still be supplied. |
| `MAT-PLASTER-LIME` | direct | polyhaven-white_plaster_02, polyhaven-white_plaster_rough_01, polyhaven-red_plaster_weathered, polyhaven-blue_plaster_wall, ambientcg-Plaster001 | Surface of the same family; construction geometry must still be supplied. |
| `MAT-CORAL` | direct | polyhaven-coral_stone_wall | Surface of the same family; construction geometry must still be supplied. |
| `MAT-BASALT` | proxy | polyhaven-volcanic_rock_tiles | Dark volcanic stone; exact basalt composition not established by the supplier. |
| `MAT-BARK` | direct | polyhaven-bark_brown_01 | Surface of the same family; construction geometry must still be supplied. |
| `MAT-FELT` | direct | ambientcg-Fabric034 | Surface of the same family; construction geometry must still be supplied. |
| `MAT-HIDE` | proxy | ambientcg-Leather039, polyhaven-brown_leather | Modern leather/suede as approximate material; no documented tent hides. |
| `MAT-TURF` | proxy | polyhaven-grass_ground, polyhaven-brown_mud_dry | Grass/earth as a surface; cut turf and sod blocks absent. |
| `MAT-CHALK` | proxy | polyhaven-white_plaster_02, polyhaven-white_sandstone_bricks | Light plaster and sandstone as approximations; no identified chalk. |
| `MAT-SHELLSTONE` | proxy | polyhaven-coral_stone_wall | Approximate coral stone; no identified coquina/shellstone. |
| `MAT-CLINKER` | proxy | polyhaven-volcanic_rock_tiles | Dark volcanic stone; clinker porosity not faithfully covered. |
| `MAT-ICE-SNOW` | proxy | polyhaven-snow_02 | Surface snow; compacted construction snow and blocks absent. |
| `MAT-MEGALITH` | proxy | polyhaven-japanese_stone_wall, polyhaven-rock_face | Wall/outcrop stone as material; no monumental-scale monolith. |
| `MAT-WOOD-MORTISE` | direct | polyhaven-rough_wood, polyhaven-medieval_wood, polyhaven-japanese_cedar_planks, polyhaven-hinoki_planks | Surface of the same family; construction geometry must still be supplied. |
| `MAT-ROCKCUT` | direct | polyhaven-rock_face | Surface of the same family; construction geometry must still be supplied. |
| `MAT-DRIFTWOOD` | proxy | polyhaven-weathered_plank_siding | Weathered wood; drift origin and marine wear not established. |
| `MAT-WOVEN-TEXTILE` | direct | polyhaven-rough_linen | Surface of the same family; construction geometry must still be supplied. |
| `MAT-BONE` | missing | — | No architectural bone acquired from the two libraries; bone search results were hazard signs and were excluded. |
| `MAT-CORDAGE` | direct | ambientcg-Rope001 | Surface of the same family; construction geometry must still be supplied. |
| `MAT-LIMESTONE` | proxy | polyhaven-white_sandstone_bricks | Light sandstone only; no certain limestone texture retained. |

## Coverage of the 32 architectural packs

Inventory calculated from materials in every recipe, variant and component of `rust/crates/houses/data/recipes.json`, including structure and rope fields. Full detail is in `catalog.json`. Counts are material families, not visually validated styles.

| Pack | Recipes | Direct materials | Approximate materials | Missing materials |
|---|---:|---:|---|---|
| `MED-ANT` | 9 | 7 | MAT-ADOBE | — |
| `ATL-CEL` | 9 | 10 | MAT-COB, MAT-WATTLE-DAUB | — |
| `EUR-MED` | 13 | 12 | MAT-COB, MAT-WATTLE-DAUB | — |
| `EUR-NOR` | 9 | 8 | MAT-HIDE, MAT-TURF, MAT-WATTLE-DAUB | — |
| `EUR-EAST` | 6 | 12 | MAT-WATTLE-DAUB | — |
| `AF-NILE` | 6 | 3 | MAT-ADOBE | — |
| `AF-MAG` | 10 | 11 | MAT-ADOBE, MAT-COB, MAT-RAMMED-EARTH | — |
| `AS-MIDE` | 9 | 7 | MAT-ADOBE, MAT-COB | — |
| `AS-STEP` | 7 | 9 | MAT-ADOBE, MAT-COB, MAT-HIDE, MAT-RAMMED-EARTH | — |
| `AF-SAHEL` | 10 | 7 | MAT-ADOBE, MAT-COB, MAT-HIDE, MAT-RAMMED-EARTH, MAT-WATTLE-DAUB | — |
| `AF-WEST` | 10 | 5 | MAT-COB, MAT-WATTLE-DAUB | — |
| `AF-SOUTH` | 8 | 5 | MAT-ADOBE, MAT-COB, MAT-PALM, MAT-WATTLE-DAUB | — |
| `AF-EAST` | 8 | 8 | MAT-ADOBE, MAT-PALM, MAT-WATTLE-DAUB | — |
| `AS-IND` | 8 | 10 | MAT-ADOBE, MAT-COB, MAT-PALM, MAT-WATTLE-DAUB | — |
| `AS-HIM` | 7 | 12 | MAT-ADOBE, MAT-COB | — |
| `AS-CHI` | 11 | 13 | MAT-ADOBE, MAT-COB, MAT-PALM, MAT-RAMMED-EARTH, MAT-WATTLE-DAUB | — |
| `AS-KOR` | 5 | 8 | MAT-PALM, MAT-WATTLE-DAUB | — |
| `AS-JAP` | 8 | 11 | MAT-COB, MAT-PALM, MAT-WATTLE-DAUB | — |
| `AS-SEA` | 7 | 11 | MAT-COB, MAT-PALM | — |
| `AS-ISL` | 12 | 9 | MAT-COB, MAT-PALM | — |
| `OC-PAC` | 8 | 9 | MAT-BASALT, MAT-COB, MAT-PALM, MAT-WATTLE-DAUB | — |
| `OC-AUS` | 5 | 5 | MAT-BASALT, MAT-WATTLE-DAUB | — |
| `AM-ARC` | 10 | 8 | MAT-COB, MAT-DRIFTWOOD, MAT-HIDE, MAT-ICE-SNOW, MAT-TURF | — |
| `AM-WOODS` | 9 | 8 | MAT-COB, MAT-HIDE, MAT-TURF, MAT-WATTLE-DAUB | — |
| `AM-PUEB` | 9 | 5 | MAT-ADOBE, MAT-COB, MAT-DRIFTWOOD, MAT-TURF | — |
| `AM-MISS` | 5 | 6 | MAT-COB, MAT-WATTLE-DAUB | — |
| `AM-MESO` | 9 | 10 | MAT-ADOBE, MAT-COB, MAT-LIMESTONE, MAT-PALM, MAT-WATTLE-DAUB | — |
| `AM-AND` | 7 | 9 | MAT-ADOBE, MAT-COB | — |
| `AM-TROP` | 9 | 7 | MAT-ADOBE, MAT-COB, MAT-PALM, MAT-WATTLE-DAUB | — |
| `AS-SIB` | 8 | 10 | MAT-COB, MAT-DRIFTWOOD, MAT-HIDE, MAT-TURF | — |
| `AM-PNW` | 8 | 6 | — | — |
| `AM-SOUTH` | 7 | 8 | MAT-COB, MAT-HIDE, MAT-PALM, MAT-WATTLE-DAUB | — |
