import type { V2Settings } from './contracts';
import { cultureEra } from '../gen/options';
import { Rng } from '../gen/core/rng';
import { stepSeed } from '../../../rust/bridge/generationSeed';
import { cultureEnvironment } from './environmentCultures';
import type { SettlementSpec } from '../../../rust/bridge/settlements';

export const POPULATION_CLASSES = ['city', 'town', 'village', 'hamlet', 'farmstead'] as const;
export const REGIONAL_POPULATION_VERSION = 'bounded-regional-population-v2';
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
const MINIMUM = [20000,1000,150,15,1], MAXIMUM = [5000000,19999,999,149,14];
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
export interface RegionalPopulationPlan {
  areaKm2: number; environmentFactor: number; defaultDensity: number; density: number;
  recommendedPopulation: number; population: number; allocatedPopulation: number;
  counts: Record<PopulationClass, number>; places: SettlementSpec[];
  isolatedDensity: number; isolatedCount: number; profile: string; unallocated: number;
}

/** One deterministic plan shared by the panel, generation, workers and MU3 reconstruction. */
export function regionalPopulation(settings: V2Settings): RegionalPopulationPlan {
  const d = settings.region?.demography ?? {}, env = cultureEnvironment(settings), profile = populationProfile(settings.options.culture);
  const width = typeof settings.extent === 'number' ? settings.extent : settings.options.mapSize ?? 40000;
  const areaKm2 = width * width / 1e6;
  const environmentFactor = Math.pow((CLIMATE_SETTLEMENT_FACTORS[env.climate] ?? .65) * (RELIEF_SETTLEMENT_FACTORS[env.relief] ?? .65), profile.resilience) * (env.coast ? .82 : 1) * (env.underdark ? .3 : 1);
  const defaultDensity = profile.density * environmentFactor, requestedDensity = d.density ?? defaultDensity;
  const recommendedPopulation = Math.min(100000000, Math.max(0, Math.round(areaKm2 * requestedDensity)));
  const population = d.population ?? recommendedPopulation;
  const density = d.population === undefined ? requestedDensity : areaKm2 ? population / areaKm2 : 0;
  const manual = settings.region?.placement;
  if (manual?.mode === 'list' || !manual?.mode && manual?.list?.length) {
    const places = (manual.list ?? []).map(p=>({...p,...(settings.local[p.key]?.population !== undefined ? {population:settings.local[p.key].population!}:{}),...(settings.local[p.key]?.culture ? {culture:settings.local[p.key].culture!}:{})}));
    const counts = Object.fromEntries(POPULATION_CLASSES.map(id=>[id,0])) as Record<PopulationClass,number>;
    places.forEach(p=>counts[POPULATION_CLASSES[MINIMUM.findIndex(min=>p.population>=min)]]++);
    const allocatedPopulation = places.reduce((n,p)=>n+p.population,0), isolatedDensity=d.isolatedDensity??1;
    const isolatedCount=isolatedSites(areaKm2,environmentFactor,allocatedPopulation,profile,d);
    return {areaKm2,environmentFactor,defaultDensity,density:areaKm2?allocatedPopulation/areaKm2:0,recommendedPopulation,population:allocatedPopulation,allocatedPopulation,counts,places,isolatedDensity,isolatedCount,profile:profile.id,unallocated:0};
  }
  const overrides = { ...settings.region?.placement?.counts, ...d.counts };
  const limits = automaticSettlementLimits(areaKm2, population);
  const counts = Object.fromEntries(POPULATION_CLASSES.map(id => [id, 0])) as Record<PopulationClass, number>;
  let carry = 0, capacity = Math.max(0,1000-Object.values(overrides).reduce((n,v)=>n+(v??0),0));
  for (let i = 0; i < POPULATION_CLASSES.length; i++) {
    const id = POPULATION_CLASSES[i], budget = population * profile.shares[i] + carry;
    const mean = Math.min(profile.maximum, profile.means[i]);
    const amount = overrides[id] ?? (profile.maximum >= MINIMUM[i] && mean > 0 ? Math.max(budget >= MINIMUM[i] ? 1 : 0,Math.floor(budget / mean)) : 0);
    counts[id] = overrides[id] ?? Math.min(capacity, limits[id], amount); if (overrides[id] === undefined) capacity -= counts[id];
    carry = Math.max(0, budget - counts[id] * mean);
  }
  if (population > 0 && !Object.values(counts).some(Boolean)) {
    const index = [...POPULATION_CLASSES.keys()].find(i => MINIMUM[i] <= population && MINIMUM[i] <= profile.maximum && overrides[POPULATION_CLASSES[i]] === undefined);
    if (index !== undefined) counts[POPULATION_CLASSES[index]] = 1;
  }
  const root = new Rng(`regional-population:${stepSeed(settings.options.seed, 'settle-sites')}`);
  type Slot = { spec: SettlementSpec; min: number; max: number; weight: number };
  function makeSlots(): Slot[] {
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
  let slots = makeSlots();
  // Fill the existing class capacities first. If they cannot hold the population, add a
  // larger settlement within the same surface ceiling instead of exceeding a rural cap.
  while (capacity > 0 && slots.reduce((n,s) => n+s.max,0) < population) {
    const floor = slots.reduce((n,s) => n+s.min,0);
    const index = POPULATION_CLASSES.findIndex((id,i) => overrides[id] === undefined && counts[id] < limits[id] && MINIMUM[i] <= population-floor);
    if (index < 0) break;
    counts[POPULATION_CLASSES[index]]++; capacity--; slots = makeSlots();
  }
  const floor = slots.reduce((n, s) => n + s.min, 0), ceiling = slots.reduce((n, s) => n + s.max, 0);
  const target = Math.max(floor, Math.min(population, ceiling));
  slots.forEach(s => s.spec.population = s.min);
  let remaining = target - floor;
  while (remaining > 0) {
    const active = slots.filter(s => s.spec.population < s.max), weight = active.reduce((n, s) => n + s.weight, 0);
    if (!active.length || !weight) break;
    let used = 0;
    for (const s of active) { const add = Math.min(s.max - s.spec.population, Math.floor(remaining * s.weight / weight)); s.spec.population += add; used += add; }
    remaining -= used;
    if (!used) { for (const s of active) { if (!remaining) break; s.spec.population++; remaining--; } }
  }
  const places = slots.map(s => s.spec), allocatedPopulation = places.reduce((n, p) => n + p.population, 0);
  const isolatedDensity = d.isolatedDensity ?? 1;
  const isolatedCount = isolatedSites(areaKm2, environmentFactor, allocatedPopulation, profile, d);
  return { areaKm2, environmentFactor, defaultDensity, density, recommendedPopulation, population, allocatedPopulation, counts, places,
    isolatedDensity, isolatedCount, profile: profile.id, unallocated: population - allocatedPopulation };
}

/** Stable thinning of feasible native activity sites, before they become road destinations. */
export function chooseIsolatedSites<T extends { id: string; residents: number }>(sites: T[], count: number, seed: string): T[] {
  const root = new Rng(`isolated:${stepSeed(seed, 'settle-sites')}`);
  return sites.filter(s => !s.residents).map(site => ({ site, order: root.fork(site.id).float() })).sort((a,b) => a.order - b.order || a.site.id.localeCompare(b.site.id)).slice(0,count).map(s => s.site);
}
