# Sol, couvert bas, arbres et représentation de canopée

Le contrat `surface-layers-1` (compilateur `surface-1.5.2`) distingue trois
étages physiques. Leur représentation optique est un choix de rendu, séparé des
données canoniques. La campagne V5 portait sur `surface-1.4.0` : elle **ne valide
pas** ce nouveau contrat, son shader ni sa qualité visuelle. La campagne
[V8](surface/evidence/native-e2e-v8.json) qualifie techniquement son intégration
live : quatre visibilités distinctes, mêmes données physiques et inventaire.
Elle ne vaut pas acceptation artistique.

1. **Sol/support** : roche, dépôts, sol minéral et matière organique du sol. Le
   carbone/humus du sol reste distinct de la litière morte en surface. Ce support
   existe aussi sous les herbes, les couronnes et l'eau ; l'eau possède sa propre
   classe/niveau/autorité et n'est pas une recette de sol.
2. **Couvert bas** : herbes, arbustes bas et litière morte. Les champs physiques
   existants `grassCover`, `shrubCover`, `litter` restent inchangés. La couche
   projetée possède ses recettes, sa moyenne linéaire et son opacité explicites.
3. **Arbres** : potentiel canonique de projection des couronnes `treeCover`,
   inventaire stable `family:'tree'`, appuis, tailles et rayons des couronnes.
   La canopée distante/les instances sont des représentations de ces arbres,
   jamais une nouvelle lithologie ni une composante minérale du sol.

Le budget de matière d'un sol minéral est `sand+silt+clay=1`, avec `organic`
distinct. Une paire de matériaux se normalise **dans son étage**. Il n'existe
aucune partition globale imposant `sol+herbes+arbres=1` : des herbes et une
couronne peuvent occuper le même point à des hauteurs différentes.

## Transport compact

Les nouvelles arrays sont dans `world.fields`, alignées sur la grille de ce
world. Les grilles projetées conservent le contexte canonique de la même manière
que les autres champs de SurfaceWorld.

| Champ | Type | Sens |
| --- | --- | --- |
| `groundMaterial`, `groundMaterialSecondary` | `Uint16Array` | Indices du support roche/dépôt/sol, sans litière ni vivant. |
| `groundMaterialBlend` | `Float32Array` | Paire support : `primary*(1-blend)+secondary*blend`. |
| `groundMaterialMeanColor` | `Uint32Array` | Moyenne linéaire de tous les poids support avant réduction top2 ; même packing sRGB8 que le legacy. |
| `lowCoverMaterial`, `lowCoverMaterialSecondary` | `Uint16Array` | Indices de recettes de couvert bas, normalisés dans cette couche. |
| `lowCoverMaterialBlend` | `Float32Array` | Mélange des deux recettes basses. |
| `lowCoverMaterialMeanColor` | `Uint32Array` | Moyenne linéaire basse, obtenue directement des recettes. |
| `lowCoverOpacity` | `Float32Array` | Fraction projetée `[0,1]` du couvert bas sur le support disponible. |

Coût supplémentaire : **28 octets par échantillon**, soit 28 Mo pour un million
d'échantillons, avant éventuelle copie du contexte canonique dans un export.
Le budget mémoire est vérifié avant allocation. Le binaire conserve les types ;
le JSON restaure les constructeurs exacts et reste soumis à sa limite de taille.

`world.surfaceLayers` annonce `version:'surface-layers-1'`,
`groundAvailability`, `lowCoverAvailability` et `fieldsVersion`. Une compilation
nouvelle utilise `explicit`. `fieldsVersion` lie les neuf arrays de la grille
actuelle ; `versions.surfaceLayers` lie les arrays canoniques. Le retargeting
conserve cette dernière version et transporte
`canonicalContextRef.surfaceLayersVersion`. Ces versions participent aux IDs.

Les recettes ont un rôle facultatif pour les anciens catalogues,
`surfaceRole:'ground'|'low-cover'|'water'|'seasonal'`. Les nouveaux catalogues
intégrés l'annoncent explicitement. Normales, rugosité et palette cartographique
doivent être résolues depuis **la recette de la couche concernée**. La famille
legacy `vegetation` ne suffit pas à choisir entre herbe et litière.

La couleur stockée de couvert bas est une moyenne non prémultipliée ; son alpha
est distinct. Toute interpolation de couleur/IDs/rugosité/normales utilise les
poids `bilerp*lowCoverOpacity`, puis normalise par la somme des alphas. Un texel
transparent ne contribue jamais sa couleur de fallback. Le GPU doit multiplier
le RGB linéaire par l'alpha **avant** filtrage/mipmaps, puis récupérer la couleur
si l'alpha est positif. Une somme nulle reste neutre et invisible.

