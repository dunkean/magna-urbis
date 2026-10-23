# Cas romain utilisateur — captures et données conservées

22 octobre 2026. Aucun changement produit, aucun nouveau moteur. URL exacte transcrite par root dans `roman-user-url.txt`, utilisée telle quelle : décor 04, roman-core, 5 000 habitants, centre (2639.9315590685324, 2668.9433913724934), routes impériales, palette/fond parchemin, silhouettes. **8791 reste le binaire de 19:51**, SHA CFEC16B2…C8B6C ; les sources Rust plus récentes ne sont pas représentées par ce live.

## Parcours UI final

Dossier `web/out/roman-user-04-8791-final/` :

- `01-overview.png` : ensemble, 445 silhouettes visibles, 1,54 m/px.
- `02-centre.png` : centre utilisateur exact, 0,4 m/px, 225 silhouettes visibles. Des cours fermées rectangulaires se répètent fortement dans le cœur ; bandes et corps simples restent présents en périphérie. Cette observation ne suffit pas à condamner la typologie de cour romaine : l'audit de style_index distingue le mélange historique du biais de sélection.
- `03-port.png` : vrai district port au sud, 26 blocs, caméra calculée sur ses limites ; 0,69 m/px, 117 silhouettes visibles dans le cadrage. Grande partie du secteur clairsemée, rues courtes en impasse proches du rivage, aucune forme de quai identifiable. Les données confirment **zéro street.role=quay**.

158 blocs, 699 parcelles, 451 sites, 445 silhouettes et 6 espaces ouverts. Zéro erreur Worker/JavaScript, zéro appel `/houses/*`, zéro détail en cache ou en calcul. Les PNG ont été ouverts et inspectés. Le fond fantôme ne réapparaît pas.

Reproduction : `url.txt`, `input-options.json`, `report.json` avec caméras et provenance du runtime ; requêtes/réponses `01-quarters`, `02-parcels`, `03-buildingSites`, plus `silhouette-scene.json`. Les références natives de session/source sont runtime-only et omises des fixtures ; les layouts, parcelles, programmes, sites et contraintes sont conservés. Les réponses sites sont les véritables réponses du moteur ancien, pas un calcul du moteur récent.

Les dossiers `roman-user-04-8791/` et `roman-user-04-8791-captured/` gardent les deux échecs de capture du harness. Les requêtes natives étaient déjà terminées. Le second rapport démontre la cause précise : 445 silhouettes prêtes, mais caméra entière à 4,4 m/px, niveau qui masque les maisons ; le harness attendait leur visibilité avant de cadrer la ville. Ordre corrigé pour le parcours final. Ce ne sont pas des échecs de génération. `capture-attempts.json` confirme que layouts, partitions et sites sont strictement identiques dans les trois sorties.

## Comparaison CLI indépendante du live

Root a fourni `web/out/roman-port-proof/{before,quay-profile}/{layouts,partitions,requests}.json`, calculés avec le code Rust plus récent. Ils sont peints hors ligne, **zéro requête réseau**, avec le même snapshot de `cityCanvas`/`silhouetteScene`, le même fond, les mêmes caméras pour les deux variantes. Dossier `web/out/roman-port-proof/visual/` : quatre PNG `before-port`, `quay-profile-port`, `before-centre`, `quay-profile-centre`, `painter.js` et rapport avec hashes.

Le champ waterfront produit 5 courts segments de quai contre 0 ; les sites passent de 442 à 402 et la géométrie urbaine change. Visuellement, ces segments ne suffisent pas à rendre un port lisible : muraille continue sur l'essentiel de la rive, label PORT en retrait vers l'ouest, vaste vide occidental dans la variante. **Port non accepté comme corrigé.** Cette paire est comparable en interne ; elle ne constitue pas un avant/après causal des PNG UI du moteur 8791. L'affectation de l'emporium doit encore être vérifiée au district adéquat, comme signalé par root.

Scripts nouveaux uniquement : `web/scripts/roman_user_capture.mjs` et `web/scripts/roman_port_offline.mjs`. TODO perte/restauration réelle du contexte WebGL ajouté non coché, séparément du correctif fantôme.

## Vérification supplémentaire `quay-coast`

La variante CLI `quay-coast` est peinte sans nouveau calcul natif : `visual/quay-coast-port.png`, `visual/quay-coast-centre.png` et `visual/quay-coast-report.json`. Le script relit exactement le peintre archivé, vérifie son SHA et celui du fond, puis reprend les deux caméras du rapport initial. Zéro réseau, 439 sites et 8 quais dans les données. Les deux PNG ont été ouverts.

