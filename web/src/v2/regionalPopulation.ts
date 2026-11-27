import type { V2Settings } from './contracts';
import { cultureEra } from '../gen/options';
import { contributorCultureBase } from '../gen/contributorCultures';
import { Rng } from '../gen/core/rng';
import { stepSeed } from '../../../rust/bridge/generationSeed';
import { cultureEnvironment } from './environmentCultures';
import type { SettlementSpec } from '../../../rust/bridge/settlements';

export const POPULATION_CLASSES = ['city', 'town', 'village', 'hamlet', 'farmstead'] as const;
export const REGIONAL_POPULATION_VERSION = 'rank-size-regional-population-v6';
export type PopulationClass = (typeof POPULATION_CLASSES)[number];
/** Missing values follow the region; only deliberate overrides travel in a recipe. */
export interface RegionalDemography {
  density?: number;
  population?: number;
  counts?: Partial<Record<PopulationClass, number>>;
  isolatedDensity?: number;
  isolatedCount?: number;
  followCulture?: boolean;
}
export const CLIMATE_SETTLEMENT_FACTORS: Record<string, number> = { temperate: 1, mediterranean: 0.8, continental: 0.65, savanna: 0.55, tropical: 0.55, wetland: 0.35, steppe: 0.22, nordic: 0.12, alpine: 0.08, desert: 0.035, arctic: 0.025 };
export const RELIEF_SETTLEMENT_FACTORS: Record<string, number> = { flat: 1, valley: 0.9, mixed: 0.72, hills: 0.65, plateau: 0.5, mountains: 0.18, 'high-mountains': 0.025, canyon: 0.12, volcano: 0.08, caldera: 0.22 };
interface PopulationProfile {
  id: string;
  density: number;
  /** Largest automatic place. */
  maximum: number;
  resilience: number;
  isolated: number;
}
const HISTORICAL: PopulationProfile = { id: 'historical', density: 75, maximum: 300000, resilience: 1, isolated: 1 };
const MODERN: PopulationProfile = { id: 'modern', density: 1200, maximum: 5000000, resilience: 0.5, isolated: 1.8 };
const MOBILE: PopulationProfile = { id: 'mobile', density: 1.2, maximum: 400, resilience: 0.8, isolated: 0.12 };
/** Worldbuilding defaults, not historical limits on a people. Manual populations remain possible. */
export function populationProfile(culture: string): PopulationProfile {
  culture = contributorCultureBase(culture);
  if (cultureEra(culture)) return { ...MODERN, ...(/highrise|megacity|arcology|cyberpunk/.test(culture) ? { density: 3000 } : {}) };
  if (culture === 'inuit-camp') return { ...MOBILE, id: 'inuit-camp', density: 0.75, maximum: 120, resilience: 0.7, isolated: 0.04 };
  if (/siberian-camp|nomad-camp|mongol-ordu|native-plains|barbarian-norse/.test(culture)) return MOBILE;
  if (/pnw-plank|guarani|native-iroquoian|kraal|budj-bim/.test(culture)) return { ...MOBILE, id: 'village', density: 4, maximum: 900, resilience: 0.9, isolated: 0.2 };
  if (/dwarven|duergar/.test(culture)) return { ...HISTORICAL, id: 'mountain', resilience: 0.55, density: 50 };
  if (/inca|himalayan|caucasian|tibetan|newar/.test(culture)) return { ...HISTORICAL, id: 'terraced', resilience: 0.7, density: 50 };
  if (/elven|halfling|lizardfolk|myconid/.test(culture)) return { ...HISTORICAL, id: 'dispersed', density: 25, maximum: 10000 };
  return HISTORICAL;
}
/** Size bands of the classes counted in the panel. A class is the name of a size: the sizes are drawn first. A farmstead
 * holds one household (`FARM_HOUSEHOLD`); a list entry below it still counts as a farmstead. */
const FARM_HOUSEHOLD = 5;
const MINIMUM = [20000, 1000, 150, 15, FARM_HOUSEHOLD];
const PLACE_MAXIMUM = 5000000;
const MAXIMUM = [PLACE_MAXIMUM, 19999, 999, 149, 14];
/** Inhabitants of a place added to a class that has no automatic place. */
const TYPICAL = [30000, 4000, 400, 50, 8];
/** Performance budget for suggested places. Explicit populations/densities and lists may exceed it. */
export const AUTOMATIC_SETTLEMENT_POPULATION_MAX = 20000;
const AUTOMATIC_PLACES_MAX = 60;
/** Largest ratio between two successive ranks: a small map shows neighbouring sizes instead of one city and its farms. */
const RANK_RATIO_MAX = 5;
/** Growth of the automatic sizes towards the estimated population: the smallest place stays a farmstead. */
const AUTOMATIC_GROWTH_MAX = 7;
/** Automatic places are a readable regional hierarchy, not one simulated site per rural household. Both the map width
 * and the population bound their number; extra residents fill larger settlements. */
