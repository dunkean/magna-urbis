# Proposition isolée : proportions source des rectangles domestiques

Aucune modification de Rust, de catalogue, de plan, de pose ou de sélection. Prototype numérique : `source_aspect_budget.py.proposed` ; résultats archivés : `CODEX_SOURCE_ASPECT_SCALAR_PROPOSAL.json`. **5 tests Python causaux passent** ; aucun constructeur ni CLI natif exécuté.

## Contrat proposé

Pour la **source/variante sélectionnée**, avant de remplacer ses plages par un tirage, conserver l'intervalle complet :

`r_min = source.width_min / source.depth_max`

`r_max = source.width_max / source.depth_min`

Toute nouvelle proposition de corps vérifie `r_min ≤ W/D ≤ r_max`. L'échelle uniforme `config.size` s'annule dans ce rapport. La permission inspired existante peut agrandir les deux axes jusqu'à leurs bornes actuelles ; elle n'élargit pas cet intervalle. Aucun seuil d'élancement commun aux cultures, quota, étage supplémentaire ou corps ajouté.

Premier raccord proposé : `improve_domestic_budget`, sous ses gardes automatiques/inspired existantes, **Single/FP-RECT, un corps**, avec axes source directement applicables au corps. Les composantes principales doivent avoir ratios largeur/profondeur `[1,1]` ; les autres programmes restent Unknown tant que leurs proportions natives ne sont pas dérivées. Conserver `minimum_domain`, bornes par axe, source/variante/graine, étages, matériaux, toiture, cour/entrée et tous les contrôles. Pas de changement pins/strict/exact/choix de source. Il faudra réutiliser le contrat dans les autres adaptateurs automatiques Single avant de prétendre couvrir toutes les voies de résolution.

## Une projection scalaire dans chaque créneau existant

Si le couple proposé respecte déjà bornes et rapport, le rendre inchangé. Sinon, pour son aire `A=W×D`, l'intervalle de largeur compatible est :

`L=max(Wmin, A/Dmax, sqrt(A*r_min))`

`U=min(Wmax, A/Dmin, sqrt(A*r_max))`.

Choisir la largeur de `[L,U]` la plus proche de la proposition, puis `D=A/W`. Les bornes fournies comprennent les minima natifs réels et les maxima autorisés existants. Le prototype arrondit à la grille millimétrique vers des valeurs à l'intérieur des bornes et revérifie les produits croisés après arrondi ; un intervalle vide renvoie None. L'aire change seulement par cette quantification.

**Raccord avant l'appel existant à `budget_front_rectangle` pour le couple** : une largeur augmentée doit être recontrôlée par ce guide. Après sa réduction éventuelle de profondeur, revérifier le rapport et les bornes, puis ignorer le couple incompatible. Aucune deuxième réparation ni géométrie native essayée pour résoudre le rapport. L'admission complète demeure obligatoire. L'incumbent déjà admis reste disponible ; aucun plan archivé n'est redimensionné implicitement.

## Témoins numériques

| Source | Intervalle W/D complet | Couple retenu actuel | Projection scalaire du même budget |
|---|---:|---:|---:|
| B14, a416 et4100 | [0,409091 ; 1,25] | 4,5×22=99m² ; rapport0,204545 | 6,364×15,556=98,998384m² |
| B15, a416 et4100 | [0,384615 ; 0,888889] | 5×26=130m² ; rapport0,192308 | 7,072×18,382=129,997504m² |
| B14, a702 | même intervalle B14 | 7,5×11=82,5m² | inchangé |
| B15, a702 | même intervalle B15 | **corps réel**7,105×8,016≈56,954m² ; rapport0,886352 | rapport déjà conforme ; incumbent conservé |

Attention a702 : ses paramètres nominaux archivés restent8×13, mais le corps issu de l'adaptation mesure7,105×8,016. Sa profondeur est sous le minimum source9m. Le diagnostic distingue donc proportions, dimensions nominales et géométrie réelle ; cette proposition de rapport ne résout pas son déficit d'aire et ne redessine pas cet incumbent.

Contrôle naturellement allongé **dans les données du catalogue**, sans affirmation historique supplémentaire : EUR-NOR-B01, Single/FP-LONG, W[6,10], D[18,36], intervalle[1/6 ; 5/9]. Le scalaire conserve exactement6×36 et12×72 (rapport1/6, donc profondeur/largeur6), ainsi que20×72. Il corrigerait6×72 vers8,486×50,907. Ce contrôle démontre l'absence de plafond universel ; FP-LONG reste hors de la première activation proposée.

## Coût et ordre

Au plus **2 racines carrées par couple corrigé**, divisions et comparaisons en nombre constant ; zéro RNG, polygone, toiture ou maison dans la projection. Un couple déjà conforme évite les racines. Au maximum actuel8créneaux, cela donne au plus16racines supplémentaires ; aucune mesure Rust/ms prétendue.

L'ordre des sources, frontages, orientations et créneaux reste identique. Sur le contrôle scalaire saturé sans guide de site, les quatre créneaux `(largeur_max, largeur_min)` pour `(rue, grand_côté)` restent quatre : les deux couples maximaux sont inchangés, les deux couples étroits sont remplacés par leur projection. Un None/doublon réduit le travail ; aucun créneau ajouté et plafonds8couples/24poses conservés. Le succès rencontré et le nombre effectif de poses peuvent changer.

Les traces réelles Java donnent seulement les comptes : a416 avant/après6couples/24poses ;4100 avant8/22, après8/21 ; a702 avant/après8/24. **Les dimensions de tous les candidats et leurs refus ne sont pas archivées**, donc on ne peut pas prédire exactement leurs nouvelles séquences à partir de ces traces. Les tableaux ne prouvent aucune pose, aucun gain d'aire admise ni aucun résultat terrain. Rejeux bornés à prévoir après accord : mêmes trois demandes, sortie source/étages/aire/proportion, refus de terrain/droits et coût ; conserver explicitement les régressions éventuelles.
