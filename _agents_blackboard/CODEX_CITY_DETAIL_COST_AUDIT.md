# Zoom et détails — audit TS hors UI, 23 octobre 2026

Statut : diagnostic et proposition seulement. Aucun fichier produit modifié, aucun navigateur, serveur ou appel Rust. Sources Opus réservées. Mesure reproductible : `cd web; node --import tsx out/city-detail-cost-audit/probe.ts`.

## Défaut concret et mesure

`web/src/ui/city3d.ts`, `swapDetail` remplace un objet dans `display.buildings`, puis son timer appelle `terrain.setBuildings(display, {style:'geometric', diagnostic:'none'})`, suivi de `syncBuildings()`. Cette dernière appelle à nouveau `setBuildings`, avec `style:'cartographic'`. `UrbanBuildingPass.setScene` (`web/src/ui/urbanBuilding3d.ts:78`) compare identité de scène et apparence ; les deux appels invalident donc tous les secteurs, libèrent leurs caches GPU et recalculent tous les bounds. Ce travail ne dépend pas du nombre de détails qui viennent d'arriver.

Corpus : `web/out/city-perf/native/city-01-river-plain-l-plans.json`, 75 099 485 octets, **6 683 bâtiments** du cas 100 000 habitants ; provenance `city-01-river-plain-l-native.json`. C'est une capture historique `architectural-plans-1`, utilisée telle quelle pour mesurer le parcours du code de rendu courant. Aucun plan relabellé, régénéré, dupliqué ou utilisé comme preuve de qualité de l'admission actuelle.

Le probe appelle les vraies fonctions `city3dScene` et `UrbanBuildingPass.setScene` sous Node, avec GL inerte (compilation shader et GPU exclus). Après chauffe :

- 134 secteurs ; **13 366 bâtiments revisités par publication de détails**, même pour un seul remplacement.
- Sept cycles complets : 24,829 / 22,990 / 13,758 / 14,081 / 13,983 / 14,508 / 13,956 ms ; **médiane 14,081 ms**.
- Ce coût CPU exclut les destructions/recréations et transferts GPU réels, l'attente native, les timers et la peinture navigateur. Ce n'est pas une mesure de FPS.

Second défaut du même raccord : `applyServiceDetails` ajoute tout `service.cached()` à une Map locale, sans retirer les entrées évincées. Exécution du corps exact de cette fonction sur trois snapshots disjoints, chacun de 64 IDs réels : **cache partagé 64 → 64 → 64 ; Map 3D 64 → 128 → 192**. Le test mesure les références détenues, pas la taille des meshes (les payloads sont ici les plans capturés). `display.buildings` conserve également les détails remplacés. La borne du contrôleur partagé ne borne donc pas la mémoire des consommateurs 3D.

Artefacts : `web/out/city-detail-cost-audit/{probe.ts,report.json}`. Le rapport garde hashes du corpus et des quatre sources mesurées.

## Raccord minimal proposé à Opus, non appliqué

Ne pas simplement supprimer l'appel `geometric` : à scène/apparence identiques, `setScene` retourne immédiatement. Ses `sector.entries` gardent les anciens objets malgré la mutation du tableau `display.buildings` ; le nouveau détail ne serait pas installé.

1. Ajouter une mise à jour ciblée dans `UrbanBuildingPass`, par exemple `replaceBuildings(changes: readonly PlacedBuilding[])`. Index `id → {entry, sector}` créé lors du vrai `setScene` ; chaque changement remplace `entry.building` et ses bounds. Recalculer bounds/largeur et libérer le cache **une fois par secteur touché**. Les autres secteurs et leurs buffers restent inchangés. En cas d'identité/site transformé, refuser ce chemin et laisser le remplacement de scène existant agir ; les exteriors natifs sont déjà contrôlés contre le plan retenu.
2. Exposer cette méthode via `Terrain3d` en demandant seulement une peinture. Ne pas appeler `clearPatches`, `setForest`, `city3dScene`, `city3dBridges` ou `city3dWalls`. Assises et emprises du plan restent identiques ; la méthode ne change que le visuel natif et ses bounds de rendu.
3. `city3d` garde un index `id → position` du tableau d'affichage. À chaque notification du service, calculer le différentiel du snapshot borné `cached()` : ajouts/remplacements **et retraits**. Les retraits restaurent `compactBuilding(base)` depuis `byId`, pour ces seuls IDs. Mettre à jour les compteurs `compact/detailed` d'après les changements effectifs, pas le nombre de notifications.
4. Appliquer ce petit différentiel en un lot à `display.buildings`, puis appeler la nouvelle méthode une seule fois. Conserver l'apparence actuellement choisie ; supprimer le détour temporaire par `geometric` et le `syncBuildings()` déclenché seulement par une réponse native.
5. La Map locale devient le miroir du cache partagé (≤64) pendant l'activité 3D. Sur réouverture ou remplacement de scène, réconcilier avant l'affichage pour retirer les entrées devenues absentes. Le garde actuel de `samePlan` ne doit pas servir à conserver aveuglément un détail après une véritable édition du plan.
6. Le chemin sans service partagé garde sa réalisation et ses diagnostics existants, mais envoie ses remplacements dans la même méthode ciblée. Aucun appel au contrôleur partagé ne doit y être imposé. Sa propre politique de rétention peut être bornée séparément ; ne pas utiliser un tableau `cached()` inexistant pour effacer ses détails.

