# Comparaison retenue : calculs de détails au changement de caméra

2026-10-22 — diagnostic initial en lecture seule, suivi de l'implémentation Codex décrite ci-dessous. L'intégration comparaison/paint reste à Opus ; aucun fichier UI ou runner modifié par Codex.

## API READY — contrôleur et renderer livrés à 19:17

- `web/src/render/urbanBuildingDetails.ts` : `UrbanBuildingDetailController.suspend(): void` disponible, synchrone et idempotent. Supprime la demande et les overlays actifs, conserve les entrées natives et leur identité en cache, laisse les appels physiques se terminer sans remplir la file. Un `update` normal reprend la politique demandée.
- `web/src/render/urbanBuildingLod.ts` : `BuildingDrawOptions.useDetails?: boolean` disponible. `false` dessine exclusivement les plans indexés ; le défaut `true` conserve le comportement existant. Aucun changement de cache, de scène ou de demandes natives provoqué par ce paramètre.
- Vérification : deux tests ciblés PASS (17 ms cumulés), couvrant 2 appels physiques + une demande en attente, suspension répétée sans notifications répétées, résultats tardifs ignorés, reprise du cache sans réalisation, arrêt avant dispatch, et alternance détail/plan/détail sans lecture ou éviction du mesh natif pendant le dessin des plans. `npx tsc --noEmit` PASS après ajout d'un champ requis au nouveau fixture de test. Aucun navigateur, serveur ou benchmark lourd lancé.
- **RELEASED / intégration Opus attendue** : appliquer les trois raccords UI ci-dessous (`begin/show` synchrone, garde 2D, garde 3D) et `useDetails: !compare` sur `native.draw`. Les deux fichiers renderer/contrôleur sont libérés ; les captures 100k précédentes restent invalidées.

## Preuve et cause

Source : `web/out/city-visual-bench/100k-source8811/report.json`, cas `47-european-100k-close`, scène primaire en **detailed**. Les 14 réalisations normales se terminent à 214046 ms. Pendant la comparaison, le garde réseau bloque ensuite deux nouveaux `/houses/realize-plan` à **216266 et 216267 ms**, pour `100k-unequal-parcels-parcels`. Ce ne sont pas des réponses tardives : ce sont deux nouvelles tentatives bloquées avant envoi natif.

Les trois captures du centre ont conservé les références `ref-1..4` ; la comparaison ne régénère donc pas la ville. Mais la condition de demande de détails dans `terrainUrban.ts:889–890` est toujours :

```ts
enabled: architectureMode === 'detailed' && !!native
```

Le mode primaire reste `detailed`. Pour une comparaison `buildings/compact`, `native` reste le renderer natif. Cette condition réactive donc les détails même quand `comparison.state()` est actif.

La séquence qui expose le défaut est précise : le troisième écran est `buildings/compact` au centre ; `applyCamera()` restaure ensuite la caméra des parcelles disproportionnées et attend deux frames **avant** le prochain `comparison.show(parcels/compact)`. Pendant ces frames, le mode de comparaison précédent reste `buildings/compact`, donc les nouveaux bâtiments visibles déclenchent deux demandes. `citybench.ts:287` confirme que `restore({view})` appelle uniquement `setView`, puis `showView`/`settlements.updateView` : il ne restaure ni paramètres ni scène. Changer l'ordre du runner masquerait seulement le défaut ; conserver le garde réseau.

## Deux effets à corriger

1. **Demandes natives interdites pendant toute la session**, y compris les déplacements de caméra, `begin()` avant le premier paint, et une éventuelle caméra 3D encore active.
2. **Dessiner les plans retenus** pour `compact`, sans substituer les extérieurs déjà en cache. `urbanBuildingLod.ts:536–537` lit actuellement `this.details.get(id)` au LOD facets. Les 14 détails du centre sont réinstallés par l'update ci-dessus ; la capture `100k-core-plans` peut ainsi être enrichie, malgré son libellé compact. Les identités de scène inchangées ne suffisent pas à prouver un dessin des plans seuls.

## Petit patch proposé

### Contrôleur : suspension synchrone sans vider le cache