export function automaticPlaceLimit(areaKm2: number, population: number): number {
  return population > 0 && areaKm2 > 0 ? Math.min(AUTOMATIC_PLACES_MAX, Math.round(1.5 + 0.6 * Math.sqrt(areaKm2)), Math.round(1.5 + Math.sqrt(population) / 18)) : 0;
}
export const automaticIsolatedLimit = (areaKm2: number): number => Math.min(16, Math.ceil(areaKm2 / 50));
function isolatedSites(areaKm2: number, environmentFactor: number, population: number, profile: PopulationProfile, d: RegionalDemography): number {
  if (d.isolatedCount !== undefined) return d.isolatedCount;
  const expected = Math.min(areaKm2 * environmentFactor * 0.025, Math.sqrt(population / 1000)) * profile.isolated * (d.isolatedDensity ?? 1);
  return population < 15 || expected <= 0 ? 0 : Math.min(automaticIsolatedLimit(areaKm2), Math.max(1, Math.round(expected)));
}
/** Minimum automatic places by map width, so a harsh region (alpine, arctic, desert, Underdark) still has something to
 * look at: 2.4 km about 140 inhabitants in three places, 10 km 600 in six, 40 km 2,400 in twelve. It applies only when
 * the realistic estimate falls below it, and never to a population, density or count the user chose. Several small
 * places rather than one large one: each needs little flat land, so mountain placement can host them. */
const settlementFloor = (widthKm: number): { places: number; population: number } => ({ places: Math.round(0.5 + 1.75 * Math.sqrt(widthKm)), population: Math.round(60 * widthKm) });

/** One place of the plan while its size is drawn. */
interface Slot {
  /** Rank of the draw: the key of the place, whatever its class. */
  index: number;
  population: number;
  min: number;
  max: number;
  /** Class the user fixed the count of. */
  pinned?: number;
}
/** Sizes the slots to a total of `target`, within their bounds: every slot grows by the same factor and levels off
 * towards its maximum (no place piles up on a limit). `growth` caps the factor; the total may then stay below `target`. */
function fitSizes(slots: readonly Slot[], target: number, growth = Infinity): void {
  const sizeAt = (s: Slot, weight: number, t: number) => {
    const span = s.max - s.min;
    return span > 0 ? s.min + (span * t * weight) / (span + t * weight) : s.min;
  };
  const weights = slots.map(s => Math.max(1, s.population - s.min)),
    total = (t: number) => slots.reduce((sum, s, i) => sum + sizeAt(s, weights[i], t), 0);
  const limit = Math.min(growth, 1e9),
    capped = total(limit) <= target;
  let low = capped ? limit : 0,
    high = limit;
  for (let step = 0; !capped && step < 80; step++) {
    const middle = (low + high) / 2;
    if (total(middle) <= target) low = middle;
    else high = middle;
  }
  slots.forEach((s, i) => (s.population = Math.min(s.max, Math.floor(sizeAt(s, weights[i], low)))));
  if (capped && Number.isFinite(growth)) return;
  // Whole inhabitants: the rounding rest goes to the places with room.
  let rest = target - slots.reduce((n, s) => n + s.population, 0);
  while (rest > 0) {
    const room = slots.filter(s => s.population < s.max),
      share = Math.max(1, Math.floor(rest / Math.max(1, room.length)));
    if (!room.length) return;
    for (const s of room) {
      const add = Math.min(s.max - s.population, share, rest);
      s.population += add;
      rest -= add;
    }
  }
}
export interface RankSizeLaw {
  places: number;
  /** Total the sizes should reach. */
  target: number;
  /** Largest size of one place. */
  cap: number;
  /** 1 = geometric ranks; above, a steeper hierarchy. */
  steepness: number;
  /** Relative spread around the law. */
  jitter: number;
  growth?: number;
}
/** A continuous rank-size distribution, largest first: from the largest place the total allows down to one household,
 * sampled at geometric ranks so that a few places already show every size, then fitted to the total. */
