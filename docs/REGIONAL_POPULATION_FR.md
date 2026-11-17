# Démographie régionale de la V2

## Problème remplacé

La V1 partait d'un lieu principal (`options.population`, normalement 2 500 habitants), auquel le moteur ajoutait des lieux secondaires. L'ancienne suggestion de la V2 multipliait la surface par des coefficients de relief et de climat, puis arrondissait cinq effectifs. Elle ne distribuait aucun budget démographique, ignorait la culture et conservait toujours la population indépendante du lieu principal. L'état automatique des effectifs était en outre conservé dans une `WeakMap` de l'interface : un code de génération ne transportait pas cette intention.

La V2 calcule maintenant **une population pour toute la région**, puis une liste de lieux qui se partagent ce budget. Cette liste est transmise au moteur Rust natif, au WASM et au parcours TypeScript. Aucun lieu de 2 500 habitants ne s'ajoute au budget. `main` reste une clé technique du premier lieu pour les produits urbains ; ce n'est plus une source de population.

## Sources et relations

| Entrée | Influence | Stockage |
|---|---|---|
| Taille de région | Surface en km² = largeur² / 1 000 000 | `extent`, ou `options.mapSize` en taille automatique |
| Climat / biome | Productivité et conditions d'habitation | `terrain.climate`, `terrain.climateZone`, puis biome, selon `cultureEnvironment` |
| Relief | Part du territoire susceptible de soutenir l'habitat | `terrain.relief`, sinon `options.relief` |
| Côte | Facteur de surface terrestre estimée de 0,82 ; 1 sans côte | Même contexte que le choix culturel |
| Souterrain | Facteur 0,3 supplémentaire | Biome `underdark` |
| Culture | Densité de référence, résilience, niveaux d'habitat et taille automatique des lieux | `options.culture` |
| Graine des implantations | Variations de population et choix des sites isolés | Étape `settle-sites` de la graine générale |
| Densité imposée | Remplace la densité automatique, en habitants/km² ; redimensionne les lieux sans changer leur nombre | `region.demography.density` |
| Population imposée | Remplace surface × densité ; redimensionne les lieux sans changer leur nombre | `region.demography.population` |
| Effectif imposé dans le panneau | Impose le compteur choisi ; la population augmente ou diminue des habitants des lieux ajoutés ou retirés | `region.demography.counts.<classe>` pour les cinq catégories |
| Population d'un lieu imposée | Fixe sa part ; le reste du budget est distribué aux autres lieux | `local.<clé>.population` |
| Densité des bâtiments isolés | Multiplie leur cible, sans ajouter d'habitants | `region.demography.isolatedDensity` |
| Nombre de sites isolés imposé | Remplace leur cible automatique | `region.demography.isolatedCount` |
| Suivi culturel du milieu | Conserve la case cochée/décochée dans les projets et MU3 | `region.demography.followCulture` |

Ces coefficients sont des **réglages de génération de mondes**, et non des estimations historiques ou des interdictions concernant des populations réelles. Les limites culturelles ci-dessous concernent les tirages automatiques. L'utilisateur peut imposer une autre population ou une autre composition.

## Calcul de la densité

`facteur de milieu = (facteur climatique × facteur de relief)^résilience × facteur côtier × facteur souterrain`

`densité automatique = densité culturelle de référence × facteur de milieu`

`population réaliste = arrondi(surface × densité)`

### Plancher des cartes rudes

Sur une carte alpine, arctique, désertique ou souterraine, l'estimation réaliste donne parfois une poignée d'habitants (alpin, haute montagne, 10 km avec côte : 12 habitants). Une table `SETTLEMENT_FLOOR` (`regionalPopulation.ts`) fixe un minimum de lieux par largeur de carte ; elle remplace la liste automatique seulement quand la population réaliste lui est inférieure. Elle ne s'applique jamais à une population, une densité ou des effectifs imposés.

