# Conifères clairsemés, profils de support et littoral continu

Cette itération prolonge le relief intermédiaire de `338efaf`. Elle ajoute une
végétation arborée discrète dans les secteurs froids/montagnards favorables,
différencie la forme des détails du sol, et corrige les plages en escalier et
la répétition des textures d'eau. Les champs hydrologiques et le DEM sont conservés.

## Conifères : complément séparé et mesurable

`forest_placement.py` conserve le champ original filtré dans
`forest-base-field.png`. Le complément `montane-forest.png` décrit sa propre
couverture, hauteur, proportion de conifères et tonalité. Il est fusionné dans
`forest-placed-field.png` par moments pondérés de canopée. Les attributs des
cellules sans complément restent identiques ; dans une cellule partagée, les
attributs représentent le mélange des deux couverts. La réduction 1334→1024
interpole aussi ces moments, pour ne pas transformer les conifères des bordures
en petits buissons par dilution de leur hauteur avec des pixels vides.

Le proxy d'aptitude utilise température locale, humidité, épaisseur de sol,
matrice, fragments, pente et géomorphons. La température annuelle locale +11 °C
est un proxy déclaré de saison favorable, pas une température estivale simulée.
Creux et pieds de pente sont favorisés comme proxy d'abri topographique ; aucun
champ de vent n'est prétendu. La couverture maximale théorique est 6 %, sans
objectif de remplissage si le terrain est inéligible. Hauteurs : 4,5–9 m et
proportion de conifères : 97 %.

Crêtes, pente ≥32°, sol très mince, dépôts à forte fraction de fragments, eau,
plages et neige dominante sont exclus. L'exposition est le maximum du guide
Render et de N1. Une marge physique 100–170 m et une réduction conservative
protègent le support des couronnes et les rivières vectorielles subpixel.

Le GLSL des couronnes reste celui du Render original épinglé. Le guide de
couleur du complément utilise sa palette de conifères. Sa contribution moyenne
est ajoutée uniquement à la branche non résolue du modèle : elle ne teinte pas
le sol entre les couronnes proches. La même moyenne accompagne la référence
lointaine, sans apparition soudaine au zoom.

Mesures de couverture supplémentaire préparée : environ 0,93 % de la tuile de
collines froides, 0,47 % du plateau froid et 0,074 % de montagne tempérée. Les
montagnes froides dominées par la neige restent sans complément. Sur les quatre
cadrages proches de contrôle des collines froides, la couverture effectivement
rastérisée est d'environ 1,85 %.

## Formes propres au support, dans la même enveloppe

`meso-profiles.png` contient un mélange convexe RGBA8 : roche massive,
roche stratifiée, fragments, reste tendre. Les fractions lithologiques,
l'altération, l'arrondi des fragments et le potentiel colluvial déterminent les
poids. Leur somme quantifiée vaut exactement 255, sans sélection de matériau
par seuil ni changement des variantes PBR choisies pour la carte.

La bande de 27 m utilise ces profils : bosses asymétriques pour la roche
massive, épaules plus marquées pour les fragments, formes allongées orientées
pour la roche stratifiée, réponse douce pour les autres supports. L'orientation
est lue dans le champ de structure à quatre ancres fixes de patches de 256 m.
Les hauteurs et leurs gradients sont mélangés avec les dérivées des poids ;
faire tourner les coordonnées par un axe variable aurait créé du cisaillement.

Les autres bandes 64 / 9,5 / 3,75 m restent partagées. Une enveloppe déterministe
sur une grille de 150 m module doucement les amplitudes entre 76 et 100 %, sans
dessiner directement de taches colorées. Ses gradients passent par le contexte
natif. Les profils remplacent une partie du champ existant : l'enveloppe totale
reste ±3 m, avec le même picking et les mêmes bornes de culling.

Couleur et rugosité suivent ces formes, avec une modulation faible. Le détail
PBR, la neige et les budgets d'affleurement/fragments restent conservés. Le
cache ajoute une image de profils de 7 118 224 octets décodée par tuile ; le CPU
charge aussi la structure RGB native nécessaire aux mêmes calculs que le GPU.
Les hashes de géologie, structure et profils sont contrôlés au chargement.

