# V15 : campagne native fraîche, PASS technique

La campagne sur le runtime gelé `c53cd7e6de1b8efa8b7ea8d5d747505b87e6f237`
termine avec le statut `complete`, superviseur code 0 : navigation nominale de
20 s, sept vues TOP de 40 km à 10 m, puis deux probes de cinq images à 10 km et
160 m. Durées : **425,603 s pour le driver**, **439,214 s pour le superviseur**.
Ce résultat concerne les contrats techniques mesurés ; il ne prononce pas
l'acceptation artistique, la qualité oblique ou une garantie de production.

La [preuve compacte](native-e2e-v15.json) contient les chiffres propres à V15,
les empreintes et les références sous
`ROOT/web/out/surface/native-e2e-40km-v15/`. Le rapport brut fait 3 289 391 octets,
SHA256 `e7514e650de47f11958ce0db15cbea0373fb2d1520b1b64db3818eacf3051d11`.
Les snapshots propres avant/après sont identiques pour **945 fichiers runtime**.
Le profil explicite `surface-v2` conserve ses **82 fichiers** et son empreinte
effective `fcdb21fd9bd34d26023b4c3da8fe5adde74da1bcf10877ee010a0e10aacb66ce`.
L'archivage relit et vérifie les fichiers enregistrés ; il ne lance aucun test,
nouveau rendu, benchmark, profil ou appel neural.

## Mouvement et vraie résolution

La fenêtre nominale reste strictement de 20 s, ticks 57 883 à 77 883. La fin
réelle est au tick 77 896, soit 20,013 s. Le plus grand intervalle d'entrée vaut
0,507 s, l'intervalle terminal 0,050 s. Dix réponses sont acceptées. **Deux
événements d'affichage correspondent à deux mondes frais distincts**, chacun
dans la fenêtre nominale, source réellement contributrice au point observé :

| Apparition après début | Serial / monde | Grille livrée | Support natif | Décodeur |
| --- | --- | --- | --- | --- |
| 15,059 s | 62 / `0ad40452b4103adc210defca2145c686` | 128², pas 66,277133 m | 30 m | non |
| 18,995 s | 276 / `ee30a8bbe0d44c55f339addb5eba5177` | 129², pas 0,534224 m | 0,46875 m | oui |

Le premier monde est une nouvelle réponse de vue reconstruite depuis le parent,
pas un nouveau détail neural fin. Le second apporte le raffinement appris dans
les 20 s. Le rendu final demandé en `preview=false`, résolution demandée 512,
est livré en **140² au pas 0,465669 m**, support natif 0,46875 m : la limite
source prévaut sur le nombre demandé. Il est appliqué au tick 84 301, après la
fenêtre ; il ne compte pas comme un troisième monde pendant le mouvement.
Échauffement : 35,337 s ; drain : 6,461 s. Le contexte canonique est construit
une fois, avec une seule version d'environnement. La rétention des visuels
après échec était demandée mais n'a pas servi.

La statistique `navigationFrameWallMs` couvre toutes les frames après `ready`,
échauffement et drain compris : max 708,222 ms, p50 16,666 ms, p95 16,916 ms,
p99 17,224 ms. Elle ne mesure pas uniquement les 20 s et ne prouve pas 60 FPS.
Les marqueurs Worker/logger restent des durées murales, sans attribution
automatique à du CPU, au GPU, au réseau ou aux pauses du système.

## Source, archives et budget hauteur

La source est nouvellement générée sur Python/CUDA bf16,
`coarse4/original/original`, avec un nouveau token et une nouvelle registration.
Le heightfield brut 1024² sur 40 km conserve le SHA256
`3c7c2f32e37844842f058208e21522543bcec69125348e115390f83d5b814159`.
Le contexte canonique Magna est 512² au pas 78,125 m ; les parents enregistrés
restent de vrais contrôles B-spline. `tilted-strata-v1` est un scénario géologique
explicitement demandé, pas de la géologie observée. La source fraîche contient
**0 bâtiment**, sans crop ni translation de frame.

La restauration stricte est PASS pour les deux paquets et leurs **six archives
chacun**, sans vider, réparer ou remplacer un slot :

| Paquet | Octets | SHA256 |
| --- | ---: | --- |
| `fresh-source.surfacebin` | 91 626 097 | `70c05ed7e3177d154e44090d29b8a80c3b16ac8c40bbca0a12e74e66ca9b4ed7` |
| `live-refinement.surfacebin` | 76 589 841 | `f9bdb75671c21ceb402a817cc244a076487f7b88c267773b785f4de942055874` |

L'exécutable ROOT réellement appliqué est
`c77ca0d0b2a4409832e068d0862c760a995cc846e76b838493d2c9a2843ad104`.
Le nouveau contrat `height-source-chain-2` garde au plus sept couches,
7 340 032 échantillons, une entrée de 512 MiB et la même interpolation ordonnée.
À 40 m, les **sept couches et 1 618 660 échantillons** passent réellement :
`used=true`, 8,3754 ms de traitement natif mesuré, 504,590 ms au total.
L'estimation des buffers natifs vaut 55 596 232 octets à cette vue, avec
allocation et allowance bornées ; ce n'est ni la RSS du processus ni la VRAM.
Aucun parent n'est supprimé, rééchantillonné ou remplacé pour passer le budget.
**V14 reste FAILED** sur l'ancien plafond ; son rapport n'est pas requalifié.