| Largeur | Lieux minimaux | Habitants |
|---|---|---:|
| < 2 km | 1 hameau, 1 ferme | ~60 |
| 2,4 km | 2 hameaux, 1 ferme | ~110 |
| 5 km | 1 village, 1 hameau, 2 fermes | ~370 |
| 10 km | 1 village, 2 hameaux, 2 fermes | ~420 |
| 20 km | 2 villages, 3 hameaux, 3 fermes | ~770 |
| 40 km | 1 bourg, 3 villages, 4 hameaux, 4 fermes | ~2 600 |
| 100 km | 3 bourgs, 6 villages, 6 hameaux, 4 fermes | ~6 600 |
| 200 km | 5 bourgs, 10 villages, 6 hameaux, 4 fermes | ~10 800 |

Plusieurs petits lieux plutôt qu'un grand : chacun demande peu de terrain plat, et le placement abaisse un lieu d'une classe s'il manque de place. Une culture sans une classe (camps) reçoit la plus grande classe qu'elle construit. Une région tempérée reste au-dessus (10 km : 750 à 6 000 habitants selon le relief).

`population automatique = max(population réaliste, plancher)`

La surface automatique sans largeur explicite vaut 40 × 40 km ; elle n'est plus calculée à partir d'une population principale. La prévision utilise les paramètres du territoire. Le placement réel reste soumis aux surfaces sèches, aux pentes, aux ressources et aux espacements : les habitants effectivement implantés sont affichés séparément.

| Climat | Facteur | Relief | Facteur |
|---|---:|---|---:|
| Tempéré | 1 | Plaine | 1 |
| Méditerranéen | 0,8 | Vallée | 0,9 |
| Continental | 0,65 | Mixte | 0,72 |
| Savane / tropical | 0,55 | Collines | 0,65 |
| Humide | 0,35 | Plateau | 0,5 |
| Steppe | 0,22 | Montagnes | 0,18 |
| Nordique | 0,12 | Canyon | 0,12 |
| Alpin | 0,08 | Volcan | 0,08 |
| Désertique | 0,035 | Caldeira | 0,22 |
| Arctique | 0,025 | Haute montagne | 0,025 |

## Profils culturels

| Profil | Densité de référence | Résilience | Maximum automatique d'un lieu | Répartition |
|---|---:|---:|---:|---|
| Historique par défaut | 75 | 1 | 300 000 | 22 % villes, 23 % bourgs, 35 % villages, 13 % hameaux, 7 % fermes |
| Moderne / futuriste | 1 200 | 0,5 | 5 000 000 | 78 % villes, 14 % bourgs, 5 % villages, 2 % hameaux, 1 % fermes |
| Très dense : highrise, megacity, arcology, cyberpunk | 3 000 | 0,5 | 5 000 000 | Comme moderne, avec de plus grandes villes de référence |
| Mobile : camps sibériens, nomades, ordu, Plaines, nordiques | 1,2 | 0,8 | 400 | Petits villages, hameaux et foyers dispersés |
| Camp inuit | 0,75 | 0,7 | 120 | 80 % hameaux, 20 % foyers ; pas de ville automatique de 5 000 habitants |
| Villages : PNW, Guarani, Iroquoiens, kraal, Budj Bim | 4 | 0,9 | 900 | 55 % villages, 35 % hameaux, 10 % fermes |
| Montagnard : nains / duergars | 50 | 0,55 | 300 000 | Répartition historique |
| Terrasses : Inca, Himalaya, Caucase, Tibet, Newar | 50 | 0,7 | 300 000 | Répartition historique |
| Dispersé : elfes, halflings, hommes-lézards, myconides | 25 | 1 | 10 000 | 10 % bourgs, 55 % villages, 25 % hameaux, 10 % fermes |

Les identifiants exacts sont résolus par `populationProfile` dans `web/src/v2/regionalPopulation.ts`. Les cultures modernes sont identifiées par `cultureEra`, et non par une recherche du mot « modern » dans leur nom.

Les parts démographiques ne doivent pas multiplier les petits lieux coûteux à construire. En automatique, les fermes isolées sont limitées à une pour 2 000 habitants (24 au maximum), et les hameaux à un pour 1 000 habitants (48 au maximum). Les habitants sont redistribués entre les lieux restants, sans réduction de la population régionale. Une culture dont les lieux sont tous petits conserve le nombre nécessaire pour loger sa population. Les effectifs explicitement imposés restent prioritaires. Une région historique ou elfique de 10 000 habitants produit ainsi au plus 5 fermes et 10 hameaux.

