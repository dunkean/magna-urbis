# Tranche proposée — besoin utile indicatif et brut retenu

**Proposition de contrat seulement, sans extension de code.** Root a demandé de distinguer masse, modèle fonctionnel et capacité native avant tout calcul/reallocation. Le nettoyage insular séparé conserve les paramètres génériques actuels ; il ne calibre pas un standard historique.

## Trois objets indépendants

- `programme.built_area_m2` reste617.9 pour C1358 : souhait de masse projetée, issu du preview. Le rapport `programme_outcome.body_footprint` garde sa cible, son réel final, déficit et tolérance ±10 %.
- Nouveau `programme.housing_floor_need?` : besoin **utile indicatif du modèle d’allocation**, avec unité, formule et provenance. Une donnée ancienne sans modèle reste inconnue ; ne pas la reconstituer automatiquement depuis ménages actuels, profil courant ou taille nominale.
- Nouveau sous-rapport facultatif `programme_outcome.housing_floor?` : brut géométrique des niveaux retenus, comparaison nécessaire à ce modèle, utile réel inconnu et ménages logés inconnus. Aucun statut « capacité atteinte ».

## Champs proposés dans la requête

```json
{
  "housing_floor_need": {
    "version": "indicative-housing-floor-1",
    "unit": "useful_floor_m2",
    "scope": "housing_in_body_levels",
    "requested_m2": 162,
    "allocated_households": 3,
    "basis": "allocation_households_times_wealth_scaled_floor_allowance",
    "model": {
      "family": "insular",
      "profile_provenance": "generic-compatibility-defaults",
      "calibration": "not-culture-calibrated",
      "floor_m2_per_household": 60,
      "wealth": 0.25,
      "wealth_factor": 0.9,
      "effective_floor_m2_per_household": 54,
      "persons_per_household": 4.5
    }
  }
}
```

162 est ici une conséquence arithmétique du modèle générique, **pas une nouvelle norme**, une emprise à atteindre ou une correction du617.9. La formule reprend `programme::household_capacity` :60×(0.7+0.8×0.25)×3. Le facteur d’étages intervient dans l’estimation de capacité des lots, pas dans ce besoin utile total ; ne pas diviser requested_m2 par les étages souhaités. Un étage ne convertit pas utile en emprise brute. Les valeurs non génériques devront porter leur propre provenance sans changer la sémantique de l’unité.

Émission Core uniquement pour une allocation domestic/mixed positive, finie, avec profil numérique valide. Source du nombre de ménages : l’allocation conservée, pas `capacity`, pas le plafond du lot ni un nouveau partage. Garder le besoin domestic de ménages au sein d’un mixed distinct du besoin de commerce : aucune part de boutique inventée. Les ménages et leur population ne sont pas réduits si le modèle paraît incompatible. Les0/absents ou autres fonctions n’acquièrent pas un modèle par défaut côté Houses.

Validation Houses : version/unité/scope connus, scalaires finis et positifs selon champ ; concordance de allocated_households avec programme.households ; requested_m2 cohérent avec les facteurs transmis. Les erreurs d’un modèle fourni sont explicites, jamais converties silencieusement en succès ou en une cible abaissée. Les anciens champs et requêtes sans modèle gardent exactement leur comportement. Pas de nouveau hard pin ou budget géométrique dans cette tranche.

## Brut mesurable et limites

La donnée finale existe dans `PlanBuilding.volumes[*].levels[*]` : footprint exact, altitude et hauteur réelles de chaque niveau (`plans.rs:1405–1427`). `LayoutPlan.BodySpec.levels` varie réellement par corps/niveau ; `spec` réduit par exemple les étages en retrait (`layouts.rs:346–357`), et les puits sont déjà retranchés de tous les niveaux (`layouts.rs:310–315`). Le `Level.floor` détaillé après construction intérieure est distinct de ce footprint brut ; ne pas appeler ce dernier surface utile.

Méthode proposée :

1. Après le choix/finaliseur, parcourir **les niveaux du bâtiment final retenu**, sans unpack natif, resolver, builder, portes ni nouvelle recherche. Ne pas réutiliser une somme intermédiaire abandonnée.
2. Grouper les footprints coplanaires à **la même altitude native exacte** ; normaliser seulement−0/+0. Employer l’altitude, pas l’index local : deux corps d’index0 peuvent avoir des bases différentes ; deux étages de hauteur différente ne se correspondent pas nécessairement. Pas de regroupement selon un epsilon inventé.
3. Unir les footprints de chaque plancher coplanaire pour éviter le double compte de corps superposés ; conserver trous/puits. Additionner les aires des planchers à des altitudes différentes. Les volumes superposés verticalement comptent donc plusieurs niveaux ; une annexe à un seul niveau reste comptée une fois.
4. Compter tous les niveaux de corps, y compris murs/communs/espaces mixed, comme **majorant optimiste** de l’utile de logement qui pourrait exister dans ces corps. Ne pas attribuer une fraction arbitraire au logement ni retrancher un ratio utile/brut. Un commun déjà dans un footprint n’est pas ajouté une seconde fois.
5. Ne pas ajouter toit, cour, jardin, chemin, emprise de fondation, support sur poteaux ni autres features à une surface habitable. Un plancher de corps surélevé ou enterré compte à son altitude réelle ; son aire de support au sol ne crée pas un niveau supplémentaire. Galeries/terrasses/planchers de features hors corps sont signalés hors périmètre du modèle `housing_in_body_levels` ; aucune borne globale sur tout espace utile possible hors de ce scope. Si l’inventaire requis est absent/incohérent/non reconnu, mesure et comparaison inconnues, sans reconstruction géométrique implicite.

