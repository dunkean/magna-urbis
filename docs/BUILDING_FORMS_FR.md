# Formes des bâtiments : masses, rôles, toits et styles

Comment les bâtiments prennent leur forme, et comment ajouter un style, une partie de bâtiment, un monument ou un plan de maison sans toucher au pipeline de génération.

Version anglaise (référence) : [BUILDING_FORMS.md](BUILDING_FORMS.md).

## L'idée

Un bâtiment est un assemblage de **masses** : des emprises convexes (surtout des rectangles dans le repère du bâtiment) qui ne se recouvrent jamais en plan, chacune avec une étiquette qui dit ce qu'elle est (`building`, `wing`, `nave`, `aisle`, `cavea-2`, `pagoda`…). Trois couches transforment les masses en volumes :

| Couche | Code | Données | Ce qu'elle décide |
|---|---|---|---|
| Plan | `urban/forms/plan.rs` (maisons), `urban/parcels/monuments/*.rs` (bâtiments singuliers et utilitaires) | `forms/styles.json` (kits) | Quelles masses se tiennent où |
| Élévation | `urban/forms/roles.rs`, appliqué dans `urban/massing.rs` | `forms/roles_*.json` | Hauteur de mur, base, forme et pente du toit, gradins, matériaux de chaque étiquette |
| Toits | `urban/forms/roof.rs` | aucune | Les solides de toit et leur union sur la parcelle |

Les moteurs de rendu reçoivent des pans de toit explicites et ne recalculent jamais un toit : une nouvelle forme de toit ne demande aucun code web.

## Options

Ce sont des champs de la configuration de plan de ville, visibles dans les panneaux de la V2 et de City Bench.

| Option | Valeurs | Effet |
|---|---|---|
| `houseComplexity` | `simple` (défaut), `complex` | `complex` compose les maisons avec la grammaire de plans et leur donne des toits composés, des cheminées et des lucarnes. Un bâtiment isolé (ferme, moulin, auberge seuls) est toujours composé. |
| `singularDensity` | 0 à 3, défaut 1 | Règle le nombre de bâtiments singuliers et utilitaires (monuments, auberges, tavernes, écuries, entrepôts). 0 ne garde que le monument central. |
| `backBuildings` | 0 à 1, défaut 0,5 | Part des parcelles de ville (cœur et zone intermédiaire) bâties à moins de la moitié de l'emprise de leur tissu qui bâtissent le terrain derrière leur maison ; les autres gardent leur cour ou leur jardin. Seul un corps sur une rue ou une ruelle est une maison : les autres sont des dépendances basses (`annex`), desservies par leur parcelle. 0 laisse chaque parcelle avec sa seule maison. |
| `styleSheet` | par facette, des cultures pondérées | Villes hybrides : à quelles cultures puisent les rues, les parcelles, les maisons, les monuments et les fermes (voir plus bas). Vide par défaut. |

Les monuments, les bâtiments utilitaires et les bâtiments isolés passent par le moteur de formes quelle que soit la première option.

## Toits

Un toit en pente sur une masse convexe est l'enveloppe inférieure de quelques plans ; le toit d'une parcelle est l'enveloppe supérieure des toits de ses masses. Conséquences :

- une aile dont le pignon s'appuie sur un corps au moins aussi haut pénètre dans le toit de ce corps jusqu'à son faîte, avec de vraies noues ;
- un `shed` dont la règle dit `"high": "main"` est un appentis qui meurt contre le mur plus haut qu'il touche (bas-côtés, galeries, appentis) ;
- une tour, une cheminée ou une lucarne masque le toit sous elle et sort du versant ;
- les débords dépassent des murs là où un bâtiment est dégagé.

