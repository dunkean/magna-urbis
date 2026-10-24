# Paramètres / UI — responsable Codex parameters_ui

23 octobre 2026. Tranche1 en préparation isolée uniquement, coordonnée avec root et le responsable maisons. Aucune mutation des sources produit pendant le gel de la suite frontend.

Périmètre réservé pour la proposition : `rust/bridge/urbanConfig.ts`, `rust/crates/core/src/urban/programme.rs`, `roles.rs`, `footprint/capacity.rs`, validation d'entrée `urban/mod.rs`, nouveau module `programme_functions.rs`, contrôles du programme dans `web/src/ui/urbanBuildingsPanel.ts` et nouveau helper de contrôles. Le responsable maisons touche d'autres régions du panel pour le rapport natif : fusion de régions obligatoire, aucune copie d'un ancien fichier complet sur le panel final.

Tranche : distinguer intention isolée et fonctions combinables pondérées, réellement consommées par le programme et les services ; conserver exactement l'ancien comportement quand `functions` est absent. Objet vide explicite = pas de spécialisation, sans réactiver une ancienne vocation exclusive. Les six poids finis sont bornés à[0,1] et les clés inconnues sont rejetées.

Invariants approuvés par root : effet commun commerce/port/capitale combiné par maximum ; intensité quantifiée des ateliers, stocks et services ; seuils politiques graduels ; nombres de services arrondis vers le bas ; minima fonctionnels80/180m² conservés même à faible poids positif. Intention isolée prioritaire et fonctions urbaines non applicables explicitement indiquées. La navigation déclarée reste une déclaration utilisateur, pas une certification physique ; aucun port/eau fictif. Un besoin portuaire non réalisable reste demandé et déficitaire.

Les nouveaux poids s'appliquent aussi à l'estimation foncière amont ; l'ancienne branche reste identique sans `functions`. UI : toutes les intentions isolées existantes, mode automatique ou combinaison, poids et effets visibles, synchronisation/appliquer/reset/serialization communs. La classification démographique, la plausibilité historique culture×époque×échelle et la décomposition des profils culturels restent des tranches suivantes ; aucune clôture globale de la section TODO n'est revendiquée ici.

Pas de Cargo, serveur, navigateur ni campagne lourde par cet agent. Root centralise les tests et la promotion.

Proposition préparée : `web/out/city-programme-functions-workspace/`,17fichiers produit proposés,15tests frontend +6core +1statutlocal non exécutés, garde locale/WASM avant tout upload/génération explicite. `functions:null` est omis seulement du payload natif pour les anciens moteurs ; les objets vides/poids zéro restent explicites. Le script UI existant conserve ses alias `--role`. Le panel est rebasé sur le bilan natif V2 promu (base79ab9d…), sans écriture du produit. Snapshot initial324sources conservé ; baseline native v2 récupérée uniquement avec SHA exacts. Source code et manifests Cargo/fixtures sont fournis pour les validations root. La source vivante d'Opus a changé dans `building_sites.rs` : rebase et retest actuels impératifs avant toute promotion.

Gel V2 isolé : `web/out/city-programme-functions-workspace-v2/`. Root a exécuté V1 :35 tests frontend/5fichiers et6tests core PASS ; typecheck V1 arrêté sur deux tableaux de cas hétérogènes. V2 annote uniquement ces tableaux `Record<string, number>[]` dans le test transport, conserve tous les cas et ne touche aucun contrat produit. Le runner pointe désormais sur V2. Aucun test lancé par parameters_ui. ManifesteV2 SHA256 `de89f22e1e4db503ee2b01df19b78a6c16d78768f4ca5bdfacc5d3712275e7c0`, patchV2 `119f1b6574bc0361b259c66c9dd6387f22c7dff90aa6690aa18fbf7fb45a45d4`. Gel V1 laissé intact. Lock initial exact33fbd15d… et lock normalisé après le run core V1 655d86e3… conservés séparément sous `root-run-lock-normalization/` ; V2 repart du lock initial. Root reste responsable des validations local/WASM/parité30cas et du rebase actuel avant promotion.

## Réservation intégration produit — 2026-10-23T13:04:11.146540+00:00

Root autorise la promotion en trois voies du delta functions V2 après35tests frontend,6core et parité30cas legacy byte identiques,4explicites. Réservation exclusive temporaire des17fichiers listés ci-dessous ; aucune exécution de test/Cargo/moteur/serveur/navigateur par cet agent. Les ajouts Opus et le bilan natif UI sont conservés, les autres axes taxonomiques restent ouverts.

- `rust/bridge/urbanConfig.ts`
- `rust/bridge/urban.ts`
- `rust/bridge/urbanProgrammeSupport.ts`
- `rust/crates/core/src/urban/mod.rs`
- `rust/crates/core/src/urban/programme.rs`
- `rust/crates/core/src/urban/roles.rs`
- `rust/crates/core/src/urban/footprint/capacity.rs`
- `rust/crates/core/src/urban/programme_functions.rs`
- `rust/crates/core/src/urban/programme_functions_tests.rs`
- `rust/crates/local/src/main.rs`
- `rust/crates/local/src/urban_source_tests.rs`
- `rust/crates/wasm/src/settlements.rs`
- `web/src/ui/urbanBuildingsPanel.ts`
- `web/src/ui/urbanProgrammeFunctions.ts`
- `web/tests/urbanProgrammeFunctions.test.ts`
- `web/tests/urbanProgrammeFunctionsTransport.test.ts`
- `web/scripts/urban_buildings_ui_check.mjs`

**Intégration produit terminée — sources uniquement.** Les17fichiers functions V2 ont été promus après comparaison des3sources exactes et merges propres ; aucune dérive sur les bases de promotion. Les5évolutions core externes (building_sites, network, cadastral_tests, occupation, parcels) restent byte identiques ; les3ajouts bilan natif du panel sont conservés depuis sa base79ab9d… . Les backups/patch/manifests avant-après/diffs explicatifs sont dans `web/out/city-programme-functions-production-delivery/`. Manifeste après SHA256 `b9ebf5f337db8d055a1ebdc57c2ad97d8b5cc8304fb441d2a91327152b80dde4`. Aucun Cargo/test/serveur/navigateur exécuté par parameters_ui, aucun runtime ou lock promu. Root valide les sources produit ; commandes dans `DELIVERY.md`. Réservation de publication levée ; coordonner les prochains deltas sur ces nouvelles sources. Les autres axes taxonomiques TODO restent ouverts.

## Tranche démographie / morphologie — copie isolée

