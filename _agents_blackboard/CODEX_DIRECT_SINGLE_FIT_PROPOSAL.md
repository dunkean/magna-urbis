# Proposition Houses : dimensions et pose avant construction, puis guide d’assise

23 octobre 2026. Analyse isolée ; aucun Rust produit modifié, aucun Cargo/service/rejeu natif lancé. Les résultats ci-dessous ne sont pas des certificats de placement ni des capacités habitantes.

La priorité utile est de remplacer un créneau budgétaire simple par une proposition déterministe informée par la géométrie et le terrain, en gardant les autres replis et l’incumbent admis. Aucun nouveau contrat core n’est nécessaire pour cette première tranche. Le raccord `native_minimum_candidates` prévu par Opus en R6 reste indépendant : son B14 figé de27m² et son garde de cible±10% ne répondent pas aux grandes cibles Java ; il ne faut pas agrandir ce témoin exporté.

## Ce qui existe et ce qui manque

`direct_convex_fit::solve_rectangle` est un noyau non appelé en production. Il reçoit les trois vrais domaines convexes corps/occupation/toit dans un repère de front fixé, des bornes W/D et des marges rectangulaires. Il élimine l’abscisse par Fourier–Motzkin, découpe le domaine W/D, calcule extrema W×D et intersections avec la cible, puis récupère une abscisse. Aucun tirage, maillage, raster, corps natif ni recherche d’angle. Ses5tests couvrent triangle, marges distinctes, contour oblique inversé, exclusions concaves/trouées et cible hors plage.

Attention : `preferred_aspect` ne contraint pas le rapport. Avant tout raccord, ajouter les deux demi-plans de proportion déclarée `W−rmax·D≤0` et `rmin·D−W≤0` ; conserver la vérification après grille. Le helper isolé `native_single_fit` sait reconstruire une source canonique simple une fois, mais demande un plan natif non adapté et des paramètres identiques dans le corps/principal. Les incumbents contraints tels a702/054 ont des offsets et dimensions réels différents des nominaux : ne pas leur appliquer ce helper aveuglément. Dans `improve_domestic_budget`, la voie sûre reste le `domestic_budget_plan` déjà utilisé, avec les paramètres du corps retenu et sans nouveau tirage.

Le coût du noyau est borné : ≤16sommets par domaine, ≤48contraintes avant projection ; au plus576contraintes projetées pour ces48lignes (garde de sécurité2048). Le découpage a un pire cas quadratique dans ce nombre, puis extrema/racines linéaires dans les arêtes et tri des candidats scalaires. Ce n’est pas un gain de temps démontré. Il évite des constructions seulement si le domaine et le modèle sont pris en charge ; comparer appels/poses et temps sur les mêmes requêtes.

## Raccord proposé dans les créneaux existants

Périmètre initial : automatique inspired, Single/RECT, un corps rectangulaire et niveaux identiques, ratios de composant unitaires, ni cour, passage, supports ajoutés, jetty ni programme composé ; pins/strict/exact et adaptations non déclarées conservent leur chemin. Source, variante, seed, étages, matériaux et toiture restent ceux déjà sélectionnés. Aucun style de remplacement.

À un front/orientation déjà prévu, préparer les vraies surfaces de droits et les marges du simple connu ; appeler une fois le noyau au lieu d’un couple extrême. Appliquer grille/minima/proportions ; fournir directement son transform à l’admission, sans rappeler le guide qui déplacerait son origine. Le résultat consomme un créneau existant (≤8couples/24poses), puis une seule reconstruction et la validation native habituelle. En cas d’Unsupported ou d’échec physique, conserver le repli et l’incumbent ; aucun certificat d’impossibilité globale.

Une façade choisie doit réserver le débord connu ; le portail natif n’est pas contenu dans le modèle rectangulaire actuel. Le contact public reste à vérifier. Les capteurs d’entrée Single préparés séparément par morphology ne doivent pas être dupliqués ici.

## Limites réelles des témoins Java

Les sources figées de `java-source-aspect-proof` montrent : a416 a8sommets convexes mais sa cible736,3m² dépasse le maximum autorisé B15 16×26=416m² ; a702 a5sommets convexes ; 4100 est concave (7,274m² ajoutés par son hull), 054 a45sommets concaves (388,656m² ajoutés), ae8 a61sommets concaves (1247,244m² ajoutés). Le noyau actuel **ne traite donc pas les deux régressions Java 054/ae8**. Un hull peut servir de proposition historique, jamais de droit à bâtir. Une future cellule convexe certifiée intérieure serait un autre chantier.

