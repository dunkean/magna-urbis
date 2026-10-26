# V13 â€” campagne native fraÃ®che : PASS technique

La campagne sur le runtime gelÃ© `6ef8d3c6f2b88f884a2ad199c7b305dfaf3649c1` passe la navigation nominale de 20 s, sept vues de 40 km Ã  10 m et deux probes de cinq images Ã  10 km et 160 m. Driver et superviseur sortent avec le code 0. Les snapshots propres avant/aprÃ¨s conservent 624 empreintes runtime. DurÃ©es totales : 538,502 s pour le driver et 555,058 s pour le superviseur.

La [preuve JSON](native-e2e-v13.json) rÃ©fÃ©rence les fichiers sous `ROOT/web/out/surface/native-e2e-40km-v13/`. Le rapport original fait 3 000 695 octets, SHA256 `b6614643b985cbd88c4e3816b47476b0ae3b6b1d5b9b53385b4295e6dca793c3`. Lâ€™archivage vÃ©rifie sources, images et logs, puis rejoue les validateurs de timing, mondes affichÃ©s, quatre snapshots de logger et 17 captures dâ€™assets arbres. Aucun nouveau rendu nâ€™est lancÃ©. Aucun survivant nâ€™est trouvÃ© parmi les six PID de lancement consignÃ©s au contrÃ´le CIM ; le parent rapporte Ã©galement zÃ©ro survivant appartenant Ã  la campagne.

## Navigation et rÃ©solution rÃ©elle

Le mouvement nominal dure 20 s, sa durÃ©e rÃ©elle 20,015 s. Lâ€™Ã©cart maximal entre entrÃ©es est de 0,376 s et lâ€™Ã©cart terminal de 0,017 s. Dix rÃ©ponses sont acceptÃ©es, quatre prÃ©parations gÃ©omÃ©triques appliquÃ©es, mais deux mondes physiques distincts sont affichÃ©s dans la fenÃªtre nominale :

| Apparition aprÃ¨s dÃ©but | Monde | Grille livrÃ©e | Support natif | DÃ©codeur appris |
| --- | --- | --- | --- | --- |
| 12,808 s | `9a1ace8ca5313922bf5c9adce65df630` | 128Â² au pas 66,277 m | 30 m | non |
| 19,602 s | `00ba16bbda7a8015fbec477bbdcdb5d7` | 128Â² au pas 1,37075 m | 0,9375 m | oui |

Le dernier rendu Ã  0,46875 m natif, grille 140Â² au pas livrÃ© 0,46567 m, arrive aprÃ¨s le mouvement, au drain de 12,85 s. Il ne compte pas comme une troisiÃ¨me application dans les 20 s. Lâ€™Ã©chauffement dure 50,811 s. Le contexte canonique nâ€™est construit quâ€™une fois, avec une version dâ€™environnement unique. Lâ€™option de rÃ©tention des visuels aprÃ¨s Ã©chec Ã©tait demandÃ©e, mais nâ€™a pas servi : la navigation passe normalement.

Les temps de frame aprÃ¨s `ready` couvrent Ã©chauffement, mouvement et drain : maximum 699,89 ms, p50 16,665 ms, p95 16,882 ms, p99 17,154 ms. Ce nâ€™est pas une statistique FPS des seules 20 s ni une preuve de 60 FPS. Les marqueurs internes Worker mesurent du temps mural ; les horodatages CDP/Node restent des observations, sans attribution automatique Ã  du CPU ou Ã  une cause de pause.

La gÃ©nÃ©ration fraÃ®che utilise Python/CUDA, `coarse4/original/original`, seed numÃ©rique `2814899424497554030`. La rÃ©ponse brute 1024Â² de 4 MiB a pour SHA256 `3c7c2f32e37844842f058208e21522543bcec69125348e115390f83d5b814159`. Le contexte canonique Magna est au pas 78,125 m ; le raffinement enregistrÃ© conserve le parent en contrÃ´les B-spline et descend jusquâ€™au support natif de 0,46875 m. Le pixel dâ€™Ã©cran Ã  10 m/2048 vaut 4,8828 mm : ce nâ€™est ni une rÃ©solution source millimÃ©trique ni un nouveau relief observÃ©.

## Sources, couches et assets

