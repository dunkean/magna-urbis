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

`overrides` remplace une règle pour un identifiant de culture ou une famille de monuments (`western`, `orthodox`, `maghreb`, `persian`, `chinese`, `japanese`, `indic`, `antique`, `american`, `african`) : c'est ainsi qu'une culture élève à sa façon une partie partagée. Une clé d'`overrides` peut aussi être un **groupe** que plusieurs cultures partagent : une culture liste ses groupes dans son trait `roleGroups`, lus après ses propres `overrides.<identifiant de culture>` (`roles_modern.json` : `modern-flat`, `terrace-flat`, `concrete-flat`, `mansard`, `green-roof`, `tin-roof`, `informal`, `suburban` pour les maisons ; `art-deco`, `highrise`, `gulf`, `soviet`, `cyberpunk`, `brutalist`, `danji`, `atompunk`, `space-colony`, `biopunk`, `glass-office` pour les tours et les parties particulières).

Fichiers : `roles_core.json` (parties de maison et parties génériques), `roles_monuments_a.json` (classique, médiéval, islamique, civique), `roles_monuments_b.json` (utilitaire, Asie, Amériques, Afrique, fantasy), `roles_rural.json` (fermes, sites d'activité et monuments de campagne), `roles_modern.json` (styles modernes).

## Plans de maisons (`forms/plan.rs`, `forms/styles.json`)

L'occupation ajuste le corps de la maison dans sa parcelle ; la grammaire compose autour de lui, dans la place que laisse la parcelle, un plan tiré du kit : `bar` (barre), `ell` (L), `tee` (T), `court` (deux ailes arrière, U), `cross` (une aile croisée plus haute à un bout), `aitch` (une à chaque bout, H), puis les extras (appentis arrière, porche, avant-corps, tourelle d'escalier dans l'angle rentrant). Les parties sont des rectangles entiers étiquetés `building`, `wing`, `crosswing`, `outshot`, `porch`, `bay`, `turret` ; chacune est ajustée dans la parcelle et abandonnée si elle n'y tient pas.

Un **kit** (`styles.json`, `kits.<id>.house`) porte les poids des plans, l'influence de la place et de la richesse sur les grands plans, les chances des extras, des cheminées et des lucarnes, les formes de toit d'une maison, les débords et le matériau des cheminées. Une culture reçoit son kit par `cultures.<id>.kit`, sinon par la première règle `derive` que ses traits de bâti satisfont (forme de toit, mur, couverture, pente), sinon par `default`. Le code ne teste jamais le nom d'une culture.

## Bâtiments singuliers et utilitaires (`parcels/monuments/`)

Une forme pose des parties étiquetées sur son site avec le mini-langage `Site` de `parcels/landmark.rs` : `rect`, `bar`, `disk`, `apse`, `small`, `poly`, `ellipse`, `wedges` (couronne de gradins), `ring`, `court`. `monuments::build` interroge chaque famille à son tour : `modern`, `metropolis` et `rural` d'abord (elles ne répondent qu'à leurs propres rôles ; `modern` et `metropolis` seulement pour les cultures dont les traits déclarent une `era`), puis les familles culturelles (`classical`, `islamic`, `asian`, `american`, `african`, `fantasy`, `medieval`), puis les formes partagées `civic` et `utility`. Une famille qui décline laisse le site et le flux aléatoire intacts, et les formes plus anciennes de `landmark.rs` s'appliquent alors.

Quels rôles existent, pour quelles cultures et en quel nombre relève du programme : `services.json` (familles, `cultureServices`, `harbour`, comptes) et `roles.rs`. L'option de plan `singularDensity` règle combien un lieu en reçoit.

## Sites de campagne (`activities.json`, `parcels/monuments/rural.rs`)

