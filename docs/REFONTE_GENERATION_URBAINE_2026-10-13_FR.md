# Magna Urbis — Repenser l’empreinte, les quartiers, les îlots et les parcelles

[English](REFONTE_GENERATION_URBAINE_2026-10-13.md)

**Date : 13 octobre 2026.** Document d’analyse et de proposition, destiné à préparer les décisions de conception. Les bâtiments sont volontairement différés, sauf lorsque leur génération actuelle influence le parcellaire ou la surface urbaine.

**Conclusion de travail :** Magna Urbis utilise déjà plusieurs bonnes méthodes : croissance guidée par le site, champs d’orientation, subdivision hiérarchique, découpage depuis les façades et conservation des partitions. La refonte devrait surtout clarifier les objets et les responsabilités, diversifier les mécanismes de formation de l’empreinte, et faire intervenir l’accessibilité avant les réparations finales. Remplacer tout cela par une méthode unique, Voronoï ou diffusion, ne résoudrait pas les difficultés.

Le document repose sur une lecture du dépôt **dans son état de travail**, y compris des modifications locales non encore commitées. Il décrit les règles observées ; ce n’est ni une certification de tous les résultats ni un benchmark exécuté pour cette étude. La revue bibliographique est ciblée et sourcée, sans prétention à l’exhaustivité. Les propositions de la section 3 restent des choix à discuter, pas un modèle permanent déjà décidé pour Rust.

## 1. Fonctionnement détaillé actuel

[English translation of section 1](URBAN_REDESIGN_CURRENT_WORKFLOW_2026-10-13.md).

### 1.1. Les deux chaînes à distinguer

Il existe actuellement deux réalisations urbaines pertinentes.

| Chaîne | Ce qu’elle fait aujourd’hui | Rôle dans cette étude |
|---|---|---|
| Application TypeScript historique | Génération complète du site et de l’agglomération, avec phases, rues, îlots, parcelles, bâtiments et équipements | Référence la plus riche en comportements et cas particuliers |
| Terrain Bench / Urban Bench Rust | Composition de l’agglomération, quartiers, rues, îlots, puis parcelles ; géographie et routes proviennent du terrain ou d’un décor importé | Prototype actuel pour les étapes à repenser, indépendant des maisons |

Les README généraux indiquent encore que la génération urbaine Rust est à venir, alors que le [guide des étapes urbaines Rust](../rust/crates/core/src/urban/README_FR.md) et les sources contiennent déjà cette génération. Pour cette analyse, les sources et ce guide spécialisé priment sur cette présentation générale.

L’héritage Watabou explique l’origine du projet, mais le moteur TypeScript actuel ne se résume plus à un ensemble de cellules de Voronoï. Son organisation centrale est désormais une succession de partitions guidées.

### 1.2. Vocabulaire réellement utilisé

Une première difficulté vient du fait que plusieurs notions voisines se superposent.

| Notion | Sens dans le fonctionnement actuel | Distinction à garder |
|---|---|---|
| Site | Position, relief, eau, environnement et accès régionaux | Le site existe avant la ville |
| Enveloppe / emprise planifiée | Surface destinée à accueillir les phases et leur population | Ce n’est pas forcément la surface finalement occupée |
| Enceinte | Muraille, palissade ou autre limite physique | Une ville ouverte a aussi une empreinte |
| Phase | Région associée à un stade de croissance et à une recette culturelle | Un découpage en phases ne constitue pas à lui seul une simulation historique |
| Quartier | Grande pièce du plan séparée par les axes et les limites de phase | Il s’agit surtout d’un secteur de génération, pas nécessairement d’un quartier social ou administratif |
| Îlot | Terre disponible après soustraction de l’espace des rues | Une impasse peut entailler un îlot sans le couper en deux |
| Parcelle | Unité découpée dans l’îlot, avec orientation et façade éventuelle | Une parcelle n’est pas un bâtiment |
| Jardin / fond de terre | Terre conservée dans la partition, sans accès résidentiel reconnu ou laissée libre | Le classement automatique en jardin est souvent un repli géométrique, pas une attribution historique démontrée |

Le mot « empreinte » apparaît aussi à l’échelle des bâtiments dans le moteur historique. Il faut donc préciser à chaque fois s’il s’agit de l’empreinte de l’agglomération, d’une enceinte, d’une occupation du sol ou d’une construction.

### 1.3. Entrées et intentions de génération

Le plan dépend principalement de la graine, de la population, de la taille du lieu, de sa culture, du terrain et de l’eau, des routes régionales et des réglages de morphologie.

La culture fournit davantage qu’une apparence : noyau privilégié, recettes du cœur et des extensions, orientations, logique d’enceinte, dimensions des îlots, largeurs des voies, modes de parcellaire et types de réserves. Des réglages explicites peuvent remplacer ces valeurs. Les zones cœur, intermédiaire, bordure, village et faubourg modulent les dimensions et densités.

Le catalogue Rust est une exportation versionnée des recettes TypeScript résolues. Le guide actuel annonce 53 cultures et 326 préréglages. Cette richesse représente un catalogue de règles disponibles, **pas 326 systèmes de génération indépendants**, ni une validation historique de toutes leurs combinaisons.

L’aléatoire est déterministe et réparti en sous-flux. Les graines des étapes permettent notamment de reprendre les parcelles sans reconstruire les rues. Les coordonnées sont métriques. Cela rend les comparaisons et les reproductions possibles à version et entrées identiques.

### 1.4. Workflow historique TypeScript

Le déroulement principal peut être résumé ainsi :

```text
Site et routes régionales
        ↓
Culture, population, type de settlement et recettes de croissance
        ↓
Régions de phases et emprise planifiée ; faubourgs le long des accès
        ↓
Noyau, grands équipements réservés, axes principaux et enceintes
        ↓
Secteurs / quartiers
        ↓
Subdivisions guidées en rues secondaires et pièces d’îlots
        ↓
Accès locaux, impasses et soustraction de la largeur des rues
        ↓
Parcelles depuis les façades ; fonds de terre et réserves
        ↓
Bâtiments et corrections finales influençant parfois la partition
```

Ce schéma est le tronc commun. Les petites implantations, villages-rues, camps et certaines cultures emploient aussi des branches spécialisées. Le dépôt contient par ailleurs une branche « mega » de planification à grande échelle ; elle ne doit pas être confondue avec la composition ordinaire décrite ici, ni présumée active dans tous les parcours.

#### Population et surface

La population sert à estimer une surface brute selon les densités des phases. Une part peut être affectée aux faubourgs. La densité brute inclut implicitement les espaces nécessaires au fonctionnement urbain ; elle ne correspond pas à la seule surface des parcelles résidentielles.

Le planificateur cherche des régions de croissance suffisamment grandes sur les terres disponibles. En terrain contraint, il peut assouplir certaines limites, augmenter modérément la densité prévue et signaler un déficit. Des replans bornés tentent de compenser une surface perdue au découpage ou au lissage. Cela reste une recherche de budget spatial, pas une démonstration que les logements produits accueilleront exactement la population demandée.

#### Formation de l’empreinte

La croissance organique utilise un champ de coût associé au site. L’eau et certaines terres impraticables sont exclues. La pente, l’habitabilité, les routes, les rives, l’humidité et un bruit spatial modulent ce champ. Des réglages favorisent un allongement le long d’un axe ou un deuxième noyau.

Les régions peuvent ainsi être plus faciles à étendre dans une vallée ou près d’un accès que vers un versant. Les formes planifiées appliquent aussi des gabarits d’enceinte : rectangles, orientations cardinales, ovales et autres variantes. Les phases successives occupent des bandes de croissance ; les faubourgs utilisent des rubans autour des routes extérieures.

