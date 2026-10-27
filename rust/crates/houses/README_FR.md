# Moteur et banc de maisons

[English](README.md)

Le moteur Rust produit des maisons et des ensembles domestiques à partir du
catalogue architectural du projet. Il est indépendant du terrain, du navigateur
et du rendu. Le banc web utilise un adaptateur SVG temporaire ; son modèle n'est
pas imposé au moteur.

Le catalogue associe explicitement les recettes aux 32 packs et aux entrées des
[styles architecturaux](../../../docs/styles_architecturaux_mondiaux_city_mapper.md)
et du [catalogue des établissements](../../../docs/catalogue_settlements_antiquite_moyen_age_rpg.md).
`data/source-inventory.json` conserve leurs textes et empreintes ;
`data/recipes.json` vient du mapping `../../scripts/house-recipes.py`, sans
inférence de mots clés à l'exécution. Les compteurs de recettes et les statuts
de couverture décrivent ce catalogue, pas une preuve de génération pour toutes
les configurations. Une recette peut encore être rejetée par les contraintes
physiques ou les budgets du moteur ; le banc affiche cette erreur.

Ce checkpoint reste un prototype en cours de validation. Les accès publics
GreatHouse et Himalayan Compound et la QA finale native/WASM/navigateur après
leur correction restent à terminer. Les appentis médiévaux ont été vérifiés
dans les lots variés et le banc web. Certains ensembles
complexes dépassent le budget géométrique d'un lot ; ce refus est affiché
explicitement. Les correspondances fonctionnelles relient les usages du
catalogue compagnon aux morphotypes disponibles.

## Ouvrir le banc

Installer le toolchain de `rust/rust-toolchain.toml`, la cible
`wasm32-unknown-unknown`, `wasm-pack` et les dépendances npm de `web/`.
Depuis `web/` :

```sh
npm run dev:houses
# http://localhost:5173/housebench.html
npm run build:houses
# ../rust/out/houses/housebench.html
npm run check:houses
```

`dev:houses` compile le WASM puis surveille les sources des maisons.
`build:houses` produit une page autonome contenant le JavaScript et le WASM,
ouvrable hors ligne dans un navigateur moderne. Les paquets et sorties sont
ignorés dans `rust/pkg/houses/` et `rust/out/houses/`. Les commandes ordinaires
`npm run dev`, `npm run typecheck` et `npm run build` restent indépendantes de
Rust et du paquet généré.

## Générer et lire les maisons

Le banc démarre avec une graine `42` et un lot demandé de dix unités. Choisir un
pack, éventuellement une recette précise, puis **Générer les maisons**. Les
changements de réglages lancent une prévalidation native : elle indique les
recettes admissibles et une estimation des
budgets, sans promettre que toutes les étapes géométriques réussiront. En cas
d'erreur, le dernier lot réussi reste affiché ; ses réglages sont conservés pour
les exports.

La graine est une chaîne UTF-8. À version de moteur et de catalogue identique,
les mêmes réglages produisent la même scène. La taille ajuste les dimensions ;
la variation et la richesse modulent les plages propres aux recettes. La
richesse est un biais de composition, pas un modèle économique. L'orientation
tourne la scène dans le sens horaire ; les distances restent en mètres.

Les réglages avancés proposent trois modes : **historique strict**, **inspiré
historique** et **fantasy**. Le premier garde les dimensions et assemblages
autorisés par la source. Le second autorise une adaptation limitée. Fantasy
autorise des combinaisons plus libres, tout en conservant les contraintes de
géométrie, d'accès et de budget. Les filtres chronologiques **A**, **M** et
**Tous** suivent les périodes déclarées par chaque recette. **Autoriser les
variantes tardives (L)** est incompatible avec le mode strict ; une tradition
longue ne constitue pas une date universelle.