Réservation du delta proposé seulement : `rust/crates/core/src/settlements/mod.rs`, `rust/crates/core/src/urban/kinds.rs`, `rust/bridge/urbanConfig.ts`, `web/src/gen/options.ts`, `web/src/ui/settlementKinds.ts`, `web/src/ui/terrainSettlements.ts`, `web/src/ui/terrainUrban.ts`. Nouveaux fichiers : catalogue démographique JSON, module Rust demographics, bridge TS settlementDemography, helper UI urbanMorphology, tests frontières/persistance. Aucune modification produit. Classes démographiques canoniques inchangées ; seuils morphologiques culturels préservés. Sélecteur des11grammaires rendu accessible ; rapport strictement lié au programme/config/archetype retournés. Les thèmes et politiques historiques restent hors lot. Root centralise tests/moteurs.

**Gel démographie/morphologie prêt** : `web/out/city-demography-morphology-workspace/`.13fichiers proposés,9tests frontend et5tests natifs préparés/non exécutés ;1176inputs hashés. JSON des classes réellement consommé TS/Rust/shortcuts,11grammaires et2préférences exposées dans le vrai panneau, retour automatique branché, rapport retourné préservé dans le regroupement CityBench. Correctif limite100k/raccourci250k inclus. Aucune population ni seuil morphologique modifié ; imports anciens sans preuve restent inconnus ; formes forcées sans certification historique. Manifest SHA256 `0c23daf1eff32b25c3623ac7e0d79b81d6c4873867cbeb07151494e9d409ab96`, patch `d45fb49a90ddae1ce56bf7eabb4d3a0cb13a25253ed8dd76910d0d062b23f29d`. Aucune source produit modifiée ; root centralise tests et rebase/promotion. Commandes dans PROPOSAL.md.

## Réservation promotion démographie/morphologie — 2026-10-23T13:52:58.279267+00:00

Root valide43tests frontend,5natifs et typecheck isolé. Intégration autorisée des13deltas ci-dessous par3voies ; préserver housing-floor/functions/insular/Opus. Aucun test ni runtime par parameters_ui.

- `rust/crates/core/src/settlements/mod.rs`
- `rust/crates/core/src/urban/kinds.rs`
- `rust/bridge/urbanConfig.ts`
- `web/src/gen/options.ts`
- `web/src/ui/settlementKinds.ts`
- `web/src/ui/terrainSettlements.ts`
- `web/src/ui/terrainUrban.ts`
- `docs/CITY_VARIATION_VARIABLES.md`
- `rust/crates/core/src/settlements/demographic_classes.json`
- `rust/crates/core/src/settlements/demographics.rs`
- `rust/bridge/settlementDemography.ts`
- `web/src/ui/urbanMorphology.ts`
- `web/tests/demographicMorphology.test.ts`

**Promotion démographie/morphologie terminée — créneau libéré.**13deltas intégrés en source après merges propres et contrôle de patch0. Aucune dérive des bases réservées, aucun Cargo/lock ou runtime promu. Preuves : `web/out/city-demography-morphology-production-delivery/`, manifeste après SHA256 `4d1a6fd72ec315d37ea1ff2b1d572cd5f661f9e472c2133bdb8ee99d12407a36`.12dérives externes expliquées et préservées ; occupation.rs a reçu pendant l’intégration une troisième trace OCC_DEBUG externe, fichier jamais écrit par parameters_ui. Contrat housing-floor/functions/insular conservé. Commandes produit et limites dans DELIVERY.md. Aucun test/moteur/serveur/navigateur lancé par cet agent ; root valide maintenant l’ensemble intégré. Autres axes taxonomiques TODO ouverts.

Réservation courte `settlements/demographics.rs` : consommer shortcut dans la validation du catalogue au chargement, sans nombres/JSON/TS modifiés et sans allow. Root centralise compilation/tests.

**Petit delta shortcut livré, réservation levée.** Un seul fichier produit : `settlements/demographics.rs`. Le chargement du catalogue valide désormais que chaque raccourci reste dans sa classe, donc champ réellement lu en production. JSON/nombres/TS et tests de table inchangés, aucun allow. Preuves : `web/out/city-demography-shortcut-validation-delivery/`, SHA après `31e2f67420a59a580c51e07c1b1c22d060a8e3a1d92be80fdd57e7d9d78641e3`. Aucun Cargo/test exécuté par parameters_ui ; root vérifie. Créneau libéré.

## Codex parameters_ui — réservation performance programme (isolé)

2026-10-23T14:40:17.337694+00:00. Root confie la régression médina5k sur fixture Java. Je réserve uniquement une proposition isolée sur `urban/programme.rs` + instrumentation locale de réservations ; aucune source produit modifiée. Le contrôle `area > 4*target` existant intervient après contact_envelope/recipe_foundable : préparation du même filtre en amont, A/B ordre legacy/anticipé, sans réduire les recherches/admissions ni changer RNG/demandes/allocations. Snapshot cohérent : `web/out/city-reservation-bounds-workspace/` ; root compile/mesure, aucun moteur/test/Cargo lancé par moi. Merci de conserver cette région jusqu’au rapport ; Opus reste libre sur ses fichiers sans remplacement par le snapshot.

**Gel optimisation réservations prêt, non exécuté** : `web/out/city-reservation-bounds-workspace/`.3fichiers produit proposés (programme + trace locale +3tests), baseline originale311sources, vrai fixture OpusJava et dérivésmédina5k/50k figés. Même borne `area(&b.shape)>4*target` avant recherches coûteuses ; aucune coupe, recherche, RNG ou cache nouveau. A/B ordreoff/on + traces causales désactivées par défaut + comparaison byte complète layouts/parcelles/allocations. Manifest SHA256 `e4558c76b7428ed29327b289be7b28973d00832d02e54decefbc396dc70cfdf5`, patch `b2be5c31c6726306770ca850dd46dcd74356a55054112dd20b048e130bff93bf`. Aucun Cargo/test/moteur exécuté par cet agent, aucun gain annoncé ; root compile et mesure selon PROPOSAL.md. Aucune source produit modifiée.

**Révision performance fondations V2 (isolée)** 2026-10-23T15:43:14.380229+00:00. V1 borne anticipée est un résultat négatif conservé, non promu (44.49/45.11s, mêmes sorties). Les38foundable subsistent ; blocs27/41 (594/317sommets) dominent. Je réserve une proposition sur feasibility.rs et un index de point-dans-anneau local, sans aucune source produit modifiée. Même grille/poses/échantillons/arithmétique ; prétest du centre déjà nécessaire, avant le balayage de tous les bords. Nouvelle copie `web/out/city-foundation-index-workspace/` issue du baseline exactV1 (pas sa borne). Root compile/mesure, aucun test/Cargo/natif chez moi.

