# Variables de variation des settlements : inventaire, effets et critique

État lu dans le dépôt le 23 octobre 2026. Document d'analyse ; aucun comportement du générateur n'est modifié. Les annexes de catalogue sont extraites des données présentes, sans exécuter de génération.

Lecture : [réponses aux trois questions](#1-réponses-aux-trois-questions), [matrice et effets](#2-matrice-des-principaux-axes-énumérables), [sélecteurs complémentaires](#3-autres-sélecteurs-urbains--inventaire-sans-les-masquer-dans--etc-), [terrain et réseau régional](#4-terrain-eau-routes-et-ensemble-régional), [critique et combinaisons](#6-critique-générale-et-modèle-de-combinaisons-proposé), [79 cultures](#7-catalogue-culturel-complet-et-variations-selon-léchelle), [presets et rôles](#8-préréglages-et-rôles--domaines-dépendants-complets).

## 1. Réponses aux trois questions

### 1.1 Que fait la « vocation » ?

`programme.role` est un biais du programme fonctionnel : il change ce que le moteur demande et réserve dans les îlots/parcelles. Ce n'est pas une classification complète des villes, ni une simulation de leur économie. Le catalogue culturel de services apporte déjà beaucoup plus de rôles de bâtiments que les six vocations urbaines proposées.

| Valeur | Effet effectivement lu dans le code |
|---|---|
| `auto` | À moins de 500 habitants, ou pour le profil fonctionnel `communal`, le programme choisit `agricultural`. Sinon il conserve le programme culturel sans spécialisation explicite. |
| `agricultural` | Demande d'espaces communs portée à 2 m²/hab. contre 0,5 hors profil communal ; double les sites de stockage du catalogue, sous ses règles et plafonds. |
| `crossroads` | Part des ménages en habitat/boutique portée à 25 % contre 8 % ordinairement, sauf sous 150 habitants où elle est nulle ; double certains établissements commerciaux ; triple le coefficient surfacique des marchés concernés. |
| `artisan` | Ajoute une demande d'ateliers de 3,5 m²/hab. avec minimum de 80 m² et double les sites de métiers du catalogue. |
| `riverine` | Double les sites de moulins du catalogue. Ce choix ne crée pas une rivière. |
| `port` | Part d'habitat/boutique à 25 % ; demande d'entrepôts de 2 m²/hab., minimum 180 m². Cette demande générique exige ensuite une preuve d'accès navigable et un emplacement riverain ; la valeur ne fabrique pas cet accès. Les services et aménagements de rive ont aussi leur propre logique. |
| `capital` | Part d'habitat/boutique à 25 % ; seuils de population des services d'élite, civiques et défensifs divisés par quatre. Ce n'est pas une administration ou une économie simulée. |
| `isolated-farm` | Intention d'une structure domestique isolée ; remplace les demandes de ville. |
| `roadside-temple` | Un temple de bord de route, rôle `worship.wayside`. |
| `isolated-shrine` | Un sanctuaire isolé, rôle `worship.shrine`. |
| `isolated-mill` | Un moulin isolé, rôle `craft.mill`. |
| `isolated-inn` | Une auberge isolée, rôle `commerce.inn`. |
| `isolated-tower` | Une tour isolée, rôle `defence.tower`. |

Pour les intentions isolées, la population n'est plus une demande de logement de toute une ville : elle sert notamment au dimensionnement du programme. Le type macro devient bâtiment isolé ou ferme ; l'état `ruined` peut donner une ruine isolée.

**Critique :** le champ mélange une activité économique (artisanat), une fonction politique (capitale), une situation géographique (fluvial), une fonction de réseau (carrefour), et une intention de bâtiment unique. Ces concepts ne sont ni exclusifs ni au même niveau. Une capitale peut aussi être portuaire, artisanale et religieuse. Ajouter vingt valeurs exclusives conserverait ce défaut.

**Proposition à discuter :** séparer l'intention d'implantation (settlement ou établissement isolé), les fonctions dominantes combinables, les activités/ressources et les fonctions politiques/religieuses. Les poids devraient produire des besoins, des implantations et des signes visuels vérifiables, plutôt qu'un simple nom de catégorie. Exemples aujourd'hui peu ou pas exprimables comme vocations distinctes : extraction/mines, pêche, pèlerinage, monastère, garnison, passage caravanier, transit fluvial, élevage, résidence royale, chantier naval. Ce sont des pistes de modèle, pas des fonctionnalités annoncées comme existantes.

### 1.2 Le classement hameau / village / ville / métropole existe-t-il encore ?

**Oui, mais plusieurs classifications coexistent.** Ma réponse précédente donnait des populations de raccourcis comme si elles définissaient les classes ; ce sont deux choses différentes.

| Couche | Valeurs et seuils actuels | Effet |
|---|---|---|
| Classe démographique affichée, TS et placement Rust | `farmstead` < 15 ; `hamlet` 15–149 ; `village` 150–999 ; `town` 1 000–19 999 ; `city` 20 000–99 999 ; `metropolis` 100 000–999 999 ; `megacity` ≥ 1 000 000 | Classement de la population et raccourcis de sélection. Ce n'est pas à lui seul le choix de forme native. |
| Raccourcis de population de l'interface | Ferme 10 ; hameau 40 ; village 300 ; bourg 3 000 ; ville 30 000 ; métropole 250 000 ; mégapole 1 500 000 | Remplissent une population ; ne définissent pas les seuils. |
| Ancien `SizeName` | `hamlet`, `village`, `town`, `city`, `capital` ; `sizeForPop` bascule à 200, 1 200, 8 000 et 30 000 | Anciens préréglages de superficie et réglages de certaines étapes ; `capital` est ici un nom de taille, pas la vocation politique. |
| Ancienne échelle culturelle `ScaleClass` | `hamlet` < 200 ; `village` < 1 200 ; `town` < 20 000 ; `city` < 100 000 ; `metropolis` < 1 000 000 ; `megacity` au-delà | Métadonnées historiques TS `scale.min/max`, indépendantes de la nouvelle grammaire native. |
| Type morphologique natif `Kind` | 11 types détaillés ci-dessous ; métropole à partir de 200 000 en résolution automatique | Choisit une grammaire de plan : un site unique, fermes sur chemin, village-rue, quartiers, phases ou plusieurs centres. |

Résolution automatique native, après prise en compte des valeurs explicites :

| Condition | Type obtenu et comportement |
|---|---|
| `settlementForm` nomme directement l'un des 11 types | Ce choix prend priorité sur les déductions suivantes. |
| Intention isolée | `single`, `farmstead`, ou `ruin` selon l'intention et l'état. |
| `nomad-camp` ou `native-plains`, population < 5 000 | `camp`. Cette règle n'inclut pas automatiquement tous les autres presets évoquant des camps. |
| Population ≤ 12 | `farmstead`, ou `ruin` si l'état l'exige. |
| 13–149 | `hamlet`. |
| 150–1 199 | `street-village` ou `nucleated-village` : dépend du choix explicite `ribbon/nucleated`, de la culture, du site et de la route proche. |
| 1 200–4 999 | `market-town`, ou `walled-town` si la culture fortifie et que la population atteint 2 500 ou que le site est défensif. |
| 5 000–29 999 | `walled-town` si fortifié ; sinon `city`. |
| 30 000–199 999 | `city`. |
| ≥ 200 000 | `metropolis`. |

Les différences de formes existent donc toujours : les petits types contournent la grammaire des quartiers ; une ferme est une parcelle avec accès, un hameau suit un chemin, un village-rue crée des bandes riveraines. Les petites implantations ont normalement une phase, sans faubourgs ni périphérique ; le petit bourg peut avoir deux phases ; la métropole favorise quatre phases et de nombreux faubourgs. La composition métropolitaine ajoute plusieurs centres et rattache des quartiers à ces centres. Le catalogue distingue aussi les formes culturelles des hameaux/villages et, pour certaines cultures, une recette de ville au-delà d'un seuil.

**Critique :** la différence morphologique n'a pas disparu, mais les noms et seuils ne sont pas alignés. À 100 000 habitants, la classe démographique dit « métropole » et le type natif dit encore « cité ». À 13–14 habitants, la classe dit ferme mais le type automatique dit hameau. Le type n'a pas de catégorie native séparée `megacity` : les très grandes villes prolongent `metropolis`. Il faut une population canonique, des étiquettes cohérentes et un type morphologique effectivement résolu et visible.

### 1.3 Existe-t-il des limites de taille selon les cultures ?

Il faut distinguer trois mécanismes :

1. **Ancienne infrastructure TS :** `Culture.scale.min/max` existe encore. `pipeline.mainPopulation` et le chemin urbain historique peuvent borner la population à `scaleMaxPop(max) × 1,5`, avec aussi une borne basse. Cela peut donc changer la population demandée. Les déclarations `scale` explicites relevées dans les fichiers `cultures*.ts` actuels ont toutes `max: 'megacity'` : ce mécanisme ne fournit pas aujourd'hui un tableau de plafonds réalistes différenciés. Certaines branches de camp et de croissance suivent en outre leur propre chemin.
2. **CityBench natif :** le catalogue exporté ne fournit pas de champ de plage démographique culturelle appliquée comme plafond. `scope` est un texte signalant des recettes artistiques, pas une contrainte calculée. Le type natif accepte les cultures au-delà des seuils génériques ; `maori-pa` n'a pas de maximum démographique propre dans cette chaîne.
3. **Limite de la carte :** CityBench lit `decor.meta.tags.maxPopulation` pour limiter les choix de l'éditeur. C'est une capacité déclarée de la carte, commune aux cultures ; elle ne prouve ni capacité bâtie réelle ni plausibilité historique. L'ancien éditeur a également sa limite globale de population de 5 millions.

**Réponse au cas des deux millions d'habitants en `maori-pa` :** le programme ne dispose pas du contrôle culturel nécessaire pour déclarer ce cas historiquement étayé, extrapolé ou interdit. La recette locale de pā est susceptible d'être utilisée à une échelle métropolitaine. Ce n'est pas une preuve de cohérence, même si la génération aboutit techniquement.

Le mode `strict` refuse notamment des emprunts architecturaux déclarés ; la période peut filtrer les recettes natives admissibles. **Ces contrôles ne constituent pas un validateur historique général culture × époque × taille.** Les modes `inspired` et `fantasy` ne doivent pas être présentés comme des simulations historiques complètes non plus.

**Proposition à discuter :** distinguer une plage documentée, une plage d'extrapolation assumée et la capacité calculée sur le site. Au-delà de la plage documentée : refus motivé en mode strict si le profil ne couvre pas le cas ; transformation explicitée ou réseau de settlements en mode inspiré ; extrapolation autorisée en fantasy en conservant des règles constructives. Aucun chiffre de plafond culturel ne doit être inventé sans source ni confondu avec une limite technique.

## 2. Matrice des principaux axes énumérables

Une ligne de scénario choisit une valeur par colonne applicable. Ces tableaux sont des dictionnaires de colonnes, pas une autorisation de multiplier tous les domaines sans vérifier leurs dépendances. Les valeurs automatiques ne garantissent pas un résultat distinct d'une valeur explicite.

| Culture | Classe démographique | Type morphologique | Maillage explicite | Forme d'emprise explicite |
|---|---|---|---|---|
| 79 IDs, annexe 7 | `farmstead`, `hamlet`, `village`, `town`, `city`, `metropolis`, `megacity` | `single`, `ruin`, `farmstead`, `camp`, `hamlet`, `street-village`, `nucleated-village`, `market-town`, `walled-town`, `city`, `metropolis` | `grid`, `organic`, `radial`, `terraces`, `dendritic`, `clusters` ; défaut `culture` | `circle`, `rectangle`, `polygon`, `compact`, `elongated`, `linear`, `fan`, `fingers`, `dendritic`, `lobed`, `archipelago`, `composite` ; défaut `auto` |

| Biome | Climat du terrain | Relief | Archétype de site |
|---|---|---|---|
| `temperate`, `forest`, `desert`, `steppe`, `tropical`, `tundra`, `underdark`, `underdark-caverns` | `temperate`, `oceanic`, `mediterranean`, `arid`, `cold`, `tropical` | `flat`, `hills`, `valley`, `canyon`, `mountains`, `mixed`, `plateau`, `high-mountains`, `volcano`, `caldera`, `cavern` | `bridge`, `confluence`, `meander`, `harbor`, `estuary`, `valley`, `hilltop`, `plain`, `lakeshore`, `island`, `spur`, `pass` ; sélection `auto` possible |

| Vocation | État | Enceinte demandée | Faubourgs | Mélange culturel | Cadre du programme |
|---|---|---|---|---|---|
| `auto`, `agricultural`, `crossroads`, `artisan`, `riverine`, `port`, `capital`, `isolated-farm`, `roadside-temple`, `isolated-shrine`, `isolated-mill`, `isolated-inn`, `isolated-tower` | `thriving`, `declining`, `abandoned`, `ruined` | `culture`, `none`, `wall`, `palisade` | `auto`, `none`, `few`, `many` | Aucun ; deuxième culture parmi les mêmes 79 IDs ; répartition `phases` ou `sectors` | `strict`, `inspired`, `fantasy` |

Effets des axes :

| Axe | Ce qui change | Limite / critique |
|---|---|---|
| Culture | Recettes de cœur, extensions, village et hameau ; noyau, enceinte, orientations, espaces, services, ménage culturel et routage vers les recettes architecturales. | Le catalogue mêle traditions, plans de référence, organisations sociales et thèmes fantasy. 79 entrées ne signifient pas 79 moteurs entièrement distincts ni une couverture égale. |
| Population / classe | Besoins en logements et services, emprise, phases, nombre de centres et largeur/hiérarchie de réseaux selon les étapes. | Une classe est dérivée de la population. Demande, capacité foncière et habitants réellement logés doivent rester trois mesures distinctes. |
| Type morphologique | Choix entre grammaires de site unique, petites implantations et composition de quartiers. | Le forçage peut court-circuiter les protections par échelle. Le type résolu doit être enregistré avec la raison de son choix. |
| Maillage | `grid` force l'opérateur grille ; `organic` renforce la variation ; `radial` guide le squelette ; `terraces` suit le relief ; `dendritic` favorise les impasses ; `clusters` favorise les closes/groupements. | Les six choix ne correspondent pas à six opérateurs locaux indépendants : plusieurs passent par l'opérateur organique. Une surcharge peut gommer des traits culturels. |
| Emprise | Silhouette territoriale, continuité, allongement, ramifications ou pluralité des composantes. | Ce n'est pas la forme d'une maison. La famille oriente une construction contrainte par le terrain ; elle n'impose pas nécessairement une silhouette géométrique exacte. |
| Biome | Couverture du sol, végétation et agriculture dans la chaîne qui le consomme ; contexte visuel souterrain. | Le module biome précise que la géométrie urbaine en est indépendante. La carte fixe chargée dans CityBench doit déjà porter ce contexte. |
| Climat | Conditions amont du terrain/climat et budget d'eau selon le générateur de terrain utilisé. | Pas six grammaires de ville ; ce champ ne recrée pas le décor lors d'un simple recalcul urbain. |
| Relief | Pentes, place réellement accessible, orientation, terrasses/escaliers et admissibilité des bâtiments. | Dépend d'un raster réel, pas seulement de son étiquette. `valley` est aussi un archétype de site : ce sont deux champs différents. |
| Site | Rapports à l'eau, aux routes, à la défense et à la pente ; influe sur le choix village-rue/groupé, les quartiers et équipements possibles. | Choisir « port » ne suffit pas à prouver un accès navigable, des quais construits ou des entrepôts admis. |
| Vocation | Besoins et pondérations fonctionnelles détaillés en 1.1. | Taxonomie plate et trop courte ; nombreuses combinaisons fonctionnelles impossibles à exprimer directement. |
| État | Part de bâtiments vides (déclin : défaut 20 %, abandon/ruine : 100 %), rôles et ménages ; dans la chaîne native, rues de l'abandon/ruine requalifiées en chemins. | Un rôle `.ruin` ne garantit pas à lui seul un modèle architectural détruit ou une végétalisation détaillée. |
| Enceinte | Absence, palissade ou muraille et choix culturel de fortification. | Type de settlement, tracé, portes, voies et bâtiments doivent rester compatibles ; tous les styles ne sont pas interchangeables. |
| Faubourgs | Présence et intensité des extensions périphériques. | Récoupe les phases, satellites et forme générale ; un produit cartésien brut produit des doublons ou des demandes contradictoires. |
| Mélange | Autre culture dans des phases ou des secteurs. | Ce n'est pas une fusion illimitée de toutes les architectures. Deux cultures, leur ordre et leur territoire doivent être enregistrés. |
| Cadre historique | Contrôles d'emprunt et d'admission du programme ; routage vers des modes architecturaux distincts. | Pas de plage historique de population validée automatiquement. |

## 3. Autres sélecteurs urbains : inventaire sans les masquer dans « etc. »

Ils font varier la scène ou le chemin de génération, mais ne sont pas tous des axes de scénario à multiplier.

| Champ | Domaine | Effet et statut |
|---|---|---|
| Style d'agglomération UI | `culture`, `walled-core`, `dense-core`, `growing-town`, `village` | Macro-préréglages remplaçant plusieurs réglages de plan/parcelles. Axe composite, donc redondant avec ses réglages. |
| `composition` | `settlement`, `district` | Composition complète ou quartier isolé. Ne pas confondre un échantillon de tissu avec une ville. |
| `settlementForm` | `auto`, `nucleated`, `ribbon`, puis les 11 `Kind` | Demande de forme ; `nucleated/ribbon` orientent le village alors qu'un ID de type force le type. |
| `footprint.mechanism` | `auto`, `legacy`, `planned`, `accessibility`, `ribbon`, `fusion` | Algorithme de fabrication de l'emprise. `legacy` conserve des comportements anciens. Le normaliseur web remplace un `planned` sauvegardé par `auto` ; le natif possède aussi sa résolution et force `planned` pour une famille rectangle. Ne pas compter les six comme six modes également accessibles et indépendants. |
| `footprint.budget` | `population`, `radius` | Déduit le foncier d'une population ou d'un rayon. Ce n'est pas une validation de capacité bâtie. |
| `axisAlignment` | `regional`, `culture` | Influence des axes régionaux ou culturels. |
| `exitTreatment` | `legacy`, `adaptive`, `closed` | Traitement des sorties et raccordements. |
| `peripheralRoad` | `auto`, `none`, `partial`, `full` | Route périphérique absente, partielle ou complète. |
| `accessMode` | `adaptive`, `cultural`, `none` | Mode de desserte des fonds et intérieurs. |
| `allowStairs` | `false`, `true` | Autorisation conditionnelle : la culture ou le tissu doit aussi autoriser les escaliers. |
| `placement` | Natif : `center`, `rectangle`, `skew`, `notched` ; ancien atelier ajoute `lateral` | Placement/forme de la fixture ou composition de quartiers selon le chemin. Pas une nouvelle culture. |
| `ParcelConfig.operator` | `culture`, `strips`, `oriented`, `compact`, `inherited`, `courtyard`, `frontage`, `compound`, `wholeBlock`, `garden` | Choix de découpe. `strips` est traduit en `burgage`, `oriented` en `compact`. Les autres noms n'impliquent pas tous une méthode indépendante. |
| `preset`, plan/parcelles | `culture` ou un preset du catalogue, notamment `morph/...` | Choix d'une recette de paramètres ; liste complète déductible des annexes 7 et 8. |
| `recipe`, plan/parcelles | `auto` ou ID de recette disponible pour la culture | Cœur, extension, faubourg, village, hameau, secteur et variantes de croissance selon la culture. Les domaines ne sont pas identiques pour les 79 cultures. |
| `culture`, plan/parcelles | `site` ou ID culturel du catalogue | Chaque étape peut hériter de la culture du site ou la surcharger ; la culture de parcellaire peut donc différer de celle du plan. C'est une surcharge supplémentaire, à distinguer du mélange culturel en phases/secteurs. |
| `zone` | `auto` ; zones morphologiques `core`, `middle`, `edge`, `faubourg`, `village` | Choisit les plages de paramètres par position urbaine. `edge` existe dans les morphologies même si les recettes exportées utilisent surtout les quatre autres zones. |
| `streetOp` | `organic`, `grid` | Opérateurs locaux de rues, sous le maillage macroscopique. |
| `closeOp` | Menu : `closes`, `culDeSacTree`, `hutong`, `roji`, `none` ; le tissu natif dendritique peut écrire `derbs` | Desserte secondaire. La différence menu/valeur interne doit être conservée lors d'une analyse de combinaison. |
| `orientation` morphologique | `road`, `cardinal`, `terrain`, `water` | Orientation préférentielle par rapport aux routes, points cardinaux, pente ou eau. |
| `plotOp` du menu historique | `burgage`, `courtyard`, `siheyuan`, `machiya`, `compound`, `garden`, `wholeBlock` | Méthodes/alias historiques de parcellaire. Le natif peut les réorienter selon la famille d'admission culturelle (`compact`, `inherited`, etc.). |
| `fortificationStyle` | `auto`, `palisade`, `gord`, `hedge`, `curtain`, `flanked`, `concentric`, `rammed-earth`, `wengcheng`, `bastioned` | Sous-types de fortification : terre/bois, haie, courtine, tours, enceintes concentriques, terre compactée, portes à cour, bastions. Un style incompatible avec le type peut être remplacé par le style culturel. |
| `monument` | Chaîne libre ; défaut `none` | Dans la grammaire des quartiers, peut marquer le plus grand îlot `compound:<nom>`. Ce n'est pas une énumération fermée de monuments effectivement construits. |
| `programme.resources` | Liste libre ; déclencheurs explicitement lus : `timber`, `stone`, `ore`, `clay` | Ajoute des besoins d'ateliers ; d'autres mots ne garantissent pas une filière spécialisée. |
| `programme.lore` | Liste libre ; déclencheurs explicites : `temple`, `palace`, `necropolis`, `magic` | Crée une demande collective portant le premier token reconnu. Ce n'est pas une ontologie narrative complète. |
| `programme.period` | Chaîne libre ; vide et `any` désactivent certains filtres ; sinon périodes présentes dans l'admission architecturale | Filtre des recettes ; pas une liste globale de périodes homogène aux 79 cultures. |
| `programme.navigableAccess` | `false`, `true` | Déclaration explicite de navigation utilisée par certaines demandes ; indépendante de la simple présence d'eau. |
| Préférences de site historiques | `waterSide`, `hillSide` : `N`, `E`, `S`, `W` ; poids et préférences quantitatifs | L'ancien contrat ajoute `flatness`, `margin`, `centerInset` aux poids par archétype, `mountainFace` et `woodland`. Le bridge de placement natif expose directement surtout `weights`, `mountainFace`, `woodland` ; ne pas supposer un transfert de toutes les préférences historiques. L'ancien commentaire marque `woodland` comme réservé dans ce chemin. |
| Construction sur l'eau culturelle | Ancien `Culture.waterBuild` booléen ; plateformes/pilotis selon l'admission native | Une tradition sur pilotis ne doit pas être traitée comme une simple maison terrestre. C'est une capacité culturelle/architecturale conditionnelle, pas une autorisation globale de construire sur toute eau ni un bouton universel attesté dans CityBench. |

### Architecture : domaines dérivés et surcharges

| Champ | Domaine | Portée |
|---|---|---|
| Fonction du bâtiment | `domestic`, `mixed`, `workshop`, `warehouse`, `collective`, `open_space` | Six grandes fonctions d'admission ; les rôles détaillés du catalogue complètent ce découpage. |
| Typologie d'admission | `common`, `row`, `courtyard`, `compound`, `detached` | Préférence architecturale, normalement issue du programme/culture, parfois surchargée. |
| Composition du programme architectural | `row`, `detached`, `courtyard`, `farm`, `compound`, `hall`, `religious`, `civic`, `defence`, `inn` | Organisation de l'établissement demandé. Ne pas la confondre avec `LayoutConfig.composition`. |
| Mode historique Houses | `historical_strict`, `historical_inspired`, `fantasy_mix` | Contrat architectural distinct des noms de modes du programme urbain. |
| Recette / variante / style de maison | IDs du catalogue Houses et index architectural | Dépendent de la culture, période, fonction, taille et admission réelle du site ; ce document n'énumère pas toutes les variantes internes de chaque maison. |
| `parcel_fit` | `false`, `true` | Autorise l'adaptation prévue par le moteur, sous les contraintes d'accès, droits, terrain et toiture. |
| Rôle, quartier, richesse, ménages, étages, aire bâtie, continuité et mitoyenneté | Rôle/ID ou valeurs quantitatives du programme | Variations effectives de maison ; généralement sorties du programme urbain, pas axes catégoriels indépendants de la ville. |

Le menu d'opérateurs de bâtiments de l'ancien atelier comprend : `streetFrontRow`, `streetFrontRowExperimental`, `courtyardHouse`, `shopRow`, `pavilionCompound`, `yashiki`, `machiya`, `detached`, `treeHouse`, `hall`, `longhouse`, `kancha`, `yardHouse`, `tomb`, `venetian`, `konak`, `sahelCompound`, `giebelhaus`, `hanok`, `gnome`, `primitive`, `fungalHouse`, `duergarHall`, `perimeterBlock`. Ce sont des opérateurs du générateur historique/atelier ; ils ne doivent pas être présentés comme 24 choix autonomes de modèle Houses natif.

## 4. Terrain, eau, routes et ensemble régional

Ces variables sont amont de la ville. Un scénario CityBench sur un décor fixe ne les fait pas varier en changeant uniquement `LayoutConfig`.

| Variable | Domaine énumérable | Effet |
|---|---|---|
| Terrain côtier | Masque des huit directions `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW` ; absence de côte ; modes insulaires `island`, `archipelago`, `random` | Continuité des terres, rivages et place disponible. Le masque peut combiner des directions, ce n'est pas huit formes de côte exclusives. |
| Environnement des terrains géologiques | `flat`, `hills`, `mixed`, `mountains`, `high-mountains` | Fond du plateau/volcan/caldeira ; sous-option conditionnelle. |
| Hydrologie active | `false`, `true` | Présence de la chaîne hydrologique et de ses contraintes. |
| Rivière principale | `auto`, `none`, `stream`, `river`, `major` | Famille de cours d'eau visée. |
| Lacs | `auto`, `none`, `some` | Présence/ajout des lacs, soumis au relief et à l'eau disponible. |
| Méandres | `natural`, `reduced`, `none` | Forme des cours d'eau et terrains riverains. |
| Estuaire | `auto`, `simple`, `widening`, `funnel`, `tidal` | Morphologie de l'embouchure selon la chaîne utilisée. |
| Politique de dépressions | `auto`, `fill` | Traitement hydrologique du relief. |
| Conditionnement préalable | `none`, `erosion`, `breach`, `both` | Modification du relief avant l'eau ; sous-mode technique. |
| Chaîne hydrologique | `vector`, `rust` | Implémentation ; domaine de certaines options différent. |
| Traçage rivière vectorielle | `vector`, `grid` | Méthode du chemin vectoriel. |
| Confluence | `climate`, `drainage` | Mode de la chaîne vectorielle. |
| Options hydrologiques booléennes | Érosion active/affichée, équilibre, anabranches, influence du relief, avulsions, deltas | Certaines changent la géographie ; l'affichage de l'érosion peut aussi changer le fond montré. Pas des familles de villes. |
| Niveau du réseau régional | `primitive`, `rural`, `developed`, `imperial` | Types de routes, développement du réseau et raccordements disponibles. |
| Profil routier | `auto`, `medieval`, `roman`, `east-asian`, `caravan`, `andean`, `mesoamerican`, `tribal`, `elven`, `dwarven` | Largeurs, pentes et choix routiers selon le profil. |
| Surface routière demandée | `auto`, `dirt`, `gravel`, `paved`, `flagstone` | Revêtement et représentation du réseau. |
| Classes de route produites | `highway`, `main`, `local`, `track`, `trail` | Résultats de la hiérarchie, pas cinq forçages indépendants pour une ville. |
| Franchissements produits | `bridge`, `ford`, `causeway` | Pont, gué ou chaussée selon les contraintes du réseau. |
| Mode de génération régional | `auto`, `counts`, `list` | Placement automatique, nombres par classe ou liste explicite de settlements. |
| Distribution des tailles régionales | `classes`, `zipf` | Répartition des populations de plusieurs settlements. |
| Intention historique de `SettlementSpec.kind` | Champ chaîne, défaut `settlement` | Ne pas assimiler ce champ au type natif résolu dans `LayoutConfig.settlementForm`. |

### Variation quantitative ou libre, non énumérable sans choisir des paliers

| Groupe | Champs conservés dans l'inventaire | Effet |
|---|---|---|
| Identité / réalisation | Graines terrain, routes, quartiers, parcelles, bâtiments ; ID, nom, position et centre | Autres réalisations d'un même profil ; la position change les contraintes réelles. Un nom seul ne définit pas une nouvelle géométrie. |
| Taille et carte | Population, largeur de carte, rayon et facteur de rayon | Volume de besoins et espace de travail ; doivent être explicités dans les benchmarks. |
| Emprise | `grossDensity`, `aspect`, `orientation`, `nuclei`, `irregularity`, `anisotropy`, `separation`, `epochs`, `cohesion`, `satellites`, `branchDepth`, `gapSize` | Densité brute, proportions, noyaux, croissance, continuité et discontinuités. |
| Plan | `density`, `count`, `rings`, `phases`, `siteAdaptation`, `maxStreetGrade`, `maxLaneGrade`, `maxStairGrade`, `accessDepth`, `accessBudget` | Intensité, nombre d'éléments et adaptation/accessibilité. Certaines valeurs sont des entiers bornés ; elles restent des réglages internes de ces modes. |
| Mélange | `mixShare`, `mixAngle` | Part et orientation de la seconde influence ; l'ancienne représentation TS connaît aussi `blend`, que le contrat natif `mixMode` n'accepte pas. |
| Programme | `decay`, ressources libres, période libre, lore libre | Vacance et demandes particulières ; les mots non reconnus n'ont pas un effet garanti. |
| Morphologie de rues | `laneSpacing`, `wardArea`, `accessDepth`, `fieldTwist`, `curvature`, `fieldNoise`, `fieldWavelength`, `fieldRandom`, `gridSpacing`, `gridSkew`, `blockSize`, `minBlock`, `minWidth`, `widthByRank`, `widthScale`, `widthJitter`, `placeThreshold`, `deadEndRatio`, `slitDepth`, `plotDepth`, `contourFollow`, `contourBlend`, `longCut` | Espacements, angles, surfaces, largeurs, places et suivi du relief. Liste des champs exposés au catalogue natif pour les quartiers, hors opérateurs déjà listés. |
| Morphologie de parcelles | `houseArea`, `coverage`, `frontage`, `plotDepth`, `plotTilt`, `wideLotChance`, `deepFill` | Surfaces, occupation, façade, profondeur, biais et remplissage. `deepFill` est booléen. |
| Morphologie de bâtiments de l'atelier | `arch`, `roomDepth`, `courtyardShare`, `buildDepth`, `setback`, `bigCourtChance`, `houseVariation`, `blockCourtShare`, `blockSolidChance`, `blockInfillChance`, `footprintConformity`, `cornerFill`, et champs de dimensions/occupation communs | Variations internes de l'ancien opérateur sélectionné ; pas la définition exhaustive des options Houses. |
| Placement régional | `density`, `zipfExponent`, `minPopulation`, `populationJitter`, `spread`, `smallTop`, `mainClear`, `clustering`, `edgeMargin`, `flatnessWeight`, `buildableWeight`, `freshWaterWeight`, `riverWeight`, `coastWeight`, `floodWeight`, `defenseWeight`, `elevation`, `variationWeight`, `siteWeights`, `sitePrefs` | Nombre et position des settlements ; préférences de pente, eau, défense, bois et montagne selon le chemin qui les consomme. |
| Routes régionales | `density`, `gradeWeight`, `maxGrade`, `crossingCost`, `wobble`, `sharing`, `exits` | Densité, pente, franchissement, sinuosité, mutualisation et débouchés. |
| Édition locale | Quartier : culture, tissu, densité, rôle, richesse, forme, suppression, sel ; parcelle : rôle, fonction, ménages, forme, suppression/fusion/jardin, sel | Peut produire une ville qui ne se résume plus à un unique profil global. Les polygones édités ne sont pas un domaine fini. |
| Terrain / eau | Dimensions, résolution, intensités d'érosion, eau, pentes, bruit, seuils de rivière/lac, largeurs, sinuosité, tressage ; valeurs climatiques et dessin/import de raster | Paramètres amont continus ; les détails internes de ces générateurs ne sont pas des catégories supplémentaires de ville. |

## 5. Variations de présentation et d'exécution à enregistrer séparément

| Variable | Domaine | Ce que cela permet de conclure |
|---|---|---|
| Architecture CityBench | `silhouette`, `compact`, `detailed` | `silhouette` est un aperçu, les deux autres reposent sur des plans architecturaux natifs ; le détaillé enrichit la vue. Une silhouette ne prouve pas l'admission d'une maison ni sa capacité. |
| Style de peinture des bâtiments | `geometric`, `cartographic`, `silhouette` | Présentation de la géométrie retenue ; ce n'est pas une culture supplémentaire. |
| Diagnostic | `none`, `uses`, `height`, `access` | Lecture des fonctions, hauteurs et accès. |
| Couche urbaine | `tissue`, `uses`, `parcels`, `buildings`, `roles` (CityBench) | Objet inspecté ; les autres couches/contours/centres peuvent être activés séparément. |
| Fond CityBench | `relief`, `render`, `parchment` | Fond cartographique ; disponibilité dépend des images pré-rendues. |
| Vue / caméra | 2D / 3D, cadrage, zoom, orientation | Niveau de détail effectivement visible et coût ; pas nouvelle génération de settlement par principe. |
| Fabrication terrain | `procedural`, `neural-wasm`, `neural-python`, `neural` | Source de terrain, compatibilités et réalisation amont différentes. |
| Calcul terrain/hydrologie | WASM/CPU, GPU selon l'étape ; modes natifs selon le runtime | Variable d'exécution et de reproductibilité ; ne doit pas gonfler le nombre de styles urbains. |

## 6. Critique générale et modèle de combinaisons proposé

1. **La matrice est conditionnelle.** Une ferme isolée ne possède pas les mêmes axes actifs qu'une métropole. Les recettes disponibles dépendent de la culture. Une forme d'emprise n'est pas un découpage de parcelle, un type de toit ou une classe démographique.
2. **La culture est actuellement un paquet trop large.** `bastide` est un principe de plan, `maori-pa` un type d'établissement situé culturellement, `japanese-jokamachi` une ville de château, `necropolis` un programme/thème. Cette hétérogénéité explique des comparaisons difficiles. Conserver les IDs pour la compatibilité, mais décrire séparément tradition architecturale, organisation urbaine, époque et institutions serait plus lisible.
3. **Les synonymes de forme masquent plusieurs échelles.** Village-rue, emprise linéaire et mécanisme ruban agissent à des niveaux différents ; « dendritique » existe pour l'emprise et pour le tissu ; « archipel » existe pour les îles et pour une urbanisation discontinue.
4. **Il manque une politique explicite d'échelle culturelle.** Distinguer « documenté », « extrapolé », « incompatible » et « couverture technique insuffisante ». Ne pas réduire silencieusement la population pour rendre la demande calculable.
5. **La vocation doit devenir combinable.** Distinguer fonction dominante, activités, institutions et établissement isolé. Garder un résultat de demande quantifié et vérifiable pour chaque sélection.
6. **Le catalogue doit annoncer son niveau de support.** Référence historique, recette morphologique, admission architecturale et validation visuelle sont quatre choses. Une entrée présente ou une capture réussie ne démontre pas les quatre.
7. **Les variables résolues doivent accompagner les variables demandées.** Enregistrer au minimum culture(s), population demandée, classe, type résolu, recette par phase, emprise et maillage résolus, programme, capacité foncière, habitants réellement logés, déficits et motifs de substitution.
8. **Le nettoyage doit être livré dans l'interface.** Les axes destinés à l'utilisateur doivent être accessibles dans CityBench, avec des libellés distincts, les fonctions combinables et leurs poids, les choix automatiques résolus et les substitutions expliquées. Les options dépendantes doivent suivre le contexte : phases et faubourgs ne sont pas des réglages pertinents pour un moulin isolé. La génération, l'inspecteur, les exemples, la réinitialisation et les liens/imports doivent partager le même modèle. Cette exigence utilisateur est suivie dans le [TODO](../TODO.md#cohérence-des-paramètres-et-accès-ui--priorité-haute) ; elle ne décrit pas une fonctionnalité déjà implémentée.

Pour énumérer les combinaisons, partir de `culture × population/échelle × intention × contexte de terrain`, résoudre les valeurs culturelles par défaut, puis appliquer seulement les surcharges pertinentes. Un scénario doit porter les colonnes suivantes, même si certaines sont marquées « non applicable » :

```text
culture_principale, culture_secondaire, mode_melange,
population_demandee, classe_demographique, type_demande, type_resolu,
intention_isolee, fonctions_dominantes, etat, periode, cadre_historique,
biome, climat, relief, site, cote_insularite, riviere, lacs, navigation,
forme_emprise, mecanisme_emprise, budget_foncier, maillage,
composition, croissance_phases, faubourgs, enceinte, style_enceinte,
recettes, zones, operateur_parcellaire, desserte, orientation,
profil_routes, niveau_routes, surface_routes,
graines, position, decor, version_generateur,
architecture_affichee, camera,
capacite_fonciere, population_logee, deficits, substitutions
```

`fonctions_dominantes` combinables et les statuts de plausibilité sont une proposition ; ils ne sont pas aujourd'hui des champs implémentés tels quels. La population exacte, les nombres de phases et les graines doivent être définis pour rendre une matrice finie. Les 39 816 configurations de mon message précédent ne comptaient que 79 cultures × 7 classes × 6 tissus forcés × 12 formes forcées ; ce n'est ni le nombre des variantes distinctes supportées ni celui des cas cohérents.

Pour les captures : distinguer couverture des cultures, couverture des échelles, couverture des interactions et stress de performance. Cinquante captures peuvent fournir un échantillon contrasté ; elles ne peuvent pas couvrir individuellement 79 cultures, encore moins toutes leurs combinaisons.

## 7. Catalogue culturel complet et variations selon l'échelle

Table extraite du catalogue natif. `—` signifie absence de valeur ou de recette de croissance explicite ; cela ne signifie pas plafond de population. Le champ de croissance sélectionne un autre jeu de recettes au seuil indiqué. Les formes hameau/village sont des métadonnées culturelles ; leur résultat final dépend des règles natives décrites plus haut.

<!-- GENERATED_CATALOGUE_START -->

| ID culturel | Libellé | Plan culturel | Hameau / village | Croissance à partir de | Recettes disponibles |
|---|---|---|---|---|---|
| `european-organic` | Medieval organic (Europe) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `bastide` | Bastide (planned grid) | `grid` | `auto` / `auto` | — | `core` ; `faubourg` ; `village` ; `hamlet` |
| `medina` | Medina (North Africa) | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `chinese` | Chinese walled city | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `japanese-jokamachi` | Japanese castle town (jōkamachi) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `indian-temple` | Indian temple town | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `roman-core` | Roman castrum core | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `elven` | Elven forest town | `organic` | `walled` / `walled` | — | `core` ; `ring` ; `village` ; `hamlet` |
| `dwarven` | Dwarven hold | `terraces` | `walled` / `walled` | — | `core` ; `faubourg` ; `village` ; `hamlet` |
| `necropolis` | Necropolis (city of the dead) | `grid` | `walled` / `walled` | — | `core` ; `ring` ; `village` ; `hamlet` |
| `russian-kremlin` | Russian kremlin and posad | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `aztec` | Aztec city (Tenochtitlan) | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `inca` | Inca city (Cusco) | `terraces` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `byzantine-greek` | Byzantine hill town (Mystras) | `terraces` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `venetian-lagoon` | Venetian lagoon town | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `persian` | Persian city (Isfahan) | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `ottoman` | Ottoman town (Bursa) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `sahel` | Sahelian mud town (Djenne) | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `hanseatic` | Hanseatic port (Lubeck) | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `korean` | Korean walled town (Hanyang) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `wizard-city` | Wizard city | `radial` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `gnomish` | Gnomish canal town | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `stilt-town` | Stilt town (marsh folk) | `dispersed` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `barbarian` | Barbarian: Germanic village | `dispersed` | `ring` / `ring` | 2000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `barbarian-celtic` | Barbarian: Celtic ringfort | `radial` | `ring` / `ring` | 2400 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `barbarian-norse` | Barbarian: Norse farmstead cluster | `dispersed` | `ring` / `ring` | 2200 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `norse-ringfort` | Norse ring fortress (Trelleborg) | `radial` | `ring` / `ring` | 1800 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `maya` | Maya city (ceremonial core, sacbeob) | `dispersed` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `khmer` | Khmer city (Angkor) | `grid` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `celtic-oppidum` | Celtic oppidum | `organic` | `ring` / `ring` | 20000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `orcish` | Orcish war camp | `dispersed` | `ring` / `ring` | 45000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `halfling` | Halfling shire | `dispersed` | `ring` / `ring` | 1500 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `kraal` | Kraal (African homestead) | `radial` | `ring` / `ring` | 3000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `native-iroquoian` | Native American: Iroquoian longhouse village | `linear` | `ring` / `ring` | 3500 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `native-pueblo` | Native American: Pueblo | `terraces` | `ring` / `ring` | 5000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `native-plains` | Native American: Plains tipi camp | `radial` | `ring` / `ring` | 4500 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `nomad-camp` | Nomad camp (steppe ordu) | `radial` | `ring` / `ring` | 6000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `swahili-stone-town` | Swahili stone town (Lamu / Zanzibar) | `organic` | `auto` / `walled` | — | `core` ; `core-sector-0` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `drow-enclave` | Drow enclave | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `duergar-hold` | Duergar industrial hold | `terraces` | `walled` / `walled` | — | `core` ; `faubourg` ; `village` ; `hamlet` |
| `myconid-colony` | Myconid colony | `radial` | `walled` / `walled` | — | `core` ; `village` ; `hamlet` |
| `egyptian-planned` | Égypte · ville planifiée du Nil | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `nubian-fortified` | Nubie · ville fortifiée | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `mesopotamian` | Mésopotamie · quartiers de cours | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `levantine-tell` | Levant · ville fortifiée sur tell | `terraces` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `oasis-caravan` | Asie centrale · cité caravanière d’oasis | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `ksar-oasis` | Maghreb · ksar d’oasis | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `yoruba` | Yoruba · ville de concessions | `organic` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `himalayan-terraces` | Tibet et Ladakh · habitat en terrasses | `terraces` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `newar` | Népal newar · ville à places rituelles | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `indus-planned` | Indus · cité harappéenne | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `javanese-courts` | Java · ville de cours et enclos | `grid` | `auto` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `mississippian` | Mississippien · centre à place palissadée | `radial` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `al-andalus` | Al-Andalus · médina ibérique à patios | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `italian-comune` | Italie · commune à piazza et tours | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `flemish-cloth-town` | Flandre · ville drapière à beffroi | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `rynek-town` | Europe centrale · ville à rynek | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `slavic-gord` | Slaves · gród palissadé et podgrodzie | `radial` | `ring` / `ring` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `caucasian-highland` | Caucase · bourg fortifié géorgien et arménien | `terraces` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `ethiopian-highland` | Éthiopie · cité d’altitude (Aksum, Lalibela) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `great-zimbabwe` | Zimbabwe · enclos de pierre sèche | `organic` | `ring` / `ring` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `hausa-kano` | Hausa · cité-État à enceinte de terre (Kano) | `organic` | `walled` / `walled` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `hadhrami-tower` | Hadramaout · cité verticale de maisons-tours (Shibam) | `organic` | `walled` / `walled` | — | `core` ; `village` ; `hamlet` |
| `rajput-fort` | Rajputana · ville au pied du fort (Jaisalmer, Amber) | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `dravidian-temple` | Inde du Sud · ville-temple à rues concentriques (Madurai) | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `bagan` | Birmanie · cité royale de Pagan | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `vietnamese-citadel` | Viêt · citadelle et quartier marchand (Thăng Long) | `grid` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `tibetan-monastery` | Tibet · bourg monastique de pente | `terraces` | `terraces` / `terraces` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `mongol-ordu` | Mongols · ordu, camp princier de yourtes | `radial` | `ring` / `ring` | 8000 | `core` ; `village` ; `hamlet` ; `grown-core` ; `grown-ring` ; `grown-faubourg` |
| `maori-pa` | Māori · pā fortifié en terrasses | `terraces` | `terraces` / `terraces` | — | `core` ; `village` ; `hamlet` |
| `pnw-plank-village` | Côte Nord-Ouest · village de maisons de planches | `linear` | `auto` / `auto` | — | `core` ; `village` ; `hamlet` |
| `inuit-camp` | Arctique · camp inuit d’hiver | `dispersed` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `siberian-camp` | Sibérie · campement de chums des éleveurs de rennes | `radial` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `guarani-village` | Guaraní · village de grandes maisons (tekoha) | `radial` | `ring` / `ring` | — | `core` ; `village` ; `hamlet` |
| `budj-bim` | Australie · village de pierre du Budj Bim | `dispersed` | `auto` / `auto` | — | `core` ; `village` ; `hamlet` |
| `lizardfolk-swamp` | Hommes-lézards · cité lacustre sur pilotis | `dispersed` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `merfolk-tidal` | Ondins · village de grève et de grottes marines | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `giant-hold` | Géants · bourg mégalithique | `radial` | `ring` / `ring` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |
| `goblin-warren` | Gobelins · terrier à flanc de colline | `organic` | `auto` / `auto` | — | `core` ; `ring` ; `faubourg` ; `village` ; `hamlet` |

### Seuils de changement de recette de croissance

| Culture | Seuil (habitants) |
|---|---|
| `barbarian` | 2000 |
| `barbarian-celtic` | 2400 |
| `barbarian-norse` | 2200 |
| `norse-ringfort` | 1800 |
| `celtic-oppidum` | 20000 |
| `orcish` | 45000 |
| `halfling` | 1500 |
| `kraal` | 3000 |
| `native-iroquoian` | 3500 |
| `native-pueblo` | 5000 |
| `native-plains` | 4500 |
| `nomad-camp` | 6000 |
| `mongol-ordu` | 8000 |

Ces seuils ne sont pas des maxima de population. Une recette de croissance peut changer le plan tout en conservant une tradition architecturale. L’absence de croissance explicite ne bloque pas l’usage métropolitain.

### Domaines culturels internes présents dans les données

Ces valeurs sont des composants des recettes, pas autant de sélecteurs indépendants exposés par CityBench. La liste comprend les valeurs présentes dans les profils de base et de croissance.

| Composant | Valeurs effectivement présentes |
|---|---|
| `plan.pattern` | `dispersed`, `grid`, `linear`, `organic`, `radial`, `terraces` |
| `plan.enclosure` | `circle`, `organic`, `oval`, `rect`, `rounded-rect`, `square`, `terraces` |
| `plan.fortification` | `auto`, `hedge`, `none`, `palisade`, `wall` |
| `plan.gates` | `cardinal`, `roads` |
| `plan.orientation` | `cardinal`, `road`, `terrain`, `water` |
| `nucleus.kind` | `castle`, `clocktower`, `drum-tower`, `forum`, `grove`, `maidan`, `market`, `mortuary`, `mosque`, `mud-mosque`, `none`, `precinct`, `royal-enclosure`, `temple`, `ushnu`, `wizard-tower` |
| `nucleus.shape` | `circle`, `hull`, `rect`, `square` |
| `nucleus.orientation` | `cardinal`, `qibla`, `road`, `terrain`, `water` |
| `core.enclosure.shape` | `circle`, `organic`, `oval`, `rect`, `rounded-rect`, `square`, `terraces` |
| `core.enclosure.wall` | `auto`, `hedge`, `none`, `palisade`, `wall` |
| `core.enclosure.fossil` | `none`, `street`, `wall` |
| `ring.enclosure.shape` | `circle`, `organic`, `oval`, `rect`, `rounded-rect`, `square`, `terraces` |
| `ring.enclosure.wall` | `auto`, `hedge`, `none`, `palisade`, `wall` |
| `ring.enclosure.fossil` | `none`, `street`, `wall` |
| `hamlet.form` | `auto`, `ring`, `terraces`, `walled` |
| `village.form` | `auto`, `ring`, `terraces`, `walled` |

Les profils TS connaissent aussi les formes `grove`, les orientations de noyau `qibla`, les fossiles d’enceinte `street/wall/none` et des attributs de rendu tels que canopée, pilotis, canaux et terrasses. Présence dans le contrat historique et prise en charge effective dans la scène native doivent être distinguées.

## 8. Préréglages et rôles : domaines dépendants complets

Le catalogue contient **79 cultures, 382 références de recettes culturelles et 443 presets**. Ces nombres ne s’additionnent pas pour obtenir des styles indépendants. Les références ci-dessous rendent la liste des presets explicite.

### Références exactes des recettes culturelles

| Culture | Recette → preset |
|---|---|
| `european-organic` | `core` → `european-organic/core` ; `ring` → `european-organic/ring` ; `faubourg` → `european-organic/faubourg` ; `village` → `european-organic/village` ; `hamlet` → `european-organic/hamlet` |
| `bastide` | `core` → `bastide/core` ; `faubourg` → `bastide/faubourg` ; `village` → `bastide/village` ; `hamlet` → `bastide/hamlet` |
| `medina` | `core` → `medina/core` ; `ring` → `medina/ring` ; `faubourg` → `medina/faubourg` ; `village` → `medina/village` ; `hamlet` → `medina/hamlet` |
| `chinese` | `core` → `chinese/core` ; `ring` → `chinese/ring` ; `faubourg` → `chinese/faubourg` ; `village` → `chinese/village` ; `hamlet` → `chinese/hamlet` |
| `japanese-jokamachi` | `core` → `japanese-jokamachi/core` ; `ring` → `japanese-jokamachi/ring` ; `faubourg` → `japanese-jokamachi/faubourg` ; `village` → `japanese-jokamachi/village` ; `hamlet` → `japanese-jokamachi/hamlet` |
| `indian-temple` | `core` → `indian-temple/core` ; `ring` → `indian-temple/ring` ; `faubourg` → `indian-temple/faubourg` ; `village` → `indian-temple/village` ; `hamlet` → `indian-temple/hamlet` |
| `roman-core` | `core` → `roman-core/core` ; `ring` → `roman-core/ring` ; `faubourg` → `roman-core/faubourg` ; `village` → `roman-core/village` ; `hamlet` → `roman-core/hamlet` |
| `elven` | `core` → `elven/core` ; `ring` → `elven/ring` ; `village` → `elven/village` ; `hamlet` → `elven/hamlet` |
| `dwarven` | `core` → `dwarven/core` ; `faubourg` → `dwarven/faubourg` ; `village` → `dwarven/village` ; `hamlet` → `dwarven/hamlet` |
| `necropolis` | `core` → `necropolis/core` ; `ring` → `necropolis/ring` ; `village` → `necropolis/village` ; `hamlet` → `necropolis/hamlet` |
| `russian-kremlin` | `core` → `russian-kremlin/core` ; `ring` → `russian-kremlin/ring` ; `faubourg` → `russian-kremlin/faubourg` ; `village` → `russian-kremlin/village` ; `hamlet` → `russian-kremlin/hamlet` |
| `aztec` | `core` → `aztec/core` ; `ring` → `aztec/ring` ; `faubourg` → `aztec/faubourg` ; `village` → `aztec/village` ; `hamlet` → `aztec/hamlet` |
| `inca` | `core` → `inca/core` ; `ring` → `inca/ring` ; `faubourg` → `inca/faubourg` ; `village` → `inca/village` ; `hamlet` → `inca/hamlet` |
| `byzantine-greek` | `core` → `byzantine-greek/core` ; `ring` → `byzantine-greek/ring` ; `faubourg` → `byzantine-greek/faubourg` ; `village` → `byzantine-greek/village` ; `hamlet` → `byzantine-greek/hamlet` |
| `venetian-lagoon` | `core` → `venetian-lagoon/core` ; `ring` → `venetian-lagoon/ring` ; `faubourg` → `venetian-lagoon/faubourg` ; `village` → `venetian-lagoon/village` ; `hamlet` → `venetian-lagoon/hamlet` |
| `persian` | `core` → `persian/core` ; `ring` → `persian/ring` ; `faubourg` → `persian/faubourg` ; `village` → `persian/village` ; `hamlet` → `persian/hamlet` |
| `ottoman` | `core` → `ottoman/core` ; `ring` → `ottoman/ring` ; `faubourg` → `ottoman/faubourg` ; `village` → `ottoman/village` ; `hamlet` → `ottoman/hamlet` |
| `sahel` | `core` → `sahel/core` ; `ring` → `sahel/ring` ; `faubourg` → `sahel/faubourg` ; `village` → `sahel/village` ; `hamlet` → `sahel/hamlet` |
| `hanseatic` | `core` → `hanseatic/core` ; `ring` → `hanseatic/ring` ; `faubourg` → `hanseatic/faubourg` ; `village` → `hanseatic/village` ; `hamlet` → `hanseatic/hamlet` |
| `korean` | `core` → `korean/core` ; `ring` → `korean/ring` ; `faubourg` → `korean/faubourg` ; `village` → `korean/village` ; `hamlet` → `korean/hamlet` |
| `wizard-city` | `core` → `wizard-city/core` ; `ring` → `wizard-city/ring` ; `faubourg` → `wizard-city/faubourg` ; `village` → `wizard-city/village` ; `hamlet` → `wizard-city/hamlet` |
| `gnomish` | `core` → `gnomish/core` ; `ring` → `gnomish/ring` ; `faubourg` → `gnomish/faubourg` ; `village` → `gnomish/village` ; `hamlet` → `gnomish/hamlet` |
| `stilt-town` | `core` → `stilt-town/core` ; `village` → `stilt-town/village` ; `hamlet` → `stilt-town/hamlet` |
| `barbarian` | `core` → `barbarian/core` ; `village` → `barbarian/village` ; `hamlet` → `barbarian/hamlet` ; `grown-core` → `barbarian/grown-core` ; `grown-ring` → `barbarian/grown-ring` ; `grown-faubourg` → `barbarian/grown-faubourg` |
| `barbarian-celtic` | `core` → `barbarian-celtic/core` ; `village` → `barbarian-celtic/village` ; `hamlet` → `barbarian-celtic/hamlet` ; `grown-core` → `barbarian-celtic/grown-core` ; `grown-ring` → `barbarian-celtic/grown-ring` ; `grown-faubourg` → `barbarian-celtic/grown-faubourg` |
| `barbarian-norse` | `core` → `barbarian-norse/core` ; `village` → `barbarian-norse/village` ; `hamlet` → `barbarian-norse/hamlet` ; `grown-core` → `barbarian-norse/grown-core` ; `grown-ring` → `barbarian-norse/grown-ring` ; `grown-faubourg` → `barbarian-norse/grown-faubourg` |
| `norse-ringfort` | `core` → `norse-ringfort/core` ; `village` → `norse-ringfort/village` ; `hamlet` → `norse-ringfort/hamlet` ; `grown-core` → `norse-ringfort/grown-core` ; `grown-ring` → `norse-ringfort/grown-ring` ; `grown-faubourg` → `norse-ringfort/grown-faubourg` |
| `maya` | `core` → `maya/core` ; `village` → `maya/village` ; `hamlet` → `maya/hamlet` |
| `khmer` | `core` → `khmer/core` ; `village` → `khmer/village` ; `hamlet` → `khmer/hamlet` |
| `celtic-oppidum` | `core` → `celtic-oppidum/core` ; `village` → `celtic-oppidum/village` ; `hamlet` → `celtic-oppidum/hamlet` ; `grown-core` → `celtic-oppidum/grown-core` ; `grown-ring` → `celtic-oppidum/grown-ring` ; `grown-faubourg` → `celtic-oppidum/grown-faubourg` |
| `orcish` | `core` → `orcish/core` ; `village` → `orcish/village` ; `hamlet` → `orcish/hamlet` ; `grown-core` → `orcish/grown-core` ; `grown-ring` → `orcish/grown-ring` ; `grown-faubourg` → `orcish/grown-faubourg` |
| `halfling` | `core` → `halfling/core` ; `village` → `halfling/village` ; `hamlet` → `halfling/hamlet` ; `grown-core` → `halfling/grown-core` ; `grown-ring` → `halfling/grown-ring` ; `grown-faubourg` → `halfling/grown-faubourg` |
| `kraal` | `core` → `kraal/core` ; `village` → `kraal/village` ; `hamlet` → `kraal/hamlet` ; `grown-core` → `kraal/grown-core` ; `grown-ring` → `kraal/grown-ring` ; `grown-faubourg` → `kraal/grown-faubourg` |
| `native-iroquoian` | `core` → `native-iroquoian/core` ; `village` → `native-iroquoian/village` ; `hamlet` → `native-iroquoian/hamlet` ; `grown-core` → `native-iroquoian/grown-core` ; `grown-ring` → `native-iroquoian/grown-ring` ; `grown-faubourg` → `native-iroquoian/grown-faubourg` |
| `native-pueblo` | `core` → `native-pueblo/core` ; `village` → `native-pueblo/village` ; `hamlet` → `native-pueblo/hamlet` ; `grown-core` → `native-pueblo/grown-core` ; `grown-ring` → `native-pueblo/grown-ring` ; `grown-faubourg` → `native-pueblo/grown-faubourg` |
| `native-plains` | `core` → `native-plains/core` ; `village` → `native-plains/village` ; `hamlet` → `native-plains/hamlet` ; `grown-core` → `native-plains/grown-core` ; `grown-ring` → `native-plains/grown-ring` ; `grown-faubourg` → `native-plains/grown-faubourg` |
| `nomad-camp` | `core` → `nomad-camp/core` ; `village` → `nomad-camp/village` ; `hamlet` → `nomad-camp/hamlet` ; `grown-core` → `nomad-camp/grown-core` ; `grown-ring` → `nomad-camp/grown-ring` ; `grown-faubourg` → `nomad-camp/grown-faubourg` |
| `swahili-stone-town` | `core` → `swahili-stone-town/core` ; `core-sector-0` → `swahili-stone-town/core-sector-0` ; `ring` → `swahili-stone-town/ring` ; `faubourg` → `swahili-stone-town/faubourg` ; `village` → `swahili-stone-town/village` ; `hamlet` → `swahili-stone-town/hamlet` |
| `drow-enclave` | `core` → `drow-enclave/core` ; `ring` → `drow-enclave/ring` ; `faubourg` → `drow-enclave/faubourg` ; `village` → `drow-enclave/village` ; `hamlet` → `drow-enclave/hamlet` |
| `duergar-hold` | `core` → `duergar-hold/core` ; `faubourg` → `duergar-hold/faubourg` ; `village` → `duergar-hold/village` ; `hamlet` → `duergar-hold/hamlet` |
| `myconid-colony` | `core` → `myconid-colony/core` ; `village` → `myconid-colony/village` ; `hamlet` → `myconid-colony/hamlet` |
| `egyptian-planned` | `core` → `egyptian-planned/core` ; `ring` → `egyptian-planned/ring` ; `faubourg` → `egyptian-planned/faubourg` ; `village` → `egyptian-planned/village` ; `hamlet` → `egyptian-planned/hamlet` |
| `nubian-fortified` | `core` → `nubian-fortified/core` ; `ring` → `nubian-fortified/ring` ; `faubourg` → `nubian-fortified/faubourg` ; `village` → `nubian-fortified/village` ; `hamlet` → `nubian-fortified/hamlet` |
| `mesopotamian` | `core` → `mesopotamian/core` ; `ring` → `mesopotamian/ring` ; `faubourg` → `mesopotamian/faubourg` ; `village` → `mesopotamian/village` ; `hamlet` → `mesopotamian/hamlet` |
| `levantine-tell` | `core` → `levantine-tell/core` ; `ring` → `levantine-tell/ring` ; `faubourg` → `levantine-tell/faubourg` ; `village` → `levantine-tell/village` ; `hamlet` → `levantine-tell/hamlet` |
| `oasis-caravan` | `core` → `oasis-caravan/core` ; `ring` → `oasis-caravan/ring` ; `faubourg` → `oasis-caravan/faubourg` ; `village` → `oasis-caravan/village` ; `hamlet` → `oasis-caravan/hamlet` |
| `ksar-oasis` | `core` → `ksar-oasis/core` ; `ring` → `ksar-oasis/ring` ; `faubourg` → `ksar-oasis/faubourg` ; `village` → `ksar-oasis/village` ; `hamlet` → `ksar-oasis/hamlet` |
| `yoruba` | `core` → `yoruba/core` ; `ring` → `yoruba/ring` ; `faubourg` → `yoruba/faubourg` ; `village` → `yoruba/village` ; `hamlet` → `yoruba/hamlet` |
| `himalayan-terraces` | `core` → `himalayan-terraces/core` ; `ring` → `himalayan-terraces/ring` ; `faubourg` → `himalayan-terraces/faubourg` ; `village` → `himalayan-terraces/village` ; `hamlet` → `himalayan-terraces/hamlet` |
| `newar` | `core` → `newar/core` ; `ring` → `newar/ring` ; `faubourg` → `newar/faubourg` ; `village` → `newar/village` ; `hamlet` → `newar/hamlet` |
| `indus-planned` | `core` → `indus-planned/core` ; `ring` → `indus-planned/ring` ; `faubourg` → `indus-planned/faubourg` ; `village` → `indus-planned/village` ; `hamlet` → `indus-planned/hamlet` |
| `javanese-courts` | `core` → `javanese-courts/core` ; `ring` → `javanese-courts/ring` ; `faubourg` → `javanese-courts/faubourg` ; `village` → `javanese-courts/village` ; `hamlet` → `javanese-courts/hamlet` |
| `mississippian` | `core` → `mississippian/core` ; `ring` → `mississippian/ring` ; `faubourg` → `mississippian/faubourg` ; `village` → `mississippian/village` ; `hamlet` → `mississippian/hamlet` |
| `al-andalus` | `core` → `al-andalus/core` ; `ring` → `al-andalus/ring` ; `faubourg` → `al-andalus/faubourg` ; `village` → `al-andalus/village` ; `hamlet` → `al-andalus/hamlet` |
| `italian-comune` | `core` → `italian-comune/core` ; `ring` → `italian-comune/ring` ; `faubourg` → `italian-comune/faubourg` ; `village` → `italian-comune/village` ; `hamlet` → `italian-comune/hamlet` |
| `flemish-cloth-town` | `core` → `flemish-cloth-town/core` ; `ring` → `flemish-cloth-town/ring` ; `faubourg` → `flemish-cloth-town/faubourg` ; `village` → `flemish-cloth-town/village` ; `hamlet` → `flemish-cloth-town/hamlet` |
| `rynek-town` | `core` → `rynek-town/core` ; `ring` → `rynek-town/ring` ; `faubourg` → `rynek-town/faubourg` ; `village` → `rynek-town/village` ; `hamlet` → `rynek-town/hamlet` |
| `slavic-gord` | `core` → `slavic-gord/core` ; `ring` → `slavic-gord/ring` ; `faubourg` → `slavic-gord/faubourg` ; `village` → `slavic-gord/village` ; `hamlet` → `slavic-gord/hamlet` |
| `caucasian-highland` | `core` → `caucasian-highland/core` ; `ring` → `caucasian-highland/ring` ; `faubourg` → `caucasian-highland/faubourg` ; `village` → `caucasian-highland/village` ; `hamlet` → `caucasian-highland/hamlet` |
| `ethiopian-highland` | `core` → `ethiopian-highland/core` ; `ring` → `ethiopian-highland/ring` ; `faubourg` → `ethiopian-highland/faubourg` ; `village` → `ethiopian-highland/village` ; `hamlet` → `ethiopian-highland/hamlet` |
| `great-zimbabwe` | `core` → `great-zimbabwe/core` ; `ring` → `great-zimbabwe/ring` ; `faubourg` → `great-zimbabwe/faubourg` ; `village` → `great-zimbabwe/village` ; `hamlet` → `great-zimbabwe/hamlet` |
| `hausa-kano` | `core` → `hausa-kano/core` ; `ring` → `hausa-kano/ring` ; `faubourg` → `hausa-kano/faubourg` ; `village` → `hausa-kano/village` ; `hamlet` → `hausa-kano/hamlet` |
| `hadhrami-tower` | `core` → `hadhrami-tower/core` ; `village` → `hadhrami-tower/village` ; `hamlet` → `hadhrami-tower/hamlet` |
| `rajput-fort` | `core` → `rajput-fort/core` ; `ring` → `rajput-fort/ring` ; `faubourg` → `rajput-fort/faubourg` ; `village` → `rajput-fort/village` ; `hamlet` → `rajput-fort/hamlet` |
| `dravidian-temple` | `core` → `dravidian-temple/core` ; `ring` → `dravidian-temple/ring` ; `faubourg` → `dravidian-temple/faubourg` ; `village` → `dravidian-temple/village` ; `hamlet` → `dravidian-temple/hamlet` |
| `bagan` | `core` → `bagan/core` ; `ring` → `bagan/ring` ; `faubourg` → `bagan/faubourg` ; `village` → `bagan/village` ; `hamlet` → `bagan/hamlet` |
| `vietnamese-citadel` | `core` → `vietnamese-citadel/core` ; `ring` → `vietnamese-citadel/ring` ; `faubourg` → `vietnamese-citadel/faubourg` ; `village` → `vietnamese-citadel/village` ; `hamlet` → `vietnamese-citadel/hamlet` |
| `tibetan-monastery` | `core` → `tibetan-monastery/core` ; `ring` → `tibetan-monastery/ring` ; `faubourg` → `tibetan-monastery/faubourg` ; `village` → `tibetan-monastery/village` ; `hamlet` → `tibetan-monastery/hamlet` |
| `mongol-ordu` | `core` → `mongol-ordu/core` ; `village` → `mongol-ordu/village` ; `hamlet` → `mongol-ordu/hamlet` ; `grown-core` → `mongol-ordu/grown-core` ; `grown-ring` → `mongol-ordu/grown-ring` ; `grown-faubourg` → `mongol-ordu/grown-faubourg` |
| `maori-pa` | `core` → `maori-pa/core` ; `village` → `maori-pa/village` ; `hamlet` → `maori-pa/hamlet` |
| `pnw-plank-village` | `core` → `pnw-plank-village/core` ; `village` → `pnw-plank-village/village` ; `hamlet` → `pnw-plank-village/hamlet` |
| `inuit-camp` | `core` → `inuit-camp/core` ; `village` → `inuit-camp/village` ; `hamlet` → `inuit-camp/hamlet` |
| `siberian-camp` | `core` → `siberian-camp/core` ; `village` → `siberian-camp/village` ; `hamlet` → `siberian-camp/hamlet` |
| `guarani-village` | `core` → `guarani-village/core` ; `village` → `guarani-village/village` ; `hamlet` → `guarani-village/hamlet` |
| `budj-bim` | `core` → `budj-bim/core` ; `village` → `budj-bim/village` ; `hamlet` → `budj-bim/hamlet` |
| `lizardfolk-swamp` | `core` → `lizardfolk-swamp/core` ; `ring` → `lizardfolk-swamp/ring` ; `faubourg` → `lizardfolk-swamp/faubourg` ; `village` → `lizardfolk-swamp/village` ; `hamlet` → `lizardfolk-swamp/hamlet` |
| `merfolk-tidal` | `core` → `merfolk-tidal/core` ; `ring` → `merfolk-tidal/ring` ; `faubourg` → `merfolk-tidal/faubourg` ; `village` → `merfolk-tidal/village` ; `hamlet` → `merfolk-tidal/hamlet` |
| `giant-hold` | `core` → `giant-hold/core` ; `ring` → `giant-hold/ring` ; `faubourg` → `giant-hold/faubourg` ; `village` → `giant-hold/village` ; `hamlet` → `giant-hold/hamlet` |
| `goblin-warren` | `core` → `goblin-warren/core` ; `ring` → `goblin-warren/ring` ; `faubourg` → `goblin-warren/faubourg` ; `village` → `goblin-warren/village` ; `hamlet` → `goblin-warren/hamlet` |

### Autres presets du catalogue

61 presets ne sont pas référencés par les recettes culturelles ci-dessus :

- `morph/european-organic`
- `morph/bastide`
- `morph/perimeter-block`
- `morph/kraal`
- `morph/plains-camp`
- `morph/barbarian`
- `morph/barbarian-celtic`
- `morph/barbarian-norse`
- `morph/iroquoian`
- `morph/pueblo`
- `morph/norse-ringfort`
- `morph/maya`
- `morph/khmer`
- `morph/oppidum`
- `morph/orcish`
- `morph/halfling`
- `morph/stilt-town`
- `morph/nomad-camp`
- `morph/barbarian-town`
- `morph/barbarian-celtic-town`
- `morph/barbarian-norse-town`
- `morph/norse-ringfort-town`
- `morph/celtic-oppidum-town`
- `morph/orcish-town`
- `morph/halfling-town`
- `morph/kraal-town`
- `morph/native-iroquoian-town`
- `morph/native-pueblo-town`
- `morph/native-plains-town`
- `morph/nomad-camp-town`
- `morph/inca`
- `morph/aztec`
- `morph/posad`
- `morph/necropolis`
- `morph/roman-castrum`
- `morph/medina`
- `morph/medina-souk`
- `morph/chinese`
- `morph/jp-samurai`
- `morph/jp-merchant`
- `morph/indian-temple`
- `morph/elven`
- `morph/dwarven`
- `morph/chinese-suburb`
- `morph/swahili-stone`
- `morph/swahili-bazaar`
- `morph/byzantine`
- `morph/venetian`
- `morph/persian`
- `morph/persian-bazaar`
- `morph/ottoman`
- `morph/ottoman-carsi`
- `morph/sahel`
- `morph/sahel-town`
- `morph/hanseatic`
- `morph/korean`
- `morph/wizard`
- `morph/gnomish`
- `morph/drow-enclave`
- `morph/duergar-hold`
- `morph/myconid-colony`

### Rôles fonctionnels détaillés

Les familles de services contiennent **87 rôles distincts**. En ajoutant les services ruraux, les intentions isolées et la correspondance des noyaux, on obtient **98 IDs de rôles référencés** dans ces sections. Cela montre pourquoi les six vocations urbaines ne résument pas toute la variété fonctionnelle du générateur. Ce sont des rôles de programme, pas la garantie d’un bâtiment dédié effectivement admis.

| Rôle | Libellé générique du catalogue, si présent | Provenance |
|---|---|---|
| `civic.academy` | Académie | services culturels |
| `civic.amphitheatre` | Amphithéâtre | services culturels |
| `civic.ballcourt` | Jeu de balle | services culturels |
| `civic.basilica` | Basilique | services culturels |
| `civic.bathhouse` | Étuves | services culturels |
| `civic.calmecac` | Calmecac (école) | services culturels |
| `civic.clocktower` | Beffroi | noyau |
| `civic.council-house` | Maison du conseil | services culturels |
| `civic.drum-tower` | Tour du tambour | noyau |
| `civic.forum` | Forum | services culturels, noyau |
| `civic.ghat` | Ghats (marches du fleuve) | services culturels |
| `civic.guildhall` | Maison des corporations | services culturels |
| `civic.hall` | Salle commune | services culturels |
| `civic.hammam` | Hammam | services culturels |
| `civic.hospital` | Hôtel-Dieu | services culturels |
| `civic.kallanka` | Kallanka (grande halle) | services culturels |
| `civic.khan-tent` | Tente du khan | services culturels |
| `civic.longhall` | Grande halle | services culturels |
| `civic.madrasa` | Médersa | services culturels |
| `civic.maristan` | Maristan (hôpital) | services culturels |
| `civic.palace` | Palais | services culturels, noyau |
| `civic.stepwell` | Puits à degrés | services culturels |
| `civic.tank` | Bassin sacré | services culturels |
| `civic.theatre` | Théâtre | services culturels |
| `civic.thermae` | Thermes | services culturels |
| `civic.townhall` | Hôtel de ville | services culturels |
| `civic.university` | Université | services culturels |
| `civic.wizard-tower` | Tour du mage | noyau |
| `civic.yamen` | Yamen (siège du magistrat) | services culturels |
| `commerce.bazaar` | Bazar | services culturels |
| `commerce.caravanserai` | Caravansérail | services culturels |
| `commerce.dharamshala` | Dharamshala (gîte des pèlerins) | services culturels |
| `commerce.emporium` | Emporium (marché du port) | services culturels |
| `commerce.fishmarket` | Marché aux poissons | services culturels |
| `commerce.funduq` | Fondouk | services culturels |
| `commerce.inn` | Auberge | services culturels, isolé |
| `commerce.macellum` | Macellum (marché couvert) | services culturels |
| `commerce.maidan` | Maidan | noyau |
| `commerce.market` | Place du marché | services culturels, noyau |
| `commerce.market.gate` | Marché de porte | services culturels |
| `commerce.market.ward` | Marché de quartier | services culturels |
| `commerce.souk` | Souk | services culturels |
| `commerce.taberna` | Taberna | services culturels |
| `commerce.tianguis` | Tianguis (marché) | services culturels |
| `commerce.warehouse` | Entrepôt du port | services culturels |
| `craft.alchemist` | Officine d’alchimiste | services culturels |
| `craft.bakery` | Boulangerie | services culturels |
| `craft.boatshed` | Abri à bateaux | services culturels |
| `craft.brewery` | Brasserie | services culturels |
| `craft.dyer` | Teinturerie | services culturels |
| `craft.fullonica` | Foulerie | services culturels |
| `craft.mill` | Moulin à eau | services culturels, isolé |
| `craft.obsidian` | Atelier d’obsidienne | services culturels |
| `craft.potter` | Poterie | services culturels |
| `craft.smithy` | Forge | services culturels |
| `craft.tannery` | Tannerie | services culturels |
| `craft.weaver` | Atelier de tissage | services culturels |
| `craft.workshop` | Atelier | services culturels |
| `defence.barracks` | Caserne | services culturels |
| `defence.castle` | Château | services culturels, noyau |
| `defence.fort` | Fort | services culturels |
| `defence.fortress` | Forteresse | services culturels |
| `defence.kasbah` | Kasbah | services culturels |
| `defence.keep` | Donjon | services culturels |
| `defence.tower` | Tour de guet | isolé |
| `dwelling.farm` | Ferme (logis, grange et cour) | isolé |
| `elite.kancha-palace` | Palais (kancha) | services culturels |
| `elite.palace` | Palais | services culturels |
| `open.cemetery` | Cimetière | services culturels |
| `open.corral` | Enclos à bétail | services culturels |
| `open.kraal` | Kraal | services culturels |
| `open.necropolis` | Nécropole | services culturels |
| `open.plaza` | Place | services culturels |
| `open.thing` | Lieu du thing | services culturels |
| `storage.barn` | Grange commune | rural |
| `storage.granary` | Grenier | services culturels |
| `storage.horreum` | Horreum (entrepôt) | services culturels |
| `storage.qollqa` | Qollqa (grenier d’État) | services culturels |
| `worship.capitolium` | Capitole | services culturels |
| `worship.cathedral` | Cathédrale | services culturels |
| `worship.city-god-temple` | Temple du dieu de la ville | services culturels |
| `worship.confucian-temple` | Temple de Confucius | services culturels |
| `worship.grove` | Bois sacré | noyau |
| `worship.hof` | Hof (temple) | services culturels |
| `worship.huaca` | Huaca (lieu sacré) | services culturels |
| `worship.kiva` | Kiva | services culturels |
| `worship.masjid` | Mosquée de quartier | services culturels |
| `worship.monastery` | Monastère | services culturels |
| `worship.mortuary-temple` | Temple funéraire | noyau |
| `worship.mosque.friday` | Mosquée du vendredi | services culturels, noyau |
| `worship.parish` | Église paroissiale | services culturels |
| `worship.precinct` | Enceinte sacrée | noyau |
| `worship.pyramid-precinct` | Enceinte de la pyramide | services culturels |
| `worship.shrine` | Sanctuaire | services culturels, isolé |
| `worship.temple` | Temple | services culturels |
| `worship.temple.major` | Grand temple | services culturels, noyau |
| `worship.ushnu` | Ushnu (plate-forme cérémonielle) | services culturels, noyau |
| `worship.wayside` | Oratoire | isolé |

Des rôles domestiques et d’espaces ouverts sont aussi produits par le programme (par exemple `dwelling`, `dwelling.shop`, `open.common`, `open.garden`) ; les rôles locaux peuvent être édités et les états ajoutent des suffixes. L’ensemble des chaînes possibles n’est donc pas une énumération fermée globale.

## 9. Sources et périmètre de l’exhaustivité

L’inventaire couvre tous les axes cités dans la discussion, tous les sélecteurs de `LayoutConfig`, `ParcelConfig`, `FootprintConfig`, `ProgrammeContext`, les classifications d’échelle, les 79 cultures et leurs recettes, les principaux contextes terrain/eau/routes, ainsi que les différences de présentation. Les champs quantitatifs et libres sont signalés pour ne pas les faire disparaître de la matrice. Les versions de modèles neuronaux, les paramètres internes de chaque recette de maison, les palettes/dimensions de chaque pinceau et les réglages de chaque tour ou portail ne constituent pas de nouvelles catégories de ville ; leurs domaines détaillés restent dans leurs catalogues respectifs.

Sources principales, toutes locales :

- [Contrat de configuration urbaine](../rust/bridge/urbanConfig.ts)
- [Catalogue natif des cultures et recettes](../rust/crates/core/src/urban/catalogue.json)
- [Résolution native des types et petites implantations](../rust/crates/core/src/urban/kinds.rs)
- [Composition, phases et centres](../rust/crates/core/src/urban/composition.rs)
- [Profils culturels et adaptation à la population](../rust/crates/core/src/urban/profiles.rs)
- [Emprise et mécanismes de croissance](../rust/crates/core/src/urban/footprint.rs)
- [Programme et admission des demandes](../rust/crates/core/src/urban/programme.rs)
- [Services et effets des vocations](../rust/crates/core/src/urban/roles.rs)
- [Catalogue des services et états](../rust/crates/core/src/urban/services.json)
- [Correspondance culture / architecture](../rust/crates/core/src/urban/culture.rs)
- [Anciennes classes et seuils démographiques](../web/src/gen/options.ts)
- [Anciennes plages d’échelle et formes culturelles](../web/src/gen/urban/culture.ts)
- [Ancien plafonnement dans le pipeline](../web/src/gen/pipeline.ts)
- [Raccourcis de population de l’interface](../web/src/ui/settlementKinds.ts)
- [Limite déclarée de la carte CityBench](../web/src/ui/terrainSettlements.ts)
- [Préréglages composites de settlement](../web/src/ui/urbanSettlementStyles.ts)
- [Opérateurs de l’atelier historique](../web/src/gen/urban/testbenchConfig.ts)
- [Biomes](../web/src/gen/biomes.ts)
- [Terrain et climats](../rust/bridge/terrain.ts)
- [Hydrologie](../rust/bridge/hydrology.ts)
- [Placement et routes régionaux](../rust/bridge/settlements.ts)
- [Contrat architectural natif](../rust/bridge/urbanArchitecture.ts)
- [Modes et peinture des bâtiments](../web/src/render/urbanBuildingStyle.ts)

Aucun plafond historique de population n’est affirmé pour une culture sur la seule base de ce code. Les critiques et propositions des sections 1 et 6 sont des recommandations de modèle, distinctes des comportements existants.
