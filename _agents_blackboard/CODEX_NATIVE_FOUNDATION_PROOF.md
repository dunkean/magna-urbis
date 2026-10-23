# Assise native : comparaison isolée des 128 requêtes

Référence `after-cache-and-simple` → `after-native-foundation`, mêmes 128 requêtes et même ordre. **125 admissions et 3 refus dans chaque version ; aucun gain, aucune perte, aucun changement de recette/variante.** Les cibles d'emprise à ±10 % passent de 36 à 37, sans cible perdue. Sept emprises se rapprochent de leur cible, aucune ne s'en éloigne. Le ratio médian passe de 0,580753 à 0,626456.

| Index source / parcelle | Avant m² | Après m² | Cible m² | Pas ancien domaine / assise réelle, à la nouvelle pose |
| --- | ---: | ---: | ---: | ---: |
| 1491 / `67b7b66f83cf7f55` | 15,41 | 54,54 | 87,4 | 0,871778 / 0,706876 m |
| 2471 / `8e8c98677955ef3d` | 13,29 | 57,58 | 203 | 0,762025 / 0,660205 m |
| 3537 / `61ca50ea7c5550ac` | 88,57 | 162,20 | 257,9 | 0,852985 / 0,724669 m |
| 11111 / `e099cf700f812cc3` | 40,49 | 78,796 | 78,8 | 0,784510 / 0,747982 m |
| 11307 / `19d616127d82e927` | 17,14 | 87,49 | 182,8 | 0,857255 / 0,672161 m |
| 11976 / `53c6fbc1ac486b3b` | 78,94 | 214,27 | 261,1 | 0,750614 / 0,739979 m |
| 12272 / `3c53fa43f11481d8` | 67,36 | 74,68 | 87,9 | 0,919624 / 0,670627 m |

La limite fournie par ces requêtes reste 0,75 m. Un huitième cas, index **2665 / `d561062d78bcb94c`**, conserve son aire mais change de pose : ancien domaine 0,778050 m, assise réelle 0,643079 m. Il s'agit de huit poses désormais compatibles avec l'assise réelle, pas de huit bâtiments supplémentaires.

Audit indépendant GEOS et raster bilinéaire : zéro dépassement des droits corps/toits, cadastre, réserves ou occupation des voisins parmi les 125 plans (seuil de compte 0,0001 m²). Les **101 plans marqués comme préparés nativement** satisfont les contrôles de terrain sur corps + structures publiées, avec galeries, poteaux et murs mitoyens conservés. Écart maximal entre altitude calculée et `ground_z_m` : **1,413 × 10⁻⁹ m**. Les 24 autres plans sont intégralement identiques ; leur ancien domaine n'est pas revendiqué comme un contrat complet d'appuis natifs.

Les huit témoins ont été rejoués séparément avec les deux binaires, extérieur et intérieur. Chaque plan du lot réduit est exactement égal au plan correspondant des 128. **Extérieurs : 8/8 avant et après. Intérieurs : 0/8 avant et après**, même refus préexistant : `Native interior entrance differs from the retained planning connection. City plan preserved; detailed site admission is required.` Aucun nouvel échec détail ; ce chantier ne certifie pas ces raccords intérieurs.

Coût observé sur une seule exécution par version : **280 → 330 ms**, tandis que les poses du budget passent de 1213 à 1173. Aucun gain de performance ni taux de ville n'est déduit de ce lot.

Preuves : `web/out/strip-initial-budget-proof/after-native-foundation/foundation-comparison.json` et `web/out/native-foundation-detail-proof/comparison.json`. Le `comparison.json` historique de chaque phase compare au premier `before` ; seul **`foundation-comparison.json` isole ici la référence à 125 admissions**. Scripts : `web/scripts/native_foundation_compare.py`, `web/scripts/native_foundation_details_proof.py`.

Requêtes SHA256 : `4fb8c3e55cf52edfcbca524a98854429b152e3151cbbc60197a13941b77c253d`. Binaire après figé : `web/out/native-foundation-cli-proof/plan_replay.exe`, SHA256 `3f257109abea839addb0e6346ea43866d4d6004ee128680fc11a7481d87a413c`. Aucun catalogue, serveur ou code Rust modifié pour ces preuves.
