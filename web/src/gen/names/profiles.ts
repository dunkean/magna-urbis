import { Rng } from '../core/rng';
import type { NameFamily } from './types';

/** Every profile declares its source policy; geographic pools never imply historical authenticity. */
export type ToponymSourceMode = 'country' | 'constructed' | 'generator';
export type ToponymCoherence = 'modern-geographic' | 'fictional-phonotactic' | 'fantasy-generator';
export interface ToponymProfile {
  id: string;
  family: NameFamily;
  sourceMode: ToponymSourceMode;
  coherence: ToponymCoherence;
  /** Explicitly authored grammar, also used for missing feature kinds in geographic pools. */
  rootGrammar: string;
  country?: string;
  generator?: string;
  diagnostic?: string;
}

const geographic = (id: string, family: NameFamily, country: string): ToponymProfile => ({
  id, family, country, rootGrammar: id, sourceMode: 'country', coherence: 'modern-geographic',
});
const constructed = (id: string, family: NameFamily): ToponymProfile => ({
  id, family, rootGrammar: id, sourceMode: 'constructed', coherence: 'fictional-phonotactic',
  diagnostic: 'Original fictional phonotactics; no claim of authentic language or historical attestation',
});
const fantasy = (id: string, family: NameFamily, generator: string): ToponymProfile => ({
  id, family, generator: `towns_and_cities.${generator}`, rootGrammar: id,
  sourceMode: 'generator', coherence: 'fantasy-generator',
});
const P = {
  french: geographic('french', 'french', 'FR'), english: geographic('english', 'english', 'GB'),
  german: geographic('german', 'german', 'DE'), italian: geographic('italian', 'italian', 'IT'),
  arabic: geographic('arabic', 'arabic', 'MA'), chinese: geographic('chinese', 'chinese', 'CN'),
  japanese: geographic('japanese', 'japanese', 'JP'), sanskrit: constructed('sanskrit', 'sanskrit'),
  norse: constructed('norse', 'norse'),
  elven: fantasy('elven', 'elven', 'elven_citys'), dwarven: fantasy('dwarven', 'dwarven', 'dwarven_citys'),
  orcish: fantasy('orcish', 'orcish', 'orcish_citys'), halfling: fantasy('halfling', 'halfling', 'fantasy_towns'),
  greek: constructed('greek', 'italian'), persian: geographic('persian', 'arabic', 'IR'),
  dutch: geographic('dutch', 'german', 'NL'), roman: constructed('roman', 'italian'),
  turkish: geographic('turkish', 'arabic', 'TR'), korean: geographic('korean', 'chinese', 'KR'),
  russian: geographic('russian', 'norse', 'RU'), polish: geographic('polish', 'german', 'PL'),
  slavic: constructed('slavic', 'norse'), celtic: constructed('celtic', 'english'),
  maya: constructed('maya', 'sanskrit'), aztec: constructed('aztec', 'sanskrit'),
  andean: constructed('andean', 'sanskrit'), khmer: constructed('khmer', 'sanskrit'),
  sahel: constructed('sahel', 'arabic'), swahili: constructed('swahili', 'arabic'),
  southernAfrican: constructed('southern-african', 'arabic'), westAfrican: constructed('west-african', 'arabic'),
  egyptian: constructed('egyptian', 'arabic'), nubian: constructed('nubian', 'arabic'),
  mesopotamian: constructed('mesopotamian', 'arabic'), levantine: constructed('levantine', 'arabic'),
  himalayan: constructed('himalayan', 'sanskrit'), javanese: constructed('javanese', 'sanskrit'),
  burmese: constructed('burmese', 'sanskrit'), vietnamese: geographic('vietnamese', 'chinese', 'VN'),
  tibetan: constructed('tibetan', 'sanskrit'), mongolian: constructed('mongolian', 'norse'),
  maori: constructed('maori', 'sanskrit'),
  iroquoian: constructed('iroquoian', 'english'), pueblo: constructed('pueblo', 'english'),
  plains: constructed('plains', 'english'), mississippian: constructed('mississippian', 'english'),
  pnw: constructed('pnw', 'english'), inuit: constructed('inuit', 'norse'),
  siberian: constructed('siberian', 'norse'), guarani: constructed('guarani', 'sanskrit'),
  australian: constructed('australian', 'english'),
  caucasian: constructed('caucasian', 'italian'), ethiopian: constructed('ethiopian', 'arabic'),
  dravidian: constructed('dravidian', 'sanskrit'), arabian: constructed('arabian', 'arabic'),
} satisfies Record<string, ToponymProfile>;

