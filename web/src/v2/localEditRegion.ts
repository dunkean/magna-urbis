/**
 * Where a local edit (a house, parcel, block or quarter changed in one town, `updateLocalTown`) changed the map: the
 * boxes of the buildings, parcels, blocks, streets and enclosures that differ between the previous and the new world,
 * their old and new geometry, grown by the reach of the ground shaping. The shaped ground (render/world/groundShape.ts)
 * and the forest occupation (displayForest.ts) update only inside them and keep the rest of the map as it was.
 *
 * Cheap by identity: localEditIntern.ts gives back the previous objects of the towns and buildings the edit kept, so
 * only the edited town is compared element by element.
 */
import type { World } from '../gen/types';
import { buildingOccupationSurfaces } from '../ui/urbanBuildingProjection';
import { nativeCityRecords } from './nativeProducts';
import type { RustTownSnapshot } from './rustUrban';

/** A box of the map, metres. */
export interface EditRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Reach of a changed element on the shaped ground: the bank of a sunk building (16 m), a lot's bank (4 m) and a
 * street's levelled margin (3 m), rounded up. */
export const EDIT_MARGIN = 24;
/** Beyond this share of the map the region is no saving: the products are made again whole. */
const MAX_SHARE = 0.25;

type Building = NonNullable<NonNullable<RustTownSnapshot['scene']>['buildings']>[number];
const memo = new WeakMap<World, { previous: World; rects: readonly EditRect[] | undefined }>();
const received = new WeakMap<object, { previous: object; rects: readonly EditRect[] | undefined }>();

/** Derived display worlds share these records with the reconstructed worker result. */
export function rememberLocalEditRegions(previous: World, next: World, rects: readonly EditRect[] | undefined): void {
  const before = nativeCityRecords(previous),
    after = nativeCityRecords(next);
  if (before && after && before !== after) received.set(after, { previous: before, rects });
}

/** The boxes where `next` differs from `previous` when `next` is a local town edit of it (same terrain, land use,
 * roads and region): [] when no element changed; undefined when it is no local edit or the region covers too much of
 * the map, and the products are made again whole. */
export function localEditRegions(previous: World | undefined, next: World | undefined): readonly EditRect[] | undefined {
  if (!previous || !next || previous === next) return undefined;
  const held = memo.get(next);
  if (held?.previous === previous) return held.rects;
  const rects = regions(previous, next);
  memo.set(next, { previous, rects });
  return rects;
}

function regions(previous: World, next: World): readonly EditRect[] | undefined {
  if (!sameRegion(previous, next)) return undefined;
  const before = nativeCityRecords(previous),
    after = nativeCityRecords(next);
  if (!before && !after) return previous.urban === next.urban && previous.settlements === next.settlements ? [] : undefined;
  const wire = after && received.get(after);
  if (wire && wire.previous === before) return wire.rects;
  const boxes: EditRect[] = [];
  for (const town of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    const a = before?.[town],
      b = after?.[town];
    if (a !== b) townChanges(a, b, boxes);
  }
  return boundedRegions(boxes, next.mapSize);
}

const sameRegion = (previous: World, next: World): boolean =>
  previous.terrain === next.terrain &&
  previous.landuse === next.landuse &&
  previous.roads === next.roads &&
  previous.mapSize === next.mapSize &&
  previous.debug?.v2RustRegion === next.debug?.v2RustRegion &&
  previous.stats['v2.cityOutput'] === next.stats['v2.cityOutput'] &&
  previous.stats['v2.cityOutputKeys'] === next.stats['v2.cityOutputKeys'];

/** The engine knows which town it edited. Compute the bounds there, before crossing the worker boundary. */
export function editedTownRegions(previous: World, next: World, key: string): readonly EditRect[] | undefined {
  if (!sameRegion(previous, next)) return undefined;
  const before = nativeCityRecords(previous)?.[key],
    after = nativeCityRecords(next)?.[key];
  if (!before || !after) return undefined;
  if (before === after) return [];
  const boxes: EditRect[] = [];
  townChanges(before, after, boxes);
  return boundedRegions(boxes, next.mapSize);
}

function boundedRegions(boxes: EditRect[], mapSize: number): readonly EditRect[] | undefined {
  const merged = mergeRects(boxes.map(box => grow(box, EDIT_MARGIN)));
  let area = 0;
  for (const r of merged) area += (r.x1 - r.x0) * (r.y1 - r.y0);
  return area > MAX_SHARE * mapSize * mapSize ? undefined : merged;
}

