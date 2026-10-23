# C7921 — audit final nominal-first + reconnaissance du rectangle natif

23 octobre 2026. Rejeu hors ligne terminé ; aucune modification produit, compilation ou génération de ville dans cette tâche.

Le CLI `0406b1f3fbee178951cfd9773249fae2d1c0cc86d4ab0068dbeaa212eed3f75e` produit **6 225 plans admis, 1 689 refus et 7 espaces ouverts**. Par rapport à B11 : **146 admissions gagnées, aucune perdue ; aucun ancien portail conservé perdu ; aucune dégradation de l’erreur à la cible des anciens admis**. La reconnaissance du bruit nanométrique apporte 48 admissions supplémentaires par rapport au CLI nominal-first `38889…`. Le compromis local décrit ci-dessous reste visible.

## Corpus et vérification

Preuve : `web/out/java-c-nominal-first-roundoff-proof/`. Même snapshot intermédiaire Opus C de **7 921 demandes**, SHA `1d3fc52454e46a080d186aaa75a3fa99cde9b5291ef85b483860a0a04c39df53`, mêmes graines/configurations, **124 lots**, vrai `streamArchitectureSource` et occupation cumulative recalculée pour cette phase. Les contrôles d’ordre, d’exhaustivité, des voisins et d’absence d’alias mutable passent. Le SHA du producteur core de ce snapshot est inconnu : ce n’est ni le R5 final, ni une reproduction de l’interface utilisateur historique.

| Contrôle | Résultat final |
|---|---:|
| Droits corps/toit/occupation/accès audités par GEOS | 6 225, aucune violation |
| Terrain sur les corps réels Ground Single | 6 225, aucune violation |
| Assises préparées complètes | 2 174, aucune violation |
| Collisions entre occupations admises | 0 |
| Sources/variantes/étages modifiés sur anciens admis B11 | 0 |
| Portails anciens B11 | 6 gains, 0 perte |
| Erreur à la cible des anciens admis | 1 136 améliorations, 4 723 égaux, 220 inconnus |

Les **506 alertes brutes de source** sont conservées dans l’audit, pas masquées : 458 écarts de proportions déjà présents dans B11 et 86 écarts numériques de minima, avec recouvrement entre catégories. Tous ont les mêmes dimensions physiques qu’en B11 ; les derniers valent au plus **7,27 nm** et passent à la grille native du millimètre. Aucun nouvel admis n’en présente. Le premier audit retourne donc volontairement un statut non nul sur ces alertes ; le complément `findings.json` démontre leur antériorité. Cela ne valide pas les proportions héritées et ne modifie aucune tolérance native.

## Comparaison à la version précédente et compromis local

Par rapport à `38889…` : **48 gains, 0 perte**, 6 130 des 6 177 anciens objets strictement identiques octet par octet ; 47 objets changent, sans changement de source, variante, étage ou statut du portail. Une seule variation d’aire dépasse 0,0001 m² : site **index 1505**, B14/default, cible 99,6 m², **34,8491 → 29,7000 m²**, soit −5,1491 m². Ce site était **refusé dans B11** ; son portail reste conservé dans les deux versions expérimentales.

La requête et son contexte local sont exactement identiques : aucun voisin enrichi, aucun candidat d’occupation antérieure dans sa bbox. Le pool reconnu passe de **3 à 4 témoins**, l’observation sélectionnée de 0 à 3 ; même corps plein 7,5 × 11 m, puis réduction 4,874 × 7,15 → 4,5 × 6,6 m. Il s’agit du choix borné entre témoins nouvellement reconnus, pas d’une collision en chaîne. La répartition des évaluations entre témoins n’est pas enregistrée. Preuve complète : `independent-audit/one-regression-context.json`. Aucune nouvelle heuristique ni rejeu de correction ajouté pour ce cas.

La surface de plancher domestic+mixed passe globalement de **433 370,26 à 435 443,72 m²**, soit **+2 073,46 m² nets** pour ces 48 admissions. Ce gain agrégé et la perte locale sont tous deux conservés dans le bilan.

