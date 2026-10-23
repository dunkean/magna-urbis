# C7921 — audit indépendant B06 V2 + terrain V3

23 octobre 2026. Expérience isolée, **pas une promotion produit**. Baseline B11 `c786a95f…554268e`, candidat `525e7e18…3591a2`. Même snapshot C intermédiaire, mêmes 7 921 demandes, graines, configurations et ordre, même bridge réel et 124 lots ; chaque phase reconstruit sa propre occupation. SHA du corpus : `1d3fc52454e46a080d186aaa75a3fa99cde9b5291ef85b483860a0a04c39df53`. Le SHA du moteur urbain producteur de C reste inconnu. Ce résultat ne représente ni R5 fusionné ni une nouvelle génération de la ville utilisateur.

## Résultat et compromis

| Mesure | B11 | Combiné expérimental |
|---|---:|---:|
| Plans admis / refus / ouverts | 6 079 / 1 835 / 7 | 6 177 / 1 737 / 7 |
| Plancher réel domestic+mixed admis | 367 549,45 m² | 455 165,61 m² |
| Plancher comparable à une référence connue | 360 325,64 m² | 447 877,28 m² |
| Référence dérivée emprise × étages du programme | 1 593 811,30 m² | identique |
| Portails natifs conservés | 2 094 | 2 141 |

**98 gains, aucune perte d’admission**, aucun changement de recette, variante ou étage parmi les anciens admis. Les gains sont 97 B14 et 1 B15, tous un étage : 84 domestic, 14 mixed. Ils ajoutent 4 710,05 m² d’emprise ; 50 conservent une entrée native, 48 restent sans entrée native conservée. Les anciens résultats ne sont pas inchangés : 3 466 objets sont byte-identiques, 2 613 diffèrent, dont 1 921 changements d’aire supérieurs à 0,0001 m².

Le plancher utilise les vrais niveaux géométriques, sans réalisation d’intérieur. Référence connue sur 7 490 sites, inconnue sur 287 ; les refus apportent zéro plancher admis. La comparaison correspondante couvre 5 896 admis et 1 594 refus. Aucune conversion en habitants, logements ou capacité certifiée.

Sur les **mêmes 5 799 anciens admis avec cible**, l’écart absolu cumulé passe de 904 752,97 à 821 526,89 m² ; 1 663 cibles se rapprochent, 255 s’éloignent. Le ratio médian emprise/cible passe de 0,4660 à 0,5520. Aucun dénominateur n’est changé pour cette comparaison.

| Source, anciens admis | Aire gagnée | Cibles améliorées / dégradées | Dimensions / admissions du budget après |
|---|---:|---:|---:|
| B06, 2 207 plans | +79 510,81 m² | 1 273 / 34 | 8 728 / 21 795 |
| B14, 2 125 plans | +485,89 m² | 156 / 140 | 4 304 / 12 988 |
| B15, 1 747 plans | +2 909,41 m² | 234 / 81 | 3 870 / 11 991 |

B06 progresse nettement mais reste sous-dimensionnée : ratio médian 0,06655 → 0,15379 ; 2 009/2 152 cibles connues restent sous 90 %, contre 2 034 auparavant. La plus forte régression, index 6 495 / lot 101 / parcelle `5e43e7a76924e282`, passe de 515,60 à 222,51 m² pour une cible de 515,6. Ses voisins enrichis et candidats d’occupation natifs sont exactement inchangés. Les trois suivantes perdent 239,42, 186,86 et 153,40 m² de qualité absolue ; elles sont conservées dans `findings.json`, pas noyées dans la moyenne.

## Entrées : réserve avant promotion

Parmi les anciens admis : **33 portails gagnés, 36 perdus**. Les 36 pertes concernent 24 B15 et 12 B14, aucun B06. Elles représentent +170,83 m² au total, avec 24 améliorations et 12 dégradations de la cible. Toutes finissent par : `No unobstructed connection from the retained native portal to declared frontage` ; le plan garde une connexion indicative et sa géométrie admise.

Pour **35/36**, les voisins enrichis et les surfaces candidates du broadphase natif `OccupationIndex::local` sont exactement identiques avant/après : la différence vient du nouveau résultat de recherche budgétaire, pas d’une nouvelle occupation transmise. Le helper de minima est générique ; son effet dépasse B06. Le dernier cas, index 4 904 / lot 076 / parcelle `6f223c1663b2391b`, a un contexte local changé (1 → 2 candidats) et passe de 130,00 à 94,74 m² ; cette corrélation ne prouve pas la cause sans contre-factuel.

