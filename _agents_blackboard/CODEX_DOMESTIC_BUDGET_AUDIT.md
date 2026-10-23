# Budget domestique — lecture des 12 sites bastide figés

22 octobre 2026. **Lecture seule**, après libération de `plans.rs`. Aucun nouveau batch natif, aucune ville ou benchmark. Données : `web/out/frontage-bastide-proof/requests.json`, `after-adapted/plans.json`, tableau extrait `domestic-budget-audit.json`.

## Constat : le budget peut être fortement sous- ou sur-réalisé

La cible est l'**emprise du corps**, pas la surface utile cumulée des étages.

| Site | Cible m² | Corps m² | Réalisation | Explication immédiate |
|---|---:|---:|---:|---|
| 01 | 129,4 | 14,02 | 10,8 % | Retour exact au minimum physique, 2,928 × 4,788 m |
| 06 | 71,2 | 14,56 | 20,4 % | Repli dans le petit témoin d'admission |
| 07 | 76,5 | 54,54 | 71,3 % | Premier candidat aléatoirement réduit qui tient |
| 08 | 116,0 | 14,03 | 12,1 % | Petit témoin d'admission, minima |
| 09 | 39,2 | 12,31 | 31,4 % | Retour exact au minimum physique, 2,700 × 4,560 m |
| 11 | 97,5 | 14,17 | 14,5 % | Repli dans le petit témoin d'admission |
| 05 | 60,6 | 305,55 | 504,2 % | Occupation du grand lot, sans plafond au budget |
| 10 | 82,6 | 158,96 | 192,4 % | Même divergence occupation/budget |
| 12 | 92,7 | 180,12 | 194,3 % | Même divergence occupation/budget |

## Causes localisées

1. **Le budget domestique n'entre pas dans la synthèse.** `plans::plan_one` calcule `a = area(domain) × occupation.coverage`, puis largeur/profondeur avec l'aspect `frontage_m/depth_m`. `programme.built_area_m2` ne sert qu'au diagnostic domestique de `visual`; seul l'opérateur de hall C1 l'utilise comme cible physique. Les deux consignes peuvent diverger fortement : sur 05, occupation vise environ 519 m² d'enveloppe sur un lot de 844 m², alors que la cible du corps est 60,6 m².

