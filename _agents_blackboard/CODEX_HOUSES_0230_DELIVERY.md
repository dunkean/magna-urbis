# Houses — tranche validée du 23 octobre, reprise Opus

Les sources Houses sont figées. Aucun core urbain ni serveur n'a été compilé/lancé par cette tranche. Le CLI de référence est `web/out/native-entry-existing-door-cli-proof/plan_replay.exe`, SHA256 `01148b07da054a8241feb063cea5fc17b8a52604531705438311ae210f6038f1` ; `build-proof.json` garde les hashes des sources et exécutables. Le moteur8791 reste distinct de ces preuves.

## Changements conservés

- Accès : après tous les raccords droits, un coude constructif ; après les quatre poses canoniques au maximum, jusqu'à quatre portes déjà présentes dans le même graphe natif, à la pose initiale. Aucune nouvelle maison/porte ni nouvelle sélection de source pour ce repli. Corps, toit, terrain, réserves et murs gardent leurs contrôles.
- Occupation : le passage initial reste réservé lorsqu'une autre porte est retenue, dans l'export, l'index des voisins et la relecture d'archive. Les succès canoniques gardent leur sortie exacte.
- Classement des petites résidences Row : préférence de rôle et de plage nominale parmi les sources simples comparables, à même distance d'étages ; quatre recettes restent retenues. Les variantes et places complexes restent conservées. Ce classement ne garantit pas la meilleure aire après placement.
- Archives TS : deux détails simultanés d'une même archive partagent son décodage, avec objets indépendants et gardes de remise à zéro/erreur ; cache borné conservé.

## Résultats contrôlés

| Témoin | Résultat |
|---|---|
| 128 demandes01 | 125plans/3refus inchangés ; entrées83→86/101, trois portes existantes récupérées |
| 128 demandesRynek | 111plans/17refus et68/83entrées inchangés |
| Géométrie des deux lots | Aucun changement de source, aire, pose ou architecture locale ; droits236/236 et terrain des184assises natives sans violation |
| Huit détails ciblés | 8/8extérieurs et7→8/8intérieurs ;11111 et11976 conservés à même géométrie |
| Deux petits romains | MaisonB01 :99,3m² restaurés ; B12 :31,5m² pour cible24,8, déficit explicitement conservé. Extérieurs2/2, intérieurs0/2 (entrée proxy hors périmètre Strip) |
| Java128, échantillon exact stratifié | 64plans/60refus/4ouverts inchangés ;12sources changées,11écarts à la cible réduits et1recul. Droits64×2 contrôlés ; pas d'audit terrain global ni d'intérieurs sur ce lot |

Java : sur les12mutations, corps969,895→1110,233m² ; erreur absolue4408,005→4231,675m² (−4,00%). Une seule cible sur12 reste à±10%. Le recul `a7029f26afac0cdd` (82,5→56,954m² pour348,8souhaités) est conservé dans les preuves et le TODO : la plus grande plage nominale ne garantit pas la meilleure pose. Le classement apporte ici un gain global limité, pas une solution de capacité. Le fichier de128demandes ne reproduit pas toute l'occupation accumulée des1752sites historiques.

Les planches `native-entry-existing-door-cli-proof/11111-before-after.png` et `java-row-selection-proof/comparison-three-sites.png` ont été ouvertes : géométries et caméras natives comparables, sans image générée ni intérieur inventé. Ce ne sont pas des captures du City Bench.

## Validation et coût

Suite groupée425/425 (376unitaires+49intégration) ; après la dernière correction de passage,376/376unitaires repassés. Rapport des alternatives4tests Python ; contrat natif/validateur TS officiel vert. Décodage TS16tests+typecheck,11tests voisins verts. Export admission final identique au canon225profils/421variantes, SHA `f9bbb5b4df9b18cf3a869cde96989075dce467a560c9e141a3b1363c362486ec` ; golden natif identique, SHA `9d97cabf1fc8ab85ec0f2aa19a9d1a54edc55223379229449e1823b8230924ca`. Export hors ligne89,45s après un premier timeout60s ; ce coût n'est pas payé par chaque maison.

Cinq alternances avant/après, sorties répétées identiques dans chaque phase :

- 01 : médianes470→417ms, mais dispersion416–616ms avant et411–560ms après ; aucune accélération attribuée au patch, machine non isolée.
- Java :158→163ms (+3,16%), dispersion149–188ms ; pas de gain général revendiqué.

Les mesures excluent le démarrage du processus et la sérialisation JSON. Elles ne valident ni le débit d'une ville entière ni le million. Preuves complètes : `native-entry-existing-door-cli-proof/replay/report.json`, `native-entry-existing-door-cost-proof/report.json`, `java-row-selection-proof/RESULTS.md`, `java-row-selection-cost-proof/report.json` dans `web/out/`.

## Raccord avec Opus et reste ouvert

Le raccord B13 natif3/4niveaux d'Opus est relu et accepté : variantes séparées, strict exclu, pression respectée, pas de pin. Retour restant transmis : filtrer aussi `late_only` puisque les requêtes n'autorisent pas ces sources ; trier les enveloppes sur la même aire majorée que celle du `take_while` pour les futurs catalogues.

Attendre `ROUND 5 LANDED` pour le build commun. Restent :15+15accès différés sur les deux corpus, entrées des Single, adéquation lots/programmes Java, refus, capacité réelle, qualité des centres/parcelles, vérification100k/million et campagne des50captures. Les TODO globaux restent ouverts.
