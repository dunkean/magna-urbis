# Corrections du mapper de V9 à V12

24 octobre 2026. La [revue Opus V8](reviews/phase06-followup-v8.md) qualifie le
prototype technique et refuse l'acceptation artistique. Ce document décrit la
correction suivante et sa qualification technique V12. Les preuves isolées
restent distinctes de la [campagne fraîche complète V12](evidence/NATIVE_V12.md) ;
son succès technique n'annule pas le refus artistique ni les échecs antérieurs.

## Forêt : une page de données ne délimite plus une forêt visible

Les producteurs live et offline partagent maintenant des pages par famille :
inventaire d'arbres complet jusqu'à 4 km, autres objets dans une petite fenêtre.
Le rayon est réduit si nécessaire pour respecter le budget de 100 000 candidats,
sans annoncer une sélection tronquée comme complète. Les arbres hors du petit
heightfield fin utilisent le véritable parent ; les champs, seeds, IDs, rangs et
acceptations restent canoniques. Voir [le contrat](CANDIDATE_PAGES.md).

Le renderer exige que la page, l'atlas et les hauteurs résidentes couvrent les
rayons de toute la vue et une enveloppe des hauteurs chargées. Sinon il utilise
la représentation mésoscopique sur toute l'image. Deux phases globales séparent
la transition optique de l'apparition des maillages : la géométrie n'apparaît
qu'après la transition vers l'optique exacte. Les anciennes géométries sont
immédiatement retirées si la lignée source/scène change.

L'atlas est aligné sur le monde et ses mipmaps ont une grille dyadique. Les
transmittances et la couverture partagent le même noyau de filtrage. Le contrôle
spatial mesure les pans, pas seulement une moyenne sur une toile. Les
[preuves retenues](evidence/canopy-v9/README.md) comprennent 9 175 040 échantillons
sans violation ponctuelle V>C et une reprojection dont l'écart maximal est de
deux niveaux sur 255. En oblique, la garde peut conserver la méso sur toute la
vue ; elle ne prétend pas disposer de géométrie exacte là où le support résident
ne couvre pas le frustum.

## Eau : une symbologie explicite avant la rasterisation

La carte fixe reprend toujours les contours et niveaux de Magna Urbis. Le profil
mapper source-map emploie désormais un contour de 1,25 pixel écran, déclaré comme
symbole cartographique. `--water-symbol-width-px 0` conserve le mode sans contour
élargi. Le mode physique source-levels n'emploie aucun symbole.

Les anneaux source clippés sont conservés en Float64 et tracés avant le raster.
Le contour s'applique aux rives des polygones, sans inventer de centreline ; la
mer reste l'union des cellules d'origine si aucune rive vectorielle n'existe.
Les surfaces géométriques source et celles des symboles restent distinctes dans
les diagnostics. La projection ne peint que le terrain, jamais les toits.

Le [contrôle GPU à 40 km](evidence/water-vector-symbols-v9-gpu.json) retrouve les
863 échantillons de rive que la dilatation du premier raster manquait : les
182 735 échantillons vérifiés sont visibles et les nouveaux pixels restent dans
la bande de rendu des véritables segments. Aucun triangle, niveau ou champ
hydrologique n'est modifié. Ce contrôle sur récepteur plat ne constitue pas une
preuve de débit, de topologie géographique ni une nouvelle génération neurale.
Voir [les paramètres et budgets](WATER_SYMBOLS.md).

## Ville : le support naturel persiste sous les occupations grossières

Le compilateur 1.5.3 retire l'assimilation automatique des cellules Road, Yard et
Built à une matière de revêtement. Le sol local reste sous les constructions ;
les routes et bâtiments gardent leurs propres matériaux et emprises vectorielles.
Cultures explicites, occupations et exclusions de végétation restent conservées.
La version de l'analyse physique reste 1.5.2 ; la dérivation des matières et ses
identités changent explicitement.

La [migration contrôlée des 419 extérieurs](evidence/urban-ground-v9-migration.json)
ne change que les quatre tableaux de support sur 4 712 cellules d'infrastructure.
Toutes les cellules naturelles, les champs physiques, les cinq tableaux de
couvert bas, le legacy, les candidats, reliefs, plans, matériaux architecturaux et
archives source sont identiques. Le nouvel inventaire de pages est ensuite une
[requête retenue explicite](evidence/native419-pages-v9.json), sans altérer le
monde ni inventer de hauteurs. Les anciens paquets et leurs preuves restent intacts.

## Qualification intégrée : échec V9 conservé

Les tests du contrat, les contrôles CPU et les probes GPU isolés passent.
Les [trois vues urbaines V9](evidence/native-current-419-v9-render.json) sont
capturées sur le snapshot propre `ab3c499`, sans erreur ni omission d'eau,
avec canopée convergée et les 419 vrais extérieurs natifs dans la vue d'ensemble.

