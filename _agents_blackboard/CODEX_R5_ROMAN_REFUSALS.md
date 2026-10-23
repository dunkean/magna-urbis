# Roman Round5 : les113 refus restants

Audit hors ligne des fichiers `web/out/r5-roman/{before,after}/city-04-mountain-bay-s-*`, sans génération, serveur ni compilation. Résultat natif archivé, distinct des corrections Houses en cours. Scripts/preuves : `audit_r5_roman.py`, `r5-roman-refusal-audit.json` ; hashes conservés. Le classement budgétaire expérimental n’est pas activé.

**R améliore réellement la sélection :271 bâtiments,113 refus,6 ouverts sur390 demandes ;99 nouveaux acceptés, aucun ancien succès perdu.** Les390 objets conservent exactement cadastral, buildable, réserves, droits de toit, accès et terrain entre avant/après.369 demandes sont automatiques domestic/mixed, toutes Row, sans contrôle dur :261 acceptées et108 refusées.

## Ne pas classer par le seul dernier message

Les messages finaux donnent84«opérateur absent»,20«minima trop grands»,7terrain,1recherche épuisée,1accès. Mais le diagnostic conserve parfois un échec antérieur plus informatif : **87 refus contiennent une pose dont corps/cour/structures tiennent, rejetée par le terrain avant vérification toit/accès**. C’est une preuve sur une pose essayée, pas l’impossibilité de toute pose sur ce site.

| Groupe disjoint | Nombre | Ce que les archives prouvent |
|---|---:|---|
| Au moins un candidat contenu échoue au terrain |87|64 dépassent l’assise0,75m sans dépasser12° ;23 dépassent aussi12°.60 se situent dans le district elite.5 sont des fonctions épinglées non domestiques. |
| Pas de trace terrain et B01 absent des4choix |17|Quatre cours remplissent la shortlist alors que le souhait est Row ; seule petite source rectangulaire non essayée. |
| Pas de trace terrain, mais B01 déjà dans les4choix |9|Il reste un problème de géométrie/toit/accès à préciser ; le dernier refus d’une autre recette ne donne pas le motif propre de B01. |

Les19 shortlists sans B01 sont **toutes Row**, et toutes finissent en refus ;2 ont aussi une trace terrain. Cette reconstruction est un port exact du RNG UTF16/sfc32, des poids, variantes et rangs courants, sans maison générée ; les261 couples recette/variante automatiques acceptés appartiennent tous à leur shortlist reconstruite. Elle ne remplace pas une trace native par candidat.

## Correction maison la moins risquée

**Après l’échec des quatre choix existants seulement**, pour automatic domestic/mixed Row, autoriser au plus un candidat simple compatible non essayé, issu du même ordre pondéré et des mêmes filtres. Ici cela rend B01 accessible sur19 demandes, dont17 sans preuve terrain ; ce n’est pas une promesse de19 récupérations. Conserver les succès existants, les pins/variantes/ères, l’absence de relâchement et tous les gardes. Ne pas promouvoir B01 avant les cours partout : deux cours ont réellement réussi et doivent rester possibles.

Le helper est préparé dans `style_index.rs` ; root possède le raccord `plans.rs`. Le classement budgétaire reste séparé et inactif. L’exemple tenement de24,8m², inférieur au minimum nominal B01 de35m², montre qu’un succès géométrique éventuel ne certifierait pas son programme.

**Ensuite : dimension/pose tenant compte de l’assise, pas nouvelle palette.**80 refus automatiques avec terrain avaient déjà B01. Pour les64 cas d’assise seule, une orientation/dimension différente peut être utile, à certifier avec les vrais échantillons et l’accès ; la médiane du besoin enregistré est1,407m, pas un petit défaut d’arrondi.23 cas enregistrent aussi une pente excessive. Aucune hausse de0,75m ou12°, aucune fondation à gradins inventée. Le témoin d’accès final a aussi une ancienne pose à0,753m : résoudre seulement l’assise ne prouve pas son accès.

## Typologies, tradition et budgets encore insuffisants

269 acceptés sont B01 ; une B08 punique et une B02 atrium complètent le résultat. Les261 automatiques contiennent259 B01 et ces deux cours. Le pack ne dispose toujours ni de petite insula3–5 niveaux ni de taberna autonome :136 tenements acceptés sont B01, un autre B02 ; le souhait urbain réduit à2niveaux ne crée pas une capacité collective native. Parmi360 demandes automatiques à cible positive,62 cibles sont atteintes à±10% ; cela représente62/254 des acceptés avec cible. Le ratio médian aire réelle/cible parmi ceux-ci est≈0,405. Acceptation et satisfaction du programme restent distinctes.

Les cinq refus épinglés sont capitolium/B02, horreum/B02, basilica/B02, thermae/B02 et fullonica/B01 ; tous ont aussi une preuve terrain. Ces pins sont produits par la ville, mais les supprimer ne fournirait ni temple ni thermes ni entrepôt natif sourcé. Un registre fonctionnel explicite est nécessaire ; aucun remplacement domestique annoncé comme équivalent. De même, filtrer tout MED-ANT en «romain» sans index de tradition sourcé retirerait la B08 actuellement réussie ; ce n’est pas le correctif immédiat des refus.

Huit demandes exactes sont isolées dans `r5-roman-refusal-witnesses.json` et expliquées par le manifeste adjacent : shortlist, petit tenement, B01géométrie, grande cible, assise seule, pente, accès et horreum. Aucun rejeu effectué. Pour une future reproduction stricte, restaurer aussi l’occupation antérieure du batch et ses settings ; la liste isolée ne contient pas ce contexte implicite.