Le planificateur écarte les composantes non desservies. Une composante de terre isolée par l’eau ne devient donc pas automatiquement un quartier simplement parce qu’elle est comprise dans le budget. Cette règle protège la cohérence des accès, mais peut aussi réduire l’emprise réalisable.

#### Noyau, axes et quartiers

Le noyau peut être un marché, un château, un lieu religieux ou un autre centre culturel. Les axes réutilisent les approches régionales et relient portes et centres. Les anciennes limites d’enceinte peuvent intervenir dans la structure des phases et des rues selon les recettes. De grands programmes sont réservés suffisamment tôt pour ne pas devoir être insérés dans de petits îlots après coup.

Les quartiers sont les pièces issues des bandes de phase et de leur découpage par les axes. Leur morphologie peut varier par phase. Cette organisation permet un vieux cœur et une extension plus régulière, mais la subdivision géométrique et l’identité du quartier sont encore étroitement liées.

#### Rues secondaires et îlots

Le moteur subdivise récursivement chaque quartier. **Une coupe de subdivision à ce niveau représente une rue.** Les candidats suivent un champ d’orientation local : grille, direction radiale ou tangentielle, proximité des axes, courbes du terrain, irrégularité de faible fréquence.

Les coupes sont évaluées selon les tailles et proportions obtenues, les angles, les raccordements et les contraintes du site. La subdivision s’arrête lorsque les morceaux deviennent acceptables ou qu’aucune coupe valide n’est trouvée. Certains morceaux aigus ou petits deviennent des places plutôt que des îlots difficiles à remplir.

Des accès en impasse desservent ensuite les profondeurs : derbs, closes, hutong, roji et autres variantes. Il faut distinguer une nouvelle rue traversante, qui sépare des pièces, d’une fente d’accès, qui entaille une pièce existante.

Les axes n’ont pas une largeur nulle. L’îlot final provient de la soustraction des rubans de voirie. La règle recherchée est une répartition de la terre entre rues, îlots et espaces réservés, sans placement indépendant de polygones qui risqueraient de se chevaucher.

#### Parcelles

La première opération est d’identifier les bords donnant effectivement sur une rue. Les frontières ouvertes, l’eau et les murs ne constituent pas automatiquement des façades. Les segments compatibles sont regroupés en séquences de façade.

Le découpage en bandes fonctionne ensuite ainsi :

1. Une façade obtient un territoire vers l’intérieur, limité par une profondeur et par la géométrie de l’îlot.
2. Les façades prioritaires, notamment celles des voies les plus importantes, sont traitées avant les autres ; elles influencent l’attribution des angles.
3. Ce territoire est subdivisé selon des largeurs de façade et un repère commun, éventuellement incliné dans les tissus organiques.
4. Les autres façades utilisent le terrain restant.
5. Les fonds non attribués sont conservés ; les petits résidus sont fusionnés lorsque possible.

Les parcelles laniérées de type burgage et machiya, les cours et compounds, les variantes siheyuan, les jardins et les unités d’îlot entier ne partagent donc pas toutes le même opérateur.

Un point important : le document de conception archivé prévoyait un squelette droit pour attribuer les territoires de façade. Les sources actuelles de `plots.ts` décrivent son **remplacement par des bandes prioritaires**, et mentionnent un coût trop élevé de l’ancienne intégration CGAL/WASM. Cette remarque du dépôt ne suffit pas à conclure que tout squelette droit serait trop lent ; aucun benchmark de cette intégration n’a été reproduit ici.

#### Corrections après construction

Le moteur complet ajoute ensuite bâtiments, passages, finitions des bordures et réparations de densité. Plusieurs de ces opérations peuvent encore changer la terre attribuée à une parcelle ou libérée en jardin. L’emprise exportée cherche aussi à retirer de grandes zones planifiées restées non desservies, tout en conservant quartiers, rues et murs.

La difficulté structurelle est donc réelle : **le parcellaire existe avant les bâtiments, mais certaines décisions foncières finales dépendent encore de leur réussite**. Pour la refonte demandée, il serait préférable de pouvoir valider une ville jusqu’aux parcelles sans avoir besoin d’exécuter les maisons.

### 1.5. Workflow actuel Rust

La chaîne Rust du banc reçoit un site, un raster de relief et d’obstacles, ainsi que les routes déjà calculées. Elle distingue une composition d’agglomération complète et des scènes isolées de travail.

#### Composition d’agglomération

Le choix automatique distingue hameau, village-rue, village groupé et ville. La décision utilise notamment population, recette culturelle et proximité des routes. Les seuils actuellement observés dans cette composition sont 200 habitants pour distinguer les plus petites implantations et 1 200 pour passer à la composition de ville ; ce sont des seuils du générateur, pas des définitions historiques universelles.

Le noyau est réparti entre des phases culturelles. Les parts de population et les densités déterminent des **poids de surface**. Ces poids redistribuent le rayon indicatif reçu du site entre noyau et faubourgs. Le rayon peut également être forcé : le budget spatial ne découle donc pas exclusivement de la population et de la densité.

Les phases sont obtenues par des contours successifs et des différences avec les régions précédentes. Les faubourgs sont des rubans autour d’approches réellement raccordées au noyau ; leur longueur et profondeur suivent le budget disponible, la recette et les obstacles. Ils peuvent dépasser le rayon indicatif. L’enceinte reste associée au noyau.

Cette composition est une description synthétique de la croissance. Elle ne simule pas encore des décisions foncières au cours de siècles, avec conservation et transformation détaillées des parcelles anciennes.

#### Construction du macroplan

L’empreinte initiale est principalement un contour autour du centre du site : géométrique pour certaines villes planifiées et fortifiées, allongé pour certaines implantations, ou modulé par quelques variations angulaires et par les directions des approches dans les lieux ouverts.

Le plan est ensuite découpé par les terres sèches, les corridors régionaux et les axes culturels. Des orientations peuvent venir des points cardinaux, des routes, du gradient local du terrain ou de la rive. Des axes radiaux et un anneau sont disponibles dans les situations correspondantes.

Pour obtenir le nombre de secteurs souhaité, le macroplan tente de couper les grandes pièces par des axes routables, avec une recherche de partage relativement équilibré. **Le nombre de quartiers est donc en partie un objectif de subdivision**, plutôt que le résultat d’un modèle explicite de communautés, fonctions et centralités.

Les quais actuels sont des voies suivant les bords secs voisins de l’eau. Le prototype ne résout pas encore un port complet, ses bassins, sa navigation, ses jetées et son organisation foncière.

#### Contraintes des rues

Le routage local vérifie l’eau et la pente longitudinale sur la surface physique. Les limites par défaut sont de 12 % pour les rues, 18 % pour les ruelles et 65 % pour les escaliers. Elles sont configurables et ne prétendent pas représenter des normes historiques.

La vérification ne se limite pas aux hauteurs des deux extrémités d’un segment : elle inspecte la surface interpolée et peut repérer une crête intermédiaire. Une recherche locale tient compte de la pente et des virages pour détourner un trajet. Les franchissements d’eau restent ceux du réseau régional ; le routeur urbain sec ne crée pas librement de nouveaux ponts.

Les croisements sont ensuite normalisés en nœuds partagés et les fragments isolés sont éliminés. Cette construction garantit des propriétés **par rapport au terrain transmis**, dont la résolution reste une limite : un masque d’eau à 512² sur 40 km représente environ 78 m par cellule, insuffisant pour distinguer une ruelle ou un petit canal. La carte peut afficher une rive vectorielle plus fine sans que ce détail fasse autorité dans le calcul urbain.

