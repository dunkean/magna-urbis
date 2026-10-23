# Entrées natives des maisons Single — audit ciblé, 23 octobre

Lecture du code et des cinq sorties figées seulement. Aucun Cargo, moteur, nouvelle génération ni modification de Rust. **Les cinq échecs sont des discordances entre portail natif et proxy, pas des échecs de construction des intérieurs.** Leur raccord physique au site à pose inchangée reste à essayer ; ce document ne préjuge pas cinq succès.

## Preuves exactes

Tous les IDs ci-dessous ont le préfixe `layout-f9dab5910f08a8a2/` et le suffixe `/building`.

| Bloc/parcelle | Source retenue | Corps réel local | Niveaux | Résultat figé |
|---|---|---|---:|---|
| `block-49047fc2c0e0dbed/parcel-4100d63eb878ede1` | AS-ISL-B15/default | 5 × 26 m, 130 m² | 1 | extérieur OK, intérieur refusé |
| `block-9a059faeb43716b0/parcel-a416b05f397c3d2c` | AS-ISL-B15/default | 5 × 26 m, 130 m² | 1 | extérieur OK, intérieur refusé |
| `block-48fe952f81e056e8/parcel-a7029f26afac0cdd` | AS-ISL-B15/default | ≈7,105 × 8,016 m, 56,95368 m² ; origine locale ≈3,213/10,678 | 1 | extérieur OK, intérieur refusé |
| `block-0d3568179998c859/parcel-d85568ded9431341` | MED-ANT-B01/flat_earth | 8,275 × 12 m, 99,3 m² | 1 | extérieur OK, intérieur refusé |
| `block-606c37543ad80a65/parcel-b717fcd8e58837c7` | MED-ANT-B12/default | 4,5 × 7 m, 31,5 m² | 2 | extérieur OK, intérieur refusé |

Sources : `web/out/java-source-aspect-proof/{three-requests,before-three-plans,before-three-details}.json` et `web/out/native-entry-existing-door-cli-proof/{small-roman-plans,small-roman-details}.json`, avec demandes `web/out/roman-b13-cli-proof/small-roman-requests.json`. Il s'agit des états expressément demandés, pas du rejeu Java après correction d'aspect.

Les cinq archives ont `entrance:null`, un corps Ground/Walled/Single/FP-RECT, aucun vide ni cellule, niveaux sans débord, cour et chemin natifs vides, aucun feature de plan. Demandes automatiques inspired/domestic, recette et variante non imposées, aucun override. Les trois Java n'ont aucun détail ; B12 a `masonry_joints` et `shopfront` ; B01 a `masonry_joints`, `hearth`, `parapet`, `scupper`. Les deux Romains ont un contexte synthétique `Street` seulement, aucun obstacle contextuel.

Attention a702 : ses paramètres nominaux restent 8 × 13 m, mais son corps adapté a les dimensions/offsets du tableau. Toute préparation doit consommer le `BodySpec` retenu, pas reconstruire un rectangle nominal.

## Cause dans le code

1. `engine::prepare_foundation` (`engine.rs`, vers 1131) impose `p.layout == Layout::Strip` dans `supported_parameters`, puis la même condition à chaque corps. Single est `Unsupported` avant tout `structural_unit` ou `prepare_plan_entry`.
2. `plans::retain_final_native_entry` (vers 2403) retourne immédiatement si les diagnostics ne contiennent pas `Native ground-strip foundation:`. Aucune des cinq maisons n'atteint donc la préparation du vrai portail. Ce n'est pas un échec d'accès mesuré ni une limitation déclarée par la source.
3. `access::plan_entry::prepare_plan_entry` est fondé sur les vrais niveaux, portails, passages et murs ; il ne contient pas lui-même d'interdiction de Single. Il réutilise `structural_access`, puis vérifie les passages contre murs coupés/Post/PartyWall. Sans enceinte, body/site portal sont identiques. Les commentaires Strip désignent son périmètre d'appel actuel.
4. `realize_plan` (vers 3118–3178) appelle d'abord `enrich_architecture`, puis vérifie le toit, puis exige un milieu de portail racine à moins de 1 mm du point `PlanBuilding.entrance`. Les cinq rapports échouent précisément à cette dernière comparaison. Leur construction native, accès interne et éventuels escaliers ont donc déjà réussi, mais avec le portail librement choisi puisque l'archive ne retient aucune entrée. Déplacer ce portail vers le proxy ou supprimer ce contrôle fabriquerait un certificat.