Formes composées : `gable` (deux pans), `hip` (croupes), `shed` (appentis), `pyramid`, `halfhip` (demi-croupe), `gablet` (croupe sous un petit pignon, le toit à croupe et pignon d'Asie orientale), `gambrel`, `mansard`, `saltbox` (toit asymétrique). Les toits plats et courbes (`flat`, `dome`, `cone`, `barrel`, `tent`) sont dessinés par les moteurs de rendu d'après leur forme et ne font que masquer.

Pour ajouter une forme en pente, ajouter ses plans dans `roof.rs` (`planes`) et son repli dans `plain`. Rien d'autre ne change.

## Rôles des masses (`forms/roles_*.json`)

Une règle par étiquette ; une étiquette sans règle garde l'élévation intégrée de `massing.rs`. Le schéma est documenté dans le `_doc` de `roles_core.json`. En bref :

| Champ | Sens |
|---|---|
| `eave` | Hauteur de mur au-dessus de la base : `{"m":[min,max]}`, `{"floors":n}`, `{"rel":[min,max]}` (étages de la parcelle plus un écart), `{"nave":k}` (fois la hauteur de nef du monument), `{"width":k}` (fois le petit côté de la masse), `{"main":k}` |
| `base` | `"ground"` (au sol), `"stack"` (sur la masse en dessous), `{"m":x}`, `{"main":k}` |
| `roof`, `pitch`, `strict` | Une forme, `"culture"`, ou un tirage `"a|b"` ; des degrés, une plage, ou `{"culture":écart}` ; `strict: true` garde le toit en pente de la règle sous une tradition de toits plats, qui sinon aplatit les formes en pente ordinaires |
| `axis`, `high` | Direction du faîte (`long`, `short`, `street`, `main`, `cross`) ; côté haut d'un appentis (`main`, `street`, `back`) |
| `tiers` | Étages en retrait : `{count, inset, first, skirt:{rise,overhang}, top}` (pagode, tour à gradins, stupa, phare) |
| `round` | Remplace l'emprise par un polygone régulier de ce nombre de côtés |
| `wall`, `cover`, `openings`, `minor`, `overhang`, `floors`, `composable` | Matériaux, murs aveugles ou porte seule, petite masse décorative, débords, étages montrés, corps qui peut se rompre en parties |

`overrides` remplace une règle pour un identifiant de culture ou une famille de monuments (`western`, `orthodox`, `maghreb`, `persian`, `chinese`, `japanese`, `indic`, `antique`, `american`, `african`) : c'est ainsi qu'une culture élève à sa façon une partie partagée.

Fichiers : `roles_core.json` (parties de maison et parties génériques), `roles_monuments_a.json` (classique, médiéval, islamique, civique), `roles_monuments_b.json` (utilitaire, Asie, Amériques, Afrique, fantasy), `roles_rural.json` (fermes, sites d'activité et monuments de campagne), `roles_modern.json` (styles modernes).

## Plans de maisons (`forms/plan.rs`, `forms/styles.json`)

L'occupation ajuste le corps de la maison dans sa parcelle ; la grammaire compose autour de lui, dans la place que laisse la parcelle, un plan tiré du kit : `bar` (barre), `ell` (L), `tee` (T), `court` (deux ailes arrière, U), `cross` (une aile croisée plus haute à un bout), `aitch` (une à chaque bout, H), puis les extras (appentis arrière, porche, avant-corps, tourelle d'escalier dans l'angle rentrant). Les parties sont des rectangles entiers étiquetés `building`, `wing`, `crosswing`, `outshot`, `porch`, `bay`, `turret` ; chacune est ajustée dans la parcelle et abandonnée si elle n'y tient pas.

Un **kit** (`styles.json`, `kits.<id>.house`) porte les poids des plans, l'influence de la place et de la richesse sur les grands plans, les chances des extras, des cheminées et des lucarnes, les formes de toit d'une maison, les débords et le matériau des cheminées. Une culture reçoit son kit par `cultures.<id>.kit`, sinon par la première règle `derive` que ses traits de bâti satisfont (forme de toit, mur, couverture, pente), sinon par `default`. Le code ne teste jamais le nom d'une culture.

## Bâtiments singuliers et utilitaires (`parcels/monuments/`)

Une forme pose des parties étiquetées sur son site avec le mini-langage `Site` de `parcels/landmark.rs` : `rect`, `bar`, `disk`, `apse`, `small`, `poly`, `ellipse`, `wedges` (couronne de gradins), `ring`, `court`. `monuments::build` interroge chaque famille à son tour : `modern` et `rural` d'abord (elles ne répondent qu'à leurs propres rôles), puis les familles culturelles (`classical`, `islamic`, `asian`, `american`, `african`, `fantasy`, `medieval`), puis les formes partagées `civic` et `utility`. Une famille qui décline laisse le site et le flux aléatoire intacts, et les formes plus anciennes de `landmark.rs` s'appliquent alors.

Quels rôles existent, pour quelles cultures et en quel nombre relève du programme : `services.json` (familles, `cultureServices`, `harbour`, comptes) et `roles.rs`. L'option de plan `singularDensity` règle combien un lieu en reçoit.

## Sites de campagne (`activities.json`, `parcels/monuments/rural.rs`)

Les sites d'activité et les monuments de campagne utilisent les mêmes formes que les villes. Un archétype de `activities.json` peut porter `form: {role, site, has, absorbs}` : `role` nomme la forme à bâtir (un rôle de `services.json` comme `worship.parish`, ou un rôle de campagne, `rural.windmill`, `rural.barrow`), `site` le terrain qu'elle demande en mètres (façade, profondeur), `has` une étiquette de partie que la forme de la culture doit contenir (sinon le bâtiment garde son anneau unique), `absorbs` les archétypes de la même cour que la forme contient déjà (un clocher, un cloître). `activities::formed` remplace alors le bâtiment par les parties de cette forme, un bâtiment par partie, sur un terrain que le site accepte ; une forme refusée par le terrain ou que la culture ne bâtit pas laisse la cour telle quelle.

`rural.rs` porte les formes `rural.*` : moulins par type (à eau, à marée, sur pivot, tour, à jupe, à axe vertical), scieries, forges et fonderies, fours (chaux, briques, verre, charbon de bois, goudron), têtes de mine, carrières, salines, stations de pêche, pressoirs, granges dîmières, greniers, pigeonniers, bergeries, tours de guet et de feu, maisons de péage, ermitages, oratoires, croix et puits de chemin, mégalithes, tumulus et tombeaux. Un sous-rôle fixe une variante (`rural.windmill.post`) ; le rôle nu laisse la culture et le site choisir. Leurs parties sont élevées par `roles_rural.json`.

## Ajouter quelque chose

| Pour ajouter | Faire |
|---|---|
| Les maisons d'un style | Un kit dans `styles.json` (ou en réutiliser un), et `cultures.<id>.kit` si les règles `derive` ne le choisissent pas |
| La façon dont une culture élève une partie | Une entrée sous `overrides.<culture ou famille>` dans un `roles_*.json` |
| Une nouvelle partie de bâtiment | Une étiquette dans une forme et sa règle dans un `roles_*.json` |
| Un monument ou un bâtiment utilitaire | Une forme dans le fichier de famille de `parcels/monuments/`, le rôle dans `services.json` |
| Un site ou un monument de campagne | Une forme `rural.*` dans `parcels/monuments/rural.rs`, les règles de ses parties dans `roles_rural.json`, `form: {role, site}` sur l'archétype dans `activities.json` |
| Un style moderne | Une culture dans `styles_modern.json` (kit, traits), son tissu dans `catalogue.json`, sa famille de services dans `services.json`, ses formes dans `parcels/monuments/modern.rs` et leurs règles dans `roles_modern.json` |
| Un plan de maison | Une branche dans `compose` de `plan.rs` et son poids dans les kits |
| Une forme de toit | Ses plans dans `roof.rs` |

## Traits de culture

Ce qui distingue les bâtiments d'une culture sans figurer dans son tissu vit dans `cultures.<id>.traits` de `styles.json` (`styles_modern.json` pour les styles modernes) : la tradition de toit d'une culture dont le tissu ne déclare pas d'`arch` (`tradition`), le bâti méditerranéen (`mediterranean`), la famille de détails des toits plats (`flavor`), la taille des habitants (`bodyScale`), l'échelle de la maison entière (`metricScale`), la forme extérieure des maisons (`form` : tree, mushroom, longhouse, yurt, battered, mage, stilt) et la part des lots qui la prennent (`formShare`), un seul étage massif (`massiveStorey`), les maisons sur pilotis (`piles`), l'ouverture des façades (`openness`, `lightWallOpenness`). `massing.rs` lit ces traits et jamais le nom d'une culture.

## Villes hybrides : la feuille de styles

L'option de plan `styleSheet` dit, facette par facette, à quelles cultures un lieu puise. Une facette est un mélange pondéré pour le lieu entier (`city`), pour une zone de croissance (`zones` : core, middle, edge, faubourg, village) ou pour un quartier ; chaque lot, îlot ou quartier (`spread`) tire une culture de son mélange à partir de la graine. Une facette vide suit la culture du lieu.

| Facette | Ce qu'elle change | Où elle est lue |
|---|---|---|
| `streets` | La grammaire de rues d'une zone (la culture la plus lourde de son mélange) et, sauf avis contraire des autres facettes, son tissu | `influences.rs` |
| `plots` | Le découpage cadastral d'une phase de croissance (opérateur de parcelles, façade, profondeur, emprise) | `parcels.rs` |
| `houses` | Les maisons : la culture tirée bâtit dans son propre tissu (plan, étages, toits, matériaux) | `building_sites.rs` |
| `monuments` | Les bâtiments singuliers et utilitaires : chaque communauté apporte ce qu'a un lieu de sa taille et de sa culture, bâti dans ses propres formes | `roles.rs`, `programme.rs` |
| `rural` | Les types de fermes des lots de ferme | `building_sites.rs` |

Un cœur ancien d'une culture dans des extensions d'une autre, les maisons d'un peuple sur les parcelles d'un autre, ou une ville aux monuments de deux cultures sont des feuilles de styles. Le résolveur est `forms/sheet.rs`.

## Facettes de style

`styles.json` réserve, sous `styles.<id>`, les facettes d'un style entier : `houses` (kit), `monuments` (famille de services et surcharges de rôles), `rural` (types de fermes), `siting` (implantation), `plots` (parcelles), `streets` (trame, hiérarchie, taille des îlots), `plan` (noyau, enceinte, zonage), `regional` (classes de routes entre les lieux) et `epochs` (liste ordonnée de styles pour les phases de croissance d'un lieu). Chaque facette nomme un style source ou porte ses propres valeurs : une ville hybride est un style dont les facettes viennent de sources différentes. Aujourd'hui la feuille de styles ci-dessus mélange des cultures facette par facette ; la table `styles` est le chemin de migration vers des styles eux-mêmes assemblés de facettes.

## Contrat d'affichage

`programme.massing[i].volumes[]` peut porter, en plus de ses champs habituels :

| Champ | Sens |
|---|---|
| `base_m` | Bas du volume au-dessus du sol du bâtiment |
| `pans` | Faces de toit explicites `[x,y,z, …]`, déjà découpées contre les autres volumes ; quand le champ est présent, le rendu dessine exactement celles-ci |
| `gables` | Faces de mur au-dessus du haut du mur (pignons) |
| `minor` | Petit volume décoratif : sans ouverture, sans ombre, ignoré en vue d'ensemble |
| `roof_form` | La vraie forme du toit ; `roof` reste une forme que tout moteur de rendu connaît |

## Tests

`cargo test -p magna-urbis-core --lib urban::forms::` (toits, rôles, kits, plans, feuille de styles), `urban::massing::`, `urban::parcels::`, `urban::activities::`. Web : `tests/v2/cityParity.test.ts`.
