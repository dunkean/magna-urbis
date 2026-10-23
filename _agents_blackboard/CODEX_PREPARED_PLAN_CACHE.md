# Cache éphémère des poses : preuve isolée

Le cache `PreparedPlan` conserve, pour une architecture immuable, les domaines locaux corps/plan et prépare paresseusement les contours de toiture, faîtages, aires de niveaux et archive compacte. Chaque toit reste séparé jusqu'à sa transformation puis son union dans le repère monde, dans l'ordre historique. Le domaine de fondation et ses gardes restent inchangés.

La preuve utilise exclusivement les **120 requêtes admises** du rejeu `strip-initial-budget-proof/after-recovery`, dans leur ordre original et avec leurs fragments JSON bruts conservés. Les huit refus exclus ne participaient pas à l'occupation. Cinq processus CLI distincts ont été exécutés par phase ; aucun serveur, génération de ville ou détail intérieur.

| Phase | Temps natifs (ms) | Médiane |
| --- | --- | --- |
| Avant | 379, 371, 371, 353, 377 | 371 ms |
| Après | 266, 272, 342, 319, 297 | 297 ms |

**Résultat : 120 admis, zéro refus à chaque exécution ; tous les plans sont identiques octet par octet entre les dix sorties.** Leur JSON correspond aussi exactement aux 120 plans de la référence initiale. La médiane observée baisse de 74 ms (19,95 %). Ces phases séquentielles ne constituent pas une campagne randomisée ; ce résultat ne permet aucune extrapolation à une ville complète. Le chronomètre natif inclut le chargement du catalogue, exclut le démarrage du processus et la sérialisation de sortie.

Le nouveau binaire contient également le repli simple après épuisement des voies antérieures : ces 120 requêtes déjà admises n'en ont pas besoin. Cette preuve isole donc le chemin accepté, pas le coût des refus.

Artefacts : `web/out/prepared-plan-cache-proof/comparison.json`, les deux `summary.json`, exécutables figés, sorties et journaux. Runner : `web/scripts/prepared_plan_cache_proof.py` ; phases `before`/`after`, cinq exécutions, refus d'écraser les artefacts.

- SHA256 requêtes : `e71ad9f21b73e948ab0e28afff4960a60f239e3193b1b15ea9d28d1576be0576`
- SHA256 binaire avant : `4a7498d0da4ffe7049e433671234f13ac1d510c7bed4aad0820afd23300abe81`
- SHA256 binaire après : `a042b1bb4953d0aba1cd0873c3ce56a27933b719e4044ed513ed8eff58c349d3`
- SHA256 plans communs : `eb7a9c850a47ee908e734e2bc4a9c4cc08287e4a61602d3b6403ea085303c926`
