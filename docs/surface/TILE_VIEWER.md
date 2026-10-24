# Viewer de comparaison 40 × 40 km

## Sol visible : N1–N4 et textures

Le menu **Vue · Sol texturé** affiche maintenant le sol sans arbres, canopée ni
constructions, sur le même relief en Dessus et en 3D. **Vue · Render** conserve
la carte d'origine ; **Vue · Types de sol** montre le classement avec des couleurs
de diagnostic. **Vue · Support minéral** retire les couvertures pour comparer le
substrat à la surface finale. Les calques d'Informations fonctionnent sur ces vues.

La composition suit maintenant trois étages : **support minéral → surface de
litière/herbe/mousse → neige**. Les textures de couvert ne se partagent plus le
même budget que les roches et graviers. Une couverture dense masque leur couleur ;
les affleurements et les versants très exposés la limitent. La vue du support
permet de voir les informations conservées sous ces couvertures.

**Nouvelles variantes de textures** tire un nouvel asset parmi les candidats de
chaque type, une seule fois pour tout le terrain. La classification des zones ne
bouge pas. La palette, les échelles et les hashes préparés sont conservés dans
`user://ground-texture-palettes-v1.json`. Les six climats d'une famille partagent
la même seed et les mêmes choix de textures. Un type à candidat unique garde sa
source. Le survol du curseur identifie le type dominant et l'asset effectivement
utilisé. La molette permet maintenant une vue jusqu'à environ 12 m de large.

Le catalogue local `godot-render/ground_texture_catalogue.json` reprend les
**90 types / 142 candidats** de l'étude, avec leurs sources et licences CC0.
Les packs sont préparés en images de 512² ; les téléchargements originaux et
leurs hashes sont conservés dans `materials/cache/` et `materials/prepared/`.
Godot utilise uniquement cette bibliothèque locale, sans téléchargement.

| Bloc | Données produites |
| --- | --- |
| N1 | Roche exposée, couverture de matrice et de fragments, rugosité structurelle ; budgets dont la somme vaut 1 |
| N2 | Stocks séparés sable/fines/graviers/pierres/blocs, taille, arrondi et mélange de provenance du dépôt ; aucun sable créé par la seule aridité |
| N3 | Distances signées rivière/lac/mer, connexion fluviale, emprise mouillée des rivières rasterisée depuis les polygones vectoriels conservés, potentiel de berges émergées |
| N4 | État Render avec sa neige canonique, états sec/humide ; presets supplémentaires de neige fraîche, irrégulière, compacte, ancienne, ventée, partielle, fonte et deux glaces |

Treize nouveaux diagnostics s'ajoutent à Informations : **47 calques** en comptant
les cinq hydrologiques et les 29 précédents. Les données FP32 sont archivées dans
`surface-grids.bin.gz`, séparément des diagnostics antérieurs. Les emprises fines
des rivières et de neige Render sont conservées en 4096² ; les autres champs
restent à 1334². Les deux nouveaux diagnostics de surface montrent sa couverture
et le masque de neige. Les diagnostics portent le préfixe `surface-info-` pour ne
jamais écraser les masques canoniques.

Les préférences forestières, prairiales, steppiques et de savane sont dérivées des
entrées environnementales ; elles ne prétendent pas retrouver une canopée exacte
de l'ancien Render. Un profil d'apparence global, stable par seed et enregistré
dans `tile.json`, départage les préférences non mesurées. Il ne dépend pas du
bouton de variantes. Les cinq parents géologiques gardent vingt profils rocheux
de base et deux profils colonisés ; aucune nouvelle lithologie n'est inventée.

Le classement normalise les recettes dans leurs budgets physiques. Pour limiter
les textures lues, le support conserve deux profils rocheux, une recette de
fragments et trois recettes de matrice minérale. Les budgets roche/fragments/
matrice sont quantifiés ensemble à une somme de 255, puis répartis dans leurs
slots : l'erreur par budget reste inférieure à 1/255. Au-dessus, la surface porte
trois proportions continues : litière, herbacé et humide/mousse. Chacun possède
sa recette dominante et une couverture séparée. Le shader interpole les réponses
de quatre cellules voisines, jamais leurs IDs.

