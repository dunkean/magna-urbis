# Roche rapprochée : projection et détail à coût limité

Cette itération rend les affleurements plus lisibles à quelques mètres,
particulièrement sur les pentes. Elle réutilise les photographies PBR, les
profils géologiques et le maillage existants. Aucun nouvel asset ni contexte
préparé n'est nécessaire.

## Projection sur les pentes

Chaque patch photographique reçoit un repère tangent fixé à son ancre dans
le monde. La pente de référence vient de quatre lectures du DEM natif ; le
repère passe progressivement du plan XZ au plan tangent entre 25 et 55°.
La hauteur réelle du fragment participe aux coordonnées, ce qui évite
l'étirement vertical des photographies sur les versants. Les trois patches
stochastiques existants continuent à se mélanger avec leurs rotations fixes.

Les dérivées d'écran suivent cette projection pour sélectionner les mipmaps.
Les normales PBR sont reconstruites à partir de leurs gradients, puis
transportées dans le repère physique courant en tenant compte du Jacobien
du warp. Une carte de normales neutre conserve ainsi la normale du terrain.
Le repère ne dépend pas de la caméra ; les angles de structure restent fixés
à l'ancre du patch.

Le nombre de lectures PBR reste identique : trois patches par matériau,
couleur, normales/rugosité et hauteur. Une projection triplanaire complète
aurait multiplié ces lectures. Ici, seules quatre lectures RF supplémentaires
par patch minéral actif servent à construire le repère.

Le gain de projection et de détail est fixé par recette native : transition
entre 35 et 65 % de support rocheux/fragments. Les quatre réponses voisines
restent interpolées, sans interpoler les identifiants de matériaux. Le coût
des lectures DEM est évité pour les traces minérales faibles, l'eau et les
pixels de plus de 8 m d'empreinte, où les photographies sont déjà fondues.

## Détail modéré

- La bande géométrique de 3,75 m reçoit un profil légèrement plus anguleux sur
  roche massive/stratifiée : `1.4*n - 0.4*n³`, mélangé par les profils natifs.
  Aucun bruit supplémentaire ; gradients complets CPU/GPU et enveloppe
  totale de déplacement ±3 m conservés.
- Les creux orientés existants utilisent une porteuse de 8×2,5 m et une
  profondeur de matière bornée à 10 cm. Ces creux modulent les normales et
  cavités ; ils ne déplacent pas le maillage et ne créent pas d'occlusion
  géométrique réelle. Leurs quatre évaluations de bruit sont réutilisées.
- Les normales photographiques gagnent au plus 35 % de force, avec une
  compensation de contraste bornée au mélange des patches. La hauteur PBR
  déjà lue module très légèrement couleur et rugosité. Les filtres de zoom
  existants conservent un raccord progressif vers le Render lointain.

## Validation et mesures

Revue Astra High : aucun blocage identifié. `rock_chart_test` vérifie 56 cas
sur plans de 0 à 80°, deux azimuts et deux warps : UV métriques, dérivées,
normales neutres et inclinées, puis normales finales du vrai shader terrain.
Erreur maximale de normale finale : 0,00555 en lecture RGB8.

`rock_detail_view_test` capture une pente native éclairée de 56,58° aux largeurs
40 et 160 m, ainsi qu'un plan synthétique à 80°. Les images sont fixes à
l'arrêt et identiques après un aller-retour zoom/pan. Le pan local de 2,5 cm
donne un P99 de variation RGB de 0,01176. Ce pan vérifie une zone locale ; il
ne constitue pas un test construit de traversée d'une frontière de recette.

Le benchmark compare le commit `69527c79913afef13d60ab9174134831b07c5957`
au code courant, avec les mêmes palettes et caméras : ordre ABBA, 60 frames
de chauffe puis 120 mesures, RTX 4090, Vulkan Forward+, 1280×800, sans VSync.
Les valeurs sont les moyennes des médianes des deux passages de chaque version.

| Cas | Avant, GPU | Après, GPU | Écart |
| --- | ---: | ---: | ---: |
| Pente native 58,45°, largeur 40 m | 3,157 ms | 3,131 ms | −0,026 ms |
| Même pente, largeur 160 m | 3,712 ms | 3,882 ms | +0,170 ms / +4,6 % |
| Même pente, largeur 1,8 km | 4,332 ms | 4,367 ms | +0,035 ms |
| Forêt, largeur 1,8 km | 9,944 ms | 10,192 ms | +0,249 ms / +2,5 % |
| Prairie, largeur 1,8 km | 5,060 ms | 4,582 ms | −0,478 ms |
| Eau, largeur 1,8 km | 4,363 ms | 4,156 ms | −0,208 ms |
| Vue lointaine, largeur 65 km | 1,356 ms | 1,378 ms | +0,022 ms |

Les plans synthétiques rocheux coûtent 0,03 à 0,13 ms supplémentaires ; le
maximum relatif est +13,2 % sur le plan plat à 160 m. Les gains constatés sur
certains cas ne sont pas une garantie générale. Ces mesures concernent le
viewport GPU, pas le chargement ni la latence totale, et restent propres à
ce matériel et ces scènes. Aucun triangle ni texture persistante supplémentaire.

Reproduction après préparation des données locales habituelles :

```powershell
python godot-render/tools/prepare_meso_baseline.py
godot --path godot-render --script res://tests/rock_chart_test.gd
godot --path godot-render --script res://tests/rock_detail_view_test.gd
godot --path godot-render --script res://tests/rock_detail_benchmark.gd
```

Les tests utilisant `frame_post_draw` nécessitent un viewport rendu, sans
`--headless`. Rapports JSON, P95, hashes de palettes et captures restent dans
`godot-render/evidence/`, hors Git. Les régressions existantes couvrent les
gradients, vrais triangles/picking, transitions, neige, eau, ombres et couvert.
