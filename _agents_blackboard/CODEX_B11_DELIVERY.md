# Entrées des maisons à pignons à redents — livraison

23 octobre 2026, 05:22 Paris. **Sources Houses intégrées et figées.** Le repli terrain initial reste expérimental, dans une copie séparée ; il ne fait pas partie de cette livraison.

La préparation finale d'une entrée native accepte désormais les toitures `RF-STEEP-STEP` et leurs détails déclarés. Elle conserve le corps déjà placé, sa source, sa variante, ses étages et sa pose. Les autres contraintes restent identiques ; aucune porte ou pose supplémentaire n'est essayée.

## Résultats

- Deux corpus européens de 128 demandes : admissions conservées, respectivement 125 et 111. Sept des dix-huit entrées B11 auparavant différées sont récupérées ; les onze autres restent explicitement refusées. Les sept bâtiments passent leur extérieur et leur intérieur natifs. Les 218 bâtiments non-B11 ne changent pas.
- Source, dimensions, pose et forme des maisons conservées. Le passage de chaque nouvelle entrée est exporté pour les occupations suivantes. Audits indépendants : aucun nouveau chevauchement, droits et assises valides sur les deux corpus.
- Java historique, 1 752 demandes : 1 010 admis, 735 refus, 7 espaces ouverts. Les 28 sorties et leurs contextes d'occupation sont identiques octet pour octet à la livraison précédente.
- Huit autres témoins détaillés passent toujours leur extérieur et leur intérieur. Ces échantillons ne certifient ni une ville complète ni sa capacité d'hébergement.

La maison européenne `cbfa…` conserve ses 132,477 m² et peut désormais réaliser son intérieur. Sa cible de 313,9 m² reste non atteinte.

## Validation de production et provenance

**391 tests unitaires passent en debug, 388 en release.** Trois témoins qui reproduisent volontairement un ancien crash d'`i_overlay` attendaient une assertion disponible seulement en debug. Leur configuration est maintenant limitée à ce profil ; les tests de conservation de la géométrie réparée restent actifs dans les deux profils. Le premier échec release et les deux suites finales sont conservés dans les preuves.

Fichiers de production : filtre dans `engine.rs`, enregistrement et nouveaux tests B11 dans `plans.rs` / `b11_native_entry_tests.rs`, fixture dédiée ; trois attributs de tests historiques dans `engine.rs` et `floor_complement.rs`. Aucun changement core, catalogue, API, version d'archive ou serveur.

CLI de production figé : `web/out/b11-native-entry-production-proof/plan_replay.exe`, SHA256 **`a1ec113e0fde4a6e8275fce6937fbc2a8ae2a4fd9fccc01750ca1df0f780d001`**. CLI `houses.exe` : **`4faac8475ea730917e85e56cd849914d735fafe1dfe2c2b96e0a25cb3f3a8cad`**.

Les 129 fichiers suivis sont restés identiques entre le manifeste final et la fin du build. Les 256 demandes européennes, 8 témoins et 1 752 demandes Java ont ensuite été rejoués avec ce binaire de production : toutes les sorties sont identiques aux preuves du binaire isolé. Voir `build-proof.json`, `production-isolated-equivalence.json`, `replay/` et `java-full/` dans ce répertoire.

Preuves physiques et détaillées : `CODEX_B11_NATIVE_ENTRY_ISOLATED_PROOF.md`, `CODEX_JAVA_FULL_B11_ENTRY_RESULTS.md`. Ces rapports gardent leur provenance initiale ; la promotion et son équivalence sont établies ici. Le moteur utilisateur n'a pas été relancé par Codex.
