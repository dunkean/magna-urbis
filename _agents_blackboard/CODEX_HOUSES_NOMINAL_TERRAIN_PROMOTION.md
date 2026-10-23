# Revue de promotion — budget nominal puis adapté, reprise terrain V3

**Avis de code : aucun blocage concret relevé. Promotion à décider après les audits des corpus du CLI final, pas par extrapolation des versions précédentes.** Revue en lecture seule du delta complet de la crate Houses entre production B11 et copie isolée. Les 21 fichiers différents sont tous expliqués ci-dessous ; chaque SHA isolé correspond au `build-proof.json` du CLI `0406b1f3fbee178951cfd9773249fae2d1c0cc86d4ab0068dbeaa212eed3f75e`. Aucune source, copie, donnée urbaine ou UI modifiée.

## Liste fermée d’intégration

Chemins relatifs à `rust/crates/houses/`. Le manifeste JSON voisin contient les SHA avant/après pour l'application contrôlée. **17 fichiers à intégrer, 4 fichiers diagnostiques exclus.**

| Fichier produit | Action et portée |
|---|---|
| `src/adapted_single_budget.rs` | Ajouter : minima physiques de l'opérateur existant, seulement pour un Single déjà admis sous les minima nominaux. |
| `src/budget_selection.rs` | Ajouter : choix final entre meilleur budget adapté et résultat nominal avec entrée retenue. |
| `src/initial_terrain_recovery.rs` | Ajouter : tickets paresseux, pool borné, reprise unique après refus de toutes les voies ordinaires. |
| `src/compact.rs` | Modifier : getter privé `has_retained_entrance`, sans décodage ni changement de format. |
| `src/morphology.rs` | Modifier : extraire le calcul de minimum déjà utilisé par synthèse et budget ; calcul inchangé. |
| `src/plans.rs` | Modifier : raccords, budgets partagés, collecte des seuls échecs physiques typés, choix final et modules de tests. |
| `src/source_terrain_budget.rs` | Modifier : visibilité interne des prédicats et reconnaissance du bruit numérique natif ; aucune mutation géométrique. |

Ajouter les cinq modules : `src/adapted_single_budget_tests.rs`, `src/initial_terrain_recovery_tests.rs`, `src/initial_terrain_recovery_v3_tests.rs`, `src/initial_terrain_recovery_v3_positive_tests.rs`, `src/nominal_first_budget_tests.rs`. Ajouter leurs cinq fixtures : `tests/fixtures/b06-adapted-budget-r5.json`, `c-native-terrain-positive342.json`, `c-native-terrain-witness.json`, `initial-terrain-1050.json`, `nominal-first-budget-regressions.json`.

**Exclure tout `src/b06_native_entry_probe/`** (un fichier Rust et trois JSON). Son hook est absent de plans.rs. Il s'agit d'un oracle détaillé encore refusé sur un véritable linteau hors corps ; aucun assouplissement ne fait partie de cette promotion. La trace ponctuelle `V3 INDEX6` est également absente. Ne recopier ni workspace/Cargo.lock/Cargo.toml isolés, ni core, UI, exports, catalogue, admission, exemples ou exécutables : aucun delta de crate correspondant n'est requis. Engine/access/roofs ne changent pas.

Nettoyage documentaire seulement au moment de promotion : remplacer « Proposal only » / « narrower budget proposal » dans adapted_single_budget et « Inactive v3 » en tête de initial_terrain_recovery. Ces commentaires sont obsolètes ; les conserver ne change pas le binaire, les modifier nécessite simplement d'enregistrer de nouveaux SHA de source.

## Garde-fous et coûts vérifiés

**Budget adapté.** La phase nominale garde son ordre et ses sorties précoces. La phase adaptée ne consomme que le reliquat commun : au plus 8 couples construits, 24 admissions de pose et 8 évaluations du guide terrain, sans réinitialisation entre phases. Un couple déjà construit pour le même emplacement d'accès est ignoré ; le numéro d'emplacement, et non le seul ID, distingue les segments portant un ID répété. Le candidat adapté doit améliorer l'erreur d'aire ; le meilleur nominal admis est conservé. La construction reste native, avec source, niveaux, toiture et corps entiers ; les minima physiques sont partagés avec la synthèse déjà autorisée. Le champ s'applique aux Single admissibles, pas uniquement à l'étiquette B06.

