# Corrections du mapper après la revue V8

24 octobre 2026. La [revue Opus V8](reviews/phase06-followup-v8.md) qualifie le
prototype technique et refuse l'acceptation artistique. Ce document décrit la
correction suivante ; les preuves isolées ci-dessous ne sont pas annoncées comme
une nouvelle campagne fraîche complète.

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
La compilation de sa réponse prend 13,928 s après le retour neural ; la
préparation native suivante prend encore 3,7 s. L'upload de 9,35 Mo prend 0,618 s.
La tournée et les probes ne sont pas exécutées. Les 560 fichiers runtime et le
HEAD restent identiques avant/après ; aucun critère n'est assoupli.

La prochaine campagne doit donc encore réunir ces changements sur un même snapshot :
nouvelle source Infinite Generation, mouvement continu, sept échelles, symboles
d'eau déclarés et isolation sol/herbes/arbres à 10 km **et** à 160 m avec de vraies
instances. La revue Opus reste une étape indépendante.

Couronnes et petits objets restent des représentations stylisées, les ombres
forestières sont optiques, et le sol canonique garde sa résolution physique.
La parité artistique de tous les styles et l'adoption définitive de Godot ne
sont pas acquises par ces corrections.