Les sites d'activité et les monuments de campagne utilisent les mêmes formes que les villes. Un archétype de `activities.json` peut porter `form: {role, site, has, absorbs}` : `role` nomme la forme à bâtir (un rôle de `services.json` comme `worship.parish`, ou un rôle de campagne, `rural.windmill`, `rural.barrow`), `site` le terrain qu'elle demande en mètres (façade, profondeur), `has` une étiquette de partie que la forme de la culture doit contenir (sinon le bâtiment garde son anneau unique), `absorbs` les archétypes de la même cour que la forme contient déjà (un clocher, un cloître). `activities::formed` remplace alors le bâtiment par les parties de cette forme, un bâtiment par partie, sur un terrain que le site accepte ; une forme refusée par le terrain ou que la culture ne bâtit pas laisse la cour telle quelle.

`rural.rs` porte les formes `rural.*` : moulins par type (à eau, à marée, sur pivot, tour, à jupe, à axe vertical), scieries, forges et fonderies, fours (chaux, briques, verre, charbon de bois, goudron), têtes de mine, carrières, salines, stations de pêche, pressoirs, granges dîmières, greniers, pigeonniers, bergeries, tours de guet et de feu, maisons de péage, ermitages, oratoires, croix et puits de chemin, mégalithes, tumulus et tombeaux. Un sous-rôle fixe une variante (`rural.windmill.post`) ; le rôle nu laisse la culture et le site choisir. Leurs parties sont élevées par `roles_rural.json`.

**Fermes de campagne (`landuse/farms.rs`, `landuse/rural_farms.rs`).** Les fermes que l'étape d'occupation du sol sème dans la campagne suivent la culture du lieu habité le plus proche. Leur type est tiré parmi les types de ferme de cette culture (bloc `farmstead` de `catalogue.json`), chaque poids étant multiplié par les règles de site de l'étape (pente, sol humide, exposition, sol, taille de la ferme). Les types classiques gardent leur constructeur propre (`court`, `range`, `hall`, `ring`…) ; tous les autres types sont tracés par `steading` à partir de leur fiche du catalogue : la maison à la taille du type, ses bâtiments obligatoires (`core`) et un tirage de ses bâtiments optionnels (`ancillary`, plus nombreux sur une grande ferme), aux emprises du catalogue et à l'échelle des corps de la culture, disposés selon le `layout` du type : cour (`closed`, `u`, `l`), rangée (`linear`, `terraced`), enclos rond (`round`) ou dispersion (`scattered`). Chaque bâtiment d'une ferme placée porte ensuite `parts[i].massing` : une pièce du contrat d'affichage des bâtiments de ville, élevée par `activities::countryside_farm_massing` avec le code des fermes des lieux habités (tradition constructive de la culture, toits composés pour la maison, dépendances en volumes bas du type de ferme). Les champs que la ferme émettait déjà (`use`, `arch`, `roof`, `material`, `type`, `culture`) restent inchangés.

## Lieux reculés (`remote` de `activities.json`, `settlements/remote.rs`)

Des lieux uniques et rares dont la situation fait tout l'intérêt : un temple sur un sommet, un monastère sur une vire de falaise, un sanctuaire taillé au pied d'une paroi, une tour sur un piton, un ermitage sur un îlot rocheux, un tombeau dans une gorge, des ruines perdues au fond d'une forêt ou sur une île de marais. Ce sont des sites d'activité comme les autres (mêmes gabarits, cours, formes et test du terrain), placés par le relief et non par une ancre de ressource. Un gabarit de `activities.json` est un lieu reculé quand il porte `remote: {situations, access, ruined, weight}` ; le bloc `remote` du fichier contient les deux vocabulaires et la rareté.

**Les situations** sont des tests peu coûteux sur la grille de planification : les hauteurs autour du point dans huit directions sur un anneau proche (1,5 cellule, 60 m au moins) et un anneau lointain (3 cellules, 180 m au moins), le masque d'eau et deux potentiels de ressources. Les seuils sont des données (`remote.situations.<id>`).

