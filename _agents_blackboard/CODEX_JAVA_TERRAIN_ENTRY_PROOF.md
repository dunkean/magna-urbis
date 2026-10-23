# Java128 — guide terrain et entrée Single, preuve finale

23 octobre 2026. **64 admis /60 refus /4 ouverts avant et après**, aucun changement de recette/variante/étage, refus et ouverts exacts. Six améliorations d'emprise, aucune régression d'emprise : +173,717 m² sur les63 plans ciblés ;26→27 à±10 % de la cible. Ce n'est pas une mesure de capacité résidentielle.

**39 entrées natives retenues**,13 différées faute de raccord dégagé à la pose existante,12 hors passe. Trois détails natifs ciblés : extérieurs3/3 conservés ; intérieurs0/3→2/3,4100 reste refusé par la garde d'entrée. Aucun intérieur inventé ni changement de porte sur cette passe.

Audit GEOS :64 droits vérifiés, aucune violation. Audit terrain indépendant :39 assises Single préparées, aucune violation, altitude maximale1,23e−9 m. Les assertions portent explicitement sur `rightsViolationBuildings`, `allPreparedTerrainViolationBuildings`, pertes/gains et sources ; elles passent. Les25 plans sans préparation explicite ne sont pas certifiés par l'audit terrain.

Guide :32 traces,206 évaluations,7 réductions allouées pour6 améliorations ; plafonds8 évaluations/1 réduction et8 dimensions/24 admissions respectés. Coût mesuré par root sur cinq alternances : médiane182→204 ms (+12,09 %),MAD18→3,étendues152–200/185–242 ; machine partagée, sorties répétées exactes. Aucun gain de vitesse annoncé.

Planche054 ouverte/vérifiée :75,198→27,796→57,725 m² pour cible75,2, même caméra/cadastre. Le prototype62,973 utilisait une façade distante de5,6845 m ; ce n'est pas le même ancrage. Un ancien corps B15 reste hors proportions source ; les60 refus et les déficits des grandes cibles restent visibles.

- [Résultats complets et limites](../web/out/java-terrain-entry-proof/RESULTS.md)
- [Planche054 à trois étapes](../web/out/java-terrain-entry-proof/054-before-aspect-terrain.png)
- [Rapport JSON et assertions](../web/out/java-terrain-entry-proof/report.json)
- [Coût mesuré séparément par root](../web/out/single-entry-terrain-cli-proof/java-cost/report.json)

CLI après SHA256 `c90c4d64eb6815dbd39e1d85f673bbb6d87086391695aaa3909721cb378a0c64`. Aucun Rust, Cargo, serveur ou nouvelle génération de ville dans cette validation.
