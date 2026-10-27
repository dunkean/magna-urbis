import { savedLocale } from './shellLocale';
import { houseAtlasEnglish } from './houseAtlasEnglish';
import { houseArchetypeTranslations } from './houseArchetypeTranslations';
import { houseAtlasEnglishDetails } from './houseAtlasEnglishDetails';
import { houseAtlasEnglishPhrases } from './houseAtlasEnglishPhrases';
import { houseAtlasTranslatedDetails } from './houseAtlasTranslatedDetails';

type Translations = [string, string, string, string]; // English, Chinese, Spanish, Portuguese
const packs: Record<string, Translations> = {
  'MED-ANT':['Ancient Mediterranean — Greece, Rome, Phoenicia and Etruria','古代地中海——希腊、罗马、腓尼基与伊特鲁里亚','Mediterráneo antiguo — Grecia, Roma, Fenicia y Etruria','Mediterrâneo antigo — Grécia, Roma, Fenícia e Etrúria'],
  'ATL-CEL':['Atlantic and Celtic Europe — Iron Age, castros and oppida','大西洋沿岸与凯尔特欧洲——铁器时代、城寨与城镇','Europa atlántica y celta — Edad del Hierro, castros y oppida','Europa atlântica e celta — Idade do Ferro, castros e oppida'],
  'EUR-MED':['Medieval western and central Europe','中世纪西欧与中欧','Europa occidental y central medieval','Europa ocidental e central medieval'],
  'EUR-NOR':['Scandinavia, Iceland, Baltic and medieval Norse world','斯堪的纳维亚、冰岛、波罗的海与中世纪北欧','Escandinavia, Islandia, Báltico y mundo nórdico medieval','Escandinávia, Islândia, Báltico e mundo nórdico medieval'],
  'EUR-EAST':['Eastern Europe, Byzantium, Balkans and Caucasus','东欧、拜占庭、巴尔干与高加索','Europa oriental, Bizancio, Balcanes y Cáucaso','Europa oriental, Bizâncio, Bálcãs e Cáucaso'],
  'AF-NILE':['Nile Valley — Egypt, Nubia and Meroë','尼罗河谷——埃及、努比亚与麦罗埃','Valle del Nilo — Egipto, Nubia y Meroe','Vale do Nilo — Egito, Núbia e Méroe'],
  'AF-MAG':['Maghreb, Atlas, pre-Saharan oases and Sahara','马格里布、阿特拉斯山、撒哈拉前缘绿洲与撒哈拉','Magreb, Atlas, oasis presaharianos y Sáhara','Magrebe, Atlas, oásis pré-saarianos e Saara'],
  'AS-MIDE':['Mesopotamia, Levant, southern Anatolia, Arabia and Iran','美索不达米亚、黎凡特、安纳托利亚南部、阿拉伯与伊朗','Mesopotamia, Levante, Anatolia meridional, Arabia e Irán','Mesopotâmia, Levante, Anatólia meridional, Arábia e Irã'],
  'AS-STEP':['Central Asia, Eurasian steppes and oasis cities','中亚、欧亚草原与绿洲城市','Asia central, estepas euroasiáticas y ciudades de oasis','Ásia Central, estepes euroasiáticas e cidades de oásis'],
  'AF-SAHEL':['Sahelian Africa — Niger, Hausa, Songhai and Mali','非洲萨赫勒——尼日尔、豪萨、桑海与马里','África saheliana — Níger, hausa, songhai y Malí','África saheliana — Níger, hauçá, songhai e Mali'],
  'AF-WEST':['Forested West Africa and Gulf of Guinea','西非森林地区与几内亚湾','África occidental forestal y golfo de Guinea','África Ocidental florestal e golfo da Guiné'],
  'AF-SOUTH':['Central and southern Africa — pastoral enclosures, stone kingdoms and forests','中非与南部非洲——牧业围栏、石造王国与森林','África central y austral — recintos pastoriles, reinos de piedra y bosques','África central e austral — cercados pastoris, reinos de pedra e florestas'],
  'AF-EAST':['East Africa, Horn of Africa and Swahili coast','东非、非洲之角与斯瓦希里海岸','África oriental, Cuerno de África y costa suajili','África Oriental, Chifre da África e costa suaíli'],
  'AS-IND':['Indian subcontinent — Indus Valley, India and Sri Lanka','印度次大陆——印度河流域、印度与斯里兰卡','Subcontinente indio — valle del Indo, India y Sri Lanka','Subcontinente indiano — vale do Indo, Índia e Sri Lanka'],
  'AS-HIM':['Himalayas — Tibet, Newar Nepal, Ladakh and Bhutan','喜马拉雅——西藏、尼泊尔尼瓦尔地区、拉达克与不丹','Himalaya — Tíbet, Nepal newar, Ladakh y Bután','Himalaia — Tibete, Nepal newar, Ladakh e Butão'],
  'AS-CHI':['Ancient and medieval China — capitals, towns and villages','古代与中世纪中国——都城、城镇与乡村','China antigua y medieval — capitales, pueblos y aldeas','China antiga e medieval — capitais, vilas e aldeias'],
  'AS-KOR':['Korean peninsula — ancient kingdoms, Goryeo and early Joseon','朝鲜半岛——古代王国、高丽与朝鲜王朝早期','Península coreana — reinos antiguos, Goryeo y Joseon temprano','Península Coreana — reinos antigos, Goryeo e Joseon inicial'],
  'AS-JAP':['Japanese archipelago — Yayoi, Kofun, Heian, Kamakura and Muromachi','日本列岛——弥生、古坟、平安、镰仓与室町时代','Archipiélago japonés — Yayoi, Kofun, Heian, Kamakura y Muromachi','Arquipélago japonês — Yayoi, Kofun, Heian, Kamakura e Muromachi'],
  'AS-SEA':['Mainland Southeast Asia — Khmer, Thai, Lao, Mon, Burmese, Cham and Viet','东南亚大陆——高棉、泰、老挝、孟、缅、占与越南','Sudeste asiático continental — jemer, tailandés, lao, mon, birmano, cham y vietnamita','Sudeste Asiático continental — khmer, tailandês, laociano, mon, birmanês, cham e vietnamita'],
  'AS-ISL':['Maritime Southeast Asia — Java, Bali, Sumatra, Sulawesi, Borneo and Philippines','东南亚海岛地区——爪哇、巴厘、苏门答腊、苏拉威西、婆罗洲与菲律宾','Sudeste asiático insular — Java, Bali, Sumatra, Célebes, Borneo y Filipinas','Sudeste Asiático insular — Java, Bali, Sumatra, Sulawesi, Bornéu e Filipinas'],
  'OC-PAC':['Oceania and the Pacific — Melanesia, Polynesia, Micronesia and Aotearoa','大洋洲与太平洋——美拉尼西亚、波利尼西亚、密克罗尼西亚与奥特亚罗瓦','Oceanía y Pacífico — Melanesia, Polinesia, Micronesia y Aotearoa','Oceania e Pacífico — Melanésia, Polinésia, Micronésia e Aotearoa'],
  'OC-AUS':['Aboriginal Australia and Torres Strait Islands','澳大利亚原住民与托雷斯海峡群岛','Australia aborigen e islas del estrecho de Torres','Austrália aborígene e ilhas do estreito de Torres'],
  'AM-ARC':['Arctic and Subarctic America — Inuit, Yupik and Aleut','美洲北极与亚北极——因纽特、尤皮克与阿留申','Ártico y subártico americano — inuit, yupik y aleutianos','Ártico e subártico americanos — inuit, yupik e aleútes'],
  'AM-WOODS':['North America — Northeast Woodlands, Great Lakes and Plains','北美——东北林地、五大湖与大平原','América del Norte — bosques del noreste, Grandes Lagos y llanuras','América do Norte — florestas do nordeste, Grandes Lagos e planícies'],
  'AM-PUEB':['North American Southwest — Ancestral Pueblo, Hohokam and Mogollon','北美西南部——祖先普韦布洛、霍霍坎与莫戈隆','Suroeste norteamericano — pueblo ancestral, hohokam y mogollón','Sudoeste norte-americano — pueblo ancestral, hohokam e mogollon'],
  'AM-MISS':['North America — Mississippian tradition and mound centres','北美——密西西比文化与土丘中心','América del Norte — tradición misisipiana y centros de túmulos','América do Norte — tradição mississipiana e centros de montículos'],
  'AM-MESO':['Mesoamerica — Olmec, Teotihuacan, Zapotec, Maya, Toltec and Mexica','中美洲——奥尔梅克、特奥蒂瓦坎、萨波特克、玛雅、托尔特克与墨西加','Mesoamérica — olmecas, Teotihuacán, zapotecas, mayas, toltecas y mexicas','Mesoamérica — olmecas, Teotihuacan, zapotecas, maias, toltecas e mexicas'],
  'AM-AND':['Andes — Tiwanaku, Wari, Moche, Chimú and Inca','安第斯——蒂瓦纳库、瓦里、莫切、奇穆与印加','Andes — Tiwanaku, wari, moche, chimú e inca','Andes — Tiwanaku, wari, moche, chimú e inca'],
  'AM-TROP':['Amazonia, Orinoco, Caribbean and South American lowlands','亚马孙、奥里诺科、加勒比与南美低地','Amazonía, Orinoco, Caribe y tierras bajas de Sudamérica','Amazônia, Orinoco, Caribe e terras baixas da América do Sul'],
  'AS-SIB':['Siberia and boreal Far East — taiga, tundra and coasts','西伯利亚与远东北部——泰加林、苔原与海岸','Siberia y Extremo Oriente boreal — taiga, tundra y costas','Sibéria e Extremo Oriente boreal — taiga, tundra e costas'],
  'AM-PNW':['North American Pacific Northwest — cedar coast and plank villages','北美太平洋西北部——雪松海岸与木板村落','Noroeste del Pacífico norteamericano — costa de cedros y aldeas de tablones','Noroeste do Pacífico norte-americano — costa de cedros e aldeias de tábuas'],
  'AM-SOUTH':['Southern Cone — Mapuche, Guaraní and Patagonia','南美南锥体——马普切、瓜拉尼与巴塔哥尼亚','Cono Sur — mapuche, guaraní y Patagonia','Cone Sul — mapuche, guarani e Patagônia'],
};
const materials: Record<string, Translations> = {
  'MAT-WATTLE-DAUB':['Wattle and daub','枝条泥墙','Entramado y barro','Trançado e barro'], 'MAT-COB':['Cob','夯泥','Tierra amasada','Taipa de mão'], 'MAT-ADOBE':['Adobe / unfired brick','土坯／生砖','Adobe / ladrillo crudo','Adobe / tijolo cru'], 'MAT-RAMMED-EARTH':['Rammed earth','夯土','Tapial','Taipa de pilão'], 'MAT-MUD-PLASTER':['Earth plaster','泥灰抹面','Enlucido de tierra','Reboco de terra'],
  'MAT-TIMBER-POST':['Timber posts and beams','木柱与木梁','Postes y vigas de madera','Postes e vigas de madeira'], 'MAT-LOG':['Stacked timber / logs','叠木／原木','Madera apilada / troncos','Madeira empilhada / troncos'], 'MAT-STONE-DRY':['Dry stone','干砌石','Piedra en seco','Pedra seca'], 'MAT-STONE-MORTAR':['Rubble masonry','毛石砌体','Mampostería de piedra','Alvenaria de pedra'], 'MAT-STONE-ASHLAR':['Dressed stone','精凿石','Sillería','Pedra aparelhada'],
  'MAT-THATCH':['Grass thatch','茅草','Paja de gramíneas','Palha de gramíneas'], 'MAT-REED':['Reeds / rushes','芦苇／灯心草','Cañas / juncos','Juncos / caniços'], 'MAT-TILE-CLAY':['Clay tiles','陶瓦','Tejas de barro','Telhas de barro'], 'MAT-WOOD-SHINGLES':['Wood shingles','木瓦','Tejuelas de madera','Telhas de madeira'], 'MAT-SLATE':['Slate / stone slabs','板岩／石板','Pizarra / losas','Ardósia / lajes'],
  'MAT-HALF-TIMBER':['Exposed timber framing','外露木框架','Entramado de madera visto','Enxaimel aparente'], 'MAT-BURNT-BRICK':['Fired brick','烧制砖','Ladrillo cocido','Tijolo cozido'], 'MAT-BAMBOO':['Bamboo','竹','Bambú','Bambu'], 'MAT-PALM':['Palm leaves','棕榈叶','Hojas de palma','Folhas de palmeira'], 'MAT-RAISED-POST':['Timber piles / stilts','木桩／高脚柱','Pilotes / zancos de madera','Estacas / palafitas de madeira'],
  'MAT-PLASTER-LIME':['Lime / stucco','石灰／灰泥','Cal / estuco','Cal / estuque'], 'MAT-CORAL':['Coral limestone','珊瑚石灰岩','Caliza coralina','Calcário coralino'], 'MAT-BASALT':['Basalt','玄武岩','Basalto','Basalto'], 'MAT-BARK':['Bark','树皮','Corteza','Casca'], 'MAT-FELT':['Felt','毡','Fieltro','Feltro'], 'MAT-HIDE':['Hides','兽皮','Pieles','Peles'],
  'MAT-TURF':['Turf / sod','泥炭／草皮','Turba / césped','Turfa / relva'], 'MAT-CHALK':['Chalk','白垩','Creta','Giz'], 'MAT-SHELLSTONE':['Shell stone','贝壳石','Piedra de conchas','Pedra de conchas'], 'MAT-CLINKER':['Scoriaceous volcanic rock','火山渣岩','Roca volcánica escoriácea','Rocha vulcânica escoriácea'], 'MAT-ICE-SNOW':['Compacted snow','压实雪','Nieve compactada','Neve compactada'],
  'MAT-MEGALITH':['Megalithic monoliths','巨石单体','Monolitos megalíticos','Monólitos megalíticos'], 'MAT-WOOD-MORTISE':['Complex timber joinery','复杂木结构榫接','Ensamblajes complejos de madera','Encaixes complexos de madeira'], 'MAT-ROCKCUT':['Rock-cut excavation','岩石开凿','Excavación en roca','Escavação na rocha'], 'MAT-DRIFTWOOD':['Driftwood','漂流木','Madera flotante','Madeira flutuante'], 'MAT-WOVEN-TEXTILE':['Woven textile','编织纺织物','Tejido','Tecido'], 'MAT-BONE':['Structural bone','承重骨材','Hueso estructural','Osso estrutural'], 'MAT-CORDAGE':['Cordage, unspecified fibre','绳索，纤维未指定','Cordaje, fibra no especificada','Cordame, fibra não especificada'], 'MAT-LIMESTONE':['Limestone','石灰岩','Caliza','Calcário'],
};

