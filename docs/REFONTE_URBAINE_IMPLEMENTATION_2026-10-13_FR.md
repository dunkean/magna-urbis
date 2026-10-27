# Refonte urbaine native — implémentation du 13 octobre 2026

[English translation](REFONTE_URBAINE_IMPLEMENTATION_2026-10-13.md).

La refonte sépare désormais empreinte, centres et histoire, tissus de rues,
secteurs de calcul, îlots et parcelles. Elle s'exécute en Rust/WASM dans Terrain
Bench et Urban Bench, jusqu'au parcellaire. Le catalogue culturel existant reste
disponible ; l'application TypeScript historique conserve son moteur indépendant.

## Mécanismes livrés

| Échelle | Méthodes et comportement |
|---|---|
| Empreinte | Fondation vectorielle, croissance accessible anisotrope, accrétion le long des routes, fusion de noyaux |
| Familles | Circulaire/ovale, rectangulaire, polygonale, compacte, allongée, ruban, éventail, doigts, dendrite, lobée, archipel, composite |
| Surface | Budget démographique strict population/densité brute, ou budget artistique par rayon ; déficit explicite |
| Géographie | Coûts locaux de terrain et d'accès, exclusions d'eau, composantes et trous conservés |
| Centres | Plusieurs noyaux, ancrage de leurs réseaux ; centres de desserte explicites pour les composantes planifiées |
| Histoire | Domaines chronologiques disjoints, extensions et fusion annoncée seulement si les composantes se rejoignent |
| Tissus | Culture, grille, organique, radial, terrasses, ramifié et groupes autour d'un commun |
| Interfaces | Armature commune ; les frontières d'époque ne deviennent pas des frontières artificielles de génération de rues |
| Îlots | Recettes et zones choisies spatialement selon la phase ; phase conservée par îlot |
| Desserte | Boucle locale ajoutant des passages publics/piétons, collectifs ou privés selon profondeur, recette et pente |
| Parcelles | Bandes, découpe orientée, concurrence des territoires de façade, domaines entiers et jardins |
| Géométrie | Contrôles de couverture, dépassement et chevauchement par union, conservation des exclusions |

Les noms de familles sont des préréglages et des guides. Le choix automatique
associe les mécanismes cohérents ; une surcharge manuelle du mécanisme garde
sa priorité. Une forme ne dicte pas automatiquement le tissu ni le parcellaire.

### Ajustement des empreintes naturelles

Le choix automatique distingue désormais la forme d'une enceinte culturelle
d'une fondation géométrique. Une enceinte ronde ou ovale ne suffit plus à
produire une ville circulaire planifiée. Les fondations orthogonales culturelles
conservent leur contour géométrique lorsque le site est suffisamment plat et
sec ; un site contraint utilise une croissance adaptée au terrain. Un choix
explicite de famille géométrique ou de fondation planifiée garde sa priorité.

Le diagnostic géographique échantillonne le voisinage à l'échelle de la ville,
avec pente, relief et proportion de sol disponible. La croissance combine
accessibilité, pente du sol et variation spatiale déterministe à plusieurs
échelles. La pente du sol évite de considérer un versant raide comme constructible
simplement parce qu'un trajet horizontal le longe. Les noyaux organiques utilisent
le même terrain ; les exclusions ne sont pas remplies pour atteindre artificiellement
le budget de population.

Les quartiers exposés regroupent les secteurs selon centre et phase dominante.
Ils représentent des identités morphologiques de génération, sans prétendre
simuler à ce stade tous les quartiers sociaux ou administratifs historiques.

## Utilisation des bancs

Dans le bloc 6, choisir **Empreinte et croissance**, le budget, la famille et
éventuellement plusieurs noyaux. Le **Tissu de rues** et la **Desserte** se règlent
séparément. Les groupes autour d'un commun créent les espaces collectifs avant
les parcelles. Le bloc 7 affine ces mêmes îlots et conserve le layout.

Les couches réserve, terre attribuée, noyaux/identités, phases et desserte aident
à lire le résultat. Les tableaux affichent surface cible, surface attribuée,
voirie et limites, réserves/communs, déficit et accessibilité. Le rendu ne relance
aucune génération. Les terrains ruraux et le réseau régional utilisent
l'emprise réellement attribuée.

Les URL ne sérialisent que les réglages appliqués. Les anciennes entrées sans
configuration d'empreinte utilisent le mécanisme historique et les recettes
d'accès historiques. Les ateliers isolés restent disponibles pour comparer
les opérateurs locaux.

