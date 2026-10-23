# Perte/restauration WebGL — correction ciblée terminée

22 octobre 2026. Suite du TODO de `CODEX_CITY_PAN_GHOSTING.md`. Aucun changement de géométrie, moteur natif, serveur, build release ou benchmark de ville.

## Défaut et correction

`cityGl.ts` mémorisait déjà la perte et reconstruisait ses ressources après restauration. Cependant, `CityGlHost` continuait d'exposer `drawGl`; `paintCity` retirait donc les couches Canvas même quand le GPU ne renvoyait qu'une frame vide. La restauration réimportait les maillages sans demander de repaint : une caméra immobile pouvait conserver cette absence de dessin.

Le renderer expose désormais `ready` (plan importé, contexte physique utilisable, instance active) et notifie le host lors de la perte, d'une restauration et d'un import accepté. La perte masque immédiatement le canvas GPU et planifie une peinture Canvas complète. La restauration conserve ce repli jusqu'à la reconstruction des programmes et au réimport des derniers maillages CPU ; elle demande ensuite une peinture, sans recalcul de ville. Un échec de restauration reste en Canvas et est signalé. Un import effectué pendant la perte conserve sa dernière scène sur CPU, sans tentative d'upload dans le contexte perdu.

Le host n'expose le dessin GPU que lorsqu'il est prêt et vérifie encore sa disponibilité après le dessin : une perte survenue entre les deux n'est pas considérée comme une présentation réussie. Dans `paintCity`, les deux décisions de masquer les couches/bâtiments Canvas reposent sur la **frame GPU effectivement obtenue**, au lieu de la simple présence du callback. Les notifications tardives ne redémarrent pas un host libéré. Le correctif précédent du calque fantôme reste inchangé dans son principe : visible seulement après un dessin GPU de la frame courante.

Fichiers produit : `web/src/render/cityGl.ts`, `web/src/render/cityGlHost.ts`, deux conditions dans `web/src/ui/terrainUrban.ts`. `cityGlLayer.ts` est le prototype utilisé seulement par `city_perf_render.mjs`, pas le chemin City Bench : il n'a pas été modifié.

## Vérification

- `npx vitest run tests/cityGlHost.test.ts tests/cityGlContext.test.ts` : **3/3 PASS**. Ancien test pan/Canvas/calque fantôme conservé ; perte pendant le draw, import pendant la perte, dernière scène réimportée, repaint sans pan, échec du driver restauré, `preventDefault` et libération couverts. Le test renderer utilise ses vrais chemins de packing/import avec un GL simulé.
- `npx tsc --noEmit` : **PASS**.
- Petit contrôle WebGL matériel réel, **hors serveur**, via `WEBGL_lose_context` : **PASS**, RTX 4090 / ANGLE D3D11. Un lot puis deux parcelles, viewport 800×600 et caméra strictement constante. Séquence observée : GPU révision1 → Canvas pendant la perte → nouvelle scène révision2 en Canvas → GPU restauré avec la révision2. Visibilités : `visible / hidden / hidden / visible`. Zéro erreur JavaScript ; PNGs Canvas/GPU ouverts et examinés. Les traits des deux peintres ne sont pas prétendus identiques pixel à pixel.

Le contrôle réel importe le host, le renderer et `drawCity`, avec la même sélection de couches que `paintCity`; il ne lance pas toute l'interface City Bench. Une première capture sans le paramètre de largeur de trait du harness avait omis les contours Canvas ; le harness a été corrigé à0,6, puis le même petit cycle a été rejoué. Aucun code produit supplémentaire modifié à cette occasion.

Preuves : `web/out/city-gl-context/{verify.mjs,report.json,01-gpu.png,02-context-lost.png,03-latest-canvas.png,04-restored.png}`. Reproduction depuis `web` : `node out/city-gl-context/verify.mjs`. Le navigateur éphémère est fermé à la fin. Ce contrôle ne certifie ni les performances d'une grande ville, ni le moteur de vue3D séparé, ni l'ancien prototype `cityGlLayer`.

**READY — fichiers libérés.**
