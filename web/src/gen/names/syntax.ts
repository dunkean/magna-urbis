import type { ToponymProfile } from './profiles';

export type ToponymForm = 'street' | 'gate-street' | 'road' | 'gate' | 'castle' | 'river' | 'lake' | 'sea' | 'forest' | 'hill' | 'region' | 'farm';
type FeatureForm = Exclude<ToponymForm, 'street' | 'gate-street'>;
export interface ToponymTraits { opaque?: boolean; muteH?: boolean; gender?: 'masculine' | 'feminine'; number?: 'singular' | 'plural'; article?: string }

/** H defaults to de; callers may explicitly annotate a known mute H. */
export function frenchDe(name: string, options?: ToponymTraits): string {
  let n = name.trim();
  if (options?.article && !/^(le|la|les)\s|^l['’]/i.test(n)) n = `${options.article} ${n}`;
  if (/^le\s+/i.test(n)) return `du ${n.slice(3)}`;
  if (/^les\s+/i.test(n)) return `des ${n.slice(4)}`;
  if (/^la\s+/i.test(n)) return `de la ${n.slice(3)}`;
  if (/^l['’]/i.test(n)) return `de l'${n.slice(2)}`;
  if (/^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(n) || (options?.muteH && /^h/i.test(n))) return `d'${n}`;
  return `de ${n}`;
}
export const frenchRoad = (name: string): string => `Route ${frenchDe(name)}`;

/** Urban houses never reuse the farm generic. Profiles without an authored house noun keep a bare name. */
export function culturalBuildingName(profile:ToponymProfile,name:string):string {
  if(profile.id==='french')return `Maison ${frenchDe(name)}`;
  if(profile.id==='italian')return `Casa ${italianDi(name)}`;
  const noun:Record<string,string>={english:'House',german:'Haus',arabic:'Dar',chinese:'Wu',japanese:'Ie',sanskrit:'Griha',norse:'Hus',elven:'Hall',dwarven:'Delve',orcish:'Hut',halfling:'Burrow',roman:'Domus',dutch:'Huis',persian:'Khaneh',turkish:'Ev',korean:'Jip',swahili:'Nyumba',maori:'Whare'};
  const term=noun[profile.id];
  return !term?name:CULTURAL_TERMS[profile.id].order==='suffix'?`${name} ${term}`:`${term} ${name}`;
}

/** Format a bare name; a complete corpus label is opaque and must not be redecorated. */
export function formatToponym(profile: ToponymProfile, kind: ToponymForm, name: string, options?: ToponymTraits): string {
  if (options?.opaque) return name;
  const id = profile.id;
  if (kind === 'street' || kind === 'gate-street') {
    if (id === 'french') return kind === 'street' ? `Rue ${frenchDe(name, options)}` : `Rue de la Porte ${frenchDe(name, options)}`;
    if (id === 'english' || id === 'halfling') return kind === 'street' ? `${name} Road` : `${name} Gate Street`;
    const t = CULTURAL_TERMS[id];
    if (t && kind === 'street') return t.order === 'suffix' ? `${name} ${t.street}` : `${t.street} ${name}`;
    return formatToponym(profile, kind === 'street' ? 'road' : 'gate', name);
  }
  const existingTerm = CULTURAL_TERMS[id]?.[kind];
  if (existingTerm) {
    const lower = name.toLowerCase(), term = existingTerm.toLowerCase();
    if (lower === term || lower.startsWith(term + ' ') || lower.endsWith(' ' + term) || lower.endsWith('-' + term)) return name;
  }
  if (id === 'french') {
    const prefix: Record<FeatureForm, string> = { road: 'Route', gate: 'Porte', castle: 'Château', river: 'Rivière', lake: 'Lac', sea: 'Mer', forest: 'Forêt', hill: 'Mont', region: 'Pays', farm: 'Ferme' };
    return `${prefix[kind]} ${frenchDe(name, options)}`;
  }
  if (id === 'italian') {
    const prefix: Record<FeatureForm, string> = { road: 'Strada', gate: 'Porta', castle: 'Castello', river: 'Fiume', lake: 'Lago', sea: 'Mare', forest: 'Bosco', hill: 'Monte', region: 'Terra', farm: 'Podere' };
    return kind === 'river' || kind === 'hill' ? `${prefix[kind]} ${name}` : `${prefix[kind]} ${italianDi(name, options)}`;
  }
  // These labels are light, invariable connectors; no inferred inflection of opaque place names.
  const templates: Record<string, Record<FeatureForm, (s: string) => string>> = {
    persian: { road: s => `Rāh-e ${s}`, gate: s => `Darvāzeh-ye ${s}`, castle: s => `Qal'eh-ye ${s}`, river: s => `Rud-e ${s}`, lake: s => `Daryācheh-ye ${s}`, sea: s => `Daryā-ye ${s}`, forest: s => `Jangal-e ${s}`, hill: s => `Kuh-e ${s}`, region: s => `Velāyat-e ${s}`, farm: s => `Mazra'eh-ye ${s}` },
    turkish: { road: s => `${s} Yolu`, gate: s => `${s} Kapısı`, castle: s => `${s} Kalesi`, river: s => `${s} Nehri`, lake: s => `${s} Gölü`, sea: s => `${s} Denizi`, forest: s => `${s} Ormanı`, hill: s => `${s} Tepesi`, region: s => `${s} Bölgesi`, farm: s => `${s} Çiftliği` },
    korean: { road: s => `${s}-ro`, gate: s => `${s}-mun`, castle: s => `${s}-seong`, river: s => `${s}-gang`, lake: s => `${s}-ho`, sea: s => `${s}-hae`, forest: s => `${s}-sup`, hill: s => `${s}-san`, region: s => `${s} jiyŏk`, farm: s => `${s} nongjang` },
    greek: { road: s => `Odos ${s}`, gate: s => `Pyli ${s}`, castle: s => `Kastro ${s}`, river: s => `Potamos ${s}`, lake: s => `Limni ${s}`, sea: s => `Thalassa ${s}`, forest: s => `Dasos ${s}`, hill: s => `Vouno ${s}`, region: s => `Periochi ${s}`, farm: s => `Ktima ${s}` },
    italian: { road: s => `Strada di ${s}`, gate: s => `Porta di ${s}`, castle: s => `Castello di ${s}`, river: s => `Fiume ${s}`, lake: s => `Lago di ${s}`, sea: s => `Mare di ${s}`, forest: s => `Bosco di ${s}`, hill: s => `Monte ${s}`, region: s => `Terra di ${s}`, farm: s => `Podere di ${s}` },
    arabic: { road: s => `Tariq ${s}`, gate: s => `Bab ${s}`, castle: s => `Qasr ${s}`, river: s => `Nahr ${s}`, lake: s => `Buhayrat ${s}`, sea: s => `Bahr ${s}`, forest: s => `Ghabat ${s}`, hill: s => `Jabal ${s}`, region: s => `Bilad ${s}`, farm: s => `Mazraat ${s}` },
  };
  if (templates[id]) return templates[id][kind](name);
  if (id === 'german') {
    const words: Record<FeatureForm, string> = { road: 'Straße', gate: 'Tor', castle: 'Burg', river: 'Fluss', lake: 'See', sea: 'Meer', forest: 'Wald', hill: 'Berg', region: 'Land', farm: 'Hof' };
    return `${name} ${words[kind]}`;
  }
  if (id === 'english' || id === 'halfling') {
    const words: Record<FeatureForm, string> = { road: 'Road', gate: 'Gate', castle: 'Castle', river: 'River', lake: 'Lake', sea: 'Sea', forest: 'Forest', hill: 'Hill', region: 'Region', farm: 'Farm' };
    return kind === 'river' || kind === 'lake' ? `${words[kind]} ${name}` : `${name} ${words[kind]}`;
  }
  const lexicon = CULTURAL_TERMS[id];
  if (lexicon) {
    const term = lexicon[kind];
    // Do not infer unknown inflections; recognize only a whole already-present term.
    const lower = name.toLowerCase();
    const word = term.toLowerCase();
    if (lower === word || lower.startsWith(word + ' ') || lower.endsWith(' ' + word) || lower.endsWith('-' + word)) return name;
    return lexicon.order === 'suffix' ? `${name} ${term}` : `${term} ${name}`;
  }
  // Unspecified morphology stays an opaque name rather than an invented inflection.
  return name;
}

/** Contractions are based on an explicit or visible article, never guessed gender. */
export function italianDi(name: string, traits?: ToponymTraits): string {
  let n = name.trim();
  const match = /^(il|lo|la|i|gli|le)\s+(.+)$/i.exec(n);
  const article = (traits?.article ?? match?.[1] ?? '').toLowerCase();
  if (match && article === match[1].toLowerCase()) n = match[2];
  const contractions: Record<string, string> = { il: 'del', lo: 'dello', la: 'della', i: 'dei', gli: 'degli', le: 'delle' };
  if (/^l['’]/i.test(n)) return `dell'${n.slice(2)}`;
  return contractions[article] ? `${contractions[article]} ${n}` : `di ${n}`;
}

/** Surface words for feature and urban labels. Some are deliberately authored conventions;
 * see NAMEBENCH_GRAMMAR_SOURCES.md for scope and provenance. */
export interface CulturalTerms extends Record<FeatureForm, string> {
  order: 'prefix' | 'suffix'; street: string; ward: string; square: string; worship: string; craft: string;
}
const terms = (order: CulturalTerms['order'], values: [string,string,string,string,string,string,string,string,string,string,string,string,string,string,string]): CulturalTerms => {
  const [road,gate,castle,river,lake,sea,forest,hill,region,farm,street,ward,square,worship,craft] = values;
  return { order, road, gate, castle, river, lake, sea, forest, hill, region, farm, street, ward, square, worship, craft };
};
// Word order is intentionally simple and invariable: names from geographic pools have
// no reliable case, gender or pronunciation metadata from which to inflect them.
export const CULTURAL_TERMS: Readonly<Record<string, CulturalTerms>> = {
  french: terms('prefix',['Route','Porte','Château','Rivière','Lac','Mer','Forêt','Mont','Pays','Ferme','Rue','Quartier','Place','Église','Artisans']),
  english: terms('suffix',['Road','Gate','Castle','River','Lake','Sea','Forest','Hill','Region','Farm','Street','Quarter','Square','Church','Crafts']),
  german: terms('suffix',['Straße','Tor','Burg','Fluss','See','Meer','Wald','Berg','Land','Hof','Gasse','Viertel','Platz','Kirche','Handwerk']),
  italian: terms('prefix',['Strada','Porta','Castello','Fiume','Lago','Mare','Bosco','Monte','Terra','Podere','Via','Quartiere','Piazza','Chiesa','Artigiani']),
  arabic: terms('prefix',['Tariq','Bab','Qasr','Nahr','Buhayrat','Bahr','Ghabat','Jabal','Bilad','Mazraat','Darb','Harat','Rahba','Masjid','Suq']),
  elven: terms('suffix',['Way','Gate','Tower','River','Lake','Sea','Wood','Peak','Realm','Garden','Path','Grove','Glade','Shrine','Craft']),
  dwarven: terms('suffix',['Road','Door','Keep','Stream','Lake','Sea','Wood','Peak','Hold','Steading','Way','Hall','Court','Shrine','Forge']),
  orcish: terms('suffix',['Trail','Gate','Hold','River','Bog','Sea','Thicket','Mound','Land','Pen','Row','Camp','Pit','Altar','Craft']),
  halfling: terms('suffix',['Road','Gate','Hall','Water','Pond','Sea','Wood','Hill','Shire','Farm','Lane','Farthing','Green','Chapel','Craft']),
  chinese: terms('suffix',['Lu','Men','Cheng','He','Hu','Hai','Lin','Shan','Qu','Zhuang','Jie','Fang','Guangchang','Si','Gong']),
  japanese: terms('suffix',['Kaido','Mon','Jo','Gawa','Ko','Nada','Mori','Yama','Chiho','Mura','Dori','Machi','Hiroba','Tera','Shokunin']),
  sanskrit: terms('suffix',['Marga','Dvara','Durga','Nadi','Sarovara','Sagara','Vana','Giri','Desha','Grama','Vithi','Pura','Chowk','Mandira','Shilpi']),
  norse: terms('suffix',['veg','port','borg','elv','vatn','fjord','skog','fjell','land','gard','gate','bydel','torg','hov','smed']),
  dutch: terms('suffix',['Weg','Poort','Burcht','Rivier','Meer','Zee','Bos','Heuvel','Streek','Hoeve','Straat','Wijk','Plein','Kerk','Ambacht']),
  roman: terms('prefix',['Via','Porta','Castrum','Flumen','Lacus','Mare','Silva','Mons','Regio','Villa','Via','Vicus','Forum','Templum','Artifex']),
  greek: terms('prefix',['Odos','Pyli','Kastro','Potamos','Limni','Thalassa','Dasos','Vouno','Periochi','Ktima','Odos','Synoikia','Plateia','Naos','Technitis']),
  persian: terms('prefix',['Rāh','Darvāzeh','Qalʿeh','Rud','Daryācheh','Daryā','Jangal','Kuh','Velāyat','Mazraʿeh','Kucheh','Mahalleh','Meydān','Ātashkadeh','Pishevar']),
  turkish: terms('suffix',['Yolu','Kapısı','Kalesi','Nehri','Gölü','Denizi','Ormanı','Tepesi','Bölgesi','Çiftliği','Sokağı','Mahallesi','Meydanı','Camii','Zanaatkâr']),
  korean: terms('suffix',['Ro','Mun','Seong','Gang','Ho','Hae','Sup','San','Jiyeok','Nongjang','Gil','Dong','Gwangjang','Jeol','Jangin']),
  russian: terms('suffix',['Doroga','Vorota','Krepost','Reka','Ozero','More','Les','Gora','Oblast','Khutor','Ulitsa','Sloboda','Ploshchad','Tserkov','Remeslennik']),
  polish: terms('suffix',['Droga','Brama','Zamek','Rzeka','Jezioro','Morze','Las','Góra','Kraina','Folwark','Ulica','Dzielnica','Rynek','Kościół','Rzemieślnik']),
  slavic: terms('suffix',['Doroga','Brama','Grad','Rika','Ozero','More','Lis','Hora','Krai','Khutir','Vulytsia','Posad','Ploshcha','Tserkva','Maister']),
  celtic: terms('prefix',['Bóthar','Geata','Dún','Abhainn','Loch','Muir','Coill','Cnoc','Dúiche','Feirm','Sráid','Ceantar','Cearnóg','Teampall','Ceardaí']),
  khmer: terms('prefix',['Phlov','Khlong','Banteay','Tonlé','Boeng','Samut','Prey','Phnom','Damban','Chamkar','Phlov','Sangkat','Ti Lean','Wat','Cheang']),
  swahili: terms('prefix',['Barabara','Lango','Ngome','Mto','Ziwa','Bahari','Msitu','Mlima','Mkoa','Shamba','Mtaa','Kata','Uwanja','Msikiti','Fundi']),
  'southern-african': terms('prefix',['Indlela','Isango','Inqaba','Umfula','Ichibi','Ulwandle','Ihlathi','Intaba','Isifunda','Ipulazi','Umgwaqo','Isigodi','Inkundla','Ithempeli','Ingcweti']),
  'west-african': terms('prefix',['Ọ̀nà','Ẹnu','Ilé odi','Odò','Adágún','Òkun','Igbó','Òkè','Agbègbè','Oko','Òpópónà','Àdúgbò','Ojúde','Ilé oriṣa','Ọ̀mọ̀wé iṣẹ́']),
  egyptian: terms('prefix',['Wat','Ru','Sekhem','Iteru','She','Wadj','Khet','Dju','Sepat','Sekhet','Wat','Niwet','Aat','Per netjer','Hemut']),
  nubian: terms('prefix',['Tare','Kori','Mero','Nali','Dare','Sela','Kenu','Dera','Kasu','Mira','Tare','Bari','Koru','Amani','Sari']),
  mesopotamian: terms('prefix',['Harranu','Abullu','Dunnu','Naru','Tamtum','Tamtum','Qishtu','Shadu','Matu','Eqlu','Suqu','Babtu','Rebitu','Ekur','Ummianu']),
  levantine: terms('prefix',['Darb','Bab','Qala','Nahr','Buhayra','Bahr','Ghaba','Jabal','Iqlim','Mazraa','Sharia','Hayy','Saha','Mabad','Hirafi']),
  arabian: terms('prefix',['Darb','Bab','Hisn','Wadi','Buhayra','Bahr','Ghaba','Jabal','Iqlim','Mazraa','Zuqaq','Harah','Saha','Masjid','Hirafi']),
  sahel: terms('prefix',['Sira','Da','Tata','Ba','Débo','Jiba','Wula','Kulu','Jamana','Foro','Sira','Kɔnɔ','Yɔrɔ','Misiri','Numu']),
  himalayan: terms('prefix',['Bato','Dhoka','Killa','Khola','Tal','Sagar','Ban','Danda','Pradesh','Khet','Galli','Tol','Chok','Mandir','Kaligar']),
  javanese: terms('prefix',['Dalan','Gapura','Benteng','Kali','Tlaga','Segara','Alas','Gunung','Wewengkon','Sawah','Dalan','Kampung','Alun-alun','Candi','Pande']),
  burmese: terms('prefix',['Lan','Taga','Myodaw','Myit','In','Pinle','Taw','Taung','Ne','Le','Lan','Yatkwet','Zay','Hpaya','Letthama']),
  vietnamese: terms('prefix',['Đường','Cổng','Thành','Sông','Hồ','Biển','Rừng','Núi','Vùng','Trang trại','Phố','Phường','Quảng trường','Đền','Thợ']),
  tibetan: terms('prefix',['Lam','Go','Dzong','Chu','Tso','Gyatso','Nags','Ri','Yul','Zhing','Lam','Sa','Thang','Gompa','Bzo']),
  mongolian: terms('prefix',['Zam','Khaalga','Kherem','Gol','Nuur','Dalai','Oi','Uul','Nutag','Aj Akhui','Gudamj','Düüreg','Talbai','Khiid','Darkhan']),
  caucasian: terms('prefix',['Gza','Karibche','Tsikhe','Mdinare','Tba','Zghva','Tqe','Mta','Mkhare','Meurneoba','Kucha','Ubani','Moedani','Tadzari','Ostati']),
  ethiopian: terms('prefix',['Mengəd','Bər','Ginb','Wänz','Hayq','Bahr','Dän','Tä​​ra​​ra','Kilil','Ersha','Godana','Säfär','Adebabay','Bete krəstiyan','Təbäb']),
  dravidian: terms('suffix',['Salai','Vayil','Kottai','Aru','Eri','Kadal','Kadu','Malai','Nadu','Pannai','Theru','Pettai','Thidal','Kovil','Kaivinaignar']),
  maori: terms('prefix',['Ara','Kuwaha','Pā','Awa','Roto','Moana','Ngahere','Maunga','Rohe','Māra','Tiriti','Kāinga','Marae','Whare karakia','Tohunga']),
  guarani: terms('prefix',['Tape','Okẽ','Tava','Ysyry','Ypa','Para','Ka’aguy','Yvyty','Tetã','Kokue','Tape','Tekoha','Ñu','Tupão','Apohára']),
  australian: terms('prefix',['Warrin','Garan','Bundi','Bila','Miri','Yara','Gundar','Dara','Ngarra','Wari','Gali','Bura','Wara','Minda','Gari']),
  inuit: terms('suffix',['Aqqusiniq','Paanga','Illorsuaq','Kuuk','Tasiq','Tariuq','Orpik','Qaqqaq','Nuna','Nunaqarfik','Aqqut','Nunaliq','Sila','Qarmaq','Sanaji']),
  siberian: terms('prefix',['Suol','Khaaha','Bulus','Örüs','Küöl','Bayğal','Tıa','Haya','Doydu','Alas','Suol','Bölöh','Sir','Ürüng','Uus']),
  maya: terms('prefix',['Bej','Hool','Noj Kaj','Ha','Nab','Kaknab','Kax','Witz','Kabal','Kool','Bej','Kaj','Kiwik','Kuh','Ah Men']),
  aztec: terms('suffix',['Otli','Ixtli','Calli','Atoyac','Atlan','Ilhuicaatl','Cuauhtla','Tepetl','Tlalli','Calli','Otli','Calpulli','Tianquiztli','Teocalli','Toltecatl']),
  andean: terms('prefix',['Ñan','Punku','Pukara','Mayu','Qucha','Mama qucha','Sacha','Urqu','Suyu','Chakra','Kichki ñan','Ayllu','Kancha','Waka','Kamayuq']),
  iroquoian: terms('prefix',['Taren','Kanon','Oren','Otsi','Kari','Onha','Weya','Toka','Nara','Kena','Taren','Kanon','Oren','Weya','Kari']),
  pueblo: terms('prefix',['Sama','Kiva','Tawa','Pahu','Sewa','Ona','Koya','Mesa','Tewa','Tova','Sama','Povi','Tawa','Kiva','Sewa']),
  plains: terms('prefix',['Toka','Wana','Kasa','Mini','Tawa','Maka','Wata','Paha','Maka','Tipa','Toka','Oyate','Tawa','Waki','Kasa']),
  mississippian: terms('prefix',['Tana','Oka','Mika','Oka','Tali','Mowa','Kona','Hina','Maka','Pana','Tana','Ima','Nita','Hina','Mika']),
  pnw: terms('prefix',['Kanu','Tala','Kaya','Talu','Sali','Namu','Waya','Kaya','Naka','Tima','Kanu','Wala','Tima','Namu','Tala']),
  'north-american': terms('prefix',['Taren','Kanon','Oren','Otsi','Kari','Onha','Weya','Toka','Nara','Kena','Taren','Kanon','Oren','Weya','Kari']),
};
