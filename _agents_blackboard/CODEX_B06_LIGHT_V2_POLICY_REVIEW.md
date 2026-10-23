# Revue indépendante — politique finale B06 légère V2

Lecture seule du 23 octobre 2026, copie
`web/out/houses-b06-light-v2-workspace/rust`. Aucun blocage concret trouvé dans
le delta V1→V2 examiné. Aucun Cargo, rejeu natif ou changement de cette copie
effectué par le relecteur. Les tests et les corpus V2 restent à exécuter avant
de conclure à une correction globale ou à une promotion.

## Cause et correction

La préparation légère rend désormais possible une entrée B06. En V1, cela
active aussi le repli nominal historique de `budget_selection::Selection` :
un nominal plus petit mais doté d'une entrée peut remplacer le gagnant du
budget. Les 12 intérieurs ciblés réussis ne contredisent pas cette régression
de programme (96 cibles C dégradées, environ 7 068 m² perdus au total).

`FinalEntryResult` transmet une politique privée avec le bâtiment. Après les
exclusions existantes et l'unique décompactage du finaliseur, le prédicat
`single_frame_entry_details` distingue les opérateurs physiques partagés et
fixe `PreserveWinningGeometry` **avant** leur préparation. Ainsi, un échec de
préparation ou de raccord conserve aussi cette politique. La sélection retourne
le gagnant courant : entrée réelle si elle est admise, sinon géométrie exacte
et limite proxy explicite. Elle ne finalise plus le nominal pour cette branche.

Ce choix ne repose ni sur B06 comme identifiant, ni sur une aire seuil. La
visibilité accrue du prédicat engine est le seul changement de ce fichier ;
les contrôles détaillés de corps, niveaux, murs, appuis, toit et passage restent
ceux de la V1. Le prédicat exprime une capacité d'opérateurs, pas un certificat
d'admission : une source à ces opérateurs peut encore être refusée par les
vérifications complètes sans perdre sa géométrie déjà admise.

La branche `LegacyNominalSafeguard` conserve l'ordre et les gardes historiques.
Un plan déjà doté d'une entrée retourne tôt avec cette politique par défaut,
mais le getter compact vrai empêche tout repli nominal. Les Single simples et
les Strip ne changent pas de comportement par ce delta. Les exclusions des
pins, overrides, modes strict/exact et empreintes imposées restent dans les
appels et gardes existants ; la V2 ne les contourne pas.

## Coût et contrat

Le résultat privé ne modifie aucun schéma sérialisé. Il n'ajoute aucun lookup,
décompactage, clone de géométrie, graphe, porte ou pose. La classification
parcourt la petite liste de détails déjà en mémoire. La branche structurelle
évite la seconde préparation finale qui causait la régression. Les autres
branches peuvent toujours payer le repli nominal historique : la revendication
« une seule préparation globale pour toute maison » resterait fausse.

Les budgets partagés de 8 dimensions, 24 admissions et 8 évaluations de guide
sont inchangés. La préparation Single garde sa pose unique ; le raccord natif,
les droits, les voisins, les réserves et le terrain restent obligatoires. La
politique ne transforme aucun échec d'intérieur en réussite déclarée.

## Preuves préparées et limites

Le nouveau test reconstitue la recherche réelle sur Java index 86 et C index
3571, avec les occupations antérieures archivées. Il exige un nominal disponible,
un meilleur gagnant conforme à l'aire baseline et sa conservation exacte hors
diagnostics après échec d'entrée, puis extérieur valide et intérieur refusé.
Les deux témoins ciblent bien la branche causale, sans algorithme de budget copié.
Le positif existant exige la politique typée sur le même appel et rejoue le
portail réellement produit. `nominal_first_budget_tests.rs` est byte-identique
à V1 : il conserve notamment les deux vrais replis B14/B15 et leurs intérieurs.

Le diff source observé contient exactement sept fichiers : `budget_selection.rs`,
`engine.rs`, `plans.rs`, les tests `finalize_policy.rs`/`positive.rs`, et les deux
fixtures de régression. Les empreintes ont été comparées au manifeste du bundle
`proposals/b06_light_finalize_policy/`; aucun autre fichier Houses src/tests
ne diffère de la copie V1.

Cette revue ne prédit ni le nombre d'entrées V2 ni les occupations en aval :
conserver un grand gagnant avec proxy peut changer l'occupation par rapport au
petit nominal V1. La comparaison globale doit donc repartir de l'occupation
propre à chaque phase. Les quatre écarts de minimum signalés de l'ordre de
2–4 nm restent explicitement hors de ce correctif ; aucun seuil n'est modifié
pour les effacer. Le rapport des douze détails reste une preuve **V1** séparée
dans `CODEX_B06_LIGHT_C_TARGETED_DETAILS.md`.
