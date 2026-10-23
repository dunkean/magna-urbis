# Migration du générateur après correction des accès natifs

État au 23 octobre 2026. Note de raccord pour root et Opus. Aucun Cargo ni serveur lancé ici. Correctifs : fusion de scènes dans `urbanSnapshot.ts` et migration du témoin d'enrichissement natif décrit ci-dessous. Les constantes sont maintenant changées par root dans les sources, pas une preuve que les runtimes déjà démarrés les utilisent.

## Identités à faire évoluer ensemble

| Couche | Transition | Motif |
|---|---|---|
| `houses/src/lib.rs::GENERATOR_VERSION` et `bridge/housesContract.ts::HOUSE_GENERATOR` | `houses-2` → `houses-3` | L'accès natif corrigé change la géométrie conservée ; une ancienne géométrie ne doit pas être enrichie comme un plan actuel. |
| `houses/src/plans.rs::PLAN_VERSION` | `architectural-plans-1` → `architectural-plans-2` | Les lots compacts exposent cette identité, **pas** `GENERATOR_VERSION`. Sans cette transition, les gardes des lots laisseraient fusionner deux générations. |
| Exports natifs d'admission et descripteurs de témoins | Régénération réelle sous le nouveau moteur | Ne jamais remplacer seulement une chaîne de version dans une géométrie déjà calculée. Le consommateur core intègre l'export à la compilation. |

Les schémas house `2`, placement `1`, `compact-plan-1`, `compact-plan-archive-1` et `native-admission-witness-1` peuvent rester identiques : leur encodage ne change pas. Le catalogue et l'index n'ont pas à être rebaptisés pour cette seule correction. **Conserver les namespaces RNG `houses:v2:*`** (`engine.rs::selected_draws` et génération) : ce sont les clés des tirages déterministes, pas une version de transport.

## Invalidation effective, conservation historique

`compact.rs::unpack` refuse déjà un compact dont `generator_version` diffère ; `engine.rs::enrich_architecture` refuse de même un ancien `Resolved`. `native_candidate.rs` compare l'identité complète du témoin avant sa construction. `admission_witness::witness_identity` comprend la version générateur et le hash source ; le cache LRU est local au processus. Une nouvelle exécution remet donc le cache à zéro.

`compactPlanArchive.ts` garde volontairement les archives lisibles : leur hash porte sur les octets compressés et change automatiquement avec le contenu natif. L'historique `.decor`, les cas IDB de l'inspecteur et les replay configs peuvent conserver leurs anciens octets. **Afficher une ancienne scène est distinct de réaliser ses détails sous le moteur courant** : les détails périmés doivent être refusés, puis la scène régénérée depuis sa demande/config si l'utilisateur le souhaite. Aucun renommage d'archives, aucune suppression de l'historique, aucune migration géométrique implicite.

Les contrôles `architectureBatch`, `urbanSceneProgress` et `architectureEdits` comparent déjà les versions des lots. `mergeCityWorkshop` avait une lacune, corrigée ici : deux groupes contenant bâtiments, refus ou espaces ouverts doivent avoir mêmes schéma et générateur. Un groupe vide ne relabellise pas les résultats conservés. Le remplacement complet mono-ville ou multi-ville peut adopter une nouvelle version ; les autres bâtiments gardent leurs identités et les archives restent opaques. `mergeWorkshopCities` retire localement tous les résultats remplacés avant sa première fusion pour éviter un faux refus intermédiaire. Test : `cd web; npx vitest run tests/urban.snapshot.test.ts` — **18/18 verts**, dont versions incompatibles, vide, remplacement complet et archives intactes.

Le renderer doit remplacer la scène après changement de génération : `urbanBuildingDetails.replaceScene` vide ses caches ; `appendScene` suppose que les bâtiments précédents restent valables. Le `/status` local annonce les capacités mais pas l'identité Houses ; `HOUSE_GENERATOR` seul ne bloque donc pas un vieux serveur encore actif. Livrer ensemble binaire natif, export intégré au core et WASM Houses, puis recharger le client/module WASM. Aucun redémarrage réalisé par cet audit.

## Fixtures et vérification minimale

- `houses/fixtures/urban-enrichment-eur-med-b02.json` demeure **inchangé** en `houses-2`. Le test `placement::real_three_level_house_enriches_after_json_transfer` vérifie désormais son refus exact, puis reconstruit un nouveau plan courant avec `resolve_urban_architecture`, la configuration/graine conservée et le nominal 4,45×16,117 m. Il effectue le transfert JSON de ce nouveau plan et vérifie enrichissement, trois niveaux et empreintes conservées. Aucun corps, ancien portail ou ancien tirage de paramètres n'est recopié. Test préparé, exécution réservée à la compilation root.
- `rust/fixtures/houses/batch-reference.json` est aussi ancienne, conservée pour les tests purement visuels. **`check-house-contract.mjs` reste bloqué par cette baseline ancienne** pour une comparaison exacte au générateur courant ; il faudra la régénérer et revoir séparément, pas relabelliser son JSON. `frontage-deep-bastide.json` ne fournit que demande/transform aux tests reconstruits : pas de migration nécessaire.
- Les mocks `architectural-plans-1` représentant une sortie **courante** doivent suivre `PLAN_VERSION`. Les anciennes versions dans `architectureEdits.test.ts` et les archives opaques de `compactPlanArchive.test.ts` peuvent rester comme cas historiques.
- Vérification native bornée à conserver : compact courant accepté, clone marqué `houses-2` refusé ; identité de témoin périmée refusée avant génération ; réalisation extérieure/intérieure sur le même plan courant. Les tests d'admission vérifient aussi générateur et hash exportés.

## Export B12 + accès corrigé : différences exactes séparées

Le candidat final `candidate-asymmetric-v3.json` a été comparé à la baseline et à `candidate-opposed-v3.json`. B12 seul ajout : **223→224 profils / 417→418 variantes**, aucune suppression ni modification d'ordre. Depuis la baseline, **122 minimums / 223 variantes** changent exclusivement une coordonnée d'enveloppe, toujours réduite ; **101 minimums / 194 variantes** sont exactement conservés. Aucun statut, accès, paramètre, refus, graine ou registre modifié. Seuls le hash source attendu et `generator_version=houses-3` changent en métadonnées.

Le mode B12 strict reste inchangé et refuse ces différences. L'exception explicite `access-v3` est verrouillée sur les checksums exacts baseline/candidat, les chemins natifs et nombres de changements revus ; elle refuse les modifications arbitraires d'enveloppe ou de statut. **Export canonique copié avec autorisation root et checksum vérifié** : `5d9e96fd6a6d5b91adabde61d073c60f0ac36df8259372f41322126e6eea25cc`. Détail causal, décimaux et preuves dans [le contrôle d'admission](CODEX_ROMAN_B12_ADMISSION_CHECK.md). Aucun catalogue B13 émis ni génération native relancée ici.