## Plages et eau à plusieurs échelles

`prepare_surface_water.py` produit un champ côtier signé séparé pour mer et
lacs. Les passages du DEM au niveau marin ou lacustre positionnent les contours
à l'intérieur des cellules, au lieu de couper systématiquement leurs arêtes en
deux. Les signes aux centres natifs sont contraints ; des coefficients B-spline
interpolants sont ensuite stockés sur 16 bits par distance, à 1/32 m.

Le shader reconstruit ce contour continu et antialiase selon l'empreinte du
pixel. Les tests couvrent îlot/lac d'une cellule, isthme et chenal d'une cellule,
séparation de deux lacs et une côte diagonale connue. Le validateur vérifie les
signes reconstruits de chaque centre sur les 42 tuiles. C'est une reconstruction
d'affichage : niveaux, fond et masques de simulation restent inchangés.

Le raccord Render utilise deux cartes dérivées de couleurs sèches/mouillées,
avec donneurs certifiés, composantes séparées et recherche bornée. Une petite
composante sans donneur intérieur conserve ses propres couleurs. La correction
se limite à une bande littorale de 60–120 m et respecte la priorité du vectoriel
des rivières. Ces deux cartes portent `source_color`, comme la carte Render,
pour éviter une seconde interprétation de leurs RGB sRGB comme valeurs linéaires.

L'eau utilise maintenant des gradients procéduraux en coordonnées monde aux
échelles 233 / 61 / 13 / 2,7 / 0,6 m. Chaque bande s'efface lorsqu'elle devient
non résolue ; la rugosité compense approximativement les détails fins perdus.
Les anciens fichiers de vaguelettes restent des ressources préparées historiques,
mais le shader courant ne répète plus ces deux images comme motif principal.

Mer et lacs ont une dérive de vent. Les rivières utilisent trois bandes fines
advectées vers l'aval dans quatre frames fixes de 64 m, avec dérivées des poids
de mélange des hauteurs. Le temps ne multiplie donc pas le gradient spatial
d'un champ de flux variable. L'amplitude et les niveaux géométriques de l'eau
ne sont pas modifiés : ce spectre agit sur l'apparence et les normales.

## Reconstruction et contrôles

Après les données N1–N4 et les exports originaux déjà présents :

```powershell
python godot-render/tools/forest_placement.py
python godot-render/tools/prepare_mesoscale.py
python godot-render/tools/prepare_surface_water.py
python -m unittest discover -s godot-render/tools -p 'test_*.py'
python godot-render/tools/validate_mesoscale.py
python godot-render/tools/validate_surface_finish.py
./Test-Render.ps1 -Check
```

Les préparateurs acceptent `--tile <id>`. Les données dérivées et rapports
restent hors Git. Tests Godot, sans `--headless` :

| Test | Contrôle |
| --- | --- |
| `montane_forest_test.gd` | Canopée rastérisée, absence de teinte moyenne sur sol proche, contribution lointaine, image identique après zoom |
| `meso_support_test.gd` | 1 440 points CPU/GPU, profils purs/mélangés, limites de frames, gradients et bornes |
| `meso_support_view_test.gd` | Captures avec/sans profils, quatre supports, stabilité temporelle |
| `water_surface_test.gd` | Mer/lac distincts, littoral proche/loin, décodage couleur, spectre multiéchelle, flux à 0/60/3600 s |

Les tests géométriques, normales, matière, transitions, couvert, ombres/neige,
palette et navigation existants complètent ces contrôles.

La comparaison GPU utilise le commit `338efaf`, protocole ABBA à 1280×800,
30 frames de chauffe et 45 mesures. `prepare_meso_baseline.py` extrait les
sources antérieures, reconstruit leurs amplitudes et redirige uniquement leurs
caches et le champ forestier de base ; les données natives et palettes sont
communes. Les résultats concernent le temps GPU du viewport, hors chargement.
Les chiffres finaux sont reportés dans [TERRAIN_MESOSCALE.md](TERRAIN_MESOSCALE.md).
