/** What a click of the selection tool means: the entities of the map at a ground point, from the smallest to the largest
 * (a house, its block, its quarter, its settlement). Pure reads of the displayed world; the sheet (entitySheet.ts) shows
 * the first one and offers the others as its parents. */
import type { Settlement, UrbanLayer, Vec2, World } from '../gen/types';
import { distToSeg, pointInRing } from '../gen/geo/poly';
import { activitySitesOf } from './activitySites';
import { buildingAt, townUrban } from './edits';
import { nativeCityRecords } from './nativeProducts';

export type EntityKind = 'building' | 'gate' | 'wall' | 'bridge' | 'harbour' | 'farm' | 'isolated' | 'street' | 'road' | 'river' | 'lake' | 'sea' | 'block' | 'quarter' | 'settlement';
export type TownHit = { settlement: string; index: number; building: UrbanLayer['buildings'][number] };
export interface Entity {
  kind: EntityKind;
  /** The town it belongs to. */
  town?: string;
  /** Its index in its collection: building, block, quarter, wall, street, road, river, lake, farm, quay, isolated site. */
  index: number;
  /** Outline shown on the map (a line is drawn as a flat ring). */
  rings: Vec2[][];
  point: Vec2;
  hit?: TownHit;
}

/** Metres per pixel-tolerance above which a click reads the map from afar: quarters, then whole settlements only. */
const QUARTER_TOLERANCE = 12,
  SETTLEMENT_TOLERANCE = 30;

interface Nearest {
  index: number;
  distance: number;
  segment: number;
}
function nearestSegment(p: Vec2, path: readonly Vec2[]): { distance: number; segment: number } {
  let distance = Infinity,
    segment = 0;
  for (let i = 1; i < path.length; i++) {
    const d = distToSeg(p, path[i - 1], path[i]);
    if (d < distance) [distance, segment] = [d, i - 1];
  }
  return { distance, segment };
}
/** The line nearest to the point among those within `reach(index, segment)` of it. */
function nearestLine(p: Vec2, paths: readonly (readonly Vec2[])[], reach: (index: number, segment: number) => number): Nearest | undefined {
  let best: Nearest | undefined;
  paths.forEach((path, index) => {
    const near = nearestSegment(p, path);
    if (near.distance <= reach(index, near.segment) && (!best || near.distance < best.distance)) best = { index, ...near };
  });
  return best;
}
/** A line as a closed ring of no width, for the outline. */
const lineRing = (path: readonly Vec2[], closed = false): Vec2[] => (closed ? [...path] : [...path, ...path.slice(1, Math.max(2, path.length - 1)).reverse()]);
const inside = (shape: { outer: readonly Vec2[]; holes?: readonly (readonly Vec2[])[] }, p: Vec2): boolean => pointInRing([...shape.outer], p) && !shape.holes?.some(hole => pointInRing([...hole], p));
const circle = (c: Vec2, r: number): Vec2[] => Array.from({ length: 40 }, (_, i) => ({ x: c.x + r * Math.cos((i * Math.PI) / 20), y: c.y + r * Math.sin((i * Math.PI) / 20) }));
const box = (c: Vec2, r: number): Vec2[] => [
  { x: c.x - r, y: c.y - r },
  { x: c.x + r, y: c.y - r },
  { x: c.x + r, y: c.y + r },
  { x: c.x - r, y: c.y + r },
];

