# Refactoring des vues et du rendu de la V2

Avis de Codex et synthèse de la revue indépendante de Claude Opus 5.5 — 31 octobre 2026.

**Je recommande un refactoring progressif autour d’une scène partagée et d’une recette d’apparence composable.** La V2 possède déjà des composants solides ; leur orchestration accumule les exceptions. L’objectif est de rendre les combinaisons explicites, de partager les décisions entre 2D, 3D et export, et de limiter les recalculs. La rapidité restera liée aux données, aux matériaux et au matériel : une architecture générique ne rendra pas tous les moteurs équivalents.

## Mon diagnostic

**Les responsabilités se chevauchent.** `StudioClient` pilote génération, plusieurs chemins de rendu, minicarte, fond 3D et export. `BenchRenderer` assemble terrain GPU, images issues de SVG, cartographie classique et villes natives. Pour réutiliser la cartographie, il fabrique un monde temporairement privé d’eau et d’autres éléments. Cette adaptation révèle une frontière trop large : dessiner une couche exige aujourd’hui de préparer un `World` modifié.

**Le style porte trop de décisions.** `terrainStyle` rassemble palettes, matériaux, pinceaux et diagnostics. Des tests comme `startsWith('render-v2')` sélectionnent aussi un profil de forêt. `appearance` mêle intention visuelle et choix d’implémentation, avec `renderer: classic | bench`. La présence de villes dans `world.debug.v2RustCities` intervient jusque dans le choix du chemin de rendu. Ajouter une combinaison demande donc de connaître plusieurs conventions implicites.

**Les décisions sont dispersées.** Le choix du rendu est répété dans le client, le rendu composite et l’export. La 2D et la 3D résolvent séparément leurs valeurs par défaut ; elles diffèrent notamment pour la palette et la vue urbaines. La vue 3D modifie directement certains réglages partagés. Les clés de cache sont assemblées manuellement et certaines ressources sont reconstruites quand l’identité globale du monde change.

**Les bases utiles existent.** Séparation génération/affichage, données natives conservées, caches, index spatiaux, niveaux de détail et interface terrain WebGPU/WebGL sont déjà présents. Les optimisations documentées ont réduit les copies entre workers. Il faut préserver ces acquis et les identités des archives natives.

## Synthèse de l’avis de Claude

J’ai consulté **Claude Opus 5.5**, identifié par le runtime comme `claude-opus-5-5`, pour une revue indépendante en lecture seule. Il confirme la concentration des responsabilités, les sélections de rendu dupliquées, les conventions fondées sur les noms de styles et les divergences de valeurs par défaut.

Il propose une scène commune, une fonction pure de résolution de l’apparence, un registre explicite des propriétés des styles et une succession de passes spécialisées. Ses premières interventions seraient la sélection unique du rendu, la résolution commune de l’apparence urbaine et le remplacement des tests de préfixes par des propriétés déclarées.

**Je partage cette direction, avec deux nuances.** Je conserverais le rendu classique derrière un adaptateur tant qu’il rend un service utile. Je traiterais ses pistes de performance comme des hypothèses à mesurer : les vecteurs disposent déjà d’un cache, et déplacer du travail dans un worker améliore surtout la réactivité, sans garantir un calcul total plus court.

## Architecture et composition proposées

La chaîne cible serait : **produits des moteurs → scène de rendu → apparence résolue → passes spécialisées → écran ou export**.

**Une scène commune par références.** Les adaptateurs exposent relief, eau, végétation, réseaux, villes et annotations avec unités, emprise, identifiants et révisions explicites. Ils référencent les tableaux et archives existants. Les capacités indiquent les produits disponibles : un moteur dépourvu de cadastre ou de diagnostic hydrologique ne doit pas en fournir une approximation implicite. Les données propres à chaque moteur restent accessibles en extension.