La [campagne fraîche V9](evidence/native-e2e-v9-negative.json) échoue : aucune
nouvelle source n'est réellement affichée pendant les 20,004 secondes de mouvement.
La preview est acceptée à la fin du mouvement, puis affichée après celui-ci.
Les observations du driver mesurent 13,928 s entre retour neural et réponse
compilée, puis 0,618 s jusqu'à l'ACK d'upload de 9,35 Mo ; elles ne constituent
pas des mesures isolées de CPU Worker ou de réseau. La préparation native
suivante prend encore 3,7 s.
La tournée et les probes ne sont pas exécutées. Les 560 fichiers runtime et le
HEAD restent identiques avant/après ; aucun critère n'est assoupli.

La [campagne suivante V10](evidence/native-e2e-v10-negative.json), sur `f4d25e1`,
reste échouée. La correction bit-exact de population réduit l'intervalle observé
retour neural→réponse compilée de 13,928 s à 1,223 s. Le gain CPU est prouvé
séparément par le Worker Chromium direct, pas par cet intervalle de callbacks. La
[vérification indépendante](evidence/population-optimization-independent-v10.json)
conserve les sorties sur 480 requêtes et le corpus historique. Mais des délais
de callback/ACK et un gel natif de 10,55 s empêchent encore l'affichage live
pendant le mouvement. Le dépassement réel à 27,015 s, puis le drain final,
ne qualifient pas le critère de 20 s nominales. L'origine du blocage suivant
reste à mesurer avec les horloges et sous-phases séparées ; les délais d'ACK
observés ne sont pas présentés comme un coût réseau causal prouvé.

La [campagne V11](evidence/native-e2e-v11-negative.json) échoue également :
une preview arrive trop tard pour être affichée pendant les 20 secondes
nominales. Les horloges PAGE/Worker et les traces ultérieures distinguent le
calcul, l'attente et la livraison ; un span Worker ne devient pas une mesure de
CPU. Les pauses hors CPU observées dans le diagnostic scheduler restent une
limite sans cause déclarée résolue. Aucun gate historique n'est modifié.

## Qualification intégrée V12 : critères techniques complets

La [preuve lisible](evidence/NATIVE_V12.md) et le
[rapport structuré V12](evidence/native-e2e-v12.json) enregistrent une campagne
complète sur le runtime propre figé `bc6579f208ce1e4f05b471a1699de2ba05fae6b8` :
source Infinite Generation fraîche, navigation nominale stricte de 20 secondes,
sept captures de zoom et deux probes de cinq images à 10 km et à 160 m. Les
584 hashes runtime et le manifeste d'assets sont identiques avant/après ; driver
et superviseur sortent à zéro. L'option de rétention des visuels après échec de
navigation est déclarée mais **n'a pas servi**. Les contrôles avant gel passent :
**224 tests Surface / 42 fichiers**, typecheck complet et build de 445 modules.

La navigation applique deux fois **une seule preview distincte** nouvelle,
livrée en 128² après une demande 128. Son espacement natif est de 30 m,
LOD 0, `decoderUsed=false` ; la première application survient à 17,018 s.
Ce progrès de streaming ne prouve pas une nouvelle finesse neurale apprise
pendant le mouvement. Le support final livré en 133², à 0,468353 m par sample
et **0,46875 m natif / `decoderUsed=true`**, apparaît seulement dans le drain.
La durée réelle du mouvement est de 20,118 s, son écart d'entrée maximal de
1,498 s et le drain de 17,207 s : le succès du gate n'est pas une promesse de
faible latence. Le contexte environnemental reste à **78,125 m** ; 4,88 mm par
pixel écran dans la vue de 10 m ne signifie pas 4,88 mm de données source.

À 160 m, les instances alpha-positives dans le frustum CPU sont arbres 64,
troncs 64, herbes 288, arbustes 17, débris 61 et rochers 31. Les deux premiers
comptes passent à zéro sans arbres ; herbes/arbustes/débris passent à zéro sans
couvert bas, tandis que les 31 rochers persistent. Les allocations soumises,
champs et empreintes restent identiques entre toggles d'une même vue. Ce ne sont
pas des comptages de visibilité GPU après occlusion.

L'eau conserve contours/niveaux source et symbole de rive explicite à 1,25 pixel,
projeté sur le terrain seulement. Les contrôles de couverture et de budgets
passent ; les conflits de niveau avec le terrain restent des diagnostics. Les
archives source fraîche/live passent aussi leur restauration stricte complète.
Les [trois vues retenues des 419](evidence/native-city419-v12.json) sont séparées :
parent 15,625 m / LOD inconnu, source inchangée, réalisations natives existantes,
aucune nouvelle génération neurale de ville. Elles sont byte-identiques à V11/V9.

Couronnes et petits objets restent des représentations stylisées : la vue de
10 m montre encore une surface de couronne proxy uniforme et de petites
végétations en blocs. Les ombres forestières sont optiques ; les couleurs de sol
restent contraintes par la grille canonique de 78,125 m. La parité artistique de
tous les styles, 60 FPS et l'adoption définitive de Godot ne sont pas acquises.
La revue Opus reste indépendante ; V12 ne réécrit aucun verdict V9–V11.
