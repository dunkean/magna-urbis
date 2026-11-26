# Cultures, environments and place names

The draw covers **79 pre-modern cultures**: 76 surface cultures and 3 Underdark cultures. "Medieval" is taken in the generator's sense of a pre-modern world: ancient, tribal and fantasy cultures are included, while modern, futuristic and extraterrestrial cultures are excluded from the draw. They remain available through manual selection.

These niches are deliberately caricatured world-building choices, not historical or ethnographic limits. Each surface culture occupies at most three climate zones, and no generic culture serves as a universal fallback.

## How it works

- **Follow the environment** checked: "Shared culture" only offers cultures plausible for the climate, relief and presence of a coast. The choice is redrawn as soon as these conditions change, including when entering or leaving the Underdark. Changing only the extent does not trigger a new cultural choice.
- Each full generation or settlements generation performs a **uniform draw** from this list. A result identical to the previous one remains possible. The terrain-only, roads-only, city-construction and rendering steps do not trigger this draw.
- **Dice**: with tracking active, draws from this same list; without tracking, draws from all 79 pre-modern cultures, regardless of environment. One click avoids the current culture if another option exists.
- Choosing a culture from the list disables automatic tracking. Unchecking tracking restores the full catalogue for manual selection, including modern and futuristic cultures.
- **Underdark**: under automatic tracking, only Drow, Duergar and Myconids are drawn, regardless of the surface climate retained and the relief.
- The automatic toponymic profile follows the drawn culture. Explicit language choices, entered names and local cultures remain higher priority. The profiles listed below are those of the existing generator, some being shared by several peoples.
- A coast is present if its mask is non-zero (or if the coast option is active in the absence of a mask), and if coast generation is not explicitly disabled.

The final choice is written into the recipe before generation: the engines use a concrete culture. Environment tracking and dice draws are workshop commands, not a new internal randomness within the engines. The tracking checkbox is checked by default, including when a recipe is restored; this preference is not saved in projects. The "Place names" settings are found under Settlements.
## All allowed combinations

**Each row allows all combinations of its climates × its reliefs**, subject to the coast condition. Any combination not listed is excluded from automatic tracking. All 11 climates × 10 reliefs that can be selected have at least one culture, with or without coast.

Source of truth: [environmentCultures.ts](../web/src/v2/environmentCultures.ts). The name profile is defined in [profiles.ts](../web/src/gen/names/profiles.ts).

