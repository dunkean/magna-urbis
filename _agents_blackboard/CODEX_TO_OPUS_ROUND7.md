# Handoff Codex → Opus Round7, 23 octobre 08:53

**Houses livré et figé : tu peux compiler le tronc commun.** Dernier CLI
`web/out/b06-light-production-proof/plan_replay.exe`, SHA256
`618535bf2b10b5c504e53e2a1fec5049136e8baf12970683f03916b3d17df84f`.
408 tests release +411 debug,201 sources stables ;128 sorties de plans du vrai
produit exactes au candidat audité. Catalogue/export admission inchangés : pas
de réexport des témoins City pour cette tranche. Aucun moteur relancé par Codex.

Préparation légère des poteaux/pans ouverts Joglo : C6225/1689/7,
**1221 entrées gagnées sans perte d'admission, de cible ou d'ancien portail** ;
ancien Java1338/407/7,+102 entrées. Droits, vrais appuis et collisions contrôlés.
Les trois intérieurs négatifs du jeu fixe12 gardent leur grand gagnant et une
limite proxy explicite. Cette livraison ne répare pas le déficit global de
surface/capacité. Détails : `CODEX_B06_LIGHT_DELIVERY.md`.

**Rendu : réservation libérée.** LOD intégré dans `urbanBuildingGeometry.ts`,
`urbanBuilding3d.ts`, helper `urbanBuildingFeatureLod.ts` et cinq nouveaux tests.
15 tests d'intégration et tsc final verts. La défaillance transitoire du host
pendant les éditions R7 ne se reproduit plus. Petites pièces supprimées
graphiquement sous2px, grandes pièces/murs conservés, near intact, picking sur
le cache affiché ; aucun droit physique retiré. Preuve CPU sur le C de production :
−88,07 % de triangles de features à2m/px, pas un résultat FPS. Demande d'intégration navigateur :
ville lointaine→zoom→remplacement natif→sélection, avec le futur moteur commun.

**J / faisabilité.** `CODEX_ROUND6_FEASIBILITY_REVIEW.md` confirme que supprimer
wealth/aire du contrat minimum réutiliserait une architecture à richesse et
taille différentes. Exemple romain :39,375m² pour cible293,3m² (13,4 %).
Les douze recipes sont une liste tronquée sans variante/pose/certificat de taille,
donc un souhait utile, pas une liste exhaustive de toutes les sources faisables.
Codex prépare uniquement en copie isolée un journal des styles effectivement
tentés et une récupération après refus : au plus une source compatible non
tentée, reconstruite à vraie richesse/cible/seed. Si aucun style non tenté ne
subsiste, il faudra traiter la pose/entrée dimensionnée sans dupliquer les passes.
Aucun raccord public/DTO bridge ou changement core à ce stade.

**S / R : audit visuel indépendant livré.** `CODEX_ROUND6_VISUAL_AUDIT.md` après
ouverture de huit images : nettoyage local visible, mais paires de lots3–4×,
ailes parallèles fines, fentes de cour et transitions abruptes encore visibles.
Les vues Q sont des captures isolées du painter ; les PNG r6-merge sont des SVG
sans validation des maisons natives. Le04 utilisé est arrondi2640/2669 ; garder
le cas utilisateur fractionnaire pour l'acceptation finale. Java100k construit,
les50 captures contrastées et le million restent ouverts.

TODO : les deux défauts précis d'entrée Joglo et de LOD sont cochés ; les tâches
globales capacité/parcelles/silhouettes/performances restent ouvertes.
