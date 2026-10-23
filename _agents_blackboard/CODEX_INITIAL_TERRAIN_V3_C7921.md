# Terrain V3 — preuve expérimentale C7921

## État

Aucune promotion de V3. Le CLI expérimental B06 V2 + terrain V3 est figé à `525e7e18974af17e37d4add23f785c3570a1b23900186eb87847a54adb3591a2`. La validation initiale de la copie était57/58 tests plans : le test supposant le cas C6 éligible reste rouge, conservé pour diagnostic. Le petit garde séparant les pools et le nouveau témoin C342 sont proposés seulement ; ils ne sont pas dans ce CLI.

## Rejeu effectué une seule fois

`web/scripts/java_snapshot_bridge_replay.ts`, vrai `streamArchitectureSource`, 124 lots ordonnés, occupation cumulative indépendante à chaque phase. Même source C7921, SHA `1d3fc52454e46a080d186aaa75a3fa99cde9b5291ef85b483860a0a04c39df53`, demandes/seed/config conservées, header schema1 sans settings ajoutés. Ce snapshot intermédiaire Opus C n'est ni la scène finale R5 ni un nouveau parcours UI.

Sortie `web/out/java-c-b06-v2-terrain-v3-proof/` : **6177 admis /1737 refus /7 ouverts**, contre6079/1835/7 sur le baseline `java-r5-capacity-houses-proof`, soit+98 net.98 plans admis portent la trace de reprise terrain. Audit indépendant style_index achevé :98 gains individuels,0perte,6177droits etassisesGroundSingle verts,0collision globale. Les nouveaux plans passent les contraintes source/étage/graine. Les voisins effectivement transmis par le bridge ont été vérifiés pendant le flux, demandes et exécutable inchangés en fin de rejeu.

Somme temps natifs10501ms contre10404ms baseline, un échantillon d'exécution par phase ; aucune revendication statistique de performance. Les mutations B06 V2 font partie du CLI, donc les changements d'aire hors reprises terrain ne doivent pas être attribués à V3.

## Témoin positif extrait sans mélange d'occupation

C342, lot005/position22, `parcel-f42b96229dae3091`, source admise B14. Fixture `proposals/initial_terrain_recovery_v3/followup/c-native-terrain-positive342.json` (29 455 octets, SHA `07d9d8374fe073fcd063e50b6cda5de173234c67c30a17726c0bccdcbe58d84a`). Demande, plan archivé et22 occupations précédentes du MÊME lot expérimental copiés en tokensJSON bruts. Aucun Resolved inventé pour un refus. Les contextes précédents baseline/expérimental diffèrent malgré absence d'intersection avec le cadastre du témoin ; ils ne sont donc pas interchangeables.

Test proposé séparé exige ordinary sequence refusée identiquement avec/sans observation, pool non vide de poses réellement déjà essayées, puis proposition admise obligatoire,8 évaluationsguide maximum/1 construction/1 admission. Source/variante/seed/niveaux/matériaux/toit/façade/angle et droits/occupation vérifiés. Extérieur obligatoire, intérieur rapporté séparément sans promesse.

## Non-régression row : défaut démontré hors C

Root a mesuré le vieux corpusJava1752 : combiné1283/462/7 contreV2 1298/447/7,31 pertes et16 gains. Le pool V3 y mélange les témoins façade déjà connus avec les3 alignements natifs ; de nouveaux témoins remplacent des choix utiles et le premier réduit échoue ensuite à l'accès. Proposition étroite `!frontage_preferred` autour de l'observation native : préserver le poolV2 pour row/continuité et étendre seulement les demandes sans préférence façade. Aucun nouveau pool/budget/pose. Tous les domestic/mixed C sontcompound/.5 ; ce garde ne modifie pas leurs observations. Non-régression1752 à confirmer après compilation/rejeu root.

C6 reste rouge tant que l'instrumentation native ciblée n'a pas prouvé la cause (géométrie avant terrain, ticket, minimum ou lower_front). Le nouveau positif C342 ne doit pas masquer ce contre-exemple.

## Trace native suivante (copie uniquement)

