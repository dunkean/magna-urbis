# Relecture indépendante — projection des proportions source

23 octobre 2026. Lecture du helper `source_aspect_budget.rs`, de son raccord dans `improve_domestic_budget` et du prototype Python. Aucun Rust modifié, aucune compilation ni génération native exécutée par cette revue.

**Un défaut concret trouvé, corrigé par Java Sources avant gel :** `domestic_budget_plan` arrondit encore le rectangle au millimètre. Avec B14 et `size=1.0001`, le couple brut `4.50045 × 11.001` respecte les bornes source et leur rapport minimal `4.5/11`. Le corps construit devient `4.5 × 11.001` : largeur sous le minimum et rapport `0.40905372239 < 0.40909090909`. Le raccord vérifie désormais le couple après guide **et** `[snap(width), snap(depth)]` avant construction ; un échec est ignoré sans deuxième réparation. Un témoin scalaire ciblé est transmis au propriétaire.

L'intervalle de projection à aire constante est correct : `max(Wmin,A/Dmax,sqrt(A*rmin)) ≤ W ≤ min(Wmax,A/Dmin,sqrt(A*rmax))`. Les plages sont positives, ordonnées et finies ; aire, grille et produits croisés sont revérifiés. La quantification reste conservatrice : une frontière numérique impossible est refusée, sans epsilon qui élargirait les droits. Les dimensions déjà conformes sont rendues bit à bit par `project()`.

Cette dernière garantie concerne le helper seul : le minimum de profondeur communiqué au guide dépend maintenant du rapport source. Il peut modifier la dichotomie ou éliminer un ancien candidat trop court, même lorsque sa proposition initiale était conforme. Aucune identité générale des plans ou des poses n'est revendiquée.

Le raccord lit les plages de la variante effectivement sélectionnée, pas les tirages ponctuels archivés. L'échelle uniforme s'annule dans le rapport ; les bornes par axe conservent `size`, les minima natifs et l'autorisation existante ×2. Le périmètre `Single/FP-RECT`, corps unique, composante principale à ratios unitaires et l'admission antérieure de `domestic_budget_shape` évitent de confondre dimensions nominales et dimensions du corps. Strip, cours, annexes et autres programmes restent hors périmètre.

Le budget de recherche reste deux fronts × quatre créneaux, au plus 24 poses pleinement contrôlées, sans nouveau tirage RNG ni créneau. Les rejets et la déduplication peuvent réduire ce travail. L'incumbent admis reste disponible ; cette correction n'affirme ni capacité résidentielle ni atteinte du budget.

Enfin, la fixture de protection par variante doit fournir aussi la recette avant d'appeler le chemin natif : une variante seule est une configuration invalide. Cette correction de test a été signalée à Java Sources. Après la garde sur les dimensions effectivement construites, aucun autre blocage identifié dans le périmètre relu ; validation native et comparaison de qualité restent à exécuter par root.
