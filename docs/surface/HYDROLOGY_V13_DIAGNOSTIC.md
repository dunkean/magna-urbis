# Bord de source et canaux hydrologiques V13

Les deux essais GPU utilisent le paquet fraîchement généré de V12 **retenu**,
sans nouvelle génération et sans navigation. Ils ne qualifient pas toute la V13.
Ils ont tourné séquentiellement sur RTX 5090 / Forward+ avec audio Dummy et sans
erreur de shader ou de runtime. Les captures V12 restent inchangées.

## Bord du terrain

La [capture 40 km](evidence/source-edge-v13/40000m.png) et son
[rapport](evidence/source-edge-v13/report.json) portent sur le runtime propre
`3e46b87`. Le fichier source garde exactement son SHA avant/après.

Le remplissage des seules images de représentation prolonge l'échantillon de
bord pour pouvoir former un triangle. Le shader coupe ensuite chaque fragment
hors de l'union exacte des domaines validés. Les bits de trous restent dans les
données natives et les trous intérieurs restent honorés. Les hauteurs exportées
et les requêtes de hauteur hors source ne sont pas prolongées.

Dans ce cadrage de 40 km, les centres d'échantillon commencent à 39,0625 m :
environ deux pixels par bord sont réellement hors support. La nouvelle capture
montre ces deux colonnes à gauche et à droite. Le classifieur de ciel documenté
mesure 31 colonnes à droite dans la capture historique V12, contre deux ici.
Les deux images ne constituent pas un A/B de tous les pixels : la tournée V12
avait déjà chargé un monde RPC raffiné. Les 27 assertions CPU vérifient séparément
les domaines disjoints, le rebase, la précision des caches, les hauteurs et les trous.
Les deux seuls échantillons de frame stable ne permettent aucune mesure de FPS.

## Six points des halos signalés par Opus

Le [rapport des canaux GPU](evidence/water-confluence-v13.json) isole le fill
source, son alpha, le résultat des symboles, leur alpha et les octets de classe.
Le [diagnostic CPU](evidence/hydro-v13-cpu-diagnostic.json) conserve les champs
et distances à la géométrie source. Les coordonnées sont celles de l'image
10 km V12 de 2048 × 1280, pas des coordonnées monde.

| Pixels | Mesure et interprétation bornée |
| --- | --- |
| (1562,451), (1014,1091), (563,415) | Alpha nul avant/après symbole. Le support contient des alluvions déduites du contexte ; enlever ces couleurs en changeant le masque d'eau effacerait un matériau du sol. |
| (1935,246) | Alpha 1 avant/après, mais la rive utilise la teinte fallback du symbole sur le fill river. Ce contraste de représentation est réel et distinct d'un trou dans le réseau. |
| (620,1193), (1572,543) | Alpha source nul et alpha symbolique 1 : ces points proches d'une vraie rive sont couverts par le symbole déclaré de 1,25 pixel, pas par une nouvelle surface physique. |

La classification du bake provient des classes **source retenues**, pas du
raster physique retaillé par le compilateur. Les polygones n'ont pas une
étiquette river/lake par groupe. Une teinte uniforme déclarée pour les vecteurs
peut harmoniser fill et symbole sans leur inventer une classe ; elle demande
son propre A/B. Aucun dépôt alluvial, contour, niveau ou largeur source n'est
modifié par ces diagnostics.

Le diagnostic `ground-mean-unlit` masque désormais tous les objets, y compris
les Decals d'eau et de route, pour mesurer le terrain seul. V12 conservait ces
Decals : son diagnostic était utile pour localiser le défaut, mais ne séparait
pas complètement le sol de la projection d'eau.