L'humidité d'apparence est filtrée sur 110 m, l'organique sur 85 m et les scores
sur 75 m avant la réduction des recettes. Les champs hydrologiques de référence,
les niveaux d'eau et les polygones des rivières restent inchangés. Le filtrage des
entrées est normalisé hors eaux permanentes. Les proportions forestière/herbacée/
mousse restent séparées pour éviter qu'un changement de rang ne recrée une
frontière brusque de prairie.

Au survol, la couleur est la moyenne linéaire de l'asset préparé et recoloré.
Au zoom, le même asset apporte couleur, normales OpenGL et rugosité ; la hauteur
module seulement la micro-réponse, sans déplacer le relief. Les minéraux reçoivent
une palette resserrée dont les moyennes sont communes aux profils d'un même
parent : la succession géologique procédurale ne domine plus la couleur au
survol. Le recalage affine conserve cette même moyenne au zoom, avec un contraste
borné. Feuilles, herbes, mousses et neige gardent leurs palettes propres.
Les normales du relief suivent le gradient B-spline pour éviter
les facettes visibles. Les strates suivent leur orientation continue ; les rides
de sable et de neige utilisent le vent régional déclaré. Les coordonnées sont
physiques et fixes, indépendantes de la caméra.

Le tuilage utilise une grille triangulaire avec trois patches aux translations
et rotations déterministes, selon la technique décrite dans
[RENDER_REVIEW §3.1](../../../magna-urbis-height-chain-budget/docs/RENDER_REVIEW.md)
et [RENDER_SURFACE_DESIGN §7.2](../../../magna-urbis-height-chain-budget/docs/RENDER_SURFACE_DESIGN.md).
Les UV, dérivées, couleur, hauteur et rugosité suivent
les mêmes transformations et poids ; les normales tangentes sont tournées en
sens inverse. Les matières orientées gardent leur direction avec une petite
dispersion. Une correction de variance limitée à 1,4 réduit la perte de contraste.
C'est une correction approchée, sans LUT de conservation exacte d'histogramme.

Le soleil Godot projette les ombres du relief, avec une carte directionnelle de
8192² et une portée adaptée à la caméra. L'ambiant réduit et l'occlusion calculée
sur huit horizons du DEM rendent les creux lisibles ; cette occlusion ne remplace
pas les ombres portées. L'ancien Render reste affiché sans nouvel éclairage.

**État Render** superpose automatiquement le masque de neige calculé par le
shader Render d'origine, avant son éclairage, à partir du même DEM et du même
climat. `ground_render_snow.mjs` instrumente uniquement un passage GPU hors ligne :
aucun pixel blanc de la carte n'est interprété comme de la neige. Le masque et
ses hashes sont conservés ; le sol sous-jacent reste disponible.

Les presets neige/glace supplémentaires sont des états de test avec une anomalie
froide de scène déclarée de −18 °C. Sec et Humide conservent aussi la neige Render.
Cela reste une apparence de scène, sans simulation d'histoire glaciaire. Sec déclare un
cycle de dessiccation pour autoriser les petites fissures. Les niveaux d'eau et
la géométrie restent inchangés. Les berges sont des potentiels dérivés, pas des
bancs observés ; aucune histoire glaciaire, tourbeuse ou saline de 4.2 n'est exigée.

Préparation depuis ce worktree, après les données de relief/hydrologie/sol :

```powershell
node godot-render/tools/ground_water_masks.mjs
node godot-render/tools/ground_render_snow.mjs
python godot-render/tools/ground_surface.py --workers 4
python godot-render/tools/prepare_ground_textures.py
python godot-render/tools/validate_ground_surface.py
./Test-Render.ps1 -Check
./Test-Render.ps1
```

