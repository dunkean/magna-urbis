# Catalogue d'implantation V0.2 — review, adéquation au code, plan

Revue de `Magna_Urbis_V02_catalogue_implantation.md` / `.json` (2026-11-03).

## 1. Review des docs

### Forces
- Modèle conceptuel juste : **site d'activité ≠ settlement ≠ district**, population comptée une fois, faubourg = programme de la ville, promotion en settlement seulement avec ménages permanents. Cohérent avec nos invariants (pas de ville vide, pas de travailleurs fictifs).
- Arbre de décision en 5 questions (ressource → tissu → noyau existant → nuisance → résidents) directement codable.
- JSON propre : les 79 cultures correspondent exactement à `catalogue.json`, aucune référence pendante dans les 50 sites, comptes justes (247 + 49 = 296 archétypes).
- Priorité visuelle aux installations (carrières, terrils, biefs, claies) : c'est ce qui se lit à l'échelle carte.

### Faiblesses
1. **Culture non exploitable** : `culture_families` / `culture_overrides` ne sont que de la prose (`guidance_fr`). Aucune matrice culture × archétype (autorisé / interdit / poids), aucun mode de transport par culture.
2. **25 des 53 grammaires utilisées ne sont pas définies** (`workshop`, `small_hall`, `tower`, `guardhouse`, `pavilion`, `open_surface`, `excavation`, `mound`…).
3. **108 / 296 archétypes orphelins** (`provisional_category_fallback`) : membres d'aucun site, donc sans chemin de génération (artisanat 12, civique 12, fantasy 12, alimentaire 10…).
4. **Triple vocabulaire** avec les annexes de ferme de `catalogue.json` (`barn`, `byre`, `stable`, `granary`, `raised-granary`, `cart-shed`, `dovecote`, `smithy`, `bakehouse`…) et ~20 rôles de `services.json` (`craft.mill`, `craft.tannery`, `craft.smithy`, `craft.potter`, `craft.weaver`, `craft.fullonica`, `storage.granary`, `commerce.caravanserai`, `worship.monastery`…). Les `service_role_claims` sont « indicatifs » : il faut une seule table de correspondance.
5. **Couche ressources supposée mais absente** : `resourceAnchorId`, `outcrop`, `ore_deposit`, `timber_stand` n'existent pas en Rust ; `programme_tokens.json` mappe timber/stone/ore/clay vers `craft.workshop`.
6. **8 modes d'implantation, trop pour démarrer** : les 4 modes `urban_*` existent déjà de fait (`site` de services.json : nucleus/gate/river/quay/downstream/edge/spread, `district`, réserve du port, faubourgs). Le vrai nouveau = `attached_external`, `remote_seasonal`, `network_node`.
7. Détail : une ligne vide (l. 463 du MD) casse le tableau des installations (`tanning_pits`, `tannery_waste_channel` hors tableau).

## 2. Adéquation au code

| Besoin du doc | Existant |
|---|---|
| Rôles urbains non résidentiels | `services.json` : ~100 rôles avec site, district, minPop, per, max |
| Annexes agricoles culturelles | `urban/farmsteads.rs` + `catalogue.json.farmstead` (16 bâtiments, 25 types de ferme) |
| Bâtiments isolés | intents `isolated-mill/inn/tower/shrine/farm`, `roadside-temple` (`urban/kinds.rs:760`) — City Bench seulement, pas posés sur la carte |
| Siting moulin / moulin à vent / tannerie | déjà écrit en TS : `web/src/gen/urban/m4/activities.ts` (bief, seuil, île de moulin, butte exposée, tannerie en aval) → à porter, pas à réinventer |
| Géométrie | `urban/massing.rs` : silhouette du lot élevée, look par rôle/label (`granary`, `mill-house`…) ; pas de générateur par type |
| Routes | 5 classes Rust + profils culturels ; pas de notion de « port d'accès » d'un site non habité |
| Placement territoire | `settlements/placement.rs` ne place que des settlements ; aucune activité territoriale |