Ce sont des **pertes de portail conservé**, pas des échecs d’intérieur démontrés : aucun détail natif supplémentaire n’a été lancé par cet audit. Les 36 identités, dimensions, diagnostics finaux et chemins des demandes exactes sont dans `entry-transitions.json` et `native-occupation-context.json`.

## Gardes et limites constatées

- **6 177 droits GEOS verts, 0 collision globale** entre occupations complètes corps/cours/circulation/structures. Contrôle des voisins enrichis et des occupations antérieures au sein du lot.
- **6 177 assises Ground Single réellement mesurées**, même sans marqueur préparé : pente, eau, dénivelé et altitude verts. Les 2 141 assises explicitement préparées passent également. Erreur maximale d’altitude : 5,11 × 10⁻⁹ m. Tous les plans ici ont un corps rectangulaire, un niveau, aucun appui externe ; aucun assemblage inconnu n’est déclaré vérifié.
- Les 98 gains passent minima physiques, maxima source, ratio, étage et graine. Tous les anciens gardent source/variante/étage ; aucune nouvelle anomalie source n’est introduite.
- Le contrôle large initial a volontairement conservé **504 drapeaux** et terminé avec une assertion : **458 ratios hors plages source** (235 B06, 200 B15, 23 B14) et 84 comparaisons de minimum, avec recouvrement. La comparaison ciblée prouve que leurs contrôles, dimensions physiques et minima sont **exactement hérités**. Les 84 déficits de minimum sont uniquement des écarts de soustraction de coordonnées ≤7,27 × 10⁻⁹ m et passent à la grille native millimétrique. Les ratios hérités restent une dette réelle ; aucune tolérance du moteur n’a été changée et le premier rapport n’a pas été réécrit.
- 901 traces de récupération : 98 succès, 803 refus ; 5 844 évaluations du guide, 309 constructions/admissions (donc 211 tentatives réduites refusées), maxima **8/1/1 respectés**. Budget ordinaire : 5 799 traces, maxima **8 dimensions / 24 admissions** ; 16 902 dimensions et 46 774 admissions, contre 14 080 / 39 941. Ces compteurs ne représentent pas tous les contrôles terrain du moteur.

86 demandes voient des voisins enrichis différents. Aucune admission perdue et aucun chevauchement ne résultent de cette nouvelle occupation dans ce corpus. Ne pas étendre ce constat à l’ancien corpus Java row : le mélange des pools V2/V3 y est une expérience distincte, actuellement en correction.

## Preuves reproductibles

Racine : `web/out/java-c-b06-v2-terrain-v3-proof/` ; aucune source Rust, catalogue, UI ou service modifiés par l’audit.

- `independent-audit/comparison.json` SHA `434362d31f2ae4e50941906d4659efbae3aecbd836149a3ed21da33202e7a6d2` ; détails `sites.json`, `rights-terrain.json`, `simple-ground-source.json`, `recovery-traces.json`, `refusals.json`.
- `independent-audit/findings.json` SHA `d2b1de0a4c6321e453069c0ab0d5fbe078a2a34ce6640e783ec7f658c6220a55` ; comparaison héritage exacte dans `source-findings-history.json`.
- `independent-audit/native-occupation-context.json` SHA `475e8c90066c219fae4c80ab2b6aa4258823abef4e34c4f77a5c3d53b89fe3f2` ; 36 portails et 4 plus fortes régressions.
- `structural-floor-programme-evidence.json` SHA `ff9ed0ec980fd518c1571f6c7f886f744b35d3159de27a66703c78ad4b2a1d7d`.

Scripts : `web/scripts/java_combined_capacity_audit.py`, `java_combined_capacity_findings.py`, `java_combined_entry_context.py`, collecteur existant `architecture_floor_programme_proof.mjs`. Lecture hors ligne des lots figés uniquement ; aucun Cargo, serveur, détail ou nouveau rejeu natif. Les temps singleton du runner ne sont pas un benchmark de performance.

Trois témoins transmis à Java Sources pour la correction suivante dans `regression-witnesses/` : index 6 495 (B06 budget), 6 577 (B14 portail), 1 409 (B15 portail). Les demandes, plans et surfaces d’occupation antérieures sont copiés en **tokens JSON exacts** avant/après, avec header et manifestes SHA ; respectivement 31, 45 et 1 occupations précédentes. Les trois ont un contexte natif local inchangé. Script d’extraction : `web/scripts/java_combined_regression_witnesses.py` ; aucune nouvelle génération.
