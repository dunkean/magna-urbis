# Magna Urbis : architecture technique et fondements scientifiques

État documentaire : **14 octobre 2026**. Magna Urbis est un prototype de génération de paysages et d'établissements préindustriels. L'application TypeScript reste la référence la plus complète ; la version Rust/WebAssembly est **en cours d'implémentation et d'intégration**. Ce document décrit les chemins présents dans le dépôt et leurs fondements, sans proposer une nouvelle architecture définitive.

Les liens de code permettent de distinguer une méthode effectivement utilisée d'une référence scientifique qui sert à expliquer ou comparer une approche. Les articles cités ne constituent pas une validation scientifique de Magna Urbis : les paramètres, simplifications et choix artistiques du projet ont leur propre domaine de validité.

## 1. Les couches du système

| Couche | Entrées et résultats | Implémentation et état |
| --- | --- | --- |
| Application de référence | Graine, environnement et cultures → paysage, villes, bâtiments et exports | TypeScript dans `web/`, sans serveur de génération |
| Relief procédural | Bruits, formes de relief, côtes et érosion → champ d'altitude | Rust `crates/core`, WASM ; accélération WebGPU de certaines passes |
| Relief neuronal optionnel | Esquisse, climat et graine → champ d'altitude appris | Service Rust natif `crates/neural`, avec Burn et poids Terrain Diffusion |
| Hydrologie | Altitudes → drainage, lacs, graphe de rivières et lits | Rust ; préparation du drainage possible sur GPU, finalisation vectorielle CPU/WASM |
| Implantations et routes | Terrain et eau → lieux habités et réseau régional | Rust, étapes distinctes dans Terrain Bench |
| Plans urbains | Site, accès, population et culture → quartiers, rues, îlots et parcelles | Rust/WASM dans Terrain Bench et Urban Bench ; intégration en cours |
| Maisons | Recettes architecturales et contraintes → corps, cours et toitures | Moteur Rust indépendant, House Bench ; assemblage avec les villes encore distinct |
| Occupation rurale et rendu | Géométrie et environnement → champs, végétation et carte | TypeScript et adaptateurs temporaires ; le renderer final reste à développer |

La dépendance logique principale est :

```text
graine + paramètres
  ├─ relief procédural → érosion et côtes
  └─ esquisse + climat → coarse → base → decoder → altitude neuronale
                         ↓
                 surface physique conservée
                         ↓
               drainage → lacs et rivières
                         ↓
             implantations → routes régionales
                         ↓
             quartiers → rues / îlots → parcelles
                         ↓
                 interface, rendu et exports

maisons : moteur indépendant, raccordement aux parcelles en cours
```

Une modification de parcelles n'a pas à recalculer le terrain. La caméra échantillonne la surface conservée : zoomer ne relance ni l'érosion ni les réseaux neuronaux. Voir [le moteur de terrain](../rust/crates/core/src/engine.rs), [les implantations](../rust/crates/core/src/settlements/mod.rs) et [les étapes urbaines](../rust/crates/core/src/urban/mod.rs).

## 2. Relief procédural : bruits, motifs et échelles

