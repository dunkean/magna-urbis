# Relief et matière intermédiaires

Cette itération comble l'intervalle entre la couleur régionale du Render et les
photographies PBR de quelques mètres. Le DEM, l'hydrologie et les champs de
placement des arbres restent conservés. Les nouveaux détails sont des résidus
d'apparence déterministes, conditionnés par le support, et non une simulation
d'érosion ou de croissance végétale.

## Relief et maillage

`prepare_mesoscale.py` produit un contexte natif RGBA32F de 1334² cellules :
amplitudes grossière/fine en mètres, fraction de fragments et couverture de
matrice visible. Roche, rugosité et fragments renforcent le relief ; sable,
neige et couvert forestier l'atténuent. Les amplitudes sont bornées à
2,4 m et 0,6 m. Le résidu total reste borné à ±3 m.

Quatre champs de Perlin à gradients unitaires, de cellules 64 / 27 / 9,5 /
3,75 m, sont combinés en deux groupes normalisés. Le hash entier 31 bits,
les graines de monde et les formules sont partagés entre GLSL et GDScript.
Le gain des gradients conserve l'enveloppe [-1,1]. Les coordonnées ne
dépendent pas de la caméra. Les gradients incluent les variations bilinéaires
des amplitudes et les dérivées du filtrage géométrique.

La bande de 27 m reçoit désormais des profils de roche massive, stratifiée,
fragments et support tendre, mélangés selon la géologie et l'altération. Une
enveloppe de présence de 150 m varie doucement l'amplitude. Leurs dérivées et
la limite ±3 m sont conservées. Voir [Profils, conifères et littoral](SUPPORT_SHORES_REFINEMENT.md).

Le maillage reste un unique plan de 1334² cellules, avec une redistribution
globale en sinus hyperbolique autour du point observé. La transformation et
son inverse sont continues, y compris lorsque le focus est excentré ; les
bords restent exactement 0 et 40 km. Le raffinement arrive plus tôt : au
point observé, le pas mesuré vers 1,8 km de largeur de vue passe d'environ
17,5 m à 2,1 m. À 160 m de largeur il descend vers 0,6 m.

Chaque bande quitte la géométrie lorsque le pas local ne la résout plus
(transition entre 6 et 3 sommets par cellule du champ). La matière reconstruit
alors les normales filtrées au pixel. Les pentes macro et résiduelles sont
transmises séparément depuis les sommets : la pente résiduelle interpolée est
retirée exactement avant d'ajouter la pente physique filtrée, ce qui évite un
double relief et une annulation approximative des normales normalisées.

## Eaux et lecture d'altitude

La protection hydrique combine les eaux natives et le maximum conservatif
de l'alpha vectoriel 4K. Une rivière subpixel ne disparaît donc pas lors de la
réduction. Le masque est dilaté d'une cellule native. Les amplitudes s'atténuent
sur des distances physiques autour de cette emprise protégée, puis sont mises
à zéro strict après toutes les opérations. Le validateur vérifie toutes les
positions humides natives et 4K, pas seulement quelques centres de cellules.

Le CPU interroge les triangles réellement déformés. Les coordonnées de leurs
nœuds sont arrondies en float32 comme les sommets : cela corrige les rayons
exactement sur une arête qui pouvaient sélectionner la cellule voisine avec
l'inverse float64. Les bornes verticales et de culling incluent le résidu.

En vue oblique rapprochée, une traversée de blocs de 8×8 cellules élimine les
zones certainement hors du rayon. Les bornes utilisent toute l'emprise des
contrôles B-spline nécessaires, élargie du majorant du résidu : elles bornent
donc tous les sommets, puis leurs triangles convexes. Les rectangles de source
RF sont mémorisés dans un cache borné à 8192 entrées. Les triangles candidats
restent testés exactement et comparés au parcours exhaustif dans le test GPU.

## Matière et transitions

Le calcul intermédiaire est mutualisé une fois par fragment :

- Les champs physiques modulent légèrement la couleur et fournissent les
  pentes filtrées manquantes.
- Des caps de touffes/fragments aux échelles 6 m et 1,75 m partagent hauteur,
  normales, rugosité et cavités. Les creux découvrent de la terre. Cette
  modulation ne consomme que la matrice : les budgets roche/fragments restent
  intacts. La vue Support minéral exclut les touffes du couvert.
- Sur la roche, des dépressions orientées de 10 cm maximum utilisent quatre
  patches fixes de 48 m et l'axe local de structure. Leur hauteur et leurs
  normales partagent les dérivées des patches et des poids. Leur filtre tient
  compte de la largeur des creux, plus petite que leur porteuse 8×2,5 m.
  Il s'agit de hauteur de matière et de normales, pas de déplacement du mesh.
- Un warp monde de ±28 cm utilise le même Jacobien pour les UV, les dérivées
  et les normales de toutes les cartes PBR. Il n'est pas interrompu à un zoom
  où les photographies restent encore résolues.

Le filtrage matière est lié à l'empreinte du pixel, avec un fondu vers la
réponse régionale entre 8 et 24 m/pixel. La transition Render existante
4–24 m/pixel reste conservée. Les petits détails sont appliqués avant les
canopées, la neige et la glace ; le grain est atténué sous la neige et l'eau
conserve sa propre réponse finale. La compensation de rugosité des détails
non résolus est une approximation bornée, pas un modèle LEAN complet.

## Préparation, validation et reproduction

Après les couches N1–N4 et `forest_placement.py` :

