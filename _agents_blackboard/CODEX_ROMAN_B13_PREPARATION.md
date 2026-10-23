# B13 — préparation sans émission

Procédure courante après migration `houses-3` / `architectural-plans-2` : [émission et validations séparées](CODEX_ROMAN_B13_EMISSION_PLAN.md). Le raccord urbain reste à mesurer ; le changement de version ne l'étend pas aux pins ou à tous les détails.

23 octobre 2026. **Prête pour une validation native séparée après B12 ; aucune preuve native B13 acquise.** Le catalogue actif reste à 265 recettes/418 styles. Les fichiers `recipes.json`, `source-inventory.json`, `urban-admission.json` et les documents source actifs sont conservés. B12 a passé ses 3 tests : extérieur et intérieur autonome valides ; raccord intérieur urbain toujours refusé pour les écarts d'entrée mesurés de 1,125 et 2 m.

La proposition complète est dans `roman-b13-proposed/proposal.json`, avec la ligne mapper future, les assignations `roman_street_block / C / 03:GRID`, la provenance, les notes artistiques et les trois bundles. Aucun filtre culturel exclusif n'est ajouté. `roman_urban` est une facette ; `inspired_only=true` exclut strict, y compris les pins. Les sources restent celles du document romain existant : Ara Coeli pour l'organisation multi-niveaux, Calza pour les logements éclairés en façade/cour, Casa di Diana pour préserver aussi la famille à cour. Aucune nouvelle mesure historique ni capacité n'est attribuée.

| Bundle | Étages | Hauteur artistique | Routes adjacentes | Corps |
|---|---:|---:|---|---:|
| default | 2 | 2,8 m | 0→1 | 1 |
| three_storeys | 3 | 2,8 m | 0→1→2 | 1 |
| four_storeys | 4 | 2,8 m | 0→1→2→3 | 1 |

`Strip/FP-RECT`, maçonnerie de brique enduite, toit GABLE en tuiles, largeur nominale 6,5–10 m et profondeur 10–18 m. `urban_frontage_infill=false` est conservé dans chaque bundle ; aucune aile burgage, galerie `side_corridor`, boutique ou partition `multiple_households` ajoutée. Le corps natif occupe `(W−1,25)×0,75D`, soit 39,375–118,125 m² dans ces plages ; arrière ouvert et passage sont les conventions Strip, pas des proportions romaines mesurées. Pièces génériques Communal, indépendance des logements et population non certifiées.

**Correction préparatoire unique du générateur :** pour les variantes de recettes inspired, conserver la hauteur déclarée et recalculer les routes adjacentes avant de copier le bundle dans `main`. Leur confiance est `stylized`. Les recettes inspired déjà émises n'ont pas de variante : le checker confirme les 265 recettes, B12 incluse, identiques après sérialisation, et aucun octet modifié dans les trois fichiers de données.

Commande sans construction native : `python _agents_blackboard/prepare_roman_b13.py`. Résultat : `roman-b13-proposed/preparation-report.json`. Les demandes futures bornées 2/3/4 niveaux sont dans `native-requests.json`. Le test proposé `roman_b13_data.rs.proposed` reste hors Cargo ; il est à déplacer seulement après GO émission. Il vérifiera un corps de 39,375 m², la cour de 16,25 m², le passage de 12,5 m², les vrais niveaux/routes/composants, le roundtrip compact/extérieur, les pièces et escaliers accessibles du même Resolved, ainsi que les refus strict/étages incompatibles/lot trop petit. Le raccord intérieur urbain sera mesuré séparément : seul le garde d'entrée déjà identifié peut être caractérisé comme limite ; toute autre erreur échoue.

Émission attendue si validation autorisée : **266 recettes/421 styles**, trois styles B13. Avant activation, intégrer la ligne mapper en remplaçant la ligne blanche immédiatement après B12 pour préserver les anciennes références, puis métadonnées/assignations proposées ; exécuter les scripts normaux et comparer de nouveau les 265 anciennes recettes. Aucun export admission B13 avant cette preuve native.
