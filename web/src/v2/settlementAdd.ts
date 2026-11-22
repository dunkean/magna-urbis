import type { World, Vec2, Settlement, SiteArchetype } from '../gen/types';
import type { SettlementSpec } from '../../../rust/bridge/settlements';
import type { V2Settings } from './contracts';
import { CULTURES, classOfPop } from '../gen/options';
import { circle, clipConvex, extentRadius, voronoiRegions } from '../gen/settlements/planner';
import { customPlacesOf } from './regionalPopulation';
import { placementKey, regionKey } from './regionKeys';
import { generationValidityKeys } from './stageValidity';
import { stagesForAction } from './stageRegistry';

export const ADDED_SETTLEMENT_POPULATION = { min: 1, max: 5000000, initial: 500 } as const;

/** Records a place the user added (population, culture, position) as a custom place (`region.customPlaces`): a fixed
 * site that every later placement keeps, the automatic places being drawn around it. Returns its key. */
export function addSettlement(settings: V2Settings, world: World | undefined, place: { population: number; culture: string; position: Vec2 }): string {
  const population = Math.round(place.population);
  if (!Number.isFinite(population) || population < ADDED_SETTLEMENT_POPULATION.min || population > ADDED_SETTLEMENT_POPULATION.max) throw new Error('Invalid settlement population.');
  if (!(CULTURES as readonly string[]).includes(place.culture)) throw new Error('Unknown settlement culture.');
  if (!Number.isFinite(place.position.x) || !Number.isFinite(place.position.y)) throw new Error('Invalid settlement position.');
  const region = (settings.region ??= {}),
    custom = (region.customPlaces ??= []);
  const taken = new Set([...custom.map(p => p.key), ...(region.placement?.list ?? []).map(p => p.key), ...(world?.settlements ?? []).map(town => town.key)]);
  let index = (world?.settlements?.length ?? 0) + 1;
  while (taken.has(`place-${index}`)) index++;
  const key = `place-${index}`,
    // Validation keeps positions strictly inside the map.
    size = (world?.mapSize ?? Infinity) - 0.01;
  custom.push({ key, name: '', population, culture: place.culture, siteType: 'auto', sitePrefs: {}, position: { x: Math.max(0, Math.min(size, place.position.x)), y: Math.max(0, Math.min(size, place.position.y)) } });
  return key;
}

/** A town the user moved becomes a custom place at its new position, with its current size and culture. */
export function keepMovedSettlement(settings: V2Settings, town: Settlement, position: Vec2): void {
  const region = (settings.region ??= {}),
    custom = (region.customPlaces ??= []);
  const spec: SettlementSpec = { key: town.key, name: town.name ?? '', population: town.population, culture: town.culture, siteType: town.archetype, sitePrefs: { ...town.options?.sitePrefs }, position: { ...position } };
  const index = custom.findIndex(p => p.key === town.key);
  if (index >= 0) custom[index] = { ...custom[index], position: { ...position } };
  else custom.push(spec);
}

/** Drops every custom place (the next placement draws all places automatically). Returns how many there were. */
export function discardCustomSettlements(settings: V2Settings): number {
  const count = settings.region?.customPlaces?.length ?? 0;
  if (settings.region) delete settings.region.customPlaces;
  return count;
}

/** The custom place `key` added to the displayed world as it stands: the other places, their towns and the roads are
 * kept; the new place gets its own region cell and the size the placement gives that population. */
export function insertSettlement(world: World, settings: V2Settings, key: string): World {
  const spec = customPlacesOf(settings).find(p => p.key === key);
  if (!spec?.position) throw new Error('Unknown custom place.');
  const towns = world.settlements ?? [],
    center = { ...spec.position },
    radius = extentRadius(spec.population),
    region = voronoiRegions([...towns.map(town => town.center), center], world.mapSize)[towns.length],
    cls = classOfPop(spec.population);
  const place: Settlement = {
    key,
    index: towns.length,
    main: !towns.length,
    cls,
    population: spec.population,
    culture: spec.culture,
    center,
    archetype: (spec.siteType === 'auto' ? 'plain' : spec.siteType) as SiteArchetype,
    radius,
    extent: clipConvex(circle(center, radius), region),
    region,
    fixed: true,
    name: spec.name || undefined,
    detail: !towns.length ? 'main' : cls === 'farmstead' ? 'farmstead' : 'lazy',
  };
  const settlements = [...towns, place];
  return { ...world, settlements, stats: { ...world.stats, [`v2.population:${key}`]: spec.population, [`v2.culture:${key}`]: spec.culture, settlements: settlements.length, 'v2.regionPopulation': settlements.reduce((n, p) => n + p.population, 0) } };
}

/** After a direct placement edit, the world matches the edited recipe: its placement keys and the validity of the
 * placement (and of its roads when `roads`) and of the towns already built are recorded again, so no stage is rerun. */
export function acceptPlacementEdit(world: World, settings: V2Settings, roads: boolean): World {
  const stats: World['stats'] = { ...world.stats, 'v2.planKey': regionKey(settings), 'v2.placementKey': placementKey(settings) },
    next = { ...world, stats };
  const keys = generationValidityKeys(settings, next),
    roadStages = new Set(stagesForAction('roads'));
  for (const stage of stagesForAction('region')) {
    const key = keys.get(stage);
    if (key !== undefined && (roads || !roadStages.has(stage))) stats[`v2.valid:${stage}`] = key;
  }
  const towns = new Map<string, Map<string, string>>();
  for (const name of Object.keys(stats)) {
    const match = /^v2\.valid:(city-[a-z-]+):(.+)$/.exec(name);
    if (!match) continue;
    if (!towns.has(match[2])) towns.set(match[2], generationValidityKeys(settings, next, match[2]));
    const key = towns.get(match[2])!.get(match[1]);
    if (key !== undefined) stats[name] = key;
  }
  return next;
}
