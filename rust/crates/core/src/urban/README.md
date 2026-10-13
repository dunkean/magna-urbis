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

Quartiers : anneaux/radiales, dispositions rectangulaire, oblique ou avec
encoche, découpage organique guidé ou grille, impasses/closes/hutong/roji,
retrait des rubans de rues et réserve de monument. La réserve conserve un îlot
libre ; elle ne construit aucun monument.

Parcelles : bandes de façade (burgage/machiya), découpage des cours/compounds,
raffinement siheyuan, jardins. Leurs axes, façades et fonds restent explicites.
Les booléens conservent les trous et les parcelles partitionnent leurs îlots.
Les places et réserves ne sont pas recoupées. Recalculer les parcelles conserve
les quartiers, îlots et rues. Les contrôles de rendu ne lancent aucun calcul.
Les liens conservent les paramètres appliqués, graines, sélection et rendu ; les
changements de paramètres non appliqués ne modifient pas le replay.

Le worker conserve son terrain Rust entre appels. Un navigateur qui refuse le
worker utilise les mêmes appels WASM sur la page. Une modification du terrain,
des settlements ou des routes invalide les quartiers qui en dépendent. Les
réponses obsolètes ne remplacent pas la génération courante.

Vérification depuis `rust/` : `cargo test -p magna-urbis-core urban --lib`,
`cargo clippy -p magna-urbis-core -p magna-urbis-wasm --all-targets -- -D warnings`,
`cargo check -p magna-urbis-core -p magna-urbis-wasm --target wasm32-unknown-unknown`.
Depuis `web/` : `npm run typecheck`, `npm run build`, `npm run build:terrain`.

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
