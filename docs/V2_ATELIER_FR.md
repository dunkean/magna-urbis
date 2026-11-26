# Atelier Magna Urbis V2

La V2 est une entrée indépendante, `web/src/ui/v2.html`. Elle réutilise les
cœurs existants avec une nouvelle interface bilingue : carte centrale,
verre sombre, laiton, iconographie peinte et réglages progressifs.

L’anglais est la langue par défaut de l’application et de l’atlas. Le sélecteur
**English / Français** change la langue de l’application sur place, sans
régénérer la carte, déplacer la vue ou perdre les réglages. Le choix est mémorisé
et partagé avec l’atlas ; `?lang=en` ou `?lang=fr` permet de le choisir explicitement.
L’atlas fournit deux pages complètes, `scientific/index.html` en anglais et
`scientific/fr.html` en français, également lisibles hors ligne sans JavaScript.

## Lancer, construire et distribuer

Depuis `web/` :

```sh
npm ci
npm run prepare:v2       # Première préparation Rust/WASM; nécessite wasm-pack
npm run dev:v2           # http://127.0.0.1:5174/v2.html
npm run dev:v2:local     # Services Rust natif et Python optionnel
npm run build:v2         # Distribution web/dist-v2
npm run app:v2:dev
npm run app:v2:build
```

Les prérequis, modèles facultatifs, variables Python et paquets installables
sont documentés dans [le guide de distribution](../rust/desktop-v2/README.md).
Le contenu de `web/dist-v2` se sert sous un sous-dossier GitHub Pages, par
exemple `/magna-urbis/v2/`. Les assets, workers et liens scientifiques sont
relatifs. Construire cette distribution ne publie aucun fichier distant.

Les installateurs Windows MSI et NSIS sont produits dans
`rust/desktop-v2/target/release/bundle/`. Le moteur Rust est embarqué. Python,
CUDA et les poids locaux restent des dépendances externes configurables.
Les modèles du navigateur sont copiés depuis `rust/pkg/neural-web` lorsqu’ils
ont été préparés ; leur absence ne doit pas être confondue avec un modèle
déjà chargé.

## La chaîne d’étapes (interface)

Le panneau de gauche présente toute la chaîne de génération en cinq familles
peintes : **Relief → Eau & couvert → Peuplements → Ville → Affichage**. Les
lignes viennent d’une source unique, `web/src/v2/stageRegistry.ts`, qui reprend
exactement les identifiants de [`stage-registry-contract.md`](stage-registry-contract.md).
Chaque ligne d’étape offre, sur une seule ligne :

- le **nœud** sur le fil de laiton : un clic active ou désactive l’étape
  (losange = étape obligatoire ; pointillé = pas d’interrupteur moteur, raison en info-bulle) ;
- **▶** : régénère depuis cette étape (relief et eau : la topographie ; sites,
  hiérarchie : les implantations ; routes : les routes seules ; ville : l’arrêt
  Rust correspondant du lieu choisi ; affichage : le rendu) ;
- la **durée** de la dernière exécution (verte = à jour, ambre = réglages modifiés
  depuis ; vide = calculé à l’intérieur d’une étape voisine, sans temps inventé) ;
- **?** : la section `#stage-<id>` de l’atlas scientifique, dans la langue de l’application ;
- le chevron : toutes les options. Les réglages principaux restent accessibles
  sur la ligne repliée.

Les lignes sont conditionnelles : procédural, neuronal et heightmap n’ont pas les
mêmes étapes. Importer une heightmap ou choisir une carte de la **bibliothèque de
test** (six PNG 16 bits générés par notre moteur, `web/src/v2/assets/heightmaps/`,
reconstruits par `node web/scripts/v2_heightmap_library.mjs`) est une alternative
de la **source du relief** ; l’étape **Ajustement de la heightmap** règle échelle
verticale, datum, recadrage et largeur sans perdre la source.