## Déficit restant : priorités pour Opus et Houses

Le collecteur existant mesure les **niveaux réels**, et compare seulement les sites dont la référence `emprise prévue × préférence d’étages` est connue. Aucun habitant, surface habitable ou capacité fonctionnelle n’est déduit.

Domestic+mixed : **7 777 sites**, 6 160 admis et 1 617 refus. Référence connue pour 7 490 sites, inconnue pour **287** (218 admis, 69 refus). Tous les plans admis ont une géométrie de niveaux connue. Sur le sous-ensemble comparable : **428 091,26 m² admis pour 1 593 811,30 m² de référence dérivée**. Les refus comptent zéro ; les références inconnues sont exclues du déficit.

| Origine du déficit brut, calculé par site sans compensation des surplus | Surface |
|---|---:|
| 1 548 refus à référence connue | **301 084,90 m² — 25,8 %** |
| Bâtiments admis sous leur référence | **865 587,97 m² — 74,2 %** |
| Dont B06/Joglo | **616 095,26 m² — 71,2 % du déficit des admis** |

Les surplus des autres sites totalisent 952,82 m² ; le déficit net vaut 1 165 720,04 m². B06 gagne déjà environ 60 258 m² sur les anciens admis, mais sa médiane aire/cible reste **0,1132** ; B14 et B15 restent proches de 1. Le principal manque de surface est donc désormais le **dimensionnement/composition des programmes confiés à B06**, davantage que le seul nombre de refus. Les programmes `compound` ne sont pas une preuve d’un ensemble de pavillons effectivement construit : les plans audités restent des corps simples. La prochaine tranche doit distinguer budget d’un corps Joglo et composition de plusieurs corps réellement déclarés, en conservant leurs sources et accès. Côté ville, poursuivre la faisabilité des lots sur pente et de leurs accès ; un refus de cette recherche bornée ne prouve pas l’impossibilité physique générale du lot.

## Budgets, limites et fichiers de preuve

Récupération initiale : **1 304 traces** (146 admis, 1 158 refus), 8 928 évaluations scalaires au total, **au plus 8 par site**, 440 constructions/admissions, **au plus 1 par site**. Amélioration ordinaire : 5 799 traces, 19 700 dimensions et 54 428 admissions, **maxima 8/24**, identiques à `38889…`. Ce sont deux phases bornées distinctes ; ces compteurs ne représentent pas tous les contrôles terrain de la finalisation. Les 1 115 demandes de finalisation nominale supplémentaires ne sont pas 1 115 admissions natives : 1 084 concernent B06 écarté par le préfiltre de ce finaliseur ; trois replis retiennent effectivement le portail nominal.

Aucune réalisation d’intérieur dans cet audit ; portail conservé ne signifie pas intérieur validé. La somme singleton de temps CLI est 11 188 ms, hors interface et machine partagée : aucune conclusion de vitesse ni extrapolation à une ville complète.

- `independent-audit/comparison.json`, SHA `fb98afa78f09a6f7d0fff30ae18015caab041a6383566a3a70d2923662dc8735` : comparaison B11 et contrôles géométriques.
- `independent-audit/findings.json` : antériorité des alertes source, cibles et portails.
- `independent-audit/comparison-to-previous.json`, SHA `7834d15d55e19ce6daa8b206eeef86b83bd2b19ab95e4ca0f03330093e1736c7` : comparaison `38889…`, objets et budgets.
- `structural-floor-programme-evidence.json`, SHA `ac3aa2f4ba4c7b90a6da0d9892977886ad0b3bce528e400503326a289d725ae1` : plancher et références.
- `independent-audit/floor-deficit-breakdown.json`, SHA `4640c1d33131d1e9cc56e93fd9c8c7a88505e8d210e19677045b5e2a3b4b21d4` : partage refus/admis/B06, produit hors ligne par `web/scripts/java_floor_deficit_breakdown.mjs`, avec mêmes règles et dénominateurs que le collecteur.

Tous les JSON des lots, leurs hashes et les diagnostics de refus restent archivés. Anciennes preuves B11, `525e…` et `38889…` intactes.
