# V14 — campagne fraîche FAILED, preuves partielles conservées

**La campagne E2E fraîche V14 a échoué pendant le tour, avant la capture à 40 m.** La navigation est passée, mais seules cinq des sept images attendues existent ; les vues de 40 m et 10 m et les deux probes de couches ne sont pas exécutés. Le code du superviseur est 1, après 506,612 s ; le driver se termine avec `Error: Native tour exited 1, signal=null` après 499,773 s. Ce résultat n’est pas un PASS global.

La [preuve négative JSON](native-e2e-v14.json) épingle le rapport brut de 1 519 607 octets, SHA256 `08a5df2afdc95cc4463f6c6dcc2db9a998fa9285cd098be28c52f3f03faf515f`, sous `ROOT/web/out/surface/native-e2e-40km-v14/`. Le snapshot sélectionné, celui de fin du driver et `aborted-snapshot-after.json` sont identiques et propres : **945 empreintes**, runtime gelé `763081706cb199c1e7a157d5e2de3c49d38f1aa1`. Le HEAD documentaire ultérieur n’est pas présenté comme le runtime exécuté.

| Étape | Résultat conservé |
| --- | --- |
| Génération fraîche | Paquet et réponse neuronale brute sauvegardés |
| Navigation nominale 20 s | PASS |
| Tour 40 km → 10 m | FAILED avant l’image 40 m, cinq images sur sept |
| Probes de couches | Non exécutés ; le champ brut agrégé `layerProbeStatus` vaut `failed` |
| Restauration stricte des sources | PASS indépendant, deux paquets × six archives |
| Résultat global | FAILED |

## Navigation partielle réussie

Le mouvement nominal dure 20 s, sa durée réelle 20,005 s. L’écart maximal entre entrées est de 0,541 s et l’écart terminal de 0,05 s. Huit réponses sont acceptées et trois préparations géométriques appliquées, mais **un seul monde distinct est affiché pendant la fenêtre nominale** : `247dae74b1ca923a076f0f4cc5d59600`, à **17,092 s**, support natif 30 m et décodeur appris non utilisé.

Le support natif de 0,46875 m avec décodeur appris apparaît seulement au drain, après le mouvement ; le drain dure 11,094 s et finit prêt. Il ne s’agit pas d’une application fine dans les 20 s. L’échauffement dure 42,493 s. Le maximum de frame enregistré après `ready` est de 883,163 ms, p50 16,67 ms ; cette collecte couvre le processus complet, pas les seules 20 s et ne démontre pas 60 FPS. L’option de rétention des visuels après échec de navigation était demandée, mais cette navigation passe : elle n’assouplit ni ne remplace le gate du tour.

## Tour interrompu et conservation de la source réelle

Les cinq PNG existants sont les vues de **40 000, 10 000, 2 560, 640 et 160 m**. Leurs SHA sont vérifiés contre les événements de capture. Il n’existe ni `05_40m_top.png`, ni `06_10m_top.png`, ni métriques finales du tour. Les captures sauvegardées ne justifient donc pas une qualification des deux échelles manquantes ou des couches non testées.

Le stderr natif conserve **1 117 occurrences** de :

```text
Terrain preparation failed: height batch source sample budget; previous rendered source retained
```

Les nouvelles préparations dépassant le budget de samples du batch de hauteurs sont refusées ; le terrain réellement affiché précédent reste en place. Une réponse reçue ou un paquet accepté ne prouve pas qu’un nouveau terrain a été appliqué. Le dernier monde capturé reste celui de la vue à 160 m ; le dernier paquet accepté possède une autre identité, conservée dans la preuve. Aucune capture à 40 m sur un proxy ou une source silencieusement substituée n’est présentée comme valide.

Le parent a validé la ligne de commande du viewer appartenant à la campagne, puis arrêté explicitement le PID 208296 et ses descendants 212064 / 198724. Le driver 178260 s’est ensuite terminé avec l’erreur du tour. C’est un arrêt explicite, pas une terminaison normale du tour. Le contrôle CIM ultérieur ne trouve aucun survivant parmi les six PID consignés ; cet archivage n’a arrêté aucun processus et n’a touché aucun service partagé.

## Sources et suite encore à qualifier

La restauration stricte est conservée sans vider, remplacer ou réparer de slot :

| Paquet | SHA256 | Archives |
| --- | --- | ---: |
| `fresh-source.surfacebin` | `a21a4af82583efc29c9f7330fbe5c9dbf4b6d0a9a145dbf5bda4de58e3c34b36` | 6 |
| `live-refinement.surfacebin` | `246dfaaad5f1d352ef560d89c941e79385c13f8513383e0a548c4c72fb872b80` | 6 |

Les outils, empreintes des archives, types des couches d’eau, logs et snapshot d’abandon restent référencés dans la preuve. Leur PASS ne convertit pas l’échec du tour en succès. Le correctif borné du budget de sources du batch de hauteurs est une étape suivante **encore à qualifier sur un nouveau chemin de campagne** ; aucun résultat V14 n’est réétiqueté après correction.

La [preuve CITY419 V14](native-city419-v14.json) est distincte : captures et compositions terminées sur une ville retenue de 419 réalisations, 81 refus et parent à 15,625 m. Elle ne constitue pas cette campagne fraîche et ne remplace pas les images de 40/10 m ou les probes manquants. Aucun résultat ici n’est une acceptation artistique, une promesse de FPS ou une adoption de moteur.
