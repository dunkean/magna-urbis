# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Revue finale indépendante : V8 sur `984f488`, F1/F2/F3, couches surface-1.5.2 et villes 419/500

## Verdict

- **Prototype technique : qualifié.** Il est adapté à la poursuite de l'évaluation du mapper.
- **Production et acceptation artistique : refusées.** Le statut reste CHANGES REQUIRED.
- **Échecs antérieurs :** V8 n'efface rien. V1, V2, V3, V4, V6 et V7 restent FAILED. V5 ne qualifie pas le code 1.5.

J'ai ouvert les 7 PNG du tour, les 4 PNG de visibilité, le PNG unlit, les 3 PNG native419 et les 4 PNG historiques city500. J'ai aussi ouvert `canopy-r4/top-2560m-comparison.png`.

**Ce que je n'ai pas pu vérifier :**
- Cette session n'a pas de shell. Je n'ai donc pas pu lancer `git diff 984f488..HEAD` pour confirmer que les commits postérieurs ne touchent que la documentation.
- L'égalité du snapshot repose sur les hashes enregistrés dans `report.json` : `selectedRepository` et `finalRepository` ont tous deux le HEAD `984f488`, un statut `""` et 542 fichiers (lignes 8536–9089).
- **Correction factuelle :** le prompt cite 529 fichiers runtime. Ce chiffre est celui de V6 et V7. V8 en compte **542** (`native-e2e-v8.json:18`).

## Intégrité de la campagne V8 (vérifiée)

**Statut et source**
- Le statut est `complete`. La source est fraîche : modèles coarse4/original/original, token neural `3aabd4c1…`, hash SHA `3c7c2f32…`.
- La grille brute fait 1024² au pas de 39,0625 m ; l'export fait 512² au pas de 78,125 m.

**Navigation**
- Mouvement de 20,016 s. Trois mondes preview128 frais ont été affichés, aux pas natifs 15, 0,9375 et 0,46875 m.
- Le monde final `preview:false/512` a été livré en 140² au pas de 0,4657 m. Cette taille est plafonnée par le pas physique de la source.

**Vue 10 m**
- La capture `06_10m` réutilise le monde `8375c84a…` de la requête 5 (`viewSatisfiedSerial` 6). C'est une satisfaction de caméra légitime, pas une acceptation fraîche.

**Quatre quantités à ne pas confondre (capture 10 m)**
- **Écran :** 4,8828125 mm par pixel.
- **Grille livrée :** pas de 0,4673 m.
- **Pas natif de la source :** 0,46875 m.
- **Maillage :** grille `geometryDetail` de 214² au pas de 0,467 m.

**Coûts conservés**
- Warmup de 50,5 s.
- Trou d'application de source de **9,578 s** pendant le mouvement.
- Temps de frame : p99 de 60 ms, maximum de 529 ms.

**Contenu urbain**
- La campagne fraîche contient **0 bâtiment et 0 route** : `nativeBuildings: 0` et `roadProjectors: 0` dans `native-tour/metrics.json:3389,3446`, aucun projecteur de route non nul dans `report.json`.
- Elle ne qualifie donc ni une ville peuplée ni le support des routes.

## F1 — page rectangulaire de forêt : **toujours cassé visuellement**, partiellement corrigé techniquement

**Ce qui est corrigé**
- Le défaut de normales MultiMesh (inverse-transposée) est corrigé (`canopy-r4/README.md:5`).
- Le filtre optique est partagé entre les représentations.
- La couverture agrégée est juste : l'erreur combinée C/V est au plus de 0,095 point (`page-gpu.json:6`).

**Ce que montrent les pixels (coordonnées en pixels originaux 2048×1280)**
- **`02_2560m_top.png` :** un carré d'environ 370 px (≈ 460 m, soit la page de 480 m) occupe x≈835–1205, y≈440–815.
  - À l'intérieur, les couronnes sont plus grosses et groupées.
  - Autour, un **halo plus clair** laisse voir le sol.
  - C'est exactement le défaut F1. Il est encore visible dans le panneau « r4 » de `canopy-r4/top-2560m-comparison.png`.
- **`01_10000m_top.png` :** même empreinte, visible comme une couture de texture vers x≈980–1020, y≈590–675. Elle disparaît dans `no-trees.png`, donc elle appartient bien à la représentation des arbres.
- **`03_640m_top.png` :** deux **bandes verticales de couronnes fantômes translucides** vers x≈305–355 et x≈1685–1735. Elles coïncident avec les bords de la page de 480 m (1536 px).
  - Les couronnes changent de taille et de densité de part et d'autre : sites approximés à 16 m dehors, inventaire exact dedans.

**Pourquoi la preuve ne couvre pas ce défaut**
- La preuve `page-gpu` est une moyenne sur toile plate de toute la page (« flat canvas optical-area proof »). Elle ne mesure ni la bande de transition `paintBlendM` 48 m / `geometryBlendM` 64 m, ni une couture spatiale.
- La cause précise du halo n'est pas mesurée. L'hypothèse la plus probable est la bande de transition dans `canopy.gdshaderinc:49-72`.

