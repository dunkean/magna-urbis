# Raccord du style d’enceinte — fichiers réservés

2026-10-23, Codex morphology. Demande explicite du parent après le contrat Walls & palisades d’Opus.

Réservation limitée : `rust/bridge/urbanConfig.ts` (type, défaut et normalisation `fortificationStyle`), `web/src/ui/terrainUrban.ts` (sélecteur et raccord au groupe Enceinte uniquement), et un test ciblé sous `web/tests/`. Aucune modification de `core/urban`, des maisons, des renderers ni des autres fonctions UI. Le moteur reste lu seul ; aucun Cargo ni serveur.

Objectif : valeurs identiques au contrat natif, `auto` pour les configurations/URL anciennes, choix du style conservé dans la sérialisation existante. **État : raccord UI et compatibilité transport livrés, fichiers libérés.**

Réservation complémentaire autorisée par le parent : hook de construction des requêtes natives dans `rust/bridge/urban.ts`, hors interface `Enclosure` d’Opus ; helper de configuration et tests ciblés si nécessaire. Le défaut `fortificationStyle: auto` sera omis uniquement du payload natif. Les valeurs explicites resteront transmises et les liens garderont le réglage. Aucun autre comportement ni core natif modifié.

## Raccord livré

- `urbanConfig.ts` exporte `FORTIFICATION_STYLES` et le type `FortificationStyle` : `auto`, `palisade`, `gord`, `hedge`, `curtain`, `flanked`, `concentric`, `rammed-earth`, `wengcheng`, `bastioned`. `LayoutConfig.fortificationStyle` vaut `auto` par défaut ; la normalisation existante complète les anciennes configurations et conserve une valeur explicite.
- `terrainUrban.ts` ajoute « Style de l’enceinte », avec libellés français, dans le panneau Enceinte. Le contrôle et son aide sont aussi déplacés dans l’étape 6 du City Bench lors de sa réorganisation. Les lecteurs de `data-config`, brouillons, réglages appliqués et partage JSON existants transportent ce champ. Aucun nouveau cycle de génération.
- Le sélecteur explique le contrat existant : un style incompatible avec le type d’enceinte conserve le choix culturel. Le moteur garde la validation des valeurs et son avertissement ; aucun changement de résolution native ni correspondance inventée entre type et style.

## Vérification

Depuis `web/` :

```
node node_modules/vitest/vitest.mjs run tests/urban.fortificationStyle.test.ts tests/urbanRust.bridge.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

**14/14 tests passent, TypeScript global passe.** Trois nouveaux tests vérifient les liens anciens, le cycle URL de tous les styles et l’égalité exacte de l’énumération avec `fortification::STYLES` lue dans le source Rust. `git diff --check` passe. Aucune exécution de ville ni capture navigateur ; aucun Cargo ni serveur.

## Compatibilité avec le moteur ancien encore en usage

`LayoutConfig` natif refuse les champs inconnus. La suite autorisée ajoute donc dans `urban.ts` un adaptateur limité au transport : **seul le littéral `fortificationStyle: auto` est omis**, car l’absence a déjà le même sens natif. Les valeurs explicites restent présentes et conservent les éventuelles erreurs des anciens moteurs. Aucun repli automatique après refus.

La passerelle unique du produit est `createUrbanEngine`, avec deux sorties local et WASM. L’omission couvre la configuration de génération, une configuration jointe aux autres requêtes, et `layout.config` des plans importés ou retenus. Les lectures par source native restent dans la même passerelle ; les autres endpoints de pages/affichage ne portent aucune configuration. Les géométries et nombres des layouts ne sont ni recalculés ni normalisés. Les objets UI et snapshots retournés ne sont pas mutés ; les URL gardent `auto` ou le choix explicite.

Validation finale depuis `web/` :

```
node node_modules/vitest/vitest.mjs run tests/urban.fortificationTransport.test.ts tests/urban.fortificationStyle.test.ts tests/urbanWorker.retention.test.ts tests/urbanRust.bridge.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

**23/23 tests passent et TypeScript global passe.** Les trois tests de transport observent le véritable JSON du bridge via fetch simulé et les arguments WASM simulés ; ils vérifient l’absence du défaut, le maintien des styles explicites, la propagation d’une erreur de moteur ancien sans retry, la conservation des snapshots et l’identité des frontières JSON importées/retenues. Aucun appel au serveur 8791, aucune ville, aucun Cargo.