## Construction et invariants

Le support est calculé à partir des mêmes scores roche/dépôts/sols que le
compilateur, avant le couvert. Il conserve les contacts, les affleurements et les
dépôts ; il n'est pas remplacé par une couleur de sol uniforme. Les recettes
rocheuses de support utilisent le substrat déclaré, les dépôts gravitaires leur
source de fragments. Les sols humiques utilisent la nouvelle recette brune
`organic-soil`, ajoutée en fin de catalogue ; `wetland-organic` conserve son ID
et sa couleur legacy mais ne remplace plus brutalement le support.
La fraction dérivée de humus varie continûment (C1) avec l'humidité entre
0,72 et 0,88, décroît avec la pente entre 0,08 et 0,16 **radian**, et utilise la
fraction organique existante entre 0,02 et 0,16. Ces intervalles sont des choix
d'auteur pour un potentiel d'apparence, pas des seuils de classification
pédologique calibrés. Ils ne dépendent ni du zoom ni d'un filtrage UV ajouté.
Les poids minéral/humus se répartissent le même support ; la moyenne conserve
tous les poids avant réduction top2. Les champs physiques restent inchangés.

L'opacité basse prend successivement le support non rocheux, la litière, les
arbustes puis les herbes. Cette priorité est une approximation déclarée de la
projection de cet étage. Elle ne modifie pas ses champs physiques et ne débite
jamais `treeCover`. Les herbes utilisent la recette legacy `vegetation-litter`,
liée au PBR `grass` ; la litière utilise `forest-litter`, liée au PBR `litter`.
Les arbustes emploient actuellement la recette de végétation basse comme proxy,
sans prétendre disposer d'un asset PBR de feuilles spécifique. Routes,
constructions et eau bloquent le couvert bas ; le rocher réduit son support.

Les hauteurs source, minéraux, sols physiques, climat, couverts canoniques,
masques d'appui et IDs/acceptations/rangs des candidats ne changent pas avec ce
contrat. `sampleSurface(...).surfaceLayers` expose les trois étages.
`selectSurfaceLayerView(sample,{lowCover:false,trees:false})` produit seulement
une sélection de visibilité ; le sol retourné reste le même objet et aucun
champ, appui ou inventaire n'est édité. La couleur d'une canopée distante,
ses empreintes et ses transitions restent du ressort de la représentation.

## Compatibilité honnête

Les champs historiques `material`, `materialSecondary`, `materialBlend`,
`materialMeanColor` sont conservés **exactement** : c'est le composite
support+litière+herbes, sans canopée ni neige. Ils ne doivent pas être présentés
comme un diagnostic de sol nu. Le préclassement historique fondé sur
`treeCover+grassCover` est ensuite remplacé par cette composition naturelle ;
il ne constitue pas, à lui seul, la preuve d'une double canopée dans le sol.

Un ancien paquet sans les neuf arrays porte
`groundAvailability:'legacy-composite-unavailable'` et
`lowCoverAvailability:'legacy-composite-unavailable'`, avec un avertissement
explicite. L'hydratation ne tente aucune soustraction ou reconstruction depuis
son top2 mélangé. Le sample fournit `ground:undefined`/`lowCover:undefined` ; un
viewer peut afficher le composite legacy en annonçant ce fallback. Un groupe
partiel, une disponibilité mensongère, un mauvais type/rôle, un blend/alpha hors
borne ou une version de champs éditée est refusé.

## Contrôles et reste à qualifier

Les tests comparent tous les anciens champs et 6 422 candidats complets au
snapshot pré-couches `f6a45af` : même géométrie, mêmes acceptations, positions,
appuis, IDs et rangs. Ils vérifient aussi les toggles sans mutation, les rochers
sous couvert, les exclusions, les saisons, les patches superposés, le binaire,
le JSON, les budgets et les métadonnées legacy/malformées.

L'intégration GD doit ajouter des diagnostics séparés **sol nu**, **herbes et
litière**, **arbres** et **canopée optique**, avec contrôles de visibilité
indépendants. Elle doit empêcher la disparition apparente des herbes/arbustes
quand leurs géométries sont réduites, et distinguer cet objectif de la correction
du carré de forêt distant. Les captures V5 ne qualifient ni ces nouvelles couches,
ni les escaliers de couleur à la maille canonique, ni une scène urbaine construite.