**Gel fondations V2 prêt** : `web/out/city-foundation-index-workspace/`,5fichiers produit proposés,4tests préparés non exécutés, index local exact du prédicat centre déjà nécessaire puis contrôle intégral des bords. V1 négatif conservé/non repris/non promu. Vrais contours594/317, trous/ULP/bandes/horizontales et centres insuffisants couverts ; temps construction inclus ; aucune pose/grille/échantillon/RNG modifié. Manifest SHA256 `15213fdb73da3b2afdcf03e33b03d94886c006fe751575d0bc3f72294ba7c09c`, patch `2135d097d9133db535b50201b25c0c19836978629afe76b9498156a293fad2ec`. Aucun Cargo/test/moteur ou produit modifié par parameters_ui ; root mesure5k avant50k éventuel.

**Préparation livraison fondations sur produit courant (sans promotion)** 2026-10-23T16:07:29.549165+00:00. Root valide V2 :4tests,2paires5k et1paire50k byte-identiques, gain limité à ces replays. Nouvelle copie cohérente fraîche `web/out/city-foundation-index-current-delivery/` ; seuls5deltas feasibility/index/tests/2fixtures y sont reportés par3voies. Base feasibility actuelle identique à la base testée, les5résultats sont byte-identiques au candidatV2 ; tout Horreum/Opus/floor/functions courant est conservé. Aucun Cargo/test/natif/produit modifié par parameters_ui. Promotion suspendue aux validations root de cette livraison fraîche.

**Livraison fraîche définitive proposée — non promue** : `web/out/city-foundation-index-current-delivery-v2/`. Capture précédente rejetée (ABORTED.md), puis 314sources courantes capturées avec inventaire/SHA avant-après stables. 7deltas externes conservés (nouveaux modules Opus inclus). Cinq résultats et patch byte-identiques au V2 testé. Manifest SHA256 `91e2b3785494f33147c485dfb8be29d48701c9a3dea2f9f8a2b76a1cc3c27a80`, patch `2135d097d9133db535b50201b25c0c19836978629afe76b9498156a293fad2ec`, 344inputs. Aucun test/Cargo/natif ni production modifiée. Root doit valider la copie fraîche avant promotion ; commandes/ordre/exclusions dans DELIVERY.md. reconcile_built hors périmètre.


**Revue lecture seule provenance Java100k livrée.** Note `CODEX_JAVA100K_INPUT_PROVENANCE.md` : URL archivée/blackboard/capture byte-identiques ; options/layout/parcel exactes ; raster f32/u8 et géographie vectorielle fixture/décor identiques. Rayon réel1815.7360834719918, graines vides résolues city-tropical-island-l, routes réellement vides. Relief décor hills malgré config settlement flat. Ancien runtime SHA déclaré dans report, non attesté indépendamment ici. Aucun produit, test, build, moteur, navigateur, serveur ou HTTP exécuté. Root et round6_visual_audit informés avant benchmark. Slot libéré.


**Java100k — diagnostic mesure et proposition isolée.** Les976 admis avec gross inconnu ont tous le même motif de projection,1corps/1niveau, level=volume exact, projection globale issue union locale puis transformation. Aucun inventaire absent/hauteur invalide dans ce groupe. Proposition `web/out/housing-inventory-source-proof-proposal-v1/` : fallback de preuve source lossless exacte, sans epsilon ni géométrie/admission modifiée ; calcul gross toujours sur niveaux réels. Copie runtime v3 complète,5deltas,3témoins réels,2tests préparés non exécutés. Manifest7f0f214204c66d13cab2ea40f94a4b22b69567926230e82f5963bb5efddcba7c /353inputs. Root et round6 informés ; pas de promotion, test/build/natif/HTTP chez parameters_ui. Créneau libéré.


**Preuve re-mesure Java100k V2 préparée, non exécutée.** `web/out/housing-inventory-remeasurement-proof-v2/README.md` ; manifest94c3453cdeab3ff42f87acb53978285a18c316845397cd77785f55d9406427d8,484inputs. Runtime source-proof V1 inchangé (housing_floor_outcome SHA3f5f6c347d0838aade6eb92d5e734e5e5c8227f23868c5d80480a57e205d6cf7), seul append cfg(test) ignored.132shards exacts6459cas issus des vrais inputs/outputs,264archives brutes hashées ;5483rapports connus doivent rester identiques,976 inconnus conservés ou re-mesurés par vrai évaluateur privé.1981écarts request/retained need scalaires1ULP consignés sans correction, ancien need réellement retenu utilisé. Conversion partielle initiale marquée abandonnée, inputs-exact-v2 uniquement. Aucun produit/test/build/natif/moteur/HTTP par parameters_ui ; root centralise. Créneau libéré.


**Livraison produit mesure inventaire prête, non promue.** Root valide433Houses +re-mesure6459 (5483rapports inchangés,976mesurés,0inconnu). Livraison `web/out/housing-inventory-source-proof-production-delivery-v1/` :5deltasV1 exacts seulement,2bases SHA identiques+3fichiers absents,6gardes dépendances identiques. Manifest-before ea0492008321b81791befb7e6249431d451cbb40e047c6c3bb76486eceebca7c ; patchefffdd0a6fa5a7177e8011cf3d7fbe8c0edf6701a27fa6cf908af6c9a1ca00c9. Harness ignored/Cargo/lock/inputs massifs exclus ; aucune source produit modifiée. Attente ordre explicite root avant promotion des cinq chemins.


**Promotion autorisée terminée — créneau libéré.** Cinq deltas mesure inventaire V1 uniquement appliqués, après relecture exacte des5bases/proposés et6dépendances juste avant écriture. Reçu `web/out/housing-inventory-source-proof-production-delivery-v1/receipt-after.json` SHA b590c0f7eea117817a4b5af683132beaf3a51fac5c39cb201ae1e9c4e490e403. Runtime housing_floor_outcome SHA3f5f6c347d0838aade6eb92d5e734e5e5c8227f23868c5d80480a57e205d6cf7 et testsV1fc72e78d9999ff22d20fdbfd44a24f79ea74758bd3609bc842fe65f2762606ce byte-identiques aux433tests root.3fixtures réels ajoutés ; aucun harness ignored, archive massive, Cargo/lock ou rapport promu.6dépendances inchangées. Mesure de surfaces existantes uniquement, pas de maison/habitant supplémentaire. Aucun test/build/natif/serveur par parameters_ui.


