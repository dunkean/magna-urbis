# B06 — fidélité et coût d'une préparation structurelle légère

Lecture seule, 2026-10-23. Aucun code produit, copie, Cargo ou nouveau natif.
Points transmis à java_sources avant son prototype. Cette note est un contrat
de comparaison, pas une autorisation par recette ou une mesure de vitesse.

## Ce qui peut être partagé sans construire les pièces

`engine::build_body` et `structural_unit` initialisent tous deux
`Level.floor = domain.clone()`. L'érosion `offset(domain, -wall)` sert à
l'intérieur et aux pièces ; elle ne remplace pas ce plancher brut. Les mutations
du plancher par escaliers/trémies arrivent après `add_details`, pendant l'accès.
Ainsi `features::posts` doit recevoir le plancher entier existant : ses quatre
positions aux fractions 0,25/0,75, ellipses à16sommets et contrôles d'emprise
seront exactement ceux du constructeur détaillé. Une érosion préalable
déplacerait les poteaux et serait un défaut de fidélité.

Sur les témoins B06 Ground0/Walled/RF-HIP, `add_body_supports` ne crée ni grille
de pilotis ni FloorSlab ; le toit HIP ne crée pas de Terrace. Avec les features
initiales vides, les quatre posts ont donc les suffixes0..3 puis le Frame
`open_sides` le suffixe4, comme dans le natif détaillé.

Le mur extérieur partageable vient de la primitive native :
`difference(domain, offset(domain, -wall))`, puis soustraction de la circulation
au même niveau. Ce n'est pas `domain - Level.floor`, qui serait vide. Pour ces
témoins sans chemins, cours, central_aisle, cellules ni plusieurs ménages, aucune
circulation supplémentaire n'est créée avant les détails. Le premier mur est
`wall:unit-0:body:0:0:0`, l'intérieur éventuel suit avec suffixe1. Le helper doit
conserver le matériau du niveau, `body_level_height`, la wall_thickness effective,
les IDs et l'ordre, avec une primitive commune plutôt qu'une seconde formule.

Attention aux paramètres effectifs : le témoin target-met a **une pièce** dans
son `BodySpec.parameters`, alors que la déclaration du composant main conservée
dans le bundle porte encore deux pièces. Le témoin moderate en a deux. Il faut
consommer le BodySpec résolu, pas relire le composant source pour reconstruire.

## Pièces et dépendances à conserver

- `four_master_posts` ajoute les quatre vrais appuis avant accès. Leur exclusion
  des solides de la future entrée serait une erreur, même s'ils sont tous dans
  l'emprise du corps.
- `open_sides` coupe les murs extérieurs des côtés haut et droit. Il conserve
  un Frame élevé sur le côté haut, à `level.z + height - 0,18`. Un simple ajout
  de Frame sans les découpes natives ne produit pas la même porte.
- `high_central_pyramid` appelle `roof_trait`, qui vérifie la compatibilité du
  système et produit éventuellement un diagnostic. Il ne crée pas un deuxième
  volume dans cette voie. Le vrai toit HIP, ses débords et ses droits restent
  ceux du constructeur et des gardes existants.
- Après accès, les murs découpés et les vrais linteaux doivent être exportés.
  Tous leurs domaines, y compris les Frame/linteaux élevés, gardent leurs droits
  d'occupation. Une pièce élevée n'est pas un appui au sol indépendant : le
  futur contrat d'assise doit utiliser les sections au sol et tous les poteaux,
  sans faire disparaître les pièces élevées du cadastre ou du rendu.

L'accès structurel sans pièces peut choisir un portail différent de celui de
l'oracle détaillé. Les murs intérieurs n'existent pas encore ; leur topologie
peut influencer les axes possibles et le portail canonique. Il faut donc prouver
le rejeu de **l'entrée réellement retenue par le helper**, et pas substituer
dans le test le portail produit par l'enrichissement complet. Le refus de
rejeu demeure un résultat autorisé ; il ne doit pas modifier l'incumbent.

## Ground0 et l'étiquette platform

L'étiquette `elevation_family=platform` ne crée pas à elle seule un socle dans ce
chemin : `layouts::spec` lit d'abord le système de support ; hors pilotis/piles/
raft, seules les étiquettes sunken/excavated imposent ici un z négatif. B06 possède
bien SupportKind::Ground, hauteur[0,0], corps et niveau z0, Envelope::Walled.
Le filtre actuel `elevation_family == ground` l'écarte donc pour une raison de
périmètre, pas pour une plate-forme physique présente dans ces trois plans.

Ce constat ne justifie pas d'autoriser globalement les plateformes. Préserver
les conditions physiques sur le bundle principal ET chaque BodySpec, les plans
réellement retenus, les features/voids/contexte, et les exclusions d'autres traits.
Envelope::Open déclencherait notamment la grille de supports et la dalle : c'est
un autre programme. La voie finale seulement, la pose unique et les exclusions
pins/overrides/strict/exact doivent rester intactes.