Les footprints du PLAN sont une mesure de géométrie retenue, pas une certification des sols, murs, portails, accès, intérieurs ou usage. Une hauteur faible, une pièce partagée ou un étage de service peut rendre l’utile réel inférieur au brut, jamais connu grâce à ce rapport. Le nom historique `useful_area_m2` contient actuellement une somme brute et demeure intact pour compatibilité ; le nouveau champ est explicitement nommé `gross_floor_m2`.

## Champs proposés dans le rapport

```json
{
  "housing_floor": {
    "version": "plan-housing-floor-outcome-1",
    "scope": "housing_in_body_levels",
    "need_model": { "version": "indicative-housing-floor-1" },
    "requested_useful_m2": 162,
    "gross_floor_m2": 4.0602250024,
    "measurement": "retained_level_footprint_union_per_exact_elevation",
    "necessary_area_status": "insufficient_gross",
    "useful_shortfall_lower_bound_m2": 157.9397749976,
    "actual_useful_m2": null,
    "functional_certification": "unknown"
  }
}
```

`need_model` doit conserver le modèle/scalaires whitelistés complet, pas seulement le fragment version montré ici. Le corps n’ajoute aucun parent/archive au DTO. L’exemple de C1358 est conditionnel à une **nouvelle** requête portant ce modèle ; l’ancienne archive ne sera pas créditée d’un modèle qu’elle n’avait pas.

Si les mesures sont connues, la borne nécessaire est `max(0, requested_useful_m2 - gross_floor_m2)`. Statuts proposés : `insufficient_gross` quand cette borne est positive ; `not_disproved_by_gross` sinon ; `unknown` sans modèle/mesure applicable. Une borne0 signifie seulement absence de manque démontré par le brut, jamais utile satisfait ou ménages logés. Pas de tolérance ±10 % pour cette implication nécessaire : la tolérance de masse reste exclusivement dans body_footprint. L’arrondi UI ne modifie pas le calcul ni ne transforme un faible déficit en0 certifié. Le rapport ménages garde `housed:null` et `capacity_status:unknown` dans tous les cas.

## Tests proposés avant extension

- Core : nouvelle requête3 ménages à richesse0.25 transmet162 utile indicatif, profil insular explicitement générique ; conserve exactement617.9, [1,1], composition, seed et allocation. Population/demandes inchangées.0/absence d’allocation ne crée pas un modèle.
- Request validation : modèle ancien absent accepté sans inférence ; version/unité/scope inconnus, non-fini, facteur incohérent, ménages discordants refusés explicitement ; aucun fallback silencieux.
- Géométrie : deux niveaux hétérogènes100+60=160 plutôt que100×2 ; corps coplanaires80+60 avec recouvrement20 donnent120 ; les mêmes aires à altitudes distinctes donnent140 ; index identiques à altitudes différentes non fusionnés ;−0/+0 unifiés.
- Trous, puits, corps en retrait, annexe à un niveau et base surélevée/enterrée : comparaison à leurs surfaces exactes. Toits/cours/chemins/fondations ne comptent pas. Features hors scope conservent l’information de limitation ; inventaire manquant→inconnu.
- Commun/mixed : le brut inclut optimistement ces surfaces sans ratio inventé ; il ne renseigne jamais l’utile ni les ménages. Si brut suffisant, statut `not_disproved_by_gross`, pas `within_tolerance`/`met`.
- C1358 : masse actuelle4.060225 reste inchangée ; besoin indicatif162 avec nouveau modèle→borne de manque157.939775, utile et capacité inconnus. Sans modèle ancien, aucune borne fonctionnelle déduite malgré le déficit de masse613.839775.
- Après toutes récupérations/finalisation : même bâtiment, géométrie, entrée, source, ordre, seed, archives, diagnostics antérieurs et refus ; seul le nouveau rapport change. Résultat abandonné volontairement différent du final pour attraper un calcul prématuré.
- Sérialisation/TS/froid : anciens plans sans nouveaux champs restent lisibles ; transit exact modèle/report par chunks/export/import ; copie immuable de scalaires seulement, aucun parent ; UI présente séparément masse, brut, besoin utile indicatif et capacité inconnue.

Cette tranche n’ajoute aucun solveur/reallocation et ne répare aucune maison. Elle fournit d’abord une dette fonctionnelle nécessaire correctement nommée. Toute correction constructive ultérieure devra conserver le modèle et la population, reporter la dette restante et valider réellement terrain/assise/portes ; le seuil0.75m reste inchangé et le manque de grammaire compound reste ouvert.
