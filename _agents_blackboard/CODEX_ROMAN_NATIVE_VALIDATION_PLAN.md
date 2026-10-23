# B12/B13 — validation native préparée, non exécutée

23 octobre 2026. Fixtures préparées avant émission, puis GO root pour B12 : catalogue265 recettes/418 styles, B13 toujours absente. Aucun Cargo, serveur ou appel natif exécuté par cet agent ; huit demandes synthétiques, leur manifeste et un vérificateur sont prêts sous `roman-native-proposed-fixtures/`. Trois tests natifs B12 sont désormais dans `tests/roman_data.rs`, en attente de compilation/exécution root. Les dimensions sont les propositions artistiques documentées dans `docs/sources/roman-compact-domestic-architecture.md`, pas des relevés ni des capacités.

## Points de production examinés

**Un seul corps réel.** Single construit le rectangle sans cour. Strip construit `(W−1,25) × 0,75D`, une cour arrière ouverte et le passage latéral. B13 exige `urban_frontage_infill=false`, testé séparément par java_sources ; les fixtures utilisent une couverture65/96≈0,677, supérieure à l'ancien seuil0,66, pour détecter un oubli du garde. Le détail side_corridor est omis car il créerait galerie/poteaux. Aucun opt-out ne doit supprimer cour ou passage.

**Étages, murs, pièces et accès.** `layouts::spec` crée les niveaux depuis les paramètres effectivement résolus ; le composant main doit garder les mêmes étages et hauteur. Chaque variante trois/quatre niveaux doit recalculer toutes les routes0→1→2→3 et leurs copies dans main. La voie `variants_for` actuelle recalcule aussi la hauteur générique : le raccord B13 devra appliquer sa hauteur artistique2,8m après cette étape. Une simple modification de floors serait insuffisante. À murs0,40m et hauteur2,8m, `minimum_domain` fournit une borne3,60×4,86m pour2–4 pièces ; les corps minimaux proposés4,5×7 et5,25×7,5 la dépassent. Cela ne prouve pas que les subdivisions, volées, portes et toits finaux passent : le rejeu intérieur est obligatoire.

**Fonctions réellement produites.** Correction des premières notes après lecture de `engine.rs:2130–2253` : sans cellules déclarées, l'intérieur possède un identifiant générique de ménage ; `multiple_households` ajouterait une allée1,2m et des cellules identifiées, sans programme archéologique d'appartements. B13 omet ce flag et produit des pièces Communal. B12 `shopfront` produit un panneau ET l'usage Shop de la première pièce du RDC, puis Living pour les autres. Aucun de ces identifiants/usages ne fournit un nombre d'habitants ni une validation historique. Le plan doit continuer d'annoncer domestic_units=0.

**Même plan conservé.** `plan_replay --details` appelle `realize_plan` deux fois sur le compact admis, extérieur puis intérieur, sans re-génération. Il vérifie les corps, la toiture contenue et la correspondance de l'entrée retenue. Son rapport ne contient pas la liste complète des pièces/usages ; le nouveau test Rust B12 inspecte le HouseBatch pour les usages Shop/Living et les nœuds d'accès des pièces. Il reste à exécuter par root. Une réussite ne certifie ni éclairage, accès commercial indépendant, population ou un taux d'acceptation de ville.

## Huit témoins, trois fichiers

| Fichier | Demandes et résultat à vérifier après export/build |
|---|---|
| `b12-requests.json` | Minimum4,5×7m/two levels accepté et réalisé ; lot2×12m refusé par minima physiques ; même pin en strict refusé ; override dur trois niveaux refusé. |
| `b12-exact-requests.json` | house_config B12 exacte, deux niveaux durs, souhait programme quatre niveaux : rester sur deux niveaux, même source, sans adaptation automatique. Extérieur/intérieur doivent passer. |
| `b13-later-requests.json` | Trois pins de variante default/three_storeys/four_storeys ; nominal minimum6,5×10m, deux/trois/quatre niveaux, couverture0,677. Un seul corps39,375m², cour16,25m² et chemin12,5m² conservés ; aucune aile, galerie ou enceinte. Les trois réalisations doivent passer, sinon corriger le profil/constructeur au lieu d'abaisser les gardes. |

Chaque parcelle est éloignée des autres de100m, terrain plat, aucun voisin ; ces témoins isolent la construction et ne promettent pas de résoudre les refus R5 sur pente. Les pins servent à tester les sources ; une comparaison automatique R5 sera une preuve distincte après livraison des recettes.

## Blocage observé et exécution différée

Le premier test natif root a confirmé plans/extérieurs B12, puis un refus du raccord intérieur urbain : vrai portail différent de l'entrée retenue. `roman_data.rs` caractérise désormais cette limite en séparant enrichissement autonome du même Resolved et refus urbain précis ; nouvelle exécution root attendue. Voir `CODEX_ROMAN_B12_VALIDATION.md`. Le vérificateur CLI ci-dessous exige toujours le raccord urbain intérieur réussi : il restera rouge jusqu'au correctif, même si la preuve autonome de recette passe.

Les trois commandes exactes sont dans `roman-native-proposed-fixtures/manifest.json`, champ commands_after_export_and_parent_build. Elles utilisent uniquement l'exemple CLI existant `plan_replay.exe`, avec huit demandes au total. **Ne pas lancer la tranche B13**, absente du catalogue ; B12 exige un exécutable recompilé après son émission.

Après GO émission et compilation root : exécuter les deux commandes B12, puis `python _agents_blackboard/prepare_roman_native_validation.py check`. B13 reste différée jusqu'à son affectation et à ses variantes ; ensuite lancer sa commande et vérifier avec `--batches b13-later`. Le vérificateur lit les deltas compacts exacts et leurs bases, contrôle source/seed/étages/main/routes/aires/topologie et les deux rapports de détail ; il n'appelle aucun moteur et ne modifie aucun export. Il refuse une recette absente ou tout résultat inattendu. Préparation seule exécutée : `python _agents_blackboard/prepare_roman_native_validation.py prepare` ; état actuel `proposed_not_run`.
