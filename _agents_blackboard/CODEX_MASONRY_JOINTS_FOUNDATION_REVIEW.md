# masonry_joints — périmètre structurel

23 octobre 2026. Audit initial puis extension étroite autorisée et appliquée ; validation coordonnée par root. Aucune compilation lancée par cet agent.

Le refus actuel provient exclusivement de la liste des détails acceptés dans `engine.rs::prepare_foundation::supported_parameters`. Le détail n’est pas exécuté par `structural_unit` : cette fonction construit corps/niveaux/appuis, appelle `add_structural_circulation` et convertit les enceintes déclarées. `add_structural_circulation` traite les galeries/porches/enceintes/bases ; son cas par défaut ignore `masonry_joints`.

Le seul consommateur du littéral `masonry_joints` dans le moteur Rust est `features.rs::add_details_for_role` → `wall_marks`, avec `FeatureKind::DecorativePanel`, largeur0,45m, hauteur0,35m et matériau d’enduit. `wall_marks` ajoute un rectangle de profondeur0,12m sur un mur extérieur ou de coque non mitoyen, à `wall.z_m+1,05m`. Il évite les passages déjà présents ou produit un diagnostic d’inapplicabilité. `feature()` fixe `roof=None`. Cette branche ne modifie ni corps, ni murs, ni sols, ni routes verticales, ni portail ; elle n’ajoute aucun appui ou toit.

Les consommateurs ultérieurs d’accès ne classent pas `DecorativePanel` comme surface de marche, obstacle ou support. Les toitures ne l’utilisent pas comme appui et n’y attachent pas de couverture. Les étapes post-accès/post-toiture n’ont aucun cas `masonry_joints`. **Il s’agit donc d’un décor dans ce chemin**, pas d’une obligation porteuse omise par la préparation. Attention à ne pas généraliser cette conclusion à tout `DecorativePanel` : le composant spatial `windbreak` utilise aussi ce kind ; il doit rester hors liste de structures admises.

La décoration augmente le nombre de features avant la construction des accès détaillés ; certains identifiants d’interfaces utilisent ce nombre. Une comparaison globale de tous les IDs après retrait du détail serait trompeuse. Le test ne doit justement pas retirer le détail. Il doit consommer le même Resolved, garder ses paramètres exacts et contrôler les formes/connexions natives réelles.

## Raccord minimal proposé, encore non activé

Ajouter uniquement `"masonry_joints"` au match des détails autorisés dans `supported_parameters`. Conserver tous les autres prédicats : `Layout::Strip`, RECT/LONG, Ground/Walled, niveaux inchangés, absence de programme inconnu/couverture/enceinte, `known_feature` limité aux véritables Gallery/Post/PartyWall. Ne pas ajouter `DecorativePanel` à `known_feature`, ne pas appeler `add_details` dans la préparation structurelle, ne pas modifier `native_site_features` globalement. Le décor demeure dans les paramètres et dans l’enrichissement détaillé.

Les appels de production resteraient soumis à `native_ground_preparation_allowed` : demande automatique inspired domestic/mixed, aucun pin/override/workshop. `Single` reste Unsupported ; B12, les demandes strictes et les témoins épinglés B13 conservent leur ancien parcours. Cette extension d’un détail n’est pas une extension du programme d’accès ni une certification de tous les raccords.

## Preuve ciblée à préparer après GO

1. Construire une seule fois chaque Resolved B13 2/3/4 niveaux depuis ses paramètres canoniques et le conserver par sérialisation exacte. Ne pas relancer la sélection entre les deux voies. Le choix de B13 est un témoin contrôlé : cela ne prouve pas sa fréquence de sélection automatique.
2. Avant le raccord, constater explicitement Unsupported avec le détail conservé. Après le raccord, comparer `prepare_foundation_domains` aux corps/niveaux/appuis de `structural_unit` du même Resolved, puis `prepare_foundation_and_entry` à son vrai portail. Réutiliser les vérifications de passages/solides du helper, sans entrée proxy.
3. Pour la pose urbaine, garder une demande de site automatique sans pin et injecter uniquement ce Resolved déjà choisi dans les appels de visualisation de test : même source, dimensions, orientation et origine pour comparer les deux admissions. Vérifier cadastre/réserves/voisins/toit, terrain depuis les vrais appuis et résultat du raccord ; un refus public reste un refus, jamais une permission de réduire la cour ou déplacer la porte.
4. En cas de raccord admis, archive JSON exacte puis extérieur/intérieur du plan retenu. Affirmer `details` inchangés contenant `masonry_joints`, décor encore présent lors du détail si un mur le permet, niveaux/escaliers accessibles et empreintes identiques. Ne pas traiter les IDs dérivés de `features.len()` comme une modification architecturale.
5. Témoins négatifs courts : B12 Single reste Unsupported ; pins B13/strict/override ne déclenchent toujours pas l’upgrade automatique ; structure inconnue/enceinte demeure Unsupported. Aucun seuil physique, nom de recette ou filtre culturel à modifier.

Ces contrôles suffisent pour décider du petit raccord. Ils ne certifient ni tous terrains, ni toutes graines, ni une capacité de logements. Aucun benchmark de ville ni nouvelle source historique n’est requis pour cette clarification moteur.

## Livraison limitée, en attente de compilation commune

`engine.rs` ajoute seulement le littéral `masonry_joints` à la liste `supported_parameters` et enregistre `masonry_joint_foundation_tests.rs`. Aucun autre prédicat ni seuil n’est modifié. Le formatage du nouveau test a été vérifié avec `rustfmt`, sans Cargo.

Le premier test conserve chacun des trois Resolved B13 (2/3/4 niveaux) : corps/niveaux/appuis canoniques, cours et passages réservés, même portail préparé, archive exacte, puis enrichissement avec le portail retenu et les DecorativePanel `detail-masonry_joints-*` effectivement émis. Le second refuse encore B12 Single, le littéral non audité `brick_joints` et un DecorativePanel ajouté comme structure au plan. Les tests d’intégration existants des exclusions exact/recette/variante/niveaux/strict n’ont pas changé.

**Portée de cette preuve :** les deux nouveaux tests sont des tests moteur sous `engine::masonry_joint_foundation_tests`, sans appel à `plans::visual`. Ils ne prouvent donc pas l’admission d’un site automatique, ses droits, son terrain ni son raccord public. La promotion reste conditionnée à la compilation et aux validations urbaines/rejeux coordonnés par root. Les pins servent ici uniquement à sélectionner un témoin natif stable ; ils ne deviennent pas admissibles à l’upgrade urbain.