**Revue sémantique/calibration Java livrée.** `CODEX_JAVA_COMPOUND_MODEL_REVIEW.md` (~818mots), sources primaires patrimoniales officielles CokroSubroto/Kotagede/Mijosastran et notice municipale dalem, vérifiées par recherche web. Fonctions des membres distinguées, aucune densité ni valeur normative nouvelle. Modèle60m²/4,5pers reste générique/non calibré ; borne de manque conditionnelle au modèle et périmètre corps, jamais population non logée. Recommandations UI provenance/usage/demandé-réalisé/inconnu ; noteallocation ancienne signalée. Aucun produit/calibrage/test/natif/serveur/navigateur automatisé. Créneau libéré.


## parameters_ui — bilan utile/brut UI (proposition isolée)
2026-10-23T18:43:31.207323+00:00 : root approuve une copie UI-only, aucune production modifiée. Réservés pour futur delta étroit : programmeOutcome.ts (conserver housing_floor), urbanBuildingsPanel/cityInspector (rows seulement), derivedCache (version dérivée2 uniquement), nouveau helper inventaire sélectionné. Natif/chunks/decor inchangés ; aucune inférence de grammaire ni lecture globale levels/archive. Garder toute modification Opus ; trois voies obligatoires avant promotion. Bases SHA :
- web/src/render/programmeOutcome.ts : ee2bb4a0348793a13df73672d22173cf682de553058f74465001afd4da353f68
- web/src/ui/urbanBuildingsPanel.ts : 225af7718cf94ade06be24a707fa53213a1487c6e337d76b70cff1d2ba0b14f8
- web/src/ui/cityInspector.ts : b99057a353ca2951fb78f2d64b9c693edabd3905f74173ec8624988b7ffb59a7
- web/src/ui/urbanBuildingDerivedCache.ts : 174e310bab733956d550e0201d5251d338686b79b4ef79a2415435888d4879e1


**Proposition UI utile/brut gelée, NON PROMUE.** `web/out/housing-floor-ui-proposal-v1/` ; manifestf2ac98c0ffdd5bdefe2b3dc3ba2d37fdad83db75efa80a92213f7ecca136d19d,1363inputs ; patcha277a21fcd362a2230db185ccd4f56aa54f85a8283cf80e7f88ed26d513ae7bb.8deltas : conservation whitelist immuable housing_floor, rows panel/inspecteur, inventaire sélectionné sans source/grammaire inférée, cache dérivé2 +constantefixtureIndexedDB,1fichiertests/fixture33Ko réelle. Rouge/vert dédiés horspatch (mêmeprobe/fixture, helperbase/candidat). RéparationV1/absente série existante testée par harness2chunks prévu, aucun rechargement global ajouté. Sources/assetsWasmréels hashés sansstub ; formatsnatifs intacts. Aucun test/build/moteur/serveur/navigateur/produit par parameters_ui ; root dispose descommandes. Créneau libéré.


**Révision UI V2 parentHH gelée, non promue.** `web/out/housing-floor-ui-proposal-v2/REVISION_V2.md` ; manifesta5ff23b4eb91dda31de18016cd97bb2b3243591b9929c5e135e54152ddfd8fbf,1372inputs ; patch67141013ba66423d0642ebed54dbd39653a353477f53d37aa61c04413f9c68f2. Mêmes8chemins, seulshelper/testschangentvsV1. HousingliéauHHparentaveccontratscalairenatifexact (64EPS +anciennegrille0.01,0.005+roundoff) ; parentabsent/mismatch→housinginconnuetbilanemprisepréservé. Témoinnatif2.35/2.345+ULP retenus, horscontratrefusé. V1intact,4dépendancesroottestcopiéesexactesavecmanifesteséparé. Aucunproduit/test/build/natifparparameters_ui ; rootcentralise. Créneaulibéré.


**Promotion UI utile/brut V2 autorisée, effectuée — créneau libéré.**8chemins exacts de la proposition V2 appliqués après relecture immédiate des bases ; résultat byte-identique au candidat root52tests/7fichiers+TSC/bundleverts. Reçu `web/out/housing-floor-ui-production-delivery-v2/receipt-after.json` SHAc2519c42be65870ffba530bfdd95d0805ce065b6d477a8c2f515d802bbf9964a.1386fichiers protégés avant/après, zéro dérive. Housing_floor conservé et lié auxHHparent, modèle/brut/besoin/inconnu affichés, inventairecorps à sélection sans grammaire inférée. Cache dérivé passe à2 : anciennesv1 requièrent réparation sérielle existante depuis les plans inchangés. Formatsnatifs/assets/config/Cargo/lock/harness nonmodifiés. TODO noncoché en attentepreuveproduitroot ; aucun test/build/natif/serveur par parameters_ui.


## parameters_ui — correction de libellés de capacité (isolée seulement)
2026-10-23T19:39:55.461783+00:00 : root demande qualification exacte prévision/affectation parcellaire avant Houses. Diagnostic `CODEX_CAPACITY_WORDING_SCOPE.md`. Aucun calcul/compteur/enum/population/evidence nouveau ; aucun produit modifié. Régions réservées pour proposition : textes programme.rs avertissement final ; quarters.rs avertissement/test ; footprint/capacity.rs describe+doc ; intitulés panel/inspecteur et affichage warning terrainUrban. Les autres changements Opus restent libres et seront préservés par3voies. Bases observées :
- rust/crates/core/src/urban/programme.rs : 8c6d081869cc663506eb715a8a0af4114989a762f88554896a54961e2046ec95
- rust/crates/core/src/urban/quarters.rs : dbe17e5555d27b17391516a6e117553f60fc72dc2d074f7a4be4ba1da95aa113
- rust/crates/core/src/urban/footprint/capacity.rs : 4eff7e8f4c778f2ac213d6311a4b1d17c560bd3d473326e345d51cf29994bdde
- web/src/ui/terrainUrban.ts : 15e707dbe89c8dc256308ecf3f6600ef55f92e54ae54b40ecb7890f5d311d26b
- web/src/ui/urbanBuildingsPanel.ts : f47e455d6fe510ffc46ad15782ee2c05ebdd763bba66a1d5ad62e78d6d4f9d59
- web/src/ui/cityInspector.ts : c1940bb6081ba95901688f4f0aed0bb24483269643477bf70229b8fbc0c44ade


**Libellés de capacité — proposition resserrée livrée, non promue.** Root a borné le lot au warning d’affectation et à son UI parcellaire. `web/out/parcel-capacity-wording-proposal-v1/` : 6 chemins, manifeste `c170a1b274f31a6ea211f9658e337d912ed7be1bd2b2a7eea8e0c3fd322e38f9`, patch `beb5c9504b9065d6071ec59d9f278a2b229bc838226d28421a4302888168fbc1`. Deux littéraux natifs + test cfg ; intitulés du tableau et affichage exact des anciens warnings, quantités/archives inchangées. AUCUN delta sur quarters.rs, footprint/capacity.rs ou cityInspector/profil/population/densité : réservations de ces régions levées. Bases gelées, autres changements Opus préservés ; promotion uniquement après ordre root et rebase frais. Aucun produit, test, build, moteur ou serveur exécuté par parameters_ui. Créneau libéré.


