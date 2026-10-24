# Responsable1 — maisons / capacité, relais de vague

Dernière vague : UI bilan validée par root120tests/16fichiers+tsc+bundle ; aucune capacité globale déduite. Origine C1358 tracée dans `CODEX_C1358_PROGRAMME_ORIGIN.md` :617.9 est un souhait de masse preview, pas un besoin démographique démontré ; trois ménages sont alloués séparément. Copie catalogue insular explicite générique autorisée, non promue : `web/out/core-insular-occupancy-workspace/implementation-freeze-v1.json`, SHA`c18509b8c3ecb759216c11c034f45b259cc88b125e32fb6ba2579f0277c0153d`,93inputs,4tests préparés non exécutés par l’auteur, effet numérique attendu0. Root centralise le verdict. Le contrat suivant est proposé seulement dans `CODEX_INDICATIVE_HOUSING_FLOOR_CONTRACT.md` : besoin utile indicatif avec provenance distinct de masse, brut final des vrais niveaux, déficit nécessaire seulement, utile/capacité inconnus. Aucun code de contrat, solveur ou produit modifié pendant cette vague ; Core Opus vivant préservé.

État au23octobre2026. Root centralise les exécutions Cargo/natives, les tests produit et les verdicts de promotion. Ce responsable a fait les lectures, copies, vérifications d'empreintes, propositions et une promotion Rust expressément autorisée ; aucun Cargo/natif/serveur/navigateur exécuté de son côté.

| Lot | État concret | Preuve / suite |
|---|---|---|
| Rapport natif `programme_outcome` | **6 fichiers Rust/fixture promus**, identiques octet par octet au gel testé V2 ; bases produit vérifiées identiques au gel initial malgré R7 | `web/out/programme-outcome-production-delivery/manifest.json`, SHA`c228d8d40b68963f5a6a299780ce2dbd82855f885775271832ab897413f69778` ; patch`promoted.patch`, sauvegardes avant promotion sous`before/`. Root a depuis validé la production :416/416 tests verts,213 entrées de source stables (`programme-outcome-production-proof/verification.json`). |
| Preuve native avant promotion | Root a rapporté **416 tests bibliothèque +5 tests metadata verts**,155/155 fichiers aux anciens champs byte-identiques après retrait du seul nouveau champ ;7807 rapports indépendamment vérifiés | `web/out/programme-outcome-first-proof/tested-source-freeze-v2.json`, `replay/report.json`. Le responsable n'a pas relancé ces tests. |
| Consommateurs UI / bridge | **Promus sur autorisation root**, neuf fichiers aux empreintes exactes V2 ; bases toutes vérifiées | `web/out/programme-outcome-ui-production-delivery/manifest.json`, SHA`2e4306ab6bf379edd27ba71dd23c65fd0f30681e548ccd2bb8a89e30c1858a19` ; avant/après+patch, dix empreintes finales vérifiées. Root centralise les tests de cet état. Voir `CODEX_PROGRAMME_OUTCOME_UI_DELIVERY.md`. |
| Libellé de comparaison du site | **Appliqué**, une seule substitution de texte | `terrainUrban.ts::appendArchitectureOutcome` nomme désormais « demande actuelle du site » ; calcul et handlers inchangés. |
| B06 first-success / tail comparator | **5 tests V2 verts mais zéro gain C1358**, isolé et non promu | B14 refuse marche1.439m>0.750m, cinq admissions additionnelles ; ancien4.060225m² intact, déficit613.839775m². Voir `CODEX_B06_SOURCE_TAIL_NEGATIVE_RESULT.md`. |
| Grammaire compound javanaise | Étude livrée, aucun nouveau modèle/recette/source promu | `CODEX_C1358_SOURCE_CHOICE_AND_COMPOUND_REVIEW.md` : sources primaires UGM/UNESCO, limites des opérateurs actuels et chemin de coordination site/accès/budget sans pavillons universels ni ménages crédités. |

## Promotion Rust limitée