La construction de fond se fait par lots de huit lieux au maximum, en utilisant les quatre voies de génération du parcours « Construire les villes sélectionnées ». Les cultures agricoles, noms et affichage régionaux sont actualisés une seule fois par lot. Une annulation ou une modification de la carte rejette tout résultat tardif ; le lieu sélectionné est prioritaire dans le lot suivant.

Exemples sur **40 × 40 km avec côte**, graine `42` :

| Culture et milieu | Population régionale | Plus grand lieu | Sites isolés demandés |
|---|---:|---:|---:|
| Européen historique, plaine tempérée | 98 400 | 48 026 | 394 |
| Inuit, plaine arctique | 432 (plancher) | 120 | 1 |
| Inuit, haute montagne arctique | 432 (plancher) | 120 | 1 |
| American grid, plaine tempérée | 1 574 400 | Environ 580 000 | Selon cible et ressources |

Les populations locales varient avec la graine. Ces nombres décrivent la demande avant les refus éventuels du placement.

## Répartition et modifications

Les catégories suivent les seuils du catalogue démographique commun : fermes 1–14, hameaux 15–149, villages 150–999, bourgs 1 000–19 999, villes 20 000 et plus. La case « Villes » comprend les métropoles et mégapoles ; le moteur conserve leur classe précise.

La liste de lieux est primaire, la population en découle. Les effectifs automatiques viennent de la taille de carte, du milieu et de la culture (population automatique ci-dessus), jamais d'une population saisie.

1. Le budget de chaque catégorie de la liste automatique est déterminé par le profil culturel. Un reliquat descend vers la catégorie suivante.
2. Changer un compteur impose cette seule catégorie et change la population des habitants des lieux ajoutés ou retirés (taille moyenne de la catégorie dans la liste automatique) : ajouter un bourg ajoute ses habitants. Si une population ou une densité a été saisie, elle est corrigée du même écart. Saisir une population ou une densité redimensionne les lieux sans changer leur nombre ; un lieu change d'une classe (en sautant les classes imposées) quand la sienne ne peut plus contenir sa taille, et un lieu n'est ajouté ou retiré que si aucun changement de classe ne suffit. La liste est limitée à 1 000 lieux ; le panneau refuse un ajout qui dépasse ce total sans diminuer d'autres compteurs. Une recette partielle peut toujours imposer une seule catégorie, les autres restant automatiques.
3. Chaque lieu reçoit un poids reproductible à partir de sa clé et de `settle-sites`. Les réglages avancés de variation et de loi rang-taille peuvent modifier ces poids.
4. Les habitants sont répartis sous les planchers et plafonds des catégories. Les populations locales imposées sont fixées avant la distribution du solde.
5. La somme est exactement la population régionale lorsque les choix sont compatibles. Si les effectifs imposés exigent davantage d'habitants ou ne peuvent en contenir autant, l'interface affiche la somme répartie et l'écart ; elle n'invente pas des habitants ailleurs.
6. Une liste manuelle de lieux reste prioritaire. Modifier les contrôles régionaux réactive explicitement la distribution automatique, sans effacer la liste conservée dans la recette.

Le bouton ↶ d'un champ supprime son seul remplacement. « Rétablir la répartition automatique » supprime les remplacements démographiques, en conservant le choix de suivi culturel. Changer le milieu recalcule les valeurs automatiques et conserve les remplacements.

Le panneau regroupe les cinq catégories habitées et les bâtiments isolés dans une grille de trois colonnes sur deux rangées. Chaque carte affiche une illustration GPT Image, son libellé, son compteur et sa remise en automatique ; les explications détaillées sont repliées.

## Bâtiments isolés

Les **fermes habitées** font partie des cinq catégories d'habitat et du budget d'habitants. Les **sites isolés** sont les activités sans résidents : moulins, ateliers, carrières, sanctuaires et lieux reculés. Un site peut contenir plusieurs bâtiments ; la case règle le nombre d'implantations isolées, pas un nombre exact de toitures.

