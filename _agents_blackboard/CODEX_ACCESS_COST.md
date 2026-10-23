# Coût des contrôles de portail — optimisation équivalente

## Résultats vérifiés à 01:54 — 23 octobre

Les deux optimisations sont maintenant compilées. Les fichiers de sortie des deux corpus de 128 demandes sont identiques octet par octet entre le CLI avant et après tri des propositions. Même constat pour l'export admission 224/418 et le golden natif. Le test avec l'ancien algorithme comme oracle passe ; le test de court-circuit a révélé une erreur dans son témoin inversé (pas dans le prédicat), corrigée puis vérifiée au passage ciblé de02:02 (`web/out/native-entry-lazy-fixed-test.log`).

Cinq alternances avec les exécutables figés : corpus plaine fluviale, médiane 467 → 404 ms (−13,49 %) ; second corpus Rynek, 502 → 453 ms (−9,76 %). Toutes les sorties répétées sont identiques. Contre le stade antérieur « fondations seulement », l'ensemble des nouveaux contrôles d'entrée reste plus coûteux : 349 → 414 ms (+18,62 %). Ce sont des mesures CLI locales sur des demandes figées, pas des temps de ville ni d'interface.

Preuves : `web/out/native-entry-ordered-cli-proof/equivalence.json`, `web/out/native-entry-ordered-cost-proof/report.json`, `web/out/native-entry-ordered-secondary-cost-proof/report.json` et `web/out/native-entry-ordered-foundation-cost-proof/report.json`. Le CLI avant et après est conservé ; les notes de préparation suivantes décrivent les décisions antérieures à ces mesures.

23 octobre 2026. Lecture de `CODEX_NATIVE_PLANNING_ENTRY.md` et du corpus asymétrique figé. Root mesure une médiane de 329→451 ms sur 128 demandes ; cette hausse n'est pas attribuée entièrement aux fonctions ci-dessous sans profilage. La préparation structurelle des entrées est aussi un travail ajouté. Aucun Cargo, benchmark ni serveur lancé par cet agent.

## Deux doublons supprimés, source prête à compiler

1. `access.rs::has_opposed_portal_landings` construisait les deux booléens de `opposed_portal_sides` avant de faire leur OR. Il calcule maintenant directement `(a∩premier ≥ seuil ET b∩second ≥ seuil) OU (a∩second ≥ seuil ET b∩premier ≥ seuil)`, avec court-circuit. `portal_side_halves` partage les **mêmes quatre sommets**, le même `quad` et le même seuil. Si le premier sens réussit, cela évite une ou deux intersections ; si le second est nécessaire, les mêmes prédicats sont évalués. La sélection du sens asymétrique garde son tableau et son ordre antérieurs.
2. `candidate_filtered` revalidait les côtés opposés de son repli **symétrique exact**, alors que son `sides` venait déjà du même `(a,b,opening,symmetric,width)`. Le repli réutilise ce résultat. Les deux intersections du passage complet, les interdits et `accept` sont toujours exécutés dans leur ordre initial. Le passage asymétrique conserve sa propre validation finale ; aucune preuve n'est transférée entre deux surfaces différentes.

L'énumération des arêtes/positions, leurs tris, les priorités des candidats, les constructions et tous les arrondis restent inchangés. Les prédicats retirés sont purs et portent sur des données identiques non mutées : le résultat sélectionné ne dépend pas de leur répétition. Aucun seuil relâché, aucune préférence géométrique nouvelle.

## Profilage des portes : conservé

`has_profiled_portal_landings` et `portal_with_profile` construisent et contrôlent à nouveau le profil choisi. Ce doublon ne concerne qu'un portail retenu au dernier stade, et sa garde défensive reste utile. Dans les 125 plans du corpus archivé, **123 paramètres racine n'ont ni portal_profile ni site_gate_profile**, deux en ont ; ce décompte ne mesure pas la durée de leurs appels. Leur optimisation n'est pas prioritaire dans ce premier patch.

Ne pas remplacer `profiled_passage` par l'entrée existante au seul motif que la largeur nominale est égale : la renormalisation et le snap millimétrique peuvent déplacer des sommets. Ne pas déduire les aires du passage complet d'une somme de demi-intersections, ni inverser leurs opérandes : les conversions booléennes/canoniques peuvent faire varier les valeurs au seuil. Les profondeurs signées, la largeur profilée et sa garde finale restent exactes.

## Vérification bornée

Un seul test ajouté dans `access/opposed_portal_tests.rs` : `lazy_opposed_predicate_matches_previous_native_door_predicate`. Il compare à la formule antérieure figée, indépendante du helper factorisé, sur le faux bord de lot 2471 et les passages natifs de gaps 0,316 / 0,450 / 0,8 m, dans les deux sens et après réduction de profil. Il exige les deux orientations positives et un refus négatif. Les tests causaux existants restent applicables.

Root compile ensuite et compare les mêmes sorties avant/après : plans et détails retenus exactement identiques, puis les mêmes 128 demandes pour le temps. **Aucun gain mesuré ni test exécuté de ce patch à ce stade.** Si les sorties changent, ce patch doit être considéré non équivalent malgré son intention et être corrigé avant publication. Aucun changement d'export admission n'est attendu.

## Propositions ordonnées avant géométrie — deuxième patch prêt

`candidate_filtered` conserve exactement l'énumération des arêtes et des positions, la déduplication locale, les mêmes coordonnées arrondies et le tri stable descendant `middle.y`, puis ascendant `middle.x`. Il stocke seulement `(middle, opening, edge)` avant le tri, puis exécute les prédicats et constructeurs inchangés dans cet ordre et retourne au premier candidat admis. La surface d'un candidat perdant n'est plus construite après un succès. Les appels source→cible puis cible→source restent séparés ; aucun candidat n'est supprimé ou plafonné.

Preuve : pour un prédicat pur V et un tri stable T, `first(T(filter(V,P))) = first(filter(V,T(P)))`, y compris à égalité de clé puisque l'ordre initial est conservé. Les sept sites d'appel ont été relus : corridors, candidat simple, deux sens des connexions horizontales, escalier et deux sens dans `profiles::add_entries`. Ils ne capturent que des données immuables, sans RNG/Cell/RefCell ; les mutations de l'unité suivent le retour. Cette pureté est désormais une condition documentée du helper privé.

La seule nouvelle allocation stocke les propositions non encore testées (80 octets de données par proposition, hors capacité du Vec), y compris celles qui échoueront. Les formes à échec complet ne gagnent aucune construction et trient davantage de petits enregistrements ; aucun gain temporel n'est encore revendiqué. Le test `access::candidate_order_tests::ordered_proposals_match_previous_candidate_exactly` conserve l'ancien algorithme complet comme oracle : 36 cas angle/gap/sens/interdits avec prédicat profilé pur, puis le cas réel à anneau interne et un cas hors portée. Il compare les coordonnées intégrales du portail et du passage, jamais seulement leur existence.

Aucun Cargo exécuté. Root compilera ce patch puis comparera les sorties natives à son CLI figé `web/out/native-entry-contact-cli-proof/` (avant cette deuxième optimisation) : mêmes plans, mêmes détails et même export admission, avant toute conclusion de performance.
