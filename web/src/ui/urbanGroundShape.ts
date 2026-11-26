import type { Point, Surface } from '../../../rust/bridge/housesContract';
import type { Layout, Partition } from '../../../rust/bridge/urban';
import type { PieceSeat } from '../render/city3d/terrainSeat';
import { CITY3D_PLINTH_M, edgeDistance } from '../render/city3d/terrainSeat';
import { ringContains } from '../render/ringRows';

/** Ground shaping under the buildings of a hillside. Two things move the displayed 3D ground:
 *
 * - every building sunk into the slope (render/city3d/terrainSeat.ts): the ground under its walls and in a strip around them
 *   is cut to its floor, and rises from there to the hill by a bank. Beyond its block (a street) the bank is steep and starts
 *   at the wall, so a street keeps its profile. The ground at its downhill walls is held: neither the
 *   yard nor a neighbour's cut bares its footing;
 * - its lot (Advanced › "Level hillside lots"): the yard is cut, and filled a little, towards the floor of the main building,
 *   with a bank along the lot's edges, where it meets its street and its neighbours on the natural ground.
 *
 * Built once per settlement content (lots, seats, relief) by the 3D view (view3d/cityBuildings.ts), which hands it
 * to the terrain with `setGroundShape`; a point finds its lot in one cell of a spatial grid. The terrain applies `shape`
 * to the drawn ground before footings and moats carve it (view3d/terrain/surface.ts), so the stilts, stairs,
 * walls, fences and trees seated on `groundAt` read the same shaped ground as the mesh. The tilted map samples it onto
 * the grid its terrain reads (render/world/groundShape.ts). */
export const GROUND_SHAPE = Object.freeze({
  /** A lot whose natural ground drops less than this across it is left as it is, m. */
  minDrop: 1,
  /** Bounds of the cut and of the fill of a yard at any point, m. */
  maxCut: 1.2,
  maxFill: 0.6,
  /** Bank width per metre of height taken, and its bounds (m); never wider than a third of the lot's narrow side. */
  bankPerMetre: 1.2,
  minBank: 1,
  maxBank: 4,
  /** Larger lots (fields, monastery precincts) keep their ground, m². */
  maxArea: 4000,
});
/** Parcel uses that are levelled: house plots, compounds and gardens (not squares, markets or commons). */
const SHAPED_USES = new Set(['plot', 'compound', 'garden']);
/** The ground stands this far under a floor cut into it, m. */
const SILL_M = 0.15;
/** Level strip around a building in its block (m) and rise of the banks behind it and beyond the block (rise over run). */
const STRIP_M = 1,
  BANK_RISE = 2.2,
  LIMIT_RISE = 4,
  /** Fall of the bank that holds the ground at a downhill wall, and the strip it holds level, m. */
  HOLD_FALL = 1,
  HOLD_M = 2;

/** One piece of a building in the ground: its outline, floor, and the natural ground under its body. */
export interface GroundShapePad {
  ring: readonly Point[];
  seat: number;
  low: number;
  high: number;
  /** False where the ground is not shaped to the building (a stilt house): its lot keeps its ground too. */
  shaped: boolean;
  /** Outline of the block it stands in, along which streets run. */
  block?: readonly Point[];
}
/** One lot to level: its outline and the buildings in it. `ring` absent: buildings of no such lot. */
export interface GroundShapeLot {
  ring?: readonly Point[];
  pads: readonly GroundShapePad[];
}

/** The pads of a building, from the seats of its footprint pieces: their outlines, and the built terraces they stand on. */
export const groundShapePads = (footprint: Surface, seats: readonly PieceSeat[]): GroundShapePad[] =>
  footprint.flatMap((shape, i) => {
    const { seat, low, high, shaped, block, terrace } = seats[i];
    return (terrace ? [shape.outer, terrace] : [shape.outer]).map(ring => ({ ring, seat, low, high, shaped, block }));
  });

