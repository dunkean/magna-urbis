# Audit visuel — ville 01-l de 100 000 habitants

**Le défaut signalé est confirmé sur le moteur récent : des coupes déséquilibrées produisent des lots disproportionnés, puis les silhouettes reprennent les pointes cadastrales et des ailes de cour sans épaisseur habitable.** Les admissions et les moyennes globales ne suffisent pas à valider cette géométrie. Audit en lecture seule des sources urbaines ; aucun fichier Opus modifié.

## Scènes exactes et images

- Principal : `city-01-river-plain-l`, 100 000 habitants, centre `(8000,8000)`, requête conservée `web/out/city-bench/r1/city-01-river-plain-l-quarters-request.json`.
- Secondaire : `city-04-mountain-bay-s`, 5 000 habitants, emplacement signalé `(2640,2669)`, requête `web/out/city-bench/bug2-before/city-04-mountain-bay-s-quarters-request.json`.
- Rejouées sur **:8810**, binaire gelé du 22/10/2026 à **17:01:58**, sans génération détaillée des maisons. Les données natives, paramètres, métriques et captures sont dans [`city-visual-audit/`](city-visual-audit/). Le dessin utilise les fonctions réelles `buildCityScene`, `silhouetteScene`, `drawCity`, conservées dans `city-painter-snapshot.js`, sur fond uni pour lire les contours. Ce sont des captures du peintre City Bench sur les vraies données ; la couche terrain et les panneaux UI sont absents.
- :8791 annonce encore seulement 10 capacités, sans plans compacts ni index de styles ; :8810 en annonce 12. **Les problèmes ci-dessous persistent sur :8810.** Les modifications A2/C2 en cours ne sont pas déclarées validées par cet audit.

Images principales : [cœur, bâtiments](city-visual-audit/01-l/core-buildings.png), [mêmes parcelles](city-visual-audit/01-l/core-parcels.png), [lots disproportionnés](city-visual-audit/01-l/detail-unequal-parcels.png), [ailes trop minces](city-visual-audit/01-l/detail-thin-court.png). Cœur : 800 × 500 m, 0,5 m/px ; détails : 0,15 et 0,12 m/px. La [vue générale](city-visual-audit/01-l/overview-buildings.png) confirme aussi les réserves périphériques aux découpes en escalier.

## Mesures qui expliquent le défaut

01-l contient **2 042 îlots, 12 738 parcelles, 11 000 lots constructibles, 1 324 résiduels et 8 122 silhouettes bâties**. Les résiduels occupent 11,88 ha ; les jardins explicites 1,17 ha. Une parcelle habitée peut aussi contenir un jardin non classé comme parcelle séparée.

| Distance au centre | Lots constructibles | Aire médiane / P90, m² | Façade médiane, m | Profondeur médiane / P99, m | Couverture bâtie médiane |
|---|---:|---:|---:|---:|---:|
| 0–250 m | 221 | 243 / 598 | 8,16 | 29,8 / 74,9 | 86 % |
| 250–500 m | 761 | 244 / 541 | 8,03 | 27,8 / 64,6 | 83,5 % |
| 500–1 000 m | 2 885 | 278 / 587 | 8,86 | 31,1 / 68,2 | 74,1 % |
| 1–2 km | 6 743 | 371 / 713 | 11,00 | 35,1 / 74,9 | 35,4 % |
| 2–4 km | 390 | 495 / 882 | 13,23 | 39,0 / 74,1 | 20 % |

Les médianes présentent un gradient, et masquent des écarts locaux excessifs. Dans le cœur, **157 paires voisines** ont un rapport d’aires ≥3 malgré des façades dont le rapport reste ≤1,5 (frontière commune ≥1 m, tolérance 1 cm). Exemple reproductible : îlot `block-542abfb6c38433a7`, lots `parcel-ce234664c9f06f48` et `parcel-93465b1bbf73a6fc`, vers **(7290,72 ; 7857,33)** : **1 305,6 contre 135,5 m²**, soit **9,64×**, pour **4,88 et 7,18 m de façade**. Tous deux sont marqués `admissible-envelope` ; la petite maison témoin a suffi à accepter une très mauvaise distribution foncière.

À l’échelle entière, 430 lots dépassent 60 m de profondeur, 11 dépassent 100 m ; maximum **243 m et 16 006 m²**, avec seulement 13,95 m de façade, raison `admissibility-repaired`. Les rapports longueur/largeur du rectangle orienté vont jusqu’à 12,41 (58 lots >8).

Pour les **3 005 bâtiments de zone core**, 837 couvrent plus de 95 % du lot. Sur leurs 5 489 pièces de silhouette, **1 832 seulement** ont tous leurs angles non colinéaires à 90° ±5° ; **428 pièces géométriquement valides** ont un angle <20° entre des arêtes d’au moins 1 m. Dans toute la ville, 113 pièces ont un petit côté de rectangle orienté <2,5 m et une longueur >6 m.

