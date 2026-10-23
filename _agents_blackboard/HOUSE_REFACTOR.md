# Maisons : refonte du prototype

Le problème venait de deux couplages : chaque maison transportait beaucoup de données détaillées, et une recette imposait presque toute sa géométrie. Le nouveau chemin sépare **choix du style, plan retenu, réalisation détaillée et dessin à l'écran**. Le générateur historique reste disponible.

## Repères dans la littérature et les projets existants

[Müller et al., 2006](https://doi.org/10.1145/1141911.1141931) utilisent des grammaires de formes hiérarchiques et sensibles au contexte pour composer les bâtiments. [CityEngine](https://doc.arcgis.com/en/cityengine/latest/help/esri-lib-rules.htm) applique des règles à des empreintes ; [Houdini Labs](https://www.sidefx.com/docs/houdini/nodes/sop/labs--building_generator_utility-2.0.html) décrit des modules, dimensions, répétitions, variantes pondérées et exceptions locales. J'en retiens pour ce projet un style comme **ensemble d'opérateurs et de limites**, avec un plan composé avant les détails.

[Watabou](https://watabou.github.io/city.html) sépare déjà carte de ville et Dwellings, avec export vectoriel. Pour l'échelle métropolitaine, [3D Tiles](https://docs.ogc.org/cs/22-025r4/22-025r4.html) fournit un précédent de hiérarchie spatiale et détail choisi selon l'erreur à l'écran. Recommandation adaptée ici : garder les contours vectoriels, dessiner les vues éloignées par tuiles et charger les secteurs à la demande ; adopter le format 3D Tiles lui-même n'est pas nécessaire.

## Ce qui est implémenté

- **Index natif du catalogue** : 262 recettes, 153 variantes, 32 packs. Chaque entrée garde sa provenance, son époque, ses matériaux, ses toitures, sa typologie et ses possibilités d'adaptation. Le tirage sélectionne un ensemble cohérent ; il ne mélange pas arbitrairement les caractéristiques de cultures différentes. Sans recette imposée, il essaie au plus quatre candidats pondérés par les données du catalogue et la graine de la parcelle.
- **Plans architecturaux sans maillage de toiture ni pièces intérieures** : emprises réelles des corps et des niveaux, cours, circulation et description cartographique du toit. La même graine et le même site conservent le même plan. La réalisation détaillée utilise ce plan enregistré, sans nouveau tirage.
- **Composition sous contraintes** : dimensions et dispositions variables pour les familles compatibles, cours ouvertes ou fermées, ensembles de corps et composants hétérogènes comme maison avec tour. Les empreintes orthogonales imposées sont admises dans les sous-familles prises en charge. Les trous, réserves, minima constructifs, droits de toiture et accès restent contraignants. Une maison terminée n'est jamais découpée pour rentrer dans son lot.
- **Dessin selon le zoom** : index spatial, silhouettes lointaines, lignes de toiture intermédiaires, faces détaillées proches. Les vues générales utilisent des tuiles préparées progressivement, avec cache plafonné à 32 Mio. Export SVG et Canvas compatible avec les plans sans maillage, cours transparentes et limites de résolution explicites.
- **Stockage différé** : plans retenus compressés par groupes de 64, archive partagée dans la scène ; la sélection ne recharge qu'un plan. Cache de décompression plafonné à deux groupes/8 Mio. Les doubles natifs sont conservés exactement. Les sauvegardes, déplacements et fusions de villes conservent les archives et les lignes de toiture.

## Mesures et vérification

Une galerie native montre la même recette et la même graine dans une emprise large puis étroite : maison rectangulaire 66,50→53,11 m², maison avec tour 48,64→44,38 m². Les cours insuffisamment larges sont refusées. Il n'existe actuellement aucun bundle explicitement déclaré FP-L dans le catalogue ; cette absence est visible dans la galerie.

Le benchmark de dessin de 100 000 empreintes compactes mesure environ 6,4 ms pour une vue générale déjà préparée ; la préparation initiale est répartie sur 32 appels et prend 629 ms cumulés. Ce test répète une géométrie native : il mesure le rendu, pas la génération d'une métropole complète. Le benchmark séparé du moteur a généré 100 000 plans distincts, sans faces de toiture, en 120 s sur la machine alors fortement occupée ; il traite et libère des groupes de 64, sans garder une scène complète en mémoire.

Sur 1 000 plans natifs, l'archivage réduit le JSON de 13,06 à 5,92 Mo. Le partage des surfaces et spécifications identiques économise encore environ 2 Mo de mémoire. Les résultats sont locaux et ne constituent pas une garantie de cadence universelle. La mémoire de la scène visible croît encore avec le nombre de bâtiments : une métropole de plusieurs millions nécessitera aussi le chargement des secteurs à la demande.

Les contrôles ciblés couvrent déterminisme, contraintes et réserves, recharge exacte, réalisation native, archives et fusions, cache plafonné, rendu/export des cours. Une maison détaillée historique à trois niveaux continue à se recharger après transfert JSON.

Sur un corpus conservé de 745 demandes urbaines, dont 111 espaces ouverts, le correctif des lots étroits porte les acceptations de 340 à 506 avec recettes imposées. En choix automatique, le filtrage préalable des contraintes et la nouvelle recherche portent les acceptations de 284 à 567. Aucun ancien résultat accepté n'est perdu. Les réserves, droits de toiture et accès restent vérifiés ; les refus résiduels sont conservés et explicités.

## Limites et suite recommandée

Le plan compact est une représentation architecturale pour la carte. Son contour de toiture, sa hauteur et sa connexion d'accès restent des descriptions de planification ; la validation détaillée peut refuser une construction. Sa capacité domestique est inconnue et ne doit pas modifier la population. Les traditions avec programmes structurels spécifiques conservent leurs modèles natifs tant qu'un opérateur adapté n'existe pas.

Les 145 associations fonctionnelles du catalogue sont encore marquées « prévues ». Église, mosquée, moulin, temple ou donjon demandent des familles réellement décrites ; les aperçus de monuments produits côté ville restent identifiés comme tels. La richesse peut piloter les paramètres natifs, mais le catalogue ne contient pas de pondérations sociales documentées permettant de prétendre qu'une recette appartient à un rang précis.

Imagen pourra servir à produire des atlas de matériaux et détails pour les vues proches. Les contours et cours doivent rester géométriques afin de garder sélection, adaptation et export exacts. Pour la prochaine étape, prioriser les familles fonctionnelles manquantes, puis le stockage/chargement par secteurs ; une image complète par maison multiplierait les ressources sans résoudre l'adaptation des plans.

Entrées : `planUrbanBuildings`, `realizeUrbanBuilding`, `architecturalStyleIndex` dans `rust/bridge/architecture.ts`. Contrat de dessin : `UrbanBuildingLodRenderer`. Résultats et scripts reproductibles : `CODEX_*BENCHMARK.json` et `native-building-gallery/` dans ce dossier.

