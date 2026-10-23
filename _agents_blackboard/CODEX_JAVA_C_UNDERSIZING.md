# Java C — maisons admises trop petites

23 octobre 2026. Analyse des **mêmes sorties figées c786**, sans nouveau calcul natif. Les 1 763 refus domestic/mixed restent hors de cette cohorte. Sur les **6 014 maisons admises**, 5 799 ont une cible d’emprise connue et 215 n’en ont pas. Toutes les sources retenues sont `Single/FP-RECT`, alors que le programme demande très majoritairement `compound` : ce mot ne crée aucun assemblage natif.

## Le cas dominant est B06, pas un manque général d’essais

Ratio = union de l’emprise des corps réellement admis / cible d’emprise. C’est une mesure géométrique, sans conversion en habitants.

| Source | Cibles connues | Ratio p10 / médiane / p90 | Sous 90 % | À ±10 % |
|---|---:|---:|---:|---:|
| B14 Kampung | 1 956 | 0,179 / 1,000 / 1,000 | 673 | 1 270 |
| B15 Limasan | 1 691 | 0,193 / 1,000 / 1,000 | 634 | 1 051 |
| **B06 Joglo** | **2 152** | **0,038 / 0,067 / 0,457** | **2 034** | **102** |
| Ensemble | 5 799 | 0,049 / 0,466 / 1,000 | 3 341 | 2 423 |

2 956 maisons sont sous la moitié de leur cible ; 35 dépassent 110 %. L’erreur absolue cumulée vaut 904 752,97 m², dont **677 382,05 m² pour B06**. [Données agrégées et croisements recette × rôle](../web/out/java-r5-capacity-houses-proof/undersizing-summary.json), [mesures par site](../web/out/java-r5-capacity-houses-proof/undersizing-sites.json).

| Rôle | Cibles connues | Ratio médian | Sous 90 % | À ±10 % |
|---|---:|---:|---:|---:|
| Tenement | 3 925 | 0,918 | 1 911 | 1 994 |
| House | 880 | 0,760 | 467 | 399 |
| Shop | 448 | 0,071 | 442 | 6 |
| Mansion | 523 | 0,068 | 499 | 23 |
| Townhouse | 23 | 0,193 | 22 | 1 |

## Bornes et recherches effectivement exécutées

À taille 1, les plages nominales de corps sont B14 **27–82,5 m²**, B15 **45–104 m²**, B06 **196–484 m²**. Les bornes supérieures conservatrices avec l’allocation dimensionnelle inspirée ×2 sont respectivement **330 / 416 / 1 936 m²**, arrondies vers l’extérieur. Elles ne tiennent compte ni du terrain ni du toit ni de l’accès : être sous cette borne ne prouve aucune pose possible. Aucune borne n’est inférée d’un témoin minimum.

**339 cibles dépassent la borne théorique de la source sélectionnée** (230 B14, 109 B15, zéro B06) ; 327 ne peuvent même pas atteindre 90 % selon cette seule borne. 1 497 cibles dépassent le maximum nominal, qui n’est pas une impossibilité dans le mode inspiré. Le déficit dominant B06 ne s’explique donc pas par son maximum théorique trop bas.

Les 5 799 cibles connues portent une trace de recherche budgétaire supportée ; aucune n’est `unsupported`. L’objectif natif `abs(log(aire/cible))` s’améliore dans **1 211 cas** (B14 688, B15 446, B06 77), mesuré depuis la surface initiale arrondie du diagnostic avec seuil relatif 10⁻⁴. L’amélioration en erreur absolue concerne 1 210 cas ; les deux critères ne sont pas confondus.

**3 376 traces déclarent la cible non atteinte ; 536 seulement atteignent au moins une limite de 8 dimensions ou 24 admissions.** Compter une limite atteinte ne prouve pas que davantage d’essais aideraient. Pour B06 sous 90 %, **1 997/2 034 n’ont admis aucune proposition de remplacement** ; 473 n’ont exécuté aucune admission et 396 aucun couple de dimensions. Seulement 68 B06 hors cible atteignent une limite. Les autres peuvent épuiser leurs couples admissibles ou échouer aux contraintes ; la trace ne distingue pas tous ces motifs.

1 977 B06 ont une emprise inférieure au minimum nominal de 196 m². Cela décrit l’adaptation inspirée actuelle ; ce n’est pas, à lui seul, une preuve de violation d’une contrainte historique dure. Le code de l’amélioration repart des minima de source, alors que le premier petit plan valide peut déjà être conservé. **La priorité est de comprendre cette divergence de dimensionnement et de sélection avant d’augmenter les quotas ou les maxima.** [Compteurs détaillés](../web/out/java-r5-capacity-houses-proof/budget-stop-evidence.json).

L’origine est tracée : **2 085/2 152 B06 portent `Constrained morphology`**. 1 993 ont au moins un axe inférieur aux 14 m nominaux, et toutes portent cette trace ; parmi les 2 034 sous 90 % de cible, 2 033 viennent de cette voie. Seules 67 portent la trace de dimensionnement initial natif. [Comptage et diagnostics des témoins](../web/out/java-r5-capacity-houses-proof/b06-origin-evidence.json). Ces faits ont été transmis à java_sources pour vérifier l’autorisation et le raccord exacts, sans transformer un indice en cause déjà démontrée.

## Trois témoins exacts transmis à java_sources

Sélection déterministe au plus près du ratio médian de chaque cohorte, puis indice d’origine. [Manifest et contextes](../web/out/java-r5-capacity-houses-proof/b06-witnesses/manifest.json) :

| Indice / lot / position | Cible → corps | Recherche de remplacement |
|---|---:|---|
| 4 804 / 075 / 4 | 253,8 → 22,784 m² | 4 dimensions, 10 poses, 0 admise |
| 2 427 / 037 / 59 | 726,8 → 25,539 m² | 4 dimensions, 9 poses, 0 admise |
| 1 262 / 019 / 46 | 465,3 → 465,300 m² | Cible initialement atteinte, 0/0 |

Chaque dossier contient la requête, le plan compact retenu, les diagnostics, les hashes des lots complets et les occupations antérieures intra-lot (4 / 57 / 31 bâtiments). **Le fragment d’une requête seule ne reproduit pas ces dépendances.** Aucun nouvel essai n’a été effectué. java_sources est chargé de l’analyse causale B06 ; les services artificiellement pinnés sont signalés séparément dans le bilan C.
