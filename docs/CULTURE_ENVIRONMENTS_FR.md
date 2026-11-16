# Cultures, milieux et toponymes

Le tirage couvre **79 cultures pré-modernes** : 76 de surface et 3 d’Outreterre. « Médiéval » est pris au sens du monde pré-moderne du générateur : les cultures antiques, tribales et fantastiques sont incluses ; les cultures modernes, futuristes et extraterrestres sont exclues du tirage. Elles restent disponibles en sélection manuelle.

Ces niches sont des choix de création de mondes volontairement caricaturés, pas des limites historiques ou ethnographiques. Chaque culture de surface occupe au maximum trois zones climatiques ; aucune culture générique ne sert de solution de repli universelle.

## Fonctionnement

- **Follow the environment coché** : « Shared culture » présente uniquement les cultures plausibles pour le climat, le relief et la présence d’une côte. Le choix se renouvelle dès que ces conditions changent, y compris à l’entrée ou à la sortie de l’Outreterre. Changer uniquement l’étendue ne relance pas le choix culturel.
- Chaque génération complète ou génération des peuplements effectue un **tirage uniforme** dans cette liste. Un résultat identique au précédent reste possible. Les étapes de terrain seules, de routes, de construction des villes et de rendu ne relancent pas ce tirage.
- **Dé** : avec le suivi actif, tirage dans cette même liste ; sans le suivi, tirage dans les 79 cultures pré-modernes, indépendamment du milieu. Un clic évite la culture courante s’il existe une autre possibilité.
- Choisir une culture dans la liste désactive le suivi automatique. Décocher le suivi restaure le catalogue complet pour la sélection manuelle, y compris les cultures modernes et futuristes.
- **Outreterre** : en suivi automatique, seuls Drows, Duergars et Myconides sont tirés, quels que soient le climat de surface conservé et le relief.
- Le profil toponymique automatique suit la culture tirée. Les choix explicites de langue, les noms saisis et les cultures locales restent prioritaires. Les profils indiqués ci-dessous sont ceux du générateur existant, certains étant partagés par plusieurs peuples.
- Une côte est présente si son masque est non nul (ou si l’option de côte est active en l’absence de masque), et si la génération des côtes n’est pas explicitement désactivée.

Le choix final est écrit dans la recette avant la génération : les moteurs utilisent une culture concrète. Le suivi du milieu et les tirages du dé sont des commandes de l’atelier, pas un nouveau hasard interne aux moteurs. La case de suivi est cochée par défaut, y compris à la restauration d’une recette ; sa préférence n’est pas enregistrée dans les projets. Les réglages « Place names » se trouvent dans Peuplements.

## Toutes les combinaisons autorisées

**Chaque ligne autorise toutes les combinaisons de ses climats × ses reliefs**, sous réserve de la condition de côte. Toute combinaison absente est exclue du suivi automatique. Les 11 climats × 10 reliefs sélectionnables ont au moins une culture, avec ou sans côte.

Source de vérité : [environmentCultures.ts](../web/src/v2/environmentCultures.ts). Le profil de noms est défini dans [profiles.ts](../web/src/gen/names/profiles.ts).