## Plus petit raccord proposé

**Une préparation finale Single, à la pose déjà admise, sans modifier le parcours d'admission initial.** Garder `prepare_foundation_domains` et toutes ses utilisations de recherche identiques. Autoriser le sous-ensemble Single uniquement dans le wrapper opt-in `prepare_foundation_and_entry` (`with_entry=true`) ; conserver le code Strip existant.

- Périmètre : automatique inspired domestic/mixed, sans pins/overrides/strict/exact/empreinte imposée/parcel_fit=false ; un vrai corps rectangulaire entier Ground/Walled à z=0, sans voids/cells/jetty, mêmes empreintes aux niveaux, aucun enclos/galerie/support ouvert/programme complexe. Contrôler les paramètres **et** le plan retenu. Contexte vide ou Street seul ; les contextes obstacle demandent leur contrat propre.
- Préfiltre final peu coûteux, à partir du type de source et du nombre de volumes, puis décompression du seul final éligible. Ce préfiltre n'est pas une preuve : validation stricte des paramètres/corps après unpack. Ne pas invoquer la construction native dans chaque slot de budget ni ajouter des marqueurs « fondation certifiée » à un simple candidat.
- Construire une seule unité structurelle et un seul graphe d'accès, réutilisant la préparation existante. Contrôler occupation complète (corps + tout feature produit + passage), vraie assise, solides, cadastre/réserves/voisins, pente/eau, toit et raccord public. Utiliser les raccords droits/analytiques/coude déjà bornés ; pas de nouvel algorithme parallèle.
- Essayer **uniquement la pose finale existante pour Single** dans cette première tranche. Ni dimensions, ni seed, ni source, ni orientation ne changent. Une réussite retient `body_entry` dans `CompactArchitecture`, son passage/raccord dans la circulation exportée et le vrai milieu en entrée. Un échec garde exactement la maison précédente et ajoute une raison explicite de report. Les trois poses de repli Strip restent inchangées.
- Aucun intérieur ni mesh n'est construit à cette étape. Coût ajouté : un structural unit + graphe + validation/pack sur un final éligible, pas sur toutes les tentatives. Aucun gain de temps revendiqué avant mesure ; pas de cache global.

### Détails romains : ne pas élargir une catégorie entière

B12 ne nécessite aucun nouveau trait : `masonry_joints` et `shopfront` produisent des `DecorativePanel` par `wall_marks`, déjà admis pour Strip. Ses deux niveaux ne prouvent pas à eux seuls que la future entrée retenue sera compatible avec le palier ; le détail doit le vérifier.

Pour B01, l'extension littérale `hearth`/`parapet`/`scupper` peut rester distincte et conditionnelle au test natif. `parapet`/`scupper` appellent `roof_trait`, qui vérifie la compatibilité du toit sans ajouter de structure au sol ; la construction réelle du parapet appartient au toit. `hearth` appelle `domestic_fitting`, qui place un foyer de 0,16 m dans le sol libre d'une pièce ; il ne change ni corps ni appui externe. Il est absent de la préparation sans pièces et doit rester présent au détail. Le passage conservé doit toujours passer les contrôles de reconstruction et ne donne aucune certification supplémentaire sur l'ameublement. Ne pas autoriser arbitrairement tout `DecorativePanel`, toute feature ou tout détail Single.

La solution ne requiert pas une nouvelle règle de toit plat : B01 passe déjà la comparaison de toiture à la pose figée. Cette réussite ne dispense pas de refaire le même garde sur la version enrichie avec portail retenu.

## Validation minimale proposée après accord

