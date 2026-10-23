# Audit indépendant A3 — amélioration confirmée, acceptation géométrique encore partielle

2026-10-22. Les deux replays natifs figés et les neuf captures sont terminés, sans changement du core ni campagne Visual50. **Verdict : `needs_rework` pour l'objectif global « plus d'aiguilles / parcelles équilibrées » ; disparition des ailes de cour trop fines et des previews invalides confirmée.** Le runtime :8795 n'est plus utilisé par cet audit ; le signal de fin a été transmis à root.

## Provenance et portée

Commande : `city_visual_audit.mjs --server http://127.0.0.1:8795 --reference .../city-visual-audit --out .../city-visual-audit-a3`, puis copies inchangées de `measure.py` et `shapes.py`. Tous les processus terminent avec code 0. Les fichiers de référence n'ont pas été modifiés.

- Runtime A3 fusionné annoncé par Opus, binaire du **19:32:21**, horodatage vérifié et SHA-256 enregistré dans [runtime.json](city-visual-audit-a3/runtime.json). Statut HTTP conservé par cas.
- Requêtes quartiers identiques octet pour octet : SHA-256 `28567de5…7b3d7ab` pour 01-l, `25dedb26…1e8694` pour 04. Sites, routes et graines figés ; aucune recomputation UI. Quartiers, parcelles et buildingSites sont de nouvelles sorties natives.
- Peintre identique par SHA-256 ; **neuf caméras identiques** aux références. Les neuf PNG après ont été ouverts, ainsi que les références des trois cadrages témoins principaux.
- Ce pipeline mesure **sites et silhouettes**, pas les plans acceptés par `/houses/plans`, les toits détaillés, la capacité habitée ou la fluidité UI. Les compteurs d'acceptation/refus architecturaux restent **non mesurés**, jamais assimilés aux previews.

Synthèse machine : [comparison-summary.json](city-visual-audit-a3/comparison-summary.json). Données complètes et mesures : dossiers [01-l](city-visual-audit-a3/01-l) et [04-mountain](city-visual-audit-a3/04-mountain).

## Résultats comparables

| Mesure | 01-l avant → A3 | 04 montagne avant → A3 |
|---|---:|---:|
| Parcelles totales | 12 738 → 14 010 | 249 → 622 |
| Parcelles constructibles | 11 000 → 11 925 | 51 → 453 |
| Sites totaux | 10 960 → 11 811 | 40 → 422 |
| Sites non ouverts | 8 122 → 11 759 | 35 → 417 |
| Previews non vides | 8 057 → 11 592 | 32 → 406 |
| Preview vide, repli `placement_hint` non vide | 65 → 167 | 3 → 11 |
| Ni preview ni hint, hors espaces ouverts | 0 → 0 | 0 → 0 |
| Previews/hints invalides / hors lot | 166 / 0 → **0 / 0** | 0 / 0 → **0 / 0** |
| Pièces du centre avec angle <20° | 489 → **25** | 0 → 0 |
| Pièces minces : largeur <2,5 m, longueur >6 m | 113 → **11** | 0 → **1** |
| Cours fermées mesurées | 300 → 127 | 13 → 31 |
| Ailes de cour <1 m / <2,5 m | 132 / 243 → **0 / 0** | 0 / 0 → 0 / 0 |
| Paires voisines, fronts proches, rapport d'aire >3 | 157 → **96** | 0 → **4** |
| Lots constructibles de profondeur >100 m | 11 → **2** | 3 → 0 |
| Profondeur constructible maximale | 243,0 → 112,9 m | 177,6 → 74,3 m |

Le progrès ne vient pas d'une suppression générale du bâti : 01-l conserve **18 824 pièces de preview** contre 13 284 ; 04 passe de 40 à **585**. La surface des silhouettes affichables passe de 1,552 à 1,661 million de m² dans 01-l, et de 22 536 à 63 203 m² dans 04. Les espaces ouverts explicites sont respectivement 52 et 5 après A3.

Les formes aiguës diminuent fortement, mais le seuil zéro n'est pas atteint. Les 25 angles aigus du centre 01-l appartiennent à des polygones géométriquement valides : un simple contrôle de validité ne les élimine pas. Un contrôle complémentaire sur toutes les zones trouve 72 pièces « angle <20° ou minces » dans 01-l, 3 dans 04 ; toutes proviennent de `preview`, aucune du repli `placement_hint`.

