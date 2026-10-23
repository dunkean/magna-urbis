# B13 — relecture native avant émission

23 octobre 2026. Lecture seule des sources, propositions et tests ; aucun catalogue émis, aucun Cargo ni rejeu exécuté. B12 reste intégré, B13 demeure proposé. Cette note complète `CODEX_ROMAN_B13_EMISSION_PLAN.md` après les corrections de portails `houses-3`.

## Périmètre qui paraît cohérent à lecture

- `Strip/FP-RECT`, un corps, `urban_frontage_infill=false` : le constructeur conserve le rectangle `(W−1,25) × 0,75D`, la cour arrière et le passage latéral. Le flag est déjà consommé par le moteur ; ce n’est plus un blocage d’implémentation. Le paragraphe « Blocage d’émission » du document source romain doit être actualisé lors de l’émission, sans déplacer le titre B12 ni modifier ses références.
- Aux minima nominaux 6,5×10 m, le corps est 5,25×7,5 m, soit 39,375 m². Même avec murs de 0,4 m et quatre pièces, la borne géométrique actuelle de `minimum_domain` est 3,6×4,86 m ; la trémie native mesure au moins 0,9×2,66 m pour des niveaux de 2,8 m. Ces inégalités autorisent la construction à essayer : elles ne prouvent ni les paliers, ni le découpage des pièces, ni leur accessibilité.
- Les trois bundles déclarent exactement 2/3/4 niveaux et 1/2/3 routes adjacentes. `variants_for` conserve maintenant la hauteur inspired et recalcule les routes avant la copie dans `main`. L’accès natif cherche une trémie commune aux niveaux, retire sa surface aux planchers/pièces, refuse une pièce divisée ou consommée, puis exige chaque route adjacente. Le test de graphe proposé est donc pertinent et doit réussir pour chacun des trois bundles.
- La cour brute de 16,25 m² et le passage de 12,5 m² se recouvrent sur 3,125 m² au minimum : leur somme avec les corps n’est pas l’occupation totale. L’union reste 65 m². Ne pas présenter ces surfaces comme des quotas disjoints.
- `inspired_only=true` exclut strict même avec pin. Les variantes fixes sont nécessaires pour 3/4 niveaux ; un override de quatre niveaux sur `default` doit refuser. La borne 118,125 m² est celle de la source à taille1, sans adaptation ; le chemin automatique `parcel_fit` peut conserver son extension artistique ×2 déjà déclarée. Aucune de ces valeurs n’est une capacité d’occupants.

## Obstacles et limites à vérifier

1. **Recette native encore non testée.** Le témoin proposé vérifie les trois minima avec `variation=0`, pas toutes les dimensions/épaisseurs/graines. Les nouvelles gardes de paliers opposés et de passage asymétrique s’appliqueront aussi aux portes des paliers. Une erreur de trémie, pièce, toit ou graphe doit échouer, et ne peut pas être classée comme simple écart d’entrée urbaine.
2. **Raccord urbain distinct.** Les pins/overrides des témoins excluent l’upgrade automatique de l’entrée ; même sans pins, `masonry_joints` reste hors liste des détails autorisés dans `engine::prepare_foundation`. Le détail produit des `DecorativePanel`. Il ne faut ni l’effacer, ni contourner les exclusions pour obtenir un succès. Le test proposé distingue correctement l’intérieur autonome du même Resolved et le raccord urbain : il tolère seulement le message exact de décalage d’entrée, avec un écart réel ≥1 mm. Le checker CLI reste plus strict et exige les deux détails réussis.
3. **Migration de test nécessaire.** `rust/crates/houses/tests/catalogue.rs:95` impose actuellement 348 entrées de couverture : passer à349 seulement avec l’ajout effectif B13. C’est le seul compte 265/418/348 codé en dur repéré dans les tests Houses. Conserver la comparaison exacte des 265 anciennes recettes et des anciennes valeurs d’admission.
4. **Métadonnées du checker.** `prepare_roman_native_validation.py check` valide la géométrie mais ne vérifie actuellement ni `output.generator_version`, ni `resolved.generator_version/catalogue_version`. Avant de l’utiliser comme preuve de migration, ajouter les attentes `architectural-plans-2`, `houses-3` et le catalogue effectivement émis. Ne pas réétiqueter les sorties. Le test Rust proposé possède déjà les gardes plan/générateur et le refus d’un compact marqué houses-2.
5. **Scripts préparatoires à ne pas réutiliser après émission.** `prepare_roman_b13.py` exige intentionnellement 265 recettes et l’absence de B13 ; il sert uniquement avant émission. `check_roman_catalogue_preparation.py` appartient à l’ancienne émission B12 et attend précisément B12 comme seul ajout : ne pas le lancer pour B13. Le manifeste des fixtures doit être rafraîchi avec le catalogue émis ; son hash actuel n’est pas une preuve de cette future émission.

