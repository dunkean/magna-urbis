# Prochaine tranche DATA Java — contrat proposé, sans édition

22 octobre 2026. Source documentaire : `CODEX_JAVA_ARCHITECTURAL_SOURCES.md` (java_sources). **Livraison minimale : deux vrais profils résidentiels Kampung/Limasan, un identifiant de tradition partagé avec Joglo, sans déployer immédiatement un filtre réduit au seul Joglo.** Aucun nouveau découpage urbain, aucune réinterprétation de B05 Bali, aucun ensemble de prestige inventé.

## Recettes et périmètre géométrique

Réserver **AS-ISL-B14 = Maison kampung javanaise** et **AS-ISL-B15 = Maison limasan javanaise**. Les B01–B13 gardent leur identité. Profils natifs proposés `javanese_kampung` et `javanese_limasan`, rôle `dwelling`, un corps résidentiel fermé, un étage, support au sol. Reprendre les **opérateurs** `Single / FP-RECT / RF-GABLE` et `Single / FP-RECT / RF-HIP`, charpente `post_beam`, sans héritage du profil `balinese`, de pilotis ou du prestige Joglo. Le limasan doit conserver un faîtage entre quatre versants : éviter un carré produisant une simple pyramide. `allowed_footprints` et `allowed_roofs` restent chacun bornés à cette forme.

Premier lot : variantes `default` seulement. Reporter emper latéral/périphérique, cuisine, gandok, cour et assemblage pendopo/pringgitan/dalem à une tranche avec corps et accès explicites. Les décrire comme intentions dans la documentation ne doit pas créer des composants fictifs. B06 demeure le modèle Joglo existant, avec ses limites connues ; ajouter deux recettes ne corrige pas sa pyramide/structure ni ses annexes absentes.

**Dimensions à établir avant de générer les JSON :** la source présente un gandok Kampung11,69×3,55m, un pendopo Limasan10,07×11,84m et un dalem Joglo8,20×9,60m. Ce sont trois rôles/bâtiments distincts, pas des bornes min/max de maisons ordinaires. Aucun intervalle universel n’est déduit ici. Les plages destinées au jeu (largeur/profondeur, pente du toit, débord, hauteur, épaisseur, pièces) doivent être écrites comme **defaults artistiques explicites**, avec les propriétés morphologiques sourcées séparées. Les matériaux choisis doivent venir du dossier, pas des défauts hérités `WATTLE-DAUB/MUD-PLASTER/THATCH` du helper Python. Le moteur sait les réutiliser, mais cette disponibilité technique n’en établit pas l’attribution locale.

## Tradition commune, distincte de la forme et du settlement

Ajouter `tradition_id?: "javanese"` à **B06, B14, B15**. `profile` reste joglo/kampung/limasan ; `settlement_archetype` reste un contexte (S05 = village de cours, S07 = ville royale), sans servir de substitut au type de maison. Les nouvelles maisons peuvent avoir S05 comme contexte sourcé, mais l’appartenance javanaise est donnée par le nouveau champ. Ne pas réutiliser le texte libre `subtradition`, actuellement copié du label de settlement, comme clé culturelle.

Auteur unique : une table explicite `TRADITION_ASSIGNMENTS` dans `house-recipes.py`, validant les IDs, produit ce champ dans `recipes.json`. `Recipe` Rust/TS l’accepte optionnellement, `StyleEntry` l’expose, l’index ajoute la facette exacte `tradition`, et `StyleQuery.tradition_id` la filtre. Absence du champ/requête préserve les autres packs. La clé de cache sérialise déjà toute la requête : la palette locale sera donc isolée correctement, sans génération géométrique pour filtrer.

À l’activation, **la même donnée doit arriver dans `urban-admission.json`** et être lue par core : la plus petite admission Java doit provenir du même ensemble B06/B14/B15 que la shortlist. Ne pas admettre une parcelle avec B05 Bali puis exiger une maison Java différente. Le branchement `javanese-courts → tradition_id=javanese` est un changement local à convenir avec Opus ; aucun changement global des mappings. Les choix explicites recipe/variant/house_config/workshop précèdent la palette automatique ; les contrôles natifs restent actifs. Trois recettes disponibles autorisent au plus trois essais distincts, jamais un quatrième emprunt silencieux.

**Poids :** le script transforme actuellement les priorités P0/P1/P2 en poids50/25/10 ; il faut donc publier et tester le résultat voulu. Des poids de jeu favorisant Kampung puis Limasan et réservant davantage Joglo peuvent être justifiés comme choix de production, mais **aucun pourcentage historique** ne découle des sources. Ne pas modifier le poids global B06 à la dérobée pour corriger seulement Java ; la politique de palette devra le rendre explicite.

