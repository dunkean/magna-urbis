# Ressources : transfert des méthodes de Neural Earth vers Magna Urbis

Date : 2026-11-03. Sources lues : `../infinite_map/docs/RESOURCE_LAYERS.md` (R3k, compilateur 14), `../infinite_map/backend/terrain_resource*.py` (structure), `docs/RESOURCE_TILE_REFINEMENT.md` et `godot-render/tools/surface_context.py` de ce dépôt, `docs/catalogue_implantation_review.md`.

But : donner à la carte Magna Urbis (tuile de quelques km à 40 km) un modèle de ressources **peu coûteux** et **au même contrat** que Neural Earth, pour qu'il pilote ensuite le placement des settlements, les rôles de quartier et les sites d'activité dispersés. Le jour de l'intégration, le parent synthétique est remplacé par Neural Earth sans changer les consommateurs.

## 1. La substantifique moelle de Neural Earth

Huit idées tiennent tout le système. Le reste (GPU, LOD, USGS, 111 vues) est de la réalisation à l'échelle monde.

1. **Ontologie à 4 natures × 4 régimes.** Chaque couche est un *potentiel* (indice 0–1, moyenné), un *stock* (entier, sommé), un *flux* (entier par an/mois, sommé) ou un *calendrier* (mois). Régime : épuisable, régénérable avec délai, annuel, quasi fossile. Cette grille dit d'emblée comment agréger, conserver et faire évoluer une valeur.
2. **Une autorité, des raffinements qui ne contredisent jamais le parent.** Les quantités extensives sont des entiers engagés une fois (LOD 10) puis répartis exactement vers les enfants par `apportion` (plus forts restes, égalités par identifiant). Le fin révèle ou cache, il ne crée ni ne détruit.
3. **Hasard adressé.** `key(seed, domaine, lod, cellule)` (FNV-1a + splitmix64, identique à Chronos) : le résultat ne dépend ni de l'ordre de calcul ni de la fenêtre. Deux tuiles voisines se raccordent.
4. **Chaîne géologique hiérarchique.** Contexte tectonique → parts de roche *attendues* → géologie *réalisée* (`argmax_k log E_k + b_k + bruit de province + bruit de roche`, allongé selon l'azimut structural) → prospectivité par famille → **province → district → gisement**. Un district regroupe des gisements sans ajouter de stock.
5. **Tirage d'un gisement.** Nombre `Poisson(densité × prospectivité × aire)`, tonnage log-normal autour d'une médiane de famille, facteur de teneur commun, toit log-normal, position par **course exponentielle** `argmin(−ln u / w)` sur les poids des cellules enfants. Tout est déterministe et indépendant de l'ordre.
6. **Le récupérable compte, pas le contenu.** Accès médiéval = profondeur atteignable (40 m + relief) contre toit et extension, puis rendement. Un gisement est *affleurant* si toit < 5 m. Pour les matériaux (pierre, chaux, argile, sable) : « les stocks ne sont pas limitants, seuls l'accès, la qualité et le transport comptent ».
7. **Des sites de flux dérivés d'une géométrie + climat + combustible.** Le sel côtier (R3k) est le meilleur modèle pour nos sites d'activité : candidats sur la côte basse, espacement par exclusion (12/6 km), production = `min(plafond ressource, plafond travail, plafond combustible du voisinage)`, mois productifs en masque. C'est exactement un `ActivitySite` avec capacité et saison.
8. **Naturel immuable + delta daté.** L'état naturel ne change jamais. L'histoire (défrichement, extraction) est un delta. Le défrichement suit un **ordre canonique** des cellules : la surface défrichée à une date est un *préfixe* de cet ordre, monotone et identique à toute échelle. C'est la même idée que notre croissance par accrétion préfixe-stable (mémoire `city-growth-accretion`).

À cela s'ajoutent les formules biologiques simples et sourcées, directement réutilisables à l'échelle d'un finage : NPP Miami, aptitude céréalière en trapèzes Ecocrop (facteur le plus limitant), fourrage = NPP × part herbacée × 0,25 → UGB, bois : accroissement = NPP × 0,4 × 0,5 / 0,55, stock = accroissement × 60 ans × couvert, gibier Damuth, pêche continentale par plaine inondable (4,2 t/km²/an), pêche côtière sur plateau, tourbe, fer des marais. Et une règle de séparation : **un champ d'apparence (rendu) ne modifie jamais une ressource**.

## 2. Ce que Magna Urbis a déjà

| Couche | Où | État |
|---|---|---|
| Relief, pente, hydrologie (accumulation, receveurs, rivières, largeurs, lacs, mer) | Rust `erosion/`, `hydrology*.rs`, `settlements/grid.rs::Fields` | solide, c'est notre socle |
| Climat | `HydrologyConfig.temperature` / `.precipitation` (annuels, gradient −6,5 °C/km), bilan Turc–Pike | scalaire par carte, suffisant |
| Biome | enum web (`temperate`, `forest`, `desert`…) | déclaratif |
| Sol des champs | `web/src/gen/landuse/rural.ts:301` : `soil = fbm(x/380)` | **bruit pur, à remplacer** |
| Géologie (5 roches, dureté, azimut), HAND, TWI, alluvial, colluvial, éolien, côtier, profondeur de sol, pierrosité, texture sable/limon/argile, humidité, matière organique, drainage | `godot-render/tools/surface_context.py` (Python, rendu Godot) | **riche mais hors moteur** : ni les settlements ni l'urbain ne le lisent ; bruit non adressé, proportions fixes (constats de `RESOURCE_TILE_REFINEMENT.md` §2) |
| Ressources du programme | `programme_tokens.json` : timber/stone/ore/clay → `craft.workshop` | déclencheurs déclaratifs |
| Contrat de raffinement de tuile | `docs/RESOURCE_TILE_REFINEMENT.md` | proposé, non codé |

On a donc tous les **ingrédients physiques**, mais éparpillés (Rust, TS, Python Godot), et aucune couche de ressources consommable par le moteur.

## 3. Transfert proposé : un module Rust `resources`

Un module `rust/crates/core/src/resources/`, étape native après l'hydrologie et avant `settlements::placement`. Il calcule sur une grille de **blocs** (60–120 m, pas la grille DEM) pour rester bon marché. Cible : **< 150 ms natif pour 40 km**, une fois par terrain, en cache comme les checkpoints.

### R0 — Parent (le point de branchement)
`RegionPrior { rock_shares[8], context, temperature, precipitation, family_densities, district_flags }`.
- Aujourd'hui : synthétisé depuis la seed, le scénario de terrain et le biome (quelques presets : socle granitique, bassin calcaire, plateau basaltique, delta argileux, collision métamorphique…).
- Demain : lu dans Neural Earth (LOD 10 interpolé + gisements du LOD 3 tombant dans la tuile).
- Les consommateurs ne voient que le prior : l'intégration ne change rien en aval.

### R1 — Hasard adressé
Porter `key()` de Chronos (~20 lignes) à côté de `magna_urbis_random::Rng`. Notre `Rng` est un flux par label (`fork`) : bon pour les villes, mauvais pour des champs spatiaux. Tout tirage de R2–R5 passe par `key(seed, domaine, bloc)`.

### R2 — Géologie réalisée et sol (port de `surface_context.py`, sous-ensemble)
- Géologie : structure de `geology()` (plis, intrusions, coulées) mais bruit adressé et parts **conditionnées par le prior** (ajustement proportionnel `α_k`, 3–5 itérations). 8 classes. Sorties : `bedrock`, `hardness`, `structure_azimuth`.
- Terrain dérivé, tout en O(n) + une transformée de distance, à partir de nos receveurs Rust : `hand`, `twi`, `alluvial`, `colluvial`, `soil_depth`, `stoniness`, `clay`/`sand`, `moisture`, `organic`, `drainage`.
- Remplace le `fbm` de `rural.ts` : les champs, prés et marais lisent enfin un sol.

### R3 — Potentiels (intensités 0–1)
Ils nomment exactement les `required_context` du catalogue V0.2 :

| Potentiel | Formule (simplifiée de Neural Earth / surface_context) | Sert à |
|---|---|---|
| `arable` | trapèze Ecocrop (T, P annuels) × `exp(−pente/10°)` × profondeur de sol × (1 − pierrosité) × drainage | finages, fermes, greniers |
| `pasture`, `upland_pasture` | NPP × part herbacée × 0,25 ; estive = fourrage d'altitude × manque en plaine | bergeries, estives |
| `wood`, `timber_share` | couvert ligneux (biome × humidité) ; part bois d'œuvre selon la pente et l'humidité | coupes, charbonnage, scieries |
| `water_power` | dénivelé local × débit (accumulation) sur les tronçons | moulins, foulons, martinets |
| `wind_exposure` | TPI positif × dégagement | moulins à vent, tours de guet |
| `stone_ashlar`, `lime`, `slate` | table de lithologie Neural Earth × roche exposée × dureté | carrières, fours à chaux |
| `clay`, `sand` | marnes / alluvions × faible pente | glaisières, tuileries, potiers |
| `fish_river`, `fish_coast` | plaine inondable (HAND faible × écoulement) ; côte abritée | pêcheries, cabanes |
| `peat`, `bog_iron` | drainage 1 × organique × HAND faible ; zones humides × roche ferrifère amont | tourbières, petites forges |
| `salt_coast` | côte basse (hauteur, pente) × mois chauds et secs (dérivés de T/P annuels) | marais salants / salines ignigènes |
| `game` | Damuth × NPP | loges de chasse |

### R4 — Gisements discrets à l'échelle d'un finage
On ne transfère **que les petites populations** de R3h (densités de 20–100 pour 10 000 km²) : `bog_iron`, `local_ironstone`, `small_pb_ag`, `small_sn`, `small_coal`, `salt_spring`, `gypsum_quarry`, `placer_au/sn`. Sur 1 600 km², cela donne 3 à 16 occurrences par famille : la bonne échelle pour des mines de village. Les grandes familles USGS (0,1–0,8 / 10 000 km²) ne viennent que du parent.

Même tirage : Poisson → log-normal → toit → course exponentielle sur la prospectivité × roche hôte → accès médiéval → affleurement. On ajoute deux objets non métalliques, issus des potentiels plutôt que d'un tirage : **affleurements exploitables** (pierre, chaux, ardoise) et **glaisières**. Ce sont des maxima locaux de potentiel × accès, espacés par exclusion, comme le sel côtier.

`apportion` est codé dès maintenant (10 lignes), même sans parent réel, pour que le contrat soit déjà celui de l'intégration.

### R5 — Capacité et saison des sites
Chaque site porte `annual_t` = `min(plafond ressource, plafond travail, plafond combustible)` (modèle sel côtier) et un `season_mask` (abattage, débardage sur neige, pêche, marais salant). C'est ce qui distingue sans règle ad hoc `attached_external` (toute l'année) et `remote_seasonal` (masque partiel, loin du parent).