| Situation | Le point s'y trouve quand |
|---|---|
| `summit` | tout est plus bas sur les deux anneaux, de `drop` mètres en moyenne sur l'anneau lointain, sans eau à cette distance |
| `crag` | un sommet dont l'anneau proche tombe à `grade` ou plus dans `sides` directions sur huit |
| `cliff-ledge` | dans une direction le sol tombe à `grade` sur l'anneau proche et de `drop` mètres sur l'anneau lointain (une vire ou un rebord de falaise ; plus spectaculaire quand le rocher monte derrière) |
| `cliff-foot` | dans une direction le sol monte à `grade` et de `rise` mètres, le côté opposé restant sous `ease` |
| `gorge` | le sol monte de `rise` mètres sur deux côtés opposés et se prolonge entre eux (plus spectaculaire avec une rivière) |
| `islet` | de l'eau libre (mer ou lac) se trouve à moins de `reach` mètres dans `sides` directions sur huit ; `stack` mètres au-dessus de l'eau font un vrai piton marin |
| `marsh-island` | un sol plat (`ease`) à `above_water` mètres au plus au-dessus de son eau, dans la tourbe (potentiel `peat`) ou avec de l'eau dans `sides` directions |
| `deep-forest` | le potentiel `wood` tient ici et à 500 m tout autour, sur un sol sous `ease`, à `far` mètres au moins de tout lieu habité |

**Les accès** (`remote.accesses.<id>`) : chaque gabarit liste les types qu'il peut avoir avec un poids ; ils sont essayés dans un ordre aléatoire pondéré et le premier que le terrain permet est retenu.

| Accès | `line` | Ce que c'est |
|---|---|---|
| `none` | `none` | Aucun chemin : `accessClass` vaut `none`, le site n'est pas une extrémité de route et aucun itinéraire n'est cherché |
| `track` | `path` | Le sentier ordinaire du site, jusqu'à sa porte |
| `cliff-stair` | `fall` | Des marches taillées droit dans la ligne de plus grande pente, jusqu'à une pente (`grade`) de 1,2, sur `reach` mètres au plus |
| `rock-steps` | `fall` | La même chose sur un rocher moins raide (`grade` 0,7) : les marches partent en traversée là où la ligne de pente est trop raide |
| `tunnel` | `bore` | Une galerie dans le rocher, du lieu au premier sol facile en contrebas |
| `causeway` | `span` | Une ligne à travers l'eau jusqu'à l'autre rive la plus proche, à moins de `reach` |
| `rope-bridge` | `span` | La même chose au-dessus d'un vide plus court |

Une ligne `fall` part du devant de la cour et prend, pas à pas, la descente la plus raide qu'un escalier peut suivre (la ligne de pente, sinon une traversée à côté), jusqu'à ce que la pente passe sous `path_grade` ou qu'elle rencontre l'eau ; elle peut dépasser toute pente de route mais jamais son propre `grade`. La ligne est une installation ouverte du site (`cliff_stair`, `rock_steps`, `rock_tunnel`, `tidal_causeway`, `rope_bridge` ; types de sol `engineered_path`, `underground_work`, `crossing`), et `access` en est l'autre bout : le sentier ordinaire du site n'est tracé que jusqu'à ce point. Le site porte aussi `situation` et `approach` (le type d'accès), et `kind: "remote"`.

**Ce qui s'y dresse** relève du gabarit, dans les formes de la culture :