## Coût prévisible et preuves négatives

Pour un corps rectangulaire à un niveau, les opérations additionnelles sont
bornées : mur extérieur, quatre poteaux, deux coupes de face et un Frame, puis
le graphe d'accès natif et une admission complète déjà prévue. Aucun tirage,
recherche de pose, subdivision des pièces ou mesh de toiture n'est nécessaire
pour ces structures. Réutiliser une seule unité préparée évite le double travail
structure→entrée ; ne pas appeler `enrich_architecture` à chaque candidat.
Le coût des booléens et du graphe doit néanmoins être mesuré après prototype,
pas déclaré nul ou plus rapide sur cette seule lecture.

Négatifs utiles : appui dans le passage ; Frame ou mur hors droits ; emprise
imposée/pin/mode strict ; support réellement surélevé ; Envelope::Open ; niveau
supplémentaire/escalier ; enclosure/cour/galerie/feature initiale inconnue ; trait
structurel non pris en charge ; pièce ou mur intérieur empêchant de rejouer
l'entrée. Le succès de préparation ne certifie ni les pièces ni la capacité.

## Vérification indépendante de l'oracle déjà produit

Dans `web/out/b06-feature-rights-isolated-proof/`, les trois JSON indiquent une
admission à pose identique et un rejeu extérieur/intérieur réussi. Moderate et
large ont respectivement2/4 PortalLintel, tous sur les murs supérieurs réels.
Target-met en a0 : son portail est sur y22, côté déjà ouvert ; l'intersection
GEOS du passage avec l'unique mur et les4poteaux vaut0. Le Frame à z2,62..2,8
traverse0,136m² de sa projection, au-dessus du passage. L'absence de linteau y
est donc attendue. Les écarts de domaines de features entre admission et intérieur
restent ≤1,80e-7m² dans les trois rapports. Cette preuve vient de l'oracle complet,
pas encore du futur helper léger.

## Relecture du prototype léger isolé

La version préparée dans `web/out/houses-b06-light-workspace/rust` a été relue
le 2026-10-23, sans édition de cette copie ni exécution native. Aucun blocage
concret trouvé dans le périmètre déclaré ; ce verdict de lecture ne remplace
pas les tests de compilation et de rejeu.

`single_frame_entry_details` ne certifie que quatre opérateurs exécutables.
Les conditions physiques communes restent contrôlées sur les paramètres
principaux et ceux du corps : Single/RECT/Ground0/Walled, un seul niveau réel,
pas de cour, chemin, cellule, vide, feature préalable ou contexte obstacle.
Les profils, coquilles, voûtes, galeries, autres détails et supports surélevés
restent exclus. L'étiquette `platform` seule n'ajoute donc aucune capacité.

`structural_unit_with_single_entry_details` appelle les mêmes primitives de
mur que `build_body`, puis les opérateurs dans l'ordre déclaré. Il conserve
les matériaux du niveau et les paramètres effectifs du corps pour les murs,
ainsi que les paramètres principaux pour les détails, comme `add_details`.
Le test structurel compare les corps, les features et les murs extérieurs
avant accès avec cette étape du constructeur complet. Il exige aussi zéro
pièce, zéro mesh de toit et zéro graphe d'accès à ce stade.

Le graphe ensuite construit est propre au wrapper léger. Les murs découpés,
posts, Frame et linteaux sont tous exportés après accès. L'assise conserve les
sections murales et features à hauteur du sol ; les pièces hautes restent dans
l'occupation complète. La branche finale Single conserve sa pose unique et
revient au bâtiment admis si la préparation ou l'admission échoue. Aucune porte
alternative ni demi-tour ne s'ajoute à cette proposition.

Les deux tests négatifs séparés sont archivés dans
`proposals/b06_light_negative_review/` et ont été repris dans la copie isolée.
Ils exigent d'abord la préparation positive du vrai témoin, puis refusent les
mutations de support, d'étage, de détail, d'enveloppe, de toit, de pente
synthétique, de forme, de cour, de circulation et de contexte. Ils vérifient
que la source retenue n'est pas modifiée. Le positif d'intégration exige que
le portail archivé soit celui du wrapper, puis réalise extérieur et intérieur
de tout témoin effectivement admis ; une absence de raccord reste un refus
explicite, sans substitution par un portail d'oracle.

Précision de coût : il y a une préparation structurelle par appel final, sans
préparation aux essais intermédiaires. Le mécanisme existant
`budget_selection::finalize` peut toutefois examiner le candidat adapté puis
le nominal lorsque le premier perd son entrée. Il ne faut donc pas annoncer
une seule préparation globale par bâtiment sans mesurer ce repli existant.