`strict-source-restoration.json` confirme la restauration de deux paquets et de six archives par paquet, sans vider, remplacer ou rÃ©parer de slot. Les couches dâ€™eau typÃ©es et archives de prÃ©sentation sont conservÃ©es. Les paquets sont en `surface-1.6.0`, avec `groundResponse` disponible et validÃ©. Le sol utilise des paramÃ¨tres physiques rÃ©gionaux interpolÃ©s avant recette ; il ne dÃ©crit pas de nouveaux sols observÃ©s Ã  lâ€™Ã©chelle fine. Sol, couvert bas et arbres restent trois couches explicites et isolables.

Les 17 images passent les gates. Toutes conservent zÃ©ro triangle dâ€™eau sans niveau et zÃ©ro aire vectorielle omise, avec couverture complÃ¨te et budgets respectÃ©s. Ã€ 40 km, 51 requÃªtes de niveau en bordure sont rÃ©solues dans la tolÃ©rance de reprÃ©sentation, au maximum 0,122 mm ; les niveaux source restent inchangÃ©s. Lâ€™hydrologie reste celle de Magna. Projection sur le terrain, teinte uniforme et symbole de rive de 1,25 px sont dÃ©clarÃ©s et ne changent pas les contours physiques.

Les assets dâ€™herbe et dâ€™arbre sont rÃ©ellement appliquÃ©s, et les manifestes restent identiques avant/aprÃ¨s. Le tour soumet les plans suivants :

| Largeur | Haute gÃ©omÃ©trie | Imposteurs | Centres arbres alpha-positifs dans le frustum |
| --- | ---: | ---: | ---: |
| 40 km | 0 | 0 | 0 â€” phase 0 |
| 10 km | 0 | 0 | 0 â€” phase 0 |
| 2 560 m | 0 | 10 000 | 3 951 |
| 640 m | 0 | 2 680 | 983 |
| 160 m | 0 | 402 | 64 |
| 40 m | 2 | 24 | 4 |
| 10 m | 0 | 26 | 0 |

Ã€ 10 m, zÃ©ro centre alpha-positif reste une limite connue de LOD centrÃ© ; aucun correctif futur nâ€™est qualifiÃ© ici. Le gate de gÃ©omÃ©trie visible du tour porte sur 160 m. Dans le probe 160 m Â« all Â», les comptes alpha sont : arbres 64, troncs sÃ©parÃ©s 0, herbes 288, arbustes 17, dÃ©bris 61, rochers 31. Les imposteurs reprÃ©sentent dÃ©jÃ  lâ€™arbre ; les 64 troncs procÃ©duraux de V12 ne doivent pas Ãªtre repris comme mesure V13. Ces comptes portent sur les buffers, les centres et ALPHA, pas sur lâ€™occlusion GPU ou une surface de couronne mesurÃ©e.

Le logger utilise le mode threaded v2 dans les quatre phases : zÃ©ro rejet, zÃ©ro attente restante, acceptÃ©s et Ã©crits identiques. Les snapshots excluent leur propre ligne mÃ©triques ultÃ©rieure. Aucune erreur de script ou shader nâ€™apparaÃ®t ; les avertissements de dÃ©prÃ©ciation Terrain3D restent conservÃ©s. Les contrÃ´les prÃ©alables rapportÃ©s par le parent sont : 246 tests Surface dans 45 fichiers, TypeScript et build 445 modules PASS, 28 tests Node puis huit ciblÃ©s dont quatre nouveaux (union 32), parse Godot PASS. Ils ne sont pas relancÃ©s pour cet archivage.

## PÃ©rimÃ¨tre produit et limites

Les [vues CITY V13](native-city419-v13.json), commit de preuve `0ea1841`, sont sÃ©parÃ©es : ville retenue de 419 rÃ©alisations authentiques, 81 refus et parent Ã  15,625 m, sol legacy 1.5.3 sans groundResponse. Elles montrent la compatibilitÃ© des volumes natifs et du style blueprint ; elles ne sont pas la ville fraÃ®che ni une validation de GR.

Ce PASS technique ne vaut pas acceptation artistique, adoption du moteur ou validation dâ€™un rendu universel des assets. Les Ã©checs V9â€“V11, limites artistiques V12 et preuves nÃ©gatives de sources anciennes restent conservÃ©s. La revue artistique V13 demeure distincte de ces gates techniques.