## Fichiers et chaîne de génération

| Source à modifier lors du GO | Travail borné |
|---|---|
| `docs/styles_architecturaux_mondiaux_city_mapper.md` | Ajouter B14/B15 dans le tableau AS-ISL, avec description exacte et liens vers le dossier documentaire pérenne |
| Nouveau `docs/sources/javanese-domestic-architecture.md` | Pérenniser la note java_sources : sources/URLs/pages, relevés ponctuels, limites chronologiques, paramètres artistiques séparés |
| `rust/scripts/house-source.py` | Ajouter ce dossier à `SOURCE_FILES` pour son empreinte ; les tables restent extraites du mapper, pas de parsing Web |
| `rust/scripts/house-recipes.py` | Deux profils ; append des deux tokens dans **ASSIGNMENTS, ROLE_ASSIGNMENTS, CONTEXT_ASSIGNMENTS** ; tradition explicite et références documentaires supplémentaires ; politique de chronologie/poids explicite |
| `houses/src/catalogue.rs`, `style_index.rs`, contrats `housesContract.ts`/`buildingStyles.ts` | Champ/facette de tradition optionnels ; aucun changement de géométrie pour les deux defaults |
| `houses/src/admission.rs` + lecteur `core/urban/culture.rs` | Export/lire la tradition afin de partager l’admission avec la palette ; branchement culture local séparé et coordonné |

Les sorties **`source-inventory.json`, `recipes.json`, `urban-admission.json` sont générées**, pas éditées à la main. `complete_parameters` reconstruit composants/support/notes : les nouveaux réglages et notes doivent être posés au bon endroit pour ne pas être effacés. Chaîne prévue, **non exécutée** :

```text
python rust/scripts/house-source.py
python rust/scripts/house-recipes.py
# depuis rust/, en debug seulement
cargo run -p magna-urbis-houses --example admission -- crates/houses/data/urban-admission.json
```

Puis `--check` des deux scripts et tests ciblés. Le compteur source attendu passe345→347 ; les recettes262→264 si aucune autre tranche n’a modifié le catalogue. La régénération déplace les références de lignes des chapitres suivants : ce bruit de diff est mécanique, pas une réécriture culturelle. Versionner le catalogue (actuellement `atlas-houses-2`) et régénérer l’empreinte d’admission. **Le replay compact contrôle cette version : un ancien plan ne doit jamais être réinterprété silencieusement avec de nouvelles données** ; coordonner la migration/refus explicite de détails des archives avant le déploiement.

## Chronologie : limite de contrat à résoudre explicitement

Les témoins du dossier sont tardifs. Le générateur copie sinon les périodes A/M du pack ; ce serait une attribution implicite non fondée pour B14/B15. `confidence=stylized` et `chronology_note` sont informatifs : **ils ne bloquent pas le mode strict**. `late_only=true` n’est pas un remplacement correct pour « tradition sans preuve médiévale » et exclurait aussi les nouveaux defaults de City inspired (`allow_late=false`).

Proposition minimale honnête pour les deux nouveaux IDs : plage chronologique inconnue (`from_year/to_year=null`, pas de période médiévale inventée), et un **champ optionnel de modes autorisés** accepté par la validation canonique et l’index, absent pour les recettes existantes, `historical_inspired/fantasy` pour ces deux interprétations. Une sélection d’ère précise sans source doit rester exclue ou porter une règle inspired explicitement convenue ; ne pas contourner `Catalogue::admissible`. Ce petit garde affecte le contrat et doit être décidé avant activation, pas caché dans un label.

## Vérification bornée avant activation City

1. Inventaire/provenance et index : B06/B14/B15 partagent seulement la tradition ; profils/toits restent différents ; B05 exclu de cette palette. Vérifier les modes, l’ère inconnue, les pins explicites et les poids de production déclarés.
2. Trois maisons côte à côte à la même échelle : vrai faîtage/pignons Kampung, faîtage et quatre pans Limasan, Joglo courant identifié honnêtement. Pour les deux nouvelles recettes : petit lot légal, grand lot qui ne gonfle pas la maison, lot trop étroit refusé ; dimensions/réserves/entrée/toit contrôlés.
3. Pour une graine de chaque nouvelle recette, plan retenu→archive→extérieur conserve source, corps, emprise et seed. Aucun besoin de génération de ville pour valider cette tranche. Le filtre City Java n’est activé qu’une fois les deux maisons réellement disponibles ; il ne certifie ni population logée ni composition de cour complète.
