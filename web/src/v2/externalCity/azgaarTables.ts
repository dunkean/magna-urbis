/**
 * Azgaar Fantasy Map Generator (MIT) data reduced to Magna Urbis hints.
 * Culture names come from FMG's default culture sets (src/model/society/cultures-generator.ts),
 * name bases from src/data/name-bases.ts; each culture points at the name base it draws names from.
 */
import type { BiomeName } from '../../gen/biomes';
import type { ClimateZone } from '../../../../rust/bridge/terrainClimate';

/** FMG name bases in FMG index order (index = `culture.base`). */
export const FMG_NAME_BASES = [
  'German', 'English', 'French', 'Italian', 'Castillian', 'Ruthenian', 'Nordic', 'Greek', 'Roman', 'Finnic',
  'Korean', 'Chinese', 'Japanese', 'Portuguese', 'Nahuatl', 'Hungarian', 'Turkish', 'Amazigh', 'Arabic', 'Inuit',
  'Basque', 'Nigerian', 'Celtic', 'Mesopotamian', 'Iranian', 'Hawaiian', 'Karnataka', 'Quechua', 'Swahili', 'Vietnamese',
  'Cantonese', 'Mongolian', 'Human Generic', 'Elven', 'Dark Elven', 'Dwarven', 'Goblin', 'Orc', 'Giant', 'Draconic',
  'Arachnid', 'Serpents', 'Levantine',
] as const;
export type FmgNameBase = typeof FMG_NAME_BASES[number];

/** Default FMG culture names (every predefined set) → their name base. Keys are lower case. */
export const FMG_CULTURE_BASES: Readonly<Record<string, FmgNameBase>> = {
  // European / world sets
  shwazen: 'German', schwarzen: 'German', germanic: 'German',
  angshire: 'English', enlandic: 'English', westen: 'English', nortumbic: 'English', mercian: 'English', kentian: 'English',
  luari: 'French', luarian: 'French',
  tallian: 'Italian', hetallian: 'Italian',
  astellian: 'Castillian',
  slovan: 'Ruthenian',
  norse: 'Nordic',
  elladan: 'Greek', hellenic: 'Greek', macedonian: 'Greek',
  romian: 'Roman', roman: 'Roman',
  soumi: 'Finnic', estian: 'Finnic',
  koryo: 'Korean',
  hantzu: 'Chinese',
  yamoto: 'Japanese',
  portuzian: 'Portuguese',
  nawatli: 'Nahuatl',
  vengrian: 'Hungarian',
  turchian: 'Turkish', turan: 'Turkish', rohand: 'Turkish',
  amazi: 'Amazigh',
  eurabic: 'Arabic',
  inuk: 'Inuit',
  euskati: 'Basque', cantabrian: 'Basque',
  yoruba: 'Nigerian',
  keltan: 'Celtic', celtic: 'Celtic',
  efratic: 'Mesopotamian', mesopotamian: 'Mesopotamian',
  tehrani: 'Iranian', persian: 'Iranian', scythian: 'Iranian',
  maui: 'Hawaiian',
  carnatic: 'Karnataka',
  inqan: 'Quechua',
  kiswaili: 'Swahili',
  vietic: 'Vietnamese',
  guantzu: 'Cantonese',
  ulus: 'Mongolian', dulandir: 'Mongolian',
  levent: 'Levantine', carthaginian: 'Levantine', hebrew: 'Levantine',
  // High / dark fantasy sets
  anor: 'Human Generic', dail: 'Human Generic',
  quenian: 'Elven', eldar: 'Elven',
  trow: 'Dark Elven', lothian: 'Dark Elven',
  dunirr: 'Dwarven', khazadur: 'Dwarven', durinn: 'Dwarven',
  kobold: 'Goblin', kobblin: 'Goblin',
  uruk: 'Orc', ugluk: 'Orc',
  yotunn: 'Giant',
  rake: 'Draconic', drake: 'Draconic',
  arago: 'Arachnid', rakhnid: 'Arachnid',
  "aj'snaga": 'Serpents',
};