#### Quartiers, rues locales et îlots

Les quartiers héritent de leurs phases et recettes. Le raffinement utilise des coupes récursives guidées, avec des variantes de grilles, tissus organiques, terrasses et accès locaux. Des objectifs de surface, largeur et proportions encadrent les coupes. Une impossibilité de découpage peut laisser un grand îlot.

Le réseau est matérialisé par des rubans de largeur réelle, puis soustrait aux terres. Les réserves de monument et les places sont conservées comme unités libres. Le monument lui-même n’est pas construit à cette étape.

#### Parcelles

Le calcul des parcelles reçoit le layout déjà réalisé et le conserve. Il détecte les façades sur les rues retenues, utilise l’orientation de l’îlot et applique l’opérateur culturel de sa phase, sauf surcharge explicite.

Les bandes de façade, le découpage de cours et compounds, le raffinement siheyuan et le maintien d’îlots entiers sont disponibles. Un contact de façade inférieur au seuil courant de 3 m ne légitime pas une parcelle résidentielle ordinaire. Les profondeurs résidentielles sont bornées ; les fonds sans desserte restent des jardins. Un îlot sans façade conservée n’obtient pas un accès fictif.

Les trous sont conservés dans les booléens. Un contrôle de somme des surfaces signale les résidus du partitionnement. **Une bonne somme d’aires ne prouve toutefois pas à elle seule une partition correcte** : un chevauchement et un vide pourraient se compenser. Il faut aussi contrôler les unions, les intersections et les exclusions.

### 1.6. Workflow utilisateur et dépendances

Dans Terrain Bench, les quartiers dépendent du terrain, de l’eau, des settlements et des routes. Les parcelles dépendent du layout obtenu. Refaire les parcelles conserve les rues et les îlots ; changer une dépendance amont invalide les résultats en aval.

Urban Bench permet de travailler sur un décor exporté : terrain, lieux et routes sont alors figés pour comparer les variantes urbaines. L’atelier fournit aussi des scènes isolées et peut importer le plan exact de la carte. Le mode isolé est utile pour une méthode locale, mais insuffisant pour juger une silhouette d’agglomération.

Les réglages appliqués sont distingués des brouillons. Les liens conservent graines, sélection, réglages appliqués et affichage. Le rendu ne déclenche pas de nouvelle génération. Les réponses obsolètes des workers ne doivent pas remplacer le résultat courant. Ces propriétés sont à conserver lors d’une refonte.

### 1.7. Ce qui est déjà solide, et ce qui reste ambigu

| Point | Observation | Implication |
|---|---|---|
| Partition plutôt que placement libre | Principe central déjà présent | À conserver : une terre a un propriétaire spatial explicite |
| Hiérarchie des échelles | Phases → quartiers → îlots → parcelles | Bonne base, mais sémantique des quartiers à préciser |
| Culture composable | Plusieurs recettes et phases peuvent coexister | À rendre plus explicite et moins dépendant de catégories globales |
| Façade et profondeur | Orientations et accès sont déjà utilisés | La parcelle est plus qu’un polygone aléatoire |
| Croissance | Phases et faubourgs disponibles | L’histoire est encore souvent encodée comme des bandes autour d’un centre |
| Empreinte Rust | Gabarit central puis adaptation géographique | Diversité limitée pour les archipels, fusions de noyaux et branches complexes |
| Accès | Règles physiques et nettoyages présents | Certaines impossibilités sont traitées tard, avec fonds en jardin |
| Densité | Budget de planification et corrections | Les notions brute, nette et capacité doivent être séparées |
| Bâtiments différés | Rust peut s’arrêter au parcellaire | Le moteur historique contient davantage de retours du bâti vers le foncier |

Les bugs archivés sur les limites de quartier, les ports, les contours ouverts et les rues sans destination correspondent à plusieurs de ces zones de tension. Ils donnent des pistes de régression, mais leurs notes anciennes ne constituent pas un état vérifié de tous ces problèmes aujourd’hui.

### 1.8. Traçabilité de cette description

Les principales pièces consultées sont :

- [Orchestration TypeScript](../web/src/gen/urban/index.ts), [planification des phases](../web/src/gen/urban/phases.ts), [axes et quartiers](../web/src/gen/urban/primary.ts).
- [Champs d’orientation](../web/src/gen/urban/field.ts), [subdivision et îlots](../web/src/gen/urban/blocks.ts), [parcelles](../web/src/gen/urban/plots.ts), [emprise desservie](../web/src/gen/urban/footprint.ts).
- [Guide Rust](../rust/crates/core/src/urban/README_FR.md), [composition](../rust/crates/core/src/urban/composition.rs), [macroplan](../rust/crates/core/src/urban/macroplan.rs), [quartiers](../rust/crates/core/src/urban/quarters.rs), [parcelles](../rust/crates/core/src/urban/parcels.rs), [routage](../rust/crates/core/src/urban/routing.rs), [réseau](../rust/crates/core/src/urban/network.rs).
- Documents archivés : [HANDOFF](../.local-archive/publication-2026-10-09/repository/HANDOFF.md), [BUGS](../.local-archive/publication-2026-10-09/repository/BUGS.md), [géométrie urbaine](../.local-archive/publication-2026-10-09/repository/web/URBAN_GEOMETRY.md), [morphologie urbaine](../.local-archive/publication-2026-10-09/repository/web/URBAN_MORPHOLOGY.md).
- [Catalogue historique local des settlements](catalogue_settlements_antiquite_moyen_age_rpg.md), pour conserver la distinction entre forme, usage, milieu et origine.

Les documents archivés expriment parfois une intention ancienne différente de la méthode actuellement observée ; ils ont été utilisés comme contexte, pas comme preuve unique de l’implémentation.

## 2. Littérature, état de l’art, techniques et bibliothèques

[English translation of this literature review](URBAN_REDESIGN_LITERATURE_2026-10-13.md).

### 2.1. Ce que « SOTA » veut dire pour ce projet

Il n’existe pas de classement unique du meilleur générateur de ville. Un travail peut exceller dans la ressemblance d’images aériennes et être peu utile pour un parcellaire vectoriel éditable. Un autre peut garantir une bonne desserte sans reproduire une ville historique. Un produit peut être mûr sans que son algorithme soit le plus récent.

Pour Magna Urbis, les critères utiles sont : diversité des formes pré-modernes, contrôle artistique, cohérence avec le site, réseau connecté, partition valide, accès crédibles, reproductibilité et temps interactifs. La fidélité à une histoire particulière exige en plus des références datées, rarement présentes dans les jeux de données urbains modernes.

Le constat de cette revue est qu’une combinaison de méthodes reste plus pertinente qu’un remplacement intégral par la dernière publication. Les fondations de 2008–2013 sont encore directement utiles ; la co-génération de 2024 apporte une piste structurelle importante ; la diffusion récente élargit surtout les possibilités d’apprentissage et de contrôle par exemples.

#### Le complément de la morphologie urbaine