Fichiers autorisés/promus :

- `rust/crates/houses/src/plans.rs` : champ facultatif rétrocompatible, constructeurs intermédiaires None, calcul à la frontière batch **après** la sélection et finalisation réelles ; toutes routes de succès couvertes.
- `rust/crates/houses/src/native_candidate.rs` : None au constructeur intermédiaire ; le batch attache ensuite le rapport final.
- `rust/crates/houses/src/plan_programme_outcome.rs`, `plan_programme_outcome_tests.rs` et`tests/fixtures/programme-outcome-c1358.json` : module/tests/fixture exacts du gel testé.
- `rust/crates/houses/src/programme.rs` : uniquement les deltas de tests root, exclusion du seul nouveau rapport du comparateur physique et assertions distinctes des demandes200/180/600 +ménages logés inconnus.

Le rapport concerne l'aire de l'union finale des corps, pas la plage nominale, l'emprise du toit, les étages cumulés ou la capacité fonctionnelle. Les ménages demandés ne sont jamais crédités : `housed:null`, capacité inconnue. Aucun choix, seed, plan, admission, portail, diagnostic ou archive ancien n'a été modifié par la promotion. Le diffcheck limité est vert ; les6 SHA après copie correspondent exactement au gel V2 testé.

## B06 tail V2 — dépendances complètes, code V1 inchangé

`web/out/houses-b06-source-tail-workspace-v2/implementation-freeze-v2.json`, SHA`bf3d2b22059343223e8116d7899d50fb80b97fd7b546b933e1d70a256df60392` :224 inputs =203 inputs V1 byte-identiques +21 dépendances réelles (20 fixtures complètes sous`rust/fixtures/houses` et`core/src/urban/services.json`). Les106 références littérales include_str/include_bytes sont résolues et consignées dans`compilation-dependencies.json`. Aucun cfg(test), ancien test, code ou fixture existante n'a été supprimé/altéré pour contourner la compilation. V1 et son manifeste restent inchangés.

Cargo.lock avant build V2 :`33fbd15d54cc1c86dfbbcecd375db481cf88e4a6ae2e3da33d1898b3c808878c`. Root a relevé la normalisation du build :`e039ed141736c98b7bee28db13742d245a6b1920dfdf0558cc0048169956cfcf`. La copie V2 demeure basée sur la production **avant** la nouvelle metadata ; une éventuelle promotion ultérieure devra intégrer les seuls deltas par trois voies et préserver `programme_outcome`, sans recopier ses anciens plans.rs entiers.

Le témoin C1358 conserve617.9m² demandés,4.060225m² admis et3ménages demandés non certifiés. Reconstruction offline : B15 →B06 →B14 ; le premier succès B06 masque B14. Un seul candidat non essayé de la palette initiale est proposé après conservation du résultat ancien entièrement finalisé, sans pin sur la requête. B14/B15 restent plafonnés respectivement à330/416m² dans les bornes actuelles du resolver, sous556.11m² nécessaires à90% de cible ; une amélioration partielle ne clôt donc pas ce programme. Root a exécuté V2 : aucun gain C1358, source B14 refusée sur la marche ; ne pas promouvoir comme amélioration.

## Prochaines actions du responsable1

1. Root centralise les tests des consommateurs UI et le typecheck sur l’état final fusionné ; la liste exacte figure dans `CODEX_PROGRAMME_OUTCOME_UI_DELIVERY.md`. Aucun Vitest/tsc exécuté par le responsable pendant la promotion.
2. L’agent paramètres a reçu régions/empreinte du panel et a déjà rebasé sa copie isolée ; préserver les deux lots lors de sa promotion coordonnée.
3. À une prochaine vague autorisée : traiter concrètement programme/terrain/sources au-delà du tail négatif. Maintenir déficit et capacité inconnue visibles ; ne pas annoncer la fermeture617.9m² ni une capacité Java100k/million.

Créneau d’implémentation UI livré ; aucune autre mutation produit sans nouvelle coordination root.