### Contrat de sortie
Reprendre tel quel `ResourceLayer { id, nature, regime, aggregation, quantum, unit }` et `Deposit { id, family, owner, position, ore_t, depth_top_m, recoverable, outcrop }` de RESOURCE_LAYERS §9, plus `ActivityAnchor { id, kind, position, potential, annual_t, season_mask, access_point }`. Exposés au web comme couches d'inspection (même mécanisme que `roads_inspect`) et en vues de diagnostic de la carte V2.

## 4. Ce qu'on ne transfère pas

- Contextes tectoniques calculés, atlas Orogen, aires sphériques : à 40 km, le contexte est une donnée du prior.
- Bilan hydrique mensuel et 12 valeurs par cellule : on garde l'annuel, et deux saisons dérivées si un masque l'exige.
- Évaluateur GPU / WGSL, LOD d'affichage, regroupement de symboles.
- Grands modèles USGS teneur-tonnage, gossans et textures d'oxyde : rendu naturel, périmètre utilisateur ; on ne fournit que l'emprise et le drapeau.
- Deltas Chronos complets : on retient seulement l'**ordre canonique de défrichement** comme base de l'extension des finages avec l'âge et la taille de la ville.

## 5. Coût et vérification

- Un passe O(blocs) pour R2–R3, une transformée de distance, un tirage par famille pour R4 : ordre de 50–150 ms natif sur 40 km à 60–120 m, en cache avec le terrain.
- Un test : conservation (`Σ enfants == parent`) + déterminisme indépendant de la fenêtre (deux sous-fenêtres donnent les mêmes valeurs sur leur recouvrement).
- Un coup d'œil : 3 vues de diagnostic (roche réalisée, arable, sites d'activité) sur une carte de bench.

## 6. Ordre et lien avec le plan du catalogue

R1 → R2 → R3 remplacent la phase **P2** de `catalogue_implantation_review.md`, qui proposait des prédicats ad hoc. R4–R5 alimentent **P3** (`settlements/activities.rs`). Les phases P0/P1 (données et rôles urbains) restent indépendantes.

Prochaine étape, à discuter : comment ces couches modifient
1. le score de placement des settlements (finage arable, eau, bois, pierre à portée de transport ; hameaux spécialisés près d'un gisement) ;
2. les rôles de quartier (`programme.resources` lit des valeurs au lieu de jetons ; nombre d'ateliers proportionnel aux flux) ;
3. les bâtiments dispersés (sites d'activité ancrés sur R4–R5).