Avec une recette précise, **Variante** permet de choisir le bundle principal ou
une variante déclarée. Les autres options avancées imposent un plan, une
toiture, des matériaux, des étages, un nombre de corps, une cour, une pente ou
un débord. Une valeur vide utilise la recette ; **Enduit → Aucun** demande
explicitement une absence d'enduit. Les valeurs imposées peuvent
être rejetées si elles sortent de ses plages autorisées.

Une unité peut comprendre plusieurs corps principaux, annexes et galeries. Le
réglage **Corps** concerne les corps principaux : le total affiché peut être
plus élevé après ajout des annexes. Les niveaux disponibles viennent de la
scène Rust ; ils ne sont pas déduits du seul nombre d'étages demandé. Certains
corps n'occupent qu'une partie des niveaux de l'ensemble.

Les vues **Toitures** et **Plan** partagent une échelle métrique pour comparer les
cartes. Le choix d'un niveau affiche ses sols, pièces, murs, ouvertures et accès.
Le graphe et les dimensions sont des aides de lecture. Cliquer sur une carte
ouvre le détail, où l'on peut changer de vue, zoomer et déplacer le dessin.
Les arêtes de toiture viennent du maillage Rust ; l'interface ne régénère pas
la géométrie.

**Explorer le catalogue** présente les recettes, leur provenance et les statuts
de couverture des formes et fonctions. La **Tournée des packs** tente chaque
pack successivement avec les réglages généraux courants ; elle réinitialise la
recette et les options imposées. Son bilan distingue les succès et les erreurs
natives. Arrêter la tournée prend effet entre deux packs. Cliquer sur un succès
relance ce pack ; le tableau n'est pas un cache de toutes les scènes.

## Atelier libre

Le choix **Parcours → Atelier libre** ouvre des presets expérimentaux distincts
des traditions sourcées : vingt primitives de plan FP et vingt-deux systèmes
de toiture RF ont chacun un preset déclaré avec emprise et matériaux
compatibles. Leurs métadonnées annoncent une confiance `stylized`, sans
chronologie ou provenance culturelle attribuée. Leur présence au catalogue
ne garantit pas toutes les substitutions possibles.

Choisir un preset, puis **Générer les maisons**. La largeur et la profondeur
sont des dimensions absolues en mètres ; une valeur vide reprend celles du
preset. Le curseur Taille et les filtres historiques sont désactivés. Une
dimension trop étroite est refusée, sans agrandissement silencieux. Graine,
variation, richesse, orientation et nombre restent disponibles ; les dimensions
explicitement imposées restent fixes.

Les options avancées permettent de changer FP/RF, porteur de toiture, matériau
de base et supports. Poteaux, piles ou radeau exigent un matériau porteur et une
hauteur appropriée. Le nombre de corps s'applique aux primitives multicellules
et groupes ronds ; les autres primitives peuvent refuser cette substitution.
Les contraintes physiques restent actives. Les métriques, niveaux natifs et
exports fonctionnent comme pour l'Atlas. Le replay retrouve le parcours et le
preset ; un aller-retour conserve les réglages de l'Atlas. La tournée reste
limitée aux 32 traditions sourcées.

Dans l'Atlas, le choix **Plan** modifie la primitive là où l'organisation de la
recette l'autorise. Les ensembles à organisation fixe refusent une substitution
qui ne pourrait pas être appliquée ; l'atelier permet d'examiner la primitive
isolée sans utiliser une recette culturelle comme intermédiaire.

## Rejouer et exporter

**Lien** encode les réglages réussis et la vue dans l'URL. Le moteur signale une
version de générateur différente lors d'un replay. Une graine trop longue pour
le lien reste exportable en JSON ; l'interface désactive alors le lien et
affiche la limite. Le JSON contient la scène complète, ses réglages et les
versions du schéma, du générateur et du catalogue. Le banc ne propose pas
d'import de scène JSON ; pour la génération native, utiliser son objet
`settings` comme fichier de configuration.

