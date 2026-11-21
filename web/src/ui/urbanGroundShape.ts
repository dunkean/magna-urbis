import type { Point, Surface } from '../../../rust/bridge/housesContract';
import type { Partition } from '../../../rust/bridge/urban';
import { ringContains } from '../render/ringRows';

/** Ground shaping under hillside lots (Advanced › "Level hillside lots"): the displayed 3D ground is cut and filled into
 * a level platform per lot, so that a house and its yard stand on near-level ground and the slope is taken by a bank
 * along the lot's edges. A lot meets its street and its neighbours on the natural ground at its boundary (past a short
 * blend where a house stands on that boundary), so streets keep their own profile and two lots at different levels meet
 * by their two banks.
 *
 * Built once per settlement content (lots, footprints, relief) by the 3D view (view3d/cityBuildings.ts), which hands it
 * to the terrain with `setGroundShape`; a point finds its lot in one cell of a spatial grid. The terrain applies `shape`
 * to the drawn ground before footings and moats carve it (view3d/terrain/surface.ts), so the buildings, stilts, stairs,
 * walls, fences and trees seated on `groundAt` read the same shaped ground as the mesh. */
export const GROUND_SHAPE = Object.freeze({
  /** A lot whose natural ground drops less than this across it is left as it is, m. */
  minDrop: 1,
  /** Bounds of the cut and of the fill at any point, m. */
  maxCut: 2.5,
  maxFill: 2.5,
  /** Bank width per metre of height taken, and its bounds (m); never wider than a third of the lot's narrow side. */
  bankPerMetre: 1.2,
  minBank: 1,
  maxBank: 4,
  /** Larger lots (fields, monastery precincts) keep their ground, m². */
  maxArea: 4000,
});
/** Parcel uses that are levelled: house plots, compounds and gardens (not squares, markets or commons). */
const SHAPED_USES = new Set(['plot', 'compound', 'garden']);

/** One lot to level: its outline, its street frontage and the building footprints standing in it. */
export interface GroundShapeLot {
  ring: readonly Point[];
  front?: readonly [Point, Point] | null;
  footprints: readonly (readonly Point[])[];
}

/** The levelled lots of a town: parcels of the shaped uses, each with the footprints whose centre lies in it. */
export function groundShapeLots(partitions: readonly Partition[], footprints: readonly Surface[]): GroundShapeLot[] {
  const lots: (GroundShapeLot & { footprints: Point[][] })[] = [],
    index = new LotGrid();
  for (const partition of partitions)
    for (const parcel of partition.parcels) {
      const ring = parcel.shape?.outer;
      if (!SHAPED_USES.has(parcel.use) || !ring || ring.length < 3 || Math.abs(ringArea(ring)) > GROUND_SHAPE.maxArea) continue;
      index.add(lots.push({ ring, front: parcel.front, footprints: [] }) - 1, box(ring));
    }
  for (const footprint of footprints)
    for (const shape of footprint) {
      const c = centroid(shape.outer),
        lot = index.find(c.x, c.y, i => lots[i].ring);
      if (lot >= 0) lots[lot].footprints.push(shape.outer);
    }
  return lots;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface ShapedLot extends Box {
  /** The box covers the lot and the blend around its footprints. */
  ring: readonly Point[];
  /** Level of the platform, width of the bank inside the lot's edge and of the blend around a footprint, m. */
  level: number;
  bank: number;
  blend: number;
  footprints: (Box & { ring: readonly Point[] })[];
}
/** A point this close to a footprint's outline counts as under it (its corners and walls), m; the blend from a footprint
 * back to the natural ground outside its lot (a street, a neighbour) stays within FOOTPRINT_BLEND, m. */
const CELL = 8,
  FOOTPRINT_TOLERANCE = 0.3,
  FOOTPRINT_BLEND = 1.5;
const INSIDE = 2;
const smooth = (s: number): number => (s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s));
/** Lots by 8 m cell of their bounding box. */
class LotGrid {
  private readonly cells = new Map<number, number[]>();
  private static key(x: number, y: number): number {
    return (x + 32768) * 65536 + (y + 32768);
  }
  add(lot: number, b: Box): void {
    for (let y = Math.floor(b.y0 / CELL); y <= Math.floor(b.y1 / CELL); y++)
      for (let x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++) {
        const k = LotGrid.key(x, y),
          list = this.cells.get(k);
        if (list) list.push(lot);
        else this.cells.set(k, [lot]);
      }
  }
  candidates(x: number, y: number): readonly number[] | undefined {
    return this.cells.get(LotGrid.key(Math.floor(x / CELL), Math.floor(y / CELL)));
  }
  find(x: number, y: number, ring: (lot: number) => readonly Point[]): number {
    for (const lot of this.candidates(x, y) ?? []) if (ringContains(ring(lot), x, y)) return lot;
    return -1;
  }
}