`web/out/houses-next-proposal-workspace/v3-index6-instrumented-and-b06-entry-tests.log` établit que C6 atteint bien le garde terrain sur la pose centrale B14/B15, avec accès lower_front déclaré et bornes/proportions source admissibles. L'exclusion vient de `source_terrain_budget::supported=false` ; les autres alignements échouent aux droits avant terrain. B06 atteint aussi le terrain mais son corps14×14 égale les minima, donc lower_scale=1. Le test négatif proposé conserve la demande/refus et dépense0/0/0. La cause exacte à l'intérieur du prédicat supported n'est pas encore mesurée : ses égalités de rectangle local après union booléenne sont une piste (dimensions7.488000005×10.696999997), pas une preuve d'incompatibilité architecturale.

Dans cette compilation de diagnostic, le garde de séparation restaure le témoin historique1050 à6.234×9.144=57.003695937m², extérieur valide, intérieur encore refusé proxy. Cela prouve ce témoin, pas encore la non-régression des1752sites. Le positif C342 et le remplacement du faux positif C6 par le négatif explicite sont assemblés dans le followup proposé ; `apply_followup.py --check-only` passe, aucune application faite par cet agent.

## Audit indépendant terminé, réserves de promotion maintenues

La preuve complète est dans `CODEX_C_COMBINED_B06_V2_TERRAIN_V3_AUDIT.md` et `web/out/java-c-b06-v2-terrain-v3-proof/independent-audit/`. Les98gains (97B14,1B15) ajoutent4710,05m²d'emprise ;50 ont une entrée native retenue.901traces de reprise (98succès,803refus) totalisent5844évaluationsduguide et309constructions/admissions, maxima8/1/1. Les211 propositions réduites refusées ne sont pas cachées.

Les changements B06budgétaires du même CLI ne sont pas une simple non-régression :1921anciens plans changent d'aire au-delà1e-4m² ;33anciens portails sont gagnés et36perdus, dont35àcontextevoisins/broadphaseexactementidentique. Ce sont des différences de résultat budgétaire, pas un effet démontré d'occupation nouvelle ;Java prépare un correctif distinct. Ils interdisent de présenter ce combiné comme une amélioration sans réserve. Les458ratios horsplages source conservés dans l'audit sont hérités identiques, restent une dette et ne sont ni excusés ni requalifiés en capacité certifiée.

Aucune nouvelle réalisation détaillée par cet audit. L'extérieur du positif342 sera obligatoire dans le test natif proposé ; aucune conclusion de capacitéhabitable/foyers/population n'en découle.

## C6 : cause numérique établie, correction proposée

Le log `nominal-first-v3-exact-domain-tests.log` ferme la cause : le seul prédicat en échec est `exact_zero_origin_bounds`. Les bornes natives valent [-2.7418134429524343e-9, 1.5497212402237892e-9, 7.488000002741813, 10.69699999845028] ; les différences booléennes rectangle/corps sont nulles dans les deux sens. Il s'agit du résultat de l'union native d'un rectangle, pas d'une topologie ou d'une pose incompatible.

Le bundle `proposals/initial_terrain_recovery_v3/roundoff/` propose une reconnaissance bornée à 1e-7 m (GRID_M/10000), avec coordonnées et dimensions finies, toutes les anciennes conditions structurales, et égalité booléenne stricte dans les deux sens. Aucune mutation du contour, aucune normalisation de source, aucun nouveau seuil de droit, accès ou terrain. Le test C6 redevient un témoin d'observation obligatoire ; son admission finale reste à constater. Les négatifs couvrent une translation réelle de 1 mm, un quadrilatère oblique incomplet, un trou et des valeurs invalides.

Le test positif C342 a passé la préparation, l'admission complète, l'extérieur et l'intérieur dans la copie : 73.476717920 m² avec 8 évaluations / 1 construction / 1 admission. Le hook du probe B06 détaillé est retiré de la validation produit proposée : son échec reste archivé, causé par un PortalLintel réel de 0,17 m² hors corps à z=2,05 m ; aucune structure ni contrainte n'a été omise pour le faire réussir.
