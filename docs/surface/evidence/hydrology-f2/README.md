# Eau régionale : contours source et occlusion

Le vrai paquet `native-e2e-40km-v5/fresh-source.surfacebin` est lu sans mutation.
Le test ne génère aucun réseau et ne relève aucun niveau d'eau. Les contours
retenus Magna restent l'autorité de la carte ; le raster physique validé sert à
une autre représentation. Le champ ancien `resolvedBedConflicts` ne compte que
les cellules de ce raster, pas les sommets des contours.

## Diagnostic CPU

Le test `viewer-local/tests/surface_hydrology_visibility_test.gd` passe avec le
paquet réel et une fixture de contrôle explicitement synthétique : un polygone
mesuré sous un lit plat reste complet malgré un raster physique entièrement sec.
Les niveaux, classes et géométries source sont inchangés.

| Vue demandée | Groupes affichés | Triangles sans niveau | Sondes sous le lit / sondes | Δ maximum sondé |
| --- | ---: | ---: | ---: | ---: |
| 10 000 m | 702 | 0 | 2 670 / 4 087 | 46,0716 m |
| 2 560 m | 59 | 0 | 3 647 / 3 961 | 27,8235 m |

Ces sondes sont déterministes, bornées à 4 096 sommets et **non pondérées par
l'aire** : elles ne mesurent pas un pourcentage de pixels ni un débit. La fenêtre
de cache de la vue 10 km couvre ici toute la source 40 km. Elle représente
48 038 663,75 m² après conversion GPU contre 48 038 668,53 m² pour la triangulation
source en double. Elle utilise 719 184 sommets et 480 887 visites de balayage,
sous les plafonds respectifs 999 996 et 12 000 000. Aucun fallback ni niveau
manquant ne cause les ruptures observées. Un groupe source exactement dupliqué
est dédupliqué uniquement à l'affichage.

## Contrôle GPU Forward+ / RTX 4090

La sonde autonome `viewer-local/diagnostics/hydrology_source_map_probe.gd`
affiche les mêmes contours et niveaux réels dans une vue verticale de 10 km,
1024² pixels. Le terrain de contrôle est un maillage reconstruit sur CPU depuis
le paquet ; **ce n'est pas une preuve d'intégration Terrain3D**. La palette bleue
est diagnostique, pas un style final. Les résultats sont dans
[gpu-report.json](gpu-report.json).

| Représentation | Pixels d'eau |
| --- | ---: |
| Contours source seuls | 6 495 |
| Niveaux source soumis à la profondeur du terrain | 263 |
| Overlay sans test de profondeur | 6 495 |
| Projection Decal limitée au terrain (`cull_mask=1`) | 6 495 |

La projection conserve exactement l'empreinte GPU de référence (zéro pixel
discordant) et ne peint aucun pixel d'eau sur le toit de contrôle en couche 2.
L'overlay direct peint au contraire **52 pixels d'eau sur ce toit**. Il reste un
outil de diagnostic / de préparation de texture et ne constitue pas une
résolution finale acceptable pour la carte urbaine. Le mode source-map doit
projeter sur le terrain uniquement ; l'eau physique garde ses niveaux et ses
conflits explicites. Aucun déplacement des niveaux ou des contours source n'est
une solution à l'occlusion.

Les textures de couverture du fond doivent provenir de `groundMaterial*`, qui
exclut les recettes d'eau, afin de ne pas conserver des cellules bleues derrière
les contours source. Le raster de sécurité d'origine reste archivé tel quel.

À cette échelle, un pixel représente environ 9,77 m : certains tronçons fins
restent sous-pixel dans la référence elle-même. Ces résultats ne prouvent donc
pas une lisibilité continue de tous les cours d'eau. Une largeur cartographique
minimale éventuelle doit être déclarée comme largeur d'affichage, distincte de la
largeur physique. Les limites déjà documentées des contours source aplatis et
des anneaux invalides demeurent ; aucune réparation topologique, conservation
du débit ou équivalence à un relevé hydraulique n'est affirmée.