Un test d'intégration sur ces cinq plans retenus : préparation native puis visual à **transform identique**, égalité source/variante/seed/dimensions/empreintes/toits/niveaux, conservation du passage dans l'occupation exportée, archive→extérieur et archive→intérieur. Rapporter les refus éventuels sans déplacer les maisons. B12 vérifie son escalier ; B01 vérifie foyer et parapet conservés. Ajouter un négatif passage hors cadastre/obstacle réel et une preuve que pins/strict/overrides gardent l'ancien chemin. Aucun taux de ville ni capacité ménage ne se déduit de ces cinq cas.

Empreintes des preuves :

```
before-three-plans.json   10f7cc98c6c1e1e015b8c6384b843f7f9bc33893934fe534c051e88f372195c2
before-three-details.json 0cb1ad183feacea8dbff88b5c6b0bc7c98b26d51941efbf11793ae18394e0388
three-requests.json       1e9ed63f5f6c851921ba7ad25418c9cd7f2f3a95f5032e443ac295c6af4c3c00
small-roman-plans.json    4d382db04625e0b6aa1d088970d814753fc8a15fe3d4b92c2d6e7c7b980657d5
small-roman-details.json  90010c3b88b59dbefb2bf05ce7ea3be0b662e8e9814d5d098ee7a798b0ac4882
small-roman-requests.json dffb9f0f0cf31474be059b2dd5f8f9a2d1b352ff0fa8cc02a2d59e5c7561c16d
```

## Raccord source préparé après autorisation

Implémentation bornée dans `engine::single_native_entry_parameters`, la branche `with_entry` de `prepare_foundation`, et `plans::retain_final_native_entry`. Le wrapper sans entrée refuse toujours Single ; aucun slot de budget n'appelle une construction additionnelle. Les Strips gardent leur ordre de poses/portes, sans préfiltre catalogue supplémentaire.

La première tranche autorise seulement Gable/Hip, détails vides ou `masonry_joints`/`shopfront`, aucun feature natif supplémentaire, contexte vide ou Street. **B01/flat_earth reste Unsupported** : ses trois détails supplémentaires et son toit-terrasse ne sont pas activés dans cette livraison. Pour Single, un échec de préparation ou de full visual à la pose existante garde l'ancien plan ; aucun repli de pose ni porte alternative n'est consommé. Les erreurs de droits restent explicites. L'archive conserve le portail canonique réellement construit.

Fixture nouvelle : `rust/crates/houses/tests/fixtures/single-native-entry-five.json` (5 couples demande/plan, 92 307 octets, SHA-256 `8880f84b217d27604f75c141d063c1de7108270723eb33ff2c274d6a6dfb4b0e`). Ses métadonnées reprennent les empreintes des sources ci-dessus. `single_native_entry_tests.rs` couvre préparation opt-in seulement, conservation physique/locale et détail de chaque succès, négatif sur le palier externe réellement construit, modes/pins/overrides/exact et cour/galerie hors périmètre. Le test exige un vrai succès au minimum, sans transformer un ensemble de reports en preuve fonctionnelle.

Validation à cette étape : formatage du nouveau test et contrôle d'espaces uniquement. **Aucun Cargo ni exécution native par cet agent ; résultats des quatre candidats pris en charge encore à mesurer par la compilation coordonnée du parent.**

### Comparaison des snapshots numériques

La première exécution coordonnée a révélé deux écarts de représentation distincts, sans changement de l'architecture locale ni de la pose. Le littéral mondial `9461.814304288533` est lu `9461.814304288531` par le lecteur JSON historique : un ULP, alors que l'archive locale conserve ses bits. Les coordonnées des snapshots se comparent donc à un ULP, avec topologie, source, archive et pose exactes.

La cote de sol du témoin a416 passe de `161.18237997802393` à `161.18237997404916` (environ 3,975 nanomètres). Ce scalaire est dérivé : l'ancienne voie évalue le domaine projeté ; la nouvelle unit les appuis projetés avant leur intersection avec les cellules du raster. Le test ne traite plus ce calcul comme une simple lecture JSON. Il recalcule l'assise native avec les mêmes données décodées, exige l'égalité exacte de la nouvelle cote, de la fondation et des niveaux avec ce calcul, puis borne séparément leur écart à l'ancien snapshot à `1e-8 m`. Aucun seuil de validation géométrique, d'accès ou de terrain n'est modifié. La nouvelle compilation coordonnée reste l'autorité pour le résultat du test.