Aucun contrôle n’a été recréé : les formulaires existants (terrain, région,
recettes urbaines City Bench, apparence) sont déplacés dans l’étape qui les
exécute ; un test (`web/tests/v2StageRegistry.test.ts`) vérifie que chaque
contrôle appartient à exactement une étape. Les adresses des modèles et services
sont dans **Réglages**, avec l’état des moteurs : WASM (un thread, threads,
pool, selon l’isolation cross-origin), WebGPU, Rust natif, Python neuronal et
chemin de rendu GPU/CPU. Un choix indisponible reste visible, désactivé, avec sa
raison. Pour les villes, la génération est à gauche et le **choix du lieu** à
droite (liste et réglages locaux). Les icônes sont générées par ImageGen
(`web/src/v2/assets/icons/PROVENANCE.md`).

## Le parcours

**Créer ma région** génère uniquement le relief, l’eau et le couvert naturel.
Les implantations et villes viennent ensuite :

1. **Topographie** : relief, drainage, rivières, lacs, rivages et couvert naturel.
   Les nouvelles régions démarrent à 6 km de côté, avec une échelle procédurale
   de 10 km et l’hydrologie vectorielle. Largeur et échelle sont indépendantes.
   L’étendue automatique reste facultative ; le neuronal produit une source de 40 km.
2. **Peuplements — implanter et relier** : choix des sites, réserves urbaines,
   hiérarchie des lieux et routes régionales. Aucun bâtiment n’est créé ici.
3. **Construire les lieux** : tous les lieux ou un seul lieu sélectionné.

La première ouverture reste vide : réglez d’abord la largeur libre, les côtes
combinables (huit directions), puis le moteur et la source. Rust est proposé
par défaut ; l’édition installable utilise directement son service Rust natif.
Sa plage réelle est de 500 m à 100 km ; le moteur classique
TypeScript conserve sa plage de 600 m à 40 km. Les panneaux détaillent les
familles de relief, le climat, les modèles neuronaux, les paramètres de
diffusion, l’érosion, le raffinement fractal, l’hydrologie et la forêt.
Les zones peuvent être peintes avant toute génération ; l’éditeur accepte
et exporte aussi les heightmaps PNG 16 bits et les instructions de zones JSON.

Les implantations Rust disposent des compositions automatique, par classes
et par liste explicite, avec positions, préférences de site et critères de
classement. Les routes ont leur propre profil, revêtement et coûts de
parcours. **Recalculer les routes sans déplacer les lieux** réutilise les
sites retenus ; une modification de leur recette exige de refaire les
implantations. Les champs et réseaux hydrologiques Rust sont conservés
avec le relief, sans drainage TypeScript supplémentaire.

Le terrain existant garde son étendue quand on ajuste ensuite la population
ou le nombre de lieux. Un changement de relief, de graine du monde ou de
paramètre hydrographique demande de recréer la topographie. Les changements
qui déplacent les sites demandent de recalculer implantations et routes.

Le moteur urbain Rust propose quatre arrêts réels :

| Arrêt | Produits visibles | Réglages |
| --- | --- | --- |
| Plan | Emprise, phases, quartiers, rues, îlots | Trame, densité, croissance, défenses, relief, fonctions |
| Parcelles | Découpage cadastral et accès | Opérateurs, zones, formes et éditions de lots |
| Programme | Affectations, besoins et capacités | Fonctions, ressources, contexte et états du peuplement |
| Maisons | Domaines constructibles et plans architecturaux | Recettes, matériaux, étages, richesse, variation et contraintes |

Le moteur TypeScript classique génère son plan urbain complet en une opération.
Ses étapes internes ne sont pas présentées comme des arrêts Rust.

## Du réglage global à la maison

Le panneau principal définit les valeurs communes. L’inspecteur d’un lieu
permet de remplacer ces valeurs localement. Les formulaires structurés
reprennent les contrats `LayoutConfig`, `ParcelConfig`, les catalogues
morphologiques, `PlacementBatchSettings` et `HouseConfig`, avec héritage et
retour au défaut par champ. Les recettes JSON restent accessibles pour
inspection et échange.

