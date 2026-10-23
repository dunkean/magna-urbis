# P2 01-l — anomalies restantes, lecture indépendante

Lecture offline du rejeu du 22 octobre 2026 à 21:00:40 UTC : [métriques](city-visual-audit-p2/01-l/metrics.json), [formes](city-visual-audit-p2/01-l/shape-metrics.json), [requêtes](city-visual-audit-p2/01-l/requests.json), [partition](city-visual-audit-p2/01-l/partition.json). Aucun recalcul urbain, serveur ni source core modifiée.

## Trois parties fines : deux roues et une nef

Préfixe commun des IDs : `layout-f9dab5910f08a8a2/`. Les dimensions ci-dessous sont celles de la boîte minimale tournée, en mètres. Ces formes viennent de `request.preview` ; elles n'ont pas de `resolved` Houses et ne prouvent donc aucune réalisation native.

| ID après préfixe | Partie / rôle | Dimensions ; aire | Centre (x ; y) |
|---|---|---|---|
| `block-ccbe1a729f2fcbad/parcel-d940ef333ab4c449/building` | 1, `wheel` / `craft.mill` | 1,500 × 6,807 ; 9,5405 m² | 6018,564 ; 8713,885 |
| `block-2c77cfe0587c7cf1/parcel-cfb2a5b0826c90da/building` | 1, `wheel` / `craft.mill` | 1,500 × 9,000 ; 13,5000 m² | 9042,986 ; 7710,567 |
| `block-9052b713adf48500/parcel-bbe124651b5255cd/building` | 0, `nave` / `worship.parish` | 2,194 × 6,432 ; 7,0553 m² | 9442,857 ; 7739,024 |

Les deux premières sont des roues de moulin dessinées, pas des maisons minces. Leurs maisons font respectivement 68,6485 et 144 m² ; les ensembles atteignent 78,189 / 78,2 m² demandés et 157,500 / 157,5 m². La nef reste un triangle à trois sommets, angle minimal 21,509°, contre un chœur de 90,4097 m² : l'ensemble respecte presque la cible (97,465 / 97,5 m²), mais sa composition visuelle reste dégradée. Les trois previews sont valides et dans leur lot, à 5,31 × 10⁻⁹ m² près. Leurs requêtes portent encore `config.recipe = EUR-MED-B02` : ne pas confondre ces silhouettes fonctionnelles avec une recette native réalisée.

## Une parcelle brute toujours invalide

`layout-f9dab5910f08a8a2/block-7fd1f1169a2c89c7/parcel-47f742f6f58c9bff` : jardin `attached-rear-land`, 10,1713 m², boîte 3,767 × 12,431 m ; centre après réparation de mesure (8612,189 ; 6785,391). Auto-intersection à (8608,83488206973 ; 6784,89749561195), à environ 0,027 micromètre du sommet voisin. `make_valid` produit une pièce de 10,171257208 m² et un triangle de 6,43 × 10⁻⁸ m². C'est une réparation de mesure seulement : `partition.json` conserve la forme brute invalide.

Aucune requête de bâtiment ne concerne ce jardin. Son parent `block-7fd1f1169a2c89c7/parcel-c2b7949f55955cf4` existe ; sa parcelle, son cadastral, son buildable et sa preview sont valides.

**TODO maintenu.** Zéro angle inférieur à 20° concerne seulement les parties du cœur ; l'audit ignore les segments de moins de 1 m pour les angles. Les 21 paires voisines aux fronts proches mais aux aires dans un rapport supérieur ou égal à 3 restent présentes. Deux roues expliquent le compteur de finesse sans être des défauts de logement ; la nef et l'invalidité brute restent à traiter. Aucun de ces indicateurs ne certifie les plans Houses.

Optimisation Houses indépendante : `Catalogue::validate_config` s'arrête au premier succès, tandis que la sélection conserve la liste complète et ses erreurs. Aucun gain en millisecondes mesuré ou annoncé.
