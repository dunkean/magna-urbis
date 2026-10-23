# Raccord natif à un coude — preuve CLI figée et coût séparé

23 octobre2026. Le probe11976 (`53c6fbc1ac486b3b`) a réussi **extérieur et intérieur** au même emplacement, avec recette, tirages, corps et appuis conservés (`web/out/native-entry-one-bend-probe.log`). Le chemin de0,8m partage0,160000001m² avec le vrai passage, ne traverse ni corps au-delà de ce passage ni solide ; résidu booléen hors droits6,821×10⁻⁹m². Ce résultat porte sur ce témoin, pas sur tous terrains ou accès.

## Raccord de production éprouvé sur les témoins figés

Le constructeur est extrait dans le module privé `plans::native_one_bend_access`. `proposed_native_access_with_entry` l’appelle **après l’échec de toutes les connexions droites**, y compris la réparation analytique du contact. Une proposition par accès éligible, sans échantillonnage du coude ; les accès conservent leur tri distance/ID et la borne existante64. Une réussite droite reste prioritaire et inchangée.

Le nouveau contexte optionnel arrive exclusivement de la préparation native déjà éligible. Il fournit le corps **local exact** et la porte corporelle ; toutes les autres voies passent `None`. Ouverture, passage, largeur et niveaux corps/site doivent être exactement identiques, largeur finie≥0,8m et niveaux d’entrée/sortie strictement égaux. Aucun portail de remplacement, porte de périmètre distincte, escalier, profil, pin, mode ou choix architectural nouveau n’est introduit. La pose et les dimensions sont conservées.

La première branche est normale à la vraie porte ; la seconde normale au segment de rue. Le coude est l’intersection du premier rayon avec une droite d’appui parallèle à la seconde branche, décalée d’une demi-largeur des corps et solides réels. Le joint en onglet plein garde les deux bandes de0,8m ; une inversion, un joint consommant un cap ou un cap sortant du vrai segment entraîne un refus. Aucun recul arbitraire ni coordonnée11976 n’est codé dans le constructeur. Les métadonnées géométriques du probe sont `cfg(test)` ; la production conserve seulement surface et contact.

Les gardes mondiales sont **les mêmes** que pour les droites : cadastre hors réserves/occupation ; passage natif entier prévalidé ; intersection passage-solides≤0,0001m², chemin-solides<0,0001m², pénétration de corps hors passage<0,002m², recouvrement chemin-passage>0,005m². Murs réellement coupés, poteaux et murs mitoyens restent des obstacles. La circulation renvoyée inclut le passage complet. Le chemin suit ensuite le reste de `visual`, dont les contrôles de toit ; il ne devient jamais une assise nivelée.

## Vérifications ciblées

Trois tests ciblés dans `native_one_bend_access_tests.rs` :

- Largeur des deux branches/joint et appartenance des caps aux segments ; refus parallèle, segment trop court, joint consommant un cap.
- Cas de coude causal : droites refusées, coude admis ; refus réserves, voisin, poteau, autre corps, portes distinctes et transition de niveau. Une réussite droite ajoutée reste exactement identique avec/sans contexte.
- Témoin11976 original : préparation structurelle inchangée, ancienne voie droite toujours refusée, upgrade au même emplacement, source/corps/toit/appuis/aire inchangés, archive puis extérieur **et** intérieur requis.

Le probe historique reste disponible ; il demande explicitement la voie droite sans contexte pour conserver son constat initial, puis contrôle manuellement le constructeur partagé. Le test d’intégration utilise la vraie voie finale. Root a compilé et exécuté les tests ainsi que les replays ci-dessous ; la présente mise à jour ne lance aucun Cargo, serveur ni rejeu natif.

## Résultats CLI conservés

Source : `web/out/native-entry-one-bend-cli-proof/replay/report.json`, capture du23octobre2026 à00:19:53UTC. Exécutable figé `native-entry-one-bend-cli-proof/plan_replay.exe`, SHA-256 `816c40cceae0b02280470846bb80d0e546868d507093a294f5f5db6194a50189`. Les trois hashes de plans ont été relus et vérifiés contre le rapport ; aucune sortie n'a été régénérée.

