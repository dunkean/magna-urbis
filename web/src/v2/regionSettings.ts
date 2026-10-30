import type { RoadConfig, SettlementConfig, SettlementSpec } from '../../../rust/bridge/settlements';
import type { V2Settings } from './contracts';
import { CULTURES, SITE_ARCHETYPES, SIZE_SHORTCUT } from '../gen/options';
import { TERRAIN_RELIEFS } from './terrainSettings';

export interface V2RegionSettings {
  placement?: Partial<SettlementConfig>;
  /** null disables regional roads. */
  roads?: Partial<RoadConfig> | null;
  resolution?: number;
}
export const regionSpec = (key='main',population=300):SettlementSpec => ({key,name:'',population,culture:'european-organic',siteType:'auto',sitePrefs:{}});
export function effectiveRegion(settings:V2Settings):{placement:SettlementConfig;roads:RoadConfig|null;resolution:number}{
  const o=settings.options, p=settings.region?.placement, local=settings.local.main??{};
  const secondary=Math.max(0,settings.settlementCount-1),village=Math.ceil(secondary*2/3);
  const placement:SettlementConfig={
    mode:settings.settlementCount?'counts':'auto',distribution:'classes',main:regionSpec(),
    counts:{city:0,town:0,village,hamlet:secondary-village,farmstead:0},list:[],relief:settings.terrain?.relief??o.relief,
    density:1,zipfExponent:1.1,minPopulation:8,populationJitter:.25,spread:1.3,smallTop:.35,mainClear:2.5,clustering:0,edgeMargin:.03,
    flatnessWeight:1,buildableWeight:1,freshWaterWeight:1,riverWeight:1,coastWeight:1,floodWeight:1,defenseWeight:0,elevation:0,variationWeight:1,siteWeights:{},...p,
  };
  const mainPopulation = local.population ?? (o.population > 0 ? o.population : SIZE_SHORTCUT[o.size]);
  placement.main={...regionSpec('main',mainPopulation),culture:o.culture,siteType:o.siteType??'auto',position:o.center,sitePrefs:o.sitePrefs??{},...p?.main,key:'main'};
  if (local.population !== undefined) placement.main.population = local.population;
  if (local.culture !== undefined) placement.main.culture = local.culture;
  if (local.siteType !== undefined) placement.main.siteType = local.siteType;
  if (local.center !== undefined) placement.main.position = local.center;
  if (local.sitePrefs !== undefined) placement.main.sitePrefs = { ...placement.main.sitePrefs, ...local.sitePrefs,
    weights: { ...placement.main.sitePrefs.weights, ...local.sitePrefs.weights } };
  placement.counts={city:0,town:0,village,hamlet:secondary-village,farmstead:0,...p?.counts};
  placement.list=(p?.list??[]).map((spec,index)=>{
    const overrides = settings.local[spec.key] ?? {};
    return {...regionSpec(index?'place-'+index:'main'),...spec,
      ...(overrides.center ? {position:overrides.center}:{}),
      ...(overrides.population!==undefined?{population:overrides.population}:{}),
      ...(overrides.culture?{culture:overrides.culture}:{}),
      ...(overrides.siteType?{siteType:overrides.siteType}:{}),
      ...(overrides.sitePrefs?{sitePrefs:{...spec.sitePrefs,...overrides.sitePrefs,weights:{...spec.sitePrefs?.weights,...overrides.sitePrefs.weights}}}:{})};
  });
  const roads=settings.region?.roads===null?null:{level:'rural',surface:'auto',culture:'auto',density:.5,gradeWeight:1,maxGrade:0,crossingCost:1,wobble:1,sharing:.7,exits:o.roads??2,...settings.region?.roads} as RoadConfig;
  return {placement,roads,resolution:settings.region?.resolution??512};
}
/** Mirrors core/settlements/mod.rs::validate and roads/mod.rs::validate. */
export function validateRegionSettings(value: unknown, width = 100000): void {
  const object = (item: unknown, name: string): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid ${name}.`);
    return item as Record<string, unknown>;
  };
  const fields = (item: Record<string, unknown>, allowed: readonly string[], name: string) => {
    for (const key of Object.keys(item)) if (!allowed.includes(key)) throw new Error(`Unknown ${name} parameter: ${key}.`);
  };
  const number = (entry: unknown, name: string, min: number, max: number, integer = false) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < min || entry > max || integer && !Number.isInteger(entry)) throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} in ${min}–${max}.`);
  };
  const enumeration = (entry: unknown, allowed: readonly unknown[], name: string) => { if (entry !== undefined && !allowed.includes(entry)) throw new Error(`Unknown ${name}.`); };
  const text = (entry: unknown, name: string, max = 300) => { if (entry !== undefined && (typeof entry !== 'string' || entry.length > max)) throw new Error(`Invalid ${name}.`); };
  const weights = (entry: unknown, name: string, max = 10) => {
    const map = object(entry, name); fields(map, SITE_ARCHETYPES, name);
    for (const [key, weight] of Object.entries(map)) number(weight, `${name}.${key}`, 0, max);
  };
  const spec = (entry: unknown, name: string, partial: boolean) => {
    const s = object(entry, name); fields(s, ['key', 'name', 'population', 'culture', 'siteType', 'position', 'sitePrefs'], name);
    if (!partial || s.key !== undefined) if (typeof s.key !== 'string' || !/^[\w:-]{1,80}$/.test(s.key)) throw new Error('Place keys must be stable identifiers.');
    if (!partial || s.population !== undefined) number(s.population, `${name}.population`, 1, 5000000, true);
    text(s.name, `${name}.name`);
    enumeration(s.culture, [...CULTURES, 'medieval'], `${name} culture`);
    enumeration(s.siteType, ['auto', ...SITE_ARCHETYPES], `${name} site archetype`);
    if (s.position !== undefined) {
      const p = object(s.position, `${name}.position`); fields(p, ['x', 'y'], 'position');
      if (p.x === undefined || p.y === undefined) throw new Error('A manual place position needs both X and Y.');
      number(p.x, `${name}.position.x`, 0, width); number(p.y, `${name}.position.y`, 0, width);
      if ((p.x as number) >= width || (p.y as number) >= width) throw new Error('A manual place position must be inside the map.');
    }
    if (s.sitePrefs !== undefined) {
      const prefs = object(s.sitePrefs, `${name}.sitePrefs`); fields(prefs, ['mountainFace', 'woodland', 'weights'], 'site preferences');
      for (const key of ['mountainFace', 'woodland']) if (prefs[key] !== undefined) number(prefs[key], key, 0, 10);
      if (prefs.weights !== undefined) weights(prefs.weights, `${name}.sitePrefs.weights`);
    }
  };
  const region = object(value, 'regional settings'); fields(region, ['placement', 'roads', 'resolution'], 'region');
  if (region.resolution !== undefined) number(region.resolution, 'Regional raster resolution', 64, 1024, true);
  if (region.placement !== undefined) {
    const p = object(region.placement, 'placement settings');
    const limits: Record<string, readonly [number, number]> = { density: [0, 10], zipfExponent: [.3, 3], minPopulation: [1, 100000], populationJitter: [0, 1], spread: [.1, 100], smallTop: [0, 1], mainClear: [0, 100], clustering: [0, 100], edgeMargin: [0, .3], flatnessWeight: [0, 100], buildableWeight: [0, 100], freshWaterWeight: [0, 100], riverWeight: [0, 100], coastWeight: [0, 100], floodWeight: [0, 100], defenseWeight: [0, 100], elevation: [-1, 1], variationWeight: [0, 100] };
    fields(p, ['mode', 'distribution', 'main', 'counts', 'list', 'relief', 'siteWeights', ...Object.keys(limits)], 'placement');
    enumeration(p.mode, ['auto', 'counts', 'list'], 'regional composition'); enumeration(p.distribution, ['classes', 'zipf'], 'population distribution'); enumeration(p.relief, TERRAIN_RELIEFS, 'regional relief');
    for (const [key, range] of Object.entries(limits)) if (p[key] !== undefined) number(p[key], `placement.${key}`, ...range, key === 'minPopulation');
    if (p.main !== undefined) spec(p.main, 'main settlement', true);
    if (p.siteWeights !== undefined) weights(p.siteWeights, 'placement.siteWeights', 100);
    if (p.counts !== undefined) {
      const counts = object(p.counts, 'settlement counts'); fields(counts, ['city', 'town', 'village', 'hamlet', 'farmstead'], 'counts');
      let total = 0; for (const count of Object.values(counts)) { number(count, 'Class count', 0, 1000, true); total += count as number; }
      if (total > 1000) throw new Error('Regional class counts support up to 1000 secondary places in total.');
    }
    if (p.list !== undefined) {
      if (!Array.isArray(p.list) || p.list.length > 1000) throw new Error('A regional list supports up to 1000 places.');
      const keys = new Set<unknown>(); for (const entry of p.list) { spec(entry, 'manual settlement', false); const key = (entry as SettlementSpec).key; if (keys.has(key)) throw new Error('Place keys must be unique stable identifiers.'); keys.add(key); }
    }
  }
  if (region.roads !== undefined && region.roads !== null) {
    const r = object(region.roads, 'road settings');
    const limits: Record<string, readonly [number, number]> = { density: [0, 1], gradeWeight: [0, 10], maxGrade: [0, 1], crossingCost: [.05, 10], wobble: [0, 5], sharing: [0, 1], exits: [0, 16] };
    fields(r, ['level', 'surface', 'culture', ...Object.keys(limits)], 'roads');
    enumeration(r.level, ['primitive', 'rural', 'developed', 'imperial'], 'road level'); enumeration(r.surface, ['auto', 'dirt', 'gravel', 'paved', 'flagstone'], 'road surface'); enumeration(r.culture, ['auto', 'medieval', 'roman', 'east-asian', 'caravan', 'andean', 'mesoamerican', 'tribal', 'elven', 'dwarven'], 'road construction profile');
    for (const [key, range] of Object.entries(limits)) if (r[key] !== undefined) number(r[key], `roads.${key}`, ...range, key === 'exits');
  }
}