| Culture | Zones climatiques | Reliefs | Condition | Profil de noms automatique |
| --- | --- | --- | --- | --- |
| Medieval organic (Europe) · `european-organic` | tempéré | plaine, vallée, mixte, collines, plateau | — | `french` |
| Bastide (planned grid) · `bastide` | tempéré, méditerranéen | plaine, vallée, mixte | — | `french` |
| Medina (North Africa) · `medina` | désert, méditerranéen | plaine, vallée, mixte, collines, plateau | — | `arabic` |
| Chinese walled city · `chinese` | continental, tempéré | plaine, vallée, mixte | — | `chinese` |
| Japanese castle town (jōkamachi) · `japanese-jokamachi` | tempéré | plaine, vallée, mixte, collines, plateau, montagnes, volcan, caldeira | — | `japanese` |
| Indian temple town · `indian-temple` | savane, tropical | plaine, vallée, mixte, collines, plateau | — | `sanskrit` |
| Roman castrum core · `roman-core` | méditerranéen | plaine, vallée, mixte | — | `roman` |
| Elven forest town · `elven` | tempéré, zones humides | collines, vallée, mixte, montagnes | — | `elven` |
| Dwarven hold · `dwarven` | alpin, nordique, continental | montagnes, hautes montagnes, canyon | — | `dwarven` |
| Necropolis (city of the dead) · `necropolis` | désert | collines, plateau, canyon, volcan, caldeira | — | `orcish` |
| Russian kremlin and posad · `russian-kremlin` | continental, nordique | plaine, vallée, mixte, collines, plateau | — | `russian` |
| Aztec city (Tenochtitlan) · `aztec` | tropical, savane | plaine, vallée, plateau | — | `aztec` |
| Inca city (Cusco) · `inca` | alpin, tropical | montagnes, hautes montagnes, plateau, canyon | — | `andean` |
| Byzantine hill town (Mystras) · `byzantine-greek` | méditerranéen | collines, plateau, montagnes, hautes montagnes, canyon, volcan, caldeira, vallée | — | `greek` |
| Venetian lagoon town · `venetian-lagoon` | méditerranéen, zones humides | plaine, vallée, mixte | Côte requise | `italian` |
| Persian city (Isfahan) · `persian` | désert, steppe | vallée, collines, plateau, montagnes, canyon | — | `persian` |
| Ottoman town (Bursa) · `ottoman` | méditerranéen | plaine, vallée, mixte, collines, plateau, montagnes | — | `turkish` |
| Sahelian mud town (Djenne) · `sahel` | savane, steppe | plaine, vallée, mixte | — | `sahel` |
| Hanseatic port (Lubeck) · `hanseatic` | tempéré, nordique | plaine, vallée, mixte | Côte requise | `german` |
| Korean walled town (Hanyang) · `korean` | continental | plaine, vallée, mixte, collines, plateau, montagnes | — | `korean` |
| Wizard city · `wizard-city` | continental, alpin, zones humides | collines, plateau, montagnes, hautes montagnes, canyon, volcan, caldeira | — | `elven` |
| Gnomish canal town · `gnomish` | tempéré, zones humides | plaine, vallée, mixte, collines | — | `dwarven` |
| Stilt town (marsh folk) · `stilt-town` | zones humides, tropical | plaine, vallée, mixte | — | `halfling` |
| Barbarian: Germanic village · `barbarian` | continental | plaine, vallée, mixte, collines, plateau | — | `german` |
| Barbarian: Celtic ringfort · `barbarian-celtic` | tempéré | collines, plateau, vallée | — | `celtic` |
| Barbarian: Norse farmstead cluster · `barbarian-norse` | nordique | plaine, vallée, mixte, collines, plateau, montagnes, volcan, caldeira | — | `norse` |
| Norse ring fortress (Trelleborg) · `norse-ringfort` | nordique | plaine, vallée, mixte | — | `norse` |
| Maya city (ceremonial core, sacbeob) · `maya` | tropical | plaine, vallée, mixte, collines, plateau, montagnes | — | `maya` |
| Khmer city (Angkor) · `khmer` | tropical, zones humides | plaine, vallée, mixte | — | `khmer` |
| Celtic oppidum · `celtic-oppidum` | tempéré | collines, plateau | — | `celtic` |
| Orcish war camp · `orcish` | steppe | collines, plateau, montagnes, hautes montagnes, canyon, volcan, caldeira | — | `orcish` |
| Halfling shire · `halfling` | tempéré | collines, vallée, mixte | — | `halfling` |
| Kraal (African homestead) · `kraal` | savane | plaine, vallée, mixte, collines, plateau | — | `southern-african` |
| Native American: Iroquoian longhouse village · `native-iroquoian` | continental | plaine, vallée, mixte | — | `iroquoian` |
| Native American: Pueblo · `native-pueblo` | désert | plateau, canyon, collines | — | `pueblo` |
| Native American: Plains tipi camp · `native-plains` | steppe | plaine, vallée, mixte | — | `plains` |
| Nomad camp (steppe ordu) · `nomad-camp` | steppe, désert | plaine, vallée, mixte, plateau | — | `mongolian` |
| Swahili stone town (Lamu / Zanzibar) · `swahili-stone-town` | savane, tropical | plaine, vallée, mixte, collines, plateau | Côte requise | `swahili` |
| Drow enclave · `drow-enclave` | Outreterre uniquement | Tous | — | `elven` |
| Duergar industrial hold · `duergar-hold` | Outreterre uniquement | Tous | — | `dwarven` |
| Myconid colony · `myconid-colony` | Outreterre uniquement | Tous | — | `elven` |
| Egypt · planned Nile city · `egyptian-planned` | désert | plaine, vallée | — | `egyptian` |
| Nubia · fortified town · `nubian-fortified` | désert, savane | vallée, collines, plateau | — | `nubian` |
| Mesopotamia · courtyard quarters · `mesopotamian` | désert | plaine, vallée, mixte | — | `mesopotamian` |
| Levant · fortified tell town · `levantine-tell` | méditerranéen, désert | collines, plateau | — | `levantine` |
| Central Asia · caravan oasis city · `oasis-caravan` | désert, steppe | plaine, vallée, plateau | — | `arabian` |
| Maghreb · oasis ksar · `ksar-oasis` | désert | vallée, plateau, canyon | — | `arabic` |
| Yoruba · compound town · `yoruba` | tropical, savane | plaine, vallée, mixte | — | `west-african` |
| Tibet and Ladakh · terraced settlement · `himalayan-terraces` | alpin, désert | montagnes, hautes montagnes, plateau, vallée | — | `himalayan` |
| Newar Nepal · town of ritual squares · `newar` | alpin | vallée, collines, mixte | — | `himalayan` |
| Indus · Harappan city · `indus-planned` | désert, steppe | plaine, vallée | — | `sanskrit` |
| Java · town of courts and enclosures · `javanese-courts` | tropical | plaine, vallée, mixte, collines, plateau, montagnes, volcan, caldeira | — | `javanese` |
| Mississippian · palisaded plaza centre · `mississippian` | tempéré, zones humides | plaine, vallée, mixte | — | `mississippian` |
| Al-Andalus · Iberian patio medina · `al-andalus` | méditerranéen | plaine, vallée, mixte, collines, plateau, montagnes | — | `arabic` |
| Italy · comune with piazza and towers · `italian-comune` | méditerranéen | plaine, vallée, mixte, collines, plateau, montagnes | — | `italian` |
| Flanders · cloth town with belfry · `flemish-cloth-town` | tempéré, zones humides | plaine, vallée, mixte | — | `dutch` |
| Central Europe · rynek town · `rynek-town` | continental | plaine, vallée, mixte, collines, plateau | — | `polish` |
| Slavs · palisaded gord and podgrodzie · `slavic-gord` | continental, zones humides | plaine, collines, vallée, mixte | — | `slavic` |
| Caucasus · Georgian and Armenian fortified town · `caucasian-highland` | tempéré, continental, alpin | montagnes, hautes montagnes, collines, plateau, canyon | — | `caucasian` |
| Ethiopia · highland city (Aksum, Lalibela) · `ethiopian-highland` | savane | collines, plateau, montagnes, hautes montagnes, canyon, volcan, caldeira, vallée | — | `ethiopian` |
| Zimbabwe · dry-stone enclosures · `great-zimbabwe` | savane | collines, plateau, montagnes | — | `southern-african` |
| Hausa · earth-walled city-state (Kano) · `hausa-kano` | savane, steppe | plaine, vallée, mixte, collines, plateau | — | `west-african` |
| Hadramawt · vertical city of tower houses (Shibam) · `hadhrami-tower` | désert | vallée, canyon, plateau | — | `arabian` |
| Rajputana · town below the fort (Jaisalmer, Amber) · `rajput-fort` | désert, savane | collines, plateau, montagnes | — | `sanskrit` |
| South India · temple town with concentric streets (Madurai) · `dravidian-temple` | tropical, savane | plaine, vallée, mixte | — | `dravidian` |
| Burma · royal city of Pagan · `bagan` | savane | plaine, vallée, mixte | — | `burmese` |
| Viet · citadel and merchant quarter (Thang Long) · `vietnamese-citadel` | tropical, zones humides | plaine, vallée, mixte | — | `vietnamese` |
| Tibet · hillside monastic town · `tibetan-monastery` | alpin, steppe | plaine, collines, plateau, montagnes, hautes montagnes, canyon, volcan, caldeira, vallée, mixte | — | `tibetan` |
| Mongols · ordu, princely yurt camp · `mongol-ordu` | steppe | plaine, vallée, mixte, collines, plateau, montagnes | — | `mongolian` |
| Maori · terraced fortified pa · `maori-pa` | tempéré | collines, plateau, volcan, caldeira | Côte requise | `maori` |
| Northwest Coast · plank house village · `pnw-plank-village` | tempéré, nordique | plaine, vallée, mixte, collines, plateau, montagnes | Côte requise | `pnw` |
| Arctic · Inuit winter camp · `inuit-camp` | arctique | plaine, vallée, mixte, collines, plateau, canyon | Côte requise | `inuit` |
| Siberia · reindeer herders chum camp · `siberian-camp` | arctique, nordique | plaine, vallée, mixte, collines, plateau, montagnes, canyon | — | `siberian` |
| Guarani · great house village (tekoha) · `guarani-village` | tropical | plaine, vallée, mixte, collines | — | `guarani` |
| Australia · Budj Bim stone village · `budj-bim` | tempéré, zones humides | plaine, vallée, volcan, caldeira | — | `australian` |
| Lizardfolk · stilted lake city · `lizardfolk-swamp` | zones humides, tropical | plaine, vallée, mixte | — | `orcish` |
| Merfolk · tidal shore and sea-cave village · `merfolk-tidal` | tempéré, méditerranéen, tropical | plaine, vallée, mixte, canyon | Côte requise | `elven` |
| Giants · megalithic hold · `giant-hold` | arctique, alpin | collines, plateau, montagnes, hautes montagnes, canyon, volcan, caldeira | — | `norse` |
| Goblins · hillside warren · `goblin-warren` | continental, steppe | collines, plateau, canyon, montagnes | — | `orcish` |

## Exemples de lecture

- **Désert + canyon, sans côte** : Perses, nécropole, Pueblo, ksar d’oasis et tours du Hadramawt.
- **Tropical + volcan** : cours javanaises.
- **Arctique + plaine, sans côte** : camp sibérien ; avec une côte, camp inuit également.
- **Outreterre + n’importe quel relief** : enclave drow, fort duergar ou colonie myconide.