**Une recette d’apparence indépendante des moteurs.** Séparer matériau du sol, représentation de la végétation, palette, traits, bâtiments, éclairage, saison, couches et diagnostic. Un style nommé devient un préréglage de cette recette. Une fonction pure résout héritage, valeurs par défaut et compatibilités pour chaque cible. Les interactions des vues émettent des modifications de réglages ; leur application appartient à l’orchestration.

**Des passes avec des responsabilités précises.** Chaque passe déclare ses entrées, ses ressources, ses dépendances et ses règles d’invalidation. Commencer par un ordre maîtrisé : fond et terrain, eau, cartographie, ville, diagnostics, annotations. La 3D partage les données et les choix visuels, tout en conservant sa géométrie, sa profondeur et son dessin spécialisés. L’export consomme la même recette, avec une sortie vectorielle, raster ou hybride selon les éléments.

**Une composition encadrée.** On pourrait associer sol satellite, palette personnalisée, forêts en symboles, bâtiments cartographiques et noms en style parchemin. Cela exige des masques et une attribution claire de chaque élément : une forêt ou une rivière doit être dessinée une seule fois. Mélanger deux matériaux sur une même surface demande une règle explicite de transition. Certaines associations resteront incompatibles ; le résolveur doit expliquer pourquoi.

Je limiterais la première version à ces composants typés. Un éditeur de nœuds universel ou une abstraction de tous les appels graphiques ajouterait immédiatement une nouvelle complexité.

## Performance et migration

**La priorité est de recalculer uniquement les produits affectés.** Une palette modifie des couleurs ; la saison actualise les paramètres du matériau ; une modification de maison invalide ses ressources ; la caméra change la sélection visible. Les caches devraient dépendre des révisions des produits concernés et des paramètres effectivement lus. Conserver les ressources GPU, limiter les copies et les conversions SVG/image, puis mesurer avant de déplacer une passe vers un worker. OffscreenCanvas permet cette exécution hors du fil principal, sous réserve des capacités du contexte utilisé [1].

Je procéderais en cinq étapes :

1. **Fixer la référence.** Conserver des projets représentatifs et mesurer ouverture, changement de style, navigation, export et mémoire, sur plusieurs backends. Réutiliser les tests de conservation des données et les comparaisons visuelles existants.
2. **Centraliser les décisions.** Introduire un résolveur du chemin de rendu et de l’apparence, puis des propriétés explicites de styles. Préserver d’abord les comportements et les anciens projets.
3. **Définir la scène et extraire les passes.** Encapsuler l’accès aux villes natives, puis isoler ville, eau et cartographie. Supprimer progressivement la fabrication de mondes temporaires pour masquer des couches.
4. **Partager la recette avec la 3D et l’export.** Ajouter les combinaisons utiles, leurs règles de compatibilité et une migration versionnée des anciens réglages.
5. **Optimiser sur mesures.** Affiner invalidation, résidence des ressources et ordonnancement ; évaluer les workers et la compilation anticipée des variantes réellement utilisées.

**Le premier lot devrait livrer le résolveur commun, le registre des propriétés de styles et l’accès typé aux produits natifs.** Il établit les frontières nécessaires aux étapes suivantes. Les gains de performance devront être validés séparément de la simplification du code, sans promettre d’accélération du calcul initial des moteurs.

Sources du diagnostic : [client](../web/src/v2/client.ts), [rendu composite](../web/src/v2/benchRenderer.ts), [contrats](../web/src/v2/contracts.ts), [styles](../web/src/render/terrainStyle.ts), [forêt](../web/src/v2/displayForest.ts), [ville 2D](../web/src/v2/nativeCityMap.ts), [3D](../web/src/v2/urban3d.ts), [interface terrain](../web/src/ui/terrainRenderer.ts), [optimisations documentées](V2_OPTIMIZATION.md). Analyse du code courant ; aucun nouveau benchmark réalisé pour cette note.

[1] [Standard HTML sur OffscreenCanvas](https://html.spec.whatwg.org/multipage/canvas.html#the-offscreencanvas-interface).
