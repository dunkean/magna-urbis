# B13 — variantes natives absentes du souhait urbain d'étages

23 octobre 2026. Audit lecture seule du code courant, destiné au raccord Opus R5R. Aucun fichier core/bridge/Opus modifié, aucun Cargo ni rejeu de ville. Les valeurs ci-dessous proviennent directement de `houses/data/urban-admission.json` (225 profils par recette, 421 couples recette/variante).

## Écart concret

`core/src/urban/building_sites.rs::native_profiles` (vers166) désérialise seulement le champ racine `profiles`. Sa structure `NativeProfile` ne porte ni `style_id` ni `variant_id`. Le champ `feasibility.profiles` est donc ignoré, comme dans les lecteurs `culture.rs::AdmissionCatalogue` et `parcels/admission.rs::Catalogue`.

| Entrée B13 exportée | Niveaux | Témoin natif complet | Accès | Lu par `native_fit` |
|---|---|---|---|---|
| `profiles`: default | [2,2] | 6,65 ×10,20m | 0,85m | Oui |
| `feasibility`: default | [2,2] | 6,65 ×10,20m | 0,85m | Non |
| `feasibility`: three_storeys | [3,3] | 6,65 ×10,20m | 0,85m | Non |
| `feasibility`: four_storeys | [4,4] | 6,65 ×10,20m | 0,85m | Non |

Les trois variantes sont `supported`, Strip/RECT, rôle `communal_dwelling`, période A, `inspired_only=true`, tradition `roman_urban`. Ce sont des témoins sans intérieurs et non des certificats de placement ou de capacité.

`tall_collective` (vers236) exige `floors[1]>=3` et Strip/cour. B13/default ne passe donc jamais. Dans MED-ANT, le seul profil racine qui passe actuellement est B04/courtyard, [3,5], enveloppe33,5×37,7m et accès1,5m. Le contrôle urbain lui ajoute0,6m aux deux dimensions :34,1×38,3m. Lorsqu'un lot ne tient pas ce grand modèle, `request_one` (vers776 puis824–834) émet le maximum du tissu `[top,top]`, souvent[2,2], bien qu'un témoin B13 à3/4 niveaux puisse tenir dans7,25×10,80m avec la même marge urbaine. Cette conclusion ne prétend pas que tous ces petits lots passent les contraintes natives finales.

## Contrat transmis à Houses

`native_fit` applique pack, tradition et période puis appelle `parcels.rs::parcel_envelope` (vers374) sur le vrai contour, ses fronts et l'accès, avec largeur/profondeur du témoin +0,6m. C'est un contrôle géométrique de rectangle, sans vérification native de terrain, de fondation, d'intérieur ni de portail. Houses reçoit toujours les vrais cadastre/buildable/toit/réserves, les segments publics et le terrain raster +limite d'assise0,75m ; ces contrôles restent nécessaires.

L'identité du modèle retourné par `native_fit` et son rectangle ne sont pas transmis. Seul le souhait `programme.floors` en est issu. `placement_hint` vient séparément du profil culturel d'admission courant, qui peut être différent ; il reste consultatif. Aucun `native_minimum_candidates` n'est émis par ce chemin.

Pour domestic/mixed, `request_one` (vers873–890) émet bien `config.recipe=null`, `overrides.floors=null` et aucune variante imposée, avec `variation=0,65`. Houses (`plans.rs::plan_one_initial`, vers1927–2024) inclut alors les variantes et utilise `ArchitectureProgramme::preferred_floor` après classement, sans redéfinir les bornes source. B13 est donc déjà sélectionnable automatiquement en inspired ; le souhait[2,2] favorise seulement sa variante default. Il n'est pas nécessaire d'ajouter un pin B13 pour rendre3/4 niveaux accessibles.

## Raccord minimal à confier à Opus

1. Pour la décision de hauteur collective, lire les **couples recette/variante** de `feasibility.profiles` : `style_id`, `variant_id`, rôle, `primary_floors`, `minimum_native.status/envelope_m/access_width_m`, pack/tradition/temporal et `inspired_only`. Conserver chaque témoin séparé ; ne pas étendre artificiellement `profiles/default.floors` à[2,4].
2. Tester le vrai `parcel_envelope` de chaque variante admissible. Puis choisir le souhait de hauteur parmi les niveaux réellement disponibles et géométriquement admissibles, selon pression. Une simple substitution du lecteur suivie du premier profil trié serait insuffisante : les deux enveloppes3/4 sont identiques, et l'ordre des variantes exportées est default/four/three ; le premier retenu pourrait imposer4 partout. B13 ne justifie jamais5 niveaux.
3. Conserver le contrat actuel sans pin : souhait d'étages et composition pour Houses, qui garde sa sélection bornée et ses gardes finales. Un témoin minimal n'est ni une cible d'aire ni une promesse d'intérieur. Les priorités des vrais contrôles utilisateurs et programmes fonctionnels restent inchangées.

**Garde de mode à aligner lors de ce raccord :** `native_fit` n'a pas de filtre `strict && inspired_only`. Son booléen strict intervient seulement dans une branche de compatibilité chronologique. Une source `inspired_only=true` avec `eras=[A]`, comme B13, passe donc son test de période en strict ; `houses::style_index::StyleQuery::permits` la refuse pourtant inconditionnellement dans ce mode. Le lecteur de variantes doit exclure `strict && inspired_only` avant de proposer ses niveaux. Ce n'est pas une raison d'assouplir le filtre Houses.

Preuve ciblée à prévoir côté propriétaire : un même lot romain assez petit pour refuser B04 mais assez grand pour le témoin B13, des souhaits3 puis4 et un contrôle strict ; contrôler la demande JSON sans pin et l'admission Houses réelle. Aucun nouveau benchmark de ville n'est nécessaire pour établir ce raccord.
