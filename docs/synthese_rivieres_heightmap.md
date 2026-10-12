# Synthèse de rivières sur heightmap : état de l'art et plan d'évolution

> **Objet :** situer les chaînes hydrologiques de Magna Urbis (Rust `rust/crates/core`, TypeScript `web/src/gen/terrain`, banc neuronal `web/src/ui/riverVectors.ts`) par rapport à la littérature, et fixer la liste des améliorations à implémenter.
>
> **Date :** 2026-10-12. État de référence avant implémentation : tag `rivers-neural-best-2026-10-12`. Implémentation : section 6.

## 1. Résumé

- La littérature est abondante et vient de deux communautés : la **géomorphologie / hydrologie numérique** (MNT, SIG, évolution des paysages) et l'**informatique graphique** (génération procédurale, édition de terrains).
- Nos briques d'extraction (priority-flood, zones plates, brèches, D∞, stream power implicite, migration de méandres) correspondent à l'état de l'art. Le « standard » du jeu vidéo, l'érosion hydraulique sur grille (gouttes ou *pipe model*), ne produit pas de réseau de rivières et serait un recul.
- Le point faible n'est pas l'algorithme de rivière mais **l'entrée** : un relief (surtout neuronal) qui n'est pas hydrologiquement cohérent. Les correctifs accumulés en aval dans `riverVectors.ts` (passages par le fond des dépressions, hauts-fonds, `uncross`, `despike`, `unfold`) traitent le symptôme.

## 2. Inventaire de nos chaînes

| Brique | Implémentation | Référence |
|---|---|---|
| Remplissage des dépressions | priority-flood (`hydrology.rs`, `erosion.ts`, `simpleHydrology.ts`) | Barnes, Lehman & Mulla 2014 |
| Zones plates | `hydrology_flats.rs` (coûts métriques symétriques) | Barnes, Lehman & Mulla 2014b |
| Brèches | bornées à 12 m / 1 km (`hydrology_depressions.rs`) | Lindsay 2016 (brèche au moindre coût) |
| Écoulement | D8 ; D∞ dans l'érosion | O'Callaghan & Mark 1984 ; Tarboton 1997 |
| Évolution du relief | stream power implicite + relaxation thermique (`erosion.rs`, `erosion.ts`) | Braun & Willett 2013 |
| Tracé fin | contour actif dans le thalweg (`riverVectors.ts`) | Kass, Witkin & Terzopoulos 1988 |
| Méandres | Howard & Knutson à la manière de meanderpy, recoupements, bras morts | Howard & Knutson 1984 ; Sylvester et al. 2019 |
| Largeur, sinuosité | W ∝ A^0,45, longueur d'onde ≈ 11 W, sinuosité décroissante avec la pente | Leopold & Wolman 1957/1960 ; Schumm 1963 |
| Lacs | bassins de débordement retenus en entier, sélection heuristique (`hydrology_lakes.rs`) | — |
| Estuaires | chenaux noyés, sans delta (`estuary.ts`) | — |

## 3. Les grandes familles de méthodes

### 3.1 Relief d'abord, rivières ensuite (notre approche)

On extrait le réseau d'un MNT existant. C'est l'outillage des SIG : RichDEM (Barnes), WhiteboxTools (Lindsay), TauDEM (Tarboton). Les difficultés connues sont précisément les nôtres : dépressions parasites, zones plates, artefacts D8 à 0°/45°.

### 3.2 Rivières d'abord, relief ensuite

On construit le réseau de drainage comme un graphe, puis un relief qui lui est cohérent par construction.

- Kelley, Malin & Nielson 1988, *Terrain simulation using a model of stream erosion*.
- Derzapf, Ganster, Guthe & Klein 2011, *River networks for instant procedural planets*.
- **Génevaux, Galin, Guérin, Peytavie & Benes 2013**, *Terrain generation using procedural models based on hydrology* (SIGGRAPH). Le type de chenal est choisi selon la pente et la position dans le réseau (classes de Rosgen : rectiligne, méandres, tresses…), et le relief est assemblé à partir de primitives le long du graphe.

### 3.3 Coévolution relief–rivières

Une surrection tectonique lutte contre l'incision fluviale (loi de *stream power*) : rivières et relief émergent ensemble, cohérents par construction.