La préparation PBR est la seule étape qui accède à Internet. L'extraction du
masque de neige demande la page du Render de référence servie localement sur
`http://127.0.0.1:5203`, avec Edge/Playwright ; aucun service neuronal n'est requis.
Le viewer Godot utilise ensuite les fichiers conservés, sans serveur.
Un téléchargement JPG indisponible
peut utiliser le pack PNG du même asset. Les scripts sont relançables et gardent
les sorties complètes dont l'identité est inchangée. `--tile mountains--temperate`
permet de limiter les compilateurs de carte et le validateur à une tuile.

Vérifications : `test_ground_surface.py` contrôle les budgets, les matières
admissibles et les états ; `validate_ground_surface.py` vérifie les archives,
les hashes, les 42 tuiles et les 142 assets. Le test GPU
`res://tests/ground_textures_test.gd` contrôle vues, presets, stabilité de palette,
changement visible des variantes et conservation de la classification.
`ground_quality_test.gd -- --tile mountains--cold` isole aussi les ombres, la
couverture, la neige et un matériau plan. `validate_ground_quality.py` compare
sa synthèse au tuilage périodique de référence, au pas réel de l'asset, et vérifie
la dérive de moyenne et de contraste.

## Navigation et données de référence

Double-cliquer `Test-Render.cmd`, ou lancer `./Test-Render.ps1` sans argument.
Le projet `godot-render/project.godot` ouvre aussi directement la démo.

Une scène 3D, un maillage et un matériau sont conservés pour les deux vues.
Au démarrage, la caméra est verticale et orthographique. Le bouton « Passer en
3D » ou Tab active la perspective ; revenir à la carte garde le centre et la
largeur de vue. La dernière orientation orbitale est mémorisée.

- Gauche ou milieu + glisser : déplacement latéral.
- Droit ou Alt + gauche + glisser : orbite, avec entrée automatique en 3D.
- Molette : zoom centré.
- ZQSD / WASD physiques ou flèches : déplacement ; Maj accélère.
- R : recentrer ; H : masquer le panneau ; Échap : quitter.
- Menus relief et climat, liste des 42 combinaisons, boutons précédent/suivant.
- Le changement de tuile conserve la position XY, le zoom et la projection.
- La règle graduée, en bas à gauche, suit le zoom. En perspective elle mesure
  la distance horizontale au centre de la vue, à l'altitude du pivot.
- En bas à droite, l'altitude et les coordonnées sont celles de l'intersection
  du rayon du curseur avec les triangles du terrain affiché. Hors tuile : « — ».
  La surface de la mer est à 0 m.

Le catalogue contient 7 reliefs × 6 climats, sur 40 000 m de côté. Default
correspond au preset tempéré existant (18 °C, 1 000 mm/an). Les trois familles
côtières demandent une côte sud au conditionnement neuronal. Chaque combinaison
a réellement été générée par le service Python/CUDA, avec les trois modèles
`original`. Une seed par famille permet les comparaisons de climat.

Chaque dossier dans `godot-render/tiles/` contient le heightfield FP32 1334²,
son SHA-256, les paramètres et la provenance neuronale, ainsi qu'une carte
4096² produite par le Render web existant. La scène affiche cette carte sur un
maillage 1335², déplacé par le heightfield avec interpolation B-spline cubique,
sans exagération verticale. La mer est plane à zéro. Le pivot suit la hauteur
locale afin que le zoom reste au-dessus du terrain.

La chaîne complète est `coarse → base → decoder`, avec les modèles originaux.
Le checkpoint du décodeur est natif à 30 m. Le mode `outputResolution=native`
conserve cette définition : 1334 échantillons sur 40 km, soit 29,985 m par
échantillon. Il évite la réduction historique à 1024² (39,0625 m) et le maillage
plus grossier de 513². La légère interpolation de la grille native de 30 m vers
le domaine exact de 40 km ne crée pas de nouvelle information neuronale.
Chaque descripteur conserve `decoderNativeCell`, `outputResolution`, les trois
étages exécutés et `nativeDefinitionRetained`. La génération refuse une réponse
qui n'atteste pas cette définition.

