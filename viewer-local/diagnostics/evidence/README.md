# Portée des mesures natives

Ces fichiers conservent des mesures réellement exécutées, avec leurs limites.
Ils ne remplacent ni la campagne de navigation complète ni une appréciation
visuelle des cartes produites.

| Rapport | Mesure | Limite |
| --- | --- | --- |
| `terrain-import-alignment.json` | Véritable addon Terrain3D 1.0.2 : import d'un plan connu puis requêtes `get_height`. Le cas 256 décalé échoue volontairement ; le contrôle 512 aligné donne une erreur nulle aux cinq positions. | Stockage natif en mode headless, pas mesure GPU. |
| `terrain-fractional-storage.json` | Six imports natifs : adresses des régions et tous les octets RF comparés à la source, avec les pas de production 0,4672897196261682 ; 77,972412109375 ; 1,59765625 ; 0,4726409912109375 m. Les cas 512/1024 sont exacts ; le cas 256 invalide est reproduit. | Stockage CPU natif, pas lecture de positions GPU. Les erreurs de `get_height` près des sommets fractionnaires sont consignées séparément. |
| `binding-gd-result.json`, `binding-ts-reference.json` | Empreinte des mêmes 512² hauteurs réelles en TS et GDScript ; refus d'une empreinte différente. | Ne constitue pas une authentification cryptographique. Le fichier source volumineux reste dans les sorties locales de qualification. |
| `normal-new-forward.json`, `normal-new-gl.json` | Rotation des normales 0/90/180/270°, erreur encodée nulle, probe de production inchangée. | Forward+ utilise une RTX 4090 ; Compatibility une RTX 5090. Ces mesures ne comparent pas leurs performances. |
| `material-mean-forward.json`, `material-mean-gl.json` | Moyenne linéaire et translation du monde mesurées sur l'ancien snapshot indiqué dans les fichiers. | Ne pas attribuer ces exécutions au HEAD actuel. |
| `material-mean-source-equivalence.json` | Comparaison de 13 blocs de calcul critiques entre le snapshot des mesures de moyenne et le snapshot d'intégration indiqué. | Les fichiers complets diffèrent ; aucune équivalence de toute la scène n'est affirmée. |
| `canopy-coverage-gl.json` | Couverture réelle de couronnes, sept empreintes, erreur maximale de 1,717 point de pourcentage. | Fixture non photométrique ; ne qualifie pas les couleurs, les ombres ou toutes les forêts. |
| `cartographic-decal-forward.json` | Couleurs CSS des routes et adhérence sur un sol déformé. | Probe isolée Forward+, pas tous les plans urbains. |

`collection-provenance.json` conserve les chemins originaux, les empreintes,
les différences de sources et les conditions de collecte. Certains chemins sont
propres aux worktrees locaux. Les rapports historiques restent historiques,
même lorsque les blocs de calcul pertinents sont encore identiques.

Le probe fractionnaire distingue le stockage et l'API de requête. Dans l'addon
épinglé, [`get_height` renvoie `get_pixel(pos)` près d'un sommet](https://github.com/TokisanGames/Terrain3D/blob/v1.0.2-stable/src/terrain_3d_data.cpp#L586-L632),
dont les coordonnées d'image sont tronquées. L'arrondi Float32 peut donc lire le
pixel précédent : le plan de test présente jusqu'à 0,75 m d'écart via cette API,
alors que tous les octets des régions et leurs adresses sont exacts. Le renderer
Magna échantillonne lui-même ses sources pour les appuis ; ce constat ne prouve
ni une erreur ni l'exactitude du placement GPU. L'arrondi du pas natif lui-même
représente moins d'un micromètre sur le cas 512 à 0,4672897196261682 m.