Un bruit cohérent attribue des valeurs voisines à des coordonnées voisines. La référence classique est le travail de Perlin sur les bruits de gradient ; l'implémentation locale utilise un **bruit simplex 2D** et des sommes d'octaves. Il faut distinguer cette variante du bruit amélioré de Perlin, cité ici comme fondement général. [Perlin, 2002](https://mrl.cs.nyu.edu/~perlin/paper445.pdf) ; [code local](../rust/crates/core/src/noise.rs).

Une écriture simplifiée de la somme est :

```text
h_bruit(x, y) = Σ a_k · N(f_k · x, f_k · y)
```

`N` est le bruit cohérent, `f_k` sa fréquence et `a_k` l'amplitude de l'octave. Les basses fréquences structurent les masses ; les hautes apportent les détails. Le *domain warping* déforme les coordonnées d'évaluation par d'autres bruits, ce qui évite des crêtes trop régulières. L'appellation « fractal » décrit cette construction multi-échelle ; elle ne démontre pas une loi géologique.

La taille de carte et l'échelle du motif sont séparées. Les familles de relief ajoutent des contraintes de forme : plaine, collines, vallée, montagnes, plateau, canyon, volcan ou caldeira. La découpe côtière définit une surface signée, avec mer à zéro, puis conserve le résultat des traitements physiques. Les octaves non résolues à l'échelle d'échantillonnage sont filtrées pour limiter les artefacts. Voir [le cœur](../rust/crates/core/src/lib.rs), [les côtes](../rust/crates/core/src/coast.rs) et [la préparation des bruits](../rust/crates/core/src/generation_noise.rs).

## 3. Érosion : drainage, incision et redistribution

### Dépressions et directions d'écoulement

Un champ d'altitude contient des cuvettes sans sortie et des zones plates où la pente ne suffit pas à choisir un aval. **Priority-Flood** explore les cellules depuis les sorties, par altitude croissante, et calcule le niveau nécessaire pour évacuer chaque dépression. Ce niveau est un potentiel de drainage ; il ne signifie pas que toutes les cuvettes doivent devenir des lacs ou être physiquement remplies. [Barnes, Lehman et Mulla, 2014](https://doi.org/10.1016/j.cageo.2013.04.024) ; [implémentation des auteurs](https://github.com/r-barnes/Barnes2013-Depressions).

Dans l'érosion, le routage **D∞** estime une direction sur les facettes triangulaires autour d'une cellule et répartit l'aire contributive entre deux voisins aval. Il atténue la préférence des grilles D8 pour huit directions fixes. Le réseau vectoriel final utilise, lui, une topologie de drainage propre : ces deux représentations répondent à des besoins différents. [Tarboton, 1997](https://doi.org/10.1029/96WR03137) ; [code d'érosion](../rust/crates/core/src/erosion.rs).

### Incision fluviale

La loi de *stream power* relie l'abaissement du lit à l'aire drainée et à la pente. Une forme de référence pour l'évolution du relief est :

```text
∂h/∂t = U − K · A^m · S^n
```

