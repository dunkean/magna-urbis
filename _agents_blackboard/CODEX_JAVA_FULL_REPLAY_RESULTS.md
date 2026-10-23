# Java1752 — preuve complète avec occupation régénérée

23 octobre 2026. **1010 admis /735 refus /7 ouverts dans les deux versions**, aucune perte/gain de plan ni changement de source/variante/étage. Les refus sont exacts. Rejeu réel de `streamArchitectureSource`, 28 lots, paramètres/graines/ordre conservés, contexte neuf par CLI ; 158→181 références voisines reconstruites et vérifiées. Préflight deux lots et contrôle complémentaire sans native : toutes les surfaces consommateur mutées, deuxième payload toujours exact.

Gain de qualité : **56 améliorations,2 reculs**,+2031,284m² d'emprise nette ; cibles±10%441→446. Les reculs096c(108,103→104,527m²,cible108,1) etfcfb(695,679→638,700,cible695,7) sont conservés : le guide réduit atteint la tolérance après2admissions, donc la recherche s'arrête avant l'ancienne pose pleine. Demandes exactes sans voisins ; aucune cascade cachée. Ce sont des compromis de la règle d'arrêt, pas des pertes d'admission.

**646 entrées natives retenues**,192 différées,172 hors passe. Aucun intérieur réalisé. Audit GEOS1010/1010, collisions globales entre lots et terrain646assisesSingle : tous verts, erreur altitude2,52e−9m. Les assises non préparées ne sont pas certifiées.735refus :681terrain,49accès,5domaine.14 anciens corps restent hors rapport source au millimètre.

Guide :3123évaluations/485traces,82réductions ; plafonds8/1 et8dimensions/24admissions respectés. Somme native28lots2675→4116ms : parcours unique, processusCLI séparés, pas UI/serveur persistant, aucun gain de vitesse revendiqué.

Refus par fonction : 487 domestic, 86 mixed, 97 collective, 44 workshop, 21 warehouse. Principaux rôles archivés : 355 tenements, 102 mansions, 86 shops, 66 shrines, 30 houses, 28 smithies. Les 681 refus terrain dominent ; les 49 refus d'accès et 5 de domaine sont distincts. [Tableau complet fonction/rôle/motif](../web/out/java-full-terrain-entry-proof/refusal-breakdown.json), joint par ID aux demandes, sans inventer la recette d'un refus.

Cette comparaison porte sur **tous les sites historiques**, pas une nouvelle ville R5 ni la population 100k. Les anciens rôles, dont dharamshala, sont conservés. 1010 contre 484 historiques cumule les évolutions antérieures ; le seul changement comparé ici ne modifie pas le nombre de plans.

[Résultats et limites](../web/out/java-full-terrain-entry-proof/RESULTS.md) · [données complètes](../web/out/java-full-terrain-entry-proof/comparison.json) · [manifest](../web/out/java-full-terrain-entry-proof/manifest.json).

Preuve cac76→c90c figée ; nouvelle phase retrait à isoler. Aucun Rust, Cargo, serveur ou navigateur utilisé.
