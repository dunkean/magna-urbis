# V13 — campagne native fraîche : PASS technique

La campagne sur le runtime gelé `6ef8d3c6f2b88f884a2ad199c7b305dfaf3649c1` passe la navigation nominale de 20 s, sept vues de 40 km à 10 m et deux probes de cinq images à 10 km et 160 m. Driver et superviseur sortent avec le code 0. Les snapshots propres avant/après conservent 624 empreintes runtime. Durées totales : 538,502 s pour le driver et 555,058 s pour le superviseur.

La [preuve JSON](native-e2e-v13.json) référence les fichiers sous `ROOT/web/out/surface/native-e2e-40km-v13/`. Le rapport original fait 3 000 695 octets, SHA256 `b6614643b985cbd88c4e3816b47476b0ae3b6b1d5b9b53385b4295e6dca793c3`. L’archivage vérifie sources, images et logs, puis rejoue les validateurs de timing, mondes affichés, quatre snapshots de logger et 17 captures d’assets arbres. Aucun nouveau rendu n’est lancé. Aucun survivant n’est trouvé parmi les six PID de lancement consignés au contrôle CIM ; le parent rapporte également zéro survivant appartenant à la campagne.

## Navigation et résolution réelle

Le mouvement nominal dure 20 s, sa durée réelle 20,015 s. L’écart maximal entre entrées est de 0,376 s et l’écart terminal de 0,017 s. Dix réponses sont acceptées, quatre préparations géométriques appliquées, mais deux mondes physiques distincts sont affichés dans la fenêtre nominale :

| Apparition après début | Monde | Grille livrée | Support natif | Décodeur appris |
| --- | --- | --- | --- | --- |
| 12,808 s | `9a1ace8ca5313922bf5c9adce65df630` | 128² au pas 66,277 m | 30 m | non |
| 19,602 s | `00ba16bbda7a8015fbec477bbdcdb5d7` | 128² au pas 1,37075 m | 0,9375 m | oui |

Le dernier rendu à 0,46875 m natif, grille 140² au pas livré 0,46567 m, arrive après le mouvement, au drain de 12,85 s. Il ne compte pas comme une troisième application dans les 20 s. L’échauffement dure 50,811 s. Le contexte canonique n’est construit qu’une fois, avec une version d’environnement unique. L’option de rétention des visuels après échec était demandée, mais n’a pas servi : la navigation passe normalement.

Les temps de frame après `ready` couvrent échauffement, mouvement et drain : maximum 699,89 ms, p50 16,665 ms, p95 16,882 ms, p99 17,154 ms. Ce n’est pas une statistique FPS des seules 20 s ni une preuve de 60 FPS. Les marqueurs internes Worker mesurent du temps mural ; les horodatages CDP/Node restent des observations, sans attribution automatique à du CPU ou à une cause de pause.

La génération fraîche utilise Python/CUDA, `coarse4/original/original`, seed numérique `2814899424497554030`. La réponse brute 1024² de 4 MiB a pour SHA256 `3c7c2f32e37844842f058208e21522543bcec69125348e115390f83d5b814159`. Le contexte canonique Magna est au pas 78,125 m ; le raffinement enregistré conserve le parent en contrôles B-spline et descend jusqu’au support natif de 0,46875 m. Le pixel d’écran à 10 m/2048 vaut 4,8828 mm : ce n’est ni une résolution source millimétrique ni un nouveau relief observé.

## Sources, couches et assets

`strict-source-restoration.json` confirme la restauration de deux paquets et de six archives par paquet, sans vider, remplacer ou réparer de slot. Les couches d’eau typées et archives de présentation sont conservées. Les paquets sont en `surface-1.6.0`, avec `groundResponse` disponible et validé. Le sol utilise des paramètres physiques régionaux interpolés avant recette ; il ne décrit pas de nouveaux sols observés à l’échelle fine. Sol, couvert bas et arbres restent trois couches explicites et isolables.

Les 17 images passent les gates. Toutes conservent zéro triangle d’eau sans niveau et zéro aire vectorielle omise, avec couverture complète et budgets respectés. À 40 km, 51 requêtes de niveau en bordure sont résolues dans la tolérance de représentation, au maximum 0,122 mm ; les niveaux source restent inchangés. L’hydrologie reste celle de Magna. Projection sur le terrain, teinte uniforme et symbole de rive de 1,25 px sont déclarés et ne changent pas les contours physiques.

Les assets d’herbe et d’arbre sont réellement appliqués, et les manifestes restent identiques avant/après. Le tour soumet les plans suivants :

| Largeur | Haute géométrie | Imposteurs | Centres arbres alpha-positifs dans le frustum |
| --- | ---: | ---: | ---: |
| 40 km | 0 | 0 | 0 — phase 0 |
| 10 km | 0 | 0 | 0 — phase 0 |
| 2 560 m | 0 | 10 000 | 3 951 |
| 640 m | 0 | 2 680 | 983 |
| 160 m | 0 | 402 | 64 |
| 40 m | 2 | 24 | 4 |
| 10 m | 0 | 26 | 0 |

À 10 m, zéro centre alpha-positif reste une limite connue de LOD centré ; aucun correctif futur n’est qualifié ici. Le gate de géométrie visible du tour porte sur 160 m. Dans le probe 160 m « all », les comptes alpha sont : arbres 64, troncs séparés 0, herbes 288, arbustes 17, débris 61, rochers 31. Les imposteurs représentent déjà l’arbre ; les 64 troncs procéduraux de V12 ne doivent pas être repris comme mesure V13. Ces comptes portent sur les buffers, les centres et ALPHA, pas sur l’occlusion GPU ou une surface de couronne mesurée.

Le logger utilise le mode threaded v2 dans les quatre phases : zéro rejet, zéro attente restante, acceptés et écrits identiques. Les snapshots excluent leur propre ligne métriques ultérieure. Aucune erreur de script ou shader n’apparaît ; les avertissements de dépréciation Terrain3D restent conservés. Les contrôles préalables rapportés par le parent sont : 246 tests Surface dans 45 fichiers, TypeScript et build 445 modules PASS, 28 tests Node puis huit ciblés dont quatre nouveaux (union 32), parse Godot PASS. Ils ne sont pas relancés pour cet archivage.

## Périmètre produit et limites

Les [vues CITY V13](native-city419-v13.json), commit de preuve `0ea1841`, sont séparées : ville retenue de 419 réalisations authentiques, 81 refus et parent à 15,625 m, sol legacy 1.5.3 sans groundResponse. Elles montrent la compatibilité des volumes natifs et du style blueprint ; elles ne sont pas la ville fraîche ni une validation de GR.

Ce PASS technique ne vaut pas acceptation artistique, adoption du moteur ou validation d’un rendu universel des assets. Les échecs V9–V11, limites artistiques V12 et preuves négatives de sources anciennes restent conservés. La revue artistique V13 demeure distincte de ces gates techniques.