`h` est l'altitude, `U` la surrection, `A` l'aire contributive, `S` la pente et `K` l'érodabilité. Les exposants décrivent la réponse du modèle. Le solveur implicite de Braun et Willett traite les dépendances aval sans imposer les petits pas d'un schéma explicite. [Braun et Willett, 2013](https://doi.org/10.1016/j.geomorph.2012.10.008).

Magna Urbis applique une adaptation interactive : aire contributive plafonnée, réponse atténuée aux faibles pentes, incision bornée et mise à jour implicite vers l'altitude aval. Le réglage « érosion » pilote une intensité, pas une durée géologique calibrée. L'équation ci-dessus explique la famille de méthodes ; elle n'est pas la transcription exacte de toutes les passes du générateur. Les ouvertures de seuils et le remplissage partiel des bassins sont eux aussi limités. [Implémentation CPU](../rust/crates/core/src/erosion.rs) ; [passes GPU](../rust/bridge/terrainErosion.wgsl).

### Relaxation thermique et diffusion de versant

La relaxation thermique déplace du matériau lorsque la pente dépasse un seuil de talus. La diffusion lisse les petites irrégularités, avec protection de certains chenaux. Elles complètent l'incision : creuser les vallées et redistribuer les versants ne sont pas la même opération.

Il faut également distinguer la **diffusion géomorphologique**, qui redistribue une grandeur spatiale, de la **diffusion neuronale**, qui apprend à retirer du bruit. L'érosion locale n'est pas un solveur complet d'hydraulique, de transport sédimentaire et de conservation de masse à l'échelle géologique.

## 4. Hydrologie : du raster aux rivières et aux lacs

### Graphe de drainage et géométrie des cours d'eau

L'étape hydrologique lit la surface physique et construit directions aval, aires contributives, bassins et dépressions. Les diagnostics initiaux restent distincts des décisions de routage et des corrections du terrain. Une brèche bornée peut ouvrir une cuvette non retenue ; les zones plates nécessitent un classement topologique pour éviter boucles et écoulements arbitraires. [Hydrologie](../rust/crates/core/src/hydrology.rs) ; [zones plates](../rust/crates/core/src/hydrology_flats.rs) ; [dépressions](../rust/crates/core/src/hydrology_depressions.rs).

Les cellules de drainage deviennent ensuite un **graphe vectoriel** : sources, tronçons, confluences et sorties. Les largeurs et les profils sont évalués le long des axes ; les lits incisés et les surfaces d'eau servent aussi à l'échantillonnage du terrain. Des nœuds partagés maintiennent les raccords aux confluences. Le profil d'eau doit rester descendant et compatible avec les budgets de correction du sol.

Les courbes locales utilisent des variations déterministes à plusieurs échelles, exprimées en unités physiques et contraintes par le terrain. Elles ne sont pas une sinusoïde dessinée par-dessus une ligne de grille. Les modèles de migration de méandres, comme celui de Howard et Knutson, constituent un point de comparaison scientifique ; le module Rust actuel n'est pas une réimplémentation intégrale de cette simulation temporelle. [Howard et Knutson, 1984](https://doi.org/10.1029/WR020i011p01659) ; [courbes Rust](../rust/crates/core/src/hydrology_meanders.rs).

### Lacs et bilan d'eau

Une dépression topographique ne garantit pas un lac permanent. Le module local estime le ruissellement annuel à partir des précipitations et d'une évapotranspiration empirique dépendant de la température et de l'altitude. Le lac atteint un niveau compatible avec ses apports et l'évaporation de sa surface : il peut rester fermé ou déborder au seuil et transmettre l'excédent. Les minima et plafonds artistiques restent des paramètres du générateur. [Bilan hydrologique local](../rust/crates/core/src/hydrology_balance.rs).

La famille **Fill–Spill–Merge** conserve les dépressions et distribue les apports entre bassins qui se remplissent, débordent et fusionnent. Le module local s'en inspire pour un équilibre simplifié sur son drainage ; il ne reproduit pas toute la hiérarchie et la dynamique de l'algorithme publié. [Barnes, Callaghan et Wickert, 2021](https://esurf.copernicus.org/articles/9/105/2021/).

Ces traitements recherchent une cohérence de réseau et une lisibilité cartographique. Ils ne prédisent ni crues, ni marées, ni navigation. Un relief neuronal plausible visuellement peut encore demander des corrections hydrologiques ou être rejeté par une contrainte de profil.

## 5. InfiniteDiffusion, Terrain Diffusion et Neural Earth

### Ce que signifie « infini »

**InfiniteDiffusion** est l'algorithme de Goslin permettant une génération paresseuse, non bornée, cohérente avec la graine et indépendante de l'ordre de visite. **Terrain Diffusion** est son application à la synthèse de terrain. Les fenêtres partagent un bruit spatial déterministe et leurs contributions se mélangent dans les recouvrements. Le calcul ne consiste donc pas à juxtaposer des images générées indépendamment. [Goslin, 2025, version révisée en 2026](https://arxiv.org/abs/2512.08309).

Les dépendances spatiales sont évaluées à la demande ; la troncature du nombre d'étapes de fusion rend leur expansion praticable. Le coût annoncé constant concerne une région de taille et de configuration fixées, quelle que soit sa position. Agrandir la région, augmenter la résolution ou changer le nombre d'évaluations augmente toujours le travail. [Article, sections 3.3–3.4](https://arxiv.org/html/2512.08309v4).

### La chaîne utilisée dans Magna Urbis

Le port Rust calcule une **fenêtre finie de 40 × 40 km**, et non un monde infini navigable. Il enchaîne :

1. **Coarse** : structure régionale conditionnée par l'esquisse d'altitude et le climat, à une maille de 7 680 m.
2. **Base** : champ latent à une maille de 240 m, conditionné par le coarse.
3. **Decoder** : détail à la maille native de 30 m, puis reconstruction de l'altitude et rééchantillonnage en 1024² pour le banc.

Le profil local est `coarse4` → base original en une évaluation → decoder étudiant distillé. Le planificateur remonte depuis la zone livrée pour déterminer les fenêtres nécessaires ; le mélange normalise leurs contributions pondérées. Le decoder seul ne remplace pas les informations régionales et latentes. [Planificateur](../rust/crates/neural/src/plan.rs) ; [chaîne](../rust/crates/neural/src/pipeline.rs) ; [reconstruction](../rust/crates/neural/src/reconstruct.rs).

La théorie des modèles de diffusion distingue le réseau de débruitage, son conditionnement et le schéma d'échantillonnage. EDM et EDM2 apportent des formulations et des mécanismes de normalisation utilisés dans cette famille de réseaux. La distillation entraîne un étudiant à remplacer une chaîne plus coûteuse ; les modèles de consistance permettent notamment une génération en peu d'évaluations. Cela ne rend pas n'importe quel modèle original fiable en une passe. [Karras et al., 2022](https://arxiv.org/abs/2206.00364), [Karras et al., 2024](https://arxiv.org/abs/2312.02696), [Song et al., 2023](https://proceedings.mlr.press/v202/song23a.html).

L'esquisse règle les grandes formes et le climat oriente les structures apprises. Une petite caractéristique sous la résolution coarse n'est pas assurée de survivre. La surface neuronale est importée sans réappliquer l'érosion et la découpe côtière procédurales ; l'hydrologie constitue une étape séparée. [Esquisse](../rust/crates/neural/src/sketch.rs) ; [surface importée](../rust/crates/core/src/engine.rs).

### Lien avec Neural Earth et Orogen

**Neural Earth**, développé dans le projet Infinite Map, combine la géographie planétaire de **World Orogen** et le raffinement appris de Terrain Diffusion. Orogen produit notamment continents, structures tectoniques, traitements d'érosion et climat ; Neural Earth les relie à l'exploration et aux couches cartographiques. Cette chaîne planétaire appartient à un projet distinct. [Neural Earth](https://github.com/dunkean/neural-earth) ; [World Orogen](https://github.com/raguilar011095/planet_heightmap_generation).

L'objectif de Magna Urbis est d'y ajouter routes, établissements et villes. Cette intégration complète reste à réaliser. L'utilisation des mêmes modèles de relief, ou le partage d'un style de rendu, ne prouve pas que les villes sont déjà intégrées dans un monde planétaire.

## 6. Implantations, routes, plans de villes et bâtiments

### Où placer les établissements et comment les relier

Les implantations combinent constructibilité, pente, eau douce, côtes, position défensive, préférences culturelles et espacement. Une option démographique suit une loi rang-taille : `P_r ≈ P_1 / r^q`. Elle donne une distribution réglable, pas une prédiction historique ou économique. Les exclusions d'emprise évitent de traiter la population comme un simple nuage de points. [Placement](../rust/crates/core/src/settlements/placement.rs).

Le réseau régional sélectionne des liaisons sur un graphe de Delaunay, avec arbre couvrant et raccourcis. La recherche de trajet combine coûts du terrain, pentes, virages, obstacles et réutilisation des routes. Son état conserve une direction d'arrivée ; des mouvements plus variés que les huit voisins permettent de former des lacets. Les intersections sont ensuite réunies dans un graphe planaire. [Routes](../rust/crates/core/src/settlements/roads/mod.rs) ; [recherche](../rust/crates/core/src/settlements/roads/search.rs).

Cette approche appartient à la famille des chemins anisotropes à moindre coût : Galin et ses coauteurs montrent comment intégrer pente et obstacles dans la génération routière. Les classes et contraintes locales de Magna Urbis sont ses propres choix. [Galin et al., 2010](https://doi.org/10.1111/j.1467-8659.2009.01612.x).

### De la culture au graphe de rues

Une ville ne se résume pas à une grille déformée. Le modèle TypeScript combine des morphologies et des phases de croissance : noyaux, axes, enceintes, extensions, places et équipements. Les familles organiques, bastides, médinas, plans chinois ou japonais et cultures fantasy imposent des règles différentes. Les recettes sont des approximations documentées, et leur mélange ne vaut pas reconstitution archéologique. [Cultures](../web/src/gen/urban/cultures.ts) ; [rues](../web/src/gen/urban/streets.ts) ; [catalogue d'établissements](catalogue_settlements_antiquite_moyen_age_rpg.md).

Deux références situent cette démarche : Parish et Müller séparent objectifs globaux et contraintes locales dans des L-systems urbains ; Chen et ses coauteurs utilisent des champs de tenseurs pour guider deux orientations principales de rues et éditer leur graphe. Elles expliquent les familles de méthodes ; les appeler ne signifie pas que Magna Urbis utilise leur solveur exact. [Parish et Müller, 2001](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf) ; [Chen et al., 2008](https://www2.cs.uh.edu/~chengu/Publications/streetModeling/street_sig08.pdf).

Le port urbain Rust applique des données culturelles versionnées, utilise les accès régionaux et les terres sèches, route les axes puis subdivise les quartiers en îlots et parcelles. Les emprises, tissus de rues et logiques de croissance continuent d'évoluer. Les pentes sont contrôlées le long des segments ; les passages sur l'eau doivent correspondre aux franchissements acceptés. Les recalculs de parcelles conservent les rues et les îlots. [Profils](../rust/crates/core/src/urban/profiles.rs), [macroplan](../rust/crates/core/src/urban/macroplan.rs), [quartiers](../rust/crates/core/src/urban/quarters.rs), [parcelles](../rust/crates/core/src/urban/parcels.rs).

### Géométrie et maisons

Les îlots et lots demandent des opérations géométriques avec trous, intersections et façades explicites. Les invariants utiles sont la couverture de l'îlot, l'absence de recouvrement, l'accès à la rue et la contenance des bâtiments. Une somme d'aires correcte ne suffit pas à garantir une partition correcte.

Le moteur de maisons Rust assemble des recettes de corps bâtis, cours, matériaux, niveaux et toitures, puis contrôle les contraintes géométriques et d'accès. Il peut refuser une configuration plutôt que produire une structure invalide. Son banc est indépendant ; construire une maison ne démontre pas que toutes les parcelles d'une ville sont déjà peuplées de bâtiments. [Moteur de maisons](../rust/crates/houses/src/lib.rs) ; [catalogue architectural](styles_architecturaux_mondiaux_city_mapper.md).

## 7. Rust, WebAssembly, WebGPU et inférence neuronale

| Chemin d'exécution | Où tourne le calcul ? | Ce que cela implique |
| --- | --- | --- |
| TypeScript | JavaScript du navigateur, avec workers | Application statique ; développement et build indépendants de Rust |
| Rust → WASM | CPU du navigateur | Même cœur natif exposé par `wasm-bindgen`, appels par étapes et tableaux numériques |
| Compute WebGPU | GPU du navigateur, shaders WGSL | Accélère certaines passes de terrain et de drainage ; demande un navigateur et un adaptateur compatibles |
| Rust neuronal natif | Service local, GPU via Burn/wgpu | Poids résidents et requêtes HTTP ; source neuronale utilisée par Terrain Bench |
| Rust neuronal WASM | Prototype WebGPU distinct | Crate présente, mais non branchée au banc Magna Urbis ; validation et fiabilité encore insuffisantes |

WebAssembly est un format d'exécution portable ; il n'active pas automatiquement le GPU. WebGPU expose les ressources et commandes GPU ; WGSL décrit les shaders. `wgpu` propose une abstraction utilisable en natif et sur le Web, tandis que Burn organise tenseurs, réseaux et backends de calcul. Les performances dépendent des transferts, des noyaux et des capacités du matériel. [Objectifs WASM](https://webassembly.org/docs/high-level-goals/), [spécification WGSL](https://www.w3.org/TR/WGSL/), [wgpu](https://docs.rs/wgpu/latest/wgpu/), [backends Burn](https://burn.dev/books/burn/building-blocks/backend.html).

Les frontières du dépôt sont explicites : `crates/core` ignore le navigateur et le renderer ; `crates/wasm` expose ses fonctions ; `bridge` transporte et adapte les résultats à l'interface. Les shaders procéduraux ne sont pas des réseaux neuronaux. Le port neuronal est dans `crates/neural`, avec Burn 0.22 déclaré dans son manifeste ; les convolutions utilisent FP16 et des calculs de statistiques restent FP32. [Manifeste](../rust/crates/neural/Cargo.toml) ; [opérations GPU](../rust/crates/neural/src/gpu.rs).

Le service natif conserve les poids sur son GPU et fournit notamment `/status` et `/generate`. La réponse de relief contient des hauteurs FP32 en mètres, avec résolution et étendue définies. Depuis `web/`, `npm run neural:serve` lance ce chemin optionnel. Il nécessite les poids et un GPU compatible ; les poids et modules générés ne sont pas inclus dans Git. [Service](../rust/crates/neural/src/server.rs) ; [commandes](../web/package.json).

La crate [neural-wasm](../rust/crates/neural-wasm/src/lib.rs) documente ses essais et problèmes de noyaux autotunés. Il faut distinguer compilation, première exécution réussie et fonctionnement répété fiable. Les autres projets, dont Neural Earth, peuvent avoir des modèles distillés et des chemins navigateur différents : leur avancement n'est pas celui du banc Magna Urbis.

## 8. Reproductibilité, rendu et limites

Les coordonnées et altitudes locales sont en mètres ; les aires en mètres carrés. Le générateur procédural utilise des sous-graines nommées par étape et par objet, afin de ne pas redistribuer tous les tirages à chaque changement de contrôle. Le port RNG conserve le flux `sfc32` et le hachage UTF-16 de la référence TypeScript. La chaîne neuronale a son propre bruit portable. [RNG partagé](../rust/crates/random/src/lib.rs) ; [bruit neuronal](../rust/crates/neural/src/noise.rs).

La reproductibilité dépend de la version du moteur, des catalogues, des poids, de la configuration et du chemin CPU/GPU. FP16, BF16 et FP32 ne donnent pas nécessairement des sorties identiques bit à bit ; l'autotuning peut changer les noyaux. Un lien doit décrire les réglages appliqués à la carte affichée. Les brouillons, la caméra et les annotations n'ont pas tous le même rôle dans la génération.

Le rendu transforme les données en carte : couleurs de biomes, ombrage, courbes de niveau, textures, végétation et symboles. La résolution des diagnostics et des masques impose une limite géométrique ; un zoom plus fin n'ajoute pas automatiquement de l'information physique. La génération, les adaptations, les transferts, la préparation de scène et l'affichage doivent être mesurés séparément. [Renderer actuel](../web/src/render) ; [interfaces et workers](../web/src/ui).

L'interface actuelle est destinée à être conservée. Le renderer et les contrats des bancs restent transitoires. La priorité d'intégration est de relier des étapes cohérentes tout en gardant leur indépendance ; les cartes produites restent des créations procédurales pour la cartographie et le jeu, avec des simplifications physiques, démographiques et historiques explicites.

## 9. Références

Sources consultées le 14 octobre 2026. Les articles fondent ou situent les méthodes ; les fichiers liés dans les sections décrivent leur adaptation locale.

| Référence | Contribution pertinente |
| --- | --- |
| [Perlin, K. (2002), *Improving Noise*](https://mrl.cs.nyu.edu/~perlin/paper445.pdf) | Bruits cohérents de gradient ; contexte du bruit simplex local |
| [Barnes, R., Lehman, C. et Mulla, D. (2014), *Priority-Flood: An Optimal Depression-Filling and Watershed-Labeling Algorithm for Digital Elevation Models*](https://doi.org/10.1016/j.cageo.2013.04.024) | Dépressions et bassins ; Computers & Geosciences 62, 117–127 |
| [Tarboton, D. (1997), *A New Method for the Determination of Flow Directions and Upslope Areas in Grid Digital Elevation Models*](https://doi.org/10.1029/96WR03137) | D∞ ; Water Resources Research 33(2), 309–319 |
| [Braun, J. et Willett, S. D. (2013), *A Very Efficient O(n), Implicit and Parallel Method to Solve the Stream Power Equation Governing Fluvial Incision and Landscape Evolution*](https://doi.org/10.1016/j.geomorph.2012.10.008) | Incision implicite ; Geomorphology 180–181, 170–179 |
| [Barnes, R., Callaghan, K. L. et Wickert, A. D. (2021), *Computing Water Flow through Complex Landscapes — Part 3: Fill–Spill–Merge*](https://esurf.copernicus.org/articles/9/105/2021/) | Routage dans les hiérarchies de dépressions ; Earth Surface Dynamics 9, 105–121 |
| [Howard, A. D. et Knutson, T. R. (1984), *Sufficient Conditions for River Meandering: A Simulation Approach*](https://doi.org/10.1029/WR020i011p01659) | Référence comparative sur les méandres ; Water Resources Research 20(11), 1659–1667 |
| [Goslin, A. (2025/2026), *InfiniteDiffusion: Bridging Learned Fidelity and Procedural Utility for Open-World Terrain Generation*](https://arxiv.org/abs/2512.08309) | Génération non bornée, paresseuse et cohérente ; [code des auteurs](https://github.com/xandergos/terrain-diffusion) |
| [Karras et al. (2022), *Elucidating the Design Space of Diffusion-Based Generative Models*](https://arxiv.org/abs/2206.00364) | Formulation EDM et échantillonnage |
| [Karras et al. (2024), *Analyzing and Improving the Training Dynamics of Diffusion Models*](https://arxiv.org/abs/2312.02696) | Architecture EDM2 et préservation des magnitudes |
| [Song, Y., Dhariwal, P., Chen, M. et Sutskever, I. (2023), *Consistency Models*](https://proceedings.mlr.press/v202/song23a.html) | Génération en peu d'évaluations et distillation ; ICML, PMLR 202 |
| [Galin, E., Peytavie, A., Maréchal, N. et Guérin, E. (2010), *Procedural Generation of Roads*](https://doi.org/10.1111/j.1467-8659.2009.01612.x) | Chemins anisotropes et contraintes de terrain ; Computer Graphics Forum 29(2), 429–438 |
| [Parish, Y. I. H. et Müller, P. (2001), *Procedural Modeling of Cities*](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf) | Objectifs globaux et contraintes locales ; SIGGRAPH, 301–308 |
| [Chen, G., Esch, G., Wonka, P., Müller, P. et Zhang, E. (2008), *Interactive Procedural Street Modeling*](https://www2.cs.uh.edu/~chengu/Publications/streetModeling/street_sig08.pdf) | Champs de tenseurs et graphes de rues ; ACM Transactions on Graphics 27(3), article 103 |

Documentation logicielle : [WebAssembly](https://webassembly.org/docs/high-level-goals/), [WGSL](https://www.w3.org/TR/WGSL/), [wgpu](https://docs.rs/wgpu/latest/wgpu/), [Burn](https://burn.dev/books/burn/). Projets associés : [Terrain Diffusion](https://github.com/xandergos/terrain-diffusion), [World Orogen](https://github.com/raguilar011095/planet_heightmap_generation), [Neural Earth](https://github.com/dunkean/neural-earth).