Les configurations importées sont limitées aux champs de leur contrat, avant
génération et avant sauvegarde. Cela corrige les liens où un opérateur parcellaire
avait été conservé dans les réglages des quartiers : le moteur Rust refusait
ce champ et la ville ne se construisait pas. L'opérateur reste conservé dans
les réglages des parcelles.

## Choix de méthode et coût

Le champ d'accessibilité est local et borné à 192², indépendant du raster
régional. Les fondations planifiées sont calibrées par aire ; les noyaux organiques
et rubans automatiques emploient le champ de croissance sur le terrain. Les
bandes de routes imposées explicitement ne commencent pas par une ville circulaire
à déformer.

Les contours de croissance sont lissés avec déplacement borné, puis simplifiés.
Le candidat est accepté seulement si topologie, trous, centres et bras fins
restent conservés, avec variation d'aire et différence symétrique limitées à
1 %. Les trous d'eau restent ceux du masque. Un index exact des segments par
ordonnée accélère ensuite la recherche de phase sans changer le test de rayon ;
le snapshot de 30 000 habitants conserve les mêmes layouts et parcelles après
cette optimisation.

La desserte adaptative est limitée par le nombre de tentatives par îlot et à
96 accès ajoutés par lieu. L'index des façades est réutilisé tant que les rues
ne changent pas. Un accès candidat doit respecter le terrain, éviter l'eau et
les voisins et conserver le découpage du parent. Les fonds impossibles à
desservir restent explicites.

Les territoires de façade concurrents emploient des plans de distance orientés.
C'est une alternative native légère aux bandes prioritaires, pas une
implémentation générale du squelette droit. Le moteur peut choisir une méthode
différente par programme foncier.

Le cadre réutilise les principes de champs et subdivision hiérarchique,
et introduit une co-génération locale accès/foncier. Les références sont dans
la [revue bibliographique](REFONTE_GENERATION_URBAINE_2026-10-13_FR.md). Aucun modèle
neuronal de ville ni nouvelle dépendance lourde n'a été ajouté.

## Validation et reproduction

La revue Astra a été faite par phases puis sur les snapshots natifs. Elle a
conduit aux corrections suivantes : contrat numérique des centres, contrôles
historiques inactifs masqués, distinction doigts/dendrites, événements de fusion
réels, accès ne débordant pas sur les voisins, index partagé et diagnostics
d'accès cohérents avec les statuts exportés.

Vérifications à exécuter depuis `rust/` :

```powershell
cargo test -p magna-urbis-core urban --lib --release
cargo clippy -p magna-urbis-core -p magna-urbis-wasm --all-targets -- -D warnings
cargo check -p magna-urbis-core -p magna-urbis-wasm --target wasm32-unknown-unknown
cargo run --release -p magna-urbis-core --example urban_refonte -- --repeat --out out/urban-refonte.json
```

Depuis `web/` :

```powershell
npm run typecheck
npx vitest run --project fast tests/urbanRust.bridge.test.ts tests/terrainSettlements.raster.test.ts
npm run build
npm run build:terrain
node scripts/urban_refactor_ui_check.mjs http://localhost:5173/urbanbench.html
node scripts/urban_composition_ui_check.mjs http://localhost:5173/urbanbench.html
node scripts/urban_natural_scenes_check.mjs
node scripts/urban_natural_ui_check.mjs
```

Le corpus d'exemple permet `--case`, `--population`, `--seed`, `--repeat`,
`--out` et `--geometry`. Les rapports et captures produits restent dans les
répertoires ignorés. Les temps natifs et WASM mesurés sont à lire avec la
population, le nombre d'îlots/parcelles et les paramètres de chaque cas ;
ils n'établissent pas un gain sur un moteur produisant un autre niveau de détail.

### Validation initiale, avant l'ajustement naturel

- 39 tests natifs urbains passent, ainsi que Clippy strict et la compilation WASM.
- Typecheck et 8 tests TypeScript ciblés passent ; application historique et
  builds autonomes Terrain/Urban Bench compilent.
- Les 12 familles du corpus reproduisent exactement leurs JSON sur deux générations.
- Suites navigateur moderne et historique, démarrage Terrain Bench, isolement
  des parcelles, brouillons après import atelier et replay exact passent.
- Le bundle hors ligne importe un décor local et rejoue le plan exactement
  après réattachement du fichier, avec repli sans worker forcé, aucune erreur
  de page et aucune requête HTTP externe.