| Gabarit | Situations | Bâtiment | Accès |
|---|---|---|---|
| `summit_sanctuary` | summit, crag | `rural.summit-temple` : le sanctuaire sur sa plateforme à gradins dans un mur de terrasse, l'escalier dans l'axe ; une chapelle et son abside dans l'Occident et l'Orient chrétiens | marches dans le roc, escalier de falaise, aucun, sentier |
| `cliff_monastery_site` | cliff-ledge | `rural.cliff-monastery` : la salle contre le rocher, une aile de chaque côté, une rangée basse de cellules et la tour-porte au bord du vide, des marches entre les niveaux | escalier de falaise, aucun, tunnel, pont de corde |
| `rock_sanctuary` | cliff-foot, gorge | `rural.rock-sanctuary` : la façade taillée contre le rocher, son porche et deux colosses | aucun, sentier, marches dans le roc |
| `crag_tower` | crag, summit, cliff-ledge | la tour de guet (`rural.watchtower`) | escalier de falaise, marches dans le roc, aucun |
| `stack_hermitage` | islet, cliff-ledge, crag, marsh-island | l'ermitage (`rural.hermitage`) | aucun, chaussée, pont de corde, escalier de falaise |
| `lost_ruins` | deep-forest, marsh-island, gorge, islet | le temple ou la chapelle rurale de la culture, toujours en ruine | aucun, sentier, chaussée |
| `gorge_tomb` | gorge, cliff-foot, islet | le tombeau de la culture (`rural.tomb`) | aucun, marches dans le roc, sentier |
| `forgotten_stones` | deep-forest, marsh-island, summit | des mégalithes, un cairn pour les cultures qui n'en ont pas | aucun, sentier |

`ruined` est la part d'un gabarit trouvée en ruine : `activities::ruined` change chaque bâtiment en murs brisés sur sa propre emprise (`parcels/ruins.rs`). Les cultures pondèrent les gabarits par le poids `prefer` de leur bâtiment requis (`cultures.families` et `overrides` : monastères de falaise pour les cultures tibétaine, himalayenne, byzantine, éthiopienne et caucasienne, sanctuaires rupestres pour les cultures antiques, éthiopienne et naine, temples de sommet en Asie orientale, en Inde et aux Amériques) ; le code ne teste jamais le nom d'une culture.

**Rareté.** Une région reçoit `rate` × √(terres / 100 km²) × fréquence lieux (1,2 pour 100 km², 4,8 pour 1 600 km² à la fréquence 1 ; la fraction est tirée de la graine, `most` plafonne le total). Les candidats viennent d'une grille décalée de 48 × 48 sondes au plus, chacune affinée sur le haut de son relief et huit points autour, et des cellules de rivage des îles lues avec un pas (256 × 256 tests au plus, un îlot étant plus petit qu'une cellule de sonde) ; le score est le poids de la situation multiplié par son caractère spectaculaire. Les lieux se tiennent à `clear` mètres de tout lieu habité, à `spacing` les uns des autres et à `site_gap` des autres sites de campagne : une région sans relief marqué n'en reçoit aucun. L'option de placement `remotePlaces` (`settlements::Config.remote_places` ; « Fréquence des lieux reculés », à côté de la densité des fermes dispersées dans les réglages régionaux) est la fréquence : 0 n'en donne aucun, 1 est la valeur par défaut, 10 le maximum.

**Terrain.** Une cour est posée sur le candidat, puis sur deux anneaux de huit emplacements autour de lui, tous ses coins au sec. Chaque corps passe `ground_fits` ; une forme prend tout son `site`, puis un site plus serré, sinon le corps unique reste. Un candidat qui ne porte aucun bâtiment requis est abandonné.

## Ajouter quelque chose

