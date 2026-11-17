import type { V2Settings } from './contracts';
import { cultureEra } from '../gen/options';
import { Rng } from '../gen/core/rng';
import { stepSeed } from '../../../rust/bridge/generationSeed';
import { cultureEnvironment } from './environmentCultures';
import type { SettlementSpec } from '../../../rust/bridge/settlements';

export const POPULATION_CLASSES = ['city', 'town', 'village', 'hamlet', 'farmstead'] as const;
export const REGIONAL_POPULATION_VERSION = 'list-first-regional-population-v3';
export type PopulationClass = typeof POPULATION_CLASSES[number];
/** Missing values follow the region; only deliberate overrides travel in a recipe. */
export interface RegionalDemography {
  density?: number;
  population?: number;
  counts?: Partial<Record<PopulationClass, number>>;
  isolatedDensity?: number;
  isolatedCount?: number;
  followCulture?: boolean;
}
export const CLIMATE_SETTLEMENT_FACTORS: Record<string, number> = {
  temperate: 1, mediterranean: .8, continental: .65, savanna: .55, tropical: .55,
  wetland: .35, steppe: .22, nordic: .12, alpine: .08, desert: .035, arctic: .025,
};
export const RELIEF_SETTLEMENT_FACTORS: Record<string, number> = {
  flat: 1, valley: .9, mixed: .72, hills: .65, plateau: .5, mountains: .18,
  'high-mountains': .025, canyon: .12, volcano: .08, caldera: .22,
};
interface PopulationProfile { id: string; density: number; maximum: number; resilience: number; shares: readonly number[]; means: readonly number[]; isolated: number }
const HISTORICAL: PopulationProfile = { id: 'historical', density: 75, maximum: 300000, resilience: 1, shares: [.55,.30,.12,.025,.005], means: [40000,5000,650,100,10], isolated: 1 };
const MODERN: PopulationProfile = { id: 'modern', density: 1200, maximum: 5000000, resilience: .5, shares: [.90,.08,.015,.004,.001], means: [450000,12000,800,110,10], isolated: 1.8 };
const MOBILE: PopulationProfile = { id: 'mobile', density: 1.2, maximum: 400, resilience: .8, shares: [0,0,.15,.65,.2], means: [0,0,200,45,6], isolated: .12 };
/** Worldbuilding defaults, not historical limits on a people. Manual populations remain possible. */
export function populationProfile(culture: string): PopulationProfile {
  if (cultureEra(culture)) return { ...MODERN, ...( /highrise|megacity|arcology|cyberpunk/.test(culture) ? { density: 3000, means: [800000,15000,700,110,10] } : {}) };
  if (culture === 'inuit-camp') return { ...MOBILE, id: 'inuit-camp', density: .75, maximum: 120, shares: [0,0,0,.8,.2], resilience: .7, isolated: .04 };
  if (/siberian-camp|nomad-camp|mongol-ordu|native-plains|barbarian-norse/.test(culture)) return MOBILE;
  if (/pnw-plank|guarani|native-iroquoian|kraal|budj-bim/.test(culture)) return { ...MOBILE, id: 'village', density: 4, maximum: 900, shares: [0,0,.55,.35,.1], resilience: .9, isolated: .2 };
  if (/dwarven|duergar/.test(culture)) return { ...HISTORICAL, id: 'mountain', resilience: .55, density: 50 };
  if (/inca|himalayan|caucasian|tibetan|newar/.test(culture)) return { ...HISTORICAL, id: 'terraced', resilience: .7, density: 50 };
  if (/elven|halfling|lizardfolk|myconid/.test(culture)) return { ...HISTORICAL, id: 'dispersed', density: 25, maximum: 10000, shares: [0,.65,.30,.04,.01] };
  return HISTORICAL;
}
/** Class floors. A farmstead holds one household (`FARM_HOUSEHOLD`); a list entry below it still counts as a farmstead. */
const FARM_HOUSEHOLD = 5;
const MINIMUM = [20000,1000,150,15,FARM_HOUSEHOLD], MAXIMUM = [5000000,19999,999,149,14];
/** Automatic places are a readable regional hierarchy, not one simulated site per rural household.
 * Both area and population bound counts. Extra residents fill larger settlements; these ceilings
 * are never lifted to make room. Explicit counts/list entries remain deliberate overrides. */