| Culture | Climate zones | Relief | Condition | Automatic name profile |
| --- | --- | --- | --- | --- |
| Medieval organic (Europe) · `european-organic` | temperate | plain, valley, mixed, hills, plateau | — | `french` |
| Bastide (planned grid) · `bastide` | temperate, Mediterranean | plain, valley, mixed | — | `french` |
| Medina (North Africa) · `medina` | desert, Mediterranean | plain, valley, mixed, hills, plateau | — | `arabic` |
| Chinese walled city · `chinese` | continental, temperate | plain, valley, mixed | — | `chinese` |
| Japanese castle town (jōkamachi) · `japanese-jokamachi` | temperate | plain, valley, mixed, hills, plateau, mountains, volcano, caldera | — | `japanese` |
| Indian temple town · `indian-temple` | savanna, tropical | plain, valley, mixed, hills, plateau | — | `sanskrit` |
| Roman castrum core · `roman-core` | Mediterranean | plain, valley, mixed | — | `roman` |
| Elven forest town · `elven` | temperate, wetlands | hills, valley, mixed, mountains | — | `elven` |
| Dwarven hold · `dwarven` | alpine, nordic, continental | mountains, high mountains, canyon | — | `dwarven` |
| Necropolis (city of the dead) · `necropolis` | desert | hills, plateau, canyon, volcano, caldera | — | `orcish` |
| Russian kremlin and posad · `russian-kremlin` | continental, nordic | plain, valley, mixed, hills, plateau | — | `russian` |
| Aztec city (Tenochtitlan) · `aztec` | tropical, savanna | plain, valley, plateau | — | `aztec` |
| Inca city (Cusco) · `inca` | alpine, tropical | mountains, high mountains, plateau, canyon | — | `andean` |
| Byzantine hill town (Mystras) · `byzantine-greek` | Mediterranean | hills, plateau, mountains, high mountains, canyon, volcano, caldera, valley | — | `greek` |
| Venetian lagoon town · `venetian-lagoon` | Mediterranean, wetlands | plain, valley, mixed | Coast required | `italian` |
| Persian city (Isfahan) · `persian` | desert, steppe | valley, hills, plateau, mountains, canyon | — | `persian` |
| Ottoman town (Bursa) · `ottoman` | Mediterranean | plain, valley, mixed, hills, plateau, mountains | — | `turkish` |
| Sahelian mud town (Djenne) · `sahel` | savanna, steppe | plain, valley, mixed | — | `sahel` |
| Hanseatic port (Lubeck) · `hanseatic` | temperate, nordic | plain, valley, mixed | Coast required | `german` |
| Korean walled town (Hanyang) · `korean` | continental | plain, valley, mixed, hills, plateau, mountains | — | `korean` |
| Wizard city · `wizard-city` | continental, alpine, wetlands | hills, plateau, mountains, high mountains, canyon, volcano, caldera | — | `elven` |
| Gnomish canal town · `gnomish` | temperate, wetlands | plain, valley, mixed, hills | — | `dwarven` |
| Stilt town (marsh folk) · `stilt-town` | wetlands, tropical | plain, valley, mixed | — | `halfling` |
| Barbarian: Germanic village · `barbarian` | continental | plain, valley, mixed, hills, plateau | — | `german` |
| Barbarian: Celtic ringfort · `barbarian-celtic` | temperate | hills, plateau, valley | — | `celtic` |
| Barbarian: Norse farmstead cluster · `barbarian-norse` | nordic | plain, valley, mixed, hills, plateau, mountains, volcano, caldera | — | `norse` |
| Norse ring fortress (Trelleborg) · `norse-ringfort` | nordic | plain, valley, mixed | — | `norse` |
| Maya city (ceremonial core, sacbeob) · `maya` | tropical | plain, valley, mixed, hills, plateau, mountains | — | `maya` |
| Khmer city (Angkor) · `khmer` | tropical, wetlands | plain, valley, mixed | — | `khmer` |
| Celtic oppidum · `celtic-oppidum` | temperate | hills, plateau | — | `celtic` |
| Orcish war camp · `orcish` | steppe | hills, plateau, mountains, high mountains, canyon, volcano, caldera | — | `orcish` |
| Halfling shire · `halfling` | temperate | hills, valley, mixed | — | `halfling` |
| Kraal (African homestead) · `kraal` | savanna | plain, valley, mixed, hills, plateau | — | `southern-african` |
| Native American: Iroquoian longhouse village · `native-iroquoian` | continental | plain, valley, mixed | — | `iroquoian` |
| Native American: Pueblo · `native-pueblo` | desert | plateau, canyon, hills | — | `pueblo` |
| Native American: Plains tipi camp · `native-plains` | steppe | plain, valley, mixed | — | `plains` |
| Nomad camp (steppe ordu) · `nomad-camp` | steppe, desert | plain, valley, mixed, plateau | — | `mongolian` |
| Swahili stone town (Lamu / Zanzibar) · `swahili-stone-town` | savanna, tropical | plain, valley, mixed, hills, plateau | Coast required | `swahili` |
| Drow enclave · `drow-enclave` | Underdark only | All | — | `elven` |
| Duergar industrial hold · `duergar-hold` | Underdark only | All | — | `dwarven` |
| Myconid colony · `myconid-colony` | Underdark only | All | — | `elven` |
| Egypt · planned Nile city · `egyptian-planned` | desert | plain, valley | — | `egyptian` |
| Nubia · fortified town · `nubian-fortified` | desert, savanna | valley, hills, plateau | — | `nubian` |
| Mesopotamia · courtyard quarters · `mesopotamian` | desert | plain, valley, mixed | — | `mesopotamian` |
| Levant · fortified tell town · `levantine-tell` | Mediterranean, desert | hills, plateau | — | `levantine` |
| Central Asia · caravan oasis city · `oasis-caravan` | desert, steppe | plain, valley, plateau | — | `arabian` |
| Maghreb · oasis ksar · `ksar-oasis` | desert | valley, plateau, canyon | — | `arabic` |
| Yoruba · compound town · `yoruba` | tropical, savanna | plain, valley, mixed | — | `west-african` |
| Tibet and Ladakh · terraced settlement · `himalayan-terraces` | alpine, desert | mountains, high mountains, plateau, valley | — | `himalayan` |
| Newar Nepal · town of ritual squares · `newar` | alpine | valley, hills, mixed | — | `himalayan` |
| Indus · Harappan city · `indus-planned` | desert, steppe | plain, valley | — | `sanskrit` |
| Java · town of courts and enclosures · `javanese-courts` | tropical | plain, valley, mixed, hills, plateau, mountains, volcano, caldera | — | `javanese` |
| Mississippian · palisaded plaza centre · `mississippian` | temperate, wetlands | plain, valley, mixed | — | `mississippian` |
| Al-Andalus · Iberian patio medina · `al-andalus` | Mediterranean | plain, valley, mixed, hills, plateau, mountains | — | `arabic` |
| Italy · comune with piazza and towers · `italian-comune` | Mediterranean | plain, valley, mixed, hills, plateau, mountains | — | `italian` |
| Flanders · cloth town with belfry · `flemish-cloth-town` | temperate, wetlands | plain, valley, mixed | — | `dutch` |
| Central Europe · rynek town · `rynek-town` | continental | plain, valley, mixed, hills, plateau | — | `polish` |
| Slavs · palisaded gord and podgrodzie · `slavic-gord` | continental, wetlands | plain, hills, valley, mixed | — | `slavic` |
| Caucasus · Georgian and Armenian fortified town · `caucasian-highland` | temperate, continental, alpine | mountains, high mountains, hills, plateau, canyon | — | `caucasian` |
| Ethiopia · highland city (Aksum, Lalibela) · `ethiopian-highland` | savanna | hills, plateau, mountains, high mountains, canyon, volcano, caldera, valley | — | `ethiopian` |
| Zimbabwe · dry-stone enclosures · `great-zimbabwe` | savanna | hills, plateau, mountains | — | `southern-african` |
| Hausa · earth-walled city-state (Kano) · `hausa-kano` | savanna, steppe | plain, valley, mixed, hills, plateau | — | `west-african` |
| Hadramawt · vertical city of tower houses (Shibam) · `hadhrami-tower` | desert | valley, canyon, plateau | — | `arabian` |
| Rajputana · town below the fort (Jaisalmer, Amber) · `rajput-fort` | desert, savanna | hills, plateau, mountains | — | `sanskrit` |
| South India · temple town with concentric streets (Madurai) · `dravidian-temple` | tropical, savanna | plain, valley, mixed | — | `dravidian` |
| Burma · royal city of Pagan · `bagan` | savanna | plain, valley, mixed | — | `burmese` |
| Viet · citadel and merchant quarter (Thang Long) · `vietnamese-citadel` | tropical, wetlands | plain, valley, mixed | — | `vietnamese` |
| Tibet · hillside monastic town · `tibetan-monastery` | alpine, steppe | plain, hills, plateau, mountains, high mountains, canyon, volcano, caldera, valley, mixed | — | `tibetan` |
| Mongols · ordu, princely yurt camp · `mongol-ordu` | steppe | plain, valley, mixed, hills, plateau, mountains | — | `mongolian` |
| Maori · terraced fortified pa · `maori-pa` | temperate | hills, plateau, volcano, caldera | Coast required | `maori` |
| Northwest Coast · plank house village · `pnw-plank-village` | temperate, nordic | plain, valley, mixed, hills, plateau, mountains | Coast required | `pnw` |
| Arctic · Inuit winter camp · `inuit-camp` | arctic | plain, valley, mixed, hills, plateau, canyon | Coast required | `inuit` |
| Siberia · reindeer herders chum camp · `siberian-camp` | arctic, nordic | plain, valley, mixed, hills, plateau, mountains, canyon | — | `siberian` |
| Guarani · great house village (tekoha) · `guarani-village` | tropical | plain, valley, mixed, hills | — | `guarani` |
| Australia · Budj Bim stone village · `budj-bim` | temperate, wetlands | plain, valley, volcano, caldera | — | `australian` |
| Lizardfolk · stilted lake city · `lizardfolk-swamp` | wetlands, tropical | plain, valley, mixed | — | `orcish` |
| Merfolk · tidal shore and sea-cave village · `merfolk-tidal` | temperate, Mediterranean, tropical | plain, valley, mixed, canyon | Coast required | `elven` |
| Giants · megalithic hold · `giant-hold` | arctic, alpine | hills, plateau, mountains, high mountains, canyon, volcano, caldera | — | `norse` |
| Goblins · hillside warren · `goblin-warren` | continental, steppe | hills, plateau, canyon, mountains | — | `orcish` |
## Reading examples

- **Desert + canyon, no coast**: Persian, necropolis, Pueblo, oasis ksar and Hadramawt towers.
- **Tropical + volcano**: Javanese courts.
- **Arctic + plain, no coast**: Siberian camp; with a coast, Inuit camp as well.
- **Underdark + any relief**: drow enclave, duergar fort or myconid colony.
