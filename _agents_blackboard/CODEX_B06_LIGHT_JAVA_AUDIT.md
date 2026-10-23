# B06 légère : audit indépendant Java 1752, 23 octobre 2026

**Ne pas promouvoir la V1 : quatre pertes de surface réelles.** Comparaison offline de `web/out/portal-lintel-production-proof/java-full` et `web/out/b06-light-native-proof-full/java-full` ; aucune exécution native ajoutée. Résultats : `independent-audit-v2/comparison.json`, `before-physical.json`, `after-physical.json`, `context-and-geometry.json` dans le second dossier.

Les 1 752 demandes et le catalogue sont identiques. Les 28 payloads et sorties par phase sont vérifiés par leurs empreintes. Les admissions restent **1 338 admis / 407 refus / 7 espaces ouverts**, sans perte ni gain individuel. Aucune recette, variante ou nombre de niveaux ne change. Les 890 anciennes entrées natives sont toutes conservées exactement ; **106 nouvelles entrées** sont retenues. Les cibles atteintes à ±10 % restent 448.

| Index | Parcelle B06 | Corps avant m² | Corps après m² | Cible m² |
|---:|---|---:|---:|---:|
| 86 | `61cfa27a46095d2d` | 162,802926 | 13,690000 | 305,3 |
| 1003 | `8bb9568e38f9a743` | 225,269690 | 82,728567 | 730,2 |
| 1142 | `610435bd83edad98` | 242,401140 | 105,028000 | 375,9 |
| 1407 | `b0a3bda8022fadbe` | 159,621123 | 88,362593 | 472,1 |

Ces quatre cas expliquent −500,285718 m² au total, sans amélioration d’aire ailleurs au-delà de 0,0001 m². Le diagnostic confirme la cause : `budget_selection::Selection::finalize` tente le grand gagnant adapté, échoue son entrée, puis choisit le nominal plus petit dont le nouveau wrapper certifie désormais l’entrée. Le contexte spatial ne l’explique pas : voisins fournis identiques et occupation native antérieure locale identique sur les quatre cas (0/1/1/0 éléments dans le broad phase cadastral).

Le rapprochement géométrique trouve aussi deux déplacements physiques à aire identique, indices 529 et 1412 (différence symétrique des corps 1,6725 et 2,963304 m²). Ils ne doivent pas être qualifiés de simple bruit numérique. Au total, 33 sorties ont une différence de pose ou d’archive locale, dont six une différence corps/toit supérieure à 0,0001 m² ; les autres écarts de représentation restent explicitement dans le rapport.

La vérification des droits est verte sur les **1 338 bâtiments** : corps dans buildable, toiture dans ses droits, occupation complète dans cadastre, réserves et voisins, puis contrôle global STRtree sans collision entre occupations admises. Les payloads enrichis portent les occupations interlots ; l’auditeur accumule séparément les bâtiments antérieurs du même lot.

L’assise est vérifiée sur **996 préparations natives** après (890 avant) et, indépendamment de ce marqueur, **1 335 Single Ground simples** dans chaque phase. Zéro violation de hauteur d’assise, pente, cote de fondation ou eau ; erreur maximale de cote 2,522×10⁻⁹ m. Trois autres bâtiments restent hors du second périmètre, pas déclarés certifiés. Les 16 avertissements source/minima hérités sont exactement identiques avant/après et conservés dans les rapports.

Le nouvel auditeur `web/scripts/b06_light_physical_audit.py` distingue les pièces au sol et élevées. Pour le Single pris en charge, il utilise le corps Ground et la section native à `ground_z + 0,01 m` des murs ordinaires et features exportées. Les **106 Frame, quatre PortalLintel et quatre fragments supérieurs de mur** restent intégralement dans l’occupation mais hors assise. Les fragments `structure:lintel:wall:…` sont de vrais murs supérieurs ordinaires. Le premier audit avait prudemment signalé leur préfixe comme hors périmètre ; la V2 corrige cette classification, sans modifier les preuves ni le produit. Strip conserve son contrat physique antérieur.

Temps enregistrés par les replays existants : 3 288 → 3 440 ms. Ce sont deux passages séquentiels uniques, pas une mesure isolée de l’opérateur. La V2 à préparer doit empêcher les nouveaux opérateurs structurels de transformer la finalisation d’entrée en choix d’une autre taille, tout en conservant la sauvegarde nominale des anciennes familles Single simples.