**SVG** exporte la feuille ou le détail affiché, avec ses motifs et définitions
embarqués. Le fichier ne dépend pas d'images ou de polices distantes. Le JSON
conserve aussi les structures qui ne sont pas visibles dans la vue choisie.
Le build HTML autonome fonctionne sans serveur. La génération s'exécute dans
un Worker ; sans Worker, le banc signale un repli sur le thread principal et
limite les lots à dix unités.

## Sources et limites

Les recettes sont des interprétations paramétriques pour la cartographie RPG,
pas des relevés archéologiques ou des restitutions certifiées. Les dimensions,
distributions et règles d'assemblage comprennent des heuristiques explicites.
Le détail expose la provenance et la confiance disponibles ; les statuts du
catalogue et les erreurs de génération doivent être lus avec ces limites.
La compatibilité d'une recette ne prouve pas la couverture de chaque graine,
variante ou combinaison de réglages.

## Utilisation native et vérifications

Depuis `rust/` :

```sh
cargo run -p magna-urbis-houses --example houses -- --input fixtures/houses/config-reference.json
cargo run -p magna-urbis-houses --example houses -- --audit
cargo run -p magna-urbis-houses --example houses -- --audit-variants
cargo run -p magna-urbis-houses --example houses -- --audit-batches
python scripts/house-source.py --check
python scripts/house-recipes.py --check
```

L'exemple écrit la scène JSON sur stdout et une erreur sur stderr. Les audits
essaient respectivement les recettes, leurs variantes et des lots de dix ; un
échec donne un code de sortie non nul et un bilan JSON. Ils ne remplacent pas
une inspection visuelle. `npm run check:houses` vérifie le formatage, Clippy,
la compilation WASM, les tests natifs et le contrat TypeScript.

API native : `preflight(HouseConfig)` et `generate_batch(HouseConfig)` renvoient
un `Result`. Le schéma de scène est versionné (`schema_version: "2"`). Les
coordonnées locales sont en mètres, avec x vers la droite, y vers le bas et z
comme hauteur. Les dimensions et emprises initiales utilisent une grille au
millimètre ; les intersections dérivées et les jonctions de toiture conservent
leur précision pour partager exactement leurs arêtes.

### Implantation urbaine externe

`placement::admissibility_profiles()` expose les enveloppes des recettes sans
intérieurs. `placement::place_batch(PlacementBatchRequest)` reçoit cadastre,
domaine constructible, trous/réserves, droits de toiture, accès, voisinage,
culture/fonction, terrain physique et graines. Il renvoie des volumes et toits
natifs ou des refus inspectables ; les espaces ouverts restent libres.
`resolve_architecture` conserve les mêmes paramètres et `LayoutPlan` que le
générateur autonome. `placement::enrich_placement` détaille cette copie retenue
sans nouveaux tirages, ou refuse explicitement une incompatibilité.
Les volumes non domestiques portent leur fonction et ne revendiquent pas
d'intérieur domestique. Voir la [méthode et ses limites](../../../docs/methods/urban-architecture-placement.md)
et le [contrat TypeScript](../../bridge/urbanArchitecture.ts).

`data/urban-admission.json` est produit sans intérieurs par le chemin natif
minimal (plan, cour, clôture, toit et circulation) ; il distingue minima
constructibles et refus. Depuis `rust/`, régénérer avec
`cargo run -p magna-urbis-houses --example admission -- crates/houses/data/urban-admission.json`.
Le test `admission::tests` contrôle son empreinte de catalogue et ses profils.
Pour rejouer un lot d'implantations JSON, utiliser
`cargo run -p magna-urbis-houses --example place -- input.json`.
Pour enrichir une copie placée retenue, ajouter `--enrich` au même exemple.

Contrat natif : [model.rs](src/model.rs).
Frontière web : [houses-wasm](../houses-wasm/README_FR.md).
Validateur de scène : [housesContract.ts](../../bridge/housesContract.ts).