La très grande zone vide occidentale de `quay-profile` a disparu ; l'occupation ressemble davantage au témoin initial. Dans le centre et sur la rive cadrée, la muraille reste visuellement dominante et les quais sont peu distincts. **Limite importante : le cadrage historique « port », fondé sur le district portant ce rôle, n'englobe que 3 des 8 quais. Les 5 segments méridionaux entre y=3212 et y=3411 sont hors des deux images.** Cette vérification ne permet donc pas de juger les nouveaux quais du sud, ni de conclure que le port est corrigé. Les caméras ont volontairement été conservées, conformément à la comparaison demandée.

## Rivage sud — comparaison finale ciblée

Sur demande de root, une nouvelle caméra commune cadre les cinq sections méridionales : centre **(2635, 3310), 0,4 m/px**, viewport 1200×925. `visual/before-south.png` et `visual/after-south.png` utilisent les fichiers CLI `before` et `after`, ce dernier incluant les huit quais et le correctif des faux blocs humides. Peintre et fond relus depuis les snapshots, aucun calcul natif ou appel réseau. `south-report.json` conserve hashes et cadrage ; **442 sites dans les deux états**, 0 puis 8 quais au total. Les deux images ont été ouvertes.

Le changement est visible : cinq courtes sections suivent désormais le bord de l'eau et plusieurs raccords aux rues se distinguent nettement. Des maisons supplémentaires apparaissent à proximité, mais l'ensemble reste clairsemé. **Le reste visuel est précis : ces quais ressemblent encore à de petits tronçons de voirie aux extrémités arrondies**, sans plateforme portuaire continue, ligne d'accostage ou équipements qui rendraient un port immédiatement identifiable. Les limites en escalier de l'emprise sur le terrain restent très présentes. Les images vérifient l'amélioration et la présence des raccords visibles ; elles ne remplacent pas les gardes géométriques natives et ne certifient pas l'accessibilité de chaque section. Port non accepté comme résultat final. Aucune proposition de déplacer arbitrairement l'entrepôt ou l'emporium depuis leur site légal au bord de l'eau.

## Extrémités des quais — correctif visuel minimal livré

`cityCanvas.ts` utilise maintenant `butt` pour le contour et le remplissage des quais, comme pour les ponts. `cityGlBuild.ts` transmet la même règle à `putPolyline` : uniquement les deux extrémités de la polyligne sont plates ; les jonctions internes restent continues. Largeur, couleur, points, accès et traitement des autres rues inchangés. `cityGlStyle.ts` non modifié.

`visual/after-south-current.png`, ouvert et inspecté, montre nettement la disparition des capsules : les cinq sections méridionales ont désormais des extrémités droites et leurs raccords restent visibles. Géométries CLI, fond et caméra identiques à `after-south.png` ; seul le peintre change, conservé dans `painter-current.js` et référencé par `south-current-report.json`. Zéro réseau ou génération native. Les huit tests existants de `cityCanvas`/`cityGl` passent, TypeScript global passe. Ce correctif d'extrémité n'ajoute ni équipements, ni continuité de quai, ni occupation bâtie : les autres réserves visuelles demeurent.

## Quais groupés puis garde complète du rivage

Les sorties `final` restent archivées comme étape intermédiaire : 157 blocs, 445 sites, 8 quais. Leur fusion est réelle : deux tronçons méridionaux de 18,53 et 15,03 m deviennent une polyligne de 49,37 m ; une nouvelle section de 11,86 m apparaît ailleurs, donc le total reste huit. `visual/final-quay-connectivity.json` ne trouve aucun endpoint partagé à 5 cm : les images ne justifient pas d'attribuer ce total à un découpage par le réseau. La sélection d'un candidat supplémentaire après regroupement est une interprétation du code, distincte du constat géométrique. Cette étape a ensuite été invalidée par l'audit des largeurs harmonisées, pouvant faire déborder le ruban en eau.

La dernière sortie **shore-safe** remplace cette preuve pour l'état livré : 156 blocs, 444 sites, 8 quais. `visual/shore-safe-south.png` et `visual/shore-safe-port.png` ont été ouverts, avec `shore-safe-current-report.json` et `painter-shore-safe.js`. Les deux caméras, fond et peintre courant sont conservés ; zéro HTTP ou calcul natif pendant la peinture. Le sud montre les extrémités plates, la section angulaire allongée et plusieurs raccords de rue visibles. Le rivage reste peu occupé et les quais ne constituent pas encore un port immédiatement lisible. Les cinq sections méridionales appartiennent à des blocs commoner, tandis que le district nommé port est plus au nord : ne pas confondre présence de quais, légalité d'un emporium côtier en civic et cohérence fonctionnelle du port. Root a confirmé séparément les gardes géométriques du ruban et l'absence de surface hors sol sec ; cette peinture en vérifie l'apparence, pas la preuve native.
