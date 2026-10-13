# Quartiers et parcelles dans Terrain Bench

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

Lors de la validation du 13 octobre 2026, l'index de façades seul a été mesuré
sur six layouts figés : de 1,20× à 11,72× plus rapide, 4,72× sur la somme des
médianes, avec sorties identiques bit à bit. Ce résultat isole l'index avant
les changements de morphologie et de profondeur ; il ne mesure pas un gain
global sur des villes différentes. Les entrées figées, captures et mesures
de cette session sont dans `web/out/urban-audit-frozen/` (sorties locales ignorées).

## Urban Bench

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
  couche. Le rendu Rust et le modèle urbain natif ne sont pas modifiés.

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
