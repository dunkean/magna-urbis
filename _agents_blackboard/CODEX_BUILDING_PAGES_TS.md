# Pages de sites — bridge TS et worker READY / RELEASED

2026-10-22, 19:52. Aucun serveur, build natif, navigateur ou benchmark lourd lancé. Contrat `architecture.ts` inchangé.

## API

Nouveau `rust/bridge/urbanBuildingPages.ts` :

```ts
beginUrbanBuildingPages(
  { source, keys?, seed, architectureCulture? },
  runtime,
  { cancelled? }?,
): Promise<UrbanBuildingPages | undefined>

interface UrbanBuildingPages extends ArchitectureRequestSource {
  total: number;
  read(offset, limit, maxBytes): Promise<readonly PlacementRequest[]>;
  timing: { prepareMs: number; readMs: number; pages: number };
}
```

Le helper vérifie `/status` à chaque ouverture. `undefined` signifie uniquement absence de la capability `urban.building-site-pages` sur un service local valide. Une erreur réseau, de `begin`, de page, de révision ou d'index remplacé est propagée ; elle ne déclenche jamais de lecture monolithique de secours.

Les POST `/urban` contiennent uniquement les champs du contrat. La source complète est copiée par ses cinq champs scalaires et renvoyée à chaque page ; mutations ultérieures et propriétés supplémentaires du caller ne changent pas l'identité ni ne transfèrent une géométrie. `keys: []` reste explicite. La page n'envoie pas de graine, culture, keys, raster, layouts ou partitions : la requête est fixée par `begin`.

Validation : total entier sûr, sourceId non vide ≤128 caractères, offsets et `next`, total stable, ≤64 sites, IDs non vides et distincts dans la page, UTF-8 JSON du tableau incluant crochets/virgules ≤24 MiB. Le corps de réponse est borné avant parsing à budget demandé +64 KiB d'enveloppe. Un préfixe vide sous budget partiel requiert `requiredBytes > maxBytes`; un site qui ne tient pas dans le plein budget échoue explicitement. **Budget restant de 1 octet : `[]` local sans POST**, pour laisser l'adapter publier son préfixe puis relire au plein budget. Budget zéro invalide.

Annulation logique avant/après les lectures ; un POST déjà parti est laissé se terminer avant de libérer la séquence du worker. Aucune annulation de fetch qui autoriserait un `begin` concurrent tant que l'ancien appel travaille encore.

## Worker

`web/src/ui/urbanSceneWorker.ts` choisit les pages seulement pour **source + local + compact/detailed + progressive + capability**. Il appelle une seule fois `streamUrbanBuildingSource` pour toute la ville, donc conserve le contexte continu de voisins et les graines existantes. La branche s'exécute avant la création de l'ancien engine de sites et ne télécharge aucun tableau complet.

`applyHouseEdits` s'applique page par page. Une Map offset→requête originale retient au plus 64 références ; la publication `batch.requests` reprend ces originaux, **avant overrides**, pour l'inspecteur et la comparaison. Les références sont supprimées après ACK. Les restes d'un chunk réduit/retry restent disponibles jusqu'à leur propre publication. Aucun nouvel index de la ville, clone de tous les sites, tableau complet de résultats ou de plans n'est ajouté au worker.

Après la publication d'un chunk, la lecture suivante attend l'ACK. Une annulation casse l'attente et ne publie pas de completion obsolète. Seuls les compteurs sont envoyés à la fin. Chemins WASM, silhouette, non progressif, legacy et anciens serveurs conservés ; ils peuvent toujours lire les sites en une fois. Après un `begin/page` échoué, aucune bifurcation vers ces chemins.

Le seul ajout à `urbanSceneProtocol.ts` est `timing.sitesPrepare?`, `sitesRead?`, `paged?`. En mode paginé, `sites = sitesPrepare + sitesRead`; `placement` est le reste du temps mural de pipeline, **y compris attente des ACK**, hors lectures des sites. Donc `sites + placement` reste interprétable comme durée de ce pipeline, pas comme temps CPU des maisons. La mesure de première image du runner reste indépendante.

## Vérification et limites

`vitest --project fast` : **8/8 PASS** dans `urbanBuildingPages.test.ts`, `urbanSceneStreaming.test.ts`, `urbanSceneSource.test.ts` (1,50 s). Les trois nouveaux tests vérifient budget court puis relecture, 1 octet sans HTTP, whitelist et source immuable, absence de capability, stale/budgets/offsets invalides, et le véritable handler worker avec l'adapter continu : 65 sites, overrides sur la première et dernière requête, originaux inchangés, ACK avant page suivante, annulation, completion sans scène et absence de repli après stale. `npx tsc --noEmit` PASS après correction de quatre accès optionnels dans le test.

Ce retrait du tableau complet de sites côté worker ne rend pas tout le système constant en mémoire : le main thread conserve encore les sites et la scène pour édition/comparaison ; le placement garde ses occupations exactes et son ensemble d'IDs ; le natif garde l'index courant, les snapshots et ses caches morphologiques. Un chunk peut atteindre 24 MiB, plus décodage/objets temporaires ; aucune mesure de heap ou gain de latence live n'est revendiquée. La nouvelle capability doit être présente dans le runtime déployé pour activer ce chemin.

**Fichiers libérés :** `rust/bridge/urbanBuildingPages.ts`, `web/src/ui/urbanSceneWorker.ts`, `web/src/ui/urbanSceneProtocol.ts`, `web/tests/urbanBuildingPages.test.ts`. Aucun fichier terrainUrban, renderer, UI de comparaison, Rust core/local ou runner modifié dans cette tâche.