| Pour ajouter | Faire |
|---|---|
| Les maisons d'un style | Un kit dans `styles.json` (ou en réutiliser un), et `cultures.<id>.kit` si les règles `derive` ne le choisissent pas |
| La façon dont une culture élève une partie | Une entrée sous `overrides.<culture ou famille>` dans un `roles_*.json` |
| Une nouvelle partie de bâtiment | Une étiquette dans une forme et sa règle dans un `roles_*.json` |
| Un monument ou un bâtiment utilitaire | Une forme dans le fichier de famille de `parcels/monuments/`, le rôle dans `services.json` |
| Un site ou un monument de campagne | Une forme `rural.*` dans `parcels/monuments/rural.rs`, les règles de ses parties dans `roles_rural.json`, `form: {role, site}` sur l'archétype dans `activities.json` |
| Un lieu reculé | Un gabarit dans `sites` de `activities.json` avec `remote: {situations, access, ruined, weight}` et sans `context`, son identifiant dans `ACTIVITY_TEMPLATES` de `rust/bridge/urbanConfig.ts` ; un poids `prefer` sur son bâtiment requis pour les cultures qui y sont portées |
| Une situation | Ses seuils sous `remote.situations` et son prédicat dans `situations` de `settlements/remote.rs` |
| Un accès | Une entrée sous `remote.accesses` avec l'une des lignes `none`, `path`, `fall`, `span`, `bore` et son archétype d'installation ; un nouveau type de ligne est une branche de `approach` dans `settlements/remote.rs` |
| Un style moderne | Une culture dans `styles_modern.json` (kit, traits avec `era` et `roleGroups`), son tissu et ses cinq préréglages dans `catalogue.json`, sa ligne dans `MAPPINGS` de `culture.rs`, sa famille de services (`cultures`) et ses bâtiments propres (`cultureServices`) dans `services.json`, ses groupes dans `enclosures.json` et `activities.json` ; les nouvelles formes dans `parcels/monuments/modern.rs` ou `metropolis.rs` et leurs règles dans `roles_modern.json` ; côté web : son libellé anglais dans `gen/options.ts`, son libellé français dans `v2/interfaceMessages.ts`, ses toponymes dans `gen/names/profiles.ts`, `v2/cityCodeDefaults.json`, et sa zone climatique dans le `run.mjs` des planches v7 |
| Un plan de maison | Une branche dans `compose` de `plan.rs` et son poids dans les kits |
| Une forme de toit | Ses plans dans `roof.rs` |

## Traits de culture

Ce qui distingue les bâtiments d'une culture sans figurer dans son tissu vit dans `cultures.<id>.traits` de `styles.json` (`styles_modern.json` pour les styles modernes) : la tradition de toit d'une culture dont le tissu ne déclare pas d'`arch` (`tradition`), le bâti méditerranéen (`mediterranean`), la famille de détails des toits plats (`flavor`), la taille des habitants (`bodyScale`), l'échelle de la maison entière (`metricScale`), la forme extérieure des maisons (`form` : tree, mushroom, longhouse, yurt, battered, mage, stilt) et la part des lots qui la prennent (`formShare`), un seul étage massif (`massiveStorey`), les maisons sur pilotis (`piles`), l'ouverture des façades (`openness`, `lightWallOpenness`), l'ère d'un style moderne (`era` : `modern`, `futuristic`, `alien` ; vide pour les cultures historiques et de fantasy), les groupes de surcharges qu'il partage (`roleGroups`) et sa palette de murs (`palette`). `massing.rs` lit ces traits et jamais le nom d'une culture. Le web lit `era` par `cultureEra(culture)` de `gen/options.ts`, qui importe `styles_modern.json`.

## Styles modernes, futuristes et extraterrestres

Les 36 styles de `docs/Modern_cities_review.md` sont des cultures de `styles_modern.json` ; chacun a son tissu (cinq préréglages : cœur, extension, faubourg, village, hameau) dans `catalogue.json`. Les styles d'une même tradition de bâti partagent un kit, une famille de services et des groupes de surcharges ; leurs différences sont des paramètres de tissu et des traits.