**Libellés de capacité — promotion autorisée des six seuls chemins effectuée.** Reçu `web/out/parcel-capacity-wording-production-delivery-v1/receipt-after.json`, SHA `c740c54bd70ca9bbce02af5ae48ad1ea7900dda9665eed4e749e63d98e4e3c10`. Bases relues juste avant écriture ; résultats byte-identiques au candidat root (25 tests UI, un petit test natif, TSC/bundle). 1 397 fichiers protégés avant/après : zéro dérive. Warning natif dit capacité parcellaire estimée après affectation ; UI qualifie l’ancienne signature exacte sans modifier ses quantités ni les archives. Aucun delta sur quarters/capacity, population/profil/densité, raccord pilotis, assets/config/Cargo/locks. TODO non coché ; aucun test/build/moteur/serveur par parameters_ui. Root fait ensuite les contrôles produit ciblés ; full Core reste le handoff Opus, aucune annonce tout vert. Créneau libéré.


## parameters_ui — compounds bridge/archive/UI, diagnostic et réservation isolée
2026-10-23T21:16:16.445297+00:00 : carte `_agents_blackboard/CODEX_COMPOUND_BRIDGE_SCOPE.md`, SHA observés `web/out/compound-bridge-audit-v1/observed-bases.json`. Aucun produit/interface natif modifié. Attente signatures explicites Round6 avant copie implémentation ; parents de programme séparés des vrais membres natifs, pas de faux Single ni comptage par membre. Régions bridge architecture/types/archive et adaptation projection/chunks/selection réservées pour proposition isolée ; aucune réservation Core/Opus. Rebase frais requis, root teste seul.


## parameters_ui — promotion bridge/UI des déficits ouverts V3 terminée
2026-10-23T21:44:25.487856+00:00 : neuf seuls chemins autorisés promus après les six Core de city_quality. Reçu `web/out/open-deficit-bridge-production-delivery-v3/receipt-after.json`, SHA `da1af8e051c673d91b54631a217e5f81ad428554f4ce38ce9aa5227e7d4f186e`. Bases fraîches, résultats byte-exacts au V3 root35tests/TSC/bundle ; 1353 fichiers protégés zéro dérive, TODO inchangé. Index allocation/cadastre/demande local unique par run eager, source réelle par page avant ACK, aucun marqueur recréé depuis allocation seule/import ; zéro crédit de capacité dans la déclaration. Compact/cold ne lancent toujours pas builtCapacity rétrospectif. Aucun test/build/serveur par agent. Root vérifie ensuite le produit. Verticale compounds demeure ISOLÉE ; elle doit intégrer ces deltas étroits avant son futur gel, aucune source Core Opus touchée.


## parameters_ui — première verticale assemblage gelée, NON PROMUE
2026-10-23T21:57:05.693593+00:00 : `web/out/compound-bridge-proposal-v2/DELIVERY.md`, manifest `8407f8b2f5101e28d390128c0f14b889ab9ea863d9c0d54ac4ce0c11b230b4b5`, 16 deltas/1225 inputs frontend actuels, neuf deltas openV3 préservés (merge trois voies panel/types). Bouton parent CityBench -> modal proposition NON APPLIQUÉE -> archive native unique -> relecture froide/unpack -> vrais membres/projection non réalisable -> sélection parent/membre -> réalisation/export natif archive. Aucun faux Single, programme/capacité jamais multipliés. Lecteur froid direct borné, PAS ensureColdSession global ; tests vrai cache enfant hit/miss interdisent toute lecture globale/derived. Source périmée/voisinage incomplet refusés. Fixture root native V3 réelle sur site SYNTHÉTIQUE byte-exact SHA12877052298c5d7d2d939b5b99d9b122dd28370916432ed214f03de9e07f5255 ; aucune preuve ville/Java22/browser/wrapper-loop annoncée. Pas de source Core/Rust ni produit modifié, aucun test/build/natif/serveur/navigateur exécuté par agent. Root compile et teste cette première copie avant toute correction en révision distincte/promotion. Stream ville/comparaison/3D/édition de groupe restent explicitement ouverts.


## parameters_ui — assemblage UI V4, sauvegarde historique explicitée (NON PROMUE)
2026-10-23T22:05:49.299661+00:00 : `web/out/compound-bridge-proposal-v4/DELIVERY.md`, manifeste `7ba4e2f73399c60b46a4041a0fc5bcd1c0b7fd6924a4c30fa30c16ae83c60a29`. V2/V3 intacts ; V3 corrige seul mauvais import picking et backend HIT réel. V4 conserve allowlist16 ; quatre fichiers changent vsV3 : reçu de commit courant-au-retour/historique-source-remplacée avec empreintes d’origine ; vraie queue de publication utilisée par producteur interdit historique avant proposed/show ; UI/contrat disent NON APPLIQUÉ/historique possible, pas save avortée garantie ; deux témoins déterministes commit différé/sourcefalse et CAS plus récent conservé. Aucun nettoyage d’archive. IO froid demeure drain borné16MiB/16chunks puis rejet si source périmée, pas lecture globale. Important : root prouve wrapper JSON local actuellement0/2 groupes (revalidation incumbent transformée par parsing) malgré positif natif direct +444tests ; correction transport native séparée Round6, aucun EPS/normalisation. Ces tests consommateurs rejouent le contrat sous transport mock, ne prouvent pas une admission depuis l’UI réelle. Aucun produit/test/build/natif/serveur par parameters_ui ; root valide.


## parameters_ui — assemblage UI V5 gate Std gelé, NON PROMU
2026-10-23T22:18:12.448004+00:00 : `web/out/compound-bridge-proposal-v5/DELIVERY.md`, manifeste `81e1307ff543daa018c5ea9265bb6f8abd1ece3a12c9ac60d6508eb85ce99f4a`. V4 root26tests/TSC/bundle intacte. Mêmeallowlist16, six seuls deltas vsV4 : constantes/garde locale etWasm (listes fresh pair1+std1 et getterpair existant cohérent), garde read/stage avant lecture d’archive, tests refus V4pairseul zéro site/archiveread/native/save et positifs MOCK deuxcaps explicites. Aucun nouveaugetter ni payload/member/archive/schema ; sauvegarde historique NONAPPLIQUÉE/CAS etCoreeagerV3 conservés. Contrat confirmé directement root/Round6 avant code ; Std est une version de lecteur d’entrée, pas un certificat. Aucune preuve publique positive Std/Web/native22 annoncée par cette copie ; root teste le vrai codec et les wrappers séparément. Aucun produit/test/build/natif/serveur/navigateur par parameters_ui.


