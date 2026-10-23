# Capacité : intitulés et preuves du prochain bench

État du 23 octobre 2026. Périmètre : bridge, panneau et scripts de bench ; aucun changement Rust, core, `terrainUrban.ts` ou `cityInspector.ts`.

## Changements livrés

- `web/src/ui/urbanBuildingsPanel.ts:105` remplace « Capacité réellement bâtie » par **Bâti estimé**, avec **Prévu** pour l’estimation parcellaire. Les valeurs indisponibles disent **non calculé** ou **non vérifié**. Sous le tableau : « La capacité des bâtiments n’a pas été évaluée. Les valeurs prévues viennent du programme. », « Le bilan des bâtiments n’est pas disponible pour cette scène. », ou « Estimation calculée sur les bâtiments générés. ». Le déficit reste le champ natif inchangé, intitulé **Déficit du programme**. Aucun dénominateur recalculé ou remplacement par `requested - parcelCapacity`.
- Nouveau `urbanProgrammeEvidence.ts` : sans marqueur natif explicite de réconciliation, un zéro ne prouve rien. Une scène eager connue doit fournir les issues de toutes les allocations et des totaux cohérents avec `builtCapacity`, `openCapacity` et `deficit`. Un vrai zéro après refus reste affichable. Historiques incomplets/incohérents : non vérifiés. Les scènes compactes/silhouettes retournent immédiatement « non calculé », même en présence d’objets extérieurs détaillés ; le cache de détails n’est jamais interrogé. Index des issues par parcelle une seule fois, puis parcours linéaire des allocations/demandes. Le panneau réévalue sur changement de programme **ou** de scène (restauration/remplacement/invalidation compris).
- L’inspection du panneau parle désormais de **surfaces utiles indicatives / unités domestiques estimées** ; elle ne transforme plus le zéro des plans compacts en zéro logement : **capacité non évaluée**.
- `web/scripts/architecture_bench_evidence.mjs` ajoute `structuralFloorProgramme` ; anciennes métriques et `capacityPersons:null` conservées. Aucun nouvel appel natif, aucune lecture d’intérieur ou d’archive. Les cartes temporaires contiennent seulement le lot courant (64 sites au plus dans le flux natif).

## Métrique supplémentaire, sans habitants extrapolés

Périmètre exact : demandes **domestic + mixed**, donc l’activité commerciale d’un bâtiment mixte reste incluse. Le numérateur mesure la **somme des emprises des niveaux des corps admis**, trous soustraits, sans union entre corps. Ce n’est ni une surface habitable nette ni une capacité d’hébergement. Un refus apporte exactement zéro surface admise ; une géométrie absente ou une issue encore inconnue reste explicitement inconnue.

`programme.built_area_m2` est une cible d’**emprise**, et `programme.floors` la plage préférée du corps principal (`rust/bridge/urbanArchitecture.ts:19–26`). La référence calculable sans autre contrat est donc seulement **emprise cible × plage d’étages préférés**. Tours, annexes, choix explicites et usage mixte peuvent s’en écarter. Aucun taux unique, milieu de plage ou conversion en personnes n’est ajouté.

```text
structuralFloorProgramme:
  version, scope, sites, accepted, refused, open, unresolved, outcomesWithoutFunction
  admittedFloorM2: {sum, knownPlans, unknownPlans}
  reference: {knownSites, unknownSites, footprintTargetM2, floorM2:[min,max]}
  comparable: {sites, admittedFloorM2, referenceFloorM2:[min,max],
               accepted, refused, open, unresolved, unknownAcceptedGeometry}
```

`comparable` conserve seulement les sites à référence complète. Les refus restent dans cette référence ; ils ne sont jamais retirés pour améliorer le résultat. Si `unresolved` ou `unknownAcceptedGeometry` est non nul, la surface admise connue est un total partiel. Les anciennes statistiques toutes fonctions restent séparées.

**Preuve hors ligne** : `web/scripts/architecture_floor_programme_proof.mjs` a lu une fois les 28 paires requête/sortie existantes de `web/out/java-full-setback-proof/after`, en vérifiant leurs SHA et ordre. Aucun nouveau calcul natif. Résultat : `structural-floor-programme-evidence.json`, SHA256 `421dbbcc28f64f03c627169fb30d67fdba29bbe56ea8079fb1e137daa2723594` (SHA du collecteur, du runner, du manifeste et de chaque entrée/sortie inclus).