| Ère | Styles |
|---|---|
| `modern` | `american-grid`, `industrial-victorian`, `haussmannian`, `belle-epoque`, `mediterranean-modern`, `garden-city`, `art-deco-metropolis`, `modernist-functionalist`, `soviet-socialist`, `american-suburbia`, `european-contemporary`, `global-high-rise`, `gulf-contemporary`, `informal-urban-expansion`, `eco-city`, `japanese-contemporary`, `chinese-megacity`, `korean-high-rise`, `southeast-asian-tropical`, `south-asian-metropolis`, `latin-american-grid`, `latin-american-hillside`, `north-african-contemporary`, `sub-saharan-african-metropolis`, `middle-eastern-contemporary`, `australian-suburban`, `post-socialist-european` |
| `futuristic` | `cyberpunk`, `solarpunk`, `dieselpunk`, `dystopian-brutalism`, `atompunk-retrofuturist`, `post-apocalyptic-ruins`, `corporate-arcology`, `futuristic-space-colony` |
| `alien` | `biopunk-organic-city` |

| Kit | Maisons |
|---|---|
| `brick-rowhouse` | Maisons en rangée et immeubles sans ascenseur en brique (damier, victorien, Art déco, dieselpunk) |
| `masonry-apartment` | Immeubles d'habitation en pierre et en enduit (haussmannien, Belle Époque, méditerranéen, damier latino-américain, Afrique du Nord, Moyen-Orient, post-socialiste) |
| `suburban-house` | Maisons isolées et jumelées à porche (cité-jardin, banlieue, Australie, atompunk) |
| `concrete-slab` | Barres et tours (moderniste, soviétique, tours mondiales, Golfe, Chine, Corée, cyberpunk, brutaliste, arcologie) |
| `eco-block`, `compact-mixed`, `informal-block`, `pod-habitat`, `organic-pod` | Îlots en bois, petites parcelles mixtes, maisons autoconstruites, modules d'habitat, cosses cultivées |

Familles de services : `industrial` (XIXe et début du XXe siècle : usines, gares, grands magasins), `modernist` (barres, tours, stade, centrale, tour de télévision, monument), `contemporary` (centres commerciaux, bureaux, tours, stade ; lieux de culte par culture), `informal` (marchés ouverts, ateliers, écoles), `futuristic` (tours, centres commerciaux, centrales ; arcologies, mégastructures, dômes et fermes verticales par culture), `alien` (ruche, flèches organiques). Les bâtiments propres d'une culture, et les bâtiments de sa famille qu'elle n'a pas (une entrée avec `maxPop: 1`), sont dans `cultureServices`. `post-apocalyptic-ruins` est la famille informelle avec un `ruinShare` à toutes les tailles.