**Représentation des arbres (vues 160 m, 40 m, 10 m)**
- Les couronnes sont des sphères lisses identiques. À 10 m, la silhouette facettée est visible, et des sphères s'interpénètrent.
- L'ombre proxy est cohérente avec les couronnes. J'ai vérifié le décalage constant d'environ (4,7 ; −8,5) m sur plusieurs paires dans `04_160m`.
- Mais ce sont des **disques plats aux bords en escalier**, au pas des texels de l'atlas (≈ 0,15 m, très visible dans `05_40m` et `06_10m`). L'ombre a un décalage fixe quelle que soit la hauteur des arbres et ne tombe jamais sur d'autres couronnes.
- Les petits cubes de couvert bas projettent des ombres moteur bleu marine, incohérentes avec le gris des ombres proxy.
- Tout cela correspond à l'approximation déclarée. Ce n'est pas une ombre forestière physique.

## F2 — rivières régionales : **corrigé pour l'omission**, partiellement corrigé visuellement

**Ce qui est corrigé**
- Aucune surface manquante et aucun triangle de niveau manquant sur les 7 échelles.
- `budgetLimited:false`, aucun fallback, `minimumRiverStrokeApplied:false`, projection `source-map-terrain-projection`.
- La politique `subpixelPolicy` est déclarée, y compris dans la branche vide (`surface_water_projection.gd:52`).

**Retry de bord à 40 km (code relu, `surface_hydrology.gd:100-109, 213-219`)**
- 51 requêtes ont été résolues, avec un écart maximal de 0,000122 m.
- Le retry ne s'applique que **hors du support**, dans une tolérance d'un demi-ULP FP32 plus l'arrondi d'origine. Le point est déjà renvoyé à NaN quand il est intérieur.
- Il ne déplace aucun vertex et n'élargit pas la recherche des cellules mouillées. Il ne peut pas inventer un niveau intérieur.

**Ce que montrent les pixels**
- **À 40 km :** les affluents apparaissent en **pointillés bleus intermittents, avec des tirets gris-blanc en escalier**.
  - La texture de projection est à 24,4 m par texel, contre 19,5 m par pixel à l'écran, et les rivières sont plus fines qu'un pixel.
  - C'est honnête (aucun trait élargi en cachette), mais la lisibilité régionale de la carte reste mauvaise.
  - Une bande de fond non couverte d'environ 35 px est aussi visible au bord droit.
- **À 10 km :** le réseau est continu, mais avec des escaliers hérités du tracé source, des segments rectilignes alignés sur les axes (vers y≈530 et y≈1090) et des taches claires aux confluences.
- **À 2560 m :** un trait continu qui s'arrête vers x≈425, y≈730. C'est cohérent avec une tête d'affluent dans la vue 10 km ; le sens d'écoulement n'est pas vérifié.

**Conflits lit/eau (divulgués et autorisés)**
- 40 km : 2931 sur 4087 échantillons, delta maximal de 58,2 m.
- 2560 m : **3882 sur 3961**.
- Toute présentation d'eau physique en vue aérienne serait donc invisible presque partout. Seule la projection cartographique est défendable.

## F3 — escaliers de couleur à 78 m : **tracé, non éliminé** (partiellement corrigé)

- Les diagnostics à une seule variable existent (`surface_body.gdshaderinc:173-189`).
- `ground-mean-unlit.png` (diagnostic 7, moyenne de sol brute, bilinéaire) montre des taches brun foncé aux bords en escalier, au pas d'environ 16 px × 4,88 m ≈ **78 m**. Exemples : x≈970–1165, y≈575–840, et le grand massif en bas à gauche.
- Le même motif apparaît dans `ground.png`. Il est atténué dans `no-trees.png` et masqué par le pointillé optique de la canopée dans `all.png`.
- L'escalier vient donc du **champ sol canonique à 78,125 m** (`surface_average`, `filter_linear_mipmap`). Il ne vient ni du couvert bas, ni des arbres, ni du zoom.
- Ce que je n'ai pas mesuré : s'il s'agit d'un contact catégoriel réel ou de seuils étroits d'humus (0,72–0,88) appliqués par cellule.
- L'invariance des champs canoniques entre niveaux de zoom n'a pas été testée en pixels : la sonde de couches n'opère qu'à 10 km.

## Contrat à trois couches : **corrigé pour le périmètre technique**, avec réserves

