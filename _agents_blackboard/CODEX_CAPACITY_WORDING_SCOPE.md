**Borne finale fixée par root :** livraison limitée au warning d’affectation de `programme.rs` et aux intitulés UI directement liés au parcellaire. Le tableau ci-dessous est l’inventaire des formulations similaires, pas une allowlist. `quarters.rs`, `footprint/capacity.rs`, profil/population/densité et `cityInspector.ts` sont différés et restent byte-identiques. Adaptateur de l’ancienne signature parcellaire uniquement, aucune réécriture d’archive.

# Bilan parcellaire : audit sémantique et périmètre

23 octobre2026. Revue source uniquement, aucun calcul modifié, aucun test/build/moteur/serveur exécuté.

Le log halfling20k (4089/4089, «100% des ménages logés») vient de programme.rs, après allocate, avant Houses. Le numérateur est la somme de min(parcel_capacity, requested), le dénominateur la somme requested, uniquement domesticUnits. Les affectations utilisent une estimation issue des surfaces de lots, couverture et étages préférés et du profil d'occupation. Ce n'est ni un nombre de logements admis, ni une capacité habitante connue. Les champs et formules restent intacts.

## Expressions à corriger

| Source | Sens réellement calculé | Formulation proposée |
|---|---|---|
| programme.rs avertissement `Capacité…ménages logés` | Couverture de la demande par estimation parcellaire après affectation | `Capacité parcellaire estimée après affectation…% du besoin en ménages couvert selon le modèle. Capacité habitante non évaluée.` |
| programme.rs raison `îlots réels logent moins` | Estimation sur les îlots réels inférieure à la prévision | `l’estimation parcellaire sur les îlots réels est inférieure à la prévision du tissu` |
| programme.rs manque `déficit de N ménages` | Manque de capacité parcellaire modélisée, pas ménages sans logement | `manque de capacité parcellaire estimée pour N ménages` |
| programme.rs commentaire Allocation.households | Quantité affectée au lot dans le modèle | `Households allocated to this plot by the parcel model; not a measured housed count` |
| quarters.rs `Capacité prévue…ménages logeables` | Prévision parcellaire, après sondage/estimation des îlots, avant bâtiments | `Capacité parcellaire prévue (modèle)…% du besoin en ménages couvert par l’estimation…Capacité habitante non évaluée.` |
| quarters.rs test halfling `households housed` | Assertion sur parcel_capacity, pas Houses | `households covered by the parcel-capacity estimate` ; conserver l'assertion numérique |
| footprint/capacity.rs `après mesure des îlots` | Mesure du rendement du découpage avec la même règle d'estimation parcellaire | Dire explicitement `estimation parcellaire sur les îlots` ; commentaire de module préciser absence de bâti évalué |
| urbanBuildingsPanel `Prévu` | d.parcelCapacity après allocation | `Parcellaire estimé` ; unité domesticUnits nommée `ménages du modèle` |
| urbanBuildingsPanel `Bâti estimé` et texte connu | Seulement bilan cohérent de sorties sous garde evidence existante | Garder la garde inchangée ; nommer `Bilan bâti estimé`, rappeler absence de capacité habitante certifiée |
| cityInspector `Population prévue`/`Densité` de quartier | Ménages affectés × taille de ménage du profil chargé, pas occupation constatée | `Population indicative (profil chargé)` / `Densité indicative` ; nommer les ménages affectés aux parcelles |

Conserver les libellés déjà exacts : population cible/de planification, ménages prévus, capacité habitante non évaluée, utile indicatif/brut et ménages logés inconnus. Ne pas changer les nombres, arrondis, compteurs, conditions, unités sérialisées, enums, calculs de densité, RNG ou règles de capacité. Le debug JSON `real` reste une ancienne clé technique, signifiant ici housing_capacity estimé : pas de changement de schéma caché.

## Anciens imports et tests

Les archives conservent leurs warnings natifs bruts ; aucune migration de payload ni version de cache ajoutée. Un petit helper d'affichage peut reconnaître uniquement les deux signatures historiques complètes `Capacité : … — N % des ménages logés.` / `Capacité prévue : … — N % des ménages logeables…`, dans leurs contextes urbains de parcelles/quartiers. Il conserve textes/valeurs, précise modèle parcellaire et indique l'ancien rapport. Autres messages, textes libres et futures signatures inchangés ; ne pas prétendre réparer un vieux moteur. L'affichage terrainUrban et warnings du tableau utilisent cette qualification, sans capacityEvidence nouveau ni rechargement natif.

Tests pertinents préparables : ancien warning halfling réel → affichage qualifié et original immuable ; prévision ancienne sans/avec limitation ; nouvelles/étrangères/libres non modifiées ; pourcentage et étapes préservés en chaîne ; gardes de bilan urbain existantes restent intactes. Étendre l'assertion du test halfling existant aux nouveaux libellés, sans modifier ses calculs ou ajouter un gros benchmark. Root seul choisit/exécute les tests natifs/UI. Nouvelle copie cohérente, bases SHA et merges étroits avant une éventuelle promotion autorisée.