C'est la première base d'exploration : couleur et éclairage de la carte sont
précalculés, la texture ne gagne pas de détail au zoom. Les 42 terrains passent
désormais dans la chaîne **vector** du Terrain Bench : drainage priority-flood,
bilan des lacs Fill–Spill–Merge et rivières vectorielles (méandres, bras, deltas).
Le bilan utilise la température, les précipitations et l'évaporation du climat.
Le seuil de rivière vaut `min(16 ; 4,8 × √(300 / max(3, ruissellement)))` km² : les milieux
arides exigent un bassin plus grand, les tropiques montrent davantage de cours
d'eau. La génération vérifie nombre et longueur aride < tropical pour les sept
familles. Aucun lac artificiel n'est ajouté si le relief et le bilan ne le permettent.

`height.f32` et son hash conservent le décodeur brut. `surface.f32` relève les
cellules lacustres à leur niveau hydraulique pour la vue 3D. `water.json` conserve
les polylignes et leur topologie ; `water.svg` contient uniquement des vecteurs,
sans image incorporée. Le Render web compose ces eaux sur la carte 4096².

La combo **Informations** superpose des calques à la même surface, dans les deux
projections : bassins versants, accumulation/ruissellement, réservoirs potentiels
(profondeur des dépressions sous leur seuil), bilan des lacs ouverts/fermés et
directions d'écoulement. Le curseur règle leur opacité ; « Aucun calque » rétablit
la carte. La sélection est conservée au changement de tuile. Une légende décrit
les couleurs. Les réservoirs potentiels sont des dépressions topographiques,
pas des barrages construits ni une simulation de retenues aménagées.

Les PNG transparents des calques sont dérivés des calculs conservés dans
`hydrology-grids.bin.gz` : bassins, receveurs, accumulation, niveaux de remplissage,
masque marin, lacs, niveaux et types des lacs. Le descripteur fournit types,
offsets et unités spatiales ; les flottants sont FP32 et les entiers 32 bits,
little-endian. Aucun calcul hydrologique ne dépend de la caméra.
Le viewer fonctionne ensuite hors ligne, sans service ni régénération.
L'ancienne lecture exacte de fixture 2D reste accessible avec `-Scene`.

### Étape 1 : contexte du sol (§5.1–5.4)

Les cinq diagnostics hydrologiques sont complétés par **29 calques du sol**
sur chacune des 42 tuiles. Ils partagent la grille canonique 1334² (~30 m),
les coordonnées et le relief des vues Dessus et 3D. La sélection persiste au
changement de tuile ; les catégories ont des légendes avec pastilles colorées,
les champs continus affichent leurs plages et unités. L'opacité règle la
superposition sur la carte Render ; « Aucun calque » rétablit le fond.

| Partie | Calques ajoutés |
| --- | --- |
| 5.1 Géomorphologie | Géomorphons 150, 600 et 2 000 m ; pente ; exposition ; courbures de profil et en plan ; positions topographiques aux trois rayons |
| 5.2 Géologie | Composition de roche mère ; roche dominante (diagnostic) ; dureté ; altérabilité ; orientation des strates |
| 5.3 Processus | Domaine dominant ; provenance fluviale amont ; épaisseur potentielle des dépôts |
| 5.4 Eau et sol | TWI ; HAND ; distance aux eaux ; eau disponible ; drainage ; réserve utile ; texture sable/limon/argile ; organique ; pierrosité ; profondeur du sol |
| Contexte | Limites et confiance selon la complétude du domaine |

