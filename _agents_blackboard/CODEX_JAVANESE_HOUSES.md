# Java — programme, capacité et assemblages maisons

Audit source du 22 octobre 2026, Codex morphology. Périmètre initial en lecture seule ; aucun changement de mapping culturel ou de programme urbain. Capture exacte de référence : `web/out/javanese-user-10-8791/` ; 1 752 sites, 484 plans, 1 261 refus, 7 espaces ouverts sur le moteur gelé 8791. Ces totaux ne décrivent pas le moteur source courant.

## Contrat et limites constatées

- `houses/src/programme.rs::ArchitectureProgramme.households` est une métadonnée finie positive, pas une capacité certifiée ni un paramètre de dimensionnement. La transmission depuis `Allocation` vient d'être ajoutée dans `core/urban/building_sites.rs::programme_of` ; la capture 8791 la précède. `plans.rs` garde `domestic_units=0` et indique que la capacité est inconnue.
- Plusieurs corps ne prouvent pas plusieurs ménages. Sans cellules structurelles explicites, `engine.rs` donne aux pièces des corps d'une même unité le même `household_id`. Ni le nombre de pavillons ni celui des pièces ne permet de convertir les cinq ménages estimés côté ville en 35 habitants effectivement logés.
- La préférence capturée `row` n'est pas pertinente pour AS-ISL, qui ne déclare aucune `Layout::Strip`. Le mapping/intent urbain appartient à Opus. Corriger cet intent ne rend pas une capacité géométrique inexistante disponible.
- Dans les recettes AS-ISL implémentées, B05 « Maison balinaise en concession » est le seul ensemble domestique composé et clos : `Kancha`, 4–8 pavillons, cour, enceinte et portail. B06 « Joglo javanais » reste un seul corps carré/rectangulaire ; ses annexes existent dans la prose source mais pas dans les composants déclarés. Les maisons sur pilotis et les longhouses ne fournissent pas un assemblage javanais substituable implicitement.
- La source locale est `docs/styles_architecturaux_mondiaux_city_mapper.md`, section 20. Elle distingue le village balinais de concessions du village javanais de cours (maison principale et ateliers). B05 n'est donc pas une preuve d'authenticité javanaise ; son éventuelle sélection reste celle de la palette existante, sans nouvelle extension culturelle.

## Géométrie existante et correction envisageable

`layouts.rs` distribue Kancha dans quatre bandes proportionnelles fixes puis une rangée intérieure. Pour quatre corps ou plus, le dégagement force notamment `depth >= 2.8/0.08`, soit 35,002 m après arrondi, au-delà de la plage source B05 de 20–30 m. Les corps supplémentaires peuvent encore accroître largeur/profondeur. Une surface de lot de 700–2 000 m² ne garantit donc pas l'admission. `morphology.rs` ne propose actuellement aucun opérateur contraint Kancha ; le récent budget domestique rectangle/strip l'exclut également.

Premier opérateur défendable : recomposer un ensemble B05 **déjà sélectionné**, en conservant ses vrais corps, leur nombre, leurs paramètres constructifs et toits, autour d'une cour accessible avec enceinte/portail. Recherche déterministe bornée, corps orthogonaux entiers, aucun découpage en biseau, aucun corps supprimé, aucune capacité de ménages inventée. Repli sur le natif validé ou refus explicite si les droits et dimensions réelles ne permettent pas l'ensemble. Il faut d'abord démontrer sur les refus capturés si ce défaut est décisif ; pente/fondation, accès et manque de place ne doivent pas être contournés.

Pour B06 proprement javanais, ajouter des annexes demande d'abord un programme explicite documenté (rôles, quantités, domaines dimensionnels). Le seul objectif de population ne suffit pas pour inventer ces corps. Les essais suivants portent sur quelques requêtes exactes capturées, pas sur une nouvelle ville ni sur un taux global extrapolé.

## Rejeu ciblé

Six refus originaux, offsets 0/1/4/7/13/15 de `004-buildingSitesPage-response.json`, sont conservés avec leurs requêtes et raisons dans `targeted-refusals.json`. Rejeu par `houses/examples/plan_replay.rs` en DEV, processus ponctuel sans serveur. Fichiers détaillés dans `web/out/javanese-user-10-8791/houses-targeted/`.

Source maisons courante, requêtes originales inchangées : **2 admis / 4 refus** en 15 ms (petit diagnostic, aucune mesure de scale-up). Les deux admissions 0 et 4 proviennent des poses au front déjà livrées, sans changement pendant cet audit. Leurs dénivelés d'assise réels sont 0,440 et 0,657 m, pour une limite de 0,750 m.

Un contre-factuel distinct remplace uniquement le terrain par un plan horizontal : les six sites sont alors admis. Les empreintes ainsi obtenues ont ensuite été réévaluées sur le **raster original**, avec la même formule bilinéaire et les extrema quadratiques de bord que Rust (`measure_foundations.py`, découpe Shapely susceptible de très petits écarts numériques).