/** The block at a point (SeatGround.blockAt). */
export function blockOutlines(layouts: readonly Layout[]): (x: number, y: number) => readonly Point[] | undefined {
  const rings = layouts.flatMap(l => l.blocks.map(b => b.shape.outer)),
    index = new LotGrid();
  rings.forEach((ring, i) => index.add(i, box(ring)));
  return (x, y) => rings[index.find(x, y, i => rings[i])];
}

/** The lots of the shaped uses (none unless `level`) with the pads standing in them (by their centre), the pads of no lot last. */
export function groundShapeLots(partitions: readonly Partition[], pads: Iterable<GroundShapePad>, level = true): GroundShapeLot[] {
  const lots: { ring?: readonly Point[]; pads: GroundShapePad[] }[] = [],
    index = new LotGrid();
  for (const partition of partitions)
    for (const parcel of partition.parcels) {
      const ring = parcel.shape?.outer;
      if (!level || !SHAPED_USES.has(parcel.use) || !ring || ring.length < 3 || Math.abs(ringArea(ring)) > GROUND_SHAPE.maxArea) continue;
      index.add(lots.push({ ring, pads: [] }) - 1, box(ring));
    }
  for (const pad of pads) {
    const c = centroid(pad.ring),
      lot = index.find(c.x, c.y, i => lots[i].ring!);
    if (lot >= 0) lots[lot].pads.push(pad);
    else lots.push({ pads: [pad] });
  }
  return lots;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Yard extends Box {
  ring: readonly Point[];
  /** Level of the yard and width of the bank inside the lot's edge, m. */
  level: number;
  bank: number;
}
interface Pad extends Box {
  /** The box covers the ring and its banks. */
  ring: readonly Point[];
  seat: number;
  /** Ground kept at its downhill walls, m. */
  hold: number;
  block?: readonly Point[];
}
const CELL = 8;
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
  private readonly yards: Yard[] = [];
  private readonly pads: Pad[] = [];
  private readonly yardGrid = new LotGrid();
  private readonly padGrid = new LotGrid();
  /** `natural`: the drawn ground before shaping (no footing or moat cut), m. */
  constructor(
    lots: readonly GroundShapeLot[],
    private readonly natural: (x: number, y: number) => number | undefined,
  ) {
    for (const lot of lots) this.add(lot);
  }
  add(lot: GroundShapeLot): void {
    const yard = lot.ring ? shapeYard(lot.ring, lot.pads, this.natural) : undefined;
    if (yard) this.yardGrid.add(this.yards.push(yard) - 1, yard);
    for (const pad of lot.pads) {
      // Sea and lake surfaces are flat at their level: nothing is shaped under water. A pad on level ground has nothing to
      // cut, and nothing to hold either unless its yard moves.
      if (!pad.shaped || pad.low <= 0.05 || pad.high - pad.low < (yard ? 0.01 : 0.3)) continue;
      const b = box(pad.ring),
        cut = Math.max(0, pad.high - pad.seat + SILL_M),
        // The bank climbs at BANK_RISE while the hill climbs too.
        reach = Math.min(16, Math.max(3, STRIP_M + cut / (BANK_RISE - Math.min(1, (pad.high - pad.low) / Math.max(4, b.x1 - b.x0, b.y1 - b.y0)))));
      this.padGrid.add(this.pads.length, { x0: (b.x0 -= reach), y0: (b.y0 -= reach), x1: (b.x1 += reach), y1: (b.y1 += reach) });
      this.pads.push({ ...b, ring: pad.ring, seat: pad.seat, hold: Math.max(pad.low, pad.seat - CITY3D_PLINTH_M), block: pad.block });
    }
  }
  get empty(): boolean {
    return !this.yards.length && !this.pads.length;
  }
  /** What the levelled lots and the sunk buildings cover, banks included. */
  *boxes(): Generator<Box> {
    yield* this.yards;
    yield* this.pads;
  }
  /** Number of levelled lots (diagnostics). */
  get size(): number {
    return this.yards.length;
  }
  /** The shaped ground at (x, y), given the natural `height` there. Strictly under a building its own floor alone: the bank of
   * a neighbour reaching under the walls is hidden by them. */
  shape(x: number, y: number, height: number): number {
    const pads = this.padGrid.candidates(x, y),
      yards = this.yardGrid.candidates(x, y);
    if (!pads && !yards) return height;
    let ground = height,
      cut = Infinity,
      cutFrom = 0,
      hold = -Infinity,
      holdFrom = 0,
      under = Infinity;
    for (let k = 0; yards && k < yards.length; k++) {
      const lot = this.yards[yards[k]];
      if (x < lot.x0 || x > lot.x1 || y < lot.y0 || y > lot.y1 || !ringContains(lot.ring, x, y)) continue;
      ground = height + smooth(edgeDistance(lot.ring, x, y) / lot.bank) * Math.max(-GROUND_SHAPE.maxCut, Math.min(GROUND_SHAPE.maxFill, lot.level - height));
      break;
    }
    for (let k = 0; pads && k < pads.length; k++) {
      const pad = this.pads[pads[k]];
      if (x < pad.x0 || x > pad.x1 || y < pad.y0 || y > pad.y1) continue;
      const floor = pad.seat - SILL_M;
      if (ringContains(pad.ring, x, y)) {
        under = Math.min(under, floor);
        continue;
      }
      const d = edgeDistance(pad.ring, x, y);
      if (height > floor + Math.max(0, d - STRIP_M) * BANK_RISE) {
        // Continuous across the block's edge: the terrain grid never samples a step.
        const own = !pad.block ? 1 : ringContains(pad.block, x, y) ? smooth(edgeDistance(pad.block, x, y) / STRIP_M) : 0;
        const bank = floor + Math.max(0, d - STRIP_M * own) * (LIMIT_RISE + (BANK_RISE - LIMIT_RISE) * own);
        if (bank < cut) {
          cut = bank;
          cutFrom = d;
        }
      }
      const held = Math.min(height, pad.hold) - Math.max(0, d - HOLD_M) * HOLD_FALL;
      if (held > hold) {
        hold = held;
        // A cell of the terrain grid beside its walls keeps to it.
        holdFrom = Math.max(0, d - STRIP_M);
      }
    }
    if (under < Infinity) return Math.min(height, under);
    ground = Math.max(ground, hold);
    if (cut >= ground) return ground;
    // Between the wall of a building and the footing of one standing higher, the ground falls from one to the other.
    return hold > cut ? cut + ((hold - cut) * cutFrom) / Math.max(1e-6, cutFrom + holdFrom) : cut;
  }
}

