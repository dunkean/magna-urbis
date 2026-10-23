# CityBench : parcours natif paginé raccordé — 23 octobre 2026

Le vrai bouton de génération de `terrainUrban.ts` appelle désormais `runCold` pour une ville unique, en mode compact/détaillé, avec une source native locale retenue et IndexedDB disponible. La réception écrit chaque chunk avant son ACK. Le panel conserve un descripteur et des comptes, pas une seconde scène native complète. Les contextes multi-villes et legacy conservent leur ancien parcours.

## Consommateurs raccordés

- L'aperçu 2D ajoute les projections légères par lot. Les plans et archives natifs restent dans le store paginé. L'index visuel complet reste en mémoire pour dessiner la vue d'ensemble : aucune borne de heap global n'est encore démontrée.
- Sélection, inspecteur et ouverture dans Houses chargent le vrai bâtiment demandé et son contexte minimal. Leurs files sont distinctes ; une lecture périmée ne remplace pas une sélection plus récente. Les DTO graphiques ne sont jamais envoyés au réalisateur natif.
- Les détails 2D et 3D utilisent les vrais plans lus. La 3D accepte les projections natives pour son aperçu, avec les surfaces d'occupation et contraintes de sol explicites ; l'aperçu ne fabrique pas de toit détaillé. La 3D reçoit la génération terminée, pas chaque lot intermédiaire.
- Une édition de style utilise les sites originaux encore valides et un voisinage natif borné. Elle écrit une nouvelle génération atomique, conserve les chunks étrangers exactement et remplace un seul visuel. Sans sites originaux fiables, avec un offset non pris en charge ou un voisinage tronqué, elle échoue explicitement et conserve la ville précédente.
- Les snapshots locaux, comparaison, compteurs et refus supportent le nouvel état. Les translations portent un offset ; les chunks et archives originaux restent inchangés. Une fusion de plusieurs stores froids n'est pas prise en charge : elle est refusée au lieu d'abandonner une ville.
- Les exports/imports `.decor`, historique et bibliothèque transportent les vrais chunks. Les sauvegardes locales conservent leurs références IndexedDB. Un export portable ne se limite jamais à ces références. Le téléchargement utilise une écriture progressive si le navigateur l'offre, sinon un Blob borné à64Mio.
- Les recettes/MU peuvent porter une petite archive froide (24Mio), dans leurs limites existantes ; au-delà, message explicite vers `.decor`, sans régénération silencieuse ni référence locale présentée comme portable.
- L'export d'architecture seul conserve le manifeste et tous les chunks, ainsi que le repère monde et le propriétaire urbain. Les APIs d'export terrain asynchrones sont raccordées ; les anciennes APIs synchrones signalent leur incapacité à transporter une archive froide.

## Validation disponible

- Vérification ciblée root : **69 tests /9 fichiers verts** (session44173), incluant session, snapshot, panel, portable `.decor`, consommateurs3D et invalidation des attentes amont.
- Les livraisons des modules possèdent en plus leurs tests ciblés et preuves séparées : édition41/5, recettes52/4, bridge3D24/7, refus14/3. Ces comptes se recouvrent et ne doivent pas être additionnés comme une suite unique.
- `tsc --noEmit` final : **exit0**, session70578. Sources hachées dans `web/out/cold-ui-integration-final-20261023/sources-during-tests.json`.
- Construction production CityBench : **exit0,262modules**, `web/out/cold-ui-build-proof/build.log` et `site/`.
- La suite Vitest complète du projet `fast` reste en cours, session29300. Aucun résultat global encore annoncé. Le projet `slow` est distinct et n'a pas été relancé.

## Limites de preuve et travail restant

Le contrôle navigateur a retourné zéro surface disponible, et l'ouverture IAB a échoué (`Browser is not available: iab`). Aucun clic réel, IndexedDB navigateur, pan/zoom de cette nouvelle route, reprise après crash ou capture visuelle n'est donc validé par ce lot. Les tests de panel/transactions utilisent des doubles ; le bundle et TypeScript ne remplacent pas cette validation.

Restent notamment : plusieurs villes froides dans une même scène, budgets du grand index visuel/tuiles, mesures de heap/FPS/GPU et premier affichage sur100k puis1million, conservation/récupération des générations anciennes, campagne des50captures et revue culturelle. La réduction de mémoire native du parcours ne répare ni le coût CPU des maisons, ni leur surface parfois trop faible, ni le déficit urbain réel. La tâche globale de grande ville et l'objectif global restent ouverts.

Les fichiers receiver/protocole/store gardent leurs garanties précédentes ; aucun moteur Rust ou serveur n'a été redémarré par ce lot. Les propositions affines et `programme_outcome` restent isolées tant que leurs preuves et leur promotion ne sont pas terminées.