Complexité visée : parcours du snapshot ≤64, lookup des IDs modifiés, recomposition des seuls secteurs touchés. Le coût d'un secteur dépend de sa population réelle ; ce n'est pas une garantie absolue constante. Les meshes/GPU sont toujours produits par le chemin existant au prochain rendu.

Vérification ciblée recommandée avant adoption : installer deux détails dans deux secteurs, retirer le premier via une éviction du service ; seules les deux entrées et les deux caches concernés doivent changer, les autres buffers gardent leur identité, counts redeviennent cohérents. Même scène/apparence et réponse inchangée doivent être un no-op. Un changement de scène reste une invalidation complète. Aucun test de ville complet n'est requis pour ce contrat.

## Ce qui ne justifie pas une correction spéculative

- Détails 2D : index spatial, demande plafonnée à64, file32, deux appels physiques globaux conservés jusqu'à la réponse, cache16MiB/150k vertices/64 bâtiments. Une caméra obsolète peut perdre le résultat en vol mais ne crée pas de troisième appel physique.
- Sur cinq caméras proches de 240×160m à0,2m/px du corpus, la vraie `query()` teste15 bâtiments sur6 683 et retourne6–7 visibles. Le contrôleur et le dessin peuvent interroger deux fois ces candidats ; pas de parcours global observé ici.
- Lots progressifs : `createUrbanSceneAccumulator` garde l'identité de scène, enregistre seulement le delta d'archives ; `publishArchitectureBatch` appelle `renderer.appendScene(delta)`. `buildCityBuildings` n'est reconstruit qu'au commit final/changement de scène, pas à chaque lot dans ce chemin.
- Archives : `raw + spans`, parsing d'un seul record, cache de bytes borné et déduplication des décompressions en vol sont déjà présents. Aucun cache mondial d'objets parsed n'est proposé ; le benchmark isolé de style_index couvre séparément ce chemin.

Ce résultat concerne un goulot **3D** démontré. Il ne suffit pas à expliquer seul la fluidité du zoom 2D ni le temps total de génération de la métropole.

## Identité des plans et frontière d'implémentation

Relecture demandée par root : `samePlan` dans `city3d.ts` compare seulement recette, variante, altitude et pose. Un nouveau plan avec dimensions différentes et ces mêmes valeurs peut donc récupérer l'ancien détail dans le mode autonome. Pour le service partagé, `UrbanBuildingDetailController.replaceScene` est déjà strict : `epoch++`, cache/attentes vidés, réponses anciennes rejetées par epoch et identité de l'objet source. Aucun défaut de ce contrôleur à corriger ici.

Le miroir 3D doit être vidé/réconcilié **avant** `city3dScene` sur une nouvelle scène, et pas seulement à la notification suivante : les détails du service ne remplissent actuellement pas `detailBases`, donc la boucle de nettoyage autonome ne les protège pas. Pour le mode autonome, la comparaison minimale sûre est l'identité de la source `a === b`, conservée pour les bâtiments inchangés d'un merge. Un nouvel objet après édition/restauration perd son cache et peut être réalisé de nouveau ; aucun fingerprint incomplet ne certifie une géométrie. Vérifier la même identité au retour des promesses natives en vol.

Répartition proposée : helper/index de remplacement dans `urbanBuilding3d.ts` + proxy `Terrain3d` sous accord de leur propriétaire ; réconciliation, compteurs et retrait des deux appels globaux dans `city3d.ts` par Opus. Aucun contournement par changement artificiel d'apparence.

Tests précis du raccord :

- le swap change réellement l'objet lu par `eachBuildingTriangle` et la géométrie affichable, malgré la scène et l'apparence identiques ; vérifier seulement le tableau `display` ne suffit pas ;
- seuls les secteurs portant les IDs modifiés deviennent dirty, avec une invalidation par secteur/lot ; les autres buffers restent identiques ;
- une éviction du snapshot partagé rétablit le compact correspondant et décrémente le compte détaillé ; trois ensembles de64 restent bornés à64 dans le miroir et dans les détails installés ;
- un nouveau plan de même recette/variante/pose mais dimensions modifiées ne conserve pas l'extérieur historique, y compris si l'ancienne promesse termine ensuite ;
- le mode sans service continue de fonctionner avec ses réalisations explicites et passe par le remplacement ciblé, sans consulter un faux snapshot vide.

