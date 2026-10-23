# B13 — source native validée et admission publiée

**Résultat root, 23 octobre02:07.** Les3tests B13 passent : les six témoins min/max à2/3/4niveaux gardent leurs corps, pièces et escaliers accessibles, archives et extérieurs ; les refus strict/étage incompatible/lot trop étroit restent explicites. Les10tests catalogue passent. Les intérieurs autonomes réussissent mais les six fixtures urbaines épinglées conservent un écart d'entrée de1,05m, refusé au détail urbain ; ceci n'est pas une certification de raccord ou de population.

Export natif publié dans `rust/crates/houses/data/urban-admission.json` : **225profils/421styles**, SHA `f9bbb5b4df9b18cf3a869cde96989075dce467a560c9e141a3b1363c362486ec`. Les224profils/418styles anciens sont exacts et dans le même ordre ; les trois nouveaux témoins minimaux B13 sont `supported`. `optional` du composant est vérifié selon sa définition native `count[0]==0`, car ce champ dérivé ne figure pas dans la source brute. Aucune autre exception au comparateur.

CLI et preuves : `web/out/roman-b13-cli-proof/{build-proof,publication,corpus-equivalence}.json`, `roman-b13-emission-proof/admission-comparison.json`, tests `web/out/roman-b13-{native,catalogue}-test.log`. Les deux corpus128 et le golden restent identiques octet par octet. Le helper `masonry_joints` et le raccord public B13 font l'objet de tests supplémentaires distincts. Aucun serveur, core ou benchmark de ville lancé dans cette tranche. Les sections ci-dessous conservent le protocole et les constats de préparation avant ces résultats.

23 octobre 2026. Après GO root et gel de la comparaison d’accès ordonné (256 plans, admission et golden identiques), **MED-ANT-B13 a été émise** par les deux scripts normaux. Catalogue actif : **266 recettes / 421 styles**, couverture349. Aucun Cargo, CLI natif, serveur ni export admission lancé par cet agent. Root possède la compilation des trois tests B13 copiés dans la crate.

## Périmètre effectivement ajouté

`MED-ANT-B13::default`, `::three_storeys`, `::four_storeys` : un seul corps `Strip/FP-RECT`, respectivement2/3/4 niveaux, hauteur artistique2,8m, routes adjacentes et composant `main` cohérents avec chaque bundle. `urban_frontage_infill=false` conserve la cour arrière et le passage, sans ailes burgage ; pas de galerie, shopfront ni `multiple_households`. Rôle `communal_dwelling`, tradition `roman_urban`, `inspired_only=true`, èreA sans datation exacte, confiance stylized. Aucune capacité d’appartements, ménages ou habitants n’est déclarée.

Largeur nominale6,5–10m et profondeur10–18m : corps `(W−1,25)×0,75D`, soit39,375–118,125m² àsize1 sans extension. Ces valeurs, les étages et le poids artistique25 ne sont pas des mesures ou fréquences historiques. La [source documentée](../docs/sources/roman-compact-domestic-architecture.md) conserve cette distinction, les références archéologiques et le programme non certifié. Aucun filtre culturel exclusif ajouté.

## Identité de la baseline et comparaison

La sauvegarde immuable `roman-b13-emission-proof/before/` contient les trois données, deux scripts, mapper, trois documents sources et test de couverture. `baseline.json` conserve dix checksums et les empreintes exactes des265 recettes, B12 et Java incluses.

| Donnée | Avant | Après émission |
|---|---|---|
| recipes.json | `d40912165c2d1b55fb0196de804df404d8e546409e963d125d7afcf876719393` | `2bfac9ffe776e3284affce17afa1abf67eae9378b822125cd3c4764f44715aaa` |
| source-inventory.json | `aa391f01f47796647b86ef4fe66c468e829552c0f4a748c3dad113d091bac4f9` | `9e9bebf730b58cf20dec294787b8d959391ed38ff408ffc80fcdf8a6c39817ef` |
| urban-admission.json | `5d9e96fd6a6d5b91adabde61d073c60f0ac36df8259372f41322126e6eea25cc` | **Inchangé**,224 profils/418 variantes ; futur export requis après preuve native |