`cible = min(surface × facteur de milieu × 0,3 ; habitants répartis / 25) × facteur culturel d'activité × densité des sites isolés`

La cible est arrondie et limitée à 1 000. À partir de 15 habitants, une cible positive donne au moins un site demandé. Le facteur culturel vaut 1 par défaut, 1,8 pour les modernes, 0,12 pour les profils mobiles, 0,04 pour le camp inuit, 0,2 pour les profils de villages. Une densité explicitement nulle demande zéro site ; une région presque vide peut également en demander zéro.

Le moteur produit les sites réalisables ; une sélection stable par identifiant respecte ensuite le budget **avant** de router leurs accès. Les nœuds de route complètent le budget restant. Un site impossible faute de ressource n'est pas remplacé par un faux moulin. La densité native de fermes dispersées est désactivée dans la distribution régionale automatique pour ne pas ajouter de résidents en dehors du budget.

## MU3, sauvegarde et variantes

Le projet et le code MU3 enregistrent le contexte et les seuls remplacements : densité, population, catégories manuelles, sites isolés, suivi culturel et changements par lieu. La liste automatique calculée et les populations tirées ne sont pas sérialisées : elles sont reconstruites par `regionalPopulation` dans les workers comme dans l'interface.

Lorsque la date, l'heure et la latitude pilotent la scène, MU3 recalcule également la saison et la direction/hauteur du soleil. Il ne stocke pas une seconde copie de ces nombres flottants dérivés. Les conteneurs de noms vides ne grossissent pas le code.

`cityCodeDefaults.json` identifie le nouveau socle de recette V2 (Satellite, taille automatique régionale et absence de compteur principal). Les tables de choix gardent leur ordre. Comme les règles du projet n'exigent pas la reproduction historique entre versions de développement, une reproduction ancienne exige son snapshot source.

Le dé de Cities renouvelle les six graines urbaines du seul lieu choisi : composition, rues, parcelles, programme, bâtiments et maisons. Les graines de terrain et d'implantation restent identiques. Les habitants, la culture et les voisins restent donc identiques ; la variante urbaine voyage dans MU3.

### Priorité des modifications

Une modification en amont remplace les éditions descendantes : changer le contexte régional, la culture commune, la densité/population régionale ou ses effectifs supprime les populations/cultures particulières des lieux, leurs configurations urbaines et les éditions de bâtiments. Les cultures du monde conservé sont également actualisées, pour qu'une reconstruction utilise effectivement la nouvelle culture. Les repères libres restent conservés.

Un dé d'implantation régionale efface ces exceptions et renouvelle aussi le tirage urbain commun. Un dé local garde la population et la culture courantes de ce lieu, mais efface ses éditions de quartiers, parcelles et bâtiments avant de tirer une nouvelle variante. Modifier un quartier remplace ses éditions de parcelles et de bâtiments ; modifier une parcelle remplace ses éditions de bâtiments. Il n'y a plus de case à cocher pour activer cette propagation.

Restaurer un projet ou un MU3 complet reste une restauration exacte : ses éditions font partie de la recette et ne sont pas traitées comme des modifications en amont. Une modification ultérieure dans l'interface applique ensuite cette hiérarchie.

Le sélecteur « Architecture » n'est plus proposé par ville et son ancien remplacement local n'est plus lu par le moteur. Les villes suivent le choix commun du générateur et le style culturel ; les remplacements locaux d'architecture sont omis du code MU3.

## Fichiers et vérifications

- Modèle : `web/src/v2/regionalPopulation.ts`.
- Contrat et validation : `web/src/v2/regionSettings.ts`.
- Interface : `settlementPopulationPanel.ts` et `workbenchLayout.ts`.
- Transmission et routes : `region.ts`, `engine.ts`, `stageValidity.ts`.
- Variantes locales : `urbanSeeds.ts`, bouton `#reroll-town` dans `main.ts`.
- Code : `cityCode.ts`, `cityCodeDefaults.json`.
- Régressions : `web/tests/v2RegionalPopulation.test.ts` et le contrôle navigateur régional.
- Icônes : `web/src/v2/assets/settlement-classes-v1.png`, atlas GPT Image ; prompt voisin.
