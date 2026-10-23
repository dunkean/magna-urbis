# Houses — livraison vérifiée du 23 octobre, 03:57 Paris

Les propositions de dimensions respectent maintenant les proportions de leur source. Une réduction sur pente récupère de la surface dans le même budget d'admission. Les maisons simples compatibles conservent aussi leur vraie entrée native, à dimensions et pose constantes. **Cette tranche est disponible pour l'intégration urbaine d'Opus ; elle ne valide pas encore une ville de 100 000 habitants.**

## Référence figée

- `web/out/single-entry-terrain-cli-proof/plan_replay.exe` : SHA-256 `c90c4d64eb6815dbd39e1d85f673bbb6d87086391695aaa3909721cb378a0c64`.
- `houses.exe` : `8465e1d968635e14bf5367dc8a82b1d5d6d5a3766df1e37f8cf62a18ba609e11`.
- `build-proof.json` conserve 123 empreintes de sources, données, exemples et configuration, identiques avant et après compilation, plus les logs. **385/385 tests unitaires Houses passent.** Aucun core/local compilé ni serveur lancé pour cette preuve.
- Comparaison immédiate : CLI proportions `cac76c96c1a997288f51b9764005f6e4181719b0e55962e88bc4c693f398d777`. Les références antérieures restent conservées.

## Résultats comparatifs

| Corpus figé | Admissions après | Changement observé |
| --- | --- | --- |
| 01 européen, 128 demandes | 125 admises / 3 refusées | Plans entièrement identiques à la référence immédiate ; 86 entrées Strip retenues sur 101 prises en charge. |
| Rynek, 128 demandes | 111 / 17 | Plans entièrement identiques ; 68 entrées Strip sur 83 prises en charge. |
| Huit détails européens | 8 extérieurs / 8 intérieurs | Plans entièrement identiques et détails toujours valides. |
| Java, 128 demandes | 64 / 60 / 4 espaces ouverts | Sources, variantes et niveaux conservés ; six cibles de surface améliorées, aucune nouvelle régression ; 39 entrées Single retenues, 13 différées. |
| Trois détails Java | 3 extérieurs / 2 intérieurs | Les intérieurs a416 et a702 passent désormais ; 4100 reste refusé au raccord public. Avant : 3 extérieurs / 0 intérieur. |
| Deux détails romains | 2 extérieurs / 1 intérieur | B12 conserve son vrai escalier et son entrée ; B01/flat_earth reste hors de cette extension. Avant : 2 extérieurs / 0 intérieur. |

Audit indépendant : droits des 236 plans européens, 64 Java et deux romains vérifiés sans dépassement ; terrain des 184 fondations Strip européennes, 39 Single Java et une Single romaine vérifié sans dépassement. Les autres fondations ne sont pas implicitement certifiées par ces compteurs. Les détails ciblés ne constituent pas un taux de réussite de tous les intérieurs.

## Périmètre et limites

Le guide de pente porte uniquement sur des rectangles Single Ground sans cour ni feature et à toit Gable/Hip. Après l'échec d'une admission normale, il conserve le centre de façade et l'orientation, puis propose au plus une réduction. Les limites restent **8 couples de dimensions, 24 admissions et 8 évaluations de terrain** par parcours budgétaire. Une proposition repasse tous les contrôles natifs ; elle ne certifie ni optimum ni impossibilité globale. Sur le lot Java054, l'aire remonte de **27,796 à 57,725 m²**, pour une cible de 75,2 m².

La préparation d'entrée Single intervient seulement sur le plan final : une pose, aucune porte alternative, aucune nouvelle sélection de source. Un refus conserve la maison admise et son diagnostic. Les tentatives intermédiaires n'ajoutent pas cette préparation. Le chemin Strip antérieur reste inchangé.

**Les reculs de la tranche proportions restent visibles.** Java054 avait auparavant 75,198 m² avec un rapport hors source ; 57,725 m² ne récupère pas toute cette aire. Le lot européen cbfa reste à 80,271 m² contre 120 m² avant correction des proportions. Une proposition de retrait géométrique retrouve environ 120 m², mais sa porte native et sa toiture doivent encore être validées : voir `CODEX_CBFA_SETBACK_PROPOSAL.md`. Deux anciens incumbents Java restent hors du nouveau rapport source ; la nouvelle règle n'est donc pas une certification rétrospective de tous les plans.

## Coût et intégration

Cinq rejeux alternés des mêmes 128 demandes Java : avant `[154,188,182,200,152]` ms, après `[201,242,204,185,204]` ms ; médianes **182 → 204 ms (+12,1 %)**. Les sorties sont identiques à chaque répétition de leur phase. Machine partagée : cette mesure porte sur le calcul natif du corpus, hors démarrage/processus et sérialisation, et ne démontre aucune accélération ni performance de métropole. Le calcul terrain parcourt les cellules raster concernées ; ses huit évaluations ne sont pas huit opérations de coût constant.

Preuves : `web/out/single-entry-terrain-cli-proof/` et `web/out/java-terrain-entry-proof/`. Opus garde la capacité, le parcellaire, les ports et les murailles. Prochain contrôle commun : rejouer 01-l, 04 et Java100k sur son binaire R5 identifié, puis vérifier les plans réellement admis, les refus et les images avant la campagne des 50 captures. Les compteurs de capacité parcellaire ne doivent pas être présentés comme une population effectivement logée.