## parameters_ui — FRONTEND16 préflight prêt seulement, aucune promotion
2026-10-23T22:43:34.233791+00:00 : `web/out/compound-bridge-frontend-production-delivery-v5/PREFLIGHT.md`, préflight SHA `9ba14200663e4ca53310f338612a86ac4a4deeef19bbc973bad2204286a9c815`. Quatre bases produit exactes +douze nouveaux absents, seize candidats byte-exacts à V5 root31tests/TSC/bundle ;1225inputs courants sansdérive et1354fichiers protégés relus avant/après zérodrift. Les neuf Core/eager bridgeUI V3 demeurent exacts. Pas d’application exécutée : ordre explicite root puis relecture fraîche de chaque base nécessaire. Runtime/assets/config/Cargo/locks/snapshots/harness/grandsraws exclus ; seule petitefixtureUNIT native354Ko est explicitement dansallowlist16. Entrée CityBench parent sélectionné -> proposition séparée NONAPPLIQUÉE ; streamville,mainLOD,comparaison,3D,éditiongroupes,HouseBench,decorURLMU non intégrés et listés. Root public LOCAL Std2/2 réel lu (sha125f2289…), siteSYNTHÉTIQUE etpasTCP/browser/capacitéville ; guestWasm encoreenconstruction à cettepréparation. Aucunproduit/test/build/serveur/navigateur/TODO parparameters_ui.


## parameters_ui — FRONTEND16 promu après BACKEND17, contrôles produit root attendus
2026-10-23T23:04:01.431105+00:00 : promotion des seize seuls chemins autorisés byte-exacts à UI V5 (root31tests/TSC/bundle) terminée après reçu backend17 `0fa300190fb9efda54a30d6485370f0b44e5bec905a6f02e81a1b12d139c9bc1`. Reçu frontend `web/out/compound-bridge-frontend-production-delivery-v5/receipt-after.json` SHA `46247e87eb8056c20b4df9c7b61e2c19bb40a5434292f489336ad7cc6f0ddbc1` : quatre remplacements/douze créations, bases revérifiées juste avant chacune ;1365fichiers protégés inchangés, dix-sept backend inchangés et zéro ajout/suppression extérieur. Core/Opus/eagerV3/assets/config/Cargo/locks/archives/TODO préservés. Runtime partagé NON relancé ; aucun test/build/natif/serveur/navigateur par agent, aucun TODOcoché. C’est seulement un essai de parent sélectionné en modal **NON APPLIQUÉE** : aucun stream/rendu/comptage ville injecté ou modifié. Groupcitystream,mainLOD/comparaison/3D/édition/HouseBench/decorURLMU restentouverts et documentés. Root lance contrôles produits après lesdeuxreçus ; pas de déclaration toutle générateur fini.


## parameters_ui � flux ville parent r�el, tranche A en copie isol�e
2026-10-24 : r�servation nouvelle copie `web/out/city-parent-stream-proposal-v1/candidate/`, source courante1237inputs ; aucun produit. Contrat direct Round6 parent-batch1/bulk4routesStd +capabilities parent/pair/std ; ACK durable apr�s tous fragments, archives seules, indexland/roof r�els. TrancheA contrat/client/budgets/index/stage/IDB/import born�, puis trancheB vrai Worker/fallback/bouton/rendu froid sur le m�me store. Root seul compile/teste. Pr�server Core/eager/Opus ; pas de d�monstrateur suppl�mentaire.


## parameters_ui - City parent tranche A first freeze, NOT PROMOTED
`web/out/city-parent-stream-proposal-v1/DELIVERY.md`, manifestbc817561f50ed087e37825616d083fad9bb48b86f445e7288bfe40b24b9efead,16deltas/1237inputs. Root compiler/tests first; no author tests/build/product. A archive-only source and durable parent/member index ACK receiver implemented; stateless prior-leaf adapter only a primitive, NO applied city coverage claim. Root chose native prefix2D session for real B; awaiting Round6 session signatures before types. No real city button/Worker/render yet, no second demo.


## City parent A V2 - strict test types and cumulative source bound
`web/out/city-parent-stream-proposal-v2/DELIVERY.md`, manifest1451f6a08bac296f483740bdbb81e79ef47624ee074b729243783fa4ee447532. RootV1runtime42PASS unchanged. Threechangedpaths vsV1 (strict annotations +shared canonical sourcebuffer +stream hook),17deltas total. Encodedsourceprefix24MiB +one boundedlookahead<=24MiB, never64*24MiB; notheapclaim. V1immutable, no author tests/build/product. A notcitybutton; B realnative-session stillrequired.


## City session B1 producer/receiver first freeze - NOT PROMOTED
`web/out/city-parent-session-ui-proposal-v1/DELIVERY.md`, manifest6f2ea6df1c21c14079a2c70bfd1858a6f47a2ea1870eabd26bf6b7594d9443de,31deltas/1237inputs. A2root43PASS/TSC/bundle intact. Real commonproducer in Worker andfallback, mainparentreceiver uses same stage/index/CAS and rejects oldSingle; legacy sceneclient refusesparentSession. UTF8batch_jsonSHA beforeparse, uniquequalification pernonce, durable->workerACK->nativeACK, independentcleanup, source0administrative. UIconsumers/button/rendu/pick/detail/decor stillNOTwired: nextrevision mandatory, no Bcomplete/no browserclaim. Rootonlytests/build, no product authored.


## City parent B2 narrow Worker lifecycle freeze - NOT PROMOTED
`web/out/city-parent-session-ui-proposal-v2/DELIVERY.md`, manifest1d8e3f40f2264dc19c8a7e549b693c85da0126ae545969164bd7d220763fe221. B1root55PASS/TSC/bundle preserved; only5changedpaths add unconditional actualWorkerdrained afterproducerfinally, independent staleepoch, queued not_started; mainreplace/dispose awaitsdrain beforedispatch/terminate. Newtestloads ACTUAL workermodule+producer withblockedplan/releaseprotocolmocks, notbrowser/nativeproof. Fatalworker cleanupunconfirmed explicit. UIbutton/rendu/pick/detail/decor stillabsent, consumerrevisionnext. Noauthor tests/build/product/TODO.