Les formes de `metropolis.rs` : `housing.slab` (barres de part et d'autre d'une pelouse), `housing.tower` (tours ponctuelles, certaines sur un socle), `commerce.mall`, `civic.stadium`, `civic.power-plant` (et `.atomic` : dôme de réacteur), `civic.tv-tower` (tour de télévision, ou mât d'amarrage de dirigeables dans la famille industrielle), `civic.arcology`, `civic.megastructure`, `civic.habitat-dome` (et `.ward`), `civic.vertical-farm`, `civic.monument`, `civic.hive`, `civic.organic-spire`. Le gratte-ciel de `modern.rs` prend le couronnement de chaque tradition par les groupes : flèche Art déco, fût de verre, aiguille du Golfe, tour stalinienne, dôme atompunk.

### Matériaux et teintes des murs

Les styles modernes bâtissent dans leurs propres matériaux. Murs : `concrete` (béton : panneaux, barres, tours, centres commerciaux, centrales), `glass` (verre : fûts des gratte-ciel et bureaux, tours du Golfe et cyberpunk, arcologies), `steel` (acier : modules d'habitat) et `ashlar` (pierre de taille calcaire : immeubles haussmanniens et Belle Époque, tours staliniennes et Art déco, bâtiments publics Beaux-Arts, pierre levantine), en plus de la brique, de l'enduit, du bois et de la pierre. Couvertures : `zinc` (mansardes haussmanniennes, croupes en pierre de taille), `bitumen` (bitume : toits plats des styles du nord et des tours), `glass` (verrières : atriums, halles de gare, serres, dômes d'habitat) ; les styles des climats chauds gardent des terrasses enduites claires (groupe `terrace-flat`). Le `arch.material` d'un tissu les nomme (`concrete`, `ashlar`, `glass`, `steel`) ; les règles de masse de `roles_modern.json` et le `traits.tradition` de la culture font le reste.

Chaque style moderne a une palette dans `styles_modern.json` : `palettes.<id> = {homes, special}`, deux listes pondérées de teintes sRGB (`"#d8c8a8": 3`), et `traits.palette` la nomme. `massing.rs` tire une teinte par bâtiment avec sa propre graine : la liste `special` pour un monument, un lot qui n'est pas un logement (équipements, commerce, barres et tours, industrie) ou un logement de neuf étages ou plus, la liste `homes` sinon, si bien que les maisons ordinaires varient moins que les bâtiments singuliers. Les immeubles haussmanniens restent dans une gamme étroite de calcaires chauds ; les styles du béton se lisent gris avec quelques pastels passés ; les tours des styles contemporains et futuristes varient entre verre bleu, vert, bronze et sombre, bardages blancs et quelques accents vifs. Un style sans palette (toutes les cultures historiques et de fantasy) n'émet pas de teinte.

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

## Hauteur selon la population (styles modernes)

Un style moderne, futuriste ou extraterrestre nomme une échelle de hauteurs (`traits.heightLadder` dans `forms/styles_modern.json`, paliers dans `ladders.<id>` sous la forme `[population, étages]`). L'échelle plafonne les étages des bâtiments ordinaires du style selon la population du lieu, dans le volume affiché comme dans la capacité en ménages du programme : avec `metropolis`, un lieu de 10 000 habitants bâtit de deux à quatre étages, les tours viennent vers 50 000 (12 étages) et les plus hautes dans les centaines de milliers ; `midrise` reste entre six et dix étages. Un tissu plafonné garde son bas de fourchette à 60 % du plafond, si bien qu'un tissu de tours devient des immeubles bas, pas des moignons. Un quartier que l'utilisateur déclare cœur de ville (retouche de quartier `zone: "core"`) prend le palier le plus haut de l'échelle, quelle que soit la population. Les bâtiments singuliers hauts (`housing.tower`, `housing.slab`, immeubles de bureaux, gratte-ciel, mégastructures, arcologies, tours de télévision) viennent selon la population par leur `minPop` dans `services.json`. Un nouveau style indique son échelle (une existante ou la sienne) ; un style sans échelle garde la fourchette d'étages de son tissu.

## Contrat d'affichage

`programme.massing[i].volumes[]` peut porter, en plus de ses champs habituels :

| Champ | Sens |
|---|---|
| `base_m` | Bas du volume au-dessus du sol du bâtiment |
| `pans` | Faces de toit explicites `[x,y,z, …]`, déjà découpées contre les autres volumes ; quand le champ est présent, le rendu dessine exactement celles-ci |
| `gables` | Faces de mur au-dessus du haut du mur (pignons) |
| `minor` | Petit volume décoratif : sans ouverture, sans ombre, ignoré en vue d'ensemble |
| `roof_form` | La vraie forme du toit ; `roof` reste une forme que tout moteur de rendu connaît |

L'entrée de pièce `programme.massing[i]` d'un style doté d'une palette porte aussi `tint` : la couleur de mur que demande le bâtiment, sRGB `#rrggbb` (absente : la couleur propre du matériau du mur). Le `tint` propre d'un volume, s'il existe, l'emporte sur celui de la pièce.

## Tests

`cargo test -p magna-urbis-core --lib urban::forms::` (toits, rôles, kits, plans, feuille de styles), `urban::massing::`, `urban::parcels::`, `urban::activities::`, `settlements::remote::` (lieux reculés). Web : `tests/v2/cityParity.test.ts`.