## Images, couches et présentation

Les sept PNG et les dix images d'isolation sont archivés avec leurs SHA256.
Le tour soumet les géométries suivantes :

| Largeur | Arbres haute géométrie | Imposteurs | Centres arbres alpha-positifs |
| --- | ---: | ---: | ---: |
| 40 km | 0 | 0 | 0, phase 0 |
| 10 km | 0 | 0 | 0, phase 0 |
| 2 560 m | 0 | 10 000 | 3 951 |
| 640 m | 0 | 2 680 | 983 |
| 160 m | 0 | 402 | 64 |
| 40 m | 6 | 20 | 4 |
| 10 m | 1 | 25 | 0 |

Un arbre dont le support intersecte l'image peut être soumis avec un centre hors
frustum ; zéro centre à 10 m ne prouve donc ni absence ni occlusion. Ces nombres
décrivent les buffers/ALPHA et ne prétendent pas mesurer la couverture GPU réelle.
Le pixel écran de la vue 10 m/2048 vaut 4,8828 mm ; la source n'est pas observée
à cette échelle millimétrique. Le digest arbre corrigé est
`74edf966059a17fd44df22d24f4ee055f780d84196ee9c54703fa3b9e46ecbe9`.
Les assets arbres expérimentaux et les herbes sont effectivement activés.

À 160 m, l'état `all` contient 402 arbres soumis, dont 64 centres alpha-positifs,
ainsi que 288 herbes, 17 arbustes, 61 débris et 31 rochers alpha-positifs. Masquer
le couvert bas fait tomber herbes/arbustes/débris visibles à zéro, sans masquer
les rochers. Masquer les arbres fait tomber leur visibilité à zéro et coupe
la canopée résiduelle et l'ombre optique. Les allocations et empreintes physiques
du contexte, du relief, du sol, de l'inventaire et des buffers restent identiques
entre les quatre toggles de chaque vue. Les pages des deux largeurs ne sont pas
supposées identiques. La cinquième image est le sol moyen non éclairé ; elle
ne constitue pas une nouvelle simulation physique.

`groundResponse` est disponible et validé : les paramètres régionaux sont
interpolés avant recette, sans prétendre observer de nouveaux sols fins. Sol,
couvert bas et arbres restent trois couches séparées. Les 17 images conservent
une couverture vectorielle d'eau complète, zéro aire omise, zéro triangle sans
niveau et aucun budget limité. Les 51 requêtes de bordure de la vue 40 km restent
dans la tolérance de représentation, au maximum 0,122 mm. Les conflits entre
fond et niveau d'eau, jusqu'à 58,165 m dans le diagnostic borné, sont conservés
et déclarés ; ils ne sont pas corrigés pour obtenir zéro. Le mode `source-map`,
la teinte uniforme et le symbole de rive de 1,25 px sont explicites : ce symbole
ne revendique pas une largeur physique et ne change ni contours ni niveaux.

Les quatre processus natifs utilisent le cache PBR préparé : 15 hits, zéro miss,
zéro écriture, chargement de 2,379 à 2,864 s. Le logger threaded enregistre
62/62, 45/45, 12/12 et 12/12 messages acceptés/écrits, zéro rejet et zéro attente
au snapshot. Celui-ci exclut sa propre ligne ultérieure. L'export de projection
TOP indique sa vraie géométrie de caméra ; aucun résultat oblique n'est attribué
à cette campagne.

## Concurrence et nettoyage

Un diagnostic CPU OWN a tourné au démarrage source : une tentative de 0,73 s
vers 08:54:11 UTC, puis un test retained-control de 8,665 s entre
08:54:26,249 et 08:54:34,693 UTC. Il est déclaré dans
[HEIGHT_SOURCE_CHAIN_BUDGET.md](HEIGHT_SOURCE_CHAIN_BUDGET.md). Le raccord
tick/Unix d'un événement natif adjacent place approximativement le début du
mouvement à **08:55:37,754 UTC**, soit 63,061 s après la fin de ce calcul. Cela
n'est pas une trace CPU synchronisée ni une affirmation de machine globalement
inactive. Aucun autre benchmark/test n'est lancé pour cet archivage.

À 09:01:55 UTC, le contrôle ROOT ne trouve aucun survivant parmi les sept PID
consignés et aucune commande exacte appartenant à V15. Vite et le service neural
sont volontairement exclus de ce contrôle ; aucun processus extérieur n'est tué.
Les vues CITY419 V14 restent une preuve séparée de compatibilité mapper : source
retenue, parent 15,625 m et LOD inconnu, pas une ville fraîche V15. La décision
artistique et la qualification produit restent à établir par la revue distincte.