| Échantillon figé | Plans admis/refusés, avant→après | Entrées natives retenues après | Différées / hors périmètre | Poses des réussites |
|---|---|---|---|---|
| Principal128 | 125/3 →125/3 | 83/101 éligibles | 18 /24 | 83 sur pose1 |
| Secondaire128 | 111/17 →111/17 | 68/83 éligibles | 15 /28 | 67 sur pose1, 1 sur pose2 |

Sur les deux échantillons : aucune perte ni nouvelle admission de plan, aucun changement de source/style, d'aire, d'architecture locale ou de pose par rapport aux bases de comparaison. Les audits relus ne signalent aucune violation de droits ou de terrain natif. L'écart maximal de cote d'assise est respectivement1,413×10⁻⁹m et1,150×10⁻⁹m. Ces entrées ne sont pas des intérieurs certifiés pour les256 demandes : seuls les huit témoins détaillés ci-dessous ont été enrichis. Les durées natives des deux replays uniques sont402ms et442ms ; elles ne constituent pas la comparaison de coût répétée.

Les huit demandes de `native-foundation-detail-proof/requests.json` produisent8/8 plans,8/8 extérieurs et**7/8 intérieurs**. Le coude11976 (`53c6fbc1ac486b3b`) apporte l'intérieur supplémentaire par rapport aux six entrées précédemment démontrées. Le témoin11111 (`e099cf700f812cc3`) conserve un refus intérieur explicite : `Native interior entrance differs from the retained planning connection. City plan preserved; detailed site admission is required.` L'exécution des huit plans prend39ms, sans inclure leur enrichissement détaillé.

La planche `native-entry-one-bend-cli-proof/11976-before-after.png` et son manifeste JSON utilisent les mêmes cadastres/caméras. L'aire du corps11976 reste214,271518m² et sa pose reste origine(9038,705433 ;8193,265254), angle16,302068°. Seuls le raccord et le portail retenu changent ; l'extérieur était déjà valide et l'intérieur devient valide. Il s'agit d'une planche issue des géométries exportées, pas d'une capture de la ville en cours.

## Coût mesuré indépendamment

Source : `web/out/native-entry-one-bend-cost-proof/report.json`, cinq exécutions alternées avant/après des mêmes128 demandes principales. Le calcul natif exclut démarrage du processus et sérialisation JSON. Les sorties sont identiques à chaque répétition **dans chaque phase**, sans prétendre identité avant/après des nouveaux raccords.

| Phase | Temps natifs des cinq passages (ms) | Médiane | Intervalle |
|---|---|---|---|
| Avant coude | 402,398,394,401,392 | 398ms | 392–402ms |
| Après coude | 394,403,395,403,397 | 397ms | 394–403ms |

L'écart de médiane est−1ms (−0,251%), dans la dispersion observée : **aucune accélération générale n'est démontrée**. Le nombre d'entrées retenues de ce même jeu passe79→83, les125 admissions et3 refus restent identiques. La base avant est le CLI `roman-b13-cli-proof/plan_replay.exe` (SHA-256 `71c3cce56846cab53147a2efd1a8095c5588be56e2efdbe5378d32e663d4e435`), la base après est celle du rapport de replay ci-dessus. Ces mesures ne portent ni sur l'UI, ni sur une ville entière, ni sur une population d'un million.

**Étape distincte encore ouverte :** le choix d'un autre portail déjà construit pour11111, après échec des poses canoniques, fait l'objet d'un patch et d'une vérification de persistance de son occupation. Les chiffres et hashes de cette note précèdent cette étape et ne la valident pas. En particulier, ne pas annoncer8/8 intérieurs ni une livraison définitive de ce repli avant son nouveau test et sa preuve CLI.

Limites : la droite d’appui globale est conservatrice, un coude ne couvre pas tous les obstacles/cours et la borne64 peut laisser des accès inexplorés. Aucune pente de marche, conformité d’accessibilité ou capacité d’habitants n’est certifiée. Une nouvelle géométrie autorisée reste un résultat mesuré à valider, sans promesse générale.