Activez **Inspecter**, choisissez le niveau, puis cliquez sur la carte :

- Un **quartier Rust** accepte culture, trame, densité, richesse, forme, rôle,
  suppression ou graine locale (`salt`).
- Une **parcelle Rust** accepte fonction, ménages, forme, fusion/jardin ou
  graine locale.
- Une **maison** accepte des éditions de représentation et d’emprise. Une
  maison Rust expose aussi sa vraie configuration `HouseConfig` et une
  régénération native, liée à l’identifiant de sa demande.

Les configurations individuelles de maisons utilisent la clé
`settlementKey/nativeRequestId` pour éviter les collisions entre villes.
Les contraintes d’une recette restent actives : demander quatre étages à une
recette qui en autorise trois produit un refus explicite. Le rapport du moteur
montre les raisons et permet de corriger la configuration puis de réessayer.

L’inspection propose aussi des actions directes : **Nouvelle variation**,
**Supprimer**, **Modifier le contour** et le choix du rôle, de la culture et de
la trame d’un quartier. Le contour se modifie sur la carte : glisser un sommet,
cliquer un bord pour en ajouter un, puis **Valider**. Les zones supprimées sont
restaurables depuis l’inspecteur du lieu. Une maison native dispose d’un tirage
individuel et du catalogue architectural.

**Carte → Noms et étiquettes**, également accessible en haut de la carte,
permet de rechercher les noms existants, nommer quartiers, parcelles et maisons,
ou créer une étiquette libre. Le texte, la couleur, la taille, le gras, l’italique
et les coordonnées sont modifiables. **Sélectionner sur la carte** choisit un
élément ; **Placer sur la carte** fixe sa nouvelle position. Les étiquettes sont
conservées dans le projet et la recette, et suivent les exports visuels.

**Région → Supprimer une rivière** sélectionne un cours d’eau et prévisualise
tous les affluents et bras qui disparaîtront avec lui. Le relief est conservé.
Dans **Peuplements → Routes régionales**, les outils permettent de tracer,
déplacer et supprimer une route, ou modifier ses points, sa catégorie et sa
largeur. Ces retouches directes sont conservées dans le **projet complet** ;
une nouvelle génération du réseau les remplace. Les villes déjà construites
peuvent demander une reconstruction pour adapter leurs accès et leurs rives.

Le sélecteur de rendu propose les vingt styles existants : neuf palettes V1,
Render Neural Earth, Render3D Multiscale et Brush, satellite Render v2 et ses
quatre vues de matériaux, Fantasy encre et aquarelle, altitude DEM. Les réglages
de rendu ajoutent saison, lumière, couches, textures naturelles peintes et canopée.

Le moteur Terrain / City Bench reprend les données natives conservées : cinq
vues urbaines, cinq palettes de ville, silhouettes ou toits cartographiques et
géométriques, diagnostics usages/hauteur/desserte, matériaux et ombres par volume.
La carte classique V1 reste sélectionnable. Aucun changement d’apparence ne
recalcule le relief, les implantations ou les maisons.

Le bouton **3D** reprend le terrain et les scènes architecturales de City Bench,
avec les matériaux de terrain, saison, lumière, canopée, eau physique, textures,
couleurs, exagération et capture PNG. Sur WebGL logiciel, le même matériau est
calculé en texture puis drapé sur la géométrie, avec une indication explicite.
Les ombres portées des maisons sont celles du rendu natif 2D ; le moteur partagé
3D ne fournit pas de nouvelles shadow maps de bâtiments.

Les inventaires de correspondance avec les bancs sont dans
[la matrice terrain](design/v2-terrain-controls.md) et
[la matrice urbaine](archive/studies/V2_URBAN_PARITY.md).
La revue d’optimisation (historical validation, archived locally) détaille les copies supprimées,
les caches, le rendu, les mesures avant/après et les vérifications d’identité
des résultats.