| Offset / parcelle | Recette témoin | Corps m² | Dénivelé m | Pente maximale | Conclusion bornée |
| --- | --- | ---: | ---: | ---: | --- |
| 1 / `9302dfb000bb13ee` | B03/default | 185,920 | 1,290 | 4,62° | Assise trop étendue à cette pose ; message final de palette trompeur |
| 7 / `d41d47fef7e25faf` | B06/default | 307,71 | 1,377 | 4,98° | Assise dépasse 0,75 m ; plafond 12° non atteint |
| 13 / `2ce21b5411ae8560` | B05/default | 644,34 | 2,341 | 4,18° | Idem ; pin collectif religieux |
| 15 / `fcc8237251c534f0` | B05/default | 548,78 | 1,684 | 3,64° | Idem ; pin entrepôt |

Les deux pins B05 sont transformés en un corps `Single` par l'actuel nettoyage non domestique de `resolve_urban_architecture`. Ils **ne testent pas** le layout domestique Kancha et ne doivent pas déclencher sa recomposition. **Provenance clarifiée le 22 octobre : les trois pins des offsets7/13/15 sont émis automatiquement par `building_sites.rs` pour les fonctions non domestiques ; ce ne sont pas des choix utilisateur démontrés.** Le consommateur Houses les préserve car leur origine n'est plus encodée dans la requête. Leur retrait doit être effectué côté producteur avant application des vrais overrides utilisateur, pour un programme natif explicitement pris en charge. Ces quatre mesures concernent des poses témoin, pas une preuve mathématique d'impossibilité de toutes les poses. Le dernier échec d'une recette écrase actuellement les échecs précédents : « non-fit / opérateur absent » du site 1 masque une recette qui tient géométriquement mais dépasse la limite d'assise.

### Support et défaut de dimensionnement démontré sur le site 1

La limite d'assise est uniforme pour `Ground` et `Posts`. L'enrichissement pose actuellement les pieds des poteaux sur un niveau commun ; `site_slope_deg` peut allonger des supports selon une pente locale stylisée mais n'échantillonne pas le raster urbain. Relever la limite simplement parce que la recette comporte des pilotis serait donc une promesse constructive non réalisée. Les limites physiques restent inchangées.

Une orientation de référence suivant la courbe de niveau (−3,051°), diagnostiquée séparément sans changer les droits ni le raster, ne récupère pas le site 1. En revanche, son dimensionnement initial utilise `occupation.coverage × domaine = 311,102 m²`, alors que son programme demande **67,4 m²**. Le modèle B03 est plafonné à 185,920 m² et ne dispose pas d'adaptateur de budget après admission. Un deuxième contre-factuel remplace uniquement cette couverture d'occupation par la cible déjà transmise : **même B03/default, même seed, vrai raster, vrais droits**, le générateur natif produit **93,456 m²** et l'admet au front. Sa profondeur minimale source de 12 m reste conservée ; assise **0,748 m** <0,750 m. La cible exacte n'est donc pas satisfaite, mais aucune garde n'est relâchée. Le succès est proche du seuil et doit être certifié aussi par le test Rust natif.

Proposition transmise au parent avant édition produit : après échec de toute la recherche normale, une seule reprise du premier candidat `Platform/FP-RECT` sur pilotis compatible avec la cible de programme, sous ses mêmes dimensions source/minima, seed, variante et support. Au plus 8 poses au front +3 centrées ; aucun nouvel appel aux 80 essais de morphologie. Réservé aux demandes domestiques automatiques inspired ; pins/strict/exact/empreinte imposée/fitting désactivé exclus. Tous les succès précédents sont conservés. Ce n'est ni un adaptateur de capacité de ménages, ni un changement de sélection culturelle.

Les six témoins proviennent du début ordonné de la capture : aucune fréquence de causes n'est extrapolée aux 1 261 refus.

## Correction autorisée et implémentée — validée et libérée

Produit : `houses/src/plans.rs` uniquement. Après échec complet normal, `native_platform_budget_target` retient le premier candidat simple `Platform/FP-RECT` sur poteaux, un corps, sans cour/enclos/programme structurel spécial, dont la cible positive est inférieure au corps initial. `retry_native_platform_budget` reprend sa configuration résolue, y compris variante, overrides et seed, et demande au constructeur natif les dimensions issues du programme. Les bornes source restent celles de Platform (aucune extension ×2). Le compte de corps, leurs niveaux et hauteur de support sont vérifiés ; les positions passent les mêmes gardes. Une seule reconstruction, au plus 8 poses au front et 3 centrées, sans nouvelle synthèse de morphologie. Tout succès antérieur à cette passe retourne avant elle.

La garde d'assise chiffre maintenant dénivelé et pente. Le refus final garde aussi le premier échec terrain rencontré après la vérification corps/cours/structures, en précisant que les vérifications suivantes de toit et d'accès n'étaient pas encore faites ; il ne prétend pas que cette pose était entièrement admissible.

Le test utilise le vrai site 1 (`tests/fixtures/native-platform-budget-java.json`) et reconstruit explicitement le témoin B03 **sans pinner la requête automatique** : cela isole la reprise de l'ajout concurrent des nouvelles recettes B14/B15 au catalogue `atlas-houses-3`. Il vérifie paramètres et tirage identiques sauf dimensions, source/variante, corps, support, assise sur le vrai raster, angles droits, déterminisme, toiture native et exclusions. Ce test isolé est PASS (1/1,20ms). La relecture indépendante de style_index n'a trouvé aucun blocage.