- Braun & Willett 2013, solveur implicite O(n) (déjà dans `erosion.rs`).
- Cordonnier, Braun, Cani, Benes, Galin, Peytavie & Guérin 2016, *Large scale terrain generation from tectonic uplift and fluvial erosion*.
- Cordonnier, Bovy & Braun 2019, *A versatile, linear complexity algorithm for flow routing in topographies with depressions* (ESurf) : routage à travers les dépressions par arbre couvrant des bassins, alternative au remplissage.
- Schott, Paris, Fournier, Guérin & Galin 2023, *Large-scale terrain authoring through interactive erosion simulation* (TOG).
- **Tzathas, Gailleton, Steer & Cordonnier 2024**, *Physically-based analytical erosion for fast terrain generation* (Eurographics) : solution analytique du stream power, le temps devient un curseur.

### 3.4 Réseaux neuronaux guidés par le drainage

- Hu et al. 2024, *Terrain Diffusion Network: climatic-aware terrain generation with geological sketch guidance* (AAAI) : croquis avec rivières, crêtes, bassins.
- *Earthbender* (Brême, MIG 2025) : croquis → relief par diffusion guidée, rivières comprises.
- *Authoring Terrestrial Planets with Diffusion Models* (CGF) : réseau global extrait du croquis et passé en conditionnement.
- Goslin 2025, *Terrain Diffusion* (arXiv 2512.08309) : le modèle que nous utilisons, sans contrainte hydrologique.

Aucun modèle publié ne **garantit** la cohérence du drainage : il faut un post-traitement hydrologique.

### 3.5 Méandres et lits

- **Paris, Guérin, Collon & Galin 2023**, *Authoring and simulating meandering rivers* (TOG / SIGGRAPH Asia) : version publiée et vectorielle de ce que fait `riverVectors.ts`. Migration par courbure, recoupements et bras morts, **avulsions**, contraintes de trajectoire et **terme d'influence du relief** dans l'équation de migration ; validation par sinuosité et longueur d'onde.
- Peytavie, Dupont, Guérin, Cortial, Benes, Gain & Galin 2019, *Procedural Riverscapes* (CGF) : creusement du lit, surface de l'eau, chutes et rapides.
- Ikeda, Parker & Sawai 1981 ; Howard & Knutson 1984 ; Sylvester, Durkin & Covault 2019 (meanderpy).

### 3.6 Lacs et bilan hydrique

- **Barnes, Callaghan & Wickert 2021**, *Computing water flow through complex landscapes – Part 3: Fill–Spill–Merge* (ESurf 9, 105–121). Le ruissellement remplit chaque dépression ; une dépression pleine déborde vers sa voisine, deux voisines pleines fusionnent. Une dépression ne devient lac que si le bilan hydrique suffit : lacs endoréiques, lacs salés et cuvettes sèches émergent naturellement. Code libre (RichDEM, `r.richdem.fsm`).

### 3.7 Lois de validation

| Loi | Forme | Usage |
|---|---|---|
| Hack 1957 | L ∝ A^0,6 | longueur du cours principal |
| Horton–Strahler | rapports de bifurcation ≈ 3–5 | hiérarchie du réseau |
| Flint 1974 | S ∝ A^-θ, θ ≈ 0,45 | profils en long |
| Leopold & Wolman 1957 | tresses si S > 0,012 Q^-0,44 | style de chenal |
| Leopold & Wolman 1960 | λ ≈ 10–14 W | longueur d'onde des méandres |
| Seybold, Rothman & Kirchner 2017 | angle de confluence ≈ 72° humide, ≈ 45° aride | géométrie des confluences selon le climat |

### 3.8 Ce qui ne serait pas mieux

- L'érosion hydraulique sur grille (Mei, Decaudin & Hu 2007 ; gouttes) : ravines plausibles, pas de réseau hiérarchisé.
- Les *optimal channel networks* (Rinaldo, Rodríguez-Iturbe) : bonnes statistiques mais ignorent le relief existant.

## 4. Diagnostic

