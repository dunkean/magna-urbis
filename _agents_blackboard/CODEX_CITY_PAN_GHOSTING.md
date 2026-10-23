# City Bench — correction du plan fantôme au déplacement

2026-10-22, 20:54. Fichiers libérés. Deux petits parcours réels avant/après sur les services existants 5173 / 8791 ; aucun service lancé, aucun changement natif, aucune grande ville.

## Cause et correctif

Le `foreignObject` de `CityGlCanvasLayer` porte deux canvas superposés. Son Canvas 2D est effacé à chaque frame, mais le canvas WebGL conservait son image compositée lorsque `paintCity` n'appelait plus `gl.draw`. Cela arrive avec la palette parchemin, la comparaison, l'attente d'upload du nouveau plan et les retours anticipés sans plan/avec scène désactivée. Le host suit la caméra ; l'ancienne image GPU reste donc fixe à l'écran sous le nouveau dessin. `preserveDrawingBuffer: false` n'efface pas cette image compositée.

`CityGlHostFrame.drawGl` remplace l'accès direct au renderer dans le callback de peinture. Le host masque le canvas GPU par défaut et ne le révèle qu'après un dessin GPU de la frame courante. Un `finally` applique cette visibilité même si la peinture échoue. L'accès public `layer.gl` reste disponible pour l'upload des scènes. Le Canvas 2D, la projection, le fond SVG, le culling et les données retenues ne changent pas.

Production : `web/src/render/cityGlHost.ts` et les quatre usages GL dans `paintCity` de `web/src/ui/terrainUrban.ts`. Aucun changement dans `citybench.ts`, `cityCanvas.ts`, la comparaison, les maisons ou le moteur natif.

## Preuve visuelle et contrôles

Scène réelle 07-pueblo, 900 habitants, parcours du plan uniquement (sans lecture de sites ni génération de maisons dans ces deux runs). Edge headless avec GPU actif : **ANGLE NVIDIA GeForce RTX 4090 / Direct3D11**, sans `--disable-gpu` ni backend artificiel. Les captures et rapports sont dans `web/out/city-pan-ghosting/{before,after}/`.

- Preuve principale : `before/03-parchment.png` montre nettement deux plans décalés ; `after/03-parchment.png`, à caméra identique, ne montre plus qu'un plan. La première bascule est effectuée après retour caméra mais avant nouvelle peinture GPU, ce qui reproduit aussi un frame GPU antérieur.
- Même déplacement souris +160/+80 px avant/après ; huit caméras strictement identiques dans les deux rapports. Le pan normal WebGL était déjà correct. La séquence vérifie ensuite pan parchemin, zoom molette, resize 1500×1000 → 1300×850, et retour WebGL.
- En masquant manuellement le GPU déjà inactif au même emplacement, l'image avant change sur **244117 pixels**, dont **122764** de plus de 3 niveaux RGB. Après correction : **166 pixels** diffèrent d'un seul niveau, **0 pixel** de plus de 3 niveaux. Les PNG ne sont donc pas prétendus identiques bit à bit. Les données de visibilité confirment `hidden` sur les frames Canvas, `visible` sur les frames GPU.
- PNGs avant/après, zoom, resize et retour GPU ouverts et inspectés. Aucune erreur JavaScript. Le backing passe bien de 1200×925 à 1000×775 au resize.
- Test ciblé `web/tests/cityGlHost.test.ts` : GPU → fallback au pan → reprise GPU à la bonne caméra → retour anticipé → resize, avec effacement 2D et libération. **1/1 PASS**.
- `npx tsc --noEmit` : **PASS** après correction du type d'un mock de test.

Script reproductible : `cd web; node scripts/city_pan_ghost_smoke.mjs <phase>`. Il utilise la requête de la petite scène précédemment archivée, sans générer d'architecture détaillée. `verification.json` détaille caméras et différences de pixels.

## Limites

Le lien utilisateur reçu ensuite utilise justement `palette: parchment`, cohérent avec le chemin reproduit. La preuve ci-dessus porte sur la couche urbaine, pas sur un défaut du PNG de relief. Elle n'est pas une acceptation de la qualité des villes/maisons ni de la campagne de 50 cas.

Audit indépendant de style_index : une perte réelle de contexte GPU peut aussi laisser momentanément un plan vide, car le renderer gère la restauration sans notifier un repaint du host. C'est un problème distinct, non reproduit ici et non modifié dans ce correctif ciblé ; le masquage du vieux calque couvre les transitions de rendu mais ne prétend pas tester la restauration du contexte.

Complément livré ensuite : le défaut de contexte est corrigé et vérifié séparément dans `CODEX_CITY_GL_CONTEXT.md` (3 tests, TypeScript et petit cycle matériel réel hors serveur). Le périmètre et les preuves de cette première correction de ghosting restent ceux décrits ci-dessus.
