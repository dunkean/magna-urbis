# Textures de bâtiments — collection hors ligne

57 jeux PBR, 283 cartes, 501.1 Mio de cartes. Résolution source 1K, fichiers originaux sans retouche.

Collecte seule : aucun branchement au moteur, aucune affectation automatique aux bâtiments.

[Guide et limites](../../../docs/BUILDING_TEXTURE_LIBRARY.md) · [Planche des couleurs](contact-sheet.jpg) · [Catalogue complet](catalog.json) · [Sélection et qualifications](selection.json)

Powered by [Poly Haven](https://polyhaven.com/) et [ambientCG](https://ambientcg.com/). Les cartes téléchargées sont sous [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), selon les licences [Poly Haven](https://polyhaven.com/license) et [ambientCG](https://docs.ambientcg.com/license/). Les aperçus sont dérivés des cartes couleur, pas des rendus du site.

## Types disponibles

Les identifiants `MAT-*` sont des pistes d’emploi documentaire. Leur qualification `direct`, `proxy` ou `missing` figure dans la table suivante. Les profils culturels et l’appareillage doivent être contrôlés lors de l’intégration.

| Texture / fournisseur | Type | Matériaux natifs candidats | Emprise (m) | Cartes | Note |
|---|---|---|---|---|---|
| [clay_roof_tiles](roof/polyhaven-clay_roof_tiles/material.json) ([source](https://polyhaven.com/a/clay_roof_tiles)) | Tuiles de terre cuite patinées, profil courbe | MAT-TILE-CLAY | 4 × 4 | base_color, normal_gl, roughness, height, ao | Lignes de tuiles à orienter vers l’égout ; ne décrit pas une tegula antique exacte. |
| [clay_roof_tiles_02](roof/polyhaven-clay_roof_tiles_02/material.json) ([source](https://polyhaven.com/a/clay_roof_tiles_02)) | Tuiles de terre cuite à recouvrement | MAT-TILE-CLAY | 2.5 × 2.5 | base_color, normal_gl, roughness, height, ao | Variante de profil et de vieillissement ; vérifier le module pour chaque tradition. |
| [ceramic_roof_01](roof/polyhaven-ceramic_roof_01/material.json) ([source](https://polyhaven.com/a/ceramic_roof_01)) | Couverture céramique vieillie | MAT-TILE-CLAY | 3.5 × 3.5 | base_color, normal_gl, roughness, height, ao | Variante rustique moussue. |
| [grey_roof_tiles](roof/polyhaven-grey_roof_tiles/material.json) ([source](https://polyhaven.com/a/grey_roof_tiles)) | Tuiles céramiques grises | MAT-TILE-CLAY | 3 × 3 | base_color, normal_gl, roughness, height, ao | Base sombre pour Asie orientale ; ne remplace pas les profils chinois, coréens ou japonais. |
| [roof_slates_02](roof/polyhaven-roof_slates_02/material.json) ([source](https://polyhaven.com/a/roof_slates_02)) | Ardoises irrégulières patinées | MAT-SLATE | 3 × 3 | base_color, normal_gl, roughness, height, ao | Rangs orientés selon la pente. |
| [roof_slates_03](roof/polyhaven-roof_slates_03/material.json) ([source](https://polyhaven.com/a/roof_slates_03)) | Ardoises régulières | MAT-SLATE | 3 × 3 | base_color, normal_gl, roughness, height, ao | Ardoise et non lauze calcaire épaisse. |
| [reed_roof_03](roof/polyhaven-reed_roof_03/material.json) ([source](https://polyhaven.com/a/reed_roof_03)) | Chaume de roseaux | MAT-THATCH, MAT-REED | 2.5 × 2.5 | base_color, normal_gl, roughness, height, ao | Roseaux et traverses visibles dans la carte ; vérifier leur répétition et ne pas doubler ces traverses avec une structure géométrique. |
| [reed_roof_04](roof/polyhaven-reed_roof_04/material.json) ([source](https://polyhaven.com/a/reed_roof_04)) | Chaume de roseaux, variante | MAT-THATCH, MAT-REED, MAT-PALM | 2.5 × 2.5 | base_color, normal_gl, roughness, height, ao | Pour PALM : approximation fibreuse, aucune palme identifiable. |
| [thatch_roof_angled](roof/polyhaven-thatch_roof_angled/material.json) ([source](https://polyhaven.com/a/thatch_roof_angled)) | Chaume de paille incliné | MAT-THATCH | 0.54 × 0.54 | base_color, normal_gl, roughness, height, ao | Orientation native à inspecter avant création des UV. |
| [WoodSiding010](roof/ambientcg-WoodSiding010/material.json) ([source](https://ambientcg.com/a/WoodSiding010)) | Bardeaux de bois patinés | MAT-WOOD-SHINGLES | 1.4 × 1.4 | ao, base_color, height, normal_gl, roughness | Asset de bardage utilisable comme surface de bardeaux ; raccords et égouts à construire. |
| [WoodSiding013](roof/ambientcg-WoodSiding013/material.json) ([source](https://ambientcg.com/a/WoodSiding013)) | Bardeaux de bois, variante | MAT-WOOD-SHINGLES | 1.4 × 1.4 | ao, base_color, height, normal_gl, roughness | Vérifier recouvrement et module ; pas de silhouette générée par la texture. |
| [RoofingTiles015A](roof/ambientcg-RoofingTiles015A/material.json) ([source](https://ambientcg.com/a/RoofingTiles015A)) | Tuiles d’argile grises régulières | MAT-TILE-CLAY | 2.9 × 2.9 | ao, base_color, height, normal_gl, opacity, roughness | Complément sobre pour couvertures grises ; pas une validation historique de leur profil. |
| [clay_plaster](wall/polyhaven-clay_plaster/material.json) ([source](https://polyhaven.com/a/clay_plaster)) | Enduit de terre rugueux | MAT-MUD-PLASTER, MAT-COB, MAT-WATTLE-DAUB, MAT-ADOBE, MAT-RAMMED-EARTH | 2 × 2 | base_color, normal_gl, roughness, height, ao | Direct pour enduit ; bauge, torchis, adobe et pisé sont des approximations de surface sans leur structure. |
| [Clay005](wall/ambientcg-Clay005/material.json) ([source](https://ambientcg.com/a/Clay005)) | Argile lissée | MAT-MUD-PLASTER, MAT-COB, MAT-ADOBE, MAT-RAMMED-EARTH | 0.2 × 0.2 | base_color, height, normal_gl, roughness | Base lisse de terre ; ni joints d’adobe ni strates de pisé. |
| [patterned_clay_plaster](wall/polyhaven-patterned_clay_plaster/material.json) ([source](https://polyhaven.com/a/patterned_clay_plaster)) | Enduit de terre à traces décoratives | MAT-MUD-PLASTER | 2 × 2 | base_color, normal_gl, roughness, height, ao | Réserver aux façades dont la tradition justifie ce motif. |
| [white_plaster_02](wall/polyhaven-white_plaster_02/material.json) ([source](https://polyhaven.com/a/white_plaster_02)) | Enduit blanc lisse | MAT-PLASTER-LIME, MAT-CHALK | 1 × 1 | base_color, normal_gl, roughness, height, ao | Chaux/stuc de surface ; CHALK est une approximation chromatique, pas une craie identifiée. |
| [white_plaster_rough_01](wall/polyhaven-white_plaster_rough_01/material.json) ([source](https://polyhaven.com/a/white_plaster_rough_01)) | Enduit blanc rugueux et patiné | MAT-PLASTER-LIME | 1 × 1 | base_color, normal_gl, roughness, height, ao | Variante de vieillissement pour murs et terrasses enduites. |
| [red_plaster_weathered](wall/polyhaven-red_plaster_weathered/material.json) ([source](https://polyhaven.com/a/red_plaster_weathered)) | Enduit rouge patiné | MAT-PLASTER-LIME | 2 × 2 | base_color, normal_gl, roughness, height, ao | Pigmentation et usure photographiques conservées. |
| [blue_plaster_wall](wall/polyhaven-blue_plaster_wall/material.json) ([source](https://polyhaven.com/a/blue_plaster_wall)) | Enduit bleu rugueux | MAT-PLASTER-LIME | 2 × 2 | base_color, normal_gl, roughness, height, ao | Couleur présente dans l’asset ; usage culturel à choisir lors de l’intégration. |
| [Plaster001](wall/ambientcg-Plaster001/material.json) ([source](https://ambientcg.com/a/Plaster001)) | Crépi blanc uniforme | MAT-PLASTER-LIME | inconnue | base_color, height, normal_gl, roughness | Base neutre pour variantes de teinte. |
| [brick_wall_001](wall/polyhaven-brick_wall_001/material.json) ([source](https://polyhaven.com/a/brick_wall_001)) | Briques cuites rouges appareillées | MAT-BURNT-BRICK | 3 × 3 | base_color, normal_gl, roughness, height, ao | Conserver le module réel des briques et des joints. |
| [dark_brick_wall](wall/polyhaven-dark_brick_wall/material.json) ([source](https://polyhaven.com/a/dark_brick_wall)) | Briques foncées patinées | MAT-BURNT-BRICK | 1.05 × 1.05 | base_color, normal_gl, roughness, height, ao | Variante sombre pour façades en brique. |
| [sandstone_blocks_04](wall/polyhaven-sandstone_blocks_04/material.json) ([source](https://polyhaven.com/a/sandstone_blocks_04)) | Blocs de grès taillés | MAT-STONE-ASHLAR | 3 × 3 | base_color, normal_gl, roughness, height, ao | Pierre de taille ; ce grès ne doit pas être nommé calcaire. |
| [white_sandstone_bricks](wall/polyhaven-white_sandstone_bricks/material.json) ([source](https://polyhaven.com/a/white_sandstone_bricks)) | Blocs de grès clair | MAT-STONE-ASHLAR, MAT-CHALK, MAT-LIMESTONE | 2 × 2 | base_color, normal_gl, roughness, height, ao | Grès réel ; approximation pour calcaire/craie sans identification géologique équivalente. |
| [red_sandstone_wall](wall/polyhaven-red_sandstone_wall/material.json) ([source](https://polyhaven.com/a/red_sandstone_wall)) | Mur de grès rouge | MAT-STONE-MORTAR | 2 × 2 | base_color, normal_gl, roughness, height, ao | Maçonnerie rouge ; module à contrôler pour Inde et régions arides. |
| [stone_wall](wall/polyhaven-stone_wall/material.json) ([source](https://polyhaven.com/a/stone_wall)) | Mur de moellons irréguliers | MAT-STONE-MORTAR | 2 × 2 | base_color, normal_gl, roughness, height, ao | Pierres et joints visibles ; assemblage non universel. |
| [stacked_stone_wall](wall/polyhaven-stacked_stone_wall/material.json) ([source](https://polyhaven.com/a/stacked_stone_wall)) | Pierres empilées en assises | MAT-STONE-DRY | 2 × 2 | base_color, normal_gl, roughness, height, ao | Vérifier la présence de mortier photographié avant de l’utiliser en pierre sèche stricte. |
| [japanese_stone_wall](wall/polyhaven-japanese_stone_wall/material.json) ([source](https://polyhaven.com/a/japanese_stone_wall)) | Mur japonais en blocs de pierre appareillés | MAT-STONE-DRY, MAT-MEGALITH | 1.9 × 1.9 | base_color, normal_gl, roughness, height, ao | Blocs pour soubassements ; MEGALITH est une approximation de matière, sans échelle monumentale. |
| [coral_stone_wall](wall/polyhaven-coral_stone_wall/material.json) ([source](https://polyhaven.com/a/coral_stone_wall)) | Maçonnerie de pierre corallienne | MAT-CORAL, MAT-SHELLSTONE | 2 × 2 | base_color, normal_gl, roughness, height, ao | Direct pour corail ; pierre coquillière seulement approchée. |
| [volcanic_rock_tiles](wall/polyhaven-volcanic_rock_tiles/material.json) ([source](https://polyhaven.com/a/volcanic_rock_tiles)) | Parement de pierre volcanique sombre | MAT-BASALT, MAT-CLINKER | 1.8 × 1.8 | base_color, normal_gl, roughness, height, ao | Roche volcanique annoncée ; composition basaltique et scories non certifiées. |
| [mossy_stone_wall](wall/polyhaven-mossy_stone_wall/material.json) ([source](https://polyhaven.com/a/mossy_stone_wall)) | Mur de pierre moussu | MAT-STONE-MORTAR | 2 × 2 | base_color, normal_gl, roughness, height, ao | Variante humide pour ruines et habitat forestier. |
| [rough_wood](wood/polyhaven-rough_wood/material.json) ([source](https://polyhaven.com/a/rough_wood)) | Bois brut à fil visible | MAT-TIMBER-POST, MAT-HALF-TIMBER, MAT-RAISED-POST, MAT-WOOD-MORTISE | 0.5 × 0.5 | base_color, normal_gl, roughness, height, ao | Texture du bois seul ; poteaux, colombages et assemblages restent géométriques. |
| [medieval_wood](wood/polyhaven-medieval_wood/material.json) ([source](https://polyhaven.com/a/medieval_wood)) | Bois ancien marqué | MAT-TIMBER-POST, MAT-HALF-TIMBER, MAT-WOOD-MORTISE | 2 × 2 | base_color, normal_gl, roughness, height, ao | Variante vieillie ; traces de surface conservées. |
| [raw_plank_wall](wood/polyhaven-raw_plank_wall/material.json) ([source](https://polyhaven.com/a/raw_plank_wall)) | Mur de planches brutes | MAT-TIMBER-POST | 1.87 × 1.87 | base_color, normal_gl, roughness, height, ao | Bardage, cloisons et grandes maisons de planches. |
| [weathered_plank_siding](wood/polyhaven-weathered_plank_siding/material.json) ([source](https://polyhaven.com/a/weathered_plank_siding)) | Bardage de planches patinées | MAT-TIMBER-POST, MAT-DRIFTWOOD | 1.57 × 1.57 | base_color, normal_gl, roughness, height, ao | DRIFTWOOD est une approximation de bois altéré, pas un bois flotté identifié. |
| [dark_planks](wood/polyhaven-dark_planks/material.json) ([source](https://polyhaven.com/a/dark_planks)) | Planches sombres | MAT-TIMBER-POST, MAT-HALF-TIMBER | 2 × 2 | base_color, normal_gl, roughness, height, ao | Variante de teinte déjà présente dans les cartes. |
| [japanese_cedar_planks](wood/polyhaven-japanese_cedar_planks/material.json) ([source](https://polyhaven.com/a/japanese_cedar_planks)) | Planches de cèdre japonais | MAT-TIMBER-POST, MAT-WOOD-MORTISE | 1.13 × 1.13 | base_color, normal_gl, roughness, height, ao | Surface locale ; n’atteste pas les assemblages de la charpente. |
| [hinoki_planks](wood/polyhaven-hinoki_planks/material.json) ([source](https://polyhaven.com/a/hinoki_planks)) | Planches de hinoki | MAT-TIMBER-POST, MAT-WOOD-MORTISE | 1.89 × 1.89 | base_color, normal_gl, roughness, height, ao | Variante claire de bois à fil fin. |
| [wood_trunk_wall](wood/polyhaven-wood_trunk_wall/material.json) ([source](https://polyhaven.com/a/wood_trunk_wall)) | Paroi de troncs et rondins | MAT-LOG | 1.25 × 1.25 | base_color, normal_gl, roughness, height, ao | Les joints et sections de rondins de l’asset ne remplacent pas les rondins géométriques. |
| [bamboo_wall](wood/polyhaven-bamboo_wall/material.json) ([source](https://polyhaven.com/a/bamboo_wall)) | Paroi de bambous ronds | MAT-BAMBOO | 2 × 2 | base_color, normal_gl, roughness, height, ao | Orienter les chaumes selon les éléments constructifs. |
| [Bamboo001B](wood/ambientcg-Bamboo001B/material.json) ([source](https://ambientcg.com/a/Bamboo001B)) | Bambou sec beige | MAT-BAMBOO | 1.3 × 1.3 | ao, base_color, height, normal_gl, opacity, roughness | Variante claire pour parois et ossatures. |
| [bark_brown_01](wood/polyhaven-bark_brown_01/material.json) ([source](https://polyhaven.com/a/bark_brown_01)) | Écorce brune rugueuse | MAT-BARK | 0.999999 × 0.999999 | base_color, normal_gl, roughness, height, ao | Surface d’écorce, pas une paroi complète de plaques d’écorce. |
| [Wicker013](wood/ambientcg-Wicker013/material.json) ([source](https://ambientcg.com/a/Wicker013)) | Bambou tressé | MAT-BAMBOO, MAT-WATTLE-DAUB | 0.5 × 0.5 | ao, base_color, height, normal_gl, roughness | Tressage réel ; approximation du clayonnage, à combiner à l’enduit de terre. |
| [Fabric034](special/ambientcg-Fabric034/material.json) ([source](https://ambientcg.com/a/Fabric034)) | Feutre clair | MAT-FELT | inconnue | base_color, height, normal_gl, roughness | Yourtes et enveloppes en feutre ; épaisseur et coutures à ajouter. |
| [rough_linen](special/polyhaven-rough_linen/material.json) ([source](https://polyhaven.com/a/rough_linen)) | Toile grossière tissée bleue | MAT-WOVEN-TEXTILE | 0.270708 × 0.2713 | base_color, normal_gl, roughness, height, ao | Teinte bleue présente dans l’original ; prévoir une autre variante si une toile écrue est nécessaire. Tissage à orienter. |
| [Leather039](special/ambientcg-Leather039/material.json) ([source](https://ambientcg.com/a/Leather039)) | Peau claire d’aspect suédé | MAT-HIDE | inconnue | base_color, height, normal_gl, roughness | Approximation de peau architecturale ; source moderne, sans coutures de tente. |
| [brown_leather](special/polyhaven-brown_leather/material.json) ([source](https://polyhaven.com/a/brown_leather)) | Cuir brun plissé | MAT-HIDE | 0.4 × 0.4 | base_color, normal_gl, roughness, height, ao | Variante moderne de cuir ; approximation pour peaux tendues historiques. |
| [snow_02](special/polyhaven-snow_02/material.json) ([source](https://polyhaven.com/a/snow_02)) | Neige claire douce | MAT-ICE-SNOW | 2 × 2 | base_color, normal_gl, roughness, height, ao | Approximation de neige compactée ; blocs d’igloo et densité restent à définir. |
| [grass_ground](special/polyhaven-grass_ground/material.json) ([source](https://polyhaven.com/a/grass_ground)) | Terre couverte d’herbe | MAT-TURF | 2.51 × 2.51 | base_color, normal_gl, roughness, height, ao | Aspect de couverture végétale ; ni blocs de tourbe ni tranche de motte. |
| [brown_mud_dry](special/polyhaven-brown_mud_dry/material.json) ([source](https://polyhaven.com/a/brown_mud_dry)) | Terre brune sèche | MAT-MUD-PLASTER, MAT-COB, MAT-TURF | 1.3 × 1.3 | base_color, normal_gl, roughness, height, ao | Surface pour terrasses en terre ; TURF seulement pour la tranche terreuse approchée. |
| [rock_face](special/polyhaven-rock_face/material.json) ([source](https://polyhaven.com/a/rock_face)) | Roche naturelle affleurante | MAT-ROCKCUT, MAT-MEGALITH | 2.38 × 2.38 | base_color, normal_gl, roughness, height, ao | Excavations et monolithes : la roche apporte la matière, les volumes viennent de la géométrie. |
| [Rope001](special/ambientcg-Rope001/material.json) ([source](https://ambientcg.com/a/Rope001)) | Cordage beige | MAT-CORDAGE | inconnue | base_color, height, metalness, normal_gl, roughness | Surface de cordage ; géométrie des liens et diamètre à fournir. |
| [cobblestone_floor_04](ground_built/polyhaven-cobblestone_floor_04/material.json) ([source](https://polyhaven.com/a/cobblestone_floor_04)) | Pavé de galets et pierres arrondies |  | 1.5 × 1.5 | base_color, normal_gl, roughness, height, ao | Voirie principale ; usage voirie, non rattaché à un matériau natif de bâtiment. |
| [stone_tiles](ground_built/polyhaven-stone_tiles/material.json) ([source](https://polyhaven.com/a/stone_tiles)) | Dalles de pierre plates |  | 3.17 × 3.17 | base_color, normal_gl, roughness, height, ao | Places et ponts de pierre ; usage voirie. |
| [gravel_ground_01](ground_built/polyhaven-gravel_ground_01/material.json) ([source](https://polyhaven.com/a/gravel_ground_01)) | Gravier compacté |  | 3 × 3 | base_color, normal_gl, roughness, height, ao | Ruelles et chemins ; usage voirie. |
| [dirt_floor](ground_built/polyhaven-dirt_floor/material.json) ([source](https://polyhaven.com/a/dirt_floor)) | Terre battue |  | 2.07 × 2.07 | base_color, normal_gl, roughness, height, ao | Chemins de terre et gués ; usage voirie. |
| [old_planks_02](ground_built/polyhaven-old_planks_02/material.json) ([source](https://polyhaven.com/a/old_planks_02)) | Planches anciennes de tablier |  | 2 × 2 | base_color, normal_gl, roughness, height, ao | Tabliers de ponts en bois ; usage voirie. |

## Couverture des 39 matériaux natifs

`direct` : matière de la même famille ; `proxy` : approximation explicitement qualifiée ; `missing` : aucun fichier retenu. Même `direct` ne certifie ni la provenance historique ni la géométrie constructive.

| Matériau | Statut | Jeux candidats | Limite |
|---|---|---|---|
| `MAT-WATTLE-DAUB` | proxy | polyhaven-clay_plaster, ambientcg-Wicker013 | Enduit de terre + tressage en bambou ; clayonnage/torchis exact non acquis. |
| `MAT-COB` | proxy | polyhaven-clay_plaster, ambientcg-Clay005, polyhaven-brown_mud_dry | Argile et enduit approchent la surface ; fibres et construction de bauge non représentées. |
| `MAT-ADOBE` | proxy | polyhaven-clay_plaster, ambientcg-Clay005 | Argile/enduit seulement ; aucune texture de briques crues identifiée dans cette sélection. |
| `MAT-RAMMED-EARTH` | proxy | polyhaven-clay_plaster, ambientcg-Clay005 | Argile/enduit seulement ; texture de pisé stratifié non trouvée dans cette sélection. |
| `MAT-MUD-PLASTER` | direct | polyhaven-clay_plaster, ambientcg-Clay005, polyhaven-patterned_clay_plaster, polyhaven-brown_mud_dry | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-TIMBER-POST` | direct | polyhaven-rough_wood, polyhaven-medieval_wood, polyhaven-raw_plank_wall, polyhaven-weathered_plank_siding, polyhaven-dark_planks, polyhaven-japanese_cedar_planks, polyhaven-hinoki_planks | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-LOG` | direct | polyhaven-wood_trunk_wall | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-STONE-DRY` | direct | polyhaven-stacked_stone_wall, polyhaven-japanese_stone_wall | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-STONE-MORTAR` | direct | polyhaven-red_sandstone_wall, polyhaven-stone_wall, polyhaven-mossy_stone_wall | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-STONE-ASHLAR` | direct | polyhaven-sandstone_blocks_04, polyhaven-white_sandstone_bricks | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-THATCH` | direct | polyhaven-reed_roof_03, polyhaven-reed_roof_04, polyhaven-thatch_roof_angled | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-REED` | direct | polyhaven-reed_roof_03, polyhaven-reed_roof_04 | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-TILE-CLAY` | direct | polyhaven-clay_roof_tiles, polyhaven-clay_roof_tiles_02, polyhaven-ceramic_roof_01, polyhaven-grey_roof_tiles, ambientcg-RoofingTiles015A | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-WOOD-SHINGLES` | direct | ambientcg-WoodSiding010, ambientcg-WoodSiding013 | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-SLATE` | direct | polyhaven-roof_slates_02, polyhaven-roof_slates_03 | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-HALF-TIMBER` | direct | polyhaven-rough_wood, polyhaven-medieval_wood, polyhaven-dark_planks | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-BURNT-BRICK` | direct | polyhaven-brick_wall_001, polyhaven-dark_brick_wall | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-BAMBOO` | direct | polyhaven-bamboo_wall, ambientcg-Bamboo001B, ambientcg-Wicker013 | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-PALM` | proxy | polyhaven-reed_roof_04 | Roseaux en remplacement visuel ; pas de texture de palmes tressées ou superposées. |
| `MAT-RAISED-POST` | direct | polyhaven-rough_wood | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-PLASTER-LIME` | direct | polyhaven-white_plaster_02, polyhaven-white_plaster_rough_01, polyhaven-red_plaster_weathered, polyhaven-blue_plaster_wall, ambientcg-Plaster001 | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-CORAL` | direct | polyhaven-coral_stone_wall | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-BASALT` | proxy | polyhaven-volcanic_rock_tiles | Pierre volcanique sombre ; nature basaltique exacte non attestée par le fournisseur. |
| `MAT-BARK` | direct | polyhaven-bark_brown_01 | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-FELT` | direct | ambientcg-Fabric034 | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-HIDE` | proxy | ambientcg-Leather039, polyhaven-brown_leather | Cuir/suède modernes comme matière approchée ; pas de peaux de tente documentées. |
| `MAT-TURF` | proxy | polyhaven-grass_ground, polyhaven-brown_mud_dry | Herbe/terre comme surface ; coupe de tourbe et blocs de mottes absents. |
| `MAT-CHALK` | proxy | polyhaven-white_plaster_02, polyhaven-white_sandstone_bricks | Enduit et grès clairs comme approximation ; aucune craie identifiée. |
| `MAT-SHELLSTONE` | proxy | polyhaven-coral_stone_wall | Pierre corallienne approchante ; aucune coquina/pierre coquillière identifiée. |
| `MAT-CLINKER` | proxy | polyhaven-volcanic_rock_tiles | Pierre volcanique sombre ; porosité de scories non couverte fidèlement. |
| `MAT-ICE-SNOW` | proxy | polyhaven-snow_02 | Neige de surface ; neige de construction compactée et blocs absents. |
| `MAT-MEGALITH` | proxy | polyhaven-japanese_stone_wall, polyhaven-rock_face | Pierre de mur/affleurement comme matière ; aucun monolithe à échelle monumentale. |
| `MAT-WOOD-MORTISE` | direct | polyhaven-rough_wood, polyhaven-medieval_wood, polyhaven-japanese_cedar_planks, polyhaven-hinoki_planks | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-ROCKCUT` | direct | polyhaven-rock_face | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-DRIFTWOOD` | proxy | polyhaven-weathered_plank_siding | Bois patiné ; origine flottée et usure marine non attestées. |
| `MAT-WOVEN-TEXTILE` | direct | polyhaven-rough_linen | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-BONE` | missing | — | Aucun os architectural acquis dans les deux banques ; les résultats bone sont des panneaux de danger et ont été écartés. |
| `MAT-CORDAGE` | direct | ambientcg-Rope001 | Surface de la même famille ; la géométrie constructive reste à fournir. |
| `MAT-LIMESTONE` | proxy | polyhaven-white_sandstone_bricks | Grès clair seulement ; aucune texture calcaire certaine retenue. |

## Couverture des 32 packs architecturaux

Inventaire calculé à partir des matériaux de toutes les recettes, variantes et composants de `rust/crates/houses/data/recipes.json`, y compris les champs de structure et de cordage. Le détail complet est dans `catalog.json`. Les nombres comptent des familles de matériaux, pas des styles validés visuellement.

| Pack | Recettes | Matières directes | Matières approchées | Matières absentes |
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