export class UrbanGroundShape {
  private readonly lots: ShapedLot[] = [];
  private readonly grid = new LotGrid();
  readonly empty: boolean;
  /** `natural`: the drawn ground before shaping (no footing or moat cut), m. */
  constructor(lots: readonly GroundShapeLot[], natural: (x: number, y: number) => number | undefined) {
    for (const lot of lots) {
      const shaped = shapeLot(lot, natural);
      if (shaped) this.grid.add(this.lots.push(shaped) - 1, shaped);
    }
    this.empty = !this.lots.length;
  }
  /** Number of levelled lots (diagnostics). */
  get size(): number {
    return this.lots.length;
  }
  /** Platform weight of a lot at (x, y), continuous everywhere so the terrain grid never samples a step: 1 under a
   * footprint (its corners and walls, which may lie on the lot's outline), falling to 0 over the blend outside it; inside
   * the lot, rising from 0 at its edge to 1 past its bank. Strictly inside a footprint: INSIDE (counts as 1). */
  private weight(lot: ShapedLot, x: number, y: number): number {
    let w = 0;
    for (const f of lot.footprints) {
      if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) continue;
      if (ringContains(f.ring, x, y)) return INSIDE;
      w = Math.max(w, 1 - smooth((edgeDistance(f.ring, x, y) - FOOTPRINT_TOLERANCE) / lot.blend));
      if (w >= 1) return 1;
    }
    if (ringContains(lot.ring, x, y)) w = Math.max(w, smooth(edgeDistance(lot.ring, x, y) / lot.bank));
    return w;
  }
  /** Platform level of the lot weighing most at (x, y), or undefined off the levelled lots. */
  levelAt(x: number, y: number): number | undefined {
    let best = 0,
      level: number | undefined;
    for (const i of this.grid.candidates(x, y) ?? []) {
      const lot = this.lots[i],
        w = x < lot.x0 || x > lot.x1 || y < lot.y0 || y > lot.y1 ? 0 : this.weight(lot, x, y);
      if (Math.min(1, w) > best) {
        best = Math.min(1, w);
        level = lot.level;
      }
    }
    return level;
  }
  /** The shaped ground at (x, y), given the natural `height` there: cut or filled towards the level of the lots weighing
   * there (one, except in the blends where a footprint meets its neighbour), within bounds. Strictly under a footprint
   * its own level alone (most seat reads fall there): a neighbour's blend reaching under the walls is hidden by them. */
  shape(x: number, y: number, height: number): number {
    if (this.empty) return height;
    const candidates = this.grid.candidates(x, y);
    if (!candidates) return height;
    let sum = 0,
      move = 0;
    for (let k = 0; k < candidates.length; k++) {
      const lot = this.lots[candidates[k]];
      if (x < lot.x0 || x > lot.x1 || y < lot.y0 || y > lot.y1) continue;
      const w = this.weight(lot, x, y);
      if (w <= 0) continue;
      const d = Math.max(-GROUND_SHAPE.maxCut, Math.min(GROUND_SHAPE.maxFill, lot.level - height));
      if (w === INSIDE) {
        if (!sum) return height + d;
        sum += 1;
        move += d;
        continue;
      }
      sum += w;
      move += w * d;
    }
    return sum ? height + move / Math.max(1, sum) : height;
  }
}

/** Platform level of one lot from its natural ground, or undefined when it stays as it is (flat, at the water, unknown). */
function shapeLot(lot: GroundShapeLot, natural: (x: number, y: number) => number | undefined): ShapedLot | undefined {
  const b = box(lot.ring);
  const sample = (p: Point): number => {
    const h = natural(p.x, p.y);
    return h === undefined || !Number.isFinite(h) ? NaN : h;
  };
  const edge = [...lot.ring, centroid(lot.ring)].map(sample);
  const under = lot.footprints.flatMap(f => [...f, centroid(f)].map(p => ({ p, h: sample(p) })));
  const all = [...edge, ...under.map(s => s.h)];
  if (all.some(h => Number.isNaN(h))) return undefined;
  const low = Math.min(...all),
    high = Math.max(...all);
  // Sea and lake surfaces are flat at their level: a lot reaching them is not shaped (nothing under water).
  if (high - low < GROUND_SHAPE.minDrop || low <= 0.05) return undefined;
  // Least earth moved: the median of the ground under the buildings (of the whole lot when it holds none) ...
  const base = (under.length ? under.map(s => s.h) : edge).sort((a, c) => a - c);
  let level = base[base.length >> 1];
  // ... raised to the ground of any footprint corner at the street frontage: the door never ends below the street.
  if (lot.front) for (const s of under) if (segmentDistance(lot.front[0], lot.front[1], s.p.x, s.p.y) < 2) level = Math.max(level, s.h);
  const taken = Math.min(GROUND_SHAPE.maxCut + GROUND_SHAPE.maxFill, Math.max(level - low, high - level));
  const bank = Math.min(Math.max(GROUND_SHAPE.minBank, Math.min(GROUND_SHAPE.maxBank, taken * GROUND_SHAPE.bankPerMetre)), Math.min(b.x1 - b.x0, b.y1 - b.y0) / 3);
  if (!(bank > 0)) return undefined;
  const blend = Math.min(bank, FOOTPRINT_BLEND),
    m = FOOTPRINT_TOLERANCE + blend;
  const footprints = lot.footprints.map(ring => {
    const f = box(ring);
    return { ring, x0: f.x0 - m, y0: f.y0 - m, x1: f.x1 + m, y1: f.y1 + m };
  });
  for (const f of footprints) {
    b.x0 = Math.min(b.x0, f.x0);
    b.y0 = Math.min(b.y0, f.y0);
    b.x1 = Math.max(b.x1, f.x1);
    b.y1 = Math.max(b.y1, f.y1);
  }
  return { ring: lot.ring, ...b, level, bank, blend, footprints };
}

function box(ring: readonly Point[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}
function centroid(ring: readonly Point[]): Point {
  let x = 0,
    y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}
function ringArea(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return s / 2;
}
function segmentDistance(a: Point, b: Point, x: number, y: number): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l)) : 0;
  return Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
}
function edgeDistance(ring: readonly Point[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, segmentDistance(ring[j], ring[i], x, y));
  return d;
}