```powershell
python godot-render/tools/prepare_mesoscale.py
python godot-render/tools/validate_mesoscale.py
./Test-Render.ps1 -Check
```

`--tile mountains--temperate` limite la préparation ; `--workers 2` est le
défaut. Les 42 contextes flottants occupent 1 195 861 632 octets sur disque,
auxquels s'ajoutent les profils PNG. Seule la tuile active est conservée :
28 472 896 octets CPU de contexte, 7 118 224 octets de profils et la structure
RGB native, avec leurs textures GPU. Le chargement vérifie format, taille,
hash du générateur, DEM, géologie, structure, N1–N4, placement, rivière et données.
Un cache absent, malformé ou périmé est
vidé et désactivé ; il ne peut pas réutiliser le contexte de la tuile précédente.

Les tests GPU se lancent avec Godot et `--script res://tests/<nom>.gd` :

| Test | Vérification |
| --- | --- |
| `meso_geometry_test` | Champs CPU/GPU, gradients complets, eaux, cache invalide, focus excentré, hauteur des vrais triangles et picking accéléré/exhaustif |
| `meso_normal_test` | Normales finales sur terrain plat/contexte constant, à cinq transitions de maillage/pixel |
| `meso_material_test` | Prairie/sable/roche, stabilité temporelle, Jacobien, transfert des normales, dérivées et hauteur des fractures |
| `meso_transition_test` | Zoom/pan aller-retour orthographique et oblique, second terrain côtier, variation locale souspixel |

Les rapports et images sont dans `godot-render/evidence/`, hors Git. Les tests
existants continuent à vérifier neige, eau, couvert, 47 informations, palettes
PBR et navigation des 42 tuiles. La comparaison de répétition photographique
isole le PBR en désactivant explicitement la nouvelle matière procédurale.

## Mesures de cette itération

Les chiffres historiques ci-dessous comparent cette étape au commit
`338efaf428ccd1f3aa6724c5749bf4f2f7fbb8ab`. Le préparateur de baseline est
désormais fixé à `69527c7` pour l'itération suivante : voir
[Roche rapprochée](ROCK_CLOSE_DETAIL.md) pour les mesures et commandes actuelles.
Le protocole GPU est ABBA, 30 frames de chauffe puis 45 mesures par cas,
avec mêmes caméra, résolution, graines et hashes de palettes. Les temps
mesurés sont ceux du viewport GPU, pas une latence totale de l'application.
L'initialisation et les lectures de fichiers ne sont pas comprises.

```powershell
python godot-render/tools/prepare_meso_baseline.py
godot --path godot-render --audio-driver Dummy --script res://tests/meso_benchmark.gd
godot --path godot-render --audio-driver Dummy --script res://tests/meso_picking_benchmark.gd
```

Sur RTX 4090 à 1280×800, profils, conifères et eaux de cette itération comparés
au renderer intermédiaire `338efaf`. Les hashes des palettes sont identiques
entre les quatre passages ; les niveaux et pas de grille sont communs.
Chaque valeur est la moyenne des médianes des deux passages ABBA :

| Cas | GPU baseline, médiane | GPU intermédiaire, médiane |
| --- | ---: | ---: |
| Prairie, vue entière | 1,68 ms | 1,83 ms |
| Sable, vue entière | 3,75 ms | 1,64 ms |
| Roche, vue entière | 1,73 ms | 1,88 ms |
| Prairie, largeur 1,8 km | 4,41 ms | 5,07 ms |
| Sable, largeur 1,8 km | 4,37 ms | 4,83 ms |
| Roche, largeur 1,8 km | 8,18 ms | 9,40 ms |
| Forêt, largeur 1,8 km | 8,37 ms | 9,93 ms |
| Eau, largeur 1,8 km | 4,01 ms | 4,49 ms |
| Prairie, largeur 160 m | 3,70 ms | 4,28 ms |
| Sable, largeur 160 m | 3,41 ms | 3,89 ms |
| Roche, largeur 160 m | 3,58 ms | 4,07 ms |
| Eau, largeur 160 m | 3,14 ms | 3,31 ms |

Au zoom moyen, le surcoût de cette itération est de 0,46–1,56 ms dans ces
scènes, soit environ 11–19 %. Le nombre de triangles reste constant. La mesure
baseline sable en vue entière est très variable ; sa moyenne élevée ne doit
pas être interprétée comme un gain général de performance. Les détails par
passage, P95 et palettes sont dans `evidence/meso-benchmark.json`.

La lecture d'altitude est chronométrée séparément, cache des sommets vidé
avant chacun des cinq rayons. En perspective à 1,8 km : 1,98 ms de médiane
(2,80 ms max), contre 1,77 ms (2,59 ms max) dans la baseline. À 160 m, les
requêtes froides restent plus coûteuses : 7,77 ms de médiane et 14,52 ms max,
contre 5,91 / 12,26 ms. Les bornes hiérarchiques peuvent être réutilisées.
Ces chiffres concernent ce matériel et ces scènes ; ils ne prédisent pas le
coût à toute résolution ni les performances sur une autre machine.

La lecture GPU des triangles diffère du picking de moins de 2 mm sur les
24 contrôles top/perspective. Les champs HDR diffèrent de moins de 4 mm
(stockage demi-précision de la sonde). Le zoom aller-retour reproduit exactement
les images complètes, octet pour octet, dans trois séquences ; le déplacement souspixel mesuré
reste sous 0,012 au 99e percentile des variations de canal RGB.