Les géomorphons utilisent huit lignes de visée avec tous les échantillons
disponibles dans chaque rayon physique, une comparaison d'ouverture zénith/nadir
signée et un seuil de platitude de 1°. La réduction donne dix classes : plat,
sommet, crête, épaule, éperon, versant, creux, pied de pente, vallée, dépression.
Références : [Jasiewicz et Stepinski](https://doi.org/10.1016/j.geomorph.2012.11.005)
et [r.geomorphon](https://grass.osgeo.org/grass-stable/manuals/r.geomorphon.html).
C'est une implémentation locale des visées et de leur classification, pas une
exécution de GRASS ni une reproduction de ses corrections étendues. Le TPI
emploie un voisinage carré dont la demi-largeur est le rayon annoncé ; pente,
exposition et courbures utilisent un lissage gaussien de sigma 60 m. Aucun de
ces champs n'est dérivé du maillage de la caméra ou des couleurs Render.

La roche mère est un **prior procédural déclaré**, indépendant de l'altitude
et du climat : séries calcaire/grès/argilo-marneux plissées, contacts déformés
par bruits cohérents, intrusion granitique et province basaltique. Les bruits
s'étagent de 70 m à 8 km ; la seed commune à une famille garantit la même
composition dans ses six climats. Le modèle conserve cinq proportions dont
la somme vaut 1. Les contacts sont des zones graduelles de largeur variable,
déformées à plusieurs échelles ; une hétérogénéité interne complète les unités.
Dureté, altérabilité, texture minérale source et provenance transportée
consomment ces proportions, sans passer par une classe dominante.

« Roche mère — composition » visualise ces fractions avec des couleurs
mélangées en lumière linéaire et une variation interne modérée. « Roche
dominante (classes) » sert uniquement à inspecter la classification et garde
ses limites franches. Les champs continus utilisent interpolation et mipmaps
dans Godot ; les classes conservent un échantillonnage au plus proche voisin.
Le terrain Render de base reste la carte source précalculée : les proportions
sont désormais disponibles pour la prochaine étape des matériaux du sol.
Cette représentation prépare les raccords ; elle ne constitue pas encore
une validation du futur mélange PBR au centimètre.

L'orientation structurale et les propriétés minérales restent des champs
distincts. La roche mère
reste visible sous les lacs dans son diagnostic, mais les diagnostics de sol
sont masqués sous les eaux permanentes.

Le compilateur suit exactement les receveurs conservés de l'hydrologie
vectorielle. Il recalcule une **aire contributive géométrique** pour le TWI,
distincte de l'accumulation pondérée par le bilan hydrique. HAND suit le graphe
jusqu'au premier chenal, lac ou mer ; il est indéfini et transparent si le
chemin finit à un exutoire sans cette référence. Les références et les types
d'exutoires sont archivés. Les chenaux conservent les tronçons aval où le
ruissellement diminue, selon la logique du réseau vectoriel.

Un mélange des cinq provenances, pondéré par un potentiel d'érosion, circule
de l'amont vers l'aval. Les alluvions latérales reçoivent le mélange du tronçon
voisin, sous contraintes de pente, distance et hauteur au drainage. Les
potentiels colluviaux suivent une source rocheuse et un chemin aval avec
atténuation ; les accumulations éoliennes demandent un stock sableux, un
climat sec et des pièges sous un vent régional déclaré à 70°. Le littoral
dépend de la proximité marine, de l'altitude, de la pente et du stock ; le gel
dépend du climat corrigé de l'altitude. Ce sont des domaines de synthèse :
aucune dune, incision, croûte saline ou modification du relief n'est produite.

Le sol conserve **sable + limon + argile = 1** et sépare organique, pierrosité,
profondeur, stockage et potentiel hydrique. Les épaisseurs, le stockage et
l'eau disponible sont des proxys de synthèse, sans bilan de masse, nappe,
drainage karstique, pluie datée ou prédiction de crue. Les bassins fermés
existants sont conservés. Le domaine ne connaît pas les apports extérieurs :
un diagnostic réduit la confiance dans les bassins touchant les limites et
dans une bande de 2 km au bord. Il ne remplace pas le bassin amont manquant.

`tile.json.ground` conserve l'identité du compilateur et de ses dépendances,
le scénario géologique, les paramètres, les plages, les palettes et les hashes.
`ground-grids.bin.gz` archive les catégories entières et les champs FP32,
y compris les cinq proportions de roche mère, leur variation interne, les
cinq fractions de provenance, les potentiels de processus et
les références HAND. Le schéma donne offsets, types, taille, repère local
(x vers l'est, y vers le sud), largeur en mètres et endianness little-endian.
`ground-*.png` ne sert qu'à l'affichage. Les fichiers générés restent hors Git.

Pour reconstruire le contexte sans recalculer le relief, l'eau ou Render :

```powershell
python -m pip install -r godot-render/tools/requirements-ground.txt
python godot-render/tools/surface_context.py
python godot-render/tools/validate_ground.py
python godot-render/tools/test_surface_context.py
```

`--tile mountains--temperate` limite la reconstruction à une tuile ;
`--force` ignore le cache ; `--scenario` accepte `mixed` (défaut), `granite`,
`limestone`, `sandstone`, `marl` ou `basalt`. Une modification du compilateur,
du terrain, du graphe, du climat ou du scénario invalide les sorties. La reconstruction
traite deux tuiles en parallèle par défaut ; `--workers` et `--threads`
règlent les processus et les threads de visée par processus. Le catalogue
est publié par le seul processus principal, après les fichiers de chaque tuile.
`hydrate_tiles.mjs` appelle ensuite ce compilateur automatiquement ; `--python`
permet d'indiquer son exécutable. Les dossiers de données sont exclus de
l'import Godot via `.gdignore` et leurs PNG sont lus explicitement.

Le validateur contrôle les 1 218 PNG du sol, leurs hashes, les archives,
les sources inchangées, les fractions minérales, la conservation des aires
contributives, HAND, TWI, la géologie identique entre climats et une eau
disponible moyenne plus élevée sous climat tropical qu'aride. Le test GPU
`res://tests/ground_layers_test.gd` parcourt les 34 couches, vérifie les palettes,
les projections, le maintien de la sélection, puis produit les captures
`evidence/ground-*.png`. Le test général parcourt aussi les 42 tuiles.

```powershell
./Test-Render.ps1 -Check
./Test-Render.ps1 -Tile coastal-mountains--tropical -Mode 3D
./Test-Render.ps1 -Capture ./godot-render/evidence/manual.png
```

Les fichiers générés restent locaux, hors Git. Le script de génération reprend
les tuiles terminées ; il nécessite les services et les assets neuronaux locaux
déjà installés ainsi que le worktree du Render original :

```powershell
node godot-render/tools/generate_tiles.mjs --web-root ../magna-urbis-render-original-reference/web --base http://127.0.0.1:5203 --assets-base http://127.0.0.1:5197 --neural http://127.0.0.1:8894
```

Si les 42 sources natives existent, ce script les réutilise et régénère seulement
l'eau, les cartes et les couches, sans service neuronal. Cette étape peut aussi
être lancée directement avec `node godot-render/tools/hydrate_tiles.mjs`.
Le rapport `tiles/hydrology-report.json` conserve les statistiques par climat.
`--force` recalcule aussi les sorties déjà présentes ; sinon une configuration
inchangée et complète est reprise. `terrain-render.png` garde le fond sans eau
pour éviter d'accumuler les superpositions lors des relances.

`node godot-render/tools/validate_hydrology.mjs` vérifie les 42 sources et surfaces,
les hashes des cartes, les polylignes, les grilles compressées, les niveaux des
lacs et les 210 calques, puis compare aride et tropical pour chaque relief.

Validation GPU : `godot --path godot-render --audio-driver Dummy --script
res://tests/tile_viewer_test.gd`. Le test charge les 42 tuiles, contrôle les
hashes, l'unicité des surfaces, la présence terre/mer sur les côtes, l'identité
du maillage, les projections, le zoom, l'orbite et le déplacement. Captures et
rapport sont écrits dans `godot-render/evidence/`.
`res://tests/survey_test.gd` vérifie en plus l'altitude sur un terrain plat puis
le relief réel sous plusieurs angles, la reprojection du point sous le curseur,
les points hors tuile et la variation de la règle avec le zoom.