/** Extra spellings users type for a name base (lower case). */
export const FMG_BASE_ALIASES: Readonly<Record<string, FmgNameBase>> = {
  berber: 'Amazigh', spanish: 'Castillian', castilian: 'Castillian', russian: 'Ruthenian', norse: 'Nordic',
  persian: 'Iranian', yoruba: 'Nigerian', human: 'Human Generic', generic: 'Human Generic',
  elf: 'Elven', 'dark elf': 'Dark Elven', drow: 'Dark Elven', dwarf: 'Dwarven', orcish: 'Orc', goblins: 'Goblin',
  dragon: 'Draconic', serpent: 'Serpents',
};

/**
 * Name base → closest Magna Urbis culture (cityCodeDefaults.json `cultures`) and toponym language
 * (gen/names/profiles.ts ids). `language` is omitted when MU has no closer profile than the culture's own.
 * `culture` is omitted when MU has no fitting culture.
 */
export const FMG_BASE_TO_MU: Readonly<Record<FmgNameBase, { culture?: string; language?: string }>> = {
  German: { culture: 'hanseatic', language: 'german' },
  English: { culture: 'european-organic', language: 'english' },
  French: { culture: 'bastide', language: 'french' },
  Italian: { culture: 'italian-comune', language: 'italian' },
  Castillian: { culture: 'european-organic', language: 'italian' },
  Ruthenian: { culture: 'russian-kremlin', language: 'russian' },
  Nordic: { culture: 'barbarian-norse', language: 'norse' },
  Greek: { culture: 'byzantine-greek', language: 'greek' },
  Roman: { culture: 'roman-core', language: 'roman' },
  Finnic: { culture: 'barbarian-norse', language: 'norse' },
  Korean: { culture: 'korean', language: 'korean' },
  Chinese: { culture: 'chinese', language: 'chinese' },
  Japanese: { culture: 'japanese-jokamachi', language: 'japanese' },
  Portuguese: { culture: 'european-organic', language: 'italian' },
  Nahuatl: { culture: 'aztec', language: 'aztec' },
  Hungarian: { culture: 'rynek-town' },
  Turkish: { culture: 'ottoman', language: 'turkish' },
  Amazigh: { culture: 'ksar-oasis', language: 'arabic' },
  Arabic: { culture: 'medina', language: 'arabic' },
  Inuit: { culture: 'inuit-camp', language: 'inuit' },
  Basque: { culture: 'european-organic' },
  Nigerian: { culture: 'yoruba', language: 'west-african' },
  Celtic: { culture: 'celtic-oppidum', language: 'celtic' },
  Mesopotamian: { culture: 'mesopotamian', language: 'mesopotamian' },
  Iranian: { culture: 'persian', language: 'persian' },
  Hawaiian: { culture: 'maori-pa', language: 'maori' },
  Karnataka: { culture: 'dravidian-temple', language: 'dravidian' },
  Quechua: { culture: 'inca', language: 'andean' },
  Swahili: { culture: 'swahili-stone-town', language: 'swahili' },
  Vietnamese: { culture: 'vietnamese-citadel', language: 'vietnamese' },
  Cantonese: { culture: 'chinese', language: 'chinese' },
  Mongolian: { culture: 'mongol-ordu', language: 'mongolian' },
  'Human Generic': { culture: 'european-organic' },
  Elven: { culture: 'elven', language: 'elven' },
  'Dark Elven': { culture: 'drow-enclave', language: 'elven' },
  Dwarven: { culture: 'dwarven', language: 'dwarven' },
  Goblin: { culture: 'goblin-warren', language: 'orcish' },
  Orc: { culture: 'orcish', language: 'orcish' },
  Giant: { culture: 'giant-hold', language: 'norse' },
  Draconic: {},
  Arachnid: { culture: 'drow-enclave', language: 'elven' },
  Serpents: { culture: 'lizardfolk-swamp', language: 'orcish' },
  Levantine: { culture: 'levantine-tell', language: 'levantine' },
};

