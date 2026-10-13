# Quartiers et parcelles dans Terrain Bench

## Refonte du 13 octobre 2026

Les nouveaux plans utilisent une empreinte native indépendante du tissu de rues.
**Empreinte et croissance** propose douze familles et quatre mécanismes :
fondation planifiée, croissance par accessibilité, accrétion sur réseau et fusion
de noyaux. Le choix automatique évalue la culture, le relief et les accès ; une
surcharge manuelle conserve la priorité du mécanisme. Le budget démographique
est population / densité brute en habitants par hectare. Le budget artistique
utilise le rayon et son échelle. Le rayon n'agit pas en budget démographique.

`footprint.rs` utilise des gabarits vectoriels calibrés par aire pour les
fondations planifiées et des bandes pour les rubans explicitement imposés sur
terrain compatible. La croissance accessible, les noyaux organiques et les
rubans automatiques utilisent un champ d'arrivée anisotrope local borné à 192².
Le coût combine pente du sol, pente des trajets, accès et bruit spatial à plusieurs
échelles. Une enceinte culturelle ovale ne force plus une fondation circulaire ;
les fondations orthogonales automatiques demandent un site suffisamment plat et sec.
Les choix géométriques explicites restent disponibles. Les doigts
et les dendrites disposent de corridors différents. Toutes les composantes et
les exclusions d'eau sont conservées ; une emprise irréalisable expose son déficit.

Le layout exporte `structure` : réserve de croissance, terre attribuée, centres
de desserte, identités de quartiers, événements et budgets. Les secteurs de
calcul suivent l'armature partagée ; ils ne sont pas coupés artificiellement aux
frontières d'âge. Les recettes et les zones sont évaluées spatialement pendant
la subdivision ; chaque îlot conserve sa phase locale. La forme composite peut
associer un noyau organique à une extension en grille.

**Desserte adaptative** ajoute des accès locaux lorsqu'un îlot dépasse la
profondeur foncière de sa recette. Les tentatives sont bornées par îlot et à
96 accès par lieu. Le corridor doit rester dans la terre du parent, éviter
l'eau et les îlots voisins et respecter la pente. Le tissu **Groupes autour d'un
commun** crée de vraies cours collectives à cette étape. Refaire les parcelles
conserve ces accès, les communs et les rues.

Les parcelles proposent recettes culturelles, bandes, subdivision orientée,
territoires de façade en concurrence, domaines, îlots entiers et jardins. La
concurrence utilise des plans de distance orientés depuis les façades ; ce n'est
pas un squelette droit CGAL. Les accès publics, collectifs et privés sont
identifiés contre le réseau final. Les diagnostics contrôlent couverture et
chevauchement par union géométrique, en plus des sommes d'aires.

Les couches **Réserve**, **Terre attribuée**, **Noyaux et identités**, **Desserte**
et **Phases de croissance** ne relancent pas le moteur. L'occupation rurale et
la substitution du réseau régional utilisent la terre attribuée. Les anciens
liens sans `footprint` restent en mode **Historique** ; seuls les paramètres
appliqués sont partagés.

Corpus natif : `cargo run --release -p magna-urbis-core --example urban_refonte --
--repeat --out out/urban-refonte.json`. Les options `--case`, `--population`,
`--seed` et `--geometry` permettent une reproduction et des mesures à entrées
fixes. Navigateur : `node scripts/urban_refactor_ui_check.mjs
http://localhost:5173/urbanbench.html` depuis `web/`.
Pour comparer les empreintes sur plaine et vallée :
`node scripts/urban_natural_scenes_check.mjs`. Le replay du site signalé utilise
`node scripts/urban_natural_ui_check.mjs` et son décor local.

