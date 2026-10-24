# Backend assemblage : activation V7 préparée, non promue

[Copie et commandes](../web/out/houses-native-assembly-backend-activation-workspace-v7/README.md). Gel `implementation-freeze-activation-v7.json`, SHA `52cdfe88f1dcac8a3cf99cdef798db8c03b84939bf0a2ed475535f770ed3c4c4` : 827 fichiers, 406 entrées candidate, 154 includes présents. Aucun produit, build, test, natif, serveur ou navigateur par l'auteur. Root exécute et décide.

**17 fichiers autorisables seulement** dans `allowlist.json` : dix runtime, deux fichiers de tests et cinq petits fixtures. Six bases existantes étaient encore exactement celles de V6 ; fusion en trois voies propre, sans conflit. Onze fichiers nouveaux. Les empreintes fraîches et les résultats sont dans `fresh-source-freeze.json` et `three-way-merge.json` ; `backend-activation.patch` est uniquement une revue, pas une application au produit.

Les dix corps runtime sont V6 exacts après les seuls retraits cfg(test) explicités dans `removed-proof-only-code.json` et `runtime-v6-identity.json`. Neuf blocs d'écriture/export de preuve ont disparu : émetteur de fichiers, appels d'export, dump de rejet et transport local ignoré. Aucun driver, cohorte22, données103Mo ni dépendance web/out/env n'est introduit dans les nouveaux tests.

Les tests autonomes gardent les douze contrôles Houses V6. Deux tests local et deux Wasm-native incluent désormais de vrais positifs publics : même requête native synthétique, signature complète, archive entière et réalisation de deux intérieurs via les vraies fonctions. Les trois nouveaux fixtures publics totalisent environ 158 Ko et proviennent des sorties V6 effectivement exécutées par root ; provenance et SHA dans `fixture-provenance.json`. Ils ne sont ni une admission inventée ni une mesure Java. Les deux fixtures internes V6 restent inchangés.

Le snapshot Core/eager courant reste intégralement préservé. Aucun delta Core, Cargo.toml, Cargo.lock, features, assets/config, version ou schéma Single. `PlanBuilding`, `PlanBatch` et le corps de `plan_batch` restent byte-identiques aux bases produit. Les APIs assemblage restent **opt-in** ; aucun branchement automatique au flux ville ou au calcul de capacité.

V6 est déjà validée par root : 12 tests Houses, un local, un Wasm-native ; vrai dispatch local strict 2/2 avec signatures complètes, archive entière et deux intérieurs par phase ; **guest Wasm réel Node 2/2** avec la même archive et deux intérieurs. V7 doit encore passer ses contrôles propres après nettoyage des tests. Ces preuves ne certifient aucune population logée, capacité ou ville parfaite.

Commandes root exactes dans README : compilation des trois paquets avec Cargo JSON, `--locked`, cible distincte ; filtres attendus 12 Houses / 2 local / 2 Wasm-native ; bibliothèque Houses complète et contrôle wasm32. Aucun serveur à démarrer. Les références d'artefacts doivent montrer les chemins manifest/src de V7 et `fresh=false` ; aucune copie d'actifs générés à promouvoir.

**Prochaine action après verdict root seulement** : recontrôler immédiatement les six SHA live et l'absence des onze nouveaux fichiers. En cas de dérive, refaire le delta trois voies. Promouvoir seulement l'allowlist17 depuis `candidate/`, jamais le snapshot Core/Cargo entier. Autorisation d'écriture produit encore absente ; réservation auteur relâchée après cette livraison.