/** Magna Urbis cultures that fit a name base; one is drawn per town (see `pickMuCulture`). */
export const FMG_BASE_CULTURES: Readonly<Record<FmgNameBase, readonly string[]>> = {
  German: ['hanseatic', 'european-organic', 'rynek-town', 'flemish-cloth-town'],
  English: ['european-organic', 'bastide', 'hanseatic', 'flemish-cloth-town'],
  French: ['bastide', 'european-organic', 'flemish-cloth-town'],
  Italian: ['italian-comune', 'venetian-lagoon', 'european-organic'],
  Castillian: ['al-andalus', 'european-organic', 'bastide'],
  Portuguese: ['al-andalus', 'european-organic', 'venetian-lagoon'],
  Ruthenian: ['russian-kremlin', 'slavic-gord', 'rynek-town'],
  Nordic: ['barbarian-norse', 'norse-ringfort', 'hanseatic'],
  Finnic: ['barbarian-norse', 'slavic-gord'],
  Greek: ['byzantine-greek'],
  Roman: ['roman-core'],
  Hungarian: ['rynek-town', 'slavic-gord'],
  Basque: ['european-organic', 'bastide'],
  Celtic: ['celtic-oppidum', 'barbarian-celtic'],
  Korean: ['korean'],
  Chinese: ['chinese'],
  Cantonese: ['chinese'],
  Japanese: ['japanese-jokamachi'],
  Vietnamese: ['vietnamese-citadel'],
  Mongolian: ['mongol-ordu', 'nomad-camp'],
  Karnataka: ['dravidian-temple', 'indian-temple'],
  Nahuatl: ['aztec', 'maya'],
  Quechua: ['inca'],
  Inuit: ['inuit-camp'],
  Hawaiian: ['maori-pa'],
  Turkish: ['ottoman'],
  Arabic: ['medina', 'oasis-caravan', 'ksar-oasis'],
  Amazigh: ['ksar-oasis', 'medina'],
  Iranian: ['persian', 'oasis-caravan'],
  Mesopotamian: ['mesopotamian'],
  Levantine: ['levantine-tell'],
  Nigerian: ['yoruba', 'hausa-kano', 'sahel'],
  Swahili: ['swahili-stone-town'],
  'Human Generic': ['european-organic', 'bastide', 'hanseatic', 'rynek-town', 'flemish-cloth-town', 'italian-comune'],
  Elven: ['elven', 'halfling'],
  'Dark Elven': ['drow-enclave'],
  Dwarven: ['dwarven', 'duergar-hold'],
  Goblin: ['goblin-warren'],
  Orc: ['orcish'],
  Giant: ['giant-hold'],
  Draconic: [],
  Arachnid: ['drow-enclave', 'myconid-colony'],
  Serpents: ['lizardfolk-swamp'],
};
/** Cultures suited to an FMG culture type. Settled types only narrow the name base's list; a
 * nomadic or hunting way of life wins over the language when the list has nothing of the kind. */
const TYPE_CULTURES: Readonly<Record<string, readonly string[]>> = {
  naval: ['hanseatic', 'venetian-lagoon', 'swahili-stone-town', 'norse-ringfort', 'merfolk-tidal', 'al-andalus'],
  river: ['flemish-cloth-town', 'rynek-town', 'european-organic', 'egyptian-planned', 'khmer', 'russian-kremlin'],
  lake: ['venetian-lagoon', 'stilt-town', 'aztec', 'lizardfolk-swamp'],
  highland: ['caucasian-highland', 'tibetan-monastery', 'himalayan-terraces', 'inca', 'dwarven', 'duergar-hold', 'rajput-fort',
    'ethiopian-highland', 'slavic-gord', 'celtic-oppidum', 'byzantine-greek'],
  nomadic: ['nomad-camp', 'mongol-ordu', 'native-plains', 'siberian-camp', 'oasis-caravan'],
  hunting: ['barbarian', 'native-iroquoian', 'pnw-plank-village', 'guarani-village', 'kraal'],
};
const LIFESTYLE_TYPES = new Set(['nomadic', 'hunting']);