2. **Le tirage initial de petite taille n'explique pas 01/07.** `engine::resolve_architecture_for_site` remplace les dimensions tirées par celles d'occupation, bornées au site et aux limites de source (jusqu'à ×2 en inspired avec parcel_fit). Paramètres retenus : 01 = 8,310 × 14,870 m ; 07 = 12 × 18,754 m. Les matériaux, nombre de pièces, niveaux, épaisseur des murs et rapports restent issus du tirage : ils influencent les minima, mais l'effondrement de taille survient après.

3. **`morphology::synthesize` est un chercheur d'admissibilité, sans objectif d'aire.** `desired` reprend les dimensions déjà résolues. Quatre candidats à taille complète occupent les coins ; les 60 suivants réduisent largeur et profondeur indépendamment dans [55 %,100 %] et tirent des positions. Les 16 derniers ne cherchent que les minima. La fonction retourne le **premier** candidat complet contenu, sans comparer son budget ni un meilleur rectangle possible. Pour 01, minimum du corps = 2,928 × 4,788 m, enveloppe avec passage/cour = 4,178 × 6,588 m. La largeur minimale des 64 essais ordinaires serait 4,422 m : le résultat prouve donc le passage aux 16 minima. Même preuve sur 09 : 3,950 m retenus contre ≥6,600 m dans les essais ordinaires. 07 n'est pas au minimum : enveloppe retenue 7,644 × 11,557 m, environ 64 %/62 % de la demande dimensionnelle, puis cour retranchée.

4. **Le témoin d'admission peut devenir un plafond de fait.** Après échec du domaine complet, `plan_one` synthétise dans `intersection(inset, placement_hint)` et accepte immédiatement. Sur 06/08/11, le `plan.lot` conservé mesure environ 5,60 × 8,1 m, conforme à ce petit témoin de ~47,54 m² malgré des lots de 583–671 m². Le témoin prouve une possibilité de construction ; il ne prouve pas que cette emprise est la meilleure ni que la cible est impossible ailleurs.

5. **Les droits restent réels, mais leur rôle ne doit pas être confondu avec un optimum prouvé.** Tous les acceptés de ce petit corpus ont zéro réserve et un domaine de toiture identique au cadastre. Les lots étroits/obliques, la cour et le passage de 1,25 m limitent réellement l'emprise. Le minimum de la source en largeur/profondeur n'est pas le même que `layouts::minimum_domain` (murs/pièces/escalier) : le repli inspired peut descendre sous les dimensions usuelles du catalogue, tout en gardant ces minima physiques. `historical_strict` exclut cette adaptation. On ne peut pas déduire des refus de 80 positions que 129,4 m² sont réalisables, ni qu'ils sont impossibles sur 01.

## Opérateur proposé, borné et explicitement domestique

Ajouter un **budget d'emprise domestique** optionnel, consommé avant le retour d'un plan admissible, d'abord pour les capacités déclarées `Strip/FP-RECT|FP-LONG` et `Single/FP-RECT`. Aucune déduction par nom de culture. L'absence de budget, les modèles exacts, recette/variante/workshop imposés et `historical_strict` gardent leur chemin actuel ; les contrôles explicites restent prioritaires. Les familles à cour fermée, composants hétérogènes ou programme structurel spécial nécessitent leur propre adaptateur déclaré.

Le budget porte sur les corps hors cour/passage/débords. Il remplace l'aire issue de `coverage` comme **cible**, tandis que coverage reste une borne/contexte d'occupation à préciser. On conserve recette, variante, niveaux, matériaux, nombre de composants et topologie ; aucun ajout d'étage pour maquiller un déficit. Les plages de dimensions et portées viennent du descripteur source/adaptateur ; une capacité d'extension inspired doit être déclarée, pas introduite par une multiplication universelle.

Pour une maison en bande, explorer d'abord des **largeurs légales au front réel**, puis calculer la profondeur qui réalise la cible en réservant le passage et la cour de la variante. Ne pas imposer l'aspect suburbain 11/10 à tous les lots profonds. Produire les rectangles/ranges complets aux dimensions choisies, puis reconstruire leur charpente native ; pas de découpage de silhouette ou mise à l'échelle d'un maillage. Fixer les décisions de topologie/cour par le seed, séparément des essais de dimensions, pour qu'une recherche d'aire ne change pas silencieusement de programme.

Budget proposé pour une première implémentation : **≤24 candidats dimensionnels au total par maison** (au plus quatre recettes déjà éligibles, six couples de dimensions chacune), quelques positions géométriques déterministes sur les vrais fronts, puis le meilleur repli déjà validé. Arrêt anticipé si aire dans une tolérance explicite, par exemple ±10 %, et front satisfait. Ce budget remplace une partie de la recherche d'admission pour les demandes concernées ; ne pas imbriquer 24 nouveaux candidats dans chacun des 80 essais existants. Aucun maillage pendant la sélection. Toute promesse de coût moyen devra être mesurée ensuite, pas déduite de ce plafond.

Après les mêmes contrôles d'emprise/cour/accès/voisins/toit/terrain, classer par erreur relative à la cible (déficit **et** excès), préférence de front et moindre déformation des proportions de source. Les minima servent de dernier repli habitable, pas de succès équivalent à la cible. Conserver le résultat valide antérieur si le budget ne s'améliore pas. Publier `target/achieved/ratio`, dimensions/contraintes qui bornent, nombre d'essais et `target_met`; distinguer « recherche bornée épuisée » d'une impossibilité démontrée. La proximité récemment corrigée reste une préférence de pose indépendante, sans promesse de mitoyenneté.

Aucune implémentation proposée dans cette passe. Les cas 01/07/05 constituent déjà un petit contrôle pertinent : sous-occupation minimale, réduction moyenne et sur-occupation ; leurs entrées figées suffisent avant toute extension aux autres cultures.