Ajouter `suspend(): void` à `UrbanBuildingDetailController` (Codex), avec cette sémantique :

```ts
suspend(): void {
  if (this.disposed || (!this.enabled && this.desired.size === 0)) return;
  this.enabled = false;
  this.desired.clear();
  this.viewKey = ''; // le prochain update après end() réévalue la caméra
  waiting.delete(this);
  for (const id of this.cache.keys()) this.renderer.setDetail(id, undefined);
  this.notify();
}
```

La suspension est idempotente : ne pas notifier à chaque update 3D déjà suspendue, sous peine d'entretenir une boucle de frames via les abonnés. Ne pas appeler `dispose`, `replaceScene`, `cache.clear` ou annuler une requête HTTP déjà partie. Le cache natif borné, ses octets et ses références restent conservés. Les jobs physiques déjà partis gardent leur slot jusqu'à règlement ; `wanted()` devient faux, leurs résultats ne réinstallent rien, et `pump()` ne relance rien. Les jobs réservés mais pas encore dispatchés sont rejetés par le contrôle `wanted()` existant avant `realize`.

### UI : couvrir begin, 2D et 3D

Dans le `repaint` fourni à `createCityComparison`, suspendre **synchroniquement** si la comparaison est active, avant de programmer la frame :

```ts
repaint: () => {
  if (comparison.state()) cityDetails?.suspend();
  cityLayer?.request();
},
```

Le callback n'est appelé qu'après initialisation ; `begin()` a déjà posé l'état actif. Il est aussi appelé par `show()`. `end()` retire l'état, puis le prochain paint restaure la demande normale depuis le cache.

Dans `paintCity`, ajouter le garde durable :

```ts
enabled: !compare && architectureMode === 'detailed' && !!native
```

Dans la façade `buildingDetails.update`, protéger également le chemin 3D :

```ts
update(view: BuildingDetailView) {
  if (comparison.state()) { cityDetails?.suspend(); return cityDetails?.stats; }
  return architectureView === '3d' ? cityDetails?.update(view) : cityDetails?.stats;
},
```

Sans ce garde, une mise à jour 3D pourrait réactiver le contrôleur après la suspension. `setActiveView` ne lance pas directement de demande ; aucun autre appel à `cityDetails.update` ne crée de travail dans ce fichier.

### Rendu : mode plans explicite conseillé

La suspension ci-dessus détache les overlays avec `setDetail(id, undefined)` et **conserve le cache natif**. Cela suffit déjà à dessiner les plans de base, sans nouvelle scène ni clonage. Pour rendre le contrat de dessin indépendant de l'état du contrôleur, petit ajout conseillé au renderer :

```ts
// BuildingDrawOptions
useDetails?: boolean; // défaut true, aucune rupture des appelants

// drawVector, choix du building
const building = options.useDetails !== false && lod === 'facets'
  && options.metresPerPixel < this.options.rasterThresholdMpp
  ? this.details.get(entry.building.id) ?? entry.building : entry.building;

// terrainUrban, native.draw
useDetails: !compare,
```

Les tiles raster utilisent déjà les plans de base ; aucun changement de clé ou invalidation globale nécessaire. Ce drapeau ne suspend pas les demandes : il complète les gardes précédents, ne les remplace pas.

## Vérification bornée attendue

Un test ciblé suffit : précharger un détail, entrer en comparaison depuis detailed, déplacer la caméra sur une maison non mise en cache **avant** de changer la couche, appeler aussi l'update 3D. Vérifier zéro nouveau callback `realize`, cache natif et identités conservés, et aucun accès au mesh détaillé dans le dessin compact. Après `end`, le détail du centre doit pouvoir être réutilisé sans nouvelle réalisation. Inclure le cas d'un job déjà parti : il garde son slot jusqu'au règlement et ne relance pas la file.

Le live 100k existant demeure un échec des auxiliaires : 3 PNG produits, 9 auxiliaires invalidés par le garde. Ne pas requalifier les fichiers existants après correction. Une future vérification doit couvrir au moins deux caméras distinctes depuis une scène primaire detailed ; la preuve antérieure 01-s à caméra unique ne couvrait pas ce cas.