**Vérifié dans le code**
- Neuf tableaux typés, soit 4×u16 + 3×f32 + 2×u32 = 28 octets par échantillon (`surfaceLayers.ts:9`, intégré à l'estimation mémoire `compiler.ts:72`).
- Validation des types, des rôles, des bornes [0,1], de `fieldsVersion` et de la version canonique (`surface_layers.gd:57-115`).
- Le legacy annonce `legacy-composite-unavailable` sans tentative de désmélange (`:94-99`).
- Le RGB est prémultiplié **avant** `generate_mipmaps` (`:151-153`).
- Le shader pondère par `surface_weights*alpha` puis normalise (`surface_body.gdshaderinc:101-124`).
- Les tests .2/.8 et magenta transparent sont présents (`surface.layers.test.ts:18-37`).

**Vérifié en pixels**
- Le masquage des arbres coupe la canopée résiduelle **et** l'ombre proxy (`surface_body:136-140`) ; les instances d'arbres et de troncs sont masquées via `surfaceLayer` (`main.gd:607,634,1188`).
- `no-trees.png` ne garde aucun pointillé vert.
- Le sol n'est pas un brun uniforme (`ground.png`).
- Les hashes de terrain, sol, échantillon, inventaire, contexte et `geometryDetail` sont identiques, et les quatre digests centraux sont distincts (`layer-report.json`).

**Réserves**
- L'isolation n'est prouvée en pixels qu'à 10 km, une échelle **sans géométrie d'instances**. Le masquage des maillages d'arbres et de couvert bas en vue rapprochée n'est vérifié que dans le code.
- `lowCoverOpacity` et `treeOpticalCoverage` dans le rapport valent « potentiel × drapeau » : ce ne sont pas des aires mesurées sur GPU.
- Le couvert bas apparaît beige-jaune, pas herbacé, et le sol rapproché paraît nu. C'est un choix de recette à revoir, pas une violation du contrat.

## Villes

**native419 (`web/out/surface/native-current-419-final/`)**
- **Perspective oblique :** de vraies toitures orange à deux pans et des ombres de bâtiments. C'est une nette progression par rapport au paquet historique 500.
- **Défaut artistique majeur :** le sol bâti est un aplat blanc grisâtre aux bords flous (grille de 15,6 m), qui se lit comme de la neige. Aucune rue intérieure n'est visible (accès hors périmètre).
- **Plan rapproché vu de dessus :** contours fermés et lisibles, arbres en points ; zones sombres floues et en escalier.
- **Vue d'ensemble :** les bâtiments ne sont que des points blancs à environ 6,5 m par pixel, et le plafond de 256 projecteurs de routes est atteint.
- **Limites déclarées :** 81 refus de planification, terrain parent à 15,625 m de LOD d'origine inconnue, comptes soumis ≠ comptes visibles sur GPU, conflits lit/eau de 84 sur 117 dans le plan rapproché.

**Historique 500 (`city500-v152-final/`)**
- La perspective rapprochée montre surtout des **boîtes crème sans toit**, avec quelques toits bruns.
- Le plan rapproché contient des contours ouverts, par exemple vers x≈295, y≈215 et x≈50, y≈425.
- C'est une preuve négative ou historique ; elle ne doit pas être présentée comme des toitures natives.

## Défauts confirmés

**Bloquant pour le prototype :** aucun.

**Majeurs (bloquants pour la production ou l'acceptation artistique)**
1. **F1 :** page de forêt visible à 10 km, 2560 m et 640 m (carré, halo, bandes fantômes).
2. **Représentation des arbres :** sphères identiques, disques d'ombre plats en escalier, ombres incohérentes avec celles du couvert bas.
3. **Rivières à 40 km :** pointillées et illisibles. Il manque une symbologie cartographique **déclarée**, pas un trait minimal caché.
4. **Sol urbain** blanc, neigeux, dans la vue native419.

**Modérés**
- Escaliers de 78 m du sol (F3).
- Taches claires aux confluences.
- Bande de fond au bord droit de la vue 40 km.
- Toutes les captures du tour sont en mode `aerial` (`cartographic:false`, `native-tour/metrics.json:2879-2882`) : aucun style plan ou blueprint n'a été capturé sur la source fraîche.

## Risques non mesurés

- Couture spatiale de la page canopée (le probe ne mesure que la moyenne).
- Masquage des géométries en vue rapprochée, en pixels.
- Invariance au zoom des champs canoniques.
- Énergie et pénombre des ombres proxy.
- Trous d'application de plusieurs secondes et coûts p99/max.
- Taux de conflits lit/eau de 72 à 98 %.
- Contenu des commits après `984f488` (diff non exécuté).

## Backlog (n'empêche pas d'accepter le prototype)

- Couronnes non sphériques et assets.
- Symbologie hydrographique régionale.
- Parité des styles de carte.
- Ville fraîche à détail fin.
- Rendu complet des routes.
- Intérieurs et accès.
- Streaming continu à 60 FPS.
- Choix final du moteur.

## Jugement de livraison

**Prototype techniquement qualifié : OUI**, pour continuer à évaluer le mapper sur Godot comme candidat. La chaîne source → couches → rendu → navigation est intègre et traçable, sans omission d'eau, sans mutation des données physiques et sans faux bâtiments.

**Production ou acceptation artistique : NON.**
- F1 reste visiblement cassé.
- F2 n'est corrigé que pour l'omission ; la lisibilité régionale à 40 km reste mauvaise.
- F3 est tracé mais pas éliminé.
- Le contrat de couches est respecté techniquement, avec une isolation prouvée à une seule échelle.

Ce résultat n'établit ni un détail millimétrique, ni des mises à jour à 60 FPS, ni la parité des styles, ni une ville fine fraîche, ni un choix final de moteur.