/** Explicit mapping covers the native catalogue and the web culture registry. */
export const CULTURE_PROFILES: Readonly<Record<string, ToponymProfile>> = {
  'european-organic': P.french, bastide: P.french, medina: P.arabic, chinese: P.chinese,
  'japanese-jokamachi': P.japanese, 'indian-temple': P.sanskrit, 'roman-core': P.roman,
  elven: P.elven, dwarven: P.dwarven, necropolis: P.orcish, 'russian-kremlin': P.russian,
  aztec: P.aztec, inca: P.andean, 'byzantine-greek': P.greek, 'venetian-lagoon': P.italian,
  persian: P.persian, ottoman: P.turkish, sahel: P.sahel, hanseatic: P.german, korean: P.korean,
  'wizard-city': P.elven, gnomish: P.dwarven, 'stilt-town': P.halfling, barbarian: P.german,
  'barbarian-celtic': P.celtic, 'barbarian-norse': P.norse, 'norse-ringfort': P.norse, norse: P.norse,
  maya: P.maya, khmer: P.khmer, 'celtic-oppidum': P.celtic, orcish: P.orcish, halfling: P.halfling,
  kraal: P.southernAfrican, 'native-iroquoian': P.iroquoian, 'native-pueblo': P.pueblo,
  'native-plains': P.plains, 'nomad-camp': P.mongolian, 'swahili-stone-town': P.swahili,
  'drow-enclave': P.elven, 'duergar-hold': P.dwarven, 'myconid-colony': P.elven,
  'egyptian-planned': P.egyptian, 'nubian-fortified': P.nubian, mesopotamian: P.mesopotamian,
  'levantine-tell': P.levantine, 'oasis-caravan': P.arabian, 'ksar-oasis': P.arabic,
  yoruba: P.westAfrican, 'himalayan-terraces': P.himalayan, newar: P.himalayan,
  'indus-planned': P.sanskrit, 'javanese-courts': P.javanese, mississippian: P.mississippian,
  'al-andalus': P.arabic, 'italian-comune': P.italian, 'flemish-cloth-town': P.dutch,
  'rynek-town': P.polish, 'slavic-gord': P.slavic, 'caucasian-highland': P.caucasian,
  'ethiopian-highland': P.ethiopian, 'great-zimbabwe': P.southernAfrican, 'hausa-kano': P.westAfrican,
  'hadhrami-tower': P.arabian, 'rajput-fort': P.sanskrit, 'dravidian-temple': P.dravidian,
  bagan: P.burmese, 'vietnamese-citadel': P.vietnamese, 'tibetan-monastery': P.tibetan,
  'mongol-ordu': P.mongolian, 'maori-pa': P.maori, 'pnw-plank-village': P.pnw,
  'inuit-camp': P.inuit, 'siberian-camp': P.siberian, 'guarani-village': P.guarani,
  'budj-bim': P.australian, 'lizardfolk-swamp': P.orcish, 'merfolk-tidal': P.elven,
  'giant-hold': P.norse, 'goblin-warren': P.orcish,
};
const EXPLICIT: Record<string, ToponymProfile> = Object.fromEntries(Object.values(P).map(value => [value.id, value]));

export function resolveToponymProfile(culture: string, language?: string, seed: string | number = ''): ToponymProfile {
  const requested = language?.trim().toLowerCase();
  if (requested && requested !== 'auto') {
    if (EXPLICIT[requested]) return EXPLICIT[requested];
    return { ...(CULTURE_PROFILES[culture] ?? P.french), diagnostic: `Unknown language: ${language}; using culture profile` };
  }
  if (culture === 'european-organic') return new Rng(String(seed)).fork('profile').chance(0.5) ? P.french : P.english;
  return CULTURE_PROFILES[culture] ?? { ...P.french, diagnostic: `Unknown culture: ${culture}; using french profile` };
}
