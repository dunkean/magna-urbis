# Livraison DATA Java — 22 octobre 2026

**Livré : deux recettes natives ordinaires, un index de tradition commun et un garde historique explicite.** Catalogue `atlas-houses-3` : 264 recettes, 347 entrées B classifiées. Les 262 anciens jeux paramètres/variantes/poids sont identiques à l'instantané d'avant cette tranche (`java-data-regression-proof.json`). Aucun moteur, plan, placement urbain ou serveur modifié pour créer ces deux modèles.

| Recette | Modèle natif | Plages artistiques du corps | Tradition / régime |
|---|---|---|---|
| AS-ISL-B06 Joglo | profil existant conservé | inchangées | javanese ; régime existant conservé |
| AS-ISL-B14 Kampung | Single, FP-RECT, RF-GABLE ; un corps et un niveau | 4,5–7,5 × 6–11 m | javanese ; inspired_only=true |
| AS-ISL-B15 Limasan | Single, FP-RECT, RF-HIP ; un corps et un niveau | 5–8 × 9–13 m | javanese ; inspired_only=true |

Bois porteur, remplissage bambou, tuiles d'argile et base de pierre sont déclarés comme assemblage inspiré. Aucune annexe, galerie, pavillon ni cour balinaise n'est copiée. Les dimensions, hauteurs, angles, pièces et poids sont artistiques ; les exemples mesurés et leurs fonctions restent séparés dans `docs/sources/javanese-domestic-architecture.md`. Les deux nouvelles recettes n'ont ni dates ni ère anciennes inventées : `eras=[]`, `undated_tradition`, confiance stylized.

`Recipe.inspired_only` est optionnel en entrée, faux par défaut. `Catalogue::admissible` et `StyleQuery` excluent B14/B15 en historique strict, y compris avec pin explicite ; ce garde est distinct de `late_only`, donc le mode inspiré sans `allow_late` les accepte. Un filtre de période précise continue de les exclure faute de preuve chronologique. `tradition_id` est facultatif et exact ; la facette et le cache de requête l'incluent. Seuls B06/B14/B15 déclarent `javanese`, sans détourner S05 (contexte de settlement) ni inclure B05 Bali.

## Fichiers et branchements

- Source durable + deux lignes mapper ; `house-source.py`, `house-recipes.py` ; inventaire et recettes régénérés.
- Rust `catalogue.rs`, `style_index.rs`, métadonnées `admission.rs` ; contrats TS `housesContract.ts` / `buildingStyles.ts` ; tests catalogue et nouveau `javanese_data.rs`.
- `examples/admission.rs` exporte le registre commun fourni par root : `cultural_palettes: { version, mappings }`. `urban-admission.json` régénéré avec ce bloc et les métadonnées de tradition/régime.
- `admission.rs` est libéré à java_sources pour l'extraction faisabilité #23 ; `examples/admission.rs` est libéré à root. Le hook plans et le choix d'admission core sont coordonnés séparément : cette tranche ne se présente pas comme validation d'une ville javanaise complète.

## Vérification bornée

- `python rust/scripts/house-source.py --check` et `house-recipes.py --check` : verts.
- `cargo test -p magna-urbis-houses --test javanese_data --test catalogue` : **13/13**.
- `cargo test -p magna-urbis-houses --lib style_index::tests` : **10/10**.
- Binaire de test courant, filtres `cultural_palettes::tests` : **1/1**, `admission::tests` : **2/2** (export comparé aux squelettes natifs minimums).
- Export : `cargo run -p magna-urbis-houses --example admission -- crates/houses/data/urban-admission.json` réussi.
- Deux générations réelles par `examples/houses.exe AS-ISL-B14` / `AS-ISL-B15`, géométrie JSON conservée dans `java-data-native/`. Rejeu natif déterministe testé. Planche `java-data-native/native-roofs.png` issue des faces et arêtes natives, inspectée : deux pans contre quatre pans avec vrai faîtage, même échelle. Aucun rendu de ville, overlay ou dessin de substitution.

Limites : ni fréquence ethnographique, ni capacité de plusieurs ménages, ni topologie complète d'une demeure javanaise ne sont déduites de ces recettes simples. L'ajout de candidats peut changer les tirages automatiques du pack large ; les pins et les anciennes données physiques restent inchangés. Le changement de version de catalogue est explicite pour les archives natives.