export function rankSizes(law: RankSizeLaw, draw: (rank: number) => number): number[] {
  const { places, target } = law,
    cap = Math.max(FARM_HOUSEHOLD, Math.round(law.cap));
  if (places <= 0 || target <= 0) return [];
  const top = Math.max(FARM_HOUSEHOLD, Math.min(cap, 0.75 * target)),
    ratio = places > 1 ? Math.min(RANK_RATIO_MAX, Math.pow(top / FARM_HOUSEHOLD, 1 / (places - 1))) : 1;
  const slots: Slot[] = Array.from({ length: places }, (_, index) => ({
    index,
    population: Math.max(FARM_HOUSEHOLD, (top / Math.pow(ratio, index * law.steepness)) * (1 + law.jitter * (2 * draw(index) - 1))),
    min: FARM_HOUSEHOLD,
    max: cap,
  })).sort((a, b) => b.population - a.population);
  // A household is never split: places are dropped instead.
  while (slots.length > 1 && slots.length * FARM_HOUSEHOLD > target) slots.pop();
  fitSizes(slots, Math.round(target), law.growth);
  return slots.map(s => s.population);
}
/** The band of free classes round class `i`, between the classes the user fixed the count of. */
function freeBand(i: number, pinned: (i: number) => boolean): [number, number] {
  let low = i,
    high = i;
  while (low + 1 < MINIMUM.length && !pinned(low + 1)) low++;
  while (high > 0 && !pinned(high - 1)) high--;
  return [MINIMUM[low], MAXIMUM[high]];
}
/** The free class nearest to class `i`: itself, a smaller one, else a larger one. */
function freeClass(i: number, pinned: (i: number) => boolean): number {
  for (let j = i; j < MINIMUM.length; j++) if (!pinned(j)) return j;
  for (let j = i - 1; j >= 0; j--) if (!pinned(j)) return j;
  return i;
}
function typicalSize(i: number, profile: PopulationProfile): number {
  return Math.max(MINIMUM[i], Math.min(TYPICAL[i], profile.maximum));
}
export interface RegionalPopulationPlan {
  areaKm2: number;
  environmentFactor: number;
  defaultDensity: number;
  density: number;
  recommendedPopulation: number;
  population: number;
  allocatedPopulation: number;
  counts: Record<PopulationClass, number>;
  places: SettlementSpec[];
  /** Typical inhabitants of one place of each class, used when a count edit changes the population. */
  classSizes: Record<PopulationClass, number>;
  isolatedDensity: number;
  isolatedCount: number;
  profile: string;
  unallocated: number;
}
const zeroCounts = () => Object.fromEntries(POPULATION_CLASSES.map(id => [id, 0])) as Record<PopulationClass, number>;

/** One deterministic plan shared by the panel, generation, workers and short-code reconstruction. Sizes come first: a
 * continuous rank-size distribution bounded by the regional population; the class of a place is read from its size, its
 * identity (village or town) from its size, site and culture once it is placed (Rust `demographics::identity`). The
 * number of places follows the map size, biome and culture; the population is their sum. A typed population or density
 * resizes them, keeping their number; a fixed class count adds or removes places of that size. */