Archive, mesure indépendante de style_index : `web/out/frozen-plan-archive-bench/report.json` sur64 vrais plans Java récents. Froid26,47ms,8résolutions concurrentes27,06ms avec une seule décompression, chaud0,0191ms ; un record parsed par résolution,400 936octets retenus. Cette mesure Node distincte confirme qu'il n'y a pas lieu d'ajouter un cache parsed global à ce stade.

## Relecture du correctif Opus et preuves indépendantes — 03:04

Opus a livré `UrbanBuildingPass.replaceBuildings`, son proxy `Terrain3d` et le lot `pendingSwaps` dans `city3d.ts`. Le renderer remplace les vraies entrées des secteurs, recalcule leurs bounds/largeur et invalide une fois les secteurs touchés. Le caller restaure les seuls compacts évincés et n'appelle plus `syncBuildings` par réponse. Les IDs inconnus sont retournés ; ce contrat est acceptable sous les préconditions actuelles du caller (slots existants, détails du même plan).

Deux défauts transitoires du caller ont été signalés et corrigés par Opus à03:01 : la file/timer est vidée à chaque reconstruction du display ; `samePlan` exige désormais `a === b`, avant conservation du cache et après attente native. Les détails partagés ont une base associée et sont réconciliés avant `city3dScene`. La méthode générique n'a donc pas besoin d'une nouvelle certification d'archive pour ce raccord.

Preuves réalisées sans navigateur ni natif :

- `web/out/city-detail-cost-audit/stale-entry-probe.ts` établit le défaut de la simple suppression de l'oscillation : même scène/apparence, nouveau slot dans le tableau, mais ancien objet et anciens triangles conservés par le pass sans remplacement ciblé. Son rapport garde les hashes des triangles distincts.
- `web/tests/urbanBuilding3dUpdates.test.ts` : **2/2 verts** (`npx vitest run tests/urbanBuilding3dUpdates.test.ts`). Le premier utilise le vrai chemin `compactBuilding(plan) → nativeExteriorDetail(plan,batch-reference) → compactBuilding(plan)`, vérifie les références communes compatibles, les triangles effectivement lus, les buffers préparés différents, une seule invalidation pour deux détails d'un même secteur et le cache intact de l'autre secteur. Le second remplace une source par une architecture modifiée de même ID/recette/pose pendant une réponse native en vol : l'ancien résultat est rejeté, aucun détail ancien réinstallé, et le slot physique est drainé avant la demande suivante.
- `web/out/city-detail-cost-audit/pending-scene-probe.ts` exécute les vrais corps de `queueSwap`, du reset et de `samePlan` transpiliés depuis le fichier courant : omettre le reset reproduit l'injection ancienne ; le reset courant conserve la nouvelle entrée, vide la file et annule le timer ; la garde stricte refuse le nouvel objet modifié. Hash du caller dans `pending-scene-report.json`.

Le mode masqué de City Bench utilise `setActive(false)`, pas `setBuildings(..., false)` : une réponse déjà dispatchée peut ainsi mettre à jour ses entrées sans nouvelle peinture active. Le réaffichage relit le miroir du service. La nouvelle API n'invalide ni relief, ni forêt, ni ponts/murailles.

Aucun bloqueur supplémentaire trouvé dans ce périmètre après ces corrections. Le test confirme la géométrie envoyée aux buffers via GL inerte, pas les pixels d'un navigateur. Les mesures de0,50ms puis0,33ms du remplacement ciblé sont celles d'Opus (`opus/replace_probe.ts`), distinctes de notre mesure initiale ; aucune promesse générale de FPS. Aucun patch produit ni duplication de sa proposition par Morphology : seul le nouveau fichier de tests a été ajouté.

## Contrôle visuel complémentaire Opus — 23 octobre, 03:2x

Opus a vérifié City Bench01-s sur son moteur8795 déjà actif, en rendu logiciel SwiftShader :823 plans compacts, puis43 extérieurs natifs installés sur place ; murailles conservées, zéro erreur de page. Rapport et images dans `web/out/city-bench/3d-targeted/`. Root a ouvert `city-01-river-plain-s-compact-close.png` : colombages et détails géométriques visibles parmi les plans compacts, compteurs780/43 cohérents. Cette capture complète les tests des buffers ; elle ne vérifie pas visuellement l'éviction après64 détails. Les temps de frame logiciels de ce rapport ne sont pas un benchmark GPU matériel ni une promesse de fluidité.