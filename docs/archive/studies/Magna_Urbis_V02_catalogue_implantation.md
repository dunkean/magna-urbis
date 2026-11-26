# Magna Urbis — bâtiments non résidentiels, sites d’activité et voies (proposition V0.2 — implantation urbaine et sites autonomes)

**247 archétypes bâtis**, **49 installations**, **50 ensembles d’activité**, **16 familles / 79 cultures**, **43 exceptions précises**.

**Avertissement** : ce document est une proposition de nouveaux types; ces bâtiments ne sont pas annoncés comme déjà générés dans le code. Les techniques doivent être filtrées par culture, époque, ressource et mode de transport.

## Principes de modélisation
Ressource → site d’activité → ensemble (bâtiments / installations) → demande de transport → réseaux → éléments fins. Un bâtiment est une géométrie bâtie, une installation est un aménagement extérieur, un site est un groupe cohérent.

## Implantation spatiale et propriétaire de la génération (V0.2)

**Ajout majeur par rapport à V0.1.** Le type d'activité ne suffit pas à décider de sa place. Le **site d'activité** porte un mode d'implantation choisi avant la création de sa géométrie; les bâtiments qu'il contient en héritent. Une scierie près d'une ville, un quartier portuaire et un camp saisonnier sont donc trois unités de génération différentes. Les `allowed_modes` du JSON sont des possibilités, jamais une obligation: elles restent contraintes par la ressource, le relief, l'eau, l'époque, la culture, la nuisance et l'accès.

### Modes d'implantation

| Mode | Générateur responsable | Règle foncière / viaire |
|---|---|---|
| `urban_parcel` | urban | Bâtiment ou micro-ensemble introduit par le programme de parcelles. Pas un nouveau settlement. |
| `urban_block` | urban | Emprise réservée avant le découpage cadastral, bâtiments résolus dans le tissu urbain. |
| `urban_quarter` | urban | Plusieurs îlots; rues et parcelles de la ville, rôle économique de quartier et gestion unique de la demande. |
| `urban_fringe` | urban | Tissu lié à la ville mais sur son bord, parfois hors les murs; relève de son programme et de ses accès. |
| `attached_external` | territory | Site distinct généré à l’échelle du territoire, relié au settlement parent; ne crée pas automatiquement des habitants. |
| `autonomous_external` | territory | Un habitat permanent/une communauté autonome avec son propre programme, voies locales et éventuellement nom/identité. |
| `remote_seasonal` | territory | Campement ou exploitation éloignée, sans population résidente permanente implicite. |
| `network_node` | network | Bac, péage, pont, relais ou passage: son emplacement est d’abord déterminé par le réseau. |

**Distinction essentielle : un site d'activité extérieur n'est PAS automatiquement un `settlement` peuplé.** La mine, le moulin ou la carrière existe en tant qu'`ActivitySite` géométriquement indépendant, doté d'un point de chargement et d'un accès. Une communauté permanente de mineurs, un village de carriers ou une abbaye habitée peuvent, sous conditions, être promus en un settlement distinct (`Kind::Hamlet`, `Kind::Camp` ou un autre petit `Kind` culturel). Une cabane de pêche saisonnière ne crée aucun ménage permanent.

Un **faubourg hors les murs appartient toujours au programme de la ville** : une implantation extérieure aux remparts n'est pas forcément un nouveau settlement. Inversement, un moulin à quelques centaines de mètres de la ville peut relever du générateur territorial même s'il dépend économiquement de la ville.

### Cas qui motivent ce découpage

| Cas | Mode proposé | Propriétaire | Conséquence |
|---|---|---|---|
| Port d’une ville | `urban_quarter` | urban | Une seule réserve de port et un seul jeu de rôles services.json. |
| Tanneurs d’une médina | `urban_quarter` | urban | La nuisance dépend de la situation hydraulique, pas d’un bannissement universel hors remparts. |
| Monastère intra-muros | `urban_block` | urban | Réutilise le landmark worship.monastery déjà assigné si présent. |
| Abbaye isolée | `attached_external` | territory | Une grange monastique annexe ne réplique pas l’abbaye. |
| Moulin à vent | `attached_external` | territory | Souvent hors de la ville, tout en dépendant de son marché. |
| Carrière de pierre | `attached_external` | territory | Le front de taille est d’abord une déformation de terrain. |
| Mine et hameau minier | `attached_external` | territory | La mine et le hameau sont deux entités reliées, non le même objet. |
| Cabanes de pêche détachées | `remote_seasonal` | territory | Peut évoluer en écart durable si ménages permanents. |
| Port de pêche urbanisé | `urban_fringe` | urban | Ne pas dupliquer urban_harbour_quarter pour la même anse. |
| Fours de potier | `urban_fringe` | urban | L’extraction d’argile peut rester un site externe. |

### Décision entre site urbain et site extérieur

1. **Le type a-t-il une emprise sur la ressource ?** Mine, carrière, moulin hydraulique, saline et exploitation forestière sont d'abord placés à leur ressource, même si celle-ci est loin de la ville. Un atelier de traitement lié à cette ressource peut, lui, être urbain.
2. **Est-il cohérent avec le tissu urbain ?** Boutique, forge ordinaire ou tissage prennent une parcelle; un grand monastère prend un îlot; les tanneurs ou le port peuvent structurer un quartier complet.
3. **La ville dispose-t-elle déjà d'un noyau de cette fonction ?** Les réserves `services.json`, les quais et monuments sont revendiqués par le site. Ne jamais instancier deux ports, deux moulins ou deux monastères pour une même demande et un même emplacement.
4. **Y a-t-il des contraintes de nuisance, d'eau, de terrain ou de dégagement ?** Fours et tanneries peuvent appartenir à un faubourg; moulin à vent dans une zone dégagée; carrière sur affleurement rocheux; la proximité d'une porte ou d'un quai n'autorise pas une géométrie impossible.
5. **Le site possède-t-il de véritables ménages résidents ?** Pas de nouveau settlement pour des ouvriers qui viennent chaque jour; création d'un hameau/colonie uniquement avec logements, population durable et desserte locale propres.

Les `service_role_claims` indiquent les rôles déjà existants dans `services.json` à **réutiliser**, non des demandes de bâtiments supplémentaires. La liste est indicative : le moteur doit effectuer une fusion par identité de site, ressource, demande et emprise.

### Propriétés spatiales à retenir

```json
{
  "activitySiteId": "quarry-045",
  "templateId": "stone_quarry",
  "placementMode": "attached_external",
  "parentSettlementId": "town-012",
  "promotedSettlementId": null,
  "resourceAnchorId": "outcrop-22",
  "districtId": null,
  "accessPorts": [{"role":"loading_yard","connectTo":"regional_road_network"}],
  "residents": 0,
  "workersDrawnFrom": ["town-012"]
}
```

`parentSettlementId` désigne une relation économique/administrative, **pas** l'inclusion dans son parcellaire. Un `promotedSettlementId` non nul implique un second objet settlement avec sa population, ses logements et sa voirie locale; il ne doit jamais dupliquer les habitants du parent.

### Ordre recommandé des générateurs

Territoire et ressources → demande économique et services existants → candidats-sites → résolution du mode d'implantation → **réservation des emprises urbaines et externes** → demandes de circulation et raccordements → parcellaire urbain / emprises rurales → nouvelles architectures fonctionnelles → état historique et détails.

Le réseau routier doit récupérer les ports d'accès de tous les sites (`portal_of_site`, `site_loading_yard`, `water_landing`, etc.) et réutiliser les tronçons communs. On conserve les classes de voies Rust, mais on distingue leurs fonctions (charroi, portage, chemin forestier, etc.) et le mode de transport réellement disponible dans la culture.

### Critères pour promouvoir une exploitation extérieure en settlement

- **Jamais par défaut** pour un moulin à vent, une carrière, une mine, une tannerie ou une pêcherie : un site indépendant peut ne contenir aucun logement.
- **Oui si résidence durable** : logements de travailleurs/familles, population comptée une seule fois, accès permanent à l'eau et aux services, réseau local ou au moins un chemin interne.
- **Communauté institutionnelle** : un monastère extra-muros peut former un domaine nommé autonome sans devenir artificiellement un village de ménages; son statut social et sa population doivent être explicites.
- **Saisonnier** : des cabanes de pêche ou un camp forestier restent des sites temporaires, même s'ils comportent dortoirs ou abris de nuit.

## Catalogue des bâtiments et des installations

### Agriculture (22)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `field_shelter` | Bâtiment | Cabane de champ | `hut` |
| `farm_workhouse` | Bâtiment | Maison de travail agricole | `workshop` |
| `barn_harvest` | Bâtiment | Grange à récoltes | `barn` |
| `barn_hay` | Bâtiment | Grange à foin | `barn` |
| `barn_tithe` | Bâtiment | Grange à dîme | `barn` |
| `granary_ground` | Bâtiment | Grenier à grains | `storehouse` |
| `granary_raised` | Bâtiment | Grenier sur pilotis ou poteaux | `raised_store` |
| `granary_fortified` | Bâtiment | Grenier fortifié | `fortified_store` |
| `seed_store` | Bâtiment | Réserve à semences | `storehouse` |
| `threshing_barn` | Bâtiment | Grange de battage | `barn` |
| `tool_shed` | Bâtiment | Remise à outils | `shed` |
| `cart_shed` | Bâtiment | Remise à charrettes | `shed` |
| `farm_warehouse` | Bâtiment | Magasin de récoltes du domaine | `storehouse` |
| `farm_steward` | Bâtiment | Loge du régisseur | `small_hall` |
| `farm_worker_hut` | Bâtiment | Cabane d'ouvriers saisonniers | `hut` |
| `orchard_shed` | Bâtiment | Remise de verger | `shed` |
| `vegetable_garden_shed` | Bâtiment | Cabane de maraîcher | `hut` |
| `hop_drying_house` | Bâtiment | Séchoir à houblon (selon région et période) | `drying_house` |
| `fruit_drying_house` | Bâtiment | Séchoir à fruits | `drying_house` |
| `date_store` | Bâtiment | Magasin de dattes | `storehouse` |
| `rice_store` | Bâtiment | Grenier à riz | `storehouse` |
| `root_crop_store` | Bâtiment | Cellier pour tubercules | `underground_store` |

### Pastoral (19)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `byre` | Bâtiment | Étable à bovins | `barn` |
| `horse_stable` | Bâtiment | Écurie | `barn` |
| `sheepfold` | Bâtiment | Bergerie | `barn` |
| `goat_shelter` | Bâtiment | Chèvrerie | `shed` |
| `pigsty` | Bâtiment | Porcherie | `shed` |
| `poultry_house` | Bâtiment | Poulailler | `hut` |
| `dovecote` | Bâtiment | Colombier ou pigeonnier | `tower` |
| `camel_stable` | Bâtiment | Abri ou cour à chameaux couverte | `shed` |
| `yak_shelter` | Bâtiment | Abri à yaks | `shed` |
| `reindeer_shelter` | Bâtiment | Abri de renne ou loge de gardien (si pertinent) | `hut` |
| `llama_shelter` | Bâtiment | Abri de troupeau andin | `shed` |
| `dairy_house` | Bâtiment | Laiterie | `small_workshop` |
| `cheese_house` | Bâtiment | Fromagerie | `small_workshop` |
| `summer_pasture_hut` | Bâtiment | Cabane d'estive ou de transhumance | `hut` |
| `shepherd_hut` | Bâtiment | Cabane de berger | `hut` |
| `fodder_barn` | Bâtiment | Fenil | `barn` |
| `animal_feed_shed` | Bâtiment | Fourrageoir couvert | `shed` |
| `veterinary_shelter` | Bâtiment | Abri de soin des bêtes | `shed` |
| `hunting_kennel` | Bâtiment | Chenil de chasse | `shed` |

### Food Processing (20)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `water_gristmill` | Bâtiment | Moulin à grain hydraulique | `water_mill` |
| `wind_gristmill` | Bâtiment | Moulin à grain à vent | `wind_mill` |
| `animal_gristmill` | Bâtiment | Moulin à traction animale | `millhouse` |
| `boat_gristmill` | Bâtiment | Moulin-bateau | `floating_mill` |
| `tidal_gristmill` | Bâtiment | Moulin à marée | `water_mill` |
| `hand_grinding_house` | Bâtiment | Atelier de mouture manuelle | `workshop` |
| `rice_pounding_shed` | Bâtiment | Abri de pilage ou décorticage du riz | `shed` |
| `oil_press_house` | Bâtiment | Moulin ou pressoir à huile | `presshouse` |
| `wine_press_house` | Bâtiment | Pressoir à raisin | `presshouse` |
| `cider_press_house` | Bâtiment | Pressoir à fruits | `presshouse` |
| `winery_cellar` | Bâtiment | Chai et cuvier | `storehouse` |
| `sugarcane_press` | Bâtiment | Moulin à canne (si culture et période compatibles) | `presshouse` |
| `brewery` | Bâtiment | Brasserie | `workshop` |
| `malt_house` | Bâtiment | Malterie | `drying_house` |
| `bakery` | Bâtiment | Boulangerie | `workshop` |
| `communal_oven_house` | Bâtiment | Four collectif couvert | `ovenhouse` |
| `smokehouse_meat` | Bâtiment | Fumoir à viande | `smokehouse` |
| `butcher_house` | Bâtiment | Boucherie et abattage | `workshop` |
| `salting_house` | Bâtiment | Atelier de salaison | `storehouse` |
| `vinegar_house` | Bâtiment | Vinaigrerie | `workshop` |

### Forestry (16)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `logger_hut` | Bâtiment | Cabane de bûcherons | `hut` |
| `forest_camp_lodge` | Bâtiment | Logis de camp forestier | `small_hall` |
| `sawpit_shelter` | Bâtiment | Abri de sciage manuel | `shed` |
| `mechanical_sawmill` | Bâtiment | Scierie hydraulique (selon technologie) | `water_mill` |
| `woodcutters_workshop` | Bâtiment | Atelier de débardage et débitage | `workshop` |
| `lumber_drying_shed` | Bâtiment | Hangar de séchage du bois | `long_shed` |
| `timber_warehouse` | Bâtiment | Entrepôt de grumes et de planches | `storehouse` |
| `charcoal_burner_hut` | Bâtiment | Cabane de charbonnier | `hut` |
| `pitch_boiling_hut` | Bâtiment | Atelier de poix et de goudron | `kiln_house` |
| `resin_collector_hut` | Bâtiment | Cabane de résinier | `hut` |
| `bark_processing_shed` | Bâtiment | Atelier d'écorçage | `shed` |
| `woodcarver_workshop` | Bâtiment | Atelier de sculpture sur bois | `workshop` |
| `ranger_lodge` | Bâtiment | Maison de garde forestier | `hut` |
| `hunting_lodge` | Bâtiment | Loge de chasse | `small_hall` |
| `beekeepers_shelter` | Bâtiment | Abri d'apiculteur forestier | `shed` |
| `rafting_shed` | Bâtiment | Abri de flottage du bois | `shed` |

### Mining (17)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `mine_head_shelter` | Bâtiment | Bâtiment de tête de puits | `mine_head` |
| `mine_adit_shelter` | Bâtiment | Abri à l'entrée de galerie | `tunnel_head` |
| `mine_winch_house` | Bâtiment | Loge de treuil et levage | `mine_head` |
| `ore_sorting_shed` | Bâtiment | Abri de tri du minerai | `shed` |
| `ore_washing_house` | Bâtiment | Laverie de minerai | `workshop` |
| `ore_crushing_house` | Bâtiment | Atelier de concassage ou broyage | `workshop` |
| `ore_storehouse` | Bâtiment | Magasin à minerai | `storehouse` |
| `mining_toolhouse` | Bâtiment | Dépôt d'outils miniers | `storehouse` |
| `mine_smithy` | Bâtiment | Forge de mine | `forge` |
| `miners_barracks` | Bâtiment | Dortoir de mineurs | `barracks` |
| `mine_overseer_house` | Bâtiment | Bureau ou loge de contremaître | `small_hall` |
| `charcoal_fuel_shed` | Bâtiment | Réserve de charbon de bois | `shed` |
| `bloomery_shelter` | Bâtiment | Abri de bas fourneau | `kiln_house` |
| `smelting_house` | Bâtiment | Maison de réduction ou fonderie | `forge` |
| `refining_workshop` | Bâtiment | Atelier d'affinage du métal | `forge` |
| `assay_house` | Bâtiment | Atelier d'essai des minerais | `workshop` |
| `mint_workshop` | Bâtiment | Atelier de frappe monétaire (sous contrôle) | `workshop` |

### Quarry Earth (15)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `quarry_tool_shed` | Bâtiment | Remise d'outils de carrière | `shed` |
| `quarry_crane_house` | Bâtiment | Abri de levage et cabestan | `shed` |
| `stonecutters_shed` | Bâtiment | Halle de taille des blocs | `long_shed` |
| `stone_store` | Bâtiment | Magasin de pierre taillée | `storehouse` |
| `limeburners_hut` | Bâtiment | Cabane du chaufournier | `hut` |
| `clay_diggers_shed` | Bâtiment | Cabane d'extraction d'argile | `shed` |
| `brick_drying_shed` | Bâtiment | Séchoir à briques crues | `long_shed` |
| `brick_kiln_house` | Bâtiment | Four à briques et abri de chauffe | `kiln_house` |
| `tileworks` | Bâtiment | Tuilerie | `kiln_house` |
| `potter_workshop` | Bâtiment | Atelier de potier | `workshop` |
| `pottery_kiln_house` | Bâtiment | Four de potier abrité | `kiln_house` |
| `glasshouse` | Bâtiment | Verrerie à four | `kiln_house` |
| `glass_annealing_house` | Bâtiment | Atelier de refroidissement du verre | `workshop` |
| `gypsum_kiln_house` | Bâtiment | Four à plâtre | `kiln_house` |
| `salt_boiling_house` | Bâtiment | Atelier de cuisson de saumure | `kiln_house` |

### Fishing Maritime (18)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `fisher_hut` | Bâtiment | Cabane de pêcheur | `hut` |
| `fish_smokehouse` | Bâtiment | Fumoir à poissons | `smokehouse` |
| `fish_salting_house` | Bâtiment | Atelier de salaison du poisson | `storehouse` |
| `fish_drying_shed` | Bâtiment | Séchoir à poissons couvert | `long_shed` |
| `net_loft` | Bâtiment | Hangar à filets | `shed` |
| `boat_house` | Bâtiment | Abri à barques ou canots | `boathouse` |
| `canoe_house` | Bâtiment | Maison à pirogues ou canots | `boathouse` |
| `shipwright_workshop` | Bâtiment | Charpenterie navale | `long_shed` |
| `boat_repair_shed` | Bâtiment | Atelier de réparation des bateaux | `long_shed` |
| `sailmakers_loft` | Bâtiment | Atelier de voilerie | `workshop` |
| `ropewalk_shed` | Bâtiment | Corderie | `long_shed` |
| `fish_oil_house` | Bâtiment | Atelier de fonte de graisse de poisson | `kiln_house` |
| `shellfish_processing_hut` | Bâtiment | Abri de cuisson et traitement des coquillages | `hut` |
| `eel_processing_house` | Bâtiment | Atelier de préparation ou conservation d'anguilles | `smokehouse` |
| `fish_merchant_store` | Bâtiment | Magasin de marchand de poissons | `storehouse` |
| `fish_market_hall` | Bâtiment | Halle au poisson | `open_hall` |
| `harbour_master_house` | Bâtiment | Loge portuaire ou capitainerie | `small_hall` |
| `beach_guard_house` | Bâtiment | Cabane de veille du rivage | `hut` |

### Water And Irrigation (9)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `waterwheel_pump_house` | Bâtiment | Maison de roue élévatrice | `water_mill` |
| `water_lifting_shed` | Bâtiment | Abri de dispositif d'irrigation | `shed` |
| `irrigation_gate_house` | Bâtiment | Loge d'éclusier ou de gardien de prise d'eau | `hut` |
| `well_house` | Bâtiment | Margelle et abri de puits | `wellhouse` |
| `cistern_house` | Bâtiment | Citerne couverte ou maison à citerne | `underground_store` |
| `fountain_house` | Bâtiment | Fontaine couverte | `pavilion` |
| `river_barge_shed` | Bâtiment | Hangar de batellerie | `boathouse` |
| `canal_warehouse` | Bâtiment | Magasin de canal | `storehouse` |
| `waterworks_keeper` | Bâtiment | Loge de responsable des canaux | `hut` |

### Crafts (17)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `smithy` | Bâtiment | Forge de village | `forge` |
| `farrier_shop` | Bâtiment | Forge de maréchal-ferrant | `forge` |
| `smith_toolshop` | Bâtiment | Atelier de taillandier | `forge` |
| `foundry` | Bâtiment | Fonderie | `forge` |
| `hydraulic_hammer_shop` | Bâtiment | Forge à martinet hydraulique | `water_mill` |
| `metalworking_shop` | Bâtiment | Atelier de chaudronnier | `workshop` |
| `locksmith_shop` | Bâtiment | Atelier de serrurier | `workshop` |
| `woodworker_shop` | Bâtiment | Menuiserie | `workshop` |
| `carpenter_shed` | Bâtiment | Charpenterie | `long_shed` |
| `wheelwright_shop` | Bâtiment | Atelier de charron | `workshop` |
| `cooper_shop` | Bâtiment | Tonnellerie | `workshop` |
| `wagon_repair_shop` | Bâtiment | Atelier de réparation de chariots | `workshop` |
| `basket_workshop` | Bâtiment | Vannerie | `workshop` |
| `mat_weaving_house` | Bâtiment | Atelier de nattes | `workshop` |
| `candlemaker_shop` | Bâtiment | Chandellerie | `workshop` |
| `soapmaker_shop` | Bâtiment | Savonnerie | `workshop` |
| `papermill` | Bâtiment | Moulin à papier (selon culture et période) | `water_mill` |

### Textile And Leather (16)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `weaving_house` | Bâtiment | Atelier de tissage | `workshop` |
| `spinning_shed` | Bâtiment | Atelier de filage | `shed` |
| `silk_reeling_house` | Bâtiment | Atelier de dévidage de la soie | `workshop` |
| `wool_washing_house` | Bâtiment | Lavoir à laine | `long_shed` |
| `fulling_mill` | Bâtiment | Moulin à foulon | `water_mill` |
| `fulling_workshop` | Bâtiment | Atelier de foulonnage manuel | `workshop` |
| `dyehouse` | Bâtiment | Teinturerie | `workshop` |
| `cloth_drying_house` | Bâtiment | Halle de séchage du drap | `long_shed` |
| `tannery` | Bâtiment | Tannerie | `industrial_yard` |
| `skin_curing_shed` | Bâtiment | Séchoir à peaux | `long_shed` |
| `leather_workshop` | Bâtiment | Corroierie | `workshop` |
| `parchment_workshop` | Bâtiment | Parcheminerie | `workshop` |
| `shoemaker_shop` | Bâtiment | Cordonnerie | `workshop` |
| `saddler_shop` | Bâtiment | Sellerie et bourrellerie | `workshop` |
| `felt_workshop` | Bâtiment | Atelier de feutre | `workshop` |
| `tailor_shop` | Bâtiment | Atelier de tailleur | `workshop` |

### Commerce Logistics (18)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `roadside_inn` | Bâtiment | Auberge de route | `courtyard_building` |
| `caravanserai` | Bâtiment | Caravansérail ou fondouk | `courtyard_compound` |
| `posting_stable` | Bâtiment | Écurie de relais | `barn` |
| `waystation` | Bâtiment | Relais de voyageurs | `small_hall` |
| `ferry_keeper_house` | Bâtiment | Maison du passeur | `hut` |
| `bridge_keeper_house` | Bâtiment | Loge de gardien de pont | `hut` |
| `tollhouse` | Bâtiment | Maison de péage | `hut` |
| `customs_house` | Bâtiment | Maison de douane | `small_hall` |
| `checkpoint_guardhouse` | Bâtiment | Poste de contrôle | `guardhouse` |
| `river_port_warehouse` | Bâtiment | Entrepôt de quai fluvial | `storehouse` |
| `sea_port_warehouse` | Bâtiment | Entrepôt du port maritime | `storehouse` |
| `merchant_store` | Bâtiment | Magasin marchand | `storehouse` |
| `salt_storehouse` | Bâtiment | Magasin de sel | `storehouse` |
| `market_hall` | Bâtiment | Halle de marché | `open_hall` |
| `weigh_house` | Bâtiment | Maison de pesée | `small_hall` |
| `porter_shelter` | Bâtiment | Abri des porteurs ou voituriers | `shed` |
| `trade_office` | Bâtiment | Bureau de comptoir marchand | `small_hall` |
| `pack_animal_shelter` | Bâtiment | Abri de bêtes de bât | `shed` |

### Civic (14)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `village_assembly_hall` | Bâtiment | Maison commune | `open_hall` |
| `public_bathhouse` | Bâtiment | Bains collectifs | `courtyard_building` |
| `public_washhouse` | Bâtiment | Lavoir couvert | `open_hall` |
| `road_hospice` | Bâtiment | Hospice de voyageurs | `small_hall` |
| `healer_house` | Bâtiment | Maison de soins | `small_hall` |
| `schoolhouse` | Bâtiment | Maison d'école | `small_hall` |
| `court_house` | Bâtiment | Maison de justice | `small_hall` |
| `public_latrine` | Bâtiment | Latrines communes | `shed` |
| `refuse_store` | Bâtiment | Dépôt couvert de déchets | `shed` |
| `cemetery_keeper_house` | Bâtiment | Loge de gardien de cimetière | `hut` |
| `fire_watch_house` | Bâtiment | Tour de guet incendie | `tower` |
| `town_maintenance_shed` | Bâtiment | Remise d'entretien des voies | `shed` |
| `public_guesthouse` | Bâtiment | Hébergement collectif | `small_hall` |
| `council_house` | Bâtiment | Maison du conseil | `open_hall` |

### Defence (11)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `watchtower` | Bâtiment | Tour de guet | `tower` |
| `signal_tower` | Bâtiment | Tour à signaux | `tower` |
| `coast_beacon_tower` | Bâtiment | Tour à feu littorale | `tower` |
| `border_guardpost` | Bâtiment | Garde-frontière | `guardhouse` |
| `rural_gatehouse` | Bâtiment | Porte défendue isolée | `gatehouse` |
| `roadblock_house` | Bâtiment | Maison de contrôle d'un passage | `gatehouse` |
| `military_barracks` | Bâtiment | Caserne | `barracks` |
| `arsenal` | Bâtiment | Magasin d'armes | `storehouse` |
| `military_stable` | Bâtiment | Écuries de garnison | `barn` |
| `fortified_outpost` | Bâtiment | Petit fort ou poste avancé | `fortified_compound` |
| `watch_hut` | Bâtiment | Guérite ou abri de surveillance | `hut` |

### Religious Funeral (18)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `wayside_shrine` | Bâtiment | Oratoire ou sanctuaire de chemin | `pavilion` |
| `hermitage` | Bâtiment | Ermitage | `hut` |
| `ceremonial_hall` | Bâtiment | Halle de cérémonie | `open_hall` |
| `temple_kitchen` | Bâtiment | Cuisine de temple | `workshop` |
| `monastery_store` | Bâtiment | Magasin de monastère | `storehouse` |
| `monastery_barn` | Bâtiment | Grange monastique | `barn` |
| `monastery_guesthouse` | Bâtiment | Hôtellerie religieuse | `small_hall` |
| `ritual_storehouse` | Bâtiment | Réserve d'offrandes | `storehouse` |
| `mortuary_house` | Bâtiment | Maison mortuaire | `small_hall` |
| `ossuary` | Bâtiment | Ossuaire | `storehouse` |
| `mausoleum` | Bâtiment | Mausolée | `pavilion` |
| `funeral_pyre_shelter` | Bâtiment | Abri pour crémation (culture compatible) | `pavilion` |
| `monastic_main_sanctuary` | Bâtiment | Grand sanctuaire d’un ensemble monastique (morphologie culturelle) | `temple_compound` |
| `monastic_dormitory` | Bâtiment | Dortoir ou cellules monastiques | `monastic_range` |
| `monastic_refectory` | Bâtiment | Réfectoire monastique | `small_hall` |
| `monastic_cloister` | Bâtiment | Cloître ou galerie autour d’une cour monastique | `courtyard_compound` |
| `monastic_infirmary` | Bâtiment | Infirmerie monastique | `small_hall` |
| `monastic_scriptorium` | Bâtiment | Atelier de copie, étude ou bibliothèque monastique (selon culture) | `workshop` |

### Fantasy Specific (17)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `dwarven_deep_smelter` | Bâtiment | Forge souterraine monumentale | `underground_hall` |
| `dwarven_ore_elevator` | Bâtiment | Maison d'ascenseur de minerai | `mine_head` |
| `elven_tree_store` | Bâtiment | Grenier arboricole | `tree_platform` |
| `elven_resin_workshop` | Bâtiment | Atelier de résines sylvestres | `tree_platform` |
| `myconid_spore_hall` | Bâtiment | Halle de culture de spores | `underground_hall` |
| `myconid_fungal_dryer` | Bâtiment | Séchoir de champignons | `workshop` |
| `goblin_scrap_forge` | Bâtiment | Forge de récupération gobeline | `tunnel_head` |
| `goblin_sorting_hall` | Bâtiment | Halle de tri de matériaux | `underground_hall` |
| `drow_silk_workshop` | Bâtiment | Atelier de soie arachnéenne | `underground_hall` |
| `arcane_alchemy_tower` | Bâtiment | Tour d'alchimie | `tower` |
| `arcane_reagent_store` | Bâtiment | Réserve de composants magiques | `storehouse` |
| `arcane_energy_house` | Bâtiment | Bâtiment de captage arcanique | `tower` |
| `giant_megalithic_store` | Bâtiment | Entrepôt mégalithique | `megalith_hall` |
| `lizardfolk_stilt_smokehouse` | Bâtiment | Fumoir sur pilotis | `stilt_house` |
| `merfolk_coral_store` | Bâtiment | Magasin marin de corail | `underwater_chamber` |
| `necropolis_bone_store` | Bâtiment | Magasin d'ossements | `underground_store` |
| `stilt_river_workshop` | Bâtiment | Atelier fluvial sur pilotis | `stilt_house` |

### Outdoor Infrastructure (49)

| ID | Type | Nom | Grammaire |
|---|---|---|---|
| `threshing_floor` | Installation | Aire de battage | `open_surface` |
| `haystack` | Installation | Meule de foin | `open_surface` |
| `animal_corral` | Installation | Corral et parc à bétail | `enclosure` |
| `pasture_fence` | Installation | Enclos de pâture | `enclosure` |
| `stock_watering_place` | Installation | Abreuvoir | `water_structure` |
| `apiary` | Installation | Rucher | `open_surface` |
| `charcoal_clamp` | Installation | Meule de charbonnage | `industrial_ground` |
| `sawpit` | Installation | Fosse de sciage | `industrial_ground` |
| `log_rafting_point` | Installation | Mise à l'eau de grumes | `landing` |
| `logging_stack` | Installation | Dépôt de grumes à ciel ouvert | `industrial_ground` |
| `open_mine_shaft` | Installation | Puits de mine ouvert | `excavation` |
| `mine_adit` | Installation | Entrée de galerie minière | `excavation` |
| `ore_washing_pit` | Installation | Bassin de lavage du minerai | `water_structure` |
| `ore_spoil_heap` | Installation | Halde à minerai ou stériles | `mound` |
| `slag_heap` | Installation | Terril de scories | `mound` |
| `open_quarry_face` | Installation | Front de carrière | `excavation` |
| `quarry_ramp` | Installation | Rampe de carrière | `engineered_path` |
| `clay_pit` | Installation | Fosse d'argile | `excavation` |
| `lime_kiln` | Installation | Four à chaux | `industrial_ground` |
| `pottery_kiln` | Installation | Four de potier extérieur | `industrial_ground` |
| `salt_pans` | Installation | Bassin de saline | `water_structure` |
| `fish_drying_racks` | Installation | Claies à poissons | `industrial_ground` |
| `fish_weir` | Installation | Pêcherie fixe à barrage | `water_structure` |
| `fish_trap` | Installation | Piège de pêche ou nasse fixe | `water_structure` |
| `eel_channels` | Installation | Canaux et nasses à anguilles | `water_structure` |
| `canoe_landing` | Installation | Débarcadère à canots | `landing` |
| `boat_ramp` | Installation | Cale de mise à l'eau | `landing` |
| `wooden_pier` | Installation | Ponton et pieux | `landing` |
| `mill_weir` | Installation | Seuil hydraulique de moulin | `water_structure` |
| `mill_leat` | Installation | Bief et canal de moulin | `water_structure` |
| `water_lift_wheel` | Installation | Noria, saqiya ou roue élévatrice | `water_structure` |
| `qanat_gallery` | Installation | Galerie drainante de qanat | `underground_work` |
| `irrigation_ditch` | Installation | Canal ou fossé d'irrigation | `water_structure` |
| `irrigated_terrace` | Installation | Terrasses irriguées | `terrace` |
| `paddy_bund` | Installation | Digues et chemins de rizière | `engineered_path` |
| `chinampa` | Installation | Jardin surélevé lacustre | `water_structure` |
| `baray_reservoir` | Installation | Grand réservoir khmer | `water_structure` |
| `kumara_storage_pit` | Installation | Fosse de stockage de kūmara | `underground_work` |
| `inuit_meat_cache` | Installation | Cache de viande surélevée | `raised_store` |
| `andean_rope_bridge` | Installation | Pont suspendu de fibres | `crossing` |
| `caravan_yard` | Installation | Cour de caravanes | `enclosure` |
| `harbour_breakwater` | Installation | Brise-lames et môle | `water_structure` |
| `sacbe_causeway` | Installation | Chaussée surélevée sacrée ou civique | `engineered_path` |
| `stone_road_stairs` | Installation | Escalier routier de pierre | `engineered_path` |
| `underground_passage` | Installation | Galerie de circulation souterraine | `underground_work` |
| `forest_trail_bridge` | Installation | Passerelle forestière | `crossing` |
| `beaver_hunt_trap` | Installation | Aménagement de piégeage | `industrial_ground` |

| `tanning_pits` | Installation | Fosses et cuves de tannage | `industrial_ground` |
| `tannery_waste_channel` | Installation | Rigole de rejet des eaux de tannerie | `water_structure` |

## Ensembles d’activité et accès

**Chaque ligne possède désormais un mode principal et des modes alternatifs contrôlés.** `urban_quarter` et `urban_fringe` restent dans la ville, alors que `attached_external` et `remote_seasonal` sont générés par le territoire. `autonomous_external` exige une validation résidentielle (ou une communauté institutionnelle reconnue), pas seulement une activité ou un hangar.

| Site | Mode principal | Autres modes possibles | Condition / ancrage | Bâtiments obligatoires | Accès min. | Promotion |
|---|---|---|---|---|---|---|
| `small_farm` | `attached_external` | `urban_fringe`, `autonomous_external` | `productive_fields` | `barn_harvest`, `tool_shed` | `track` | `if_permanent_households` |
| `large_estate` | `attached_external` | `autonomous_external`, `urban_fringe` | `estate_lands` | `barn_harvest`, `barn_hay`, `farm_steward`, `granary_ground` | `local` | `if_permanent_households` |
| `orchard_press` | `attached_external` | `urban_fringe` | `orchard_crops` | `orchard_shed`, `fruit_drying_house` | `track` | `never` |
| `vineyard` | `attached_external` | `urban_fringe` | `vineyards` | `wine_press_house`, `winery_cellar` | `track` | `never` |
| `olive_estate` | `attached_external` | `urban_fringe` | `olive_groves` | `oil_press_house`, `granary_ground` | `track` | `if_permanent_households` |
| `rice_terraces` | `attached_external` | `urban_fringe`, `autonomous_external` | `irrigated_land` | `rice_store`, `rice_pounding_shed` | `track` | `if_permanent_households` |
| `pastoral_enclosure` | `attached_external` | `urban_fringe`, `remote_seasonal` | `pasture_water` | `sheepfold` | `track` | `if_permanent_households` |
| `seasonal_upland_pasture` | `remote_seasonal` | `attached_external` | `upland_grazing` | `summer_pasture_hut` | `trail` | `if_permanent_households` |
| `forest_logging` | `remote_seasonal` | `attached_external`, `autonomous_external` | `timber_stand` | `logger_hut`, `sawpit_shelter` | `track` | `if_permanent_households` |
| `forest_charcoal` | `remote_seasonal` | `attached_external` | `forest_fuel` | `charcoal_burner_hut` | `trail` | `never` |
| `forest_sawmill` | `attached_external` | `urban_fringe` | `forest_and_water_power` | `mechanical_sawmill` | `track` | `if_permanent_households` |
| `resin_tar` | `remote_seasonal` | `attached_external` | `resinous_forest` | `resin_collector_hut` | `trail` | `never` |
| `hunting_post` | `remote_seasonal` | `attached_external` | `game_habitat` | `hunting_lodge` | `trail` | `never` |
| `hardrock_mine` | `attached_external` | `autonomous_external` | `ore_deposit` | `mine_adit_shelter`, `ore_sorting_shed` | `track` | `if_permanent_worker_households` |
| `alluvial_workings` | `attached_external` | `remote_seasonal` | `alluvial_ore` | `ore_washing_house` | `trail` | `if_permanent_worker_households` |
| `smelter_cluster` | `attached_external` | `urban_fringe`, `autonomous_external` | `fuel_ore_water_if_needed` | `bloomery_shelter`, `charcoal_fuel_shed` | `track` | `if_permanent_worker_households` |
| `stone_quarry` | `attached_external` | `autonomous_external` | `exposed_stone` | `stonecutters_shed`, `quarry_tool_shed` | `track` | `if_permanent_worker_households` |
| `clay_brickyard` | `urban_fringe` | `attached_external` | `clay_and_fuel` | `brick_drying_shed`, `brick_kiln_house` | `track` | `never` |
| `pottery_cluster` | `urban_fringe` | `urban_quarter`, `attached_external` | `clay_fuel_and_market` | `potter_workshop`, `pottery_kiln_house` | `track` | `if_permanent_worker_households` |
| `saltworks` | `attached_external` | `autonomous_external`, `remote_seasonal` | `saline_or_salt_bearing_ground` | `salt_boiling_house` | `track` | `if_permanent_worker_households` |
| `river_watermill` | `attached_external` | `urban_fringe`, `urban_block` | `river_drop_and_channel` | `water_gristmill` | `track` | `never` |
| `windmill_site` | `attached_external` | `urban_fringe` | `wind_exposed_clear_ground` | `wind_gristmill` | `track` | `never` |
| `riverside_fulling` | `urban_fringe` | `urban_quarter`, `attached_external` | `water_and_textile_supply` | `fulling_mill` | `track` | `never` |
| `riverside_tannery` | `urban_fringe` | `urban_quarter`, `attached_external` | `water_and_waste_route` | `tannery`, `skin_curing_shed` | `track` | `never` |
| `river_fishing` | `attached_external` | `remote_seasonal`, `urban_fringe` | `fishable_river_access` | `fisher_hut`, `fish_smokehouse` | `trail` | `if_permanent_households` |
| `coastal_fishing` | `attached_external` | `autonomous_external`, `urban_fringe`, `remote_seasonal` | `sheltered_landing_and_fishery` | `fisher_hut`, `boat_house`, `net_loft` | `track` | `if_permanent_households` |
| `shipyard` | `urban_quarter` | `urban_fringe`, `attached_external` | `navigable_water_and_slipway` | `shipwright_workshop`, `boat_repair_shed` | `local` | `if_permanent_worker_households` |
| `trade_outpost` | `network_node` | `attached_external`, `autonomous_external` | `trade_corridor` | `merchant_store`, `trade_office` | `local` | `if_permanent_households` |
| `road_waystation` | `network_node` | `attached_external`, `autonomous_external` | `through_road_and_stop` | `waystation`, `roadside_inn` | `local` | `if_permanent_households` |
| `caravan_waystation` | `network_node` | `attached_external`, `autonomous_external` | `caravan_route_and_water` | `caravanserai`, `pack_animal_shelter` | `local` | `if_permanent_households` |
| `ferry_crossing` | `network_node` | `urban_fringe`, `attached_external` | `necessary_water_crossing` | `ferry_keeper_house` | `track` | `if_permanent_households` |
| `bridge_toll` | `network_node` | `urban_fringe`, `urban_block` | `bridged_crossing` | `tollhouse` | `local` | `never` |
| `border_outpost` | `network_node` | `attached_external`, `autonomous_external` | `controlled_boundary` | `border_guardpost`, `checkpoint_guardhouse` | `local` | `if_permanent_households` |
| `hill_watch` | `attached_external` | `urban_fringe`, `remote_seasonal` | `viewshed_and_line_of_sight` | `watchtower` | `trail` | `never` |
| `village_workshops` | `urban_parcel` | `urban_block` | `residential_demand` | `smithy`, `woodworker_shop` | `local` | `never` |
| `weavers_district` | `urban_quarter` | `urban_fringe` | `textile_trade_and_labor` | `weaving_house`, `spinning_shed` | `local` | `never` |
| `monastic_farm` | `attached_external` | `autonomous_external`, `urban_fringe` | `monastic_land_and_arable_ground` | `monastery_barn`, `monastery_store` | `track` | `if_permanent_households` |
| `pilgrimage_stop` | `network_node` | `urban_fringe`, `attached_external`, `autonomous_external` | `pilgrimage_route` | `wayside_shrine`, `road_hospice` | `trail` | `if_permanent_households` |
| `maori_food_store` | `urban_parcel` | `urban_block`, `attached_external` | `local_crop_and_storage` | `granary_raised`, `root_crop_store` | `trail` | `never` |
| `budj_bim_eel_complex` | `attached_external` | `urban_fringe`, `autonomous_external` | `wetland_water_control` | `eel_processing_house` | `trail` | `if_permanent_households` |
| `andean_storeway` | `network_node` | `attached_external`, `autonomous_external` | `road_and_storage_hub` | `granary_ground`, `waystation` | `trail` | `if_permanent_households` |
| `arctic_hunting_camp` | `remote_seasonal` | `autonomous_external` | `seasonal_game_or_fish` | `fisher_hut` | `trail` | `if_permanent_households` |
| `fantasy_fungal_hamlet` | `autonomous_external` | `urban_fringe`, `attached_external` | `subterranean_fungal_resource` | `myconid_spore_hall`, `myconid_fungal_dryer` | `trail` | `if_permanent_households` |
| `fantasy_dwarven_mine` | `attached_external` | `autonomous_external`, `urban_quarter` | `mountain_ore_and_tunnel` | `dwarven_deep_smelter`, `dwarven_ore_elevator` | `track` | `if_permanent_worker_households` |
| `urban_harbour_quarter` | `urban_quarter` | `urban_block`, `urban_fringe` | `quay_and_navigable_water` | choix parmi groupe | `local` | `never` |
| `tanners_quarter` | `urban_quarter` | `urban_fringe` | `settlement_water_and_effluent` | `tannery` | `local` | `never` |
| `monastery_compound` | `urban_block` | `urban_quarter`, `attached_external`, `autonomous_external` | `religious_community_and_reserve` | `monastic_dormitory`, `monastic_refectory` | `trail` | `if_institutional_residents` |
| `detached_fishing_camp` | `remote_seasonal` | `attached_external`, `autonomous_external` | `discrete_fishable_landing` | `fisher_hut` | `trail` | `if_permanent_households` |
| `urban_kilns_strip` | `urban_fringe` | `attached_external`, `urban_quarter` | `clay_fuel_and_exhaust_space` | choix parmi groupe | `track` | `never` |
| `mining_workers_hamlet` | `autonomous_external` | — | `existing_mine_plus_permanent_housing` | aucun | `track` | `already_residential` |

**Notes de placement remarquables :**

- **`small_farm`** — ferme de desserte si proche du village; vrai hameau si plusieurs ménages agricoles permanents.
- **`large_estate`** — un domaine rural reste une unité autonome; son village de tenanciers n’apparaît que si les ménages sont explicitement modélisés.
- **`forest_logging`** — camp temporaire dans les coupes; hameau de scieurs possible si exploitation pérenne et résidents.
- **`hardrock_mine`** — la mine elle-même est un site territorial, non un hameau; un hameau de mineurs exige logements et services.
- **`stone_quarry`** — carrière creusée dans la roche; son front de taille ne doit pas devenir un îlot de ville; habitat de carriers séparé si durable.
- **`river_watermill`** — au bord de la rivière, parfois dans un faubourg ou contre un îlot; le bief traverse les limites administratives.
- **`windmill_site`** — terrain ouvert au vent et libre autour des ailes; hors tissu dense même s’il dépend d’une ville.
- **`riverside_tannery`** — la tannerie peut occuper des parcelles de quartier urbain ou un faubourg riverain; éviter les zones d’approvisionnement en eau propre.
- **`coastal_fishing`** — port de pêche connecté à la ville ou noyau côtier indépendant; les simples cabanes détachées relèvent de detached_fishing_camp.
- **`shipyard`** — un chantier peut être dans le quartier du port ou hors murs; son accès au rivage et sa cour de stockage priment.
- **`weavers_district`** — réserve de quartier et parcelles multiples, pas une entité-commune en plus de la ville.
- **`monastic_farm`** — dépendance agricole d’une institution religieuse; ne pas dupliquer le monastère principal.
- **`budj_bim_eel_complex`** — système hydraulique sur un territoire, parfois en contact avec l’habitat mais pas un seul bâtiment.
- **`fantasy_dwarven_mine`** — mine près d’une ville souterraine = quartier industriel possible; hors ville = complexe minier raccordé par galerie.
- **`urban_harbour_quarter`** — réutiliser les quais et bâtiments portuaires réservés par la ville; pas de second port autonome au même rivage.
- **`tanners_quarter`** — médina: quartier dédié de plusieurs ateliers, souvent près d’un accès à l’eau; d’autres cultures peuvent privilégier un faubourg.
- **`monastery_compound`** — intra-muros = îlot/enclos du programme urbain; extra-muros = site territorial religieux, settlement autonome seulement avec communauté résidente.
- **`detached_fishing_camp`** — un abri de pêche distant du village est un site saisonnier ou annexe, pas un quartier du port.
- **`urban_kilns_strip`** — les fours lourds occupent des parcelles spécialisées ou la frange urbaine; les fosses d’argile restent liées au gisement.
- **`mining_workers_hamlet`** — à créer seulement après identification de ménages permanents; maisons résolues par le générateur de logements culturel existant.

**Compatibilité géométrique :** les nouveaux sites `urban_harbour_quarter`, `tanners_quarter` et `monastery_compound` nécessitent la réservation de surfaces propres dans la ville. Les sites `detached_fishing_camp`, `mining_workers_hamlet` et `urban_kilns_strip` comblent respectivement l'isolement côtier, la résidence minière et les fours de périphérie. Les dépendances listées comme facultatives ne doivent pas devenir obligatoires dans toutes les cultures et à toutes les échelles.

## Cultures

| Famille | Cultures V2 | Déclinaison |
|---|---|---|
| `european` | `european-organic`, `bastide`, `hanseatic`, `venetian-lagoon`, `halfling`, `byzantine-greek`, `russian-kremlin`, `italian-comune`, `flemish-cloth-town`, `rynek-town`, `slavic-gord`, `caucasian-highland` | Granges et forges rurales; architecture de cour/longère; mills selon conditions; trafic de charrois. |
| `islamic` | `medina`, `persian`, `ottoman`, `ksar-oasis`, `oasis-caravan`, `swahili-stone-town`, `sahel`, `al-andalus`, `hausa-kano`, `hadhrami-tower` | Cours et greniers; gestion de l’eau, huileries, salines et relais caravaniers selon région; transport de bât. |
| `chinese` | `chinese`, `korean`, `vietnamese-citadel` | Rizières, canaux, greniers, meuneries, ateliers de papier ou de soie selon époque et milieu. |
| `japanese` | `japanese-jokamachi` | Greniers à riz, kura, travail du bois, brasserie, moulins, pêche; accès piétons et voie d’eau. |
| `indian` | `indian-temple`, `khmer`, `himalayan-terraces`, `newar`, `rajput-fort`, `dravidian-temple`, `bagan`, `tibetan-monastery` | Rizières ou culture sèche selon biome; huileries, puits, ghats, tanks, textiles. |
| `insular` | `javanese-courts` | Greniers surélevés, rizières, ateliers; accès de digue et voie d’eau. |
| `mesoamerican` | `aztec`, `maya` | Obsidienne, maïs, poteries, marchés; chinampas si contexte lacustre; pas de charrois lourds par défaut. |
| `andean` | `inca` | Qullqa, tambo, terrasses et canaux; circulation humaine et caravanes de lamas, marches et ponts de corde. |
| `norse` | `barbarian`, `barbarian-celtic`, `barbarian-norse`, `norse-ringfort`, `celtic-oppidum`, `orcish` | Pêche, salaisons, boathouses, forges, bois, extraction, estives selon région. |
| `steppe` | `nomad-camp`, `mongol-ordu` | Tentes mobiles, enclos, dépôts démontables, points d’eau; pistes de transhumance. |
| `african` | `yoruba`, `kraal`, `ethiopian-highland`, `great-zimbabwe` | Greniers, enclos, champs et forges; grandes différences entre Sahel, Hauts Plateaux, forêt et Zimbabwe. |
| `native` | `native-iroquoian`, `native-plains`, `native-pueblo`, `mississippian` | Séchage et stockage, canots, poterie ou taille de pierre selon culture; ni chevaux ni roues universels. |
| `clan` | `maori-pa`, `pnw-plank-village`, `inuit-camp`, `siberian-camp`, `guarani-village`, `budj-bim` | Familles contrastées : canots, fumage, caches arctiques, stockage maori, aquaculture Budj Bim. |
| `classical` | `roman-core` | Horrea, foulonneries, tabernae, moulins et grands établissements; viae et voies de halage. |
| `ancient` | `egyptian-planned`, `nubian-fortified`, `mesopotamian`, `levantine-tell`, `indus-planned` | Greniers, fours, briques, canaux et institutions dépendant de l’époque et des techniques. |
| `fantasy` | `lizardfolk-swamp`, `merfolk-tidal`, `giant-hold`, `goblin-warren`, `elven`, `dwarven`, `wizard-city`, `gnomish`, `drow-enclave`, `duergar-hold`, `myconid-colony`, `necropolis`, `stilt-town` | Ne doit pas être un seul profil fonctionnel : chaque culture fantastique a des infrastructures propres. |

### Exceptions par culture

| ID | Spécificité |
|---|---|
| `venetian-lagoon` | Darses, ateliers de bateaux, entrepôts sur canaux; circulation nautique prioritaire. |
| `hanseatic` | Poisson fumé/séché, hangars et entrepôts maritimes, chantiers navals. |
| `flemish-cloth-town` | Tissage, teinturerie, foulonnerie et séchoirs à drap. |
| `italian-comune` | Vigne/huile/soie selon région, ateliers, moulins sur canaux, magasins marchands. |
| `caucasian-highland` | Bergeries, granges en terrasses, tours de contrôle, sentiers de bât. |
| `ksar-oasis` | Grenier collectif, puits, jardins irrigués, palmeraies, canaux et chemins de bât. |
| `oasis-caravan` | Relais caravaniers, citernes, enclos à bêtes de bât, stockage. |
| `hausa-kano` | Greniers à céréales, teintureries en fosses et cours de travail, travail du cuir. |
| `swahili-stone-town` | Cales, abris à bateaux de commerce, magasins, transformation du poisson, fours à chaux corallienne. |
| `hadhrami-tower` | Greniers dans bâtiments-tours et terrasses; transport de bât, limitation des grands charrois. |
| `ethiopian-highland` | Greniers, zones de battage, écuries, terrasses et ateliers ruraux. |
| `great-zimbabwe` | Enclos, troupeaux, stockage de grain, ateliers et extraction régionale de pierre. |
| `vietnamese-citadel` | Paddy, greniers, ateliers de bateau fluvial, canaux et digues. |
| `khmer` | Baray, canaux, rizières, greniers et chaussées aménagées selon contexte. |
| `javanese-courts` | Rizières, greniers surélevés et ateliers de transformation; dalles et digues. |
| `bagan` | Petits greniers et ateliers de terre cuite; chemins vers les complexes cultuels. |
| `rajput-fort` | Puits, tanks, carrières et postes de surveillance liés au fort. |
| `mongol-ordu` | Enclos mobiles, haltes d’eau, dépôts temporaires, pistes cavalières; capitale stable à part. |
| `maori-pa` | Pātaka, fosses à kūmara, abris à waka; chemins de terrasse vers les zones de culture. |
| `pnw-plank-village` | Fumoirs, claies à saumon, hangars à canots, stockage dans les maisons de planches. |
| `inuit-camp` | Caches de viande, équipement de chasse, shelters saisonniers; routes de glace/traîneaux dépendantes de la saison. |
| `siberian-camp` | Caches et séchoirs, campements saisonniers, chemins de migration; variantes forêt/toundra. |
| `guarani-village` | Jardins, entrepôts modestes, artisanat et chemins vers cultures et eau. |
| `budj-bim` | Chenal et pièges à anguilles, réserves et fumage; réseaux de digues et chemins en terrain volcanique. |
| `native-plains` | Installations de chasse et séchage; chevaux seulement si époque post-contact explicitement activée. |
| `native-iroquoian` | Greniers à maïs, abris de récolte, claies et palissades. |
| `native-pueblo` | Greniers, réserves, ateliers potiers et chemins en terrasse. |
| `inca` | Qullqa et tambo, corrals à lamas, terrasses, ponts de corde; parcours de portage sans charrois. |
| `aztec` | Chinampas et débarcadères si eau adaptée, marché, ateliers d’obsidienne. |
| `maya` | Chaussées sacbé, réservoirs, ateliers de pierre et d’obsidienne selon disponibilité. |
| `dwarven` | Galeries, halls de forge, puits de levage, ventilation et larges chemins de mine souterrains. |
| `duergar-hold` | Mines et forges souterraines avec postes fortifiés. |
| `drow-enclave` | Circulation souterraine, ateliers de soie et ponts verticaux. |
| `gnomish` | Ateliers compacts, roues et mécanismes miniaturisés. |
| `elven` | Pépinières et ateliers arboricoles, passerelles de canopée et voies suivant les courbes de niveau. |
| `myconid-colony` | Halles fongiques, séchoirs et réserves de spores en sous-sol. |
| `goblin-warren` | Galeries, petites forges et dépôts de récupération; pistes en lacets. |
| `giant-hold` | Greniers mégalithiques, halls et ateliers surdimensionnés, voies de grande emprise. |
| `lizardfolk-swamp` | Fumoirs et ateliers sur pilotis, passerelles et chenaux. |
| `merfolk-tidal` | Réserves sous-marines ou de marée, débarcadères et chemins aquatiques. |
| `necropolis` | Ossuaires, ateliers funéraires, dépôts d’offrandes et accès processionnels. |
| `stilt-town` | Ateliers et greniers sur pilotis, cheminements sur passerelles. |
| `wizard-city` | Ateliers d’alchimie, réserves de composants et observatoires, circulations protégées. |