export function regionalPopulation(settings: V2Settings): RegionalPopulationPlan {
  const d = settings.region?.demography ?? {},
    env = cultureEnvironment(settings),
    profile = populationProfile(settings.options.culture);
  const width = typeof settings.extent === 'number' ? settings.extent : (settings.options.mapSize ?? 40000);
  const areaKm2 = (width * width) / 1e6;
  const environmentFactor = Math.pow((CLIMATE_SETTLEMENT_FACTORS[env.climate] ?? 0.65) * (RELIEF_SETTLEMENT_FACTORS[env.relief] ?? 0.65), profile.resilience) * (env.coast ? 0.82 : 1) * (env.underdark ? 0.3 : 1);
  const realisticPopulation = Math.min(100000000, Math.max(0, Math.round(areaKm2 * profile.density * environmentFactor)));
  const floor = settlementFloor(width / 1000),
    floored = areaKm2 > 0 && realisticPopulation < floor.population,
    estimate = floored ? floor.population : realisticPopulation;
  const manual = settings.region?.placement;
  if (manual?.mode === 'list' || (!manual?.mode && manual?.list?.length)) {
    const places = withCustomPlaces(
      (manual.list ?? []).map(p => ({ ...p, ...(settings.local[p.key]?.population !== undefined ? { population: settings.local[p.key].population! } : {}), ...(settings.local[p.key]?.culture ? { culture: settings.local[p.key].culture! } : {}) })),
      customPlacesOf(settings),
    );
    const counts = zeroCounts();
    places.forEach(p => counts[classOfPopulation(p.population)]++);
    const allocatedPopulation = places.reduce((n, p) => n + p.population, 0),
      isolatedDensity = d.isolatedDensity ?? 1;
    const isolatedCount = isolatedSites(areaKm2, environmentFactor, allocatedPopulation, profile, d);
    const classSizes = Object.fromEntries(POPULATION_CLASSES.map((id, i) => [id, typicalSize(i, profile)])) as Record<PopulationClass, number>;
    return {
      areaKm2,
      environmentFactor,
      defaultDensity: areaKm2 ? estimate / areaKm2 : 0,
      density: areaKm2 ? allocatedPopulation / areaKm2 : 0,
      recommendedPopulation: estimate,
      population: allocatedPopulation,
      allocatedPopulation,
      counts,
      places,
      classSizes,
      isolatedDensity,
      isolatedCount,
      profile: profile.id,
      unallocated: 0,
    };
  }
  const overrides: Partial<Record<PopulationClass, number>> = { ...manual?.counts, ...d.counts },
    pinned = (i: number) => overrides[POPULATION_CLASSES[i]] !== undefined,
    bandOf = (size: number) => POPULATION_CLASSES.indexOf(classOfPopulation(size));
  const root = new Rng(`regional-population:${stepSeed(settings.options.seed, 'settle-sites')}`),
    draw = (rank: number) => root.fork(`rank:${rank}`).float();
  const law = { steepness: manual?.distribution === 'zipf' ? (manual.zipfExponent ?? 1.1) / 1.1 : 1, jitter: manual?.populationJitter ?? 0.25 };
  // 1. The automatic sizes, bounded by the region's estimate and by the size of one automatic place.
  const number = floored ? floor.places : automaticPlaceLimit(areaKm2, estimate),
    automaticCap = Math.min(AUTOMATIC_SETTLEMENT_POPULATION_MAX, profile.maximum),
    automatic = rankSizes({ ...law, places: number, target: estimate, cap: automaticCap, growth: AUTOMATIC_GROWTH_MAX }, draw);
  const recommendedPopulation = automatic.reduce((n, size) => n + size, 0),
    defaultDensity = areaKm2 ? recommendedPopulation / areaKm2 : 0;
  const classSizes = Object.fromEntries(
    POPULATION_CLASSES.map((id, i) => {
      const own = automatic.filter(size => classOfPopulation(size) === id);
      return [id, own.length ? Math.round(own.reduce((n, size) => n + size, 0) / own.length) : typicalSize(i, profile)];
    }),
  ) as Record<PopulationClass, number>;
  // 2. The sizes for a typed population, at the same number of places. Custom places are fixed: the total includes them.
  const custom = customPlacesOf(settings),
    fixed = custom.reduce((n, p) => n + p.population, 0),
    typed = d.population !== undefined || d.density !== undefined,
    requested = Math.min(100000000, Math.max(0, Math.round(d.population ?? areaKm2 * (d.density ?? 0)))),
    target = typed ? Math.max(0, requested - fixed) : recommendedPopulation;
  const typedCap = Math.min(PLACE_MAXIMUM, automaticCap * Math.max(1, target / Math.max(1, recommendedPopulation))),
    sizes = typed && target !== recommendedPopulation ? rankSizes({ ...law, places: number, target, cap: typedCap }, draw) : automatic;
  // 3. The classes whose count is fixed: their largest places, then added ones of the class's usual size. The automatic
  // size of a place decides which class it counts in, so that a typed population keeps the number of places; a place
  // whose typed size falls in a fixed class stays below it (else above), out of that count.
  const slots: Slot[] = [],
    kept = POPULATION_CLASSES.map(() => 0);
  automatic.slice(0, typed ? sizes.length : undefined).forEach((size, index) => {
    const i = bandOf(size),
      own = pinned(i);
    if (own && kept[i] >= overrides[POPULATION_CLASSES[i]]!) return;
    const [min, max] = own ? [MINIMUM[i], MAXIMUM[i]] : freeBand(freeClass(bandOf(sizes[index]), pinned), pinned);
    if (own) kept[i]++;
    slots.push({ index, population: Math.max(min, Math.min(max, sizes[index])), min, max, ...(own ? { pinned: i } : {}) });
  });
  let added = number;
  POPULATION_CLASSES.forEach((id, i) => {
    for (let j = kept[i]; j < (overrides[id] ?? 0); j++, added++) {
      const spread = j === kept[i] ? 0 : (j % 2 ? 1 : -1) * law.jitter * draw(added);
      slots.push({ index: added, population: Math.max(MINIMUM[i], Math.min(MAXIMUM[i], Math.round(classSizes[id] * (1 + spread)))), min: MINIMUM[i], max: MAXIMUM[i], pinned: i });
    }
  });
  slots.sort((a, b) => b.population - a.population);
  // 4. Keys: the rank of the draw, never a class. The largest place is the main one.
  const keys = new Map(slots.map((s, i) => [s, i ? `site-${s.index}` : 'main']));
  for (const s of slots) {
    const own = settings.local[keys.get(s)!]?.population;
    if (own !== undefined) s.population = s.min = s.max = own;
  }
  const adjustable = (s: Slot) => s.min < s.max;
  if (typed && (Object.keys(overrides).length || slots.some(s => !adjustable(s)))) {
    const minimum = () => slots.reduce((n, s) => n + s.min, 0);
    // Too few people: the smallest free places go first. Fixed counts and populations stay.
    for (let k = slots.length - 1; k >= 0 && minimum() > target; k--) if (slots[k].pinned === undefined && adjustable(slots[k])) slots.splice(k, 1);
    // Too many: a fixed class grows out of its usual sizes rather than leaving people without a place.
    if (slots.reduce((n, s) => n + s.max, 0) < target) for (const s of slots) if (s.pinned !== undefined && adjustable(s)) s.max = PLACE_MAXIMUM;
    fitSizes(slots, target);
  }
  const counts = zeroCounts();
  for (const s of slots) counts[POPULATION_CLASSES[s.pinned ?? bandOf(s.population)]]++;
  for (const place of custom) {
    const replaced = slots.find(s => keys.get(s) === place.key);
    if (replaced) counts[POPULATION_CLASSES[replaced.pinned ?? bandOf(replaced.population)]]--;
    counts[classOfPopulation(place.population)]++;
  }
  const places = withCustomPlaces(
      slots.map((s): SettlementSpec => ({ key: keys.get(s)!, name: '', population: s.population, culture: settings.options.culture, siteType: 'auto', sitePrefs: {} })),
      custom,
    ),
    allocatedPopulation = places.reduce((n, p) => n + p.population, 0),
    population = typed ? Math.max(requested, fixed) : allocatedPopulation;
  const isolatedDensity = d.isolatedDensity ?? 1;
  const isolatedCount = isolatedSites(areaKm2, environmentFactor, allocatedPopulation, profile, d);
  return {
    areaKm2,
    environmentFactor,
    defaultDensity,
    density: !areaKm2 ? 0 : d.population === undefined && d.density !== undefined ? d.density : population / areaKm2,
    recommendedPopulation,
    population,
    allocatedPopulation,
    counts,
    places,
    classSizes,
    isolatedDensity,
    isolatedCount,
    profile: profile.id,
    unallocated: population - allocatedPopulation,
  };
}