Dernier ajustement demandé par le parent : les 8 poses de front physiques de cette reprise sont essayées aussi pour un souhait `compound`, sans ajouter une exigence de continuité ; tous les succès normaux restent inchangés. Une assertion compare la même empreinte avec les souhaits row et compound. En parallèle, le parent a demandé de raccorder `StyleQuery.tradition_id` à `cultural_palettes::automatic_tradition` : la palette Java automatique suit désormais le registre culturel partagé, et ne mélange plus silencieusement toutes les traditions AS-ISL. C'est une intégration séparée du correctif de taille ; le témoin B03 prouve l'opérateur sur l'ancienne palette large, sans requalifier une maison toraja en maison javanaise. Le rejeu final des six sites sera identifié comme intégré au nouveau catalogue et à cette palette, sans attribuer ses changements à la seule reprise.

### Régression intégrée détectée puis corrigée avant livraison

Le premier rejeu avec `atlas-houses-3` et la palette Java donne **0/6** (`integrated-after.json`) : les candidats sur pilotis précédents ne sont plus sélectionnables dans cette culture. Les nouveaux modèles Ground restent surdimensionnés par la couverture de lot, et le budget après admission ne peut jamais les atteindre. Ce résultat n'a pas été présenté comme une amélioration.

Sur autorisation du parent, `initial_ground_programme_dimensions` fournit maintenant `built_area_m2` au **premier** constructeur natif pour les demandes automatiques inspired `Single/FP-RECT/Ground`, un corps, sans cellules, galerie, jetty, cour/enclos ou programme structurel spécial. Les dimensions sont bornées par les paramètres de la variante choisie ×size ; le calcul rééquilibre les deux axes dans ces bornes. Il ne tire aucun RNG, ne change pas la shortlist/source, ne relance pas la résolution ni le balayage. Pins, strict, exact, empreinte imposée et fitting désactivé restent exclus. Le constructeur natif reste responsable de ses minima et de ses caractéristiques. Le diagnostic distingue aire demandée, dimensions demandées et aire construite.

**Rejeu final intégré : 3/6 admis, 3/6 refusés, 14 ms** (`integrated-ground-budget-after.json`). Il utilise les six requêtes originales, y compris l'ancien souhait `row` ; aucune substitution de programme urbain n'a été appliquée.

| Offset | Source finale | Aire initiale native → finale m² | Assise finale m | Statut |
| --- | --- | ---: | ---: | --- |
| 0 | B15/default, Limasan | 71,802 → 71,802 | 0,726 | Admis |
| 1 | B14/default, Kampung | 67,403 → 67,403 | 0,515 | Admis |
| 4 | B14/default, Kampung | 82,500 → 96,405 | 0,499 | Admis |
| 7 | Pin B06/default | — | dernière pose 1,299 | Refus assise, limite 0,750 |
| 13 | Pin B05/default | — | dernière pose 1,882 | Refus assise, limite 0,750 |
| 15 | Pin B05/default | — | dernière pose 1,599 | Refus assise, limite 0,750 |

L'offset4 reçoit d'abord le maximum source natif 82,5 m², désormais admissible ; **l'opérateur de budget après admission déjà livré** atteint ensuite 96,405 m² avec son autorisation inspired existante (1 couple de dimensions, 3 poses). Ce dernier accroissement ne doit pas être décrit comme appartenant aux bornes source initiales. Aucune nouvelle extension dimensionnelle ni tolérance physique n'a été ajoutée. Les deux autres plans ne nécessitent aucun essai de budget après admission.

Validation finale : `cargo test -p magna-urbis-houses --lib plans::tests::native_ -- --nocapture` **2/2 PASS**, 30 ms. Les deux tests couvrent les vrais sites, les minima/maxima de B14, les exclusions, row/compound pour la reprise sur poteaux, le déterminisme et les toitures natives. Relecture indépendante de style_index : aucun bloqueur. La garde commune utilise maintenant `placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG`, inchangée à 12°. Pas de génération de ville, serveur, release ni nouveau benchmark. Les temps de six maisons ne sont pas une mesure de scale-up.

Commande du dernier rejeu, depuis `rust/` :

```text
cargo run -p magna-urbis-houses --example plan_replay -- ../web/out/javanese-user-10-8791/houses-targeted/original-requests.json ../web/out/javanese-user-10-8791/houses-targeted/integrated-ground-budget-after.json
```

Fichiers produit libérés : `houses/src/plans.rs` et `houses/tests/fixtures/native-platform-budget-java.json` (tests dans plans.rs). Aucun fichier urbain ni `engine.rs` modifié par cette tâche. La recomposition domestique B05 reste une capacité à implémenter séparément : ces six témoins ne la démontrent pas. La capacité en ménages reste inconnue ; ni trois admissions ni une aire cible atteinte ne prouvent que les ménages estimés par la ville sont logés.
