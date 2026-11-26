# Ressources : raffinement de tuile et consommation par les cités

Date : 26 octobre 2026. Note courte, compagne de `docs/RESOURCE_LAYERS.md` du dépôt Neural Earth (branche `resources-layers`). Statut : **proposé** ; aucun code de ce dépôt n'est modifié.

## 1. Place de ce dépôt dans la chaîne

Neural Earth est le seul système multi-échelle, de la planète au centimètre. L'autorité des ressources est calculée au LOD 10 (30,72 km) à partir d'Orogen. Les positions de gisements et les budgets de surface sont répartis au LOD 3 (240 m). La tuile de 40 km à 30 m (LOD 0) ne fait que répartir ce que le LOD 3 a engagé.

`godot-render/tools/surface_context.py`, `ground_surface.py` et le choix des textures constituent ce traitement de LOD 0, hébergé ici provisoirement et destiné à migrer dans Neural Earth. Magna Urbis reste le module des cités : il **consomme** les ressources locales et ne les recalcule pas.

## 2. Constat sur `geology()`

`geology(n, width, seed, scenario)` produit cinq fractions continues : granite, calcaire, grès, argilo-marneux, basalte. Elles ont des strates plissées, des intrusions et des coulées, à des échelles de 70 m à 8 km. Mais la fonction a trois défauts pour la chaîne :

1. **Proportions fixes.** Les bandes de phase (0,20 / 0,56 / 0,86) et les seuils d'intrusion sont les mêmes partout. Une tuile de craton et une tuile d'arc ont la même géologie.
2. **Hasard local à la tuile.** `default_rng(sha256(seed))` remplit des réseaux de bruit dimensionnés sur la tuile. Ce bruit n'est pas évaluable en un point du monde, et deux tuiles voisines ne se raccordent pas.
3. **Aucun lien au monde.** La seed de la tuile n'est pas une coordonnée.

## 3. Migration en raffinement du parent

1. **Géoréférencer la tuile sur la grille LOD 0** :
   - origine `(i0, j0)` en cellules de 30 m exactement, au lieu de 29,985 m aujourd'hui ;
   - largeur étendue de 1 334 à 1 336 cellules, soit 167 blocs complets de 240 m ;
   - la tuile ne raffine que des blocs complets ; les cellules hors de l'emprise d'affichage servent de halo.
2. **Remplacer le bruit par du bruit adressé** :
   - `value_noise(seed, "geology-<échelle>", LOD, x, y)` de Neural Earth (`terrain_resources.value_noise`), qui utilise la clé de Chronos ;
   - mêmes échelles physiques (8 000 m → LOD 8, …, 70 m → LOD 1) ;
   - la valeur en un point ne dépend plus de la tuile : plus de raccords et plus d'état aléatoire.
3. **Conditionner les proportions par le parent** :
   - Neural Earth fournit, pour chaque bloc de 240 m, les fractions des 8 classes de roche, interpolées depuis le LOD 10.
   - `geology()` garde sa structure (plis, contacts, intrusions, coulées). Elle calcule des facteurs `α_k` par bloc, de sorte que la moyenne des fractions fines du bloc égale la cible : `w'_k = w_k·α_k / Σ_j w_j·α_j`, en 3 à 5 itérations d'ajustement proportionnel.
   - Les `α` sont interpolés entre les centres de blocs pour éviter des marches visibles. L'écart résiduel de moyenne par bloc est à mesurer ; cible proposée : moins de 0,02. Il est accepté, car une fraction de roche est une intensité, pas un budget conservé.
   - Les quantités extensives restent exactes (§4).
4. **Classes** : passer de 5 à 8 classes (métamorphique, ultrabasique, évaporites), ou, à défaut, projeter les 8 classes sur 5 :
   - métamorphique → granite 0,5 / argilo-marneux 0,3 / grès 0,2 ;
   - ultrabasique → basalte ;
   - évaporites → argilo-marneux, avec un drapeau O1 qui conserve l'information pour les textures.
