# Diversité des nouveaux settlements — sites d'activité, bâtiments isolés, hameaux utilitaires

*État au 3 novembre 2026, après les lots A–G (catalogue V0.2, ressources, sites d'activité, nœuds de réseau, installations, layers V2).*
Rendus : planche v7, section **« Bâtiments et hameaux utilitaires »** (https://claude.ai/artifact/Bxey8dKHg8XGfXL5zkmz71).

## 1. D'où vient la diversité

La campagne ne se limite plus aux villages et aux fermes. On y trouve aussi des **sites d'activité** : moulins, carrières, mines, salines, relais, camps de pêche, etc. Chaque site combine quatre axes indépendants, et c'est leur combinaison qui fait la variété.

| Axe | Ce qui varie | Source |
|---|---|---|
| **Gabarit de site** | 50 gabarits (ferme, moulin, mine, relais caravanier…) : bâtiments requis, bâtiments optionnels, installations au sol, accès, saisonnalité | `urban/activities.json` → `sites` |
| **Contexte ressource** | 26 potentiels (arable, water_power, ore, clay, salt_coast, fish_coast, road, crossing…) ; un site ne s'implante que là où son contexte est réuni (ET logique, `a\|b` = l'un ou l'autre) | `resources/` (géologie réalisée, sols, gisements, ancres) |
| **Culture** | 16 familles et 31 surcharges par culture : transports permis, archétypes interdits, poids de préférence | `activities.json` → `cultures` |
| **Silhouette** | 296 archétypes ramenés à 15 *looks* bâtis et 11 types de sol ; chaque look tire son toit, son avant-toit, ses étages et son emprise dans ses plages | `looks`, `ground`, `urban/massing.rs` |

Avec 50 gabarits, environ 80 cultures et des tirages adressés (graine + clé), deux moulins à eau ne se ressemblent ni d'une culture à l'autre, ni d'une rivière à l'autre.

## 2. Les gabarits par mode d'implantation

| Mode | Nb | Gabarits | Effet sur la carte |
|---|---|---|---|
| `attached_external` | 21 | petite ferme, grand domaine, pressoir/verger, vignoble, oliveraie, rizières en terrasses, enclos pastoral, scierie, mine, orpaillage, forges/fonderie, carrière, saline, moulin à eau, moulin à vent, pêche fluviale, pêche côtière, guet de colline, ferme monastique, complexe à anguilles de Budj Bim, mine naine | rattachés à un village parent, à distance de marche, sur la ressource |
| `remote_seasonal` | 7 | estive, coupe de bois, charbonnière, résine/goudron, poste de chasse, camp arctique, camp de pêche isolé | loin du parent, occupation saisonnière, servis par des sentiers |
| `network_node` | 8 | comptoir, relais routier, relais caravanier, bac, péage de pont, poste frontière, étape de pèlerinage, entrepôts andins (qollqa) | posés sur le réseau routier (carrefours, gués, longues étapes) |
| `urban_fringe` | 5 | briqueterie, poterie, foulon, tannerie, bande de fours | en lisière de ville (nuisances, eau, argile) |
| `urban_quarter` / `urban_block` / `urban_parcel` | 4 / 1 / 2 | chantier naval, quartier des tisserands, quartier portuaire, quartier des tanneurs, monastère, ateliers de village, garde-manger maori | spécialisent des quartiers ou des parcelles existants |
| `autonomous_external` | 2 | hameau myconide, hameau minier | vrais hameaux autonomes, avec leurs propres habitants |

La règle **promote** décide si le site loge du monde (`households`, `worker_households`, `resident`, `institutional`) ou reste un équipement sans habitants (`never`). C'est ce qui sépare un « bâtiment isolé » d'un « hameau utilitaire ».

## 3. Les cultures modulent le même gabarit

- **Transports.** Pas de charrettes chez les Aztèques, Mayas, Incas, peuples natifs et clans : leurs sites perdent remises à chariots, charronneries et ateliers de roues. Les nains, duergars et gobelins utilisent le halage souterrain. Venise passe par le bateau.
- **Interdits techniques.** Pas de moulin à vent au Japon, en Inde, à Java, dans le Sahel, ni dans le monde classique. Pas de moulin hydraulique dans les Andes ni en Mésoamérique. Pas de caravansérail dans le Nord ni au Japon. Pas de porcherie dans le monde islamique.
- **Préférences** (poids de 1,3 à 2,5) :
  - Flandre : tissage, teinture, foulon, séchoirs à drap (×2).
  - Hanse : entrepôts portuaires, fumoirs et saloirs.
  - Inca : greniers (×2,5) et relais.
  - Java : greniers surélevés.
  - Ksar : greniers fortifiés et puits.
  - Arctique : caches à viande et séchoirs à poisson.
  - Sibérie : abris à rennes.
  - Cité des mages : tours alchimiques.
  - Géants : magasins mégalithiques.
- **Gabarits réservés à une culture :** garde-manger maori, anguilles de Budj Bim, qollqa inca, camps arctiques inuit et sibériens, hameau myconide, mine naine et duergar.

## 4. Les silhouettes (looks)

Il y a 15 looks bâtis : hutte, appentis, long appentis, grange, entrepôt, grenier sur pilotis, moulin à eau (roue), moulin à vent, four (cheminée), halle, tour, enclos à cour, hangar à bateaux, maison sur pilotis, souterrain. S'y ajoutent 11 types de sol : aire ouverte, enclos, ouvrage hydraulique, sol industriel, débarcadère, excavation, tertre, chemin aménagé, travaux souterrains, terrasse, franchissement.

La répartition est déséquilibrée : **halle** couvre 71 archétypes, appentis 33, hutte 25 et entrepôt 24, alors que le moulin à vent, le grenier sur pilotis et la terrasse n'en ont qu'un. La variété vient donc surtout des plages de dimensions et des toits, moins de la forme.

## 5. Réseau et sentiers

- Les accès aux sites restent tous en **chemin de terre** (`track`) ou en **sentier** (`trail`), en surface `dirt`, même sur les niveaux de réseau développés. Seuls les tronçons majoritairement hors du réseau normal sont reclassés, donc une route existante ne se dégrade pas. Interrupteur : `RoadConfig.activity_access`, désactivé par défaut. Une fois activé : +262,8 km de chemins et +31,8 km de sentiers sur la carte de test.
- Les **nœuds de réseau** (relais, gués, péages, frontières) naissent des carrefours et des longues étapes du graphe routier. On en compte environ 16 sur la carte de test, pour une cible de 5 à 15.

## 6. Ce que montrent les rendus (15 sites sur 15)

Le moulin à vent et la ferme monastique avaient d'abord échoué avec « No buildings at shot ». La cause était le moteur privé de l'agent de rendu (:8792, un autre binaire). Sur le moteur principal (:8791), les deux se construisent.

| Site · culture | Rendu | Remarque |
|---|---|---|
| moulin à eau · european-organic | ✓ | bâti au bord de l'eau (2 m) |
| moulin à vent · flemish-cloth-town | ✓ | tour ronde à toit conique et grange sur une crête |
| carrière · italian-comune | ✓ | |
| mine · dwarven | ✓ | |
| forges/fonderie · barbarian-norse | ✓ | petit groupe de halles autour d'une cour, sur un chemin de terre |
| pêche côtière · norse-ringfort | ✓ | |
| camp de pêche isolé · pnw-plank-village | ✓ | |
| coupe de bois · slavic-gord | ✓ | |
| saline · venetian-lagoon | ✓ | |
| relais caravanier · ksar-oasis | ✓ | |
| ferme monastique · european-organic | ✓ | grange, magasin et hôtellerie alignés le long du chemin |
| poterie · mesopotamian | ✓ | |
| rizières en terrasses · javanese-courts | ✓ | |
| entrepôts andins · inca | ✓ | |
| relais routier · hanseatic | ✓ | |

## 7. Limites et pistes

1. ~~Moulin à vent et ferme monastique sans bâtiment~~ : corrigé (c'était un problème de moteur, pas de génération).
2. **Aucune silhouette dédiée pour les ailes du moulin à vent.** Le look `wind_mill` porte la caractéristique `sails`, mais seule la roue (`wheel`) est dessinée.
3. **Comptoir (`trade_outpost`) non implémenté** comme nœud.
4. ~~Peu de gisements, nombre dépendant de la fenêtre~~ : corrigé.
   - Les tirages sont adressés sur une grille monde de 3,84 km, donc ils restent identiques quelle que soit la fenêtre (sauf les familles liées au drainage, près des bords).
   - Les densités sont recalées : 3 → 13 gisements sur la carte de test.
   - La part de granite revient à son prior : 11,5 % → 6,2 % (prior 5,9 %).
5. **Vocabulaire de looks déséquilibré** (halle ×71). Ajouter 2 ou 3 looks (forge, séchoir, grenier fortifié) diversifierait plus que n'importe quel réglage.
6. Les sites d'activité n'ont pas encore de rendu 3D propre en dehors de la vue ville. Dans la carte V2, ils passent par les layers 2D (`res-sites`, installations).
