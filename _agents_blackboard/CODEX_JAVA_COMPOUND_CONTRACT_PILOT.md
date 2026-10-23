# Deux pavillons sur un lot C — contrat pilote proposé

23 octobre 2026. **Houses et le bridge peuvent déjà recevoir deux demandes natives indépendantes sur deux parts d’un même lot, avec deux fondations. Ils ne savent pas, à eux seuls, valider un ensemble doté d’une cour et d’un chemin commun jusqu’à la rue.** Aucun moteur Compound ni nouvelle attribution historique n’est nécessaire pour tester les deux corps ; la circulation commune reste une responsabilité explicite de la ville.

Le diagnostic de `CODEX_JAVA_COMPOUND_CAPABILITY.md` est confirmé. Le point à préciser est le statut du chemin : `ArchitectureAccess` ne contient que `id/segment/kind/width_m`, sans altitude ni graphe de connexion. Un segment `collective` est un terminus déclaré, pas une preuve que la rue est atteinte, ni que le raccord vertical est praticable.

## Ce qu’Opus doit émettre

1. **Un groupe de site persistant**, hors du contrat natif actuel : identifiant de lot/parent, cible globale, IDs ordonnés des parts, cour commune, surface du chemin commun, accès source à la rue et segments terminaux de chaque part. Le parent conserve le programme global ; il n’est pas une troisième demande de maison.
2. **Deux `PlacementRequest` ordinaires** : IDs uniques, même `parcel_id`, graines stables distinctes, cadastral/buildable/roof_domain strictement inclus dans les droits parentaux et disjoints entre parts et espaces communs. Chaque accès `collective` termine sur la frontière entre sa part et le chemin. `programme.built_area_m2` est réparti, jamais répété ; `floors` reste une préférence. Chaque part demande `composition=detached`, sans pin automatique ajouté. Les choix explicites de modèle/mode/étages restent prioritaires ; ce pilote n’applique aucune scission automatique d’un modèle exact choisi par l’utilisateur.
3. **Une circulation commune réelle** conservée et validée par la ville : continuité au segment source, largeur libre, obstacles, eau, pente/raccords et différence d’altitude à chaque porte finale. Les connecteurs privés natifs doivent s’arrêter à des terminaux distincts. Ne pas placer le chemin dans `reserves` d’une maison : cela interdirait le passage ; le tenir hors de son cadastral. Une simple sortie `open_space` ne protège pas le chemin contre l’occupation des autres demandes.

Le groupe minimal de proposition est déjà matérialisé dans `proposals/java_two_pavilions/compound-site-proposal.json` :

```json
{
  "version": "compound-site-proposal-1",
  "status": "derived_not_native_admitted",
  "parent_request_id": "…/building",
  "parcel_id": "…/parcel-f4efd28eef8589b6",
  "parent_programme": { "built_area_m2": 236.8, "composition": "compound" },
  "parts": [
    { "id": "…/building", "order": 0, "target_footprint_m2": 179.3 },
    { "id": "…/building/pavilion-1", "order": 1, "target_footprint_m2": 57.5 }
  ],
  "common": { "court": "Surface", "walk": "Surface", "source_access": "ArchitectureAccess", "terminal_accesses": [] },
  "capacity_persons": null,
  "households_per_pavilion": null
}
```

Ce JSON est un **sidecar proposé**, pas un nouveau champ que Houses prétend consommer. Les valeurs complètes et les deux requêtes conformes au schéma existant sont dans le dossier. Deux pavillons ne représentent pas deux ménages : le `households=2` historique reste uniquement dans le programme parent, sans recopie ni répartition entre enfants.

## Témoin dérivé, prêt pour un futur petit rejeu

Lot **C index4792**, lot natif074/position56, `parcel-f4efd28eef8589b6`, rôle `dwelling.mansion`. Le lot mesure **574,1321 m²** ; ses deux surfaces preview valent179,26 et57,51 m². La cible parent236,8 est répartie proportionnellement en **179,3+57,5 m²**. Le plan parent figé est B06 et occupe236,7960 m² : ce témoin vise la composition, il ne prétend pas corriger un déficit de surface existant.