## B3 consumer revision active (not frozen, not tested)
New copy `web/out/city-parent-session-ui-proposal-v3/candidate`, based on B2 root57PASS/TSC/bundle. No product. Added actual-child parent visual DTO/cache (no fakePlacedBuilding/useful0), same source/index/cache atomic append and native bulk import-derived rebuild, explicit singlechunk native repair. Native source archive remains authority. Added small parentAcknowledged scalar hook AFTER actualnativeACK for future staging marker (durableCompleted distinctnativeAckedCompleted); late AggregateError/worker_failed cancellation diagnostics preserved. Real guestSingle fixtures copied from rootSession17calls proof (SYNTHETICsite, noautogroupproof), provenance outer response nativeJSON SHA retained in native-single-guest-provenance.json. Still to write: boundedchild coldwindow/overview, selectedparent archive/detail generic renderer, ParentStreamWindow preview, parentstate/panel, realexistingbutton route, typedglobalpick, nativearchivesexport/importpanel, URL/MU snapshot preservation/explicit globaldecor and3D/compare/edit/HouseBench refusal. Root alone tests.

B3 UI copy reservation (NO product edits): current base hashes checked exact against1237 freeze: urbanBuildingsPanel d13107231a46535333ff0855cfc8985c586462aa976f46e8102b864cfa0e2d16; terrainUrban83a14b385d6a61f5bbc059be66950211575f365a68e7ab4dfe593173e5de9735; urbanSnapshot0f0a07375089623170273eb9c6ca356304658b796745c9bb7f88fc678905ae90; decor79a776bff9d39e7b78e6df1cbb726fcf751829d62ffdb079c94abfd0918a7a7c. Core/eager and externalOpus changes preserved. Backend20 promotion receipt f98d66e5150e8da1d0e7d96fdeb86a0748025af9dd2d9c3ab066948d2b9208bb noted for final protectedinventory; no backend/source/asset copied to product.

## B3 real city consumers — frozen for root feedback

2026-10-24. Existing city button/session producer now connected in isolated `web/out/city-parent-session-ui-proposal-v3/candidate`, not production. Manifest SHA256 `353c68309c95f951fd87373dc9a76d69047c37eb216605ee8f8b470bedb54778`; 1286 inputs / 63 cumulative deltas, 14 live bases exact at freeze. Native backend20 preserved. Durable staging preview, native ACK scalar distinct, CAS applied parent reference, child-only cold map/window/picking, true parent archive selection and whole-parent member detail, native archive export/import. Full decor portable/comparison/3D/partial edit/HouseBench refuse visibly. Root alone tests/builds; no browser/pixel/admission/performance result claimed. B2 and all former gels untouched. Delivery README has precise commands and limits.

## B4 narrow root feedback revision — frozen

`web/out/city-parent-session-ui-proposal-v4/manifest.json`, SHA `c84b047d1c2519fa53fc493fa566a82331b00eff4498a4e657f84d577a3973fe`. 1287 inputs/64 cumulative deltas, live bases exact, B3 intact. Three changed files only vs B3: fresh require before repair chunk read; two stale preexisting panel expectations; cache witnesses query actual fixture140..155 rather than empty -100..100, retain true empty-inside vs pending-outside. New unsupported repair engine witness demands zero source/native reads/writes/calls. Exact Core kinds.rs dependency added (not product delta) for existing demographicMorphology test. Root alone verifies; no product promotion.

## B5 late rejection + last actual paint evidence — frozen

`web/out/city-parent-session-ui-proposal-v5/manifest.json`, SHA `9e29f14b14b9340afa95d9a8f3fc9457e7558d1973f2c8e7d530c1078ab48da4`. 1290 inputs/67 cumulative deltas, all15 live bases exact, B4 immutable137/137/TSC/bundle root proof. Only three files changed vs B4 and three new small helpers/tests. Actual read/pick/open late-error publication now respects source/view/cursor; selected read also pick ownership. DOM successes come only after draw; evidence is captured last-paint immutable, async query/detail completion does not upgrade it. Source/commit/durable frontiers and recorded release scopes explicit; actual overview source/style and current-view detail scheduler stats exposed. Invalidated source marker inactive. No geometry/model/search/count change, no product/test/build/native/browser by author. UI activation/promotion held for root's dense native regression/full8395 run.

## Taxonomie UI — nouvelle tranche isolée réservée

Après UI67/capture3 produits, audit demandé par root : préserver choix historiques importés dans les vrais selects (period/mode et profils/recettes), distinguer politique d’admission de certification historique et profil urbain de recette témoin/pack. Réservation isolée : urbanBuildingsPanel.ts, terrainUrban.ts, terrainSettlements.ts seulement aux régions selects/rapports ; nouveaux petits helpers et tests ; docs/CITY_VARIATION_VARIABLES.md. Aucun Core ni moteur ni produit modifié, pas de plafond/calibration inventé. Culture×époque×échelle sans métadonnées reste inconnu ; rapport appliqué vient uniquement du programme retourné/importé, pas des contrôles courants.

## Taxonomie UI V2 gelée — proposition non promue

`web/out/city-taxonomy-ui-proposal-v2/manifest.json` SHA `79651a2db5d9ad0b450d1ff0346e857c43e9cc2ac319097ef9b2e80d708a7d6b`. Produit frais UI67/capture3,1297inputs,9deltas (3UI+doc,5nouveaux helper/data/script/test),4bases exactes. Corrige perte des valeurs horsselects, expose vraie politique/filtre d'époque et routage programme conservé, plausibilité historique explicitement inconnue. Projection d’époques284B pins vraie admission NativeA/M+version/SHA, outil maintenance dansrepo. V1 intact, V2 unique canonicalLF projection. AUDIT conserve trous de précédence cultureplan, état/déclin, contrôles isolés conditionnels et alias historiques. AucunCore/Opus/produit/test/build/natif/serveur paragent ; rootreprendvalidations. GlobalTODO noncoché.


## CityBench plan culture override — isolated reservation
Fresh candidate city-culture-override-proposal-v1, after promoted taxonomy9. Narrow terrainUrban.ts + terrainSettlements.ts wiring, new actual-control helper/test and doc. Preserve exact URL/MU/import/history plan override; default site only from existing normalization. Return-to-site explicit and culture-only. Place changes do not reset plan/parcel/architecture overrides. Existing deliberate global settlement-style reset remains explicit. No Core/native/product/test/build/server by author. Root alone validates.


## CityBench plan culture override V1 frozen — NOT PROMOTED
web/out/city-culture-override-proposal-v1/manifest.json SHA472ee0d76151a8120baeaeabaf8c813dda367a3a00b4add528d6d1b3f0792c75,1299inputs/5deltas (3modifiedUI/doc +2newhelper/test). Existing true generation select recovered in advanced section, explicit plan→site only changes culture, constructor no longer overwrites restored override, actual place editor preserves all other axes. Place/plan/parcel/architecture precedence documented; recipes remain exact with native refusal when incompatible. Six prepared binding/MU/transport/source-wiring tests plus9existingfiles for root only. No author tests/build/native/product/TODO. Root verifies via root-verify.py; old taxonomyV2 and all prior gels untouched.