## Fichiers à préparer après GO

| Fichier | Modification limitée |
|---|---|
| `docs/styles_architecturaux_mondiaux_city_mapper.md` | Remplacer la ligne blanche après B12 par la ligne B13, sans décaler les entrées suivantes. |
| `docs/sources/roman-compact-domestic-architecture.md` | Actualiser le statut B13/flag infill ; préserver les limites et la provenance, ainsi que la position du titre B12. |
| `rust/scripts/house-recipes.py` | Affectations B13, tradition, métadonnées avant `INSPIRED_ONLY_IDS`, variantes3/4 et leur affectation. |
| `rust/crates/houses/tests/roman_b13_data.rs` | Copier le test proposé après émission ; y ajouter les assertions des bornes canoniques des trois bundles pour éviter une dérive silencieuse. |
| `rust/crates/houses/tests/catalogue.rs` | Compte couverture348→349 lié au seul nouvel ID. |
| `_agents_blackboard/prepare_roman_native_validation.py` | Assertions explicites de versions pour `check`, aucune tolérance nouvelle. |

Les données générées attendues sont266 recettes/421 styles. L’export admission ne suit qu’après les preuves natives et leur rapport :225 profils/421 variantes, sans réécriture silencieuse des224 profils existants. Un changement de hash global ne justifie pas un changement de géométrie ancien.

## Commandes prêtes, non exécutées

Depuis la racine, **avant émission**, après gel de l’export d’accès courant :

```powershell
python _agents_blackboard/prepare_roman_b13.py
```

Figer alors les trois données et leur SHA, appliquer les changements autorisés ci-dessus, puis depuis la racine :

```powershell
python rust/scripts/house-source.py
python rust/scripts/house-recipes.py
python rust/scripts/house-source.py --check
python rust/scripts/house-recipes.py --check
Copy-Item -LiteralPath _agents_blackboard/roman_b13_data.rs.proposed -Destination rust/crates/houses/tests/roman_b13_data.rs
```

Comparer les265 objets recettes avec la baseline figée avant toute compilation. Après migration du compte349 et ajout des assertions de versions, une seule compilation coordonnée depuis `rust` :

```powershell
cargo test -p magna-urbis-houses --test roman_b13_data --test roman_data --test catalogue -- --nocapture
cargo build -p magna-urbis-houses --example plan_replay
```

Puis depuis la racine, sans service, en conservant le constat distinct d’un éventuel refus de raccord :

```powershell
python _agents_blackboard/prepare_roman_native_validation.py prepare
rust/target/debug/examples/plan_replay.exe _agents_blackboard/roman-native-proposed-fixtures/b13-later-requests.json _agents_blackboard/roman-native-proposed-fixtures/b13-later-plans.json --details _agents_blackboard/roman-native-proposed-fixtures/b13-later-details.json
python _agents_blackboard/prepare_roman_native_validation.py check --batches b13-later
```

Le dernier contrôle doit rester en échec si un intérieur urbain est refusé. Une réussite du test de recette autonome ne suffit pas à annoncer trois maisons raccordables, ni une capacité de ménages, ni une fréquence historique. Aucun benchmark de ville n’est nécessaire pour ce premier palier.
