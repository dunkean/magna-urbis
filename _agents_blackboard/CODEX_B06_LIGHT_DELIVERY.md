# Entrées structurelles légères — livraison du 23 octobre 2026

**Sources Houses intégrées et figées.** CLI de production :
`web/out/b06-light-production-proof/plan_replay.exe`, SHA256
`618535bf2b10b5c504e53e2a1fec5049136e8baf12970683f03916b3d17df84f`.
Il inclut les livraisons nominal/terrain et linteaux précédentes.

Les maisons Single à poteaux maîtres et face ouverte préparent maintenant leurs
vrais opérateurs structurels avant la finalisation de l'entrée. Les primitives
sont partagées avec le constructeur détaillé ; aucune pièce intérieure ni mesh
de toit détaillé n'est produit pendant cette préparation. Le portail provient de
ce squelette et conserve sa pose. Murs découpés, poteaux, cadres et linteaux
restent dans les droits et l'occupation ; seuls leurs vrais contacts au sol
participent à l'assise.

Cette finalisation conserve le gagnant du budget : un raccord impossible garde
la grande maison et sa limite explicite, sans la remplacer par un petit nominal
pour obtenir une porte. La sauvegarde nominale des Single simples reste
inchangée. Aucun identifiant de recette ni nouveau seuil d'aire ne décide ce choix.

| Vérification | Résultat |
|---|---|
| Production | 408 tests release, 411 debug ; aucun ignoré ; 201 sources stables |
| C7921 archivé | 6225 admis / 1689 refus / 7 ouverts ; aucune ancienne admission perdue |
| Entrées C | 1221 gains, aucune ancienne entrée perdue ; sources, variantes et étages conservés |
| Programme C | 6002 cibles connues inchangées à la tolérance de l'audit ; 223 références inconnues |
| Physique C | 6225 droits et assises Ground contrôlés ; aucune collision ni faute terrain ; 506 avertissements source strictement hérités |
| Ancien Java1752 | 1338 / 407 / 7 ; 102 entrées gagnées, aucune cible dégradée ; 16 avertissements hérités |
| Europe | 256 demandes et 8 témoins ; plans inchangés, 8 extérieurs + 8 intérieurs valides |

Les 124 sorties C du vrai produit sont identiques octet par octet au candidat
isolé audité `da619c…`. L'échantillon fixe de douze C donne douze plans exacts,
douze extérieurs valides et neuf intérieurs valides. Les trois négatifs gardent
leur géométrie gagnante et leur refus intérieur explicite ; aucun remplacement
de témoin ni portail d'oracle. Cela ne certifie pas tous les intérieurs du corpus.

Treize fichiers promus : quatre fichiers de production, quatre modules de
tests, cinq fixtures. L'oracle détaillé de recherche est exclu. Catalogue,
export admission, schéma d'archive et version de contrat sont inchangés ; les
témoins City n'ont pas besoin d'être régénérés pour cette livraison. Les autres
problèmes de capacité, les compositions de pavillons et le million restent ouverts.

Le rendu 3D reçoit séparément un LOD graphique conservateur : petites pièces
omises sous deux pixels, grandes pièces et murs conservés, picking identique au
cache dessiné. Quinze tests d'intégration et TypeScript passent. Voir
`CODEX_BUILDING_FEATURE_LOD_DELIVERY.md` ; les mesures CPU de triangles ne
prétendent pas mesurer FPS ou mémoire GPU résidente.

Preuves : `web/out/b06-light-production-proof/{build-proof,production-comparison}.json`,
`web/out/java-c-b06-light-v2-proof/independent-audit/`,
`web/out/java-c-b06-light-v2-proof/C-targeted-details/`,
`CODEX_B06_LIGHT_V2_JAVA_AUDIT.md`. Aucun moteur ou serveur n'a été relancé par Codex.
