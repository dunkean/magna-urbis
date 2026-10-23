# Houses — tranche retrait et arrêt terrain, livrée le 23 octobre 2026

**Sources figées et disponibles pour intégration R5.** Cette tranche remplace la référence c90c décrite dans `CODEX_HOUSES_0357_DELIVERY.md` ; les preuves antérieures restent intactes. Aucun changement au core urbain, aucun serveur lancé.

## Référence

- CLI : `web/out/source-aspect-setback-cli-proof/plan_replay.exe`, SHA256 `44999adab6a61cc8420e2cb587ba1dfca3fe132b5595212155757085e17f8fac`.
- `houses.exe` : `f295d5ae181fcb74687eee1450cef7b849df02e4dabd982e776b8a8cc431f45f`.
- `build-proof.json` : 126 empreintes stables pendant compilation. Après les 385 tests unitaires de c90c, 47 tests plans et 6 tests du noyau de translation passent sur cette tranche. Pas de prétention à un nouveau passage de toute la suite.

## Changement

1. Lorsqu'un rectangle simple corrigé aux proportions de sa source ne tient pas en façade, un retrait construit une translation dans les vrais droits du corps, de l'occupation et du toit, derrière les fragments du même accès public. Intersections exactes ; domaines non convexes, troués ou disjoints refusés. Aucun hull ni découpe de maison. Un seul candidat réservé, dans les budgets existants de 8 dimensions et 24 admissions. Tous les gardes natifs restent actifs.
2. Une réduction de terrain acceptée n'arrête plus prématurément les poses pleines restantes du même couple. Les limites de 8 évaluations de terrain, une réduction et 24 admissions ne changent pas.

Fichiers : `rust/crates/houses/src/source_aspect_setback{,_tests}.rs`, `plans.rs`, `source_terrain_budget_tests.rs`, `lib.rs` (réutilisation du noyau de translation), fixtures dédiées. Les travaux futurs sont limités aux propositions pendant l'intégration d'Opus.

## Preuves

| Corpus | Résultat | Limites |
| --- | --- | --- |
| Européen 01, 128 demandes | 125 admis / 3 refus ; cbfa passe de 80,271 à **132,477 m²**, proportions source respectées | Cible 313,9 non atteinte ; extérieur natif valide, intérieur B11 encore refusé |
| Rynek, 128 demandes | 111 admis / 17 refus ; géométries, poses et sources inchangées | Diagnostics seuls modifiés |
| Huit détails européens existants | 8 extérieurs / 8 intérieurs valides | Échantillon ciblé |
| Java complet, 1752 demandes | **1010 admis / 735 refus / 7 ouverts** ; mêmes sources, variantes et niveaux | Pas de nouvelle admission ni capacité résidentielle certifiée |
| Java, contre proportions seules cac76 | **56 surfaces améliorées, 0 recul**, +2091,838 m² | 14 anciens corps restent hors rapport source ; cible globale non atteinte |
| Java, contre c90c | Les deux pertes de surface sont entièrement récupérées | 108,103 et 695,679 m² ; aucune autre variation de corps |
| Entrées Java | 646 conservées ; aucune perdue ; 192 différées | Pas d'entrée supplémentaire par rapport à c90c |
| Trois détails Java exacts du parcours complet | 3 extérieurs / 2 intérieurs | 4100 reste refusé à l'entrée |

Audits indépendants : droits des 236 maisons européennes et des 1010 Java ; aucune collision globale Java au-dessus de 0,0001 m² ; 184 assises européennes et 646 Single Java contrôlées. Les autres assises/intérieurs ne sont pas certifiés par ces compteurs. Les 65 retraits proposés dans Java n'apportent **aucun succès** : 16 domaines vides, 32 cas hors opérateur, 17 refus terrain. Le succès du retrait est européen.

Coût européen sur cinq alternances : médiane 393 → 402 ms (+2,29 %, machine partagée), sorties identiques par phase. Les 28 lots Java totalisent 3036 ms natifs dans un seul parcours CLI ; ce n'est ni le temps de ville ni une comparaison de vitesse contrôlée.

## Prochaine intégration

Les **681 refus terrain/fondation** (sur 735 Java ; 49 accès et 5 domaine) doivent être rapprochés des nouveaux lots R5, pas masqués par la capacité du programme. « Ménages logés » ne décrit pas un calcul parcellaire : remplacer par « capacité parcellaire estimée » et garder la réalisation architecturale séparée.

Preuves : `web/out/java-full-setback-proof/RESULTS.md`, `web/out/source-aspect-setback-cli-proof/replay/`, planche ouverte `web/out/cbfa-three-stage-geometry-proof/cbfa-three-stages.png`. Attente du binaire commun R5 et de ses captures 01-l / 04 / Java100k avant la campagne de 50 vues. Le sélecteur de fortifications est livré séparément (`CODEX_FORTIFICATION_STYLE_UI.md`).
