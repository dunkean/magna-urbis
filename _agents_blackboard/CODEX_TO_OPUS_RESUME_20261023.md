# Reprise Opus — 23 octobre 2026

**Priorité : obtenir un Round5 commun identifié, puis vérifier les trois cas utilisateur exacts.** Cette note ne réserve aucun fichier City et ne clôt aucun TODO.

**Houses livré, sources figées (07:07 Paris).** Dernier CLI `web/out/portal-lintel-production-proof/plan_replay.exe`, SHA `39fccd69b11c7af484b70b12114e0724f736543df77db5852a51253420d0fd84`. Inclut nominal/terrain et correction du linteau natif. **403 tests release et 406 debug**, 128 sorties de plans et16détails européens identiques à ad10 hors durée ; export225profils/421styles exact. Tu peux compiler les sources communes. Aucun core/UI/local/serveur touché ni moteur relancé par Codex. Détails : `CODEX_NOMINAL_TERRAIN_DELIVERY.md` et `CODEX_PORTAL_LINTEL_DELIVERY.md`. La préparation légère B06 reste dans une copie de recherche et ne doit pas être intégrée à ce build.

Sur les 7921 demandes C : **6225 admis / 1689 refus / 7 ouverts**, 146 gains sans ancienne admission perdue ; 1136 anciennes cibles améliorées, aucune dégradée, aucun ancien portail perdu. Droits, assises et collisions contrôlés. Ancien Java1752 : **1338/407/7, 328 gains sans perte**. Ce sont des relectures du snapshot C et de l’ancien corpus, pas le Round5 final ni des captures navigateur.

**Le programme reste très supérieur au bâti.** Plancher domestic/mixed admis : 367549 → 435444 m². Sur les références complètes : **428091 m² construits pour 1593811 m² dérivés du programme** (emprise cible × niveaux préférés). Du déficit brut par site, 74,2 % vient des maisons admises trop petites et 25,8 % des refus. B06 porte 71,2 % du déficit des admis ; sa médiane emprise/cible reste 0,113. Aucun habitant extrapolé : conserver « ménages prévus »/« capacité parcellaire estimée ». Entrées B06 en ville encore ouvertes ; correction générique du linteau livrée, préparation légère native en copie isolée seulement.

**Compound javanais absent du catalogue exécutable.** B06/B14/B15 sont trois Singles ; `compound` est une préférence souple, `LOT-COMPOUND` une métadonnée. B05 balinaise est correctement exclue. Proposition suivante : Opus définit deux parts réelles, cour/chemin commun et budgets répartis ; Houses construit les pavillons natifs avec leurs fondations et archives individuelles. Répéter la cible globale ou créer une fausse desserte interne est exclu. Un Compound Houses unique demanderait des fondations par corps : l'union actuelle des appuis garde une altitude globale. [Contrat et limites](CODEX_JAVA_COMPOUND_CAPABILITY.md).

**Round5 reçu, 07:15.** Merge `fb8c41582bacaa1c62c7aaf7430f8e86474f63155a49458f2f605750eaf76966`, annoncé sur :8795 : 170/170 core + 12 intégration. Il contient Houses 03:56, donc les preuves de la livraison 39fcc ci-dessus ne valident pas automatiquement ce binaire. Codex vérifie les preuves existantes indépendamment ; Opus F/Q/W poursuit le Round6. Restent les sorties/captures overview+centre de **01-l, Java100k et04 exacts** sur un moteur commun identifié. Java exact : `_agents_blackboard/javanese-user-{url.txt,options.json}`, centre8000/8000,100000habitants, javanese-courts. Roman `04real` annoncé à2640/2669 est arrondi : conserver le cas utilisateur fractionnaire pour validation finale.

**Roman04 exact :**5000habitants, roman-core, centre **(2639.9315590685324,2668.9433913724934)**, Parchemin/silhouettes. URL/options : `_agents_blackboard/roman-user-{url.txt,options.json}`. Archive au bon centre : `web/out/r5-roman/after/city-04-mountain-bay-s-layout.json` et PNG voisin ; preuve quais `web/out/roman-port-proof/shore-safe/`. `web/out/r5-merge/04/` est centré2000/2000 : ce cas distinct ne valide pas le port utilisateur. Les50 scénarios sont préparés dans `web/out/city-visual-bench/r5-identity-prepared/prepared.json` ; commencer par ces trois P0, mêmes positions/caméras, avant la campagne entière.

## Priorités produit du TODO après livraison — recommandations

| Priorité encore ouverte | Prochain résultat concret | Parallélisation possible |
|---|---|---|
| Capacité Java et composition réelle (`TODO.md:5,13–14,29`) | Deux parts natives sur quelques lots C, déficit explicite, cour/accès conservés | Contrat commun Opus/Houses ; ensuite programme/parts et préparation native séparés |
| Faisabilité, parcelles équilibrées et silhouettes (`26–28`) | Découpe utilisant les témoins réels, corps/toits/accès ; distributions et vues comparables | Audit Codex parallèle ; coordonner les mutations core avec la capacité |
| Roman04 port et programmes (`18–20`) | Port/rive/installations cohérents ; boutiques et logements distingués, cours conservées | Relecture visuelle/source parallèle ; réserver les fichiers programme partagés |
| Grande ville détaillée (`30,97,110`) | Premier affichage, navigation, mémoire, détails visibles et lecture unitaire sur moteur neuf | Travail rendu/transport séparé du core ; chronométrages lourds séquentiels |
| Campagne50 puis million (`64`, précisions grande ville) | Captures identifiées et comparaison sans nouvel appel natif ; mesure du million ensuite | Préparation/analyse parallèle, exécutions après gel du binaire et validation des P0 |

Les lignes TODO contiennent encore des bilans historiques : cette note les signale sans les modifier. Aucun OPUS_CITY, TODO, fichier source, moteur ou serveur modifié pour ce handoff.
