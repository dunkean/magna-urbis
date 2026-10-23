# Détails natifs depuis un index visuel — raccord du consommateur

23/10/2026. Code intégré dans `web/src/render/urbanBuildingDetails.ts` et `urbanBuildingLod.ts`. Les consommateurs actuels conservent leur chemin en mémoire ; CityBench ne bascule pas encore automatiquement sur le stockage froid. Aucun gain de heap/FPS ou résultat million revendiqué.

## Contrat utilisable

`UrbanBuildingDetailController<B extends CompactBuildingVisual>` accepte soit l'ancien `{scene, renderer, realize}`, soit `{renderer, load, canRealize, realize}`. Dans le deuxième cas, il ne possède aucune scène native exhaustive. Le loader reçoit le DTO visuel demandé et rend un seul vrai `PlacedBuilding` accompagné de son contexte d'archive minimal. Il ne doit pas convertir le DTO en faux plan. Le contexte froid doit contenir exactement ce bâtiment ; les archives/matériaux nécessaires restent ceux du stockage.

Avant tout appel natif, le contrôleur vérifie ID, fonction, recette/variante/parcelle si présentes, contours et trous sans tolérance, entrée, sol et hauteur. La réalisation reste `interiors:false`, puis `nativeExteriorDetail` vérifie les corps et la transformation natifs. L'overlay ne réutilise les références des contours de l'index qu'après cette vérification. Le renderer conserve le type B pour l'index, les requêtes et le picking ; seul son overlay peut contenir un visuel natif détaillé.

`replaceSource({renderer,load,canRealize})` change de génération et invalide tous les anciens résultats. Pour la même génération dont la fenêtre visible vient d'être relue, `refreshProjection()` compare les anciens DTO et les nouvelles valeurs exactes : détails identiques conservés et rattachés aux nouveaux contours, détails absents/modifiés évincés. Appeler ensuite `update(view)`. Les réponses arrivant entre le remplacement de l'index et cet update sont écartées dès que leur objet n'est plus celui de l'index courant. L'installation graphique doit réussir avant toute mutation du cache.

Le sémaphore commun garde au plus deux travaux, y compris les lectures froides en attente et les appels natifs des contrôleurs remplacés. Une réponse native doit se terminer physiquement avant de libérer son créneau. Le loader doit sérialiser ses accès s'il partage un reader froid ; préférer un reader dédié, lui-même borné, pour ne pas violer l'exclusivité du contrôleur de sélection.

## Budget et limites

Le cache est borné en nombre, sommets et comptabilité de données. Pour les plans froids, le coût comprend aussi la représentation JSON du plan et **tout le texte de son archive comprimée** : une référence enregistrée peut retenir les 64 plans du chunk. La facturation par détail est conservatrice, même si plusieurs chaînes sont partagées. Un plan qui dépasse seul le budget est refusé avant réalisation native. Cette comptabilité n'est pas une mesure du heap JavaScript. La lecture initiale et la réponse native restent des allocations transitoires ; leurs budgets propres demeurent nécessaires.

La scène en mémoire historique n'est ni recopiée ni parcourue globalement à chaque demande de détail. Le contrôleur garde ses références authentiques ; aucun nouvel index natif de toute la ville n'est ajouté.

## Vérifications

**26 tests verts dans quatre fichiers, TypeScript vert.** Huit tests détails, treize LOD, trois projections, deux mises à jour 3D. Cinq nouveaux tests détails couvrent chargement à la demande, conservation du picking visuel, relecture de fenêtre, métadonnées modifiées, plan manquant/différent, remplacement pendant lecture, réponse native périmée, le gap index→update et budget de l'archive avant dispatch. Les tests historiques restent verts. Revue indépendante : course de rafraîchissement trouvée puis corrigée ; aucun autre blocage concret relevé.

Empreintes des trois fichiers et commandes observées : `web/out/cold-details-delivery-20261023/verification.json`.

Le test de budget utilise volontairement une archive synthétique jamais décodée et démontre son rejet avant l'appel natif, pas sa validité. Les autres tests de détail utilisent le corpus natif de référence du dépôt ; aucun serveur ni navigateur lancé, aucune génération urbaine de masse affirmée.

Reste à raccorder dans CityBench : `runCold`, backend IndexedDB réel, contrôleur viewport, sélection/édition/transfert natifs, exports/imports/historique complets et consommateurs 3D. Les anciens accumulateurs ne doivent plus être utilisés sur ce chemin pour obtenir un gain produit. Les tâches globales de mémoire, performance et validation visuelle restent ouvertes.