/** The class a place of this many inhabitants counts in (a list entry below the farm floor still counts as a farmstead). */
function classOfPopulation(population: number): PopulationClass {
  const c = MINIMUM.findIndex(min => population >= min);
  return POPULATION_CLASSES[c < 0 ? MINIMUM.length - 1 : c];
}
/** The user's custom places (`region.customPlaces`) with their local population and culture edits. */
export function customPlacesOf(settings: V2Settings): SettlementSpec[] {
  return (settings.region?.customPlaces ?? []).map(p => ({ ...p, ...(settings.local[p.key]?.population !== undefined ? { population: settings.local[p.key].population! } : {}), ...(settings.local[p.key]?.culture ? { culture: settings.local[p.key].culture! } : {}) }));
}
/** Places with the custom ones fixed among them: a custom place replaces the place of the same key, the others follow. */
export function withCustomPlaces(places: readonly SettlementSpec[], custom: readonly SettlementSpec[]): SettlementSpec[] {
  const byKey = new Map(custom.map(p => [p.key, p]));
  return [...places.map(p => byKey.get(p.key) ?? p), ...custom.filter(p => !places.some(q => q.key === p.key))];
}

/** Stable thinning of feasible native activity sites, before they become road destinations. */
export function chooseIsolatedSites<T extends { id: string; residents: number }>(sites: T[], count: number, seed: string): T[] {
  const root = new Rng(`isolated:${stepSeed(seed, 'settle-sites')}`);
  return sites
    .filter(s => !s.residents)
    .map(site => ({ site, order: root.fork(site.id).float() }))
    .sort((a, b) => a.order - b.order || a.site.id.localeCompare(b.site.id))
    .slice(0, count)
    .map(s => s.site);
}