Les commandes **Modifier les routes** et **Tracer une route** sont accessibles
dans l’onglet **Éditeur**. En modification, un clic sur la ligne sélectionne
la route entière, ou le point de contrôle sous le clic. Double-cliquer un point
sélectionne la ligne ; double-cliquer la ligne ajoute un point immédiatement
sélectionné, sans modifier le trajet existant. Un appui de 500 ms sur une ligne
déjà sélectionnée sélectionne le segment entre deux points de contrôle. Glisser
la ligne déplace la route, glisser un point recalcule son trajet. Les attaches aux villes et aux autres routes restent
fixes lors du déplacement global ; déplacer un carrefour recalcule ensemble
ses branches incidentes. Les raccordements aux villes restent fixes.

Le bouton **Ajouter une étape** permet aussi de choisir un emplacement sur la
ligne. Déplacer un segment déplace ses deux points et conserve les raccordements
incidents ; **Suppr** retire la sélection (point, segment ou ligne). Les accès aux fermes et les chemins agricoles
sont sélectionnables et modifiables comme les autres routes. Autour du point
sélectionné, **moins** retire la contrainte de passage et recalcule le trajet
entre ses voisins. Les **ciseaux** créent une interruption visible :
un clic crée deux lignes et deux extrémités indépendantes, séparées d’un petit
espace physique stable au changement de zoom. Les contrôles
sont distincts des sommets du chemin calculé, restent stables au changement de
zoom et sont conservés avec le projet complet.

Les contrôles automatiques ne reprennent pas chaque coude calculé : une route
existante commence avec ses deux extrémités et une poignée centrale. Au lâcher,
le moteur recherche à nouveau le chemin sur le relief ; les virages résultants
ne deviennent pas des contraintes de passage. L’aperçu pendant le déplacement
utilise aussi ce routage.

Le dé **Autre trajet** est disponible pendant la création (après deux points)
et sur une route sélectionnée. Il conserve les points et les raccordements,
mais explore une autre graine et un autre compromis de coût de pente, sans
relâcher la pente maximale ni les règles de franchissement. Si la recherche
retrouve le même passage praticable, l’éditeur l’indique.

**Tracer une route** pose une suite de points de passage : le moteur Rust
calcule les liaisons successives avec les réglages régionaux de pente, de
franchissement et de culture, pour la catégorie de route choisie. L’aperçu suit
le curseur. **Échap**, **Entrée** ou **Terminer la route** valide le brouillon ;
**Annuler** l’abandonne. Un premier clic hors carte crée une entrée sur le bord
le plus proche. Un clic hors carte après le départ ajoute une entrée et termine
la route. Une route traversante peut donc avoir deux entrées.

Les entrées régionales sont des losanges contraints au bord. Leur suppression
demande confirmation et retire leur branche exclusive en conservant les tronçons
partagés. Le composant **Routes régionales** actualise ses résultats et le nombre
demandé de la catégorie concernée. Une liaison coupée est signalée comme non
raccordée. **Annuler/Rétablir** restaure à la fois la carte et ces nombres
(Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z ou Ctrl+Y).

Les recalculs s’exécutent dans un worker. Un échec conserve la carte valide
précédente ; Échap pendant un calcul l’interrompt. Les modifications restent
enregistrées dans le projet, mais une régénération régionale les remplace.
L’utilisation des routes existantes comme réseau de partage pendant la recherche
de chemin n’est pas exposée par l’API actuelle ; leurs raccordements sont conservés.

Après une modification, les dégagements de forêt suivent le nouveau tracé,
y compris hors des zones cultivées ; le dégagement abandonné disparaît.
Le gros bouton **Terminer l’édition**, placé au-dessus de la minimap, reste visible
avec le nombre d’actions et le retour de la dernière opération, jusqu’à validation
ou **Annuler l’édition des routes**. Les déplacements,
ajouts et suppressions restent visibles pendant les ajustements ; les localités
attendent la validation. Échap termine un tracé, sans valider toute la session.