## parameters_ui — état/vacance UI, copie isolée réservée
Root autorise uniquement état/vacance : nouveau city-programme-condition-proposal-v1 frais, urbanBuildingsPanel.ts + helper/test + petit normaliseur urbanConfig.ts (state/decay uniquement) + doc. Préserve absent/undefined/null/0 et valeurs importées hors domaine sans coercition ; natif valide/refuse. Rapport depuis contexte retourné, aucun taux catalogue ou habitants estimés. Pas de matrice conditionnelle, migration blend, Core/maisons/runtime/assets modifiés. Aucun produit/test/build/serveur par agent ; root seul valide. Merci Opus de coordonner ces régions si changement simultané.


## État/vacance UI V1 gelée — NON PROMUE
web/out/city-programme-condition-proposal-v1/manifest.json SHA758dbba104e208f6d2b240d45a9d0c425d747c794a6813972e61a14f672f887d.1301inputs frais aprèsUI207/culture5/assets8,5deltas (panel+normaliseur state/decay seuls+doc, helper/test nouveaux),3basesactuelles exactes,1765protégés inventoriés. Véritables contrôles état/vacance+reset limité, absent/undefined/null/0/import hors domaine conservés sans coercition, rapport depuis contexte retourné sans tauxcatalogue/habitants déduits. Sept témoins préparés ; transport sousfetchcontrôlé nommé, paspreuve native/refus réel/browser. Rootseulteste via root-verify.py. Aucunproduit/test/build/natif/serveur/TODOparagent ; Opus prévenu en blackboard.


## parameters_ui — pertinence des contrôles : copie isolée réservée
Root autorise seulement diagnostics de pertinence native sûrs, city-control-relevance-proposal-v1. Réservation terrainUrban.ts régions générationControls/applyProgramme/draw/changed + helper/test/fixture/doc. Native mod.rs1128 tente lay_out puis quarters en casNone : AUCUNE désactivation sur rôle/Kind seul. Priorité formeforcée/autoisolé visible ; réglages conservés/éditables pour repli. Appliqué depuis marqueurs retournés, absence/retouches inconnues non supposées. Pas de solveur culture/taille, Core/Wasm/runtime/assets modifiés ; pas de tests/build/produit par agent. Matrice consommateurs incluse pour revue root.


## Pertinence contrôles UI V1 gelée — NON PROMUE
web/out/city-control-relevance-proposal-v1/manifest.json SHA5a8a53c33c3525739afd22471f30e7bcc7e58fa608f45019e728800b0c405199,1307inputs/5deltas (terrainUrban+doc ; helper/test/fixture nativeréelle projetée).2basesfraîches exactes,1774protégés ycomprisdépendances/assetscourants. Matrice b47223ac50594f6b7863f9174f855f2fa1fea05e51f34b539098c586a9f21d6e. Aucun contrôle désactivé sur rôle/Kind : repli None→quarters réel. Priorité imposée et attente directe/legacy/inconnus visibles ; planconservé indique nonpilotage de la compositionquartiers seulement sous marqueurs cohérents/sansretouches. Nucleated-village pas small(). Recettes/validation/morph/maillage/accès restentactifs. Huit tests préparés plus8fichiersexistants pourroot. Pas solveurcopié/déductionculturetaille/capacité, aucune valeur ni transport modifiés. Opusprévenu ; aucun produit/test/build/natif/serveur/TODOparagent. Rootseulcontrôle.


## parameters_ui — P1 restoreDraft seul, copie isolée réservée
city-building-draft-restore-proposal-v1 depuis produit UI222/Frontage3 frais. Seules deux affectations selects restoreDraft du panneau remplacées par retainSelectValue existant, comme restore/setBuildingDraft ; null/absence héritage vide conservé, objet importé intact. Harnais test borné AST des vrais corps restore/capture/restoreDraft/setBuildingDraft/generate, sans recopier logique ni nouvelles dépendances ; contrôles select structurels, pas preuvebrowser/native. Aucun P2, Core/Houses/asset/config/TODO modifié, aucun test/build/natif/browser/serveur agent. Rootseulvalide.


## P1 restoreDraft V1b gelé — NON PROMU
web/out/city-building-draft-restore-proposal-v1b/manifest.json SHAe6258cd03217daf37a2b424f8c983563d4f020b38a26e66b2a35174c26dbbd47 :1309inputs/3deltas (panel2affectations, test+harnaisAST). V1code40c4aff… intact ; seulinputV1→V1b est WebWasmHouses145→897c9715 surautorisationroot/reçuasset1e608247…,3autresassetsidentiques,1308autresinputsbyteexacts. UnepréimageUIexacte+2absences,1779protégésaprèsfinreceiptasset. Sixscénariospréparés dont vrai restore→restoreDraft→generate extraitducodeTS ; témoins rouges BASEavec mêmeharnais/sourceméthodepréimage etvertscandidat, pascopielogique/nouveaudep. Null/absencehéritagevideetobjetimportéintact. SourceFrontage3/Coreclock/assetsprotégés ; aucunP2,produit/test/build/native/browser/serveur/TODOagent. Rootseulcontrôle via root-verify.py puisroot-red-witness.py ; créneaulibéré.


## Codex — culture des phases / étapes ordinales, tranche UI isolée
Réservation copie fraîche `web/out/city-growth-phase-ui-proposal-v1/candidate` : seuls terrainUrban.ts, testbench.ts et docs/CITY_VARIATION_VARIABLES.md ; nouveau petit helper/test. Le rapport lit exclusivement GrowthPhase.culture retourné/importé, absence inconnue. Libellés Époques→Étapes, IDs epochs/data-epoch/valeurs/liens/périodes inchangés. Aucun Core/Houses/geometry6/asset ni produit modifié, aucun test/build/browser/natif exécuté par agent ; root seul valide. Blend et couverture historique hors scope. Code/assets/config protégés, notes chronologiques provenance seule.


## Codex — remplacement explicite de profil, lecture seule
Scope court dans CODEX_EXPLICIT_PROFILE_REPLACEMENT_UI_SCOPE.md : un axe plan/parcelles/architecture à la fois, aperçu/régénération, population et autres surcharges conservées ; aucun seuil ni alternative garantie sans preuve. Éviter style global et handler générique parcelles qui réinitialisent volontairement des champs. Coordination directe feasibility_review pour établi/non_couvert/inconnu scoped/config/versions ; aucun produit/test/build/natif/browser de cette lecture.