Les pins, overrides de la demande, strict, exact, empreinte imposée et `parcel_fit=false` empêchent les nouvelles branches selon leurs gates d'appel/éligibilité. L'extension nécessite auto inspired domestic/mixed, support Ground, rectangle unique, niveaux identiques, absence de cour/passage et proportions source admissibles. Le minimum adapté ne descend pas sous les dimensions du corps déjà admis. Cela ne transforme pas les minima graphiques en dimensions historiques mesurées ou en capacité de ménages.

**Entrée finale et getter.** Si le meilleur adapté ne conserve pas d'entrée, une seule vérification finale supplémentaire peut être faite sur le nominal déjà admis. C'est une préparation/admission supplémentaire distincte des 24 admissions budgétaires. Pour ces Single, seulement la pose existante, aucune autre porte/pose. Si le nominal obtient une vraie entrée, il est retenu ; sinon le meilleur budget reste admis avec diagnostic explicite. `has_retained_entrance` lit seulement Option<entrance> sur les archives fraîchement produites par cette voie native. Il ne valide aucun fichier externe, ne décompresse rien et ne change aucune version.

**Reprise terrain initiale.** Un ticket est calculé au premier échec physique typé d'un candidat ; une Arc n'est clonée que si un emplacement du pool est retenu. Au plus 4 témoins vivants, dont le premier compatible est protégé ; cela ne signifie pas seulement 4 clones cumulés sur toute la séquence. Des échecs précédant un succès ordinaire peuvent payer ce coût de préparation. Le classement linéaire du dénivelé est une heuristique, jamais une admission. Les demandes avec préférence façade gardent exclusivement leur pool historique ; les autres n'observent que les trois poses natives déjà essayées. Ni nouveaux essais de pose, ni normalisation d'un plan adapté déplacé. Choix déterministe parmi les 64 premiers accès déclarés, segment exact et côté lower_front conservés. L'accès n'est validé qu'au passage final par visual.

Après refus complet seulement : au plus 8 évaluations de guide globales, puis une construction et une admission natives. Une tentative réduite refusée ne relance pas une autre construction. Un succès de cette reprise saute la croissance post-admission ; l'entrée finale ordinaire reste possible. Ce budget initial n'est donc pas additionné à un nouveau balayage 8/24 du même résultat. Les boucles historiques de sélection/synthèse sont conservées : les compteurs 8/24/8 ne représentent pas toute la génération ni les calculs scalaires de couples. Des admissions nouvelles peuvent modifier l'occupation et les résultats suivants d'un batch.

**Arrondi natif.** Seule la reconnaissance d'un rectangle local reçoit une borne de 1e-7 m (=GRID_M/10000). Dimensions/coordonnées finies, autres gates structurales inchangées, et différences corps/rectangle nulles dans les deux sens selon le moteur booléen. Le contour n'est ni déplacé ni resnappé. Translation réelle de 1 mm, coin oblique, trous et nombres invalides sont testés négativement. Aucun seuil de cadastre, toit, accès, pente, eau, fondation ou collision n'est élargi.

## État des preuves

Le build figé rapporte 400/400 tests unitaires release. Les cas C6 et C342 ferment respectivement le défaut de reconnaissance et une vraie récupération avec contexte antérieur exact ; le témoin historique row1050 est conservé par la séparation des pools. Le parent rapporte également Europe256 + 8 : mêmes géométries/admissions, détails extérieurs et intérieurs verts. L'audit final C7921 est confié à style_index ; l'audit indépendant de Java1752 final0406 contre38889 et B11 est la prochaine étape de cette revue. Ne pas réutiliser comme validation finale les seuls comptes ou audits du CLI expérimental525e7e.
