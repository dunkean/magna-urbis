# Prochaine étape artistique : végétation proche

Audit du 24 octobre 2026, pendant la revue Opus V12. Proposition uniquement : aucun import, téléchargement de géométrie, code runtime, test GPU ou changement ROOT. V12 reste figé. Les chiffres ci-dessous viennent des métadonnées et des petits documents glTF officiels consultés ; ils ne mesurent pas le rendu.

## Constat et première étape bornée

`scene/main.gd::_build_populations` construit actuellement des couronnes/arbustes sphériques, des herbes en prismes et des débris grossiers. `surface_object.gdshader` ne possède aucune texture de brin/feuille. Les quinze jeux PBR existants décrivent le sol/couvert bas, pas des arbres. `forest_leaves_03` est téléchargé mais sans liaison recette/famille ; ce n'est pas une texture de couronne à activer.

**Commencer par les herbes réelles.** Sélectionner quelques petites touffes de `grass_medium_01`, supprimer leurs décalages de présentation dans la collection, mesurer leur pivot bas/dimensions et normaliser leur hauteur sur `candidate.size`. Conserver exactement position, orientation, rang, variante stable et identité. La litière reste une réponse du couvert bas, distincte du sol et des arbres. Aucun nouveau candidat, champ physique ou type botanique canonique n'est nécessaire.

Créer un catalogue neutre `surface/vegetation/catalogue.json` et un adaptateur `surface_vegetation_library.gd` : URL/licence/hashes des sources et produits préparés, nom du sous-maillage, pivot, dimensions, normalisation, surfaces, cartes et espaces colorimétriques, politique alpha, budgets. Les fichiers préparés sont locaux et versionnés par leur digest de renderer ; ils ne changent pas les versions de géologie/recettes/population. Garder le chemin cartographique actuel, avec palette source et glyphes lisibles.

## Sources CC0 vérifiées et coût réel

Poly Haven autorise modification et redistribution de ses assets sous [CC0](https://polyhaven.com/license). Les [conditions de l'API](https://github.com/Poly-Haven/Public-API) sont distinctes : ingestion attribuée, runtime hors réseau.

| Asset officiel | Contenu du glTF consulté | Téléchargement 1k avec dépendances |
|---|---|---:|
| [grass_medium_01](https://api.polyhaven.com/info/grass_medium_01) / [fichiers](https://api.polyhaven.com/files/grass_medium_01) | 17 touffes nommées ; variantes tiny de 28–79 triangles, autres de 290–6422 | 3 065 099 octets |
| [tree_small_02](https://api.polyhaven.com/info/tree_small_02) / [fichiers](https://api.polyhaven.com/files/tree_small_02) | 2 062 487 triangles, 3 surfaces | 100 974 143 octets |
| [fir_tree_01](https://api.polyhaven.com/info/fir_tree_01) / [fichiers](https://api.polyhaven.com/files/fir_tree_01) | 3 maillages de 4 176 819 / 2 300 624 / 505 494 triangles, 4 surfaces chacun | 487 358 833 octets |

Ce sont les comptes d'indices des exports, différents du nombre de polygones publicitaire. Les arbres bruts sont exclus du runtime proposé. Il faut une préparation hors ligne reproductible, pas un stub qui charge deux millions de triangles. Cibles à valider, non réalisées : un arbre feuillu, deux surfaces maximum, LOD proche ≤8k triangles, intermédiaire ≤1k puis imposteur ; atlas 1–2k. À64 arbres proches cela représente au plus512k triangles ;10k arbres à ce LOD seraient excessifs. Le LOD doit suivre la taille projetée physique et garder une représentation des identités retenues.

## Arbres : masque partagé obligatoire avant activation

Le remplacement suivant concerne un arbre préparé **avec son imposteur alpha/normal/réponse moyenne dérivé du même asset**. Aujourd'hui C et V supposent des disques pleins ; une feuille ajourée change la couverture visible. Substituer un glTF sans modifier cette liaison fausserait la peinture résiduelle et pourrait recréer un halo.

L'atlas de couverture sélectionnée doit utiliser le même masque alpha, les mêmes variantes et transformations que la géométrie. Le support canonique des couronnes, treeCover, les IDs, les gardes de page/frustum et les trois couches restent inchangés. Les garanties V≤C et ≤2 points de couverture doivent être remesurées, notamment en oblique ; elles ne sont pas héritées du test des sphères. Si elles échouent, cet arbre reste expérimental, et les herbes peuvent être livrées séparément.

Adapter le shader végétal pour albédo/normal/rugosité et alpha testé/haché, TBN correct sous transformation non uniforme, fade caméra commun et lumière linéaire. Ne pas importer BLEND tel quel : [Godot décrit ses différences de coût/tri](https://docs.godotengine.org/en/stable/tutorials/3d/standard_material_3d.html). Répartir les MultiMeshes par variante/surface/LOD ; l'override actuel de la seule surface0 ne convient pas. Conserver initialement les ombres optiques C total et cast-shadow OFF arbres/troncs, pour éviter un second modèle d'ombre non qualifié.

## Preuves nécessaires et limites

- CPU : hashes/licences/pivots/tailles, source/candidats strictement inchangés, variante stable au zoom/raffinement/rebase, buffers et budgets bornés.
- GPU après autorisation : 10m/160m/640m/2560m et oblique contrôlé ; mesh contre imposteur, vrai MultiMesh, alpha/normales, couverture ≤2 points, pans/franchissements de page sans rectangle/halo.
- Couches/styles : sol RGB/normal/rugosité inchangés ; herbes/litière et arbres/ombres réellement retirés par leurs toggles ; styles cartographiques et bâtiments conservés.
- QoS : navigation stricte20s, mémoire, bytes chargés, triangles/draws et upload mesurés. Les [MultiMeshes ne font pas de culling individuel](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html) ; les gros lots devront rester bornés. Cette page signale elle-même une mise à jour4.7 incomplète : vérifier sur le moteur épinglé.

Risques principaux : overdraw des feuilles, surfaces multiples, coût de préparation et parité optique en oblique. Aucun de ces nouveaux assets n'a été importé ou rendu ici ; aucune promesse de photoréalisme ou de FPS. Première livraison conseillée : touffes réelles puis arbre préparé et qualifié, sans modification des données physiques.