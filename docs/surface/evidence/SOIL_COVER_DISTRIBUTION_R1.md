# Sol et couvert : contrôle natif R1 négatif

**Refus artistique — ne pas intégrer le runtime `2b679d1` en production.**

Le probe natif conservé dans `OWN/web/out/surface/ground-cover-quality/native-r1`
termine en 82,263 s, code 0, sur RTX 4090. Les 28 PNG couvrent quatre poses TOP
2560/160/40/10 m, avec le même replay explicite de la source retenue V15. Il n'y
a ni nouvelle génération ni nouveau relief observé. Le source/world/contexte,
les hauteurs, inventaires et buffers restent identiques dans chaque A/B ; les
quatre paires de diagnostic 7 (moyenne GR brute) sont pixel-identiques.

Ces contrôles techniques ne suffisent pas : à 160 m, le nouvel assemblage forme
des rubans sinusoïdaux répétés au lieu d'une organisation naturelle. Les huit
slots du couvert contiennent aussi des recettes répétées qui doivent être
fusionnées avant la répartition, au lieu de créer des intervalles alternés.
Les nouvelles feuilles montrent une inversion du winding par rapport aux
front faces horaires de Godot et apparaissent trop sombres. Ces deux défauts
doivent être corrigés et contrôlés sur de nouvelles images ; R1 ne sera pas
requalifié par les futurs tests CPU.

Le stderr conserve des messages `OpVectorExtractDynamic is not supported yet`
et les avertissements de dépréciation. Ils ne sont pas effacés. La preuve
[JSON](soil-cover-distribution-r1.json) épingle les logs, images, empreintes,
checks de source et le replay de pages : 1059 anciens records XYZ/IDs/rangs
exacts, aucune modification des objets retenus hors candidats/pages.

Le GPU est libéré ; le contrôle CIM à 09:51:31 UTC ne trouve aucun Godot dont la
commande contient ce worktree OWN. Aucun processus extérieur n'est terminé.
Le correctif suivant reste CPU tant que ROOT n'a pas annoncé une nouvelle
disponibilité après le test utilisateur.