/** Small deterministic hash: the same town always draws the same culture. */
function draw<T>(items: readonly T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return items[(h >>> 0) % items.length];
}

/** A Magna Urbis culture for an FMG name base and culture type, drawn among the fitting ones by `seed`. */
export function pickMuCulture(base: FmgNameBase | undefined, cultureType: string | undefined, seed: string): string | undefined {
  const pool = base ? FMG_BASE_CULTURES[base] : [];
  const type = cultureType?.trim().toLowerCase() ?? '';
  const suited = TYPE_CULTURES[type] ?? [];
  const both = pool.filter(culture => suited.includes(culture));
  const choices = both.length ? both : LIFESTYLE_TYPES.has(type) && suited.length ? suited : pool;
  return choices.length ? draw(choices, `culture:${seed}`) : undefined;
}

const key = (text: string): string => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const BASE_BY_KEY: Readonly<Record<string, FmgNameBase>> = Object.fromEntries(FMG_NAME_BASES.map(base => [key(base), base]));

/** The FMG name base behind a culture name (default culture name, else a base name typed as culture). */
export function fmgNameBase(cultureName: string): FmgNameBase | undefined {
  const k = key(cultureName);
  return FMG_CULTURE_BASES[k] ?? BASE_BY_KEY[k] ?? FMG_BASE_ALIASES[k];
}

/** Magna Urbis culture and toponym language for an FMG culture name, or an empty object. */
export function muCultureForFmg(cultureName: string): { culture?: string; language?: string } {
  const base = fmgNameBase(cultureName);
  return base ? FMG_BASE_TO_MU[base] : {};
}

/** FMG default units (options-model.ts): population scale 1000 people per point, urbanization rate 1. */
export const FMG_POPULATION_SCALE = 1000;
export const FMG_URBANIZATION_RATE = 1;

/** The FMG name base for a culture's `base`: an index in FMG's default order, or a base name. */
export function fmgBaseOf(base: string | number): FmgNameBase | undefined {
  if (typeof base === 'number') return Number.isInteger(base) ? FMG_NAME_BASES[base] : undefined;
  const k = key(base);
  return /^\d+$/.test(k) ? FMG_NAME_BASES[Number(k)] : BASE_BY_KEY[k] ?? FMG_BASE_ALIASES[k];
}

/**
 * FMG default biomes (src/model/physical/biomes-generator.ts; index = biome id) → Magna Urbis biome and
 * climate zone. azgaar.ts refines grassland and deciduous forest with temperature and precipitation.
 */
export const FMG_BIOMES: readonly { name: string; biome?: BiomeName; zone?: ClimateZone }[] = [
  { name: 'Marine' },
  { name: 'Hot desert', biome: 'desert', zone: 'desert' },
  { name: 'Cold desert', biome: 'desert', zone: 'steppe' },
  { name: 'Savanna', biome: 'steppe', zone: 'savanna' },
  { name: 'Grassland', biome: 'steppe', zone: 'steppe' },
  { name: 'Tropical seasonal forest', biome: 'tropical', zone: 'tropical' },
  { name: 'Temperate deciduous forest', biome: 'forest', zone: 'temperate' },
  { name: 'Tropical rainforest', biome: 'tropical', zone: 'tropical' },
  { name: 'Temperate rainforest', biome: 'forest', zone: 'temperate' },
  { name: 'Taiga', biome: 'forest', zone: 'nordic' },
  { name: 'Tundra', biome: 'tundra', zone: 'arctic' },
  { name: 'Glacier', biome: 'tundra', zone: 'arctic' },
  { name: 'Wetland', biome: 'temperate', zone: 'wetland' },
];

/** A default FMG biome by name (a renamed or custom biome falls back to its id when that is a default one). */
export function fmgBiome(id: number | undefined, name: string | undefined): typeof FMG_BIOMES[number] | undefined {
  const byName = name ? FMG_BIOMES.find(b => key(b.name) === key(name)) : undefined;
  return byName ?? (id !== undefined && Number.isInteger(id) ? FMG_BIOMES[id] : undefined);
}
