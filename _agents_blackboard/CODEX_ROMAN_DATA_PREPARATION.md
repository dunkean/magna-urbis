# Catalogue romain — B12 émise, validation native en attente

23 octobre 2026. Après GO root et gel de la comparaison fondations128 : `source-inventory.json` et `recipes.json` émis par les deux scripts normaux. Catalogue265 recettes/418 styles. Aucun export styles/admission ni construction native exécuté par cet agent. Trois tests dans `rust/crates/houses/tests/roman_data.rs`, figés pour compilation root ; preuve native en attente.

**Changement générique :** `house-recipes.py` associe désormais à chaque recette inspired_only son document source, ses notes de paramètres, sa chronologie et sa hauteur artistique optionnelle. Il ne déduit plus automatiquement une provenance javanaise/une datation tardive de cette permission. Les métadonnées B14/B15 reprennent exactement les valeurs existantes.

**Émission effectuée : B12 seulement.** Profil `roman_shop_house`, Single/RECT, maçonnerie de brique enduite, deux niveaux, toit GABLE de tuiles ;4,5–6,5×7–11m nominaux, hauteur2,8m, murs0,25–0,40m, débord0,15–0,30m. Rôle mixed_residential, poids artistique25, contexte S04, tradition roman_urban, ère A, inspired_only=true. Une enveloppe mixte inspirée est annoncée ; le constructeur donne un usage Shop à la première pièce générique du RDC, mais distribution romaine, accès commercial distinct, ménages et capacité restent non certifiés. Une seule variante default ; aucun filtre culturel automatique activé.

**B13 préparée, non émise.** Document source et profil `roman_street_block` Strip,6,5–10×10–18m nominaux, sans side_corridor/galerie, avec `urban_frontage_infill=false`. Aucune affectation ASSIGNMENTS/mapper ni variante exécutable avant le garde Rust confié à java_sources. Variante default deux niveaux, variantes projetées trois/quatre niveaux : lors du raccord, leurs routes verticales et composant main devront suivre leurs vrais étages/hauteur. Ne pas simplement réutiliser le bundle de deux niveaux. B13 reste absente du résultat Python.

## Fichiers à relire

- `rust/scripts/house-recipes.py` : profils préparés, métadonnées inspired_only par recette, B12 affectée, `build(source=None)` pour prévisualiser un inventaire extrait en mémoire ; validation d'une unique section de provenance par recette.
- `rust/scripts/house-source.py` : document romain ajouté à la liste des sources, sans émission.
- `docs/styles_architecturaux_mondiaux_city_mapper.md` : B12 remplace une ligne blanche ; nombre de lignes inchangé pour préserver les références de toutes les recettes existantes.
- `docs/sources/roman-compact-domestic-architecture.md` : preuves, paramètres artistiques, limites et statut non émis de B13.

## Contrôle effectué

Commande de preuve avant émission : `python _agents_blackboard/check_roman_catalogue_preparation.py` (témoin pré-export, ne pas relancer après ajout de B12).

La première comparaison en mémoire conserve les **264 anciennes recettes**, y compris variantes/paramètres/provenance, aux mêmes octets après sérialisation JSON ; B14/B15 gardent leurs références mapper941/942 et contexte915. Rapport : `roman-catalogue-preparation-check.json`. La comparaison après émission normale confirme cette égalité contre les264 hashes sauvegardés : `roman-b12-export-before.json` et `roman-b12-export-report.json`. Seule B12 est ajoutée ; urban-admission reste inchangé. Les deux commandes Python `--check` passent après émission.

Premier passage natif root : refus strict/étages/lot trop petit verts ; plans/extérieurs des deux positifs verts, intérieurs urbains refusés pour désaccord entre le vrai portail et l'entrée conservée. Tests corrigés pour vérifier l'intérieur autonome du même Resolved et caractériser précisément le refus urbain, en attente de nouvelle exécution root ; voir `CODEX_ROMAN_B12_VALIDATION.md`. Aucun export admission avant verdict. L'ajout d'une recette change légitimement les tirages MED-ANT ; la comparaison de fallback précédente reste figée sur264/417. Root a ajusté le test catalogue générique à348B. Le garde infill bool est testé séparément ; B13 demeure non émise et ses trois variantes n'ont pas de preuve native.
