# Choix fonctionnels Java — contrat natif borné

22 octobre 2026. Houses et raccord `plan_one_initial` livrés ; raccord producteur core restant. Registre actualisé après les nouveaux services insulaires.

## Provenance des demandes archivées

Les trois dernières demandes de `web/out/javanese-user-10-8791/houses-targeted/original-requests.json` correspondent aux offsets 7/13/15. Le bloc admission_recipe/config de building_sites.rs émettait le pin résidentiel et les étages automatiques durs pour les fonctions non domestiques hors C1, avant les overrides.

| Offset | Rôle / fonction / composition archivés | Pin ville | Limite |
|---|---|---|---|
| 7 | commerce.dharamshala / collective / hall | B06 Joglo | Cible bâtie 369,4 m² ; pas un choix utilisateur démontré |
| 13 | worship.shrine / collective / religious | B05 Bali | Aucun temple javanais natif ; B08 candi reste hors Houses |
| 15 | storage.granary / warehouse / hall | B05 Bali | Cible bâtie 700 m² ; B04 est toraja |

Ces demandes ne transportent pas l’origine du pin. **Houses ne supprime jamais un pin reçu.** Le producteur doit omettre ses propres pins artificiels pour les seules règles enregistrées, puis appliquer les vrais overrides utilisateur. Aucun nettoyage rétrospectif par heuristique B05/B06.

## Registre courant et compatibilité

`houses/src/functional_choices.rs` exporte `functional-choices-2` dans `urban-admission.json.functional_choices`. Règles exactes : culture javanese-courts, pack AS-ISL, rôle, fonction, composition, modes inspired/fantasy.

| ID de règle | Rôle / fonction / composition | Usage déclaré |
|---|---|---|
| java-inn-envelope-v1 | commerce.inn / collective / inn | Enveloppe simple de logement partagé |
| java-storage-envelope-v1 | storage.granary / warehouse / hall | Enveloppe simple de stockage |
| java-shared-lodging-envelope-v1 | commerce.dharamshala / collective / hall | Ancien alias, legacy_alias_for: java-inn-envelope-v1 |

Le premier triplet correspond à services.json, famille insular, et building_sites::composition_of : label pesanggrahan, fonction collective, composition inn. L’ancien triplet reste exclusivement pour les demandes sauvegardées, avec diagnostic explicite ; aucune attribution de dharamshala javanais. Son ordre de sources et son tirage sont inchangés.

Toutes les règles utilisent B14/default et B15/default comme **enveloppes simples inspirées**, avec provenance, tradition, confiance stylized, dates/ères et bornes dérivées du catalogue. Aucune auberge, pesanggrahan ou granary complet, aucun intérieur ou capacité fonctionnelle n’est certifié. B06 reste exclu : le constructeur non domestique efface four_master_posts/open_sides ; un autre adaptateur serait nécessaire. Rôles civiques, thermaux et religieux non enregistrés ; aucune substitution Bali.

## API et admission

```rust
registry() -> Result<&'static FunctionalChoiceRegistry, String>
choices_for_request(&PlacementRequest, exact: bool, limit: usize)
    -> Result<FunctionalSelection, String>
resolve_candidate(&PlacementRequest, &FunctionalCandidate, body_span_m: [f64; 2])
    -> Result<ResolvedArchitecture, String>
```

La sélection retourne explicit, unregistered, incompatible ou available, les diagnostics et au plus 4 candidats distincts (2 ici), pondérés avec le RNG natif déterministe. Recette/variante/workshop/exact et fitting désactivé sont prioritaires. Époque, mode, taille, typologie et overrides passent les validateurs canoniques. Aucun tirage géométrique pendant la sélection.

La résolution revérifie l’autorisation et conserve recette/variante/seed. Un corps simple est construit dans les bornes source, sans extension ×2 ; l’aire réelle est mesurée et un écart à la cible supérieur à 1 % est refusé. Plages : 27–82,5 m² pour Kampung, 45–104 m² pour Limasan, ×size². Les cibles archivées 369,4 et 700 m² restent incompatibles après suppression des pins ; aucune petite maison n’est présentée comme programme complet.

plan_one_initial essaie ensuite les trois poses rigides existantes avec toutes les gardes terrain, réserves, voisins, toits, emprise et accès. Échec → prochaine source enregistrée, sans remorphologie domestique. Emprise imposée refusée faute d’adaptateur. Incompatible refuse sans palette domestique de secours ; explicit garde la voie demandée/C1 ; unregistered conserve le comportement existant avec diagnostic de fonction non certifiée et preview urbain indicatif. Un config.pack/mode explicite différent du contexte est refusé avant normalisation. Aucun changement engine/core dans cette tranche.

## Vérification et export ciblé

Avant l’actualisation insulaire : **3/3 tests verts**, dont raccord plans exécuté par root en 30 ms. Fixture originale conservée ; pins, grands budgets et religieux refusés honnêtement. Les contre-factuels de 60 m² vérifient corps, seed/source, extérieur natif, archive/rejeu, réserves, site et overrides. Ils ne représentent pas l’acceptation des demandes d’origine.

Actualisation vérifiée par root : **4/4 tests verts**, dont le catalogue de services courant, l’alias déterministe et les fonction/composition exactes ; les deux tests natifs de résolution/pose utilisent maintenant commerce.inn / collective / inn. Export natif ciblé et fusion terminés : 3 règles, 223 profils et 417 faisabilités conservés, avec validation du hash source et des octets extérieurs au champ remplacé. Aucun run de ville, serveur ou build release ; Java 100k reste non validé.

Commandes exécutées après compilation commune de l’exemple :

```powershell
rust/target/debug/examples/admission.exe --functional-choices-only _agents_blackboard/functional-choices-native.json
python _agents_blackboard/refresh_functional_choices_export.py
```

L’option exporte uniquement le registre, sans calcul de minimum ni faisabilité. Le script vérifie hash source et version du catalogue, puis remplace le seul champ functional_choices en conservant tous les octets extérieurs, notamment les 223 profils et 417 faisabilités. Le raccord core doit consulter ces règles avant les overrides, sans retrait global des pins non domestiques.