/** The boxes of the elements of a town that differ between two snapshots (either may be absent). */
function townChanges(a: RustTownSnapshot | undefined, b: RustTownSnapshot | undefined, out: EditRect[]): void {
  // Buildings by object: the edit gives back the objects of those it kept.
  if (a?.scene?.buildings !== b?.scene?.buildings) {
    const kept = new Set<Building>(a?.scene?.buildings ?? []),
      made = new Set<Building>(b?.scene?.buildings ?? []);
    for (const building of kept) if (!made.has(building)) pushBox(buildingBox(building), out);
    for (const building of made) if (!kept.has(building)) pushBox(buildingBox(building), out);
  }
  if (a?.layouts !== b?.layouts) {
    const layouts = (town: RustTownSnapshot | undefined): unknown[] => (town?.layouts ?? []).flatMap(layout => [...layout.streets, ...layout.blocks.map(block => block.shape), ...(layout.enclosures ?? [])]);
    changedGeometry(layouts(a), layouts(b), value => value, out);
  }
  if (a?.partitions !== b?.partitions) {
    type Parcel = NonNullable<RustTownSnapshot['partitions']>[number]['parcels'][number];
    const parcels = (town: RustTownSnapshot | undefined): Parcel[] => (town?.partitions ?? []).flatMap(partition => partition.parcels);
    changedGeometry(parcels(a), parcels(b), parcel => [parcel.use, parcel.shape], out);
  }
}

function changedGeometry<T>(before: T[], after: T[], geometry: (value: T) => unknown, out: EditRect[]): void {
  // Retained objects need no content hash. The counts also handle repeated shapes and re-ordered elements.
  const identities = new Map<T, number>();
  for (const item of after) identities.set(item, (identities.get(item) ?? 0) + 1);
  const counts = new Map<string, { value: unknown; count: number }>();
  const add = (item: T, delta: number): void => {
    const value = geometry(item),
      key = JSON.stringify(value),
      entry = counts.get(key);
    if (entry) entry.count += delta;
    else counts.set(key, { value, count: delta });
  };
  for (const item of before) {
    const n = identities.get(item);
    if (n) identities.set(item, n - 1);
    else add(item, 1);
  }
  for (const [item, n] of identities) if (n) add(item, -n);
  for (const { value, count } of counts.values()) if (count) pushBox(pointsBox(value), out);
}

function buildingBox(building: Building): EditRect | undefined {
  let box: EditRect | undefined;
  for (const surface of buildingOccupationSurfaces(building)) box = union(box, pointsBox(surface));
  return box;
}
/** The box of every {x, y} point in a value (rings, paths, shapes), with the half width of a street. */
function pointsBox(value: unknown): EditRect | undefined {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let pad = 0;
  const visit = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.x === 'number' && typeof o.y === 'number') {
      box.x0 = Math.min(box.x0, o.x);
      box.y0 = Math.min(box.y0, o.y);
      box.x1 = Math.max(box.x1, o.x);
      box.y1 = Math.max(box.y1, o.y);
      return;
    }
    if (Array.isArray(o.widths)) for (const w of o.widths) if (typeof w === 'number') pad = Math.max(pad, w / 2);
    for (const child of Object.values(o)) visit(child);
  };
  visit(value);
  return box.x0 <= box.x1 && box.y0 <= box.y1 ? grow(box, pad) : undefined;
}
function pushBox(box: EditRect | undefined, out: EditRect[]): void {
  if (box) out.push(box);
}
const grow = (r: EditRect, d: number): EditRect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });
const union = (a: EditRect | undefined, b: EditRect | undefined): EditRect | undefined => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const rectsOverlap = (a: EditRect, b: EditRect): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
/** Whether a box meets any of the rectangles. */
export const meetsRects = (box: EditRect, rects: readonly EditRect[]): boolean => rects.some(r => rectsOverlap(box, r));

/** Overlapping boxes joined until none overlap. */
export function mergeRects(boxes: readonly EditRect[]): EditRect[] {
  const out = boxes.map(b => ({ ...b }));
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++)
      for (let j = i + 1; j < out.length; j++)
        if (rectsOverlap(out[i], out[j])) {
          out[i] = union(out[i], out[j])!;
          out.splice(j, 1);
          merged = true;
          break;
        }
  }
  return out;
}