1. **Relief neuronal non cohérent.** Les reliefs bruts de Terrain Diffusion contiennent des dépressions de 100 à 260 m avec des collines noyées ; le D8 rempli les traversait en ligne droite. Les correctifs de `riverVectors.ts` contournent le problème au lieu de le résoudre.
2. **Lacs heuristiques.** Le choix des bassins conservés ne dépend pas d'un bilan hydrique.
3. **Deux styles de chenal seulement** (rectiligne, méandres) : ni tresses, ni anastomoses, ni méandres encaissés.
4. **Contrainte dure sur les méandres** (jamais au-dessus du niveau de l'eau, sinon retour au thalweg) au lieu d'une influence continue du relief ; pas d'avulsion.
5. **Deux hydrologies et deux bancs** : la meilleure chaîne (banc neuronal) n'est pas accessible au relief procédural, et l'inverse.
6. **Validation surtout visuelle** : les lois de la section 3.7 ne sont pas mesurées.

## 5. Plan d'évolution

Par priorité, toutes les étapes restant optionnelles dans le banc.

1. **Conditionnement « pré-hydrique » du relief**, avant toute extraction :
   - quelques itérations de stream power implicite à basse résolution et faible surrection, appliquées au relief neuronal ou procédural : les fausses cuvettes sont entaillées au seuil au lieu d'être remplies ;
   - variante : brèche au moindre coût (Lindsay) avec bornes larges, puis remplissage du reste.
2. **Lacs par bilan hydrique** (Fill–Spill–Merge) : ruissellement P−E issu du climat, niveau de chaque lac, bassins endoréiques et cuvettes sèches.
3. **Style de chenal selon pente et débit** : seuil de Leopold & Wolman pour les tresses, anastomoses en plaine très plate, méandres encaissés dans les vallées sinueuses.
4. **Influence continue du relief sur la migration** (Paris et al. 2023) au lieu de la contrainte dure ; avulsions.
5. **Banc unique** : terrain bench avec choix du générateur (procédural Rust ± érosion, neuronal), hydrologie vectorielle du banc neuronal par défaut, ancienne hydrologie Rust en option ; relief neuronal recadré ou mis à l'échelle et raffiné au zoom.
6. **Mesures** : Hack, Horton, Flint, longueur d'onde, angles de confluence, calculés dans les scripts de vérification.
7. Plus tard : deltas (arbre de bifurcations procédural, sans aller jusqu'à DeltaRCM).

## 6. Implémentation (2026-10-12)

Le banc neuronal est fusionné dans le banc terrain (`terrainbench.html` ; `neuralbench.html` redirige en gardant les réglages des anciens liens). Tout est optionnel et partageable par lien.

| Point du plan | Où | État |
|---|---|---|
| Choix du relief | étape Relief : source procédurale (± érosion Rust) ou neuronale | fait |
| Relief neuronal sur la carte | emprise *recadrer* (fenêtre de la taille de la carte, déplacée vers les côtes) ou *mettre à l'échelle* (± pentes conservées) | fait |
| Familles neuronales | relief local imposé par famille en mode Auto : plaine 20 m, colline 110 m, plateau 100 m (mesuré sur les graines 42, 7, 1234) | fait |
| Pixelisation au zoom | rééchantillonnage régional du moteur Rust + raffinement fractal optionnel sous la maille source (Hurst 0,8, amplitude ∝ pente) | fait |
| Réglages des réseaux neuronaux | « Réseaux neuronaux » (altitude ×, pas, bruits, relief local, histogramme, détail decoder) et « Climat détaillé » | fait |
| 1 · Conditionnement pré-hydrique | `web/src/ui/reliefConditioning.ts` : stream power implicite à 512² (niveau de base = surface de l'eau) + ouverture des seuils à pleine résolution ; force, profondeur et longueur réglables ; diagnostic « Conditionnement pré-hydrique » | fait, pour les deux moteurs |
| 2 · Lacs par bilan hydrique | `waterBalance.ts` : Turc–Pike, dépressions du routage priority-flood, passes de remplissage-débordement, lacs fermés à e·A = Q ; micro-cuvettes non dessinables comblées avant | fait |
| 3 · Styles de chenal | `riverVectors.ts` : tresses (seuil de Leopold & Wolman, vallée non confinée), anastomoses (plaines plates et humides), méandres encaissés via le talweg | fait |
| 4 · Influence du relief, avulsions | migration freinée par la hauteur de berge au-dessus de l'eau ; avulsions laissant d'anciens chenaux | fait |
| Angles de confluence | redessin de l'arrivée des affluents à 45–72° selon l'aridité | fait |
| 5 · Banc unique | moteur hydrique *Vectoriel* (défaut) ou *Rust (ancien)* ; diagnostics des deux chaînes ; rendus du banc terrain | fait |
| 6 · Mesures | `riverMetrics.ts`, panneau « Mesures » : Hack, Flint, Horton, longueur d'onde, sinuosité, confluences | fait |
| 7 · Deltas | défluents suivant le chemin le plus bas jusqu'à la mer depuis un apex où la ligne d'eau descend sous 1,5 m/km | fait, rares sur les reliefs actuels |

Mesures sur le relief neuronal *colline*, graine 42, 40 km, climat tempéré :

| Loi | Sans conditionnement | Avec (défaut) | Réel |
|---|---|---|---|
| Hack h | 0,53 | 0,54 | 0,5–0,6 |
| Horton R_b | 4,4 | 3,9 | 3–5 |
| Flint θ | 0,10 | 0,24 | 0,35–0,6 |
| Confluences | 52° | 62° (cible 71°) | 45–72° |
| Cuvettes > 1 m (grille 1024²) | 1 003 (4 570 hm³) | 504 (164 hm³) | — |
| Lacs dessinés | 112 (122 km²) | 26 (53 km²) | — |

Constats : le relief neuronal brut a des profils en long trop peu concaves (θ ≈ 0,1). Le conditionnement les rend plus concaves, sans atteindre les valeurs réelles : seule une évolution du relief plus longue y parviendrait. Les deltas demandent une plaine côtière basse, que ni l'esquisse neuronale (côte en tanh) ni le relief procédural ne produisent encore. Sans GPU, le calcul complet prend 10 à 25 s pour une grille de 1024².

## 7. Références

- Barnes, Lehman & Mulla 2014, *Priority-flood: an optimal depression-filling and watershed-labeling algorithm*, Computers & Geosciences 62.
- Barnes, Lehman & Mulla 2014, *An efficient assignment of drainage direction over flat surfaces in raster digital elevation models*, Computers & Geosciences 62.
- [Barnes, Callaghan & Wickert 2021, Fill–Spill–Merge](https://esurf.copernicus.org/articles/9/105/2021/), Earth Surface Dynamics 9 · [GRASS r.richdem.fsm](https://grass.osgeo.org/grass85/manuals/addons/r.richdem.fsm.html)
- Braun & Willett 2013, *A very efficient O(n), implicit and parallel method to solve the stream power equation*, Geomorphology 180–181.
- Cordonnier, Bovy & Braun 2019, *A versatile, linear complexity algorithm for flow routing in topographies with depressions*, Earth Surface Dynamics 7.
- Cordonnier et al. 2016, *Large scale terrain generation from tectonic uplift and fluvial erosion*, Computer Graphics Forum 35(2).
- [Génevaux et al. 2013, Terrain generation using procedural models based on hydrology](https://hal.archives-ouvertes.fr/hal-01339224) · [PDF](https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf)
- Howard & Knutson 1984, *Sufficient conditions for river meandering: a simulation approach*, Water Resources Research 20.
- Kelley, Malin & Nielson 1988, *Terrain simulation using a model of stream erosion*, SIGGRAPH.
- Leopold & Wolman 1957, *River channel patterns: braided, meandering and straight*, USGS PP 282-B.
- Lindsay 2016, *Efficient hybrid breaching-filling sink removal methods for flow path enforcement in digital elevation models*, Hydrological Processes 30.
- [Paris, Guérin, Collon & Galin 2023, Authoring and simulating meandering rivers](https://hal.univ-lorraine.fr/hal-04227965v1), ACM TOG 42(6).
- [Peytavie et al. 2019, Procedural riverscapes](https://diglib.eg.org/handle/10.1111/cgf13814), Computer Graphics Forum 38(7).
- Schott et al. 2023, *Large-scale terrain authoring through interactive erosion simulation*, ACM TOG.
- Seybold, Rothman & Kirchner 2017, *Climate's watermark in the geometry of stream networks*, Nature Geoscience 10.
- Sylvester, Durkin & Covault 2019, *High curvatures drive river meandering*, Geology 47 (meanderpy).
- Tarboton 1997, *A new method for the determination of flow directions and upslope areas in grid digital elevation models*, Water Resources Research 33.
- [Tzathas, Gailleton, Steer & Cordonnier 2024, Physically-based analytical erosion for fast terrain generation](https://diglib.eg.org/handle/10.1111/cgf15033), Computer Graphics Forum 43(2).
- [Hu et al. 2024, Terrain Diffusion Network](https://ojs.aaai.org/index.php/AAAI/article/view/29150), AAAI.
- [Earthbender, MIG 2025](https://cgvr.cs.uni-bremen.de/papers/mig2025/earthbender-paper.pdf).
- [Authoring Terrestrial Planets with Diffusion Models](https://diglib.eg.org/handle/10.1111/cgf70390), Computer Graphics Forum.
- [Goslin 2025, Terrain Diffusion](https://arxiv.org/abs/2512.08309), arXiv.