Choix explicites du pilote, sans statut de norme historique : chemin commun de **1,2 m** le long d’un bord, cour centrale de **3 m**, parts privées de368,1121 et118,0505 m². La cour fait47,6043 m², le chemin40,3653 m². GEOS vérifie : partition du lot sans différence ni recouvrement, sous-droits inchangés vers l’extérieur, aucun chevauchement avec l’occupation connue, contact de1,2 m avec **l’accès public source exact**. Les formes preview ne sont ni proclamées droits acquis ni réutilisées comme corps natifs.

Le raster source donne pour le chemin173,1789–175,1725 m et une pente maximale5,4681°. Ce n’est donc pas une plateforme commune horizontale. Ces chiffres sont un constat géométrique, **pas une validation de circulation ou d’accessibilité**. Le contrôle final doit raccorder les altitudes obtenues pour chaque bâtiment ; le contrat d’accès actuel ne permet pas de l’exiger au moteur de maison.

`requests.json` reprend le raster, la culture, le mode et les contrôles de source ; les51 occupations admises précédentes du même lot de transport sont fournies comme voisins exacts (corps/cours/circulation/structures et hauteurs conservés). L’ancienne maison parent n’est pas un obstacle. Les anciens indices de pose, dimensions d’occupation du lot entier et previews sont retirés des enfants. Aucune exécution native n’a été faite ; une ou deux parts peuvent encore être refusées.

Commande de validation future, non exécutée ici :

```powershell
web/out/nominal-first-roundoff-isolated-proof/plan_replay.exe _agents_blackboard/proposals/java_two_pavilions/requests.json _agents_blackboard/proposals/java_two_pavilions/native-plans.json --details _agents_blackboard/proposals/java_two_pavilions/native-details.json
```

Valider ensuite séparément : deux corps/sources conservés, somme des emprises et déficit, deux `ground_z_m`, toits et assises, cour/chemin libres, deux connecteurs privés disjoints, raccords au chemin commun, puis extérieurs/intérieurs issus des mêmes archives. Un refus reste un résultat du pilote ; aucune capacité n’est inférée d’une admission.

## Raccord existant et travail restant

- `rust/bridge/urbanArchitecture.ts:37` : le schéma accepte ces deux sites ; aucun tableau `parts` natif n’existe.
- `rust/crates/houses/src/plans.rs:3344` : `plan_batch` impose des IDs uniques et cumule l’occupation dans l’ordre. Il n’impose pas l’unicité de `parcel_id`. Les deux fondations sont calculées dans deux admissions, pas sur une union commune.
- `rust/bridge/architectureBatch.ts:151` : le bridge ajoute les occupations des lots précédents ; une seule invocation continue est nécessaire. Deux générations indépendantes perdraient cette protection. Les cours et connecteurs privés sont aussi des occupations.
- `rust/bridge/architectureEdits.ts:106` : une édition des deux IDs peut être atomique. La première part conserve ici l’ID parent, donc son ancien bâtiment est remplacé au lieu de rester voisin. En cas de refus, l’ancienne scène est conservée. La cohérence du sidecar commun doit être engagée dans la même transaction côté ville.

**Pas de moteur Compound requis pour le test natif.** Le travail minimal côté Opus concerne l’émission/pagination de plusieurs sites pour une allocation, le groupe/espaces communs persistants et leur validation, puis le rendu et l’édition par ID (sans écraser plusieurs bâtiments d’un même `parcel_id`). Le bridge ne produit pas spontanément cette subdivision et ne certifie pas l’accès partagé. Une composition entièrement validée demande donc ce raccord urbain, même si les deux maisons sont déjà consommables.

Provenance et assertions : `proposals/java_two_pavilions/manifest.json` et `checks.json`, script hors produit `web/scripts/java_two_pavilions_fixture.py`. SHA requêtes dérivées : `fceea487b527c997f97e0a9927bfb2057070348e6425caf518a3f8226ebe3506`. Fichiers source actifs et corpus figés inchangés.