5. **Les gisements imposent leur roche hôte.** Dans l'emprise d'un gisement, la fraction de la roche hôte est relevée à un minimum : coupole de granite pour Sn-W, calcaire pour Pb-Zn type Mississippi, basalte pour les sulfures massifs. Le fait parent prime sur le bruit fin, jamais l'inverse.

## 4. Budgets et objets au LOD 0

- **Répartition exacte** de chaque budget de bloc de 240 m entre ses 64 cellules par `apportion` (entiers, égalités par identifiant). Les poids viennent des champs de tuile :

| Budget | Poids |
|---|---|
| Surface arable | `exp(−pente/10°) × soilDepth × (1 − stoniness) × drainage acceptable` |
| Bois | `forestPotential` |
| Argile | `clay × faible pente × (alluvial + argilo-marneux)` |
| Pierre | `exposedRock × hardness × accès` |
| Tourbe | `drainage = 1 × organic × faible HAND` |

- **Position fine d'un gisement** : choix pondéré par course exponentielle adressée parmi les 64 cellules de son bloc du LOD 3. Le poids est la roche hôte × une faible couverture (`depositDepth` petit). L'emprise est une ellipse orientée par `structureAzimuth`, de taille liée au tonnage.
- **Affleurement visible** : seulement si le toit est à moins de 5 m et si le dépôt meuble local ne le masque pas. Un chapeau de fer suit le drapeau `gossan` du gisement.
- **Placers** : transport de la masse érodée des emprises le long du graphe receveur de la tuile, sur le modèle de `route_context`. Ce sont les placers « fins ». Leur total reste celui des placers du LOD 10 qui sont positionnés dans la tuile.

## 5. Réinjection dans `ground_surface.py`

Les points d'insertion sont dans `scores_for_chunk`, sans nouveau tirage de palette (`ground_textures.gd` tire une fois par type) :

- **Groupe B** : B11 « Terre chaude ocre ou rougeâtre » reçoit `oxyde × chaleur` dans les emprises à chapeau de fer. B02 et H02 reçoivent `tourbe`.
- **Groupe R** : les poids des parents R01–R20 viennent des fractions conditionnées.
- **Nouveaux types de catalogue** à prévoir : croûte saline (M15), gypse (M16), tourbe exposée (M10). Ils sont absents des 90 types actuels et ne doivent s'activer que si le sel, le gypse ou la tourbe sont déclarés.

La doctrine est celle de `GROUND_MATERIAL_MAPPING.md` §5.3 et du tableau §12 de l'étude Neural Earth.

## 6. Ce que consomment les cités et établissements

| Besoin | Lu depuis Neural Earth | Granularité | Remarque |
|---|---|---|---|
| Pierre de taille, chaux, ardoise | potentiels du LOD 10, roche exposée et dureté du LOD 0, budgets « pierre » par bloc | blocs de 240 m, puis 30 m | carrière candidate = roche dure exposée à portée de transport |
| Argile (brique, poterie, torchis) | potentiel argile, budget par bloc | 240 m → 30 m | glaisières en fond de vallée |
| Bois d'œuvre et de feu | stock, accroissement, part bois d'œuvre, part résineuse, mois d'abattage et de débardage | région → bloc | coupe et défrichement = deltas Chronos |
| Eau | hydrologie de Neural Earth (débits mensuels, navigabilité) | tronçons | aucune eau locale inventée |
| Terres arables et pâture | budgets de surface du LOD 3, puis LOD 0 ; capacité UGB mensuelle | finage de village | la surface cultivée réelle est un delta Chronos |
| Sel, fer, métaux | gisements (affleurement, accessibilité médiévale), sel marin | objets | l'exploitation est datée par Chronos |

`programme.resources`, qui réagit aux déclencheurs timber, stone, ore et clay pour ajouter des ateliers, devrait lire ces valeurs au lieu de déclencheurs déclaratifs.

## 7. Non réalisé

- Aucune modification de `surface_context.py`, de `ground_surface.py`, du catalogue ni des shaders. Aucun test côté Magna Urbis.
- L'écart de moyenne par bloc après conditionnement et le coût par tuile (environ 1,8 M cellules) sont à mesurer.