À la validation, les changements sont comparés à l’état initial. Un seul dialogue
regroupe les hameaux, villages et lieux plus grands réellement touchés et propose
**Adapter seulement les accès** ou **Reconstruire les îlots touchés** (parcelles
et bâtiments). Les rues modifiées restent prioritaires et sont sauvegardées ;
une régénération ultérieure les réapplique. Seuls les îlots traversés par l’ancien
ou le nouveau passage sont redécoupés ; les autres îlots, quartiers et bâtiments
restent conservés. **Continuer l’édition des routes** revient aux ajustements sans
appliquer ce choix. Les fermes et bâtiments isolés concernés sont mis à jour
directement, à la validation. Une modification éloignée d’une localité ne
déclenche pas de question. Annuler restaure la carte et les entrées régionales
du début de session ; Ctrl+Z annule chaque action, suppression comprise, même
après fermeture de l’outil. Annuler la validation rouvre le brouillon ; les gestes
précédents restent ensuite annulables individuellement.

Les rues internes et accès urbains sont sélectionnables dans le même éditeur,
y compris les petites voies qui dépassent de la ville. Le panneau indique leur
localité. Déplacer une jonction conserve les rues incidentes ; supprimer ou couper
une rue permet un nettoyage manuel. Un tracé créé entièrement dans une localité
devient une rue de cette localité.

La répartition de population ne plafonne plus les villages à 999 habitants.
Les effectifs choisis sont conservés ; la désignation démographique affichée
peut évoluer avec le nombre d’habitants.

Les outils **Quartier**, **Îlot** et **Parcelle** appliquent les mêmes gestes
aux contours extérieurs : clic pour sélectionner, double-clic sur un bord pour
ajouter un point, double-clic sur un point pour sélectionner le contour entier,
appui long pour sélectionner un segment. Déplacer ce segment déplace ses deux
sommets. **Suppr** retire la sélection ; retirer un point retend le contour.
Les ciseaux d’un point demandent un second point du bord extérieur et créent
deux surfaces fermées. Une coupe traversant une cour intérieure est refusée.
Les dépendances urbaines sont recalculées au lâcher ; les rues, le relief,
la campagne et les autres localités sont conservés. Les limites admissibles
restent celles du moteur (voisins, rues et surfaces réservées).
**Ctrl+Z** restaure le contour et ses dépendances, y compris après
**Terminer l’édition**. Le projet enregistre les contrôles et les scissions.

La liste des implantations répertorie aussi les **Fermes isolées** issues de
l’occupation des sols, avec leur catégorie (ferme ou écart agricole), le nombre
de foyers, la localité proche et leur raccordement au réseau. Ces foyers sont
déjà compris dans la population des localités : leur affichage n’ajoute pas
d’habitants. Leurs accès sont calculés sur le terrain, contournent les obstacles
et peuvent rejoindre un accès agricole existant. Une ferme sans parcours
praticable est indiquée **sans chemin**. Après une édition du réseau, cet
indicateur est actualisé ; les accès eux-mêmes sont recalculés à la prochaine
génération de l’occupation des sols.

Le rendu **Topographique** est une vue de travail simplifiée : fond uni, courbes
de niveau, limites et bandes des champs, rivières, routes et villes. Il conserve les données de
land use dans le projet mais n’en affiche ni les aplats ni la végétation.

## Moteurs, activité et matériel

Le CPU procédural fonctionne dans les deux éditions. Le relief Rust peut
utiliser WASM/CPU, WebGPU ou le service natif. Les moteurs neuronaux existants
utilisent WebGPU dans le navigateur ou Python/CUDA localement ; ils n’offrent
pas actuellement d’inférence CPU.

**Moteurs & activité** montre les capacités détectées et le journal des
opérations. Une détection WebGPU n’est pas une preuve d’utilisation du GPU :
le journal et les statistiques du monde enregistrent le backend effectif.
Le GPU forcé ne doit pas se rabattre silencieusement sur le CPU. Le choix
automatique peut reprendre un relief procédural sur CPU en signalant ce repli.