export function settlementEntity(world: World, town: Settlement, point: Vec2): Entity {
  const urban = townUrban(world, town.key),
    footprint = urban?.footprint.filter(ring => ring.length >= 3);
  return { kind: 'settlement', town: town.key, index: town.index, rings: footprint?.length ? footprint : [circle(town.core ?? town.center, town.radius)], point };
}
/** The town whose land holds the point: its footprint, else its circle (`reach` metres wider). */
function townAt(world: World, p: Vec2, reach: number): Settlement | undefined {
  const distance = (s: Settlement) => {
    const c = s.core ?? s.center;
    return Math.hypot(c.x - p.x, c.y - p.y);
  };
  const towns = [...(world.settlements ?? [])].sort((a, b) => distance(a) - distance(b));
  return towns.find(s => townUrban(world, s.key)?.footprintH?.some(shape => inside(shape, p))) ?? towns.find(s => distance(s) <= Math.max(s.radius, reach));
}
/** Buildings, defences, quays and streets of one town at the point, then its block and quarter. */
function townEntities(world: World, town: Settlement, p: Vec2, tolerance: number, detail: boolean, picked?: TownHit): { own: Entity[]; land: Entity[] } {
  const own: Entity[] = [],
    land: Entity[] = [],
    urban = townUrban(world, town.key);
  if (!urban) return { own, land };
  const entity = (kind: EntityKind, index: number, rings: Vec2[][], hit?: TownHit): Entity => ({ kind, town: town.key, index, rings, point: p, ...(hit ? { hit } : {}) });
  const block = urban.blocks.findIndex(ring => ring.length >= 3 && pointInRing(ring, p)),
    quarter = urban.blockInfo[block]?.quarter ?? urban.quarters.findIndex(q => q.poly.outer.length >= 3 && inside(q.poly, p));
  if (detail) {
    const found = picked ?? buildingAt(world, p),
      hit = found?.settlement === town.key ? found : undefined;
    if (hit) own.push(entity('building', hit.index, [hit.building.poly, ...(hit.building.courtyards ?? [])], hit));
    (urban.walls ?? []).forEach((wall, index) => {
      const gate = wall.gates.find(g => Math.hypot(g.x - p.x, g.y - p.y) <= Math.max(8, tolerance));
      if (gate) own.push(entity('gate', index, [box(gate, Math.max(6, wall.thickness * 2))]));
      const path = wall.closed && wall.path.length ? [...wall.path, wall.path[0]] : wall.path;
      if (nearestSegment(p, path).distance <= wall.thickness / 2 + Math.min(tolerance, 4)) own.push(entity('wall', index, [lineRing(wall.path, wall.closed)]));
    });
    const quays = nativeCityRecords(world)?.[town.key]?.layouts?.[0]?.structure?.quays;
    if (quays) quays.forEach((quay, index) => inside(quay.shape, p) && own.push(entity('harbour', index, [quay.shape.outer])));
    else (urban.quays ?? []).forEach((ring, index) => ring.length >= 4 && pointInRing(ring, p) && own.push(entity('harbour', index, [ring])));
    const reach = block >= 0 ? 0 : tolerance,
      street = hit
        ? undefined
        : nearestLine(
            p,
            urban.streets.map(s => s.path),
            i => urban.streets[i].width / 2 + reach,
          );
    if (street) own.push(entity('street', street.index, [lineRing(urban.streets[street.index].path)]));
    if (block >= 0) land.push(entity('block', block, [urban.blocks[block]]));
  }
  if (quarter >= 0 && urban.quarters[quarter]) land.push(entity('quarter', quarter, [urban.quarters[quarter].poly.outer, ...urban.quarters[quarter].poly.holes]));
  return { own, land };
}
/** Roads, bridges, farms and isolated buildings outside (or through) the towns. */
function countryEntities(world: World, p: Vec2, tolerance: number): Entity[] {
  const out: Entity[] = [],
    add = (kind: EntityKind, index: number, rings: Vec2[][], town?: string) => out.push({ kind, index, rings, point: p, ...(town ? { town } : {}) });
  const bridge = nearestLine(
    p,
    (world.bridges ?? []).map(b => [b.a, b.b]),
    i => world.bridges![i].width / 2 + Math.min(tolerance, 6),
  );
  if (bridge) add('bridge', bridge.index, [lineRing([world.bridges![bridge.index].a, world.bridges![bridge.index].b])]);
  activitySitesOf(world).forEach((site, index) => {
    if (site.buildings.some(b => pointInRing(b.ring, p)) || Math.hypot(site.x - p.x, site.y - p.y) <= Math.max(12, tolerance)) add('isolated', index, site.buildings.length ? site.buildings.map(b => b.ring) : [box(site, 12)], site.parent);
  });
  (world.landuse?.farmsteads ?? []).forEach((farm, index) => {
    const lot = farm.lot ?? farm.yard;
    if ((lot.length >= 3 && pointInRing(lot, p)) || farm.buildings.some(ring => pointInRing(ring, p))) add('farm', index, [lot.length >= 3 ? lot : farm.buildings[0]]);
  });
  const roads = world.roads ?? [],
    road = nearestLine(
      p,
      roads.map(r => r.path),
      i => (roads[i].urban ? -1 : roads[i].width / 2 + tolerance),
    );
  if (road) add('road', road.index, [lineRing(roads[road.index].path)]);
  return out;
}
function waterEntities(world: World, p: Vec2, tolerance: number): Entity[] {
  const { rivers, lakes, water, height } = world.terrain,
    out: Entity[] = [];
  const river = nearestLine(
    p,
    rivers.map(r => r.path),
    (i, segment) => (rivers[i].width[segment] ?? 2) / 2 + Math.min(tolerance, 15),
  );
  if (river) out.push({ kind: 'river', index: river.index, rings: [lineRing(rivers[river.index].path)], point: p });
  const lake = lakes.findIndex(ring => pointInRing(ring, p));
  if (lake >= 0) out.push({ kind: 'lake', index: lake, rings: [lakes[lake]], point: p });
  const x = Math.min(height.w - 1, Math.floor(p.x / height.cell)),
    y = Math.min(height.h - 1, Math.floor(p.y / height.cell));
  if (water[y * height.w + x] === 1) out.push({ kind: 'sea', index: 0, rings: [], point: p });
  return out;
}

/** The entities at a point, smallest first. `tolerance`: the metres a few pixels cover; `picked`: the building volume a
 * tilted view shows under the pixel. */
export function entitiesAt(world: World, p: Vec2, tolerance: number, picked?: TownHit): Entity[] {
  if (p.x < 0 || p.y < 0 || p.x > world.mapSize || p.y > world.mapSize) return [];
  const detail = tolerance <= QUARTER_TOLERANCE || (!!picked && tolerance <= SETTLEMENT_TOLERANCE);
  const town = (picked && world.settlements?.find(s => s.key === picked.settlement)) ?? townAt(world, p, 3 * tolerance),
    place = town && settlementEntity(world, town, p);
  if (town && place && tolerance > SETTLEMENT_TOLERANCE) return [place];
  const { own, land } = town ? townEntities(world, town, p, tolerance, detail, picked) : { own: [], land: [] };
  const country = countryEntities(world, p, land.length ? Math.min(tolerance, 2) : tolerance),
    water = waterEntities(world, p, tolerance);
  const houses = own.filter(e => e.kind === 'building'),
    // A wall, a gate or a quay is picked over the street along it; a house over everything.
    rest = own.filter(e => e.kind !== 'building');
  return [...houses, ...rest, ...country, ...(land.length ? [] : water), ...land, ...(place && (land.length || own.length || !water.length) ? [place] : [])];
}