function translated(values: Translations | undefined, fallback: string): string {
  const locale = typeof window === 'undefined' ? 'fr' : savedLocale();
  if (!values || locale === 'fr') return fallback;
  return values[(['en', 'zh', 'es', 'pt'] as const).indexOf(locale)] ?? fallback;
}
export function housePackLabel(id: string, fallback: string): string { return translated(packs[id], fallback); }
export function houseMaterialLabel(id: string, fallback: string): string { return translated(materials[id], fallback); }
export function houseArchetypeLabel(id: string, fallback: string): string {
  const locale = typeof window === 'undefined' ? 'fr' : savedLocale();
  if (locale === 'en') return houseAtlasEnglish[id] ?? fallback;
  if (locale === 'zh' || locale === 'es' || locale === 'pt') return houseArchetypeTranslations[id]?.[(['zh', 'es', 'pt'] as const).indexOf(locale)] ?? fallback;
  return fallback;
}
export function houseSourceDescription(id: string, fallback: string[]): string[] {
  if (typeof window === 'undefined') return fallback;
  const locale = savedLocale();
  if (locale === 'fr') return fallback;
  const english = houseAtlasEnglishDetails[id];
  if (!english) return fallback;
  if (locale === 'en') return english;
  const index = (['zh', 'es', 'pt'] as const).indexOf(locale);
  return english.map(text => houseAtlasTranslatedDetails[text]?.[index] ?? text);
}
export function houseSourceText(text: string): string {
  if (typeof window === 'undefined') return text;
  const locale = savedLocale();
  if (locale === 'fr') return text;
  const english = houseAtlasEnglishPhrases[text] ?? text;
  if (locale === 'en') return english;
  const index = (['zh', 'es', 'pt'] as const).indexOf(locale);
  return houseAtlasTranslatedDetails[english]?.[index] ?? english;
}
