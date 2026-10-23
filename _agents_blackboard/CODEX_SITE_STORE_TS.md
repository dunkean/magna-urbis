# Sites légers dans le main — TS READY / fichiers libérés

22 octobre 2026, 20:29. Intégration TypeScript terminée. Aucun serveur, nouveau binaire ou benchmark lancé. La capability native et son contrat sont décrits dans [CODEX_SITE_READ.md](CODEX_SITE_READ.md) ; **pas encore de validation UI live de cette capability**.

## Chemin actif et données conservées

`beginUrbanBuildingPages()` expose `siteQuery` seulement si `/status` annonce `urban.building-site-read`. Ce descripteur contient source complète, keys ordonnés, seed et architectureCulture ; **aucun sourceId éphémère**. Le worker conserve les originaux uniquement dans son chunk en attente, applique les overrides à l'entrée du plan natif, puis publie `{requests:[], sites:UrbanSiteVisual[]}` avant ACK. Le client accumulateur retient ces projections, jamais les contraintes complètes. La completion transporte le descripteur, pas un deuxième tableau. Serveurs sans capability, WASM et anciens chemins gardent `requests` et leur fonctionnement antérieur.

Projection exacte : IDs, offset natif, fonction, culture, programme, altitude, entrée/accès primaire, indicateur preview et surface sélectionnée selon les mêmes priorités qu'avant. Les trous et coordonnées ne sont ni simplifiés ni recadrés. Cadastral/reserves/roof_domain, grille terrain, voisins, config et contraintes ne traversent plus vers le main sur cette voie. Les sites refusés et espaces libres gardent aussi leur projection originale.

`urbanSiteStore.ts` fournit `createNativeSiteStore(visuals, query, runtime)` et la compatibilité `createLegacySiteStore(requests)`. API : `visuals`, `has(id)`, `matchesRuntime(runtime)`, `read(id)`, `dispose()`, `stats`. Une lecture native reprend seulement le site sélectionné via `buildingSite`, vérifie offset/total/ID/parcelle et budget, sans begin ni upload. Le descriptor/runtime est copié à la création ; les lectures simultanées du même ID sont regroupées. Cache LRU **16 sites / 8 MiB maximum**, **2 lectures dispatchées maximum par store** ; un site trop gros pour le cache est retourné puis non conservé. Invalidation logique : les appels déjà partis finissent, mais leurs résultats périmés ne sont ni utilisés ni mis en cache.

## Édition, comparaison, persistance

`terrainUrban` conserve le garde `sceneRequestScene` ajouté par root : liaison à la scène fusionnée, détachement lors de l'invalidation/restauration, transfert explicite vers la nouvelle scène après édition acceptée. Il capture le store avant lecture et vérifie scène/store/runtime/mode avant le replan, puis après le résultat. Un refus conserve scène, store et overrides précédents. Un nouveau flux en cours n'écrase pas le store engagé ; son échec/annulation conserve les sites de l'ancienne scène. La lecture ne dépend pas du begin courant côté natif.

Monuments et comparaison utilisent `siteVisualScene()` depuis les projections. L'identité de comparaison `requests` reste compatible avec le harness mais désigne maintenant leur tableau, sans résolution réseau. La comparaison ne vide aucun cache et n'appelle pas `buildingSite`.

Aucun handle/store ajouté aux snapshots, `.decor`, MU1 ou exports de plans. Une restauration étrangère reste explicitement verrouillée pour le replan, même avec les mêmes IDs. Les plans et leurs archives restent autonomes pour affichage/réalisation. Pas de réhydratation implicite d'une autre ville ou source périmée.

## Vérification et limites

**34 tests ciblés verts** : store (5), pages (3), streaming (3), source (3), éditions (4), snapshots (16). La dernière passe de six fichiers avait 33 verts et une attente incorrecte dans le nouveau test de comparaison (le host de test mutait son wrapper d'identité, contrairement au host réel) ; fixture corrigée, fichier store 5/5 repassé. TypeScript global `npx tsc --noEmit` PASS. Aucune modification de production motivée par cette erreur de fixture.

Preuves ciblées : accès aux champs lourds piégés pendant projection, trous exacts/aire nette/espaces libres, lecture d'ancien descriptor sans sourceId ni begin, source périmée et ID/budget erronés refusés, cache borné et invalidation après await, rollback de l'éditeur avec original non modifié, comparaison sans lecture, flux 65 sites avec overrides/ACK et absence des contraintes dans les messages. Les tests natifs de root prouvent séparément que la lecture unitaire ne remplace pas le flux actif.

Limites : projections, plans, archives, parcelles et index d'IDs restent proportionnels à la ville ; le fallback conserve les originaux. La lecture native d'un ancien descriptor peut préparer un index temporaire proportionnel aux allocations. L'éditeur reconstruit encore son index d'occupation. Aucun gain chiffré mémoire/latence ni succès live à 1 M revendiqué.

**Fichiers libérés :** nouveaux `rust/bridge/urbanBuildingSite.ts`, `web/src/ui/urbanSiteStore.ts`, `web/tests/urbanSiteStore.test.ts` ; adaptations `urbanBuildingPages.ts`, `urbanScene{,Worker,Protocol,Progress}.ts`, `urbanSilhouettes.ts`, `terrainUrban.ts` (bookkeeping/édition/consommation des projections seulement), `cityComparison.ts` (commentaires seulement), tests pages/streaming. Aucun code Rust natif, paint/3D ou runner modifié.