Sur a702, le candidat constructif unique14,651×23,807m au plus long front tient corps/toit dans les droits et représente348,796m² ; son assise raster est1,878325m, bien au-delà de0,75m. Aucun gain natif présumé. L’incumbent réel reste7,105×8,016≈56,954m², malgré ses paramètres nominaux8×13.

## Guide terrain borné, évalué hors production

Pour un rectangle de corps connu, une réduction à **centre de façade, ligne de façade et angle fixes** crée des domaines emboîtés : `[cx−sW/2,cx+sW/2]×[front,front+sD]`. Les min/max du même champ bilinéaire et le maximum de gradient sur ces domaines sont monotones mathématiquement. L’altitude n’est pas une fonction linéaire du facteur ; le simple rapport limite/dénivelé ne certifie rien. La grille doit garder les deux dimensions monotones et le rapport dans l’intervalle source. Une résolution qui déplace la façade ou change de cellule, source, étage, appui ou entrée n’a plus cette garantie.

Prototype : haut+bas de l’intervalle imposé par les minima, puis au plus6dichotomies ; ≤8appels au calcul exact d’assise sur rectangles, aucune construction native. Seul un échantillon réellement passé est retenu. Les erreurs numériques et le seuil de cellules du calcul natif peuvent empêcher une preuve de maximum ; l’admission finale reste l’autorité, sans tolérance élargie. Eau, murs, toits, droits et accès restent des gardes distincts.

| Témoin | Proposition à façade historique fixe | Terrain | Droits hors ligne | Conclusion |
|---|---|---|---|---|
| 054 B14, cible75,2 | correction de ratio≈9,695×7,757,75,204m² |0,813432m, refus|corps/toit contenus|La conservation d’aire n’est pas admissible ici. |
| 054,8appels |8,872×7,098 =62,973456m²|0,749390m ;5,244°|corps/toit/réserves/occupation précédente :0 ; raccord conservé à1,34e−10m² près|Récupération partielle plausible face à27,796m² ; construction native et détail non exécutés. |
| cbfa B11, cible313,9 |7,072×16,970 =120,01184m²|0,220989m ;1,756°, succès dès1appel|corps hors droit9,219m² ; toit18,028m²|Le guide terrain seul ne récupère pas ce cas ; ne pas accepter ce rectangle. |

Le sous-rectangle054 de7,5×6=45m² offre aussi un témoin causal : inclus dans l’ancien corps admis, ratio1,25 et assise0,642127m. Toute la chute à27,796m² n’est donc pas nécessaire à la proportion source. À l’inverse, la pose historique de cbfa, très étroite, ne donne aucun certificat pour son corps élargi ; son ancien5×24 était hors proportion.

Coût observé ponctuel Python/GEOS des8calculs054 : environ1,4ms, sans construction ; aucune transposition en temps Rust ou en gain ville. Le coût Rust reste à mesurer. Les extrema raster changent de cellule pendant une réduction, mais sur des domaines emboîtés cela n’autorise pas à relâcher le seuil. Le minimum peut être physiquement refusé ; cela termine ce seul guide, pas la recherche architecturale globale.

Limite majeure de la preuve : les ancrages sont les anciennes poses admises archivées. Le produit n’a pas cette réponse historique. Pour profiter du guide sans essai natif supplémentaire, il faut l’appliquer à **une pose scalaire déjà produite par un créneau courant**, puis construire une fois. Ne pas ajouter un nouvel ancrage ou prétendre que ces nombres garantissent un gain après raccord.

Artefacts reproductibles : `direct_single_fit_probe.py.proposed` / `CODEX_DIRECT_SINGLE_FIT_SCALAR.json` et `single_terrain_budget_probe.py.proposed` / `CODEX_SINGLE_TERRAIN_BUDGET_SCALAR.json`. Ce dernier conserve hashes d’entrées, facteur, dimensions, huit décisions et droits. Validation suivante proposée : test natif054+cbfa avec gardes inchangées et compteur≤1construction par créneau, puis mêmes128Java+primaire/secondaire, pertes et surfaces détaillées. Aucun TODO global à fermer sur cette analyse.
