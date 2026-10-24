# Raster de canopée natif — preuve CPU V16

Le helper Rust porte le rasteriseur scalaire de `SurfaceCanopy` : il dessine les couronnes fournies, sans choisir, déplacer, créer ou amincir les arbres. Godot conserve la création des images, leurs mipmaps et le hash d’atlas. Le cœur est le commit `8e06d9d`. La [preuve JSON](evidence/native-canopy-cpu-v16.json) épingle exécutables, source, références, rapports et logs ; elle ne qualifie ni GPU, campagne E2E, FPS ni résultat artistique.

## Données et oracle

La source retenue V15 est `live-refinement.surfacebin`, **76 589 841 octets**, SHA256 `f9bdb75671c21ceb402a817cc244a076487f7b88c267773b785f4de942055874`. Elle contient **1 059 candidats, dont 1 004 arbres** : ce n’est pas un test portant sur des centaines de milliers d’arbres. La sélection diagnostique prend un arbre existant sur trois dans l’ordre source, soit **335 sélectionnés** ; elle n’est pas une politique de rendu de production. Le masque/produit corrigé est identifié par `74edf966059a17fd44df22d24f4ee055f780d84196ee9c54703fa3b9e46ecbe9`.

La référence vient du commit gelé `c53cd7e6de1b8efa8b7ea8d5d747505b87e6f237`. La comparaison indépendante du texte, après normalisation LF, confirme :

- `production-reference.gd` : seul le nom de classe change ; résolution **2048** conservée ;
- `reference.gd` pour les quatre petits cas : nom de classe et **seule constante de résolution 2048 → 256** changent.

Le test retenu pleine résolution couvre 2048² pixels. Les quatre images sont byte-exactes ; coverage, normales et couleurs incluent leurs mipmaps, tandis que counts reste sans mipmaps comme dans l’oracle :

| Image | Octets, base + mipmaps applicables | SHA256 scalaire = natif |
| --- | ---: | --- |
| Coverage RF | 22 369 620 | `454d9da71a2390ab736c3de1ad13949d97ec01aa50cf71c13105a44901697983` |
| Counts RGBAF | 67 108 864 | `b8ecc8100a5a7dc5c2a4f3f219d8421e3c9927462a167dd271503fcedd9bf699` |
| Normales RGBAF | 89 478 480 | `6137143c028efcd8d762d0cb71df6d39b7e18487cdfbf9f0908200ce03271fe2` |
| Couleurs RGBAF | 89 478 480 | `47682045c5fed70f5a771148b6511a9ea27a2bc8e8851083b33569cc3b169c0d` |

L’atlas reste `4c0d3bc39cfdef9fd1dd6c9ffd0f97da2defa4c3089c9fc4383f677c7be6c923`. La source, les IDs et la sélection restent inchangés.

## Exécutables et temps observés

`retained.json` a exécuté le binaire SHA256 `cc16070cc8aebfc673c0711b6fbae07b4903af2eccc08ff9204843def9785b56`, préservé exactement dans `executed-canopy-batch.exe`. `retained-final.json` utilise `b855cc3780947752a9eeaa3ddada435fe47965820998600f0feeb6a9bc4e005c`, dont une copie est également conservée dans les sorties ignorées OWN. Le parent rapporte un rebuild après des ajouts uniquement `#[cfg(test)]`. Indépendamment de cette attribution, les deux binaires sont épinglés et donnent les mêmes quatre hashes et le même atlas.

Le run final réutilise l’oracle scalaire déjà sauvegardé : **`scalarRecomputed:false`, `scalarWallMs:null`**. Il ne constitue pas une deuxième mesure scalaire. Le hash du rapport oracle réutilisé est vérifié. Le hash d’entrée natif change notamment parce que le job inclut l’identité de l’exécutable ; le hash du payload de sortie reste identique.

| Observation murale CPU | Run initial | Run final |
| --- | ---: | ---: |
| Scalaire, préparation complète | 4 845,373 ms | non recalculée |
| Natif, préparation complète | 2 541,664 ms | 2 543,688 ms |
| Calcul natif, allocations et vérifications incluses (`sampleMs`) | 312,6046 ms | 319,284 ms |
| Wrapper batch, entrée/processus/décodage (`totalMs`) | 1 838,708 ms | 1 832,458 ms |

Le temps complet inclut ensuite images, mipmaps et hash dans Godot ; `Batch.totalMs` les exclut. Ces observations fixes ne sont pas une étude statistique isolant la charge système, du CPU échantillonné ou une mesure de chaîne GPU. Aucun gain de FPS ou de QoS globale n’est déduit.

## Rejets, annulation et budgets

Le run réel archivé `final-tests.json` sort avec le code 0 : **47 contrôles, zéro échec**. Le stdout FD contient exactement le résultat JSON attendu et le stderr est vide. Il comprend les quatre cas legacy/asset/±1e9/vide, la comparaison base+mipmaps, les rejets de types et de framing ainsi que de vraies annulations/timeouts. Les deux processus concernés, PID 212836 et 216860, ne sont plus actifs lors du retour et leurs dossiers temporaires sont supprimés. Les quatre tests Rust, trois tests Node du gate et dix tests de profil sont rapportés PASS par le parent ; leurs logs bruts ne sont pas inventés dans ce dossier, ni leurs tests relancés pour cet archivage.

Trois findings de la revue statique ont été corrigés :

- types/extrema/temps/compteurs stricts, avec `trees + unsupported == inputTreeCount` et `selected <= trees` ;
- arrêt du seul processus possédé, attente jusqu’à deux secondes ; si l’OS ne termine pas le processus, retour `failed/abortIncomplete` sans déclarer un nettoyage ou une annulation réussis ;
- séparation des clés `gd:canopy-r6` et `native:<SHA64valide>` ; hash d’exécutable absent ou invalide refusé avant réemploi du cache.

Le protocole limite chaque axe d’atlas à une puissance de deux entre **2 et 2048**, le masque à **1024**, les arbres à **100 000**, le travail à **64 Mi pixels visités**, le wire à **256 MiB** et le manifeste à **1 MiB**. Le plafond connu du processus natif est **384 MiB** ; l’estimation du cas retenu vaut **303 103 360 octets**. Elle n’est pas le RSS global de Godot. Le plan garde **240 octets par pixel d’atlas** pour les tableaux/copies/images/uploads et ajoute une réserve fixe de **80 MiB** pour le batch ; caches, ancien atlas et processus natif restent des postes distincts. Ces bornes ne sont pas une mesure RSS et ne suppriment pas les refus si un budget est dépassé.

Le flag explicite et le profil épinglé incluent le helper (83 artefacts runtime). Cela ne constitue pas une qualification V16 E2E ou GPU. Le transfert d’ombre reste **legacy optical par défaut** ; `deltaSolar` est une option séparée. Aucun résultat de rendu ou artistique n’est attribué à ce test CPU.
