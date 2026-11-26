import type { CityScene } from '../model/contract';
import { SpatialBins } from '../model/geometry';
import { sameData } from './sceneChanges';

export interface PlanMerge {
  sources: readonly CityScene[];
  parts: readonly CityScene[];
  plan: CityScene;
}
/** Keep the latest rebase. A continuously edited neighbouring town can produce arbitrarily many offsets. */
const offsets = new WeakMap<object, { shift: number; value: object }>();
function shifted<T extends object>(v: T, n: number, make: () => T): T {
  if (!n) return v;
  const held = offsets.get(v);
  if (held?.shift === n) return held.value as T;
  const value = make();
  offsets.set(v, { shift: n, value });
  return value;
}
function retain<T>(a: readonly T[], b: T[], same: (a: T, b: T) => boolean = sameData): T[] {
  if (a === b) return b;
  let all = a.length === b.length;
  const out = b.map((v, i) => {
    if (i < a.length && same(a[i], v)) return a[i];
    all = false;
    return v;
  });
  return all ? (a as T[]) : out;
}
/** These records may have Canvas Path2D caches attached. Compare their model fields only. */
function sameRecord(a: object, b: object): boolean {
  if (a === b) return true;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  const fields = (o: object) => Object.keys(o).filter(k => k !== 'path' && !k.endsWith('Path'));
  const keys = fields(a);
  return keys.length === fields(b).length && keys.every(k => Object.hasOwn(y, k) && sameData(x[k], y[k]));
}
function retainPart(a: CityScene | undefined, b: CityScene): CityScene {
  if (!a || a === b) return b;
  return {
    ...b,
    blocks: retain(a.blocks, b.blocks, sameRecord),
    parcels: retain(a.parcels, b.parcels, sameRecord),
    streets: retain(a.streets, b.streets, sameRecord),
    districts: retain(a.districts, b.districts),
    walls: retain(a.walls, b.walls),
    footprint: retain(a.footprint, b.footprint),
    quays: retain(a.quays ?? [], b.quays ?? []),
    landmarks: retain(a.landmarks, b.landmarks),
  };
}
const EMPTY: never[] = [];
/** Contiguous arrays for consumers of global indices; unchanged columns and existing rebased records are shared.
 * Queries go to each town's existing bins. The plans contain no merged copies of building faces. */
export function* mergePlanGeometrySteps(input: readonly CityScene[], previous?: PlanMerge): Generator<void, PlanMerge> {
  if (previous && input.length === previous.parts.length && input.every((p, i) => p === previous.sources[i])) return previous;
  const parts: CityScene[] = [];
  for (const [i, p] of input.entries()) {
    parts.push(previous?.sources[i] === p ? previous.parts[i] : retainPart(previous?.parts[i], p));
    yield;
  }
  if (parts.length === 1) return { sources: input, parts, plan: parts[0] };
  const shifts = (p: readonly CityScene[], field: 'layouts' | 'parcels') => {
    let n = 0;
    return p.map(s => {
      const base = n;
      n += s[field].length;
      return base;
    });
  };
  const L = shifts(parts, 'layouts'),
    P = shifts(parts, 'parcels'),
    old = previous?.parts ?? [],
    oldL = shifts(old, 'layouts'),
    oldP = shifts(old, 'parcels');
  function column<T>(read: (p: CityScene) => readonly T[], prior: readonly T[] | undefined, shift?: readonly number[], priorShift?: readonly number[], project?: (v: T, n: number) => T): T[] {
    if (prior && old.length === parts.length && parts.every((p, i) => read(old[i]) === read(p) && (!shift || shift[i] === priorShift![i]))) return prior as T[];
    return parts.flatMap((p, i) => {
      const items = read(p);
      return project && shift?.[i] ? (shifted(items, shift[i], () => items.map(v => project(v, shift[i]))) as T[]) : (items as T[]);
    });
  }
  const rebase = <T extends { layout: number }>(v: T, n: number): T => shifted(v, n, () => ({ ...v, layout: v.layout + n }));
  const prior = previous?.plan;
  const blocks = column(p => p.blocks, prior?.blocks, L, oldL, rebase);
  yield;
  const parcels = column(p => p.parcels, prior?.parcels, L, oldL, rebase);
  yield;
  const streets = column(p => p.streets, prior?.streets, L, oldL, rebase);
  const sameIds = prior && old.length === parts.length && parts.every((p, i) => old[i].parcelById === p.parcelById && P[i] === oldP[i]);
  const parcelById = sameIds ? prior.parcelById : new Map<string, number>();
  if (!sameIds)
    parts.forEach((p, i) => {
      for (const [id, index] of p.parcelById) if (!parcelById.has(id)) parcelById.set(id, index + P[i]);
    });
  let extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of parts)
    if (p.layouts.length || p.footprint.length) {
      const e = p.extent;
      extent = { minX: Math.min(extent.minX, e.minX), minY: Math.min(extent.minY, e.minY), maxX: Math.max(extent.maxX, e.maxX), maxY: Math.max(extent.maxY, e.maxY) };
    }
  const bins = (k: keyof CityScene['bins']) => (prior && old.length === parts.length && parts.every((p, i) => p.bins[k] === old[i].bins[k]) ? prior.bins[k] : SpatialBins.combined(parts.map(p => p.bins[k])));
  const plan: CityScene = {
    layouts: column(p => p.layouts, prior?.layouts),
    blocks,
    parcels,
    streets,
    parcelById,
    extent,
    ground: parts.find(p => p.ground)?.ground,
    bins: { blocks: bins('blocks'), parcels: bins('parcels'), streets: bins('streets'), landmarks: bins('landmarks') },
    districts: column(p => p.districts, prior?.districts, L, oldL, rebase),
    walls: column(p => p.walls, prior?.walls),
    landmarks: column(
      p => p.landmarks,
      prior?.landmarks,
      P,
      oldP,
      (v, n) => (v.parcel === undefined ? v : shifted(v, n, () => ({ ...v, parcel: v.parcel! + n }))),
    ),
    footprint: column(p => p.footprint, prior?.footprint),
    quays: column(p => p.quays ?? EMPTY, prior?.quays),
    lotEnclosures: column(p => p.lotEnclosures ?? EMPTY, prior?.lotEnclosures),
    enclosureProfiles: parts.flatMap(p => p.layouts.map((_, i) => p.enclosureProfiles?.[i])),
    lotYards: column(
      p => p.lotYards ?? EMPTY,
      prior?.lotYards,
      P,
      oldP,
      (v, n) => shifted(v, n, () => ({ ...v, parcel: v.parcel + n })),
    ),
  };
  return { sources: input, parts, plan };
}
