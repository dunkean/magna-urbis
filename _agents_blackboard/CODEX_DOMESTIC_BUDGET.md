# Budget domestique borné — contrat et validation

22 octobre 2026. Suite à `CODEX_DOMESTIC_BUDGET_AUDIT.md`. Cette passe concerne exclusivement les maisons ; aucun changement urbain, lancement de service, build release ou nouveau cas de ville.

## Contrat implémenté

`programme.built_area_m2` cesse d'être purement informatif pour une capacité volontairement étroite : sélection **automatique**, `historical_inspired`, fonction domestic/mixed, adaptation de parcelle autorisée, corps rectangulaire unique issu d'un descripteur Single/Strip + FP-RECT/FP-LONG. Une recette/variante/workshop imposée, un modèle exact, une emprise imposée, le strict et `parcel_fit=false` restent exclus. Les overrides de niveaux/matériaux sont conservés. Les galeries/arcades, encorbellements, cours composées, ailes multiples et autres programmes structurels non pris en charge conservent leur plan natif, avec motif explicite.

La passe intervient **après** l'admission d'un premier plan. Elle garde cette recette et cette variante : aucun nouveau tirage, reclassement de palette ou appel aux 80 essais de synthèse. Le rectangle natif est reconstruit à d'autres dimensions ; les matériaux, niveaux, minima de pièces/escaliers, fraction de cour arrière, largeur du passage et épaisseur des éléments de mitoyenneté sont conservés. Les bornes de dimensions reprennent l'autorisation existante de parcel_fit inspired (minima source et maxima ×2 pour ces familles), sans l'étendre. Les programmes à portée spécifique tels que les galeries sont exclus de cette première capacité. Ce n'est pas une certification structurelle de toutes les cultures.

La cible mesure l'emprise des corps, hors cour/passage/toit et hors somme des étages. Deux fronts réels au maximum, quatre couples largeur/profondeur par front, **24 validations complètes par `visual_with_front` au maximum**. Le helper calcule au plus 8 poses par couple, soit ≤64 poses calculées, dont seules les 24 premières pertinentes sont évaluées par les gardes. La profondeur vient de la cible et des limites, avec un repli réduit pour les lots obliques ; la largeur dépend du vrai accès et des bornes source. Les chemins se raccordent au segment géométrique visé, même si des IDs sont dupliqués. La recherche emploie le domaine constructible et les droits de toit réels, jamais le petit `placement_hint` comme plafond.

Chaque essai repasse les mêmes gardes d'emprise complète, cour, accès, réserves, voisinage, terrain et toit. Aucun polygone bâti n'est découpé pour rentrer dans le lot. Le meilleur plan validé minimise l'écart multiplicatif à la cible, dans les deux sens ; le plan initial reste disponible. Arrêt dans une tolérance de ±10 %. Les diagnostics donnent cible/réalisation/ratio, `target_met`, couples/poses/admissions et signalent un échec borné, sans prétendre prouver l'impossibilité géométrique. Les gardes de réalisation extérieure native restent intactes. La proximité du front ne garantit toujours pas la contiguïté ou des droits mitoyens.

Les anciens tests de pose rigide visent désormais explicitement l'étape d'admission initiale ; de nouveaux tests couvrent le changement volontaire d'aire. Le témoin programme auparavant informatif est conservé sous sélection explicite, et le contrôle strict/exact est distinct. Les tests C1 des fonctions publiques restent inchangés.

## Vérification terminée

Fixture dédiée : `rust/crates/houses/tests/fixtures/domestic-budget-bastide.json`, copie exacte des sites 01/07/05 du corpus figé `web/out/frontage-bastide-proof/requests.json`.

- `cargo test -p magna-urbis-houses --lib plans::tests -- --nocapture` : **15/15**, 0,07 s. 01/07 améliorés avec mêmes paramètres natifs hors dimensions, mêmes niveaux, ratio de cour et passage ; reconstruction extérieure native réussie. Le témoin 05 conserve intégralement le plan de galerie. Un budget abaissé à 30 m² sur 07 prouve aussi la réduction du dépassement, puis le replay natif. Pins recette/variante, strict, exact, adaptation désactivée inchangés. Les anciennes vérifications de front, réserves, trous, eau/terrain et halls C1 passent.
- `cargo test -p magna-urbis-houses --lib programme::tests -- --nocapture` : **4/4**, 0,02 s. Le changement de contrat du budget auto est intentionnel ; la preuve informative est maintenue sous pin explicite.
- Revue indépendante style_index, lecture seule : aucun blocage ; confirmation des bornes ×2 existantes, des exclusions, des overrides retenus et de la reconstruction par `spec`.

Depuis `rust`, un seul replay final hors serveur :

```powershell
cargo run -p magna-urbis-houses --example plan_replay -- ../web/out/frontage-bastide-proof/requests.json ../web/out/frontage-bastide-proof/after-budget/plans.json
```

Depuis `web`, même renderer figé et mêmes caméras :

```powershell
node scripts/frontage-bastide-proof/run.mjs --phase after-budget --render-only
```

**11 acceptés / 1 refus**, inchangés ; 29 ms de calcul natif sur ce seul petit témoin, compilation exclue. Aucune extrapolation de performance. Les étapes `before`, `after`, `after-adapted` sont conservées ; comparaison pertinente du budget : `after-adapted` → `after-budget`.

| Site | Corps avant → après, m² | Cible m² | Résultat |
|---|---:|---:|---|
| 01 | 14,02 → 25,43 | 129,4 | Amélioré, cible non atteinte ; 12 poses, 1 admise |
| 06 | 14,56 → 71,20 | 71,2 | Atteinte ; le petit témoin d'admission ne plafonne plus la maison |
| 07 | 54,54 → 76,50 | 76,5 | Atteinte |
| 08 | 14,03 → 76,67 | 116,0 | Amélioré, plafond de 24 poses atteint, pas de preuve d'optimalité |
| 09 | 12,31 → 39,20 | 39,2 | Atteinte |
| 11 | 14,17 → 97,50 | 97,5 | Atteinte |
| 05 | 305,55 → 305,55 | 60,6 | Galerie/arcade hors capacité, sur-occupation conservée et signalée |

03/04/10/12 sont également hors capacité et restent inchangés. Toutes les recettes/variantes sont conservées. Les 10 proximités au front restent entre 0,35 et 0,60 m ; 10 conserve son repli de 5,70 m. Mesure Shapely : zéro dépassement de corps, toit ou réserves ; erreur maximale aux angles droits 4,58×10⁻¹² degré. Les cours restent ouvertes (minimum d'aire découverte 5,24 m²), sans preuve générale d'habitabilité. La planche PNG a été ouverte : six maisons sont effectivement plus présentes, les bandes 06/08 restent longues et étroites, et les grands lots conservent des vides. Il ne s'agit toujours pas d'une continuité mitoyenne résolue.

Artefacts : `web/out/frontage-bastide-proof/after-budget/{plans.json,metrics.json,prior-stage-comparison.json,runtime.json,contact-sheet.png}` et `gallery.html`. `runtime.json` contient hashes d'entrée/peintre/exécutable/sources. Aucun natif n'est demandé au rendu. Les seules reconstructions extérieures de cette passe sont les témoins ciblés, pas tous les bâtiments des 12 ni toutes les cultures.

Fichiers livrés : `houses/src/plans.rs`, `houses/src/morphology.rs`, ajustement autorisé du test `houses/src/programme.rs`, fixture dédiée. **READY, fichiers libérés**.