Sur **300 cours d’au moins 9 m²**, après exclusion des réserves préexistantes, **132 ont une aile minimale <1 m**, 243 <2,5 m. Exemple `parcel-ba8e5a7e8a355e53/building`, **(8803,64 ; 8132,23)** : cour 65,85 m², épaisseur minimale **0,000000223 m**. Le polygone est valide au sens topologique, mais l’aile est physiquement réduite à un trait. Cela confirme précisément le retour utilisateur.

Enfin, 166 demandes contiennent une géométrie de preview invalide ou dégénérée : notamment 153 auto-intersections de pièces, 3 auto-intersections d’anneaux et 14 trous de moins de trois sommets (catégories pouvant se chevaucher). Aucun dépassement cadastral >0,01 m² n’est détecté. Le confinement seul ne garantit donc pas une maison cohérente.

## Corrections localisées à confier à Opus A2

1. **Position de coupe calculée par l’aire.** Dans `parcels.rs::strips`, `at += w * extent / total` partage la projection de la largeur. Dans `courtyards`, `at = lo + (hi-lo) * fraction_try` partage la boîte projetée ; la différence d’aires n’est qu’une petite pénalité et la première orientation viable arrête la recherche. Conserver l’orientation culturelle, puis trouver l’offset donnant l’aire cible pondérée par rôle/largeur de façade, par recherche monotone bornée. Évaluer les deux orientations admissibles avant de choisir. Conserver les contraintes d’accès, de largeur et de profondeur. Appliquer ces bornes après les fusions/réparations aussi, puisque les plus grands contre-exemples portent `admissibility-repaired`.
2. **Construire des ailes entières.** Dans `occupation.rs`, `row` découpe directement `b` par des demi-plans ; `Court` garde `b` comme contour extérieur et perce un rectangle. Le bâtiment hérite donc des obliques, pointes et retraits de la parcelle. Composer des rectangles/ailes dans le repère local autorisé par le style, puis ajuster leur dimension/position avant admission. Les restes deviennent cour, passage ou jardin. Pour une cour, exiger que le trou soit contenu dans un **retrait de l’emprise par l’épaisseur minimale de l’aile**, pas seulement `rect_within(outer_shape, court)`. Un trou plus petit ne doit pas créer une aile qui s’amincit jusqu’à zéro ailleurs.
3. **Mesurer une épaisseur locale.** Le nouveau `finish` visible dans la source rejette `2*A/perimeter < 0.6`. Cette moyenne globale ne détecte pas une aile mince attachée à un corps large ; pour un long rectangle elle approche sa largeur et permet encore environ 0,6 m. Utiliser le minimum structurel de chaque corps/wing, et des composantes polygonales valides après les opérations. `clip` renvoie un anneau unique : une intersection de sujet concave avec une fenêtre convexe peut avoir plusieurs composantes, qu’il faut conserver séparément. La couverture ne doit pas forcer une annexe aiguille pour atteindre un pourcentage.

Les fonctions et expressions ci-dessus ont été relues dans la source pendant A2 ; des gardes de profondeur sont déjà en cours d’ajout. Les résultats de cet audit appartiennent au binaire gelé, et servent de cas de contrôle pour leur prochain build. Les trois cas complets, avec blocs, parcelles et demandes, sont dans [`focused-cases.json`](city-visual-audit/01-l/focused-cases.json).

## Scène montagneuse et délai

La scène 04 récente conserve **172 résiduels sur 249 parcelles (69,1 %)**, représentant 14,48 ha, contre 51 lots constructibles et seulement 35 silhouettes. Profondeur constructible maximale 177,6 m ; aire maximale 11 397 m². La [capture rapprochée](city-visual-audit/04-mountain/core-buildings.png) montre quelques grands volumes isolés au milieu de secteurs vides. Elle reste un contre-exemple pour A2/C2, même si le vieux résultat de 655/927 résiduels a changé.

Le replay natif 01-l **quartiers + parcelles + buildingSites** a pris **21,6 s** sur ce binaire dev optimisé, sous charge partagée ; il a produit 36,4 MB de partition JSON et 61,0 MB de demandes. Le peintre affiche les 572 silhouettes visibles au cœur en quelques millisecondes. Le délai utilisateur de 15 minutes n’est pas reproduit par ce parcours silhouette sans maisons détaillées ; il faut le tracer dans le pipeline complet et publier les premières étapes avant la fin des calculs. À 3,46 m/px, le LOD moyen dessine volontairement les îlots sans maisons individuelles. Ces durées ne certifient ni le parcours détaillé ni son délai de premier affichage.

**Contrôle visuel minimal après correction :** rejouer ces deux demandes gelées ; regarder les deux détails nommés et le cœur complet ; vérifier les ailes locales, l’accès et la distribution des aires. Le taux d’admission ne remplace pas ce contrôle. Aucun test global ni modification urbaine n’a été ajouté par cet audit.