export function automaticSettlementLimits(areaKm2: number, population: number): Record<PopulationClass, number> {
  const hard = [32,8,10,6,4], km2PerPlace = [200,100,50,100,150], residents = [100000,10000,2500,10000,20000];
  return Object.fromEntries(POPULATION_CLASSES.map((id,i) => [id, population > 0 && areaKm2 > 0
    ? Math.min(hard[i], Math.ceil(areaKm2 / km2PerPlace[i]), Math.ceil(Math.sqrt(population / residents[i]))) : 0])) as Record<PopulationClass,number>;
}
export const automaticIsolatedLimit = (areaKm2: number): number => Math.min(16, Math.ceil(areaKm2 / 50));
function isolatedSites(areaKm2: number, environmentFactor: number, population: number, profile: PopulationProfile, d: RegionalDemography): number {
  if (d.isolatedCount !== undefined) return d.isolatedCount;
  const expected = Math.min(areaKm2 * environmentFactor * .025, Math.sqrt(population / 1000)) * profile.isolated * (d.isolatedDensity ?? 1);
  return population < 15 || expected <= 0 ? 0 : Math.min(automaticIsolatedLimit(areaKm2), Math.max(1, Math.round(expected)));
}
/** Minimum automatic places by map width, so a harsh region (alpine, arctic, desert, Underdark)
 * still has something to look at. It applies only when the realistic estimate falls below it, and
 * never to a population, density or count the user chose. Several small places rather than one
 * large one: each needs little flat land, so mountain placement can host them. Harsh regions stay
 * well below a temperate one of the same size (temperate 10 km: about 750-6,000 inhabitants). */
const SETTLEMENT_FLOOR: readonly { widthKm: number; counts: readonly number[] }[] = [
  // widthKm = smallest map width of the row; counts = [city, town, village, hamlet, farmstead]
  { widthKm: 0, counts: [0,0,0,1,1] },    // up to 2 km: a hamlet and a farm (~60)
  { widthKm: 2, counts: [0,0,0,2,1] },    // 2.4 km: two hamlets and a farm (~110)
  { widthKm: 5, counts: [0,0,1,1,2] },    // 5 km: a small village, a hamlet, two farms (~370)
  { widthKm: 10, counts: [0,0,1,2,2] },   // 10 km: a village, two hamlets, two farms (~420)
  { widthKm: 20, counts: [0,0,2,3,3] },   // 20 km: two villages (~770)
  { widthKm: 40, counts: [0,1,3,4,4] },   // 40 km: a small town and three villages (~2,600)
  { widthKm: 100, counts: [0,3,6,6,4] },  // 100 km: three small towns (~6,600)
  { widthKm: 200, counts: [0,5,10,6,4] }, // 200 km: five small towns (~10,800)
];
/** Inhabitants of one floor place per class: small, harsh-climate places. */
const FLOOR_SIZE = [20000,1500,300,50,8];
function settlementFloor(widthKm: number, profile: PopulationProfile): { counts: number[]; population: number } {
  const row = [...SETTLEMENT_FLOOR].reverse().find(r => widthKm >= r.widthKm) ?? SETTLEMENT_FLOOR[0];
  const counts = [0,0,0,0,0];
  // A culture without a class (camps) gets the largest class it builds instead.
  row.counts.forEach((n,i) => { let j = i; while (j < MINIMUM.length - 1 && MINIMUM[j] > profile.maximum) j++; counts[j] += n; });
  return { counts, population: counts.reduce((n,c,i) => n + c * Math.max(MINIMUM[i], Math.min(FLOOR_SIZE[i], profile.maximum)), 0) };
}
function typicalSize(i: number, profile: PopulationProfile): number {
  return Math.max(MINIMUM[i], Math.min(MAXIMUM[i], Math.min(profile.maximum, profile.means[i]) || MINIMUM[i]));
}
export interface RegionalPopulationPlan {
  areaKm2: number; environmentFactor: number; defaultDensity: number; density: number;
  recommendedPopulation: number; population: number; allocatedPopulation: number;
  counts: Record<PopulationClass, number>; places: SettlementSpec[];
  /** Typical inhabitants of one place of each class, used when a count edit changes the population. */
  classSizes: Record<PopulationClass, number>;
  isolatedDensity: number; isolatedCount: number; profile: string; unallocated: number;
}
const zeroCounts = () => Object.fromEntries(POPULATION_CLASSES.map(id => [id, 0])) as Record<PopulationClass, number>;
const classOf = (key: string, first: PopulationClass) => key === 'main' ? first : key.replace(/-\d+$/, '') as PopulationClass;