Côté urbain ~70 % se branche sur l'existant (rôles + looks de massing). Côté territorial tout est à créer, et la couche ressources manque.

## 3. Avis

Le doc vaut comme **référentiel de nomenclature et de règles**, pas comme spec à implémenter telle quelle.

- **Réduire les grammaires à ~12 looks de massing** : hut, shed/long_shed, barn, storehouse, raised_store, mill (eau/vent), kiln/forge à cheminée, hall/open_hall, tower, courtyard_compound, boathouse, stilt. Les ~300 IDs deviennent des **labels** qui choisissent un look et une taille. À 1 px ≈ 2–5 m, `cheese_house` et `dairy_house` sont identiques.
- **La culture doit être une donnée** : matrice famille → archétypes autorisés/poids/transport (pas de charrois inca/maya/native, bât pour islamic/andean/hadhrami), overrides par culture. Sinon du code spécial par culture.
- **Le gain visible = sites territoriaux + installations**, pas 20 variantes d'atelier en ville. Ce sont aussi eux qui touchent les routes, cœur sensible.

## 4. Plan d'implémentation

| Phase | Contenu | Qui / durée |
|---|---|---|
| **P0 — Données** | `urban/activities.json` réduit à ce que le moteur consomme : archétype → `{look, emprise, label}`, site → `{bâtiments, installations, prédicats de contexte, mode}`, matrice culture → `{autorisés, poids, transport}`. Fusion des vocabulaires (farmstead + services.json → mêmes IDs, renommage direct, pas d'alias). Un test de cohérence. | Sonnet, ½–1 j |
| **P1 — Ville** | Les rôles existants choisissent un archétype selon culture + contexte (`craft.mill` → water/wind/animal gristmill). Rôles de quartier `craft:tanners`, `craft:weavers`. Looks dans `massing.rs` (cheminée de four, roue, long hangar). Aucune nouvelle réservation. 2–3 shots City Bench. | Sonnet, 1–2 j |
| **P2 — Ancres de ressources** | Prédicats dérivés des champs existants (pas de géologie) : chute de rivière → moulin, versant rocheux sans sol → carrière, forêt dense → coupe/charbon, anse abritée → pêche, butte exposée → moulin à vent, col → relais/péage. Déterministe par seed. | Opus, 1 j |
| **P3 — `settlements/activities.rs`** | Étape après `placement`, avant `roads` : budget de sites par settlement, `parentSettlementId`, `residents = 0`, port d'accès. Port de `m4/activities.ts`. Bâtiments via `Kind::Single` + intent. Ports d'accès dans le réseau comme destinations faible importance (`track`/`trail`) **derrière un switch** ; `roads_inspect` : aucune trajectoire existante ne bouge. | Opus + Sonnet, 2–3 j |
| **P4 — Nœuds réseau** | Péage/loge aux ponts existants, auberge/caravansérail le long des highways tous les N km selon le transport culturel, passeur aux franchissements sans pont. | Sonnet, 1 j |
| **P5 — Installations au sol** | Fronts de carrière, haldes, biefs, claies, salines : on livre polygones + sémantique, le rendu terrain reste côté naturel (utilisateur). | à coordonner |
| **P6 — Promotion** | Hameau minier/de pêche → `Hamlet`/`Camp` seulement avec ménages permanents modélisés. | plus tard |

**Hors périmètre pour l'instant** : les 8 modes complets, `autonomous_external` générique, éligibilité historique stricte, les 108 orphelins (restent au référentiel jusqu'à ce qu'un site les réclame).

**Ordre** : P0 → P1 (gain rapide, sans risque routes) → P2 + P3 (saut sur la carte) → P4. Point d'étape après P1 avant P3.

> P2 est à revoir à la lumière du modèle de ressources de Neural Earth (`../infinite_map`) — voir `ressources_transfert_neural_earth.md`.