## Lecture des images et témoins restants

**Cour fine 01-l : correction visible.** Dans [detail-thin-court.png](city-visual-audit-a3/01-l/detail-thin-court.png), les corps autour du point historique sont maintenant des bandes et volumes lisibles, avec des vides ouverts ; l'aile quasi nulle de l'ancienne capture n'est plus présente au même cadrage. Les cours fermées restantes ont une aile minimale mesurée d'environ **3,60 m**. Cependant, les cours fermées du centre passent de **119 à 3**. Les cours ouvertes entre plusieurs corps ne sont pas comptées par cette métrique : vérifier la diversité typologique séparément avant de conclure que toutes les compositions de cour ont été préservées.

**Cadrage des parcelles disproportionnées : problème résiduel manifeste.** La nouvelle [vue des bâtiments](city-visual-audit-a3/01-l/detail-unequal-buildings.png) montre une longue pointe brune près du centre-gauche. Témoin précis, déjà contenu dans le cadre figé :

`layout-f9dab5910f08a8a2/block-a5487d6dade22867/parcel-2af3e02d097804d4/building`

Preview domestique `dwelling.row`, composition `row`, pièce 0 ; centre **(7256,380 ; 7865,343)**, aire **207,53 m²**, longueur **41,20 m**, angle minimal **13,77°**. Ce n'est ni un fallback, ni une maison supprimée, ni une anomalie ajoutée par le peintre. Le ring à quatre sommets et le programme sont dans [remaining-witnesses.json](city-visual-audit-a3/remaining-witnesses.json). Le pire déséquilibre de fronts proches après A3 reste **8,42×**, autour de (7224,283 ; 8204,076), contre **9,64×** au maximum dans la référence ; les deux IDs après sont dans `01-l/shape-metrics.json`.

**Centre 01-l : plus régulier, encore hétérogène.** [core-buildings.png](city-visual-audit-a3/01-l/core-buildings.png) montre beaucoup plus de corps rectilignes et moins de masses suivant chaque irrégularité du lot. Des pointes et de petites annexes restent visibles. Les masses de monuments sont des previews ; leur libellé ne prouve aucune architecture native correspondante. L'overview est au LOD du peintre figé qui masque les maisons : il sert à comparer l'emprise et le réseau, pas à valider des détails de maison.

**04 montagne : progrès visuel substantiel et non vide.** [core-buildings.png](city-visual-audit-a3/04-mountain/core-buildings.png) remplace les grands vides et quelques énormes empreintes de la référence par une trame occupée, avec des cours et des corps plus simples. Les résiduels passent de **144 784 à 8 024 m²**. Il reste une pièce mince et quatre paires de lots déséquilibrées selon la même heuristique ; ce n'est donc pas une preuve d'absence universelle de défauts.

Enfin, les parcelles brutes invalides 01-l passent de **2 à 6** : trois résiduels (4,85 à 29,65 m²) et trois jardins attachés minuscules (0,018 à 0,54 m²), aucun lot constructible. Identifiants, rings et raisons Shapely dans [invalid-parcels.json](city-visual-audit-a3/invalid-parcels.json). Les surfaces des statistiques sont réparées avec `make_valid`, exactement comme dans l'outil de référence ; cette réparation d'analyse ne constitue pas une correction du générateur.

## Suite ciblée proposée

Conserver l'acceptation partielle « previews valides, ailes de cour minimales » ; laisser les TODO globaux silhouettes/équilibre ouverts. Reprendre d'abord le témoin `2af3e02d097804d4` et les deux profondeurs >100 m, puis classifier les 96 paires selon leur vraie rue d'accès avant de corriger les couples dos à dos. Vérifier aussi la diversité des cours après régularisation. Les heuristiques ne certifient ni toute largeur locale, ni accessibilité/pente, ni qualité architecturale.

Durées de génération/dump observées : **12,20 s** pour 01-l et **2,86 s** pour 04 (références 21,61 s et 4,86 s). Matériel/charge/cache non contrôlés : indications de ce replay, sans revendication de gain de performance. Aucun nouveau benchmark lourd ni appel natif n'est nécessaire pour exploiter les témoins enregistrés.