/** One deterministic plan shared by the panel, generation, workers and MU3 reconstruction.
 * The list of places is primary: its counts come from the map size, biome and culture (never from
 * a population the user typed). The population is the sum of the places: adding a town adds its
 * inhabitants; a typed population or density only resizes the places, keeping their number, and
 * moves a place up or down one class when its class cannot hold the new size. */
export function regionalPopulation(settings: V2Settings): RegionalPopulationPlan {
  const d = settings.region?.demography ?? {}, env = cultureEnvironment(settings), profile = populationProfile(settings.options.culture);
  const width = typeof settings.extent === 'number' ? settings.extent : settings.options.mapSize ?? 40000;
  const areaKm2 = width * width / 1e6;
  const environmentFactor = Math.pow((CLIMATE_SETTLEMENT_FACTORS[env.climate] ?? .65) * (RELIEF_SETTLEMENT_FACTORS[env.relief] ?? .65), profile.resilience) * (env.coast ? .82 : 1) * (env.underdark ? .3 : 1);
  const realisticPopulation = Math.min(100000000, Math.max(0, Math.round(areaKm2 * profile.density * environmentFactor)));
  const floor = areaKm2 > 0 ? settlementFloor(width / 1000, profile) : { counts: [0,0,0,0,0], population: 0 };
  const floored = realisticPopulation < floor.population;
  const recommendedPopulation = floored ? floor.population : realisticPopulation;
  const defaultDensity = areaKm2 ? recommendedPopulation / areaKm2 : profile.density * environmentFactor;
  const manual = settings.region?.placement;
  if (manual?.mode === 'list' || !manual?.mode && manual?.list?.length) {
    const places = (manual.list ?? []).map(p=>({...p,...(settings.local[p.key]?.population !== undefined ? {population:settings.local[p.key].population!}:{}),...(settings.local[p.key]?.culture ? {culture:settings.local[p.key].culture!}:{})}));
    const counts = zeroCounts();
    places.forEach(p=>{const c=MINIMUM.findIndex(min=>p.population>=min);counts[POPULATION_CLASSES[c<0?MINIMUM.length-1:c]]++;});
    const allocatedPopulation = places.reduce((n,p)=>n+p.population,0), isolatedDensity=d.isolatedDensity??1;
    const isolatedCount=isolatedSites(areaKm2,environmentFactor,allocatedPopulation,profile,d);
    const classSizes = Object.fromEntries(POPULATION_CLASSES.map((id,i)=>[id,typicalSize(i,profile)])) as Record<PopulationClass,number>;
    return {areaKm2,environmentFactor,defaultDensity,density:areaKm2?allocatedPopulation/areaKm2:0,recommendedPopulation,population:allocatedPopulation,allocatedPopulation,counts,places,classSizes,isolatedDensity,isolatedCount,profile:profile.id,unallocated:0};
  }
  const overrides: Partial<Record<PopulationClass, number>> = { ...settings.region?.placement?.counts, ...d.counts };
  const free = (i: number) => i >= 0 && overrides[POPULATION_CLASSES[i]] === undefined;
  const root = new Rng(`regional-population:${stepSeed(settings.options.seed, 'settle-sites')}`);
  type Slot = { spec: SettlementSpec; min: number; max: number; weight: number };
  function makeSlots(counts: Record<PopulationClass, number>): Slot[] {
    const slots: Slot[] = [];
    for (const [i, id] of POPULATION_CLASSES.entries()) for (let j = 0; j < counts[id]; j++) {
      const key = slots.length ? `${id}-${j}` : 'main', fixed = settings.local[key]?.population;
      // Cultural maxima guide the initial composition, not an absolute size limit that forces
      // a large requested population into hundreds of camps, villages or farmsteads.
      slots.push({ spec: { key, name: '', population: 0, culture: settings.options.culture, siteType: 'auto', sitePrefs: {} },
        min: fixed ?? MINIMUM[i], max: fixed ?? MAXIMUM[i],
        weight: (profile.means[i] || MINIMUM[i]) * (1 - (settings.region?.placement?.populationJitter ?? .25) + root.fork(`${id}:${j}`).float() * 2 * (settings.region?.placement?.populationJitter ?? .25)) / Math.pow(j + 1, settings.region?.placement?.distribution === 'zipf' ? settings.region.placement.zipfExponent ?? 1.1 : .15) });
    }
    return slots;
  }
  /** Spreads `population` over the slots: each starts at its class minimum, the rest goes by weight. */
  function allocate(slots: Slot[], population: number): void {
    const minimum = slots.reduce((n, s) => n + s.min, 0), ceiling = slots.reduce((n, s) => n + s.max, 0);
    slots.forEach(s => s.spec.population = s.min);
    let remaining = Math.max(minimum, Math.min(population, ceiling)) - minimum;
    while (remaining > 0) {
      const active = slots.filter(s => s.spec.population < s.max), weight = active.reduce((n, s) => n + s.weight, 0);
      if (!active.length || !weight) break;
      let used = 0;
      for (const s of active) { const add = Math.min(s.max - s.spec.population, Math.floor(remaining * s.weight / weight)); s.spec.population += add; used += add; }
      remaining -= used;
      if (!used) { for (const s of active) { if (!remaining) break; s.spec.population++; remaining--; } }
    }
  }
  // 1. The automatic list: the floor table, or the realistic regional hierarchy built from shares.
  // Area and population both bound the counts; extra residents fill larger settlements.
  const automatic = zeroCounts();
  if (floored) POPULATION_CLASSES.forEach((id,i) => automatic[id] = floor.counts[i]);
  else {
    const limits = automaticSettlementLimits(areaKm2, recommendedPopulation);
    let carry = 0, capacity = 1000;
    for (let i = 0; i < POPULATION_CLASSES.length; i++) {
      const id = POPULATION_CLASSES[i], budget = recommendedPopulation * profile.shares[i] + carry;
      const mean = Math.min(profile.maximum, profile.means[i]);
      const amount = profile.maximum >= MINIMUM[i] && mean > 0 ? Math.max(budget >= MINIMUM[i] ? 1 : 0, Math.floor(budget / mean)) : 0;
      automatic[id] = Math.min(capacity, limits[id], amount); capacity -= automatic[id];
      carry = Math.max(0, budget - automatic[id] * mean);
    }
    if (recommendedPopulation > 0 && !Object.values(automatic).some(Boolean)) {
      const index = [...POPULATION_CLASSES.keys()].find(i => MINIMUM[i] <= recommendedPopulation && MINIMUM[i] <= profile.maximum);
      if (index !== undefined) automatic[POPULATION_CLASSES[index]] = 1;
    }
  }
  // 2. Typical size of one place per class in that automatic list.
  const automaticSlots = makeSlots(automatic); allocate(automaticSlots, recommendedPopulation);
  const firstAutomatic = POPULATION_CLASSES.find(id => automatic[id] > 0) ?? 'farmstead';
  const classSizes = Object.fromEntries(POPULATION_CLASSES.map((id,i) => {
    const own = automaticSlots.filter(s => classOf(s.spec.key, firstAutomatic) === id);
    return [id, own.length ? Math.round(own.reduce((n,s) => n + s.spec.population, 0) / own.length) : typicalSize(i, profile)];
  })) as Record<PopulationClass, number>;
  // 3. The population: typed, or the automatic one plus the inhabitants of places added or removed.
  const counts = zeroCounts();
  POPULATION_CLASSES.forEach(id => counts[id] = overrides[id] ?? automatic[id]);
  const added = POPULATION_CLASSES.reduce((n,id) => n + (counts[id] - automatic[id]) * classSizes[id], 0);
  const population = Math.min(100000000, Math.max(0, Math.round(d.population ?? (d.density !== undefined ? areaKm2 * d.density : recommendedPopulation + added))));
  const density = d.population === undefined && d.density !== undefined ? d.density : areaKm2 ? population / areaKm2 : 0;
  // 4. Fit the list to that population, keeping the number of places whenever a class change can.
  if (population <= 0) POPULATION_CLASSES.forEach((id,i) => { if (free(i)) counts[id] = 0; });
  const limits = automaticSettlementLimits(areaKm2, population);
  let capacity = Math.max(0, 1000 - Object.values(counts).reduce((n,v) => n + v, 0));
  const largestFree = () => POPULATION_CLASSES.findIndex((id,i) => counts[id] > 0 && free(i));
  // Class changes skip the classes whose count the user fixed.
  const nextFree = (i: number, step: number) => { let j = i + step; while (j >= 0 && j < POPULATION_CLASSES.length && !free(j)) j += step; return j >= 0 && j < POPULATION_CLASSES.length ? j : -1; };
  let slots = makeSlots(counts);
  // Too many people for the classes: the largest automatic place moves up a class, else a larger
  // settlement is added within the surface ceilings (never extra rural places).
  while (slots.reduce((n,s) => n + s.max, 0) < population) {
    const i = largestFree(), j = i >= 0 ? nextFree(i, -1) : -1, up = POPULATION_CLASSES[j];
    if (j >= 0 && counts[up] < Math.max(1, limits[up])) { counts[POPULATION_CLASSES[i]]--; counts[up]++; }
    else {
      const minimum = slots.reduce((n,s) => n + s.min, 0);
      const index = POPULATION_CLASSES.findIndex((id,k) => free(k) && counts[id] < limits[id] && MINIMUM[k] <= population - minimum);
      if (index < 0 || capacity <= 0) break;
      counts[POPULATION_CLASSES[index]]++; capacity--;
    }
    slots = makeSlots(counts);
  }
  // Too few people: the largest automatic place moves down a class; once none can, the last
  // automatic place is dropped. A farmstead is one household, never a remainder of one or two people.
  while (slots.reduce((n,s) => n + s.min, 0) > population) {
    const i = largestFree(), j = i >= 0 ? nextFree(i, 1) : -1;
    if (j >= 0) { counts[POPULATION_CLASSES[i]]--; counts[POPULATION_CLASSES[j]]++; slots = makeSlots(counts); continue; }
    let k = slots.length - 1;
    const first = POPULATION_CLASSES.find(id => counts[id] > 0) ?? 'farmstead';
    while (k > 0 && (settings.local[slots[k].spec.key]?.population !== undefined || !free(POPULATION_CLASSES.indexOf(classOf(slots[k].spec.key, first))))) k--;
    if (k <= 0) break;
    counts[classOf(slots[k].spec.key, first)]--; slots = makeSlots(counts);
  }
  allocate(slots, population);
  const places = slots.map(s => s.spec), allocatedPopulation = places.reduce((n, p) => n + p.population, 0);
  const isolatedDensity = d.isolatedDensity ?? 1;
  const isolatedCount = isolatedSites(areaKm2, environmentFactor, allocatedPopulation, profile, d);
  return { areaKm2, environmentFactor, defaultDensity, density, recommendedPopulation, population, allocatedPopulation, counts, places, classSizes,
    isolatedDensity, isolatedCount, profile: profile.id, unallocated: population - allocatedPopulation };
}

/** Stable thinning of feasible native activity sites, before they become road destinations. */
export function chooseIsolatedSites<T extends { id: string; residents: number }>(sites: T[], count: number, seed: string): T[] {
  const root = new Rng(`isolated:${stepSeed(seed, 'settle-sites')}`);
  return sites.filter(s => !s.residents).map(site => ({ site, order: root.fork(site.id).float() })).sort((a,b) => a.order - b.order || a.site.id.localeCompare(b.site.id)).slice(0,count).map(s => s.site);
}
