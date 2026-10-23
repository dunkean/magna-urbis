# B06 : coût de la préparation légère dans la ville

Revue de code, 23 octobre 2026. Aucune modification produit, exécution native,
compilation ou mesure de performance. Copie examinée :
`web/out/houses-b06-light-workspace/`. Le coût réel reste à mesurer sur le prochain
rejeu C ; cette revue ne transforme pas un risque en régression constatée.

**Conclusion : les nouvelles pièces resteront en mémoire avec chaque plan. Le
rendu 2D lointain ne les dessine pas, mais le LOD 3D actuel les extrude encore,
même au loin. Le voisinage physique du bridge croît aussi avec leur nombre.**

## Transport et mémoire : trois coûts distincts

1. **Géométrie visible non compressée.** Dans la copie, `engine.rs:1338` extrait
   les pièces après préparation de l'accès. `placement.rs:536`
   (`native_site_features`) reprend les features et ajoute les murs ;
   `plans.rs:1456` les transforme en `structural_features` monde. La scène,
   ses index 2D et la scène 3D conservent les objets, indépendamment du zoom.
   `cityCanvas.ts:239` garde même la référence complète du bâtiment dans la
   projection qui n'affiche que son toit.
2. **Archive native distincte.** Dans l'état lu, `plans.rs:282`
   (`packed_with_native_entry`) conserve l'entrée, mais ne copie pas ces nouvelles
   pièces dans `resolved.plan.features`. `compact.rs:233` sérialise seulement les
   features de ce plan. Il ne faut donc pas présumer une duplication des murs
   dans `resolved.features`, ni une économie sur les pièces monde grâce au gzip.
   `compactPlanArchive.ts:166` compresse uniquement `resolved` : 64 records au
   plus, 32 MiB bruts par archive. Le partage exact des surfaces visibles
   (`:83`) couvre corps/niveaux/fondations, **pas structural_features**.
   Le cache de décompression est borné à deux archives / 8 MiB ; il conserve les
   octets et spans, parse un seul record demandé. Cette limite ne borne ni les
   features visibles ni les chaînes compressées de toute la scène.
3. **Occupation cumulative.** `architectureBatch.ts:135–160` conserve séparément
   corps, cours, circulation et chaque surface de feature. Une feature intérieure
   au corps reste une entrée distincte de l'index (cellules de 64 m), puis peut
   réapparaître dans les voisins des demandes suivantes. Ce sont des références
   côté worker, mais une nouvelle sérialisation à chaque payload concerné.
   L'index dure jusqu'à la fin du stream ; le reste du lot peut être libéré après
   ACK. Le transport reste borné à 64 demandes / 24 MiB entrants et réduit le lot
   sur dépassement de sortie. Les copies de lot (`structuredClone`, postMessage)
   sont bornées au lot ; la fin ne retransfère pas la ville entière
   (`urbanSceneWorker.ts:120`, `urbanSceneProgress.ts:35`). La scène principale
   conserve toutes les features après réception.

## Ce que les LOD limitent réellement

| Chemin | Effet des nouvelles pièces | Limites actuelles |
|---|---|---|
| Canvas 2D / GL ville | Silhouette/toit seulement ; aucune triangulation des features dans ce chemin. | `cityCanvas.ts:239`, `cityGlBuild.ts:192` ; LOD toit : seuils 18/72 px, 256 bâtiments en facettes, cache 2 048 bâtiments / 200 000 sommets, raster 32 MiB (`urbanBuildingLod.ts:131`). Ces limites ne purgent pas les objets source. |
| Préparation 3D | `city3dScene` conserve les features ; `setScene` parcourt leurs surfaces pour les bornes de tous les bâtiments. Les buffers sont construits seulement pour les secteurs visibles. | Secteurs 256 m (`urbanBuilding3d.ts:12,81`). Hors champ / rayon projeté <0,35 px : pas de buffer à produire. |
| 3D lointaine | **Toutes les features sont encore extrudées et plafonnées.** `eachBuildingTriangle` simplifie le toit dans la boucle des volumes, puis traite les features après celle-ci (`urbanBuildingGeometry.ts:56–85`). Poteaux et Frame ne disparaissent donc pas avec le toit détaillé. | Overview sous 7 px de largeur moyenne des bâtiments du secteur, sortie à 10 px. Cache GPU 96 MiB, mais éviction seulement des secteurs non affichés ; les secteurs visibles peuvent dépasser ce plafond. Le budget de préparation 8 ms est vérifié entre secteurs, après le premier : pas de plafond sur un secteur coûteux (`urbanBuilding3d.ts:155–170`). |
| Picking 3D | Les triangles des bâtiments dont les boîtes sont touchées sont recalculés, avec le même overview qui conserve les features. | `urbanBuilding3d.ts:174–180` ; pas de cache dédié des triangles de picking. |
| Extérieurs détaillés à la demande | Cache borné, mais indépendant des pièces déjà présentes dans les plans compacts. | Deux appels, 32 en attente, 64 bâtiments / 16 MiB estimés / 150 000 sommets ; auto à ≤0,5 m/px et ≥72 px (`urbanBuildingDetails.ts:56`). |

La préparation GPU fait aussi des tableaux JS temporaires, puis un Float32Array
de six nombres par sommet : **72 octets GPU par triangle**, sans index partagé.
Le budget GPU n'est donc pas une mesure du pic de mémoire JS.

## Mesures à ajouter à la preuve C, sans nouvelle campagne

Comparer à la même scène production et séparer les bâtiments communs des gains
éventuels. Le C précédent avait 6 225 plans (dont 2 207 B06), avec
`structural_features=[]` et `resolved.features=[]` pour tous ; voir
`CODEX_C_LINTEL_MATERIAL_AUDIT.md`. Cette base permet d'attribuer le nouveau coût.

- **Par lot et par recette** : nombre de features par kind, sommets 2D (trous
  inclus), sommets 3D, surfaces des fondations ; taille JSON native totale,
  `structural_features` seule, `resolved` seul. Publier somme, médiane, p95 et max.
- **Archives/bridge** : octets gzip/base64 et bruts par archive, temps de
  compression, taille du delta après archivage, nombre de lots/réductions de lot ;
  nombre et octets des voisins enrichis, entrées de l'index d'occupation. Ne pas
  assimiler taille JSON, taille gzip et heap.
- **Génération** : temps natif par lot et somme, comparaison des mêmes demandes
  et occupation propre par phase ; coût structure/accès si des compteurs existent.
  Une seule passe partagée ne suffit pas pour annoncer un gain ou une régression
  de vitesse. Les droits, appuis et collisions restent vérifiés séparément.
- **Si la preuve 3D est ensuite déclenchée** : pour une caméra identique, nombre
  de triangles des features en overview et détaillé, buffers GPU visibles/cachés,
  coût maximal de préparation d'un secteur et du picking. La preuve 2D doit
  vérifier que les sommets soumis restent ceux des toits, sans confondre une
  mémoire source accrue avec une géométrie GL accrue.

Pas de changement LOD proposé avant ces chiffres. Les pièces physiques restent
autoritaires pour l'accès, les appuis et l'occupation ; une éventuelle projection
de rendu plus légère devra être distincte de ces droits, jamais les supprimer.