La littérature de génération informatique doit être complétée par celle de l’analyse des villes. **Anne Vernez Moudon, 1997 — Urban Morphology as an Emerging Interdisciplinary Field** situe notamment le rapprochement des écoles anglaise, italienne et française, autour des héritages de Conzen et Muratori. Pour ce projet, cela rappelle qu’une forme doit être étudiée avec son échelle et ses transformations, et que la lecture d’une ville ne se réduit pas à un style graphique. Le résumé et les éléments accessibles de la traduction ont été consultés ; l’original du journal était inaccessible pendant la recherche. [Traduction diffusée par le réseau portugais de morphologie urbaine](https://pnum.fe.up.pt/en-gb/assets/pdf/rmu/rmu-3-1_moudon.pdf).

L’étude **Alnwick, Northumberland: A Study in Town-plan Analysis**, de M. R. G. Conzen, est une piste de lecture pour approfondir unités de plan, héritage foncier et croissance. Une [traduction de la seconde édition de 1969](https://pnum.fe.up.pt/en-gb/alnwick.pdf) est diffusée par le même réseau. Son texte intégral n’a pas été analysé ici : les recommandations du présent document ne sont pas présentées comme une reproduction de son modèle.

### 2.2. Les grandes familles de méthodes

| Famille | Principe | Atout | Limite pour Magna Urbis |
|---|---|---|---|
| Grammaires et croissance locale | Proposer des extensions de rues, puis accepter, raccorder ou arrêter selon des règles | Hiérarchie et croissance visibles | Effets d’ordre, réparations de réseau et de parcelles |
| Champs de directions / tenseurs | Définir des orientations préférées, puis tracer les voies | Contrôle des grilles, radiales, rives et transitions | Le champ ne garantit ni connexion ni parcelles utilisables |
| Subdivision hiérarchique | Couper de grandes régions jusqu’aux unités fines | Partitions maîtrisées et édition locale | Biais de coupes répétées et raccords entre régions |
| Gabarits déformables | Adapter des motifs de référence à un domaine | Identité de tissu plus précise | Distorsions, collage et compatibilité des interfaces |
| Voronoï et diagrammes pondérés | Répartir la terre autour de germes | Centres multiples et partage de surfaces | Façades, histoire foncière et voies non garanties |
| Co-génération rues / parcelles | Subdiviser et ajouter les accès nécessaires conjointement | Traiter la desserte au moment où le besoin apparaît | Optimisation et règles à adapter aux tissus historiques |
| Simulation temporelle | Faire évoluer rues, usages et unités foncières par étapes | Héritages et transformations | Coût, réglage et validation des hypothèses |
| Synthèse par exemples | Recombiner ou apprendre des structures observées | Diversité ancrée dans des références | Qualité et époque du corpus déterminantes |
| Modèles génératifs appris | Produire un layout conditionné, souvent raster, parfois topologique | Propositions variées, complétion et esquisses | Garantie géométrique et transfert historique à établir |

Ce tableau est une comparaison pour le projet, pas une hiérarchie universelle publiée.

### 2.3. Rues et structure du plan : références fondamentales

**Parish et Müller, 2001 — Procedural Modeling of Cities.** La génération de rues est guidée par des objectifs globaux et corrigée par des contraintes locales ; des cartes de population et de terrain orientent les décisions. C’est une base majeure des générateurs procéduraux, mais pas une validation de la morphogenèse médiévale. [Article](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf).

**Chen, Esch, Wonka, Müller et Zhang, 2008 — Interactive Procedural Street Modeling.** Des champs de tenseurs contrôlables sont convertis en réseaux ; l’utilisateur peut modifier le champ ou le graphe. Cette séparation entre intention directionnelle et réseau réalisé convient aux grilles, radiales et mélanges locaux. Elle demande toujours des règles de raccordement et d’espacement. [Article des auteurs](https://peterwonka.net/Publications/pdfs/2008.SG.Chen.InteractiveProceduralStreetModeling.pdf).

**Galin, Peytavie, Maréchal et Guérin, 2010 — Procedural Generation of Roads.** Le trajet minimise un coût anisotrope intégrant relief et obstacles. C’est une référence pour relier des destinations dans un paysage ; ce n’est pas à elle seule une méthode de définition des quartiers ou du cadastre. Le routeur Rust actuel en reprend une logique simplifiée et bornée. [Article](https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf).

**Yang, Wang, Vouga et Wonka, 2013 — Urban Pattern: Layout Design by Hierarchical Domain Splitting.** Le domaine est subdivisé suivant des lignes de champ ou des motifs préconçus déformés. La combinaison est importante : un tissu ne dépend pas seulement d’une direction et d’un bruit, il peut posséder une organisation répétable plus riche. Le moteur actuel est proche de la branche « coupes guidées », sans reproduire tout ce cadre. [Publication et résumé institutionnels](https://repository.kaust.edu.sa/handle/10754/575588).

Pour Magna Urbis, l’opposition « réseau d’abord » contre « régions d’abord » est trop simple. Les grandes destinations et l’armature peuvent précéder le découpage ; une subdivision peut ensuite créer des rues ; des accès fins doivent enfin répondre aux profondeurs foncières.

### 2.4. Parcellaire : une question de desserte et de forme

**Vanegas, Kelly, Weber, Halatsch, Aliaga et Müller, 2012 — Procedural Generation of Parcels in Urban Modeling.** Ce travail traite explicitement la couverture de l’îlot, l’accès, l’orientation, les dimensions et la plausibilité des parcelles. Il fournit une référence directe pour comparer subdivision récursive et méthodes guidées par les frontières. [Article des auteurs](https://www.cs.purdue.edu/cgvlab/www/resources/papers/Vanegas-Eurographics-2012-Procedural_Generation_of_Parcels_in_Urban_Modeling.pdf).

Trois outils géométriques doivent être distingués :

- **Bandes depuis les façades :** faciles à paramétrer en largeur et profondeur, particulièrement adaptées aux lots laniérés. Leur traitement des angles et des façades concurrentes exige une règle explicite.
- **Squelette droit :** suit la propagation parallèle des bords d’un polygone ; utile pour les territoires de façade et les offsets. Il ne fournit pas automatiquement une desserte ou une histoire foncière.
- **Axe médian :** décrit les lieux équidistants des frontières ; utile pour repérer les profondeurs et les couloirs. Il n’est pas interchangeable avec le squelette droit.

La documentation CGAL distingue ces objets et fournit des squelettes droits pondérés ainsi que des offsets de polygones avec trous. Elle permet de réutiliser un squelette pour plusieurs offsets. Pour le projet, il faudrait mesurer son intérêt sur les îlots difficiles, plutôt que l’imposer à tous les cas. [Manuel](https://doc.cgal.org/latest/Straight_skeleton_2/index.html).

Les subdivisions récursives conviennent mieux aux unités compactes et orientées qu’aux séries de longues parcelles. Les compounds peuvent rester des unités entières ou demander une organisation interne spécifique. Enfin, un intérieur sans rue peut être un jardin, un espace collectif ou une propriété desservie par passage : le repli géométrique ne doit pas décider seul de son usage.

### 2.5. La co-génération : une piste récente particulièrement pertinente

**Zebin Chen, Peng Song et F. Peter Ortner, 2024 — Hierarchical Co-generation of Parcels and Streets in Urban Modeling.** Le système subdivise les régions et ajoute des rues pour desservir les unités devenues inaccessibles, puis optimise la qualité géométrique. Les auteurs annoncent un réseau simple et connecté donnant accès aux parcelles. [Article](https://sutd-cgl.github.io/supp/Publication/papers/2024-EG-UrbanModeling.pdf), [présentation par les auteurs](https://adaptivedesignlab.com/hierarchical-co-generation-of-parcels-and-streets-in-urban-modeling/).

L’intérêt pour Magna Urbis est de traiter la desserte pendant le raffinement, au lieu de découvrir en fin de chaîne des fonds impossibles à attribuer. La transposition doit rester sélective : l’article assimile conceptuellement plusieurs échelles de polygones et recherche une régularité qui n’est pas l’objectif de tous les tissus historiques. Ses résultats ne démontrent pas un générateur universel de médinas, compounds ou villes en terrasses.

**Notre interprétation pour le projet :** adopter une boucle locale « besoin foncier → accès → nouveau découpage » pourrait améliorer la cohérence sans remplacer toute l’armature principale. Les rues patrimoniales et les réserves resteraient contraintes ; seules les régions autorisées seraient retravaillées.

### 2.6. Croissance et synthèse par exemples

**Weber, Müller, Wonka et Gross, 2009 — Interactive Geometric Simulation of 4D Cities.** Ce travail fait évoluer un modèle urbain géométrique au cours du temps, avec parcelles et rues explicites. Il montre qu’une histoire de transformations peut être représentée autrement que par des anneaux concentriques. Il ne constitue toutefois pas une simulation historique pré-moderne prête à l’emploi. [Article ETH](https://cgl.ethz.ch/Downloads/Publications/Papers/2009/Web09/Web09.pdf).

**Aliaga, Vanegas et Beneš, 2008 — Interactive Example-Based Urban Layout Synthesis.** La synthèse combine structure et image à partir de fragments urbains observés, avec des opérations d’extension et de mélange. Pour Magna Urbis, l’apport est l’idée de références locales de tissu et de raccords, plutôt qu’une simple liste de styles globaux. [Article des auteurs](https://cs.purdue.edu/homes/bbenes/papers/Aliaga08ToG.pdf).

Une extension produite aujourd’hui sur le bord d’un noyau ne devient « historique » que si elle conserve des traces cohérentes du passé : ancien axe, alignement, limite foncière, ancienne enceinte, centre absorbé. Ce principe est une recommandation de conception ; il ne suffit pas de choisir une recette appelée « médiévale ».

### 2.7. Diffusion et travaux récents : utiles, mais à leur bonne place

**Generating Urban Road Networks with Conditional Diffusion Models, 2024.** L’approche traite le réseau comme une image conditionnée par le contexte. Elle élargit la diversité de propositions ; la production d’une image doit cependant être suivie d’une conversion et d’un contrôle du réseau si l’on veut des intersections et des accès exploitables. [Publication ISPRS IJGI](https://www.mdpi.com/2220-9964/13/6/203).

**CityGen, prépublication 2023, version révisée 2025.** Le cadre propose extension de layouts, raffinement à plusieurs échelles et contrôle par esquisse. C’est une référence pour la complétion et le contrôle spatial, plutôt qu’une preuve de cadastre historique exact. [Fiche et article](https://arxiv.org/abs/2312.01508).

**CaRoLS — Condition-adaptive multi-level road layout synthesis, 2025.** Le résumé de l’éditeur décrit une combinaison diffusion/VAE pour la topologie discrète et les détails géométriques continus. Ce passage vers une représentation plus structurée mérite une veille. Le texte intégral n’a pas pu être consulté dans cette revue : je ne lui attribue donc aucune garantie de partition ou de desserte foncière. [Résumé éditeur](https://www.sciencedirect.com/science/article/abs/pii/S0097849325002924).

Pour un générateur pré-Renaissance, les difficultés sont le corpus, le changement de domaine et les garanties. Des données contemporaines risquent de reproduire voiries automobiles, zonages récents et tracés remodelés. Une graine d’inférence ne suffit pas non plus à assurer la même reproductibilité entre matériels, versions et conversions vectorielles.

**Position proposée :** utiliser éventuellement l’apprentissage pour suggérer une empreinte, compléter un tissu ou estimer des paramètres à partir d’exemples. Le résultat accepté doit ensuite passer par les règles géométriques et d’accès du moteur. Il n’existe pas, dans les sources examinées, de preuve qu’un modèle neuronal disponible remplace immédiatement toute la chaîne demandée.

### 2.8. Produits et bibliothèques disponibles

Ces outils répondent à des rôles différents. Une bibliothèque de géométrie fournit des opérations ; elle ne choisit pas la logique urbaine.

| Outil | Ce qu’il apporte | Usage envisageable / réserve |
|---|---|---|
| [ArcGIS CityEngine](https://doc.arcgis.com/en/cityengine/latest/help/help-layers-block-parameters.htm) | Blocs liés aux boucles de rues, subdivisions récursive, offset, squelette ou aucune | Comparateur mûr de workflows et de réglages ; produit propriétaire, pas une bibliothèque Rust embarquable |
| [Watabou / TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) | Générateur artistique et référence historique du projet | Comparer lisibilité, diversité et simplicité ; dépôt GPL-3.0, source publique plus ancienne que certaines fonctionnalités de l’outil actuel |
| [ProbableTrain / MapGenerator](https://github.com/ProbableTrain/MapGenerator) | Génération de cartes de villes par champs de tenseurs | Démonstrateur inspectable ; orientation déclarée vers les plans américains, à adapter plutôt qu’utiliser comme référence historique |
| [geo, Rust](https://docs.rs/geo/latest/geo/) | Géométries, booléens, buffers, relations topologiques et mesures | Déjà utilisé dans le prototype ; bonne première base avant d’ajouter une autre pile |
| [Spade, Rust](https://docs.rs/spade/latest/spade/) | Triangulations de Delaunay, notamment contraintes, et structures associées | Candidat pour maillage de domaines et opérations locales ; ne génère pas un cadastre à lui seul |
| [petgraph, Rust](https://docs.rs/petgraph/latest/petgraph/) | Structures et algorithmes de graphes | Accessibilité, composantes et chemins ; embedding géométrique et croisements restent à traiter séparément |
| [CGAL, squelette droit](https://doc.cgal.org/latest/Straight_skeleton_2/group__PkgStraightSkeleton2Ref.html) | Squelette pondéré et offsets de polygones à trous | Référence robuste à évaluer ; C++, intégration WASM à mesurer, paquet sous GPL avec alternative commerciale |
| [Clipper2](https://angusj.com/clipper2/Docs/Overview.htm) | Booléens et offsets, calcul interne en coordonnées entières | Alternative à comparer sur cas difficiles ; vérifier le binding choisi et sa licence, distincts du projet amont |
| [GEOS](https://libgeos.org/) | Prédicats, buffers, assemblage de polygones, validation et indexation | Excellent outil d’audit externe ; C/C++, LGPL, coût d’intégration navigateur à évaluer |
| [OSMnx](https://osmnx.readthedocs.io/en/stable/) | Collecte et analyse de réseaux urbains réels | Corpus de comparaison et mesures hors moteur ; données actuelles à filtrer, elles ne représentent pas automatiquement les plans anciens |

La compatibilité de licence, la maintenance, les bindings et la taille des distributions doivent être vérifiés sur la version effectivement retenue. Le choix proposé n’est pas « installer toutes ces bibliothèques » : commencer par les capacités déjà présentes, puis justifier chaque dépendance par un manque mesuré.

Des diagrammes de Voronoï pondérés peuvent aider à attribuer des territoires ou à respecter des surfaces cibles. Mais toutes les bibliothèques dites « weighted Voronoi » n’emploient pas la même définition de poids, et certaines attendent un domaine convexe. Leur usage sur des îles, des trous et des régions concaves demande des vérifications. [Exemple d’API et de limitations](https://github.com/Kcnarf/d3-weighted-voronoi).

### 2.9. Évaluer les 12 familles d’empreintes proposées

**La liste proposée est utile comme vocabulaire de création, mais ce n’est pas une taxonomie scientifique validée ni douze classes exclusives.** Plusieurs catégories se recouvrent : une ville peut être compacte, ovale et composite ; une ramification peut être la conséquence d’une vallée plutôt qu’une intention de forme.

Il faut d’abord définir la silhouette considérée. Une enceinte peut englober champs, réserves et jardins ; une agglomération peut dépasser ses murs. Pour comparer deux exemples, il faut retenir la même convention, la même époque et une échelle comparable. Les noms historiques fournis dans la demande sont des pistes de corpus : ils ne valident pas automatiquement la totalité de la silhouette d’une ville à toutes les périodes. Les plans reconstruits et les limites incertaines devront être signalés dans ce corpus.

| Famille proposée | Intérêt pour le générateur | Paramètres / mécanisme à distinguer |
|---|---|---|
| 1. Circulaire / ovalaire | Forme compacte à limite relativement régulière | Aspect, régularité, enceinte choisie ou croissance isotrope ; réseau interne indépendant |
| 2. Carrée / rectangulaire | Fondation ou extension à contour dirigé | Orientation, aspect, trame, surface réellement urbanisée dans l’enveloppe |
| 3. Polygonale | Enceinte ou limite composée de segments | Nombre de côtés, irrégularité et adaptation du tracé ; « polygonal » seul est trop large |
| 4. Organique compacte | Croissance irrégulière mais peu étirée | Attraction des accès, obstacles, parcellaire antérieur, irrégularité de grande échelle |
| 5. Allongée / fusiforme | Masse urbaine avec un axe dominant | Rapport longueur/largeur et épaississement du centre |
| 6. Linéaire / ruban | Fronts peu profonds autour d’une route ou d’une rive | Profondeur des bandes, continuité, nombre de fronts et polarités |
| 7. Éventail / secteur | Expansion depuis un point ou une ouverture contrainte | Angle disponible, position de l’apex et gradient de largeur |
| 8. Radiale à bras | Centre compact et extensions le long des accès | Nombre de bras, longueur, épaisseur et vides entre bras |
| 9. Ramifiée / dendritique | Croissance guidée par un réseau de vallées ou chemins | Profondeur des branches, confluences, contraintes physiques |
| 10. Lobée / polynucléaire | Masses reliées, souvent liées à plusieurs centres | Nombre et poids des centres, étranglements et stade de fusion |
| 11. Discontinue / archipel | Noyaux séparés appartenant au même ensemble | Composantes, distances, liaisons ; accepter les vides et le multipolygone |
| 12. Composite / asymétrique | Combinaison de formes et héritages | Séquence et assemblage de mécanismes ; mieux comme composition que comme forme primitive |

**Conséquence :** conserver les douze noms dans l’interface ou un catalogue d’exemples est possible. Les méthodes internes devraient plutôt exprimer compacité, allongement, anisotropie, nombre de noyaux, branches, fragmentation et régularité de limite. Une même méthode peut couvrir plusieurs familles et plusieurs méthodes peuvent produire une silhouette semblable.

Les modificateurs proposés restent utiles : insulaire, péninsulaire, en méandre, sur éperon, en terrasses, sur deux rives, portuaire, enceintes successives. Ils n’ont pas tous le même statut : les premiers contraignent le site ; « portuaire » ajoute une fonction et des accès ; les enceintes successives décrivent une histoire. Il ne faut pas les placer tous dans un unique champ « contrainte géographique ».

### 2.10. Évaluer les 12 familles de quartiers proposées

La liste des quartiers décrit surtout **des morphologies de réseau ou des organisations d’occupation**, plutôt que douze sortes de quartiers. Un quartier commerçant et un quartier résidentiel peuvent avoir la même trame ; un seul quartier peut mélanger une grille et des cours accessibles par impasse.

| Famille proposée | Nature principale | Interprétation utile |
|---|---|---|
| Orthogonal régulier | Réseau | Deux directions et espacements contrôlés |
| Orthogonal irrégulier | Réseau | Grille avec variations de taille, déformations et héritages |
| Organique | Réseau + processus | Plusieurs orientations locales ; ne pas assimiler à « bruit aléatoire » |
| Radial | Réseau | Axes vers une ou plusieurs centralités |
| Radio-concentrique | Réseau | Radiales et voies annulaires, éventuellement issues d’anciennes limites |
| Linéaire | Implantation + réseau | Axe principal et accès latéraux ; compatible avec plusieurs parcellaires |
| Ramifié / dendritique | Topologie du réseau | Arbre de desserte et hiérarchie des accès |
| Polynucléaire | Organisation des centres | Plusieurs tissus reliés ; pas un opérateur local unique |
| Topographique | Relation au site | Directions suivant contours, replats et liaisons verticales |
| Fluvial / littoral | Relation au site et aux accès | Fronts de rive, quais, axes parallèles et transversaux |
| En enclos / complexes | Organisation foncière | Grandes unités, portes et desserte interne, avec réseau extérieur variable |
| Agrégatif par clusters | Organisation de groupes | Espaces communs et groupes reliés, avec limites foncières parfois incertaines |

Les paramètres transversaux suggérés — régularité, densité, hiérarchie, centralité, perméabilité — sont pertinents. Il faut ajouter taille et allongement des îlots, profondeur de desserte, statut des passages, taille des unités foncières et part d’espace collectif.

**La distinction îlot / parcelle doit rester stricte.** La première dépend du réseau et de l’espace public ; la seconde dépend des façades, de l’usage foncier, des accès et de l’héritage. Une grille ne dicte pas un seul parcellaire, et un compound n’exige pas une silhouette particulière de ville.

### 2.11. Bilan de l’état de l’art pour notre problème

La combinaison la mieux motivée par les sources examinées est : champs et chemins pour l’armature, subdivision hiérarchique et motifs pour les tissus, méthodes de façade pour le parcellaire, et co-génération locale pour résoudre les accès. Une chronologie légère peut expliquer les contrastes entre extensions.

C’est **une synthèse proposée pour Magna Urbis**, pas un résultat expérimental établissant qu’elle bat toutes les autres méthodes. Le moteur actuel possède déjà une partie de ces briques ; le chantier consiste autant à améliorer leur orchestration qu’à ajouter des algorithmes.

## 3. Ce qu’on pourrait faire pour améliorer l’existant

[English translation of section 3](URBAN_REDESIGN_PROPOSALS_2026-10-13.md).

### 3.1. Priorité : clarifier les responsabilités avant d’élargir les styles

Je propose de séparer sept intentions, sans imposer à ce stade sept classes ou sept formats de données permanents :

1. **Site et contraintes :** terres, eau, relief, risques, franchissements et corridors.
2. **Programme :** population cible, activités, grands domaines et surfaces souhaitées.
3. **Centres et histoire :** noyaux, relations, ordre des extensions et éléments hérités.
4. **Empreinte :** réserve de croissance et terres effectivement attribuées.
5. **Armature et tissus :** destinations, voies principales, morphologies locales et espaces collectifs.
6. **Îlots et unités foncières :** découpage et desserte, avec réserves explicites.
7. **Parcelles finales :** façades, fonds, accès et droits ou statuts nécessaires à la future construction.

Les quartiers sociaux, fonctionnels ou administratifs pourraient être des regroupements d’îlots et de parcelles, ou des régions d’influence. Ils ne devraient pas forcément être les mêmes polygones que les secteurs de subdivision.

### 3.2. Distinguer quatre surfaces urbaines

Un seul contour ne suffit pas. Il serait utile de pouvoir afficher séparément :

| Surface | Question à laquelle elle répond |
|---|---|
| Réserve / enveloppe de croissance | Où le générateur est-il autorisé à urbaniser ? |
| Terre urbaine attribuée | Quelles rues, parcelles, places et domaines appartiennent déjà au plan ? |
| Limite fortifiée | Où se situe chaque enceinte physique ? |
| Occupation bâtie, plus tard | Où les bâtiments effectivement produits se trouvent-ils ? |

À l’étape actuelle, on peut donc parler d’**empreinte urbaine attribuée**, sans attendre les bâtiments. Les trous, jardins, enclaves et noyaux séparés doivent être représentables. La convexification ou la conservation arbitraire du seul plus grand morceau risquerait de détruire précisément les familles archipel, lobée et ramifiée.

L’espace rural doit être réservé à partir de la terre effectivement attribuée et des réserves voulues, pas d’un gabarit ambigu. Une zone laissée vide volontairement et un échec de génération doivent rester distinguables.

### 3.3. Produire l’empreinte par mécanismes plutôt que par douze algorithmes

Je recommande de comparer quatre mécanismes principaux.

**A. Fondation planifiée.** Un contour et une armature sont intentionnels : orientation, axes, limites, réserves et rythme de subdivision. Le terrain peut déformer le projet ou le rendre partiellement irréalisable. Le générateur doit expliquer ce compromis plutôt que rogner silencieusement une forme parfaite.

**B. Croissance par accessibilité.** Un ou plusieurs noyaux étendent leur influence selon les accès, les coûts du terrain et la disponibilité foncière. Une croissance anisotrope permet allongement, éventail et bras. Il faut distinguer attraction par une rive et interdiction de construire dans l’eau ou dans certaines terres humides.

**C. Accrétion le long d’un réseau.** L’urbanisation commence par les fronts desservis des chemins, routes ou quais. Les bandes s’épaississent près des centres et se rejoignent lorsque l’accessibilité le permet. Ce mécanisme convient aux rubans et faubourgs ; il évite de commencer systématiquement par un disque qu’on tente ensuite d’étirer.

**D. Fusion de noyaux.** Plusieurs centres possèdent leur propre budget, orientation et histoire. Leur union peut rester discontinue, devenir lobée, puis remplir certains interstices. Les connexions sont des choix d’accès et de croissance, pas de simples ponts polygonaux destinés à produire une silhouette connexe.

La forme composite devient une séquence de ces mécanismes. Les douze familles servent alors de préréglages, de descriptions du résultat et d’exemples de référence.

### 3.4. Relier population, surface et densité de façon lisible

Il faut définir explicitement la densité **brute** sur l’emprise urbaine et la densité **nette** sur les terrains résidentiels. La capacité des bâtiments sera une troisième notion, ajoutée plus tard.

Pour une planification simple, une surface brute cible peut être estimée par `population / densité brute`, en respectant les unités. Les grands domaines, places et infrastructures peuvent ensuite être réservés explicitement, si leur coût n’est pas déjà inclus dans cette densité. Il faut éviter de les compter deux fois.

Le résultat devrait indiquer : surface cible, surface sèche disponible, surface attribuée, part de voirie, part de réserves, population de planification et déficit éventuel. Un rayon manuel pourrait rester un outil artistique, à condition de rendre visible qu’il force une surface qui peut contredire le budget démographique.

Avant les maisons, ces valeurs donnent une cohérence de planification. Elles ne prouvent pas encore une capacité d’hébergement.

### 3.5. Donner un rôle distinct aux quartiers et aux tissus

Un **tissu** pourrait être une recette locale de rues, îlots, espaces communs et parcelles. Un **quartier** pourrait porter une identité : marché, port, communauté, fonction, origine ou phase. Un **secteur de calcul** serait simplement un domaine utilisé pour fabriquer le plan.

Cette distinction permettrait de représenter :

- Un quartier historique traversé par plusieurs secteurs de calcul.
- Une extension planifiée contenant des domaines religieux et du résidentiel.
- Un quartier de rive avec grille locale et parcelles laniérées.
- Des compounds organisés autour d’une place commune sans grille traversante.

Le nombre de quartiers peut rester un réglage artistique, mais ne devrait pas imposer systématiquement le même nombre de grandes coupes équilibrées. Les centres, barrières, usages et phases peuvent suggérer des limites ; le réseau doit ensuite rester cohérent à travers celles-ci.

### 3.6. Préparer les raccords avant de générer chaque tissu

Le problème des limites entre quartiers ne se résout pas seulement en corrigeant les derniers bâtiments. Il faut préparer les interfaces en amont.

Pour chaque frontière où une continuité est voulue, le plan peut définir des points de passage, une importance de voie, une largeur et une orientation admissible. Les deux tissus utilisent les mêmes points. Une frontière fermée possède au contraire des portes explicites ou interdit le passage.

L’armature principale reste partagée. Les rues locales peuvent être construites par subdivision guidée, croissance de branches ou adaptation de motifs, mais leurs interfaces respectent le même réseau. Les statuts public, collectif et privé interviennent dès les accès.

Cela ne signifie pas que toutes les rues doivent traverser tous les quartiers. Une faible perméabilité peut être intentionnelle ; une rupture accidentelle à une couture doit être distinguée de cette intention.

### 3.7. Faire coopérer rues locales et parcellaire

Proposition de boucle locale, inspirée du principe de co-génération :

```text
Îlot candidat avec rues existantes et réserves protégées
        ↓
Mesurer façades, profondeur et unités foncières possibles
        ↓
Le programme foncier peut-il être desservi ?
     ├─ Oui → découper les parcelles
     └─ Non → comparer trois réponses
                 • ajouter un accès autorisé
                 • conserver un domaine / espace collectif profond
                 • réduire ou déplacer le programme
        ↓
Recalcul local, contrôle de partition et d’accès
        ↓
Accepter, ou conserver un résultat partiel expliqué
```

La boucle doit être bornée et ne travailler que dans une région autorisée. Les axes principaux, portes et parcelles déjà gelées restent des contraintes. Chaque variante peut être évaluée selon longueur de voie ajoutée, terre consommée, nombre d’unités desservies, compatibilité culturelle et qualité géométrique.

Un fond non accessible ne devrait donc pas être systématiquement « réparé » par un jardin, ni systématiquement desservi par une rue. Le choix dépend du programme et du tissu.

### 3.8. Conserver plusieurs opérateurs de parcelles, avec un contrat commun

| Opérateur proposé | Cas favorables | Contrôle essentiel |
|---|---|---|
| Bandes de façade | Lots laniérés, fronts de route ou de rive | Largeur réelle, profondeur, angles et accès arrière |
| Subdivision orientée | Lots compacts de tissus planifiés | Accès de chaque enfant et orientation cohérente |
| Territoires de façade par squelette / distance | Îlots complexes avec façades concurrentes | Robustesse, pondération des angles et coût |
| Domaine entier | Palais, monastère, compound, réserve | Portes et organisation interne différée |
| Groupes autour d’un commun | Implantations agrégées | Accès collectif et propriété de l’espace commun |
| Transformations héritées | Extension, subdivision, fusion de parcelles | Conservation des limites et traces antérieures |

Tous les opérateurs devraient produire les mêmes informations utiles : géométrie, parent, usage prévu, façade ou accès, orientation, fond, statut de desserte et éléments protégés. On évite ainsi un moteur différent pour chaque culture.

Les dimensions doivent pouvoir dépendre du tissu et de l’usage, avec des distributions cohérentes. Ajouter de l’aléatoire indépendant partout n’améliore pas nécessairement le réalisme : des séries voisines peuvent partager module, orientation et profondeur, puis varier progressivement.

La future génération des bâtiments recevrait ces unités comme contraintes. Une difficulté de construction déclencherait une demande de modification explicite et locale, pas une retouche silencieuse du cadastre.

### 3.9. Introduire une histoire légère et vérifiable

Une simulation économique complète n’est pas nécessaire pour produire des héritages lisibles. Quelques événements suffisent à constituer un prototype comparatif : fondation, extension sur une route, agrandissement d’enceinte, absorption d’un noyau, découpage d’un grand domaine, fusion de lots ou ouverture d’un accès.

Chaque événement conserve certains éléments et en transforme d’autres. Une ancienne enceinte peut rester mur, devenir voie ou limite foncière, ou disparaître. Ces possibilités doivent être choisies par la recette, pas appliquées universellement.

Les phases concentriques actuelles peuvent rester un préréglage, mais il faut aussi des extensions unilatérales et des ajouts de centres. Une chronologie expliquerait alors la forme composite plutôt que d’en faire simplement une silhouette asymétrique bruitée.

### 3.10. Précision géographique et robustesse

Le raster régional convient à la sélection des sites et aux coûts grossiers. À l’échelle urbaine, il faudrait comparer l’usage de contours vectoriels d’eau et d’obstacles, ou d’un raffinement local, pour obtenir des limites à la bonne échelle. Lisser un escalier de pixels ne restitue pas une rive perdue dans le masque.

Une solution raisonnable est une approche hybride : coût régional raster, contraintes locales vectorielles, validation sur le relief disponible. Cela reste à mesurer et à concevoir avec la future interface terrain.

La géométrie doit être gouvernée par une politique commune : précision des coordonnées, tolérances, orientation des anneaux, points intérieurs des domaines concaves, gestion des trous, résidus et erreurs. « Partition exacte » doit signifier une topologie et une couverture contrôlées à une tolérance documentée ; des coordonnées flottantes et des booléens ne deviennent pas des constructions mathématiquement exactes par leur nom.

La robustesse doit préserver les informations : un trou non résolu ne doit pas être rempli ; une région inaccessible ne doit pas recevoir une façade artificielle ; une réparation ne doit pas jeter un noyau séparé sans explication.

### 3.11. Optimiser après avoir fixé les responsabilités

Les premières optimisations plausibles sont locales : index des segments et façades, calculs groupés de rubans, réutilisation des champs et du terrain, cache des géométries inchangées, recomposition limitée au secteur modifié. Si un squelette est utile, il peut être calculé une fois par îlot et réutilisé.

Les mesures doivent séparer empreinte, armature, raffinement, parcelles, transferts et préparation du rendu. Comparer les mêmes entrées et le même niveau de détail ; un gain obtenu en produisant moins de parcelles n’est pas un gain équivalent de calcul.

Le recours au GPU pourrait être pertinent pour des champs réguliers ou des coûts raster. Il n’est pas une priorité démontrée pour la topologie des graphes et les booléens locaux. Il faut profiler avant de complexifier cette frontière.

### 3.12. Comment départager les méthodes

La refonte a besoin d’un petit corpus représentatif, pas seulement de cartes séduisantes. Je propose une première matrice de cas :

| Cas | Ce qu’il doit révéler |
|---|---|
| Fondation rectangulaire sur terrain plat | Régularité, surfaces et lots cohérents |
| Ville compacte ouverte au croisement de routes | Bordures, bras de croissance et absence de fausses destinations |
| Village-rue sur un axe courbe | Façades, profondeur et épaississement près du centre |
| Ville en vallée | Allongement, rues praticables et terres non desservies |
| Ville de rive avec franchissement fixé | Séparation des masses, quai et accès au pont |
| Ville sur presqu’île ou éperon | Contraintes fortes et déficit spatial expliqué |
| Trois noyaux en cours de fusion | Composantes, raccordements et hétérogénéité des tissus |
| Ancien cœur + extension en grille | Interfaces et héritage des orientations |
| Grand îlot à accès ramifié | Besoin de desserte et traitement des fonds |
| Groupes de compounds autour d’un commun | Foncier collectif et réseau non traversant |

Les scènes isolées actuelles sont adaptées aux comparaisons de parcelles ; les décors figés servent aux silhouettes et à la géographie. Les mêmes scènes devraient être produites par la référence actuelle et par chaque variante.

**Contrôles indispensables :** absence de chevauchements significatifs, union correcte des unités, conservation des trous et réserves, intersections du réseau correctement nœudées, accès continu jusqu’à une destination ou à une composante autorisée, pentes respectées et résultat reproductible.

**Mesures de forme :** compacité `4πA/P²` selon la convention de contour, allongement, nombre de composantes, vides, largeur des bras, orientation des rues, degrés des carrefours, cycles, impasses, distributions des surfaces d’îlot, façades et profondeurs de parcelles. Pour les silhouettes discontinues, publier aussi les mesures par composante : un seul nombre global masque leur organisation.

**Jugement visuel :** diversité à paramètres identiques, lisibilité des centres, continuité des tissus et crédibilité des transitions. Les métriques ne doivent pas forcer toutes les villes vers une compacité ou une connectivité maximales : une impasse et un vide peuvent être intentionnels.

Les références historiques devraient être datées et assorties d’un niveau de confiance : relevé, restitution archéologique, plan ancien, contour reconstruit ou exemple purement artistique. Les villes modernes servent à tester les outils de mesure, pas à certifier le réalisme pré-Renaissance.

### 3.13. Ordre de travail recommandé

| Étape | Livrable concret | Condition pour poursuivre |
|---|---|---|
| 1. Clarifier le vocabulaire | Définitions des surfaces, quartiers, tissus, secteurs et accès | Chaque objet possède un rôle compréhensible |
| 2. Figer une référence | Petit corpus de décors et scènes, sorties jusqu’aux parcelles | Reproduction et diagnostics disponibles |
| 3. Comparer les empreintes | Gabarit actuel, croissance accessible, rubans et noyaux multiples | Variété réelle et budgets explicables |
| 4. Comparer les réseaux locaux | Coupes guidées, branches et motifs, avec interfaces partagées | Raccordements et contraintes conservés |
| 5. Comparer le parcellaire | Bandes actuelles, variantes orientées, outil de squelette ciblé | Partition et accès valides sur les cas difficiles |
| 6. Tester une boucle de co-génération | Accès ajoutés localement selon besoin foncier | Moins d’échecs sans destruction de l’armature |
| 7. Ajouter quelques événements de croissance | Extensions et fusions laissant des héritages | Contrastes compréhensibles et contrôlables |
| 8. Stabiliser puis profiler | Choix des méthodes et frontières du moteur | Qualité fixée avant les optimisations profondes |

Cet ordre évite de porter intégralement les réparations historiques dans une nouvelle architecture avant d’avoir décidé lesquelles restent nécessaires. L’application de référence et ses parcours restent disponibles pendant les comparaisons. L’UI conservée et le renderer temporaire ne doivent pas dicter à eux seuls le modèle final.

### 3.14. Décisions de conception à prendre ensemble

Les questions qui structurent réellement la suite sont les suivantes :

- Le quartier est-il d’abord une identité historique / fonctionnelle, une région de tissu, ou un regroupement d’îlots ? Peut-il porter plusieurs de ces dimensions séparément ?
- La population fixe-t-elle une surface cible, ou le contour artistique fixe-t-il la place disponible avec un budget démographique ajusté ?
- Souhaite-t-on une histoire explicite, ou seulement des contrastes de tissus plausibles ?
- Quels accès accepte-t-on : rue publique, ruelle collective, passage privé, cour partagée, accès par eau ?
- Les douze silhouettes servent-elles de préréglages guidés, de contraintes fortes, ou de descriptions du résultat ?
- Quelle importance donner à l’édition manuelle des centres, limites, axes et grandes unités foncières ?

**Recommandation de départ :** conserver les familles proposées comme vocabulaire utilisateur ; distinguer forme, site, centres, histoire, réseau et parcellaire ; comparer quelques mécanismes d’empreinte sur des décors figés ; puis tester une co-génération locale des accès et des parcelles. C’est la voie la plus directement liée aux faiblesses observées, tout en réutilisant les bonnes bases déjà présentes.