## Grammaires morphologiques

- **`hut`** — Cabane unique, petite toiture simple ou cône, cour limitée.
- **`shed`** — Abri ouvert ou semi-ouvert, stockage et manutention.
- **`long_shed`** — Long bâtiment de travail, éclairage latéral, grandes portes.
- **`barn`** — Grand volume à portes charretières ou agricoles.
- **`raised_store`** — Stockage sur pilotis/poteaux, accès par échelle ou escalier.
- **`water_mill`** — Bâtiment accolé à roue/canal, prise et rejet d’eau, machinerie.
- **`wind_mill`** — Tour ou moulin sur pivot avec ailes, emprise dégagée au vent.
- **`forge`** — Foyer(s), cheminée(s), espaces de charbon et travail du métal.
- **`kiln_house`** — Four massif, zone de chauffe et stockage combustible.
- **`mine_head`** — Tête de puits, éventuel treuil, zone de stockage/manutention.
- **`tunnel_head`** — Entrée de galerie et façade/structure de soutènement.
- **`boathouse`** — Bâtiment longitudinal à grande ouverture vers eau.
- **`courtyard_compound`** — Plusieurs corps et cour pour voyageurs, marchandises et animaux.
- **`industrial_yard`** — Plusieurs cuves et abris associés sur une parcelle ouverte.
- **`stilt_house`** — Volumes sur pieux, passerelles d’accès et pontons.
- **`underground_hall`** — Halle excavée avec galeries et supports rocheux.
- **`tree_platform`** — Plateforme arboricole reliée par passerelles.
- **`open_hall`** — Halle sur poteaux ou colonnes, parois ouvertes.
- **`storehouse`** — Bâtiment de stockage opaque, accès de charge.
- **`smokehouse`** — Petit bâtiment de fumaison ventilé avec foyer.
- **`presshouse`** — Halle avec machine/levier de pressurage et cour de réception.
- **`wellhouse`** — Couverture de puits avec dispositif de puisage.
- **`underground_store`** — Cave, fosse ou entrepôt partiellement creusé.
- **`fortified_store`** — Magasin collectif protégé par murs ou enceinte.
- **`floating_mill`** — Barge porteuse de mécanisme, amarrage et passerelle.
- **`megalith_hall`** — Volume à très grande portée et accès surdimensionnés.

- **`temple_compound`** — Sanctuaire distinct du bâti domestique; cours et corps principaux selon tradition, sans imposer une église chrétienne.

- **`monastic_range`** — Long corps d’hébergement institutionnel à cellules ou dortoir selon culture; accès à cour/galerie.

## Règles de génération

Les règles d’implantation précédentes s’appliquent en plus des contraintes de géométrie et de ressources.

1. Ne pas mettre de moulin hydraulique sans débit et dénivelé utilisables.
2. Ne pas mettre de mine sans gisement ou contexte fantasy explicite.
3. Un site lourd doit être accessible aux moyens de transport réellement disponibles.
4. Les chemins relient le portail de l’ensemble, pas le centroïde du toit.
5. Les installations en plein air ne sont pas rendues comme des maisons.
6. Le choix culturel conditionne les technologies et le mode de transport, pas uniquement les textures.
7. Garder une génération déterministe à tout niveau de zoom.
8. Ne pas créer de routes en double; les tronçons communs sont mutualisés.
9. L’éligibilité historique et technique est à ajouter séparément, cette nomenclature ne certifie pas les traditions historiques.
10. Une activité n’est instanciée qu’une fois entre services.json, programme de quartier et site territorial.
11. Une activité urbaine réserve son quartier ou îlot avant la génération des parcelles et des bâtiments.
12. Une exploitation externe est un activity site distinct et ne doit pas automatiquement générer un settlement habité.
13. Promouvoir un site en settlement seulement avec population résidente, habitat et réseau local; ne pas créer des travailleurs fictifs.
14. Ne pas placer une carrière en îlot urbain par défaut; les matériaux peuvent être traités et stockés en ville.
15. Les ports, ports de pêche et pontons isolés peuvent partager un littoral sans être un même objet urbain.
16. Un monastère et ses granges dépendantes sont liés mais ne constituent pas un seul site géométrique.
17. Classer les sites par mode urbain/externe avant de générer les voies de desserte pour conserver les frontières d’urbanisation.

## Notes d’implémentation

- Les classes de routes `highway/main/local/track/trail` et les profils culturels existent déjà en Rust. L’`importance` d’une route industrielle doit venir aussi du tonnage, du trafic et du mode de transport, pas seulement de la population.
- Les rôles de `services.json` et les nouveaux sites d’activité sont deux objets différents; éviter d’ajouter le même moulin une fois en ville et une fois par la couche économique.
- Les bâtiments de chantier (fours, granges, ateliers) doivent générer leur géométrie propre et non une simple maison avec une étiquette.
- Les installations extérieures (carrières, terrils, biefs, claies, nasses) sont prioritaires visuellement: elles rendent les fonctions lisibles à l’échelle cartographique.
- Les contraintes exactes par époque/région sont à compléter avant un mode strict historiquement sourcé.

## Liens au dépôt

- [Services urbains existants](https://github.com/dunkean/magna-urbis/blob/main/rust/crates/core/src/urban/services.json)
- [Routes régionales](https://github.com/dunkean/magna-urbis/blob/main/rust/crates/core/src/settlements/roads/profile.rs)
- [Typologies de fermes](https://github.com/dunkean/magna-urbis/blob/main/web/src/gen/landuse/farms.ts)
- [Catalogue historique existant](https://github.com/dunkean/magna-urbis/blob/main/docs/catalogue_settlements_antiquite_moyen_age_rpg_FR.md)