La barre d’activité couvre chargement des modèles, calcul, cache et dessin de
la carte. Les workers de génération et de rendu sont distincts. Le rendu
utilise les niveaux de détail et les caches de tuiles existants.

## Sauvegarder, composer et exporter

**Projet complet** conserve les grilles numériques exactes, la carte de base,
les paramètres, les instantanés natifs et les modifications. Les tableaux typés
FP32/Int32 et les coûts infinis sont reconstruits au réimport.

**Graines + paramètres + modifications** conserve la recette sans la carte.
La reproduction demande les mêmes versions de moteurs, catalogues, modèles
et backends. Des différences numériques entre appareils GPU restent possibles ;
le projet complet conserve les champs exacts du résultat.

**Graine seule** contient uniquement `format`, `version` et `seed`. Elle repart
des valeurs par défaut : elle ne prétend pas contenir vos réglages personnalisés.

Les importations permettent de choisir :

- Le projet complet.
- Le territoire exact d’un projet, avec la recette actuelle des villes.
- La recette des villes d’un projet, sur le territoire courant.

Les compositions suppriment les anciennes géométries urbaines avant de les
reconstruire dans leur nouveau contexte. Elles conservent les altitudes et
l’hydrologie du territoire retenu et alimentent son cache persistant.
Si le fichier contient un brouillon de paramètres différent de la carte
sauvegardée, les altitudes exactes du résultat deviennent une entrée FP32
portable, plutôt que de relancer un modèle différent.

Les exports **SVG et PNG** choisissent indépendamment style, éléments et zone
de recadrage. Leur création ne relance pas la génération. L’export
SVG des rendus Terrain / City Bench embarque l’image composée ; l’export
classique V1 garde ses objets vectoriels. Les rues et bâtiments restent
exportables indépendamment, avec transparence et respect des couches choisies.
L’export
**heightmap PNG** est quantifié sur 256 niveaux et accompagné d’un JSON
min/max ; le projet complet conserve les valeurs FP32. L’import d’image lit
des niveaux de gris, cadre au carré et permet de régler altitude et niveau marin.

## Cache et invalidation

Le relief et l’hydrologie ont une clé versionnée, indépendante du style et de
la culture des villes. Les pixels ou altitudes importés font partie de cette
clé. Un cache mémoire LRU garde deux terrains ; IndexedDB garde les trois
terrains les plus récents. Une indisponibilité du stockage laisse le cache
mémoire utilisable.

Les instantanés urbains Rust gardent séparément les clés du plan, du cadastre,
du programme, des domaines constructibles et des maisons. Une modification
individuelle de maison réutilise ses étapes amont et conserve les occupations
voisines. Le journal natif permet d’auditer le nombre de demandes recalculées.

## Vérifications reproductibles

```sh
npm run typecheck
npm run test:v2
npm run test:v2:browser
npm run test:v2:urban
npm run test:v2:urban-ui
npm run test:v2:platform
npm run test:v2:static
npm run test:v2:locales
node scripts/v2_compose_browser_check.mjs
```

Les contrôles navigateur demandent un serveur V2 actif ; `MAGNA_V2_URL`
permet de choisir son adresse. Le contrôle statique sert la distribution
construite sous `/magna-urbis/v2/`. Les modèles réels sont testables avec
`MAGNA_TEST_NEURAL=all` ; ce contrôle peut charger des poids et utiliser le GPU.

Les scripts écrivent leurs captures, résultats et recettes dans `web/out/` :
`v2-browser`, `v2-compose-browser`, `v2-rust-urban`, `v2-native-urban`,
`v2-platform-check.json`, `v2-static-check.json` et
`v2-desktop-startup.json`. Chaque preuve couvre son scénario et son matériel,
sans prétendre couvrir toutes les cultures et toutes les tailles possibles.

La [documentation scientifique illustrée](scientific/index.html) explique les
méthodes, leurs sources, leurs hypothèses et leurs limites. L’[iconographie
V2 et son prompt ImageGen](../web/src/v2/ASSETS.md) sont également documentés.
