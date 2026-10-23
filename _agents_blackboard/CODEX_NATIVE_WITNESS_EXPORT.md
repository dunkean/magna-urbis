# Export léger des témoins natifs d'admission

22 octobre 2026 — exemple `houses/examples/admission_witnesses.rs`. Source unique : cache `admission_witness::cached_admission_witness(style_id)`, identité `native-admission-witness-1`. **Ces descripteurs ne sont pas ajoutés à urban-admission.json ; aucune génération implicite des417styles.** L’actualisation du seul registre fonctionnel est une opération séparée, documentée dans CODEX_FUNCTIONAL_CHOICES.md.

```text
cargo run -p magna-urbis-houses --example admission_witnesses -- --style AS-ISL-B14::default --style EUR-MED-B07::flat_stone --out ../web/out/native-admission-witness-proof/descriptors.json
```

CLI : 1 à16 `--style recipe::variant` explicites, distincts ; `--out` optionnel (sinon stdout). Absence, inconnu, doublon, flag inconnu ou plage excessive échouent avant construction. Un refus natif est exporté dans `refusals` et donne un code de sortie non nul, sans disparaître du rapport.

## Schéma JSON pour core / Opus

Enveloppe `version="native-admission-witness-descriptors-1"`, `witness_version`, `source_sha256`, `coordinate_frame="unshifted_native_local_xy_z"`, `units="metres"`, `requested_styles`, `witnesses`, `refusals`, `placement_certified=false`. Chaque témoin contient :

- `identity` complet, recopié sans reconstruction : version, catalogue_version, generator_version, style_index_version, source_sha256, style_id, recipe_id, variant_id, seed.
- `geometry` : corps avec footprint/rôle/component_id et tous les niveaux réels (index,z,height,footprint) ; projections exactes des faces de toit ; surfaces/kind/z/height des supports et structures après vraies ouvertures ; cour, circulation et `domains` natifs. `domains` est une collection de polygones qui peuvent se recouvrir, **pas une aire à sommer**.
- `body_footprint`, `roof_footprint`, `bearing_domain`, `entry_wall_solids` : unions locales déjà calculées par le cache, sans recalcul ni simplification dans l'export. Pas de donnée3D lourde `site_features` dupliquée.
- `entrance` (porte du corps) et `site_entry` (portail de l'enclos si présent, sinon porte du corps) : opening[2], passage, width_m, from_z_m, to_z_m. Le passage de site doit être contrôlé séparément, même s'il agrandit les bounds historiques.
- `local_bounds_m` et `envelope_m` : ancien témoin ; `site_bounds_m` et `site_envelope_m` : incluent aussi le passage de site. Aucun décalage de l'origine native.
- `nominal_dimensions_m` : largeur/profondeur figées de source, **pas** dimensions du composé complet. `actual_primary_floors` : niveaux réellement construits du corps principal, ou null. Chaque `body_metrics` donne body_id, `actual_level_count`, aire de footprint et somme des aires structurelles de ses niveaux.
- `actual_body_footprint_area_m2` : aire de l'union native des corps. `actual_structural_floor_area_m2` : somme des surfaces structurelles par niveau et corps, murs compris ; ni surface utile ni capacité. `capacity=null`, `placement_certified=false`.

Les coordonnées sont les f64 natifs sérialisés en décimal, sans quantification, arrondi cartographique, redessin ou compression géométrique. `resolved` et `structural_unit` sont exclus par le DTO typé emprunté ; l'exemple ne sérialise jamais `AdmissionWitness` en entier. Un `BufWriter` évite de créer un grand Value JSON/copier toute la scène.

Le cache retourne des `Arc<AdmissionWitness>` : l'exemple conserve uniquement les Arcs explicitement demandés pendant l'écriture, pour que leur éviction éventuelle du LRU ne puisse invalider les champs empruntés. Le `packed` natif du cache n'est pas exporté non plus. La preuve reste limitée à2styles ; les16styles CLI maximum ne sont pas une mesure de heap garanti.

## Contrat de consommation

Le descripteur est **un plan minimum figé, size=1, avec sa propre graine**, pas une famille de toutes les tailles ni un tirage maison de requête. Core peut chercher une pose rigide à partir de sa vraie géométrie. Houses doit comparer toute l'identité puis reprendre le même cache, sans rerésolution/maillage ; requête `native_minimum_candidates` prévue par root : `{identity, transform, access_id, contact:Point}`, au plus4. Le point de contact et l'accès doivent être explicites. Les contrôles finaux du terrain, assise, réserves, voisins, toit, domaine constructible et raccord d'accès restent obligatoires.

Ne pas confondre les bornes de paramètres avec les niveaux gelés : B07/flat_stone possède un témoin principal à1niveau et une tour à3niveaux, alors que l'intersection de contraintes de sa source vaut[2,2]. Un override dur de2niveaux ne peut pas accepter ce témoin par simple comparaison avec la plage source. Mode/époque/overrides, pins/exact, taille, empreinte imposée et garde d'activation inspired domestique restent à vérifier au raccord, indépendamment du hash.

## Preuve ciblée

Export terminé depuis l’exemple natif compilé par root : `web/out/native-admission-witness-proof/descriptors.json`, **56 951 octets JSON indenté, 2 témoins, 0 refus**. `report.json` adjacent contient le résultat du vérificateur Python indépendant : hash SHA256 des recettes exact, nombres finis, aires recalculées depuis les polygones, bornes incluant le passage de site, absence récursive de resolved/structural_unit/packed/site_features.

| Style | Corps / niveaux réels | Emprise union | Aire structurelle cumulée |
|---|---|---|---|
| AS-ISL-B14::default | 1 corps / [1] | 27 m² | 27 m² |
| EUR-MED-B07::flat_stone | 2 corps / [1,3] | 32,258689017172216 m² | 73,84588900000001 m² |

Le corps principal possède réellement 1 niveau dans les deux témoins. B14 contient 12 projections de faces de toit et 2 structures ; B07 en contient 22 et 5. Les métriques et coordonnées complètes restent dans le JSON, sans arrondi de génération. La taille sérialisée n’est pas une mesure de heap ni une capacité d’occupation. Aucun benchmark, serveur ou run de ville.
