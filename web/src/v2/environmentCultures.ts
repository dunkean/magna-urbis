import { CULTURES, cultureEra } from '../gen/options';
import { Rng } from '../gen/core/rng';
import { seedRoot } from '../../../rust/bridge/generationSeed';
import { climateZoneOf, type ClimateZone } from '../../../rust/bridge/terrainClimate';
import type { V2Settings } from './contracts';
import { UNDERDARK_CULTURES } from './underdarkCultures';
import { effectiveTerrainSettings } from './terrainSettings';
import { adaptedExtent, defaultSettings } from './settings';

export interface CultureHabitat {
  climates: readonly ClimateZone[];
  reliefs: readonly string[];
  coast?: boolean;
}
const habitat = (climates: string, reliefs: string, coast = false): CultureHabitat => ({ climates: climates.split(' ') as ClimateZone[], reliefs: reliefs.split(' '), ...(coast ? { coast } : {}) });
const plains = 'flat valley mixed',
  rolling = 'hills plateau',
  mountains = 'mountains high-mountains';
const lowlands = `${plains} ${rolling}`,
  rocky = `${rolling} ${mountains} canyon volcano caldera`;

/** Deliberately distinctive worldbuilding niches, not claims about historical settlement limits.
 * The full cross-products (climate × relief, plus coast where required) are documented in
 * docs/CULTURE_ENVIRONMENTS_FR.md. Underdark peoples have their own, separate layer. */
export const CULTURE_HABITATS: Readonly<Record<string, CultureHabitat>> = {
  'european-organic': habitat('temperate', lowlands),
  bastide: habitat('temperate mediterranean', plains),
  medina: habitat('desert mediterranean', lowlands),
  chinese: habitat('continental temperate', plains),
  'japanese-jokamachi': habitat('temperate', `${lowlands} mountains volcano caldera`),
  'indian-temple': habitat('savanna tropical', lowlands),
  'roman-core': habitat('mediterranean', plains),
  elven: habitat('temperate wetland', 'hills valley mixed mountains'),
  dwarven: habitat('alpine nordic continental', `${mountains} canyon`),
  necropolis: habitat('desert', `${rolling} canyon volcano caldera`),
  'russian-kremlin': habitat('continental nordic', lowlands),
  aztec: habitat('tropical savanna', 'flat valley plateau'),
  inca: habitat('alpine tropical', `${mountains} plateau canyon`),
  'byzantine-greek': habitat('mediterranean', `${rocky} valley`),
  'venetian-lagoon': habitat('mediterranean wetland', plains, true),
  persian: habitat('desert steppe', 'valley hills plateau mountains canyon'),
  ottoman: habitat('mediterranean', `${lowlands} mountains`),
  sahel: habitat('savanna steppe', plains),
  hanseatic: habitat('temperate nordic', plains, true),
  korean: habitat('continental', `${lowlands} mountains`),
  'wizard-city': habitat('continental alpine wetland', rocky),
  gnomish: habitat('temperate wetland', 'flat valley mixed hills'),
  'stilt-town': habitat('wetland tropical', plains),
  barbarian: habitat('continental', lowlands),
  'barbarian-celtic': habitat('temperate', `${rolling} valley`),
  'barbarian-norse': habitat('nordic', `${lowlands} mountains volcano caldera`),
  'norse-ringfort': habitat('nordic', plains),
  maya: habitat('tropical', `${lowlands} mountains`),
  khmer: habitat('tropical wetland', plains),
  'celtic-oppidum': habitat('temperate', rolling),
  orcish: habitat('steppe', rocky),
  halfling: habitat('temperate', 'hills valley mixed'),
  kraal: habitat('savanna', lowlands),
  'native-iroquoian': habitat('continental', plains),
  'native-pueblo': habitat('desert', 'plateau canyon hills'),
  'native-plains': habitat('steppe', plains),
  'nomad-camp': habitat('steppe desert', `${plains} plateau`),
  'swahili-stone-town': habitat('savanna tropical', lowlands, true),
  'egyptian-planned': habitat('desert', 'flat valley'),
  'nubian-fortified': habitat('desert savanna', 'valley hills plateau'),
  mesopotamian: habitat('desert', 'flat valley mixed'),
  'levantine-tell': habitat('mediterranean desert', 'hills plateau'),
  'oasis-caravan': habitat('desert steppe', 'flat valley plateau'),
  'ksar-oasis': habitat('desert', 'valley plateau canyon'),
  yoruba: habitat('tropical savanna', plains),
  'himalayan-terraces': habitat('alpine desert', `${mountains} plateau valley`),
  newar: habitat('alpine', 'valley hills mixed'),
  'indus-planned': habitat('desert steppe', 'flat valley'),
  'javanese-courts': habitat('tropical', `${lowlands} mountains volcano caldera`),
  mississippian: habitat('temperate wetland', plains),
  'al-andalus': habitat('mediterranean', `${lowlands} mountains`),
  'italian-comune': habitat('mediterranean', `${lowlands} mountains`),
  'flemish-cloth-town': habitat('temperate wetland', 'flat valley mixed'),
  'rynek-town': habitat('continental', lowlands),
  'slavic-gord': habitat('continental wetland', 'flat hills valley mixed'),
  'caucasian-highland': habitat('temperate continental alpine', `${mountains} hills plateau canyon`),
  'ethiopian-highland': habitat('savanna', `${rocky} valley`),
  'great-zimbabwe': habitat('savanna', 'hills plateau mountains'),
  'hausa-kano': habitat('savanna steppe', lowlands),
  'hadhrami-tower': habitat('desert', 'valley canyon plateau'),
  'rajput-fort': habitat('desert savanna', 'hills plateau mountains'),
  'dravidian-temple': habitat('tropical savanna', plains),
  bagan: habitat('savanna', 'flat valley mixed'),
  'vietnamese-citadel': habitat('tropical wetland', plains),
  'tibetan-monastery': habitat('alpine steppe', `flat ${rocky} valley mixed`),
  'mongol-ordu': habitat('steppe', `${lowlands} mountains`),
  'maori-pa': habitat('temperate', 'hills plateau volcano caldera', true),
  'pnw-plank-village': habitat('temperate nordic', `${lowlands} mountains`, true),
  'inuit-camp': habitat('arctic', `${lowlands} canyon`, true),
  'siberian-camp': habitat('arctic nordic', `${lowlands} mountains canyon`),
  'guarani-village': habitat('tropical', `${plains} hills`),
  'budj-bim': habitat('temperate wetland', 'flat valley volcano caldera'),
  'lizardfolk-swamp': habitat('wetland tropical', plains),
  'merfolk-tidal': habitat('temperate mediterranean tropical', 'flat valley mixed canyon', true),
  'giant-hold': habitat('arctic alpine', rocky),
  'goblin-warren': habitat('continental steppe', 'hills plateau canyon mountains'),
};