Lecture concrète du corpus historique Java : 1 752 demandes toutes fonctions, dont **1 546 domestic/mixed** : **973 plans admis, 573 refus**, aucun résultat ni niveau inconnu. Surface admise de ces 973 plans : **98 392,37 m²**. Référence complète pour **1 501 sites** (45 inconnues) : plage dérivée **[481 293,30 ; 481 293,30] m²** ; sur **ce même sous-ensemble**, 963 plans admis / 538 refus et **96 056,19 m²** admis. Les plages du vieux corpus sont ici à un étage, d’où deux bornes identiques. Cela ne représente ni une nouvelle ville R5 ni « 100 000 habitants logés ».

## Relais réservés à Opus / responsables du bench

| Emplacement | Constat / correction à transmettre |
|---|---|
| `core/src/urban/programme.rs:2118–2134` | « les îlots réels logent » / « ménages logés » sont des allocations **avant Houses**. Remplacer par « ménages prévus/alloués dans le programme parcellaire », sans changer le calcul. Root a déjà saisi Opus. Le panneau affiche ces avertissements tels quels ; ils peuvent donc réintroduire le faux libellé tant que le producteur n’est pas corrigé. |
| `web/src/ui/cityInspector.ts:159,167,191–204` | La parcelle affiche « Ménages » à partir de l’allocation : préférer « Ménages prévus ». L’eager affiche `domestic_units` comme « logement(s) » sous « Capacité ». Or Houses compte les household IDs natifs et impose au moins 1 pour le domestique (`placement.rs:2009`), sans intérieur généré : préférer « unités domestiques déclarées ». Garder l’état inconnu des plans. Fichier réservé Opus, non modifié. |
| `web/src/render/buildingInspection.ts:118–128` | `capacity.status:'native'` signifie origine de la donnée, **pas** certification des habitants. Ne pas l’utiliser comme preuve de logement ni agréger en personnes. |
| `web/scripts/export_decors.mjs:112–113,140` et `city_visual_bench.mjs:240,572` | « jusqu’à 10 000 / 400 000 hab. » et `declaredCapacityExceeded` viennent de `tags.maxPopulation`, un gabarit de décor/scénario, pas une capacité native. Recommandation : libellé « population de scénario conseillée », conserver le champ historique et documenter sa sémantique ; pas de réexport du décor pour cet audit. |
| `core/examples/culture_capacity_sweep.rs:94–115` | `households_placed` compte désormais seulement les allocations domestic, avec `households_all_functions` à part. Cette correction de dénominateur est déjà posée : ne pas la refaire. Les anciens `before-island` et les nouvelles baselines n’ont pas la même sémantique ; ne pas comparer leurs taux sans migration explicite. Aucun plan Houses n’est produit par ce sweep. |

Le bench visuel dit déjà **habitants demandés**, distingue chaîne technique et verdict visuel, et conserve `certifiedOccupied:null` (`city_visual_bench.mjs:656`). Les titres du prochain bench peuvent donc juxtaposer : population demandée ; programme parcellaire estimé ; plans admis/refusés ; surface des niveaux admise / référence dérivée ; détails réellement vérifiés. Une maison admise ou un extérieur détaillé ne devient jamais une preuve de capacité d’hébergement.

## Vérification

`node --test scripts/architecture_bench_evidence.test.mjs` : **8/8** ; `npx vitest run tests/urbanProgrammeEvidence.test.ts --maxWorkers=1 --minWorkers=1` : **3/3** ; `npx tsc --noEmit` : **vert**. Cas couverts : simple/mixte à plusieurs niveaux, refus zéro, références absentes/invalides, géométrie manquante, déduplication ; eager positif/zéro, remplacement/historique, compact avec objets détaillés. Aucune campagne native ou UI lancée.

Sorties finales archivées dans `web/out/capacity-labels-validation/{bench-tests,panel-tests,typecheck}.log` après simplification des libellés produit. Rejeu du collecteur seulement : depuis `web/`, `node scripts/architecture_floor_programme_proof.mjs`, résultat et lecture dans `web/out/java-full-setback-proof/{structural-floor-programme-evidence.json,STRUCTURAL_FLOOR_READING.md}`. Le runner refuse d’écraser une preuve existante ; fournir un autre chemin de sortie pour reproduire. Fichiers de cette tranche figés.
