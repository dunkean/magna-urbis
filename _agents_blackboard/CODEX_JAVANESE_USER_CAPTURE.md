# Java 100k utilisateur — capture unique du moteur8791

22 octobre2026. Parcours exact de `javanese-user-url.txt`, sans changement de preset : décor10 tropical-island-l, culture javanese-courts, population cible100000, centre8000/8000, architecture detailed, parcel_fit. Dossier **`web/out/javanese-user-10-8791/`**. Aucun service lancé/redémarré, aucune comparaison ni réalisation globale de détails. HMR suspendu pendant la capture ; aucun message supprimé observé. Le moteur est toujours le binaire **19:51, SHA CFEC16B2…C8B6C**, antérieur aux correctifs Rust récents. Cette preuve ne les valide pas.

## Résultat terminal et archives

Une chaîne urbaine : **1132 blocs, 4306 parcelles, 1752 sites**. Un begin, 28 pages de sites et 28 lots `/houses/plans` : **484 plans acceptés, 1261 refus, 7 espaces libres**, soit27,7% d'acceptation parmi les1745 demandes bâties. L'interface affiche aussi3 monuments et conserve explicitement la population cible100000. Zéro erreur Worker/JavaScript ou réponse HTTP>=400 enregistrée. Aucun appel eager, aucune réalisation `/houses/realize-plan`.

- `001-quarters-{request,response}.json`, `002-parcels-{request,response}.json` : données urbaines réelles, programmes et diagnostics conservés.
- `003-buildingSitesBegin` et pages `004` à `031` : toutes les demandes de sites originales dans `placementRequests`, avec offset/next/total. Sessions et tokens natifs sont omis des archives ; leurs identités ne constituent pas une fixture portable.
- `report.json`, `summary.json`, `native-status.json`, `input-options.json`, `url.txt` : compteurs, caméras, provenance, routes et temps. Le probe conserve les agrégats, sans copie supplémentaire de la scène complète.

Les recettes acceptées sont AS-ISL-B01:200, B06:124, B07:86, B03:33, B09:19, B11:14, B05:5 et B02:3. Les1261 refus partagent le code `plan_refused`. Les40 premiers messages sont conservés : limites de fondation/pente et corps/cours/structures ne tenant pas dans le domaine, souvent accompagnés d'une absence d'opérateur de composition contrainte. **Cet échantillon ordonné ne chiffre pas la part globale de chaque motif.** Les réponses complètes de plans ne sont pas archivées ; les sites complets le sont. Aucun nouveau calcul n'a été lancé pour combler cette limite.

## Images ouvertes et verdict

`01-overview.png` : caméra ajustée à la ville, centre7460.5606/8848.1532, environ4,27m/px. Une vaste trame urbaine, de grandes parcelles et des bâtiments très rares. Le compteur de dessin512 inclut d'autres glyphes/bâtis du peintre ; il ne remplace pas les484 plans natifs. `02-centre.png` : centre utilisateur exact8000/8000,0,2m/px ; **un bâtiment peint**, grandes surfaces vides et voirie dominante. Les extérieurs détaillés restent0, cohérent avec cette vue presque dépourvue de bâtiments éligibles. Aucune caméra opportuniste n'a remplacé le centre.

**Verdict visuel : needs_rework.** La chaîne se termine, mais ces images ne rendent pas une ville convaincante de100000 habitants. Elles corroborent deux pertes distinctes à quantifier : trop peu de sites/capacité avant architecture, puis une majorité de refus architecturaux. L'audit de style_index exploite les mêmes archives pour la capacité urbaine ; aucune seconde génération.

## Temps et limite du suivi réseau

Premier appel de plans à67,15s après lancement du harness ; dernier terminé à77,89s ; captures terminées à81,40s. Le worker mesure13,12s de pipeline architectural, dont2,32s de sites (préparation0,11s, lectures2,21s) et10,80s de placement/publication avec ACK. Ces temps sont **indicatifs sous charge machine**, pas un comparatif causal ou un benchmark isolé.

Le drain final du harness attend60s un événement `requestfinished` manquant pour `/raster`, déjà revenu HTTP200 ; il porte la durée totale du script à141,61s. Tous les appels quartiers/parcelles/sites/plans sont terminés, zéro détail actif. Ce défaut de télémétrie empêche d'affirmer un drain réseau intégral depuis Playwright ; il **ne prouve pas** qu'un calcul natif raster serait encore en cours. Les compteurs terminaux et les captures précèdent cette attente. Aucun retry, serveur ou calcul supplémentaire.

Six témoins sont prêts pour le diagnostic natif ciblé de morphology : `targeted-refusals.json`, offsets 0, 1, 4, 7, 13 et 15 de la page 004, chacun avec requête originale complète, ID, motif et provenance. Les deux derniers sont explicitement AS-ISL-B05 ; l'offset 7 est B06. `refusal-witnesses.json` conserve les 40 témoins archivés. Dans ces 40 seulement : 16 motifs pente/fondation seuls, 6 pente/fondation avec composition indisponible, 18 non-fit avec composition indisponible. Les surfaces des 484 plans acceptés n'ont pas été agrégées dans le probe et leurs footprints ne sont pas archivés ; les surfaces de leurs lots ne doivent pas être présentées comme des surfaces architecturales.