/** Level of the yard of one lot, or undefined when it stays as it is (flat, at the water, unknown, a stilt house). */
function shapeYard(ring: readonly Point[], pads: readonly GroundShapePad[], natural: (x: number, y: number) => number | undefined): Yard | undefined {
  if (pads.some(pad => !pad.shaped)) return undefined;
  const b = box(ring),
    edge = [...ring, centroid(ring)].map(p => natural(p.x, p.y) ?? NaN);
  if (edge.some(h => Number.isNaN(h))) return undefined;
  const low = Math.min(...edge),
    high = Math.max(...edge);
  // Sea and lake surfaces are flat at their level: a lot reaching them is not shaped (nothing under water).
  if (high - low < GROUND_SHAPE.minDrop || low <= 0.05) return undefined;
  // The floor of the main building; least earth moved (the median ground) where none stands.
  let main = 0,
    level = NaN;
  for (const pad of pads) {
    const area = Math.abs(ringArea(pad.ring));
    if (area > main) {
      main = area;
      level = pad.seat - SILL_M;
    }
  }
  if (Number.isNaN(level)) level = edge.sort((a, c) => a - c)[edge.length >> 1];
  const taken = Math.min(GROUND_SHAPE.maxCut + GROUND_SHAPE.maxFill, Math.max(level - low, high - level));
  const bank = Math.min(Math.max(GROUND_SHAPE.minBank, Math.min(GROUND_SHAPE.maxBank, taken * GROUND_SHAPE.bankPerMetre)), Math.min(b.x1 - b.x0, b.y1 - b.y0) / 3);
  return bank > 0 ? { ring, ...b, level, bank } : undefined;
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