`check_roman_b13_emission.py compare` : **PASS**,265 anciens objets et418 anciens styles identiques sans epsilon, ordre préservé ; seuls B13 et ses trois styles ajoutés. Anciennes entrées sources/couvertures exactes, et seuls les hashes du mapper et du document romain évoluent. Les deux scripts `--check` passent. `comparison.json` et `emission.json` enregistrent les résultats/fichiers. Le comparateur a aussi refusé une variation de10⁻²⁵, une permutation et une suppression (`checker-guards.json`). Il ne masque aucun changement de géométrie ancienne.

Fichiers livrés : `house-recipes.py`, mapper, document source romain, `source-inventory.json`, `recipes.json`, `tests/catalogue.rs` (348→349), `tests/roman_b13_data.rs`. Le script source lui-même est inchangé. `access.rs`, `engine.rs` et `plans.rs` n’ont pas été modifiés dans cette tranche.

## Validation native distincte de l’émission

Les trois tests B13 préparés par morphology sont maintenant dans la crate : minima6,5×10m et maxima10×18m pour chaque variante àsize1/parcel_fitfalse ; source/components/routes/compact/extérieurs/intérieurs autonomes ; refus strict, default+override4 et site trop étroit. Ils doivent prouver pièces Communal et escaliers réels du **même Resolved**, sans rétirage. Après le premier échec de compilation, les champs privés du Resolved sont désormais inspectés via sa sérialisation et des Parameters/Surface typés, sans changer la visibilité moteur ; la copie proposée est synchronisée. Tous les invariants restent présents. Leur exécution reste à root ; aucune réussite native B13 n’est encore annoncée.

Le raccord intérieur urbain reste une preuve différente : les pins explicites des témoins restent hors upgrade automatique d’entrée ; morphology traite séparément le support du détail `masonry_joints`. Le test distingue un intérieur autonome valide d’un éventuel refus exact d’entrée conservée, avec écart mesuré ; toute autre erreur échoue. Le checker CLI de morphology exige explicitement `architectural-plans-2`, `houses-3`, le catalogue courant et les deux détails réussis. Ne pas supprimer un détail, réétiqueter un vieux compact ou relâcher une garde pour obtenir un résultat.

Après validation : candidat admission séparé attendu **225 profils /421 variantes**, anciens224/418 objets strictement conservés et source_sha256 aligné sur le nouveau recipes.json. Ce futur export n’est pas encore autorisé par la preuve DATA seule. Aucun benchmark de ville ni nouvelle capacité de population n’est déduit de cette émission.

Le script `prepare_roman_b13.py` est une préparation **avant émission** qui exige265 recettes ; ne plus le lancer sur la baseline active. Les preuves proposées historiques restent archivées. Pour vérifier la sauvegarde ou la comparaison DATA :

```powershell
python _agents_blackboard/check_roman_b13_emission.py verify-baseline
python _agents_blackboard/check_roman_b13_emission.py compare
```

## Comparateur du futur candidat admission

`check_roman_b13_admission.py` est prêt en lecture seule :224 anciens minimums et418 anciens styles conservés exactement et dans leur ordre ; uniquement B13/default ajouté aux minimums et B13/default/three_storeys/four_storeys aux styles. Aucun epsilon, aucune migration de version ni de registre autorisée. Le hash recettes doit correspondre aux266 recettes actives, dont les265 anciennes sont à nouveau vérifiées.

Les nouvelles fiches doivent garder mode inspired, tradition/ère, rôle, dimensions/étages et contraintes de chaque bundle, graines natives distinctes et mêmes mesures pour default dans les deux tables. `household_range=null` et `placement_certified=false` sont exigés. Un nouveau témoin refusé doit rester explicite ; le rapport le signale et ne vaut jamais autorisation de publication ni preuve d’intérieur. Aucun export candidat réel n’a encore été comparé.

```powershell
python _agents_blackboard/check_roman_b13_admission.py CHEMIN_DU_CANDIDAT.json
```

Quatre garde-fous passent : ancien export224/418 rejeté, variation de minimum ancien10⁻²⁴ rejetée, supported→refused ancien rejeté, suppression de style ancien rejetée. L’admission canonique reste strictement inchangée (`admission-checker-guards.json`). La comparaison finale et toute copie attendent la validation native et le GO root.