/** All pre-modern choices, including ancient, tribal and fantasy settings. Modern/future/alien excluded. */
export const MEDIEVAL_CULTURES: readonly string[] = CULTURES.filter(id => !cultureEra(id));

export function cultureEnvironment(settings: V2Settings): { climate: ClimateZone; relief: string; underdark: boolean; coast: boolean } {
  const t = settings.terrain;
  const effective = effectiveTerrainSettings(settings, adaptedExtent(settings));
  const biomeClimate: Record<string, ClimateZone> = { forest: 'continental', tundra: 'arctic' };
  return {
    climate: climateZoneOf(t?.climate) ?? climateZoneOf(t?.climateZone) ?? climateZoneOf(settings.options.biome) ?? biomeClimate[String(settings.options.biome)] ?? 'temperate',
    // The symbolic engine's carrier family is not a user-selected habitat.
    relief: t?.zones ? 'flat' : effective.relief,
    underdark: settings.options.biome === 'underdark',
    coast: effective.procedural?.enabled?.coasts !== false && effective.coastMask !== 0,
  };
}

export function plausibleCultures(settings: V2Settings): readonly string[] {
  const env = cultureEnvironment(settings);
  if (env.underdark) return UNDERDARK_CULTURES;
  return Object.entries(CULTURE_HABITATS)
    .filter(([, h]) => h.climates.includes(env.climate) && h.reliefs.includes(env.relief) && (!h.coast || env.coast))
    .map(([id]) => id);
}

/** The culture of a region when nobody chose one: the default culture where it fits the environment, else a draw of the
 * root seed among those that do. The short code leaves it out. */
export function automaticCulture(settings: V2Settings): string {
  const preferred = defaultSettings().options.culture,
    plausible = plausibleCultures(settings);
  if (!plausible.length || plausible.includes(preferred)) return preferred;
  return randomCulture(settings, true, () => new Rng(`culture:${seedRoot(settings.options.seed)}`).float());
}

/** Uniform draw; a dice click can omit the current choice to make every click useful. */
export function randomCulture(settings: V2Settings, followEnvironment = true, random = Math.random, avoid?: string): string {
  const pool = followEnvironment ? plausibleCultures(settings) : MEDIEVAL_CULTURES;
  const choices = pool.length > 1 && avoid ? pool.filter(id => id !== avoid) : pool;
  return choices[Math.floor(random() * choices.length)];
}