| Exécution / scène | Population | Parcelles | Quartiers et accès | Parcelles |
|---|---:|---:|---:|---:|
| Native release, compact/croisement, 70 hab./ha | 30 000 | 10 171 | 5,215 s | 1,557 s |
| Native release, rectangle/plat, 70 hab./ha | 100 000 | 20 345 | 4,807 s | 2,561 s |
| Chrome, WASM release, rectangle/grille, 160 hab./ha | 4 000 | 409 | 42 ms | 61 ms |
| Chrome, WASM release, même décor et réglages de grille | 30 000 | 3 130 | 763 ms | 828 ms |

Ces mesures sont des appels observés sur cette machine, sous charge locale
variable, pas des médianes garanties. Les appels navigateur incluent la frontière
JSON/WASM et excluent le rendu. Les cas natifs et navigateur utilisent des
densités et niveaux de détail différents : ils ne comparent pas les deux
technologies. Le petit corpus natif, de 600 à 2 500 habitants, mesure 26–461 ms
pour quartiers/accès et 11–299 ms pour parcelles.

Rapports : `rust/out/urban-refonte-smooth-{12,30k,100k}.json`, géométries associées,
`web/out/urban-refactor/result.json` et `offline-result.json`. Les captures sont
dans `web/out/urban-refactor/`. Sur les deux grandes scènes natives, les terres
sans desserte représentent respectivement environ 7,6 % et 22,4 % de la surface
foncière partitionnée ; les diagnostics les conservent explicitement.

### Validation après l'ajustement naturel

Les 41 tests urbains natifs et 10 tests TypeScript ciblés passent, ainsi que
rustfmt, Clippy strict, typecheck et les compilations WASM/Terrain/Urban Bench.
Le corpus des douze familles reproduit exactement ses layouts et parcelles.
La suite navigateur conserve les mécanismes, les composantes disjointes, les
graines, les brouillons non appliqués et l'isolement de l'étape parcellaire.

Cinq scènes comparent la plaine organique, la vallée courbe organique, une
fondation chinoise sur cette vallée, une fondation chinoise en plaine et une
ellipse explicitement planifiée en vallée. Les deux villes automatiques de
vallée suivent désormais le fond incurvé. La grille chinoise en plaine et
l'ellipse explicite conservent exactement leurs géométries précédentes.
Les captures ont été inspectées, puis revues par Astra, sans problème bloquant
restant identifié. Le bord garde un léger crénelage issu du raster.

Le lien signalé `d085-hills-coast-E-city`, avec 12 000 habitants, génère
177 îlots et 1 773 parcelles, sans erreur et avec replay exact. La caméra du
lien est conservée jusqu'au chargement du décor. La terre attribuée vaut
1 599 197 m² pour une cible de 1 600 000 m² ; l'amélioration de silhouette
ne provient donc pas d'une forte réduction de l'emprise.

| Exécution / scène | Population | Parcelles | Quartiers et accès | Parcelles |
|---|---:|---:|---:|---:|
| Chrome, WASM release, site côtier vallonné signalé, 75 hab./ha | 12 000 | 1 773 | 1,695 s | 0,624 s |
| Native release, compact/croisement, 70 hab./ha | 30 000 | 11 552 | 4,312 s | 1,728 s |

Ces mesures restent des appels observés, sans garantie de médiane ni revendication
d'accélération. Le nombre de parcelles de la scène native a changé avec son
empreinte ; les temps de validation initiale ne constituent pas un comparatif
à géométrie constante. Le corpus des douze petites scènes mesure 37–338 ms
pour les quartiers et 7–122 ms pour les parcelles.

Rapports actuels : `rust/out/urban-natural-12.json`, `urban-natural-30k.json`,
`web/out/urban-natural/after-result.json` et `scenes-after/result.json`.
Les captures et les géométries avant/après sont dans `web/out/urban-natural/`.

## Limites explicites

L'histoire livrée est une chronologie légère d'emprises ; elle ne simule pas
encore économie, mutations cadastrales successives ou tous les types de traces
d'enceintes anciennes. Les bâtiments restent différés.

L'eau utilisée par les étapes urbaines reste celle du raster de settlements,
jusqu'à 512². Un masque régional grossier ne restitue pas un petit canal par
lissage. Les contrôles de pente sont exacts sur la surface interpolée transmise,
pas sur un relief inconnu plus fin.

Les réserves et fonds non desservis peuvent rester importants dans les terrains
contraints et certains tissus. Les diagnostics les montrent sans leur attribuer
une capacité de logement fictive. Les densités sont des budgets de planification,
pas une mesure de logements construits.