Voir [la note d'implémentation](../../../../../docs/REFONTE_URBAINE_IMPLEMENTATION_2026-10-13.md)
pour les validations et les limites. L'histoire reste une chronologie légère
des emprises et des fusions ; les maisons et une simulation économique complète
restent des étapes indépendantes. La précision d'eau dépend toujours du raster
fourni par le terrain, jusqu'à 512².

Le bloc **6 · Quartiers et îlots** puis le bloc **7 · Parcelles** utilisent
`crates/core/src/urban/` exclusivement en Rust/WASM. Le TypeScript transporte les
entrées, présente les contrôles et dessine les résultats. Ces structures sont un
contrat temporaire du banc, pas le modèle permanent du moteur.

La sélection propose **All**, puis tous les settlements par population
décroissante. Le plus grand est sélectionné au premier démarrage. Les graines
sont indépendantes par étape et par clé de settlement : sélectionner un lieu seul
ou dans All ne change pas ses tirages. Les quartiers utilisent le relief physique,
le masque d'eau/roche et les routes régionales déjà calculés. Le masque est celui
du raster de settlements, jusqu'à 512² : ses limites d'eau restent donc limitées
par cette résolution. Les paramètres de rivière et relief synthétiques de
l'ancien banc sont remplacés par les blocs terrain et hydrologie.

Chaque étape possède sa culture, recette, zone, densité, préréglage, paramètres
natifs et surcharges JSON. Les recettes proviennent du catalogue TypeScript
résolu, porté comme données versionnées dans `urban/catalogue.json`. Leur
application, la densité, les surcharges et les opérations géométriques sont
natives. Le script `rust/scripts/export-urban-catalogue.ts` permet de renouveler
ces données : depuis la racine, `node web/node_modules/tsx/dist/cli.mjs
rust/scripts/export-urban-catalogue.ts`.

Le plan commence par les corridors régionaux et les terres sèches. Les axes
culturels sont ensuite routés, puis les quartiers subdivisés : rues organiques,
grilles, terrasses, impasses/closes/hutong/roji. Les dispositions rectangle,
oblique et avec encoche restent disponibles comme scènes de travail. Le
catalogue contient 53 cultures et 326 préréglages ; ses profils conservent les
orientations, enceintes et logiques de croissance des documents culturels.

Les limites de pente sont séparées : rues 12 %, ruelles 18 %, escaliers 65 %
par défaut. Ce sont des paramètres visuels du générateur, pas des normes de
construction. Chaque segment est contrôlé sur le relief bilinéaire, y compris
les crêtes entre ses extrémités. Les détours utilisent une recherche locale à
coût de pente et de virage ; seuls les franchissements régionaux existants
peuvent passer sur l'eau. Les escaliers sont explicitement identifiés et dessinés.
Les croisements sont des nœuds partagés ; les fragments isolés sont éliminés.

La fortification est indépendante du style de rues : culturelle, absente,
muraille ou palissade. Les portes suivent les traversées réelles. Les villes
ouvertes s'étendent davantage le long des approches, avec des cellules libres
entre les extensions et une progression cœur → périphérie des paramètres.
Ces cellules restent accessibles à l'occupation rurale. Les quais suivent les
rives sèches et rejoignent le réseau ; il ne s'agit pas encore d'un générateur
complet de bassins portuaires, de jetées ou de navigation. La réserve de monument
conserve un îlot libre ; elle ne construit aucun monument.

Parcelles : bandes de façade (burgage/machiya), découpage des cours/compounds,
raffinement siheyuan, jardins. Leurs axes, façades et fonds restent explicites.
Les booléens conservent les trous et les parcelles partitionnent leurs îlots.
Les places et réserves ne sont pas recoupées. Recalculer les parcelles conserve
les quartiers, îlots et rues. Les contrôles de rendu ne lancent aucun calcul.
Les liens conservent les paramètres appliqués, graines, sélection et rendu ; les
changements de paramètres non appliqués ne modifient pas le replay.

Un index spatial accélère la recherche des façades sans changer leur sélection.
Les parcelles résidentielles profondes sont bornées par leur profondeur
culturelle ; les fonds inaccessibles restent des jardins, même dans un grand
îlot que le relief empêche de subdiviser. Un îlot sans façade conservée ne
produit pas de parcelles résidentielles accessibles fictives.

Le worker conserve son terrain Rust entre appels. Un navigateur qui refuse le
worker utilise les mêmes appels WASM sur la page. Une modification du terrain,
des settlements ou des routes invalide les quartiers qui en dépendent. Les
réponses obsolètes ne remplacent pas la génération courante.

Vérification depuis `rust/` : `cargo test -p magna-urbis-core urban --lib`,
`cargo clippy -p magna-urbis-core -p magna-urbis-wasm --all-targets -- -D warnings`,
`cargo check -p magna-urbis-core -p magna-urbis-wasm --target wasm32-unknown-unknown`.
Depuis `web/` : `npm run typecheck`, `npm run build`, `npm run build:terrain`.
Le contrôle navigateur partagé s'exécute depuis `web/` avec
`node scripts/urban_workshop_ui_check.mjs http://localhost:5173/urbanbench.html chemin/vers/carte.decor`.
Il vérifie les scènes isolées, le replay exact, l'import du plan et son retour
vers la carte. Une URL `file:///.../rust/out/browser/urbanbench.html` vérifie
le même parcours hors ligne, avec `testbench.html` dans le même dossier.
`node scripts/urban_composition_ui_check.mjs http://localhost:5173/urbanbench.html`
vérifie sur un carrefour plat figé le village groupé avec faubourgs, les phases
de ville, les enceintes, les réglages non appliqués et le replay exact. Les
captures et le fichier `.decor` sont écrits dans `web/out/urban-composition/`.

Lors de la validation du 13 octobre 2026, l'index de façades seul a été mesuré
sur six layouts figés : de 1,20× à 11,72× plus rapide, 4,72× sur la somme des
médianes, avec sorties identiques bit à bit. Ce résultat isole l'index avant
les changements de morphologie et de profondeur ; il ne mesure pas un gain
global sur des villes différentes. Les entrées figées, captures et mesures
de cette session sont dans `web/out/urban-audit-frozen/` (sorties locales ignorées).

## Urban Bench

Le mode par défaut est **Agglomération complète**. Le plan compose d’abord le
lieu à partir de sa population, de la culture et des accès : hameau,
village-rue, village groupé ou ville. Le noyau possède ses phases culturelles
(cœur, extensions et périphérie) ; les faubourgs occupent des rubans le long des
approches réellement raccordées. Les parts de population, densités, seuils de
phases, recettes de village et changements de recette des cultures qui deviennent
des villes proviennent du générateur TypeScript, via le catalogue versionné.
Les paramètres **Forme du lieu**, **Faubourgs** et **Phases du noyau** permettent
de comparer les compositions. Les enceintes restent autour du noyau.
**Retirer l’enceinte**, sur la carte comme dans l’atelier, recalcule immédiatement
le plan sans murs avec les graines et paramètres appliqués. Les autres réglages
en attente restent des brouillons. Le choix **Sans enceinte** du menu peut aussi
être appliqué avec la génération des quartiers ; masquer le rendu des enceintes
ne change, lui, aucune géométrie.

Les quartiers et îlots héritent de leur phase ; **Recettes · Par phase** transmet
cette recette aux rues et aux parcelles. Une recette ou un préréglage explicite
permet de forcer une morphologie commune. La palette **Phases de croissance** et
le tableau de composition distinguent le noyau et les faubourgs, avec population
prévue et surface sèche obtenue. La population est un budget de composition, pas
une capacité mesurée de logements (les maisons restent une étape indépendante).
Le rayon fourni est une emprise indicative répartie entre les phases ; les
faubourgs peuvent s’étendre au-delà. **Centrer** englobe le plan réalisé.

**Secteur isolé · ancien banc** conserve les scènes d’une seule recette,
rectangles, dispositions obliques et encoches. L’atelier utilise ce mode pour ses
scènes isolées, et conserve la composition du plan importé depuis la carte.
Les anciens liens sans champ `composition` s’ouvrent dans le mode isolé afin
de conserver leur replay ; un nouveau lien inclut tous les réglages appliqués.

Cette étape rétablit la composition d’agglomération pour évaluer quartiers et
îlots dans leur contexte. Le routage local et les subdivisions restent les
opérateurs natifs existants ; elle n’ajoute ni maisons ni générateur de monuments.

`web/src/ui/urbanbench.html` (`http://localhost:5173/urbanbench.html` with
`npm run dev:terrain`) prototype les mêmes blocs 6 et 7 sans la chaîne
terrain → eaux → settlements → routes. Il charge des **décors** : le raster
exact transmis à Rust par Terrain Bench, les settlements, les routes et l'eau
vectorielle d'une carte, au format `.decor` (`web/src/ui/decor.ts`).

- Exporter la carte courante : bouton **Export decor** du bloc Settlements.
- Exporter un lot varié (relief, côtes, rivières, routes, tailles, cultures) :
  `node scripts/export_decors.mjs [--count 100] [--force]` depuis `web/`, serveur
  de développement lancé. Les fichiers vont dans `web/decors/` (ignoré par git)
  avec `index.json` ; `--index` reconstruit l'index après suppression manuelle.
- Graine de ville : un lieu du décor (mêmes routes, même graine, mêmes quartiers
  que Terrain Bench) ou une graine libre posée sur la carte (P), avec population,
  culture et rayon. Les routes régionales peuvent être recalculées avec la graine.
- Le bench construit hors ligne (`npm run build:terrain`) ouvre ou reçoit par
  glisser-déposer des fichiers `.decor`.
- **Atelier quartiers / parcelles** ouvre l'éditeur historique avec les mêmes
  appels Rust que la carte. Il permet des scènes isolées, des formes de parcelles
  de référence et l'import du plan exact affiché sur la carte. Refaire les
  parcelles conserve les îlots ; **Appliquer les réglages à la carte** transmet
  les paramètres. Le lien mémorise les deux espaces. L'atelier seul s'ouvre par
  `urbanbench.html?space=workshop` ; `testbench.html?engine=rust` y redirige.
  Le testbench TypeScript original reste indépendant de Rust.
- **8 · Occupation du territoire** reprend `gen/landuse/rural.ts` et le rendu
  Canvas 2D de l'application TypeScript : champs et sillons, haies, chemins agricoles,
  vergers, jardins, prairies, bois et marais. Le terrain, les niveaux d'eau et les
  routes du décor alimentent un adaptateur temporaire (`ui/urbanLanduseData.ts`).
  Les quartiers réservent leur emprise exacte même sans maisons ; les autres
  lieux du décor conservent leurs réserves projetées. Les bâtiments agricoles
  attendent eux aussi l'intégration des maisons.
  Le calcul s'exécute dans un Worker avec repli local. Déplacer la ville ou
  régénérer ses quartiers recalcule les paysages ; modifier les parcelles,
  le style, les textures ou l'opacité conserve leur géométrie. Biome, graine et
  affichage sont enregistrés dans le lien. Le bouton **Occupation** masque la
  couche. La case **Générer l’occupation du territoire** du bloc 8 désactive
  aussi les calculs, y compris ceux en cours ; son état est conservé dans le lien.
  Le rendu Rust et le modèle urbain natif ne sont pas modifiés.

  Le Canvas suit la caméra SVG, avec les niveaux de détail et les caches du
  moteur TypeScript. Le relief conservé sert de fond pour le mélange des teintes.
  **Feuillages et canopée** remplace les ronds par des couronnes irrégulières,
  ombrées et jointives en forêt, alignées en verger ; **Symboles classiques**
  permet la comparaison. Les textures peintes restent disponibles. Les motifs
  de feuillage sont vectoriels, déterministes et partagés avec l'export SVG.
  Les arbres sont placés individuellement avec un espacement minimal et des
  nuances discrètes, sans tuile répétée. Leur centre appartient à la zone boisée ;
  leur couronne reste entière et peut dépasser du contour. Les vergers gardent
  leurs rangées. Les sillons utilisent l'échelle du preset TypeScript de la ville,
  indépendamment de la largeur du décor chargé.

Les tracés régionaux sont conservés à l'extérieur des quartiers et remplacés
par le graphe natif à l'intérieur, pour l'affichage comme pour les coûts ruraux.
Une approche physiquement impraticable donne un avertissement explicite.

Références de méthode : Galin et al., *Procedural Generation of Roads* (2010),
https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf ; Chen et al.,
*Interactive Procedural Street Modeling* (2008),
https://peterwonka.net/Publications/pdfs/2008.SG.Chen.InteractiveProceduralStreetModeling.pdf.
Le solveur reste une approximation locale bornée pour la génération interactive.


## Influences, sorties et adaptation au site

Le bloc 6 propose une seconde culture, sa part de surface et deux répartitions :
`mixMode=phases` attribue les extensions les plus récentes à cette influence ;
`mixMode=sectors` partage les terres par un axe orientable (`mixAngle`). Les
parts restent disjointes et conservent les budgets de population. Chaque phase
porte sa culture et sa recette, reprises par les rues et les parcelles en mode
« Par phase ». Les recettes, tissus ou opérateurs explicitement forcés gardent
leur priorité. Les axes partagés traversent les limites culturelles.

`exitTreatment=adaptive` traite les extrémités périphériques avant le découpage
parcellaire : raccordement à un axe régional proche, sections circumférentielles,
quelques chemins ruraux plus étroits, ou retrait dans l’îlot pour fermer l’accès
par du terrain parcellaire. `closed` conserve seulement les impasses et les
approches régionales existantes. `peripheralRoad` sélectionne aucun périphérique,
un choix automatique, des sections partielles ou un circuit complet lorsque
les pentes et l’eau le permettent. Chaque section relie deux accès réels ; un
obstacle laisse une interruption plutôt qu’un franchissement inventé. Une
enceinte conserve le traitement par murs et portes.

`siteAdaptation` (0–2, défaut 1) renforce le suivi local des courbes de niveau et
des berges, y compris pour les grilles. Les axes générés sur pente comparent
les détours au trajet direct même lorsque celui-ci respecte la pente maximale ;
la simplification conserve le bénéfice du détour. Les routes régionales et les
ponts importés gardent leurs tracés. Les anciens liens du mode Historique sans ces champs gardent
leur comportement antérieur ; les plans modernes reçoivent les nouveaux défauts.

Validation ciblée : `cargo test -p magna-urbis-core urban --lib`, contrôles
Clippy/WASM habituels, et depuis `web/` :
`node scripts/urban_influences_ui_check.mjs` (plaine), puis
`node scripts/urban_influences_ui_check.mjs http://127.0.0.1:5173/urbanbench.html --terrain`
(versant et rivière). Ces contrôles vérifient aussi les brouillons non appliqués
et le replay exact. Les captures restent dans `web/out/urban-influences*/`.

`axisAlignment=regional` (nouveau défaut) aligne la fondation, les grands axes
et le champ local des rues sur la tangente des principales routes régionales
entrantes. Le rang, la largeur et la proximité donnent priorité aux axes majeurs
sur les pistes ; les guides artificiels d’empreinte ne pilotent pas cette
sélection. Le relief et les berges adaptent ensuite cet alignement. Le choix
`culture` et les surcharges explicites d’orientation conservent leur priorité.
Le contrôle navigateur accepte aussi `--aligned` pour un axe principal à 27°.


Le panneau garde visibles la forme, la croissance, le maillage et l’accessibilité.
La régénération est placée en haut ; graines, recettes, diagnostics et réglages
fins restent dans des sections repliées. Les brouillons conservent leur portée.

Les routes régionales traversant le noyau sont l’ossature du lieu : les axes
culturels ne doublent plus ces branches et ne prolongent que les directions
manquantes, avec leur tangente et leur largeur. La croissance accessible favorise
les rives sèches selon les affinités culturelles ; l’accrétion décale son budget
foncier du côté de l’eau sans déplacer les routes ni construire sur l’eau.

Les raccords de largeur sont traités avant de réserver les rues dans les îlots.
Le dessin utilise les mêmes rubans effilés que Rust. Les chemins périphériques
bordent désormais la terre attribuée et réutilisent les corridors parallèles
proches. Une voie au pied de l’enceinte intérieure apparaît fréquemment ; les
autres tirages permettent aux parcelles d’atteindre le mur. Les terrains ou les
pentes impraticables interrompent cette voie, sans franchissement inventé.
Le cas Swahili signalé est vérifié par `node scripts/urban_junctions_ui_check.mjs`.

La croissance planifiée n’est plus proposée dans le panneau ; ses anciens liens
reviennent au mode automatique. Les formes explicites carrées, rectangulaires,
polygonales et circulaires restent disponibles. Une enceinte culturelle carrée
conserve sa fondation droite ; une ville ouverte retrouve sa croissance naturelle.

Les villes ouvertes peuvent ajouter de petites bandes de parcelles au-delà de
certains tronçons du périphérique, directement desservies par celui-ci, sans
nouvelles rues sortantes. Leur surface supplémentaire reste limitée à 8 % de
l’emprise initiale ; les budgets de population et les parts culturelles sont
conservés. Jusqu’à trois liaisons locales cherchent un axe régional à moins de
360 m, avec une largeur réduite au milieu et des transitions aux raccords.

Les deux bancs transmettent les mêmes contours vectoriels de terre et d’eau au
moteur urbain. Les nouveaux décors conservent ces contours et un relief jusqu’à
1024² ; les anciens reconstruisent la côte depuis leurs altitudes signées et
réutilisent leur eau vectorielle sauvegardée. Cela supprime les découpes par
cellules, sans inventer les détails absents des anciens exports. Les rubans de
rues se remplissent en `nonzero` pour éviter les trous aux raccords superposés.
