import type { V2Settings } from './contracts';
import { cultureEra } from '../gen/options';
import { Rng } from '../gen/core/rng';
import { stepSeed } from '../../../rust/bridge/generationSeed';
import { cultureEnvironment } from './environmentCultures';
import type { SettlementSpec } from '../../../rust/bridge/settlements';

export const POPULATION_CLASSES = ['city', 'town', 'village', 'hamlet', 'farmstead'] as const;
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
const HISTORICAL: PopulationProfile = { id: 'historical', density: 75, maximum: 300000, resilience: 1, shares: [.22,.23,.35,.13,.07], means: [40000,5000,450,70,10], isolated: 1 };
const MODERN: PopulationProfile = { id: 'modern', density: 1200, maximum: 5000000, resilience: .5, shares: [.78,.14,.05,.02,.01], means: [450000,12000,650,100,10], isolated: 1.8 };
const MOBILE: PopulationProfile = { id: 'mobile', density: 1.2, maximum: 400, resilience: .8, shares: [0,0,.15,.65,.2], means: [0,0,200,45,6], isolated: .12 };
/** Worldbuilding defaults, not historical limits on a people. Manual populations remain possible. */
export function populationProfile(culture: string): PopulationProfile {
  if (cultureEra(culture)) return { ...MODERN, ...( /highrise|megacity|arcology|cyberpunk/.test(culture) ? { density: 3000, means: [800000,15000,700,110,10] } : {}) };
  if (culture === 'inuit-camp') return { ...MOBILE, id: 'inuit-camp', density: .75, maximum: 120, shares: [0,0,0,.8,.2], resilience: .7, isolated: .04 };
  if (/siberian-camp|nomad-camp|mongol-ordu|native-plains|barbarian-norse/.test(culture)) return MOBILE;
  if (/pnw-plank|guarani|native-iroquoian|kraal|budj-bim/.test(culture)) return { ...MOBILE, id: 'village', density: 4, maximum: 900, shares: [0,0,.55,.35,.1], resilience: .9, isolated: .2 };
  if (/dwarven|duergar/.test(culture)) return { ...HISTORICAL, id: 'mountain', resilience: .55, density: 50 };
  if (/inca|himalayan|caucasian|tibetan|newar/.test(culture)) return { ...HISTORICAL, id: 'terraced', resilience: .7, density: 50 };
  if (/elven|halfling|lizardfolk|myconid/.test(culture)) return { ...HISTORICAL, id: 'dispersed', density: 25, maximum: 10000, shares: [0,.1,.55,.25,.1] };
  return HISTORICAL;
}
const MINIMUM = [20000,1000,150,15,1], MAXIMUM = [5000000,19999,999,149,14];
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
  const defaultDensity = profile.density * environmentFactor, density = d.density ?? defaultDensity;
  const recommendedPopulation = Math.min(100000000, Math.max(0, Math.round(areaKm2 * density)));
  const population = d.population ?? recommendedPopulation;
  const manual = settings.region?.placement;
  if (manual?.mode === 'list' || !manual?.mode && manual?.list?.length) {
    const places = (manual.list ?? []).map(p=>({...p,...(settings.local[p.key]?.population !== undefined ? {population:settings.local[p.key].population!}:{}),...(settings.local[p.key]?.culture ? {culture:settings.local[p.key].culture!}:{})}));
    const counts = Object.fromEntries(POPULATION_CLASSES.map(id=>[id,0])) as Record<PopulationClass,number>;
    places.forEach(p=>counts[POPULATION_CLASSES[MINIMUM.findIndex(min=>p.population>=min)]]++);
    const allocatedPopulation = places.reduce((n,p)=>n+p.population,0), isolatedDensity=d.isolatedDensity??1;
    const expected = Math.min(areaKm2*environmentFactor*.3,allocatedPopulation/25)*profile.isolated*isolatedDensity;
    const isolatedCount=d.isolatedCount??Math.min(1000,Math.max(allocatedPopulation>=15&&expected>0?1:0,Math.round(expected)));
    return {areaKm2,environmentFactor,defaultDensity,density:areaKm2?allocatedPopulation/areaKm2:0,recommendedPopulation,population:allocatedPopulation,allocatedPopulation,counts,places,isolatedDensity,isolatedCount,profile:profile.id,unallocated:0};
  }
  const overrides = { ...settings.region?.placement?.counts, ...d.counts };
  const counts = Object.fromEntries(POPULATION_CLASSES.map(id => [id, 0])) as Record<PopulationClass, number>;
  let carry = 0, capacity = Math.max(0,1000-Object.values(overrides).reduce((n,v)=>n+(v??0),0));
  for (let i = 0; i < POPULATION_CLASSES.length; i++) {
    const id = POPULATION_CLASSES[i], budget = population * profile.shares[i] + carry;
    const mean = Math.min(profile.maximum, profile.means[i]);
    const amount = overrides[id] ?? (profile.maximum >= MINIMUM[i] && mean > 0 ? Math.max(budget >= MINIMUM[i] ? 1 : 0,Math.floor(budget / mean)) : 0);
    counts[id] = overrides[id] ?? Math.min(capacity, amount); if (overrides[id] === undefined) capacity -= counts[id];
    carry = Math.max(0, budget - counts[id] * mean);
  }
  if (population > 0 && !Object.values(counts).some(Boolean)) {
    const index = [...POPULATION_CLASSES.keys()].find(i => MINIMUM[i] <= population && MINIMUM[i] <= profile.maximum && overrides[POPULATION_CLASSES[i]] === undefined);
    if (index !== undefined) counts[POPULATION_CLASSES[index]] = 1;
  }
  const root = new Rng(`regional-population:${stepSeed(settings.options.seed, 'settle-sites')}`);
  const slots: { spec: SettlementSpec; min: number; max: number; weight: number }[] = [];
  for (const [i, id] of POPULATION_CLASSES.entries()) for (let j = 0; j < counts[id]; j++) {
    const key = slots.length ? `${id}-${j}` : 'main', fixed = settings.local[key]?.population;
    const max = overrides[id] === undefined ? Math.min(MAXIMUM[i], profile.maximum) : MAXIMUM[i];
    slots.push({ spec: { key, name: '', population: 0, culture: settings.options.culture, siteType: 'auto', sitePrefs: {} },
      min: fixed ?? MINIMUM[i], max: fixed ?? Math.max(MINIMUM[i], max),
      weight: (profile.means[i] || MINIMUM[i]) * (1 - (settings.region?.placement?.populationJitter ?? .25) + root.fork(`${id}:${j}`).float() * 2 * (settings.region?.placement?.populationJitter ?? .25)) / Math.pow(j + 1, settings.region?.placement?.distribution === 'zipf' ? settings.region.placement.zipfExponent ?? 1.1 : .15) });
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
  const expectedIsolated = Math.min(areaKm2 * environmentFactor * .3, allocatedPopulation / 25) * profile.isolated * isolatedDensity;
  const isolatedCount = d.isolatedCount ?? Math.min(1000, Math.max(allocatedPopulation >= 15 && expectedIsolated > 0 ? 1 : 0, Math.round(expectedIsolated)));
  return { areaKm2, environmentFactor, defaultDensity, density, recommendedPopulation, population, allocatedPopulation, counts, places,
    isolatedDensity, isolatedCount, profile: profile.id, unallocated: population - allocatedPopulation };
}

/** Stable thinning of feasible native activity sites, before they become road destinations. */
export function chooseIsolatedSites<T extends { id: string; residents: number }>(sites: T[], count: number, seed: string): T[] {
  const root = new Rng(`isolated:${stepSeed(seed, 'settle-sites')}`);
  return sites.filter(s => !s.residents).map(site => ({ site, order: root.fork(site.id).float() })).sort((a,b) => a.order - b.order || a.site.id.localeCompare(b.site.id)).slice(0,count).map(s => s.site);
}
