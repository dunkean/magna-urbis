# Rétention vers 60–100k maisons — revue du 23 octobre 2026

**Prochaine action : stocker les chunks bâtis exacts avant ACK ; conserver un index spatial et charger les tuiles sous budget.** Le LOD réduit les triangles soumis, pas les sources. `urbanSceneProgress.ts` accumule tous les bâtiments, refus, espaces et archives ; volumes/niveaux/fondations/features restent en coordonnées monde. `city3dMeshes.ts::city3dScene` prépare aussi tous les toits compacts. Certaines surfaces/matières sont partagées : les octets sérialisés ci-dessous ne mesurent pas leur heap.

**C production, sans recompression :** les 124 `*-plans.json` sont identiques par SHA-256 aux sorties v2 ; les hash archive/compression/batching concordent avec le [rapport réutilisé](../web/out/b06-light-v2-scale-comparison-proof/after.json). 7 921 demandes, 6 225 admis ; sommes UTF-8 hors HTTP :

| Donnée mesurée | Octets / points |
|---|---:|
| Réponses natives ; deltas archivés réencodés | 84 414 084 ; 54 154 461 octets |
| Valeurs `resolved` natives ; archives gzip / base64 | 33 896 601 ; 2 114 310 / 2 819 240 octets |
| Bâtiments hors valeur `resolved` | 48 595 800 octets |
| Surfaces visibles ; features 2D / 3D | 255 682 occurrences ; 91 738 / 83 028 points |
| Occupation conservée par le worker | 20 028 parties, 155 692 points, 23 726 références de cellules |
| Descripteurs d’occupation sérialisés séparément | 10 408 488 octets |

À distribution identique : **522–870 Mo sérialisés pour 60–100k admis**, extrapolation arithmétique, pas heap mesuré. La géométrie visible domine les archives ; le [LOD](../web/out/b06-feature-lod-delivery-proposal-proof/production-c-inventory.json) ne réduit pas cette rétention.

**Existant à conserver :** `urbanSceneWorker.ts` libère plans/archives après ACK ; `architectureBatch.ts` conserve l’occupation exacte cumulative (pages≤64, entrée≤24 Mio). `compactPlanArchive.ts` archive lossless gzip/SHA, décode un record, cache 2 archives/8 Mio. `urbanSiteStore.ts` borne les contraintes côté main (16 sites/8 Mio, 2 lectures) ; `urbanBuildingDetails.ts` borne les extérieurs (64 bâtiments/16 Mio/150k sommets, 2 appels). `/urban` fournit des sites révisionnés ; `/houses/plans` et `/houses/realize-plan` sont stateless (`rust/crates/local/src/main.rs`). Aucun handle de plan persistant n’existe.

**Contrôle des rebuilds par page64 : pas de coût quadratique identifié.** `urbanSceneProgress` conserve l’identité ; `terrainUrban::publishArchitectureBatch` initialise une fois puis appelle `urbanBuildingLod::appendScene(delta)` (index incrémental, caches conservés, tuiles raster touchées invalidées) et `urbanBuildingDetails::appendScene(scene)` (O(1)). Canvas repeint ; le plan GL reste stable. `urbanBuildingsPanel` conserve la scène achevée pendant l’aperçu : `citybench→city3d::syncBuildings` ne reçoit le nouveau résultat qu’au commit. Alors seulement, `city3dScene→Terrain3d::setBuildings→UrbanBuildingPass::setScene` reconstruit globalement. Aucun correctif préalable plus petit confirmé ; préserver ces identités et ne pas publier une copie de préfixe à chaque page.

**Changement minimal :** remplacer l’accumulation dans `urbanSceneProgress.ts`/`urbanScene.ts` par IndexedDB : chunks archivés inchangés, transaction avant ACK, index id→chunk/index, parcelle et bornes→tuile 256 m. Conserver chaque page une fois, même si elle intersecte plusieurs tuiles. Persister un aperçu par tuile dérivé des géométries acceptées ; `city3d.ts`, `urbanBuilding3d.ts`, `urbanBuildingLod.ts` chargent les tuiles visibles sous plafonds octets/nombre, sélection épinglée. Lire le bâtiment exact puis utiliser `resolveArchivedPlan`/réalisation existante et `urbanHouseTransfer.ts`. Aucun nouveau placement par tuile. L’occupation du worker reste entière et linéaire.

**Contrat indissociable :** manifest scène/tuiles versionné, ids/génération figés, archives `compact-plan-archive-1` inchangées ; export/import en flux de **tous** les chunks via `urbanSnapshot.ts`, `urbanBuildingsPanel.ts`, `decor.ts`, `benchHistory.ts`, sans handle natif. Préserver fusion par parcelle, translations et remplacement atomique ; quota/échec disque conserve l’ancienne scène sans ACK. Preuve suivante : C identique après éviction/relecture/export/import à froid, occupation/refus inchangés, sélection/édition hors tuile, budgets respectés. Seule cette note est ajoutée ; aucun navigateur, serveur, natif/Cargo.
