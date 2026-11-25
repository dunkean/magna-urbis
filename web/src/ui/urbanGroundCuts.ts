import type { Point } from '../../../rust/bridge/housesContract';
import { netPolygonArea } from '../gen/core/geom';
import { moatSpans, type MoatSpan } from '../render/city3dMoat';
import { moatSpec, moatWidth, moatBankRise, moatCut, moatCutReach, moatDepth, moatForm, moatOuterEdges, moatScarp, type MoatForm, type MoatSpec } from '../render/moatModel';

/** Ground cuts of the 3D terrain: the moats of the town circuits, dug by their depth in the form of the circuit
 * (render/moatModel.ts: V ditch, earth scarps, revetted flat bottom, double ditch). Built once per set of circuits (`city3d.ts` hands it to the terrain with `setGroundCuts`);
 * the terrain lowers its tile heights through `lower`, as it raises or lowers building footings
 * (urbanBuildingGround.ts). Walls, bridges and quays keep the undug ground (the town's placement height).
 * A moat piece lowers the ground inside its polygon only: `moatCut` of the distance to its nearest bank.
 * Edges shared by two pieces (tiles of one moat) are not banks, so a moat tiled by the engine digs as one.
 * Where the form has an outer bank (the spoil thrown up beyond the counterscarp), the ground rises outside those edges.
 * A sluice is a narrow cut from the head of a wet ditch to the water. */
interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  piece: number;
  bank: boolean;
  /** A bank edge away from the curtain: the counterscarp. */
  outer: boolean;
}
interface Piece {
  depth: number;
  form: MoatForm;
  /** Run of the scarp, distance from the banks to the middle, and how far inside a bank the cut still deepens (m). */
  slope: number;
  half: number;
  reach: number;
  /** Width of the outer bank (m), 0 without one. */
  bankWidth: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Ditch {
  kind: string;
  height_m: number;
  shape: { outer: Point[]; holes: Point[][] };
}
interface Circuit {
  ditch?: readonly Ditch[];
  moat?: MoatSpec;
  style?: string;
  path?: readonly Point[];
  gatehouses?: readonly { kind: string; passage: Point[]; passage_width_m: number }[];
}

const ROW = 4,
  CELL = 8;

export class UrbanGroundCuts {
  private readonly pieces: Piece[] = [];
  /** Edges by horizontal row (inside parity) and by cell (distance to a bank). */
  private readonly rows = new Map<number, Edge[]>();
  private readonly cells = new Map<number, Edge[]>();
  private readonly boxes = new Map<number, number[]>();
  /** Gate crossings: the moat is dug on under the gate street (a bridge spans it), across the causeway the engine leaves. */
  private readonly spans: (Omit<MoatSpan, 'piece'> & { slope: number })[] = [];
  /** Counterscarp edges of the pieces whose form raises an outer bank. */
  private readonly banks: Edge[] = [];
  readonly empty: boolean;

  constructor(circuits: readonly Circuit[] = []) {
    const key = (p: Point): string => `${Math.round(p.x * 20)},${Math.round(p.y * 20)}`;
    const shared = new Map<string, number>();
    const rings: { ring: Point[]; piece: number; outer: boolean[] }[] = [];
    for (const e of circuits) for (const span of moatSpans(e.gatehouses ?? [], e.ditch ?? [], moatForm(e))) this.spans.push({ ...span, slope: Math.max(0.5, Math.min(span.depth * 1.2, 0.45 * (span.last - span.first))) });
    // A sluice: 3 m wide, 1.5 m deep, from inside the head of the ditch to the water.
    for (const e of circuits)
      for (const [head, shore] of moatSpec(e)?.sluices ?? []) {
        const l = Math.hypot(shore.x - head.x, shore.y - head.y);
        if (l < 0.5) continue;
        const s = { x: (shore.x - head.x) / l, y: (shore.y - head.y) / l };
        this.spans.push({ b: head, s, n: { x: -s.y, y: s.x }, first: -3, last: l + 2, half: 1, depth: 1.5, wet: true, slope: 1 });
      }
    for (const e of circuits) {
      const form = moatForm(e);
      for (const d of e.ditch ?? []) {
        const outer = d.shape?.outer;
        if (!outer || outer.length < 3) continue;
        const holes = (d.shape.holes ?? []).filter(h => h.length >= 3);
        const all = [outer, ...holes];
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity,
          perimeter = 0;
        for (const p of outer) {
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
        for (const r of all)
          for (let i = 0; i < r.length; i++) {
            const a = r[i],
              b = r[(i + 1) % r.length];
            perimeter += Math.hypot(b.x - a.x, b.y - a.y);
            const k = [key(a), key(b)].sort().join('|');
            shared.set(k, (shared.get(k) ?? 0) + 1);
          }
        // Breadth of the piece: between its two banks where the curtain tells them apart.
        const counterscarp = e.path ? moatOuterEdges({ ...d, shape: { outer, holes } }, e.path) : undefined,
          depth = moatDepth(d, form),
          width = counterscarp ? moatWidth({ ...d, shape: { outer, holes } }, counterscarp) : (2 * netPolygonArea(outer, holes)) / Math.max(1, perimeter);
        const slope = moatScarp(form, depth, width),
          half = 0.5 * width;
        const bankWidth = form.bankM?.[0] ?? 0;
        const piece = this.pieces.push({ depth, form, slope, half, reach: moatCutReach(form, slope, half), bankWidth, x0: x0 - bankWidth, y0: y0 - bankWidth, x1: x1 + bankWidth, y1: y1 + bankWidth }) - 1;
        all.forEach((ring, ri) => rings.push({ ring, piece, outer: (bankWidth && (counterscarp ?? moatOuterEdges({ ...d, shape: { outer, holes } }))[ri]) || [] }));
      }
    }
    for (const { ring, piece, outer } of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          bank = (shared.get([key(a), key(b)].sort().join('|')) ?? 0) < 2;
        const edge: Edge = { ax: a.x, ay: a.y, bx: b.x, by: b.y, piece, bank, outer: bank && !!outer[i] };
        for (let r = Math.floor(Math.min(a.y, b.y) / ROW); r <= Math.floor(Math.max(a.y, b.y) / ROW); r++) this.at(this.rows, r, edge);
        if (!edge.bank) continue;
        if (edge.outer) this.banks.push(edge);
        const reach = Math.max(this.pieces[piece].reach, edge.outer ? this.pieces[piece].bankWidth : 0);
        for (let y = Math.floor((Math.min(a.y, b.y) - reach) / CELL); y <= Math.floor((Math.max(a.y, b.y) + reach) / CELL); y++)
          for (let x = Math.floor((Math.min(a.x, b.x) - reach) / CELL); x <= Math.floor((Math.max(a.x, b.x) + reach) / CELL); x++) this.at(this.cells, UrbanGroundCuts.key(x, y), edge);
      }
    this.pieces.forEach((p, i) => {
      for (let y = Math.floor(p.y0 / CELL); y <= Math.floor(p.y1 / CELL); y++)
        for (let x = Math.floor(p.x0 / CELL); x <= Math.floor(p.x1 / CELL); x++) {
          const k = UrbanGroundCuts.key(x, y),
            list = this.boxes.get(k);
          if (list) list.push(i);
          else this.boxes.set(k, [i]);
        }
    });
    this.empty = !this.pieces.length && !this.spans.length;
  }
  private at<K>(map: Map<K, Edge[]>, k: K, e: Edge): void {
    const list = map.get(k);
    if (list) list.push(e);
    else map.set(k, [e]);
  }
  private static key(x: number, y: number): number {
    return (x + 32768) * 65536 + (y + 32768);
  }

  /** The nodes (i, j) of a grid of `step` metres that `lower` may dig, one list per piece of moat and gate crossing. */
  *nodes(step: number): Generator<[number, number][]> {
    for (let p = 0; p < this.pieces.length; p++) {
      const { y0, y1 } = this.pieces[p],
        out: [number, number][] = [];
      for (let j = Math.ceil(y0 / step); j * step <= y1; j++) {
        const y = j * step,
          xs: number[] = [];
        for (const e of this.rows.get(Math.floor(y / ROW)) ?? []) if (e.piece === p && e.ay > y !== e.by > y) xs.push(((e.bx - e.ax) * (y - e.ay)) / (e.by - e.ay) + e.ax);
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.ceil(xs[k] / step); i * step <= xs[k + 1]; i++) out.push([i, j]);
      }
      yield out;
    }
    for (const sp of this.spans) {
      const reach = Math.hypot(Math.max(Math.abs(sp.first), Math.abs(sp.last)), sp.half + sp.slope + 0.5),
        out: [number, number][] = [];
      for (let j = Math.ceil((sp.b.y - reach) / step); j * step <= sp.b.y + reach; j++) for (let i = Math.ceil((sp.b.x - reach) / step); i * step <= sp.b.x + reach; i++) out.push([i, j]);
      yield out;
    }
    // The outer banks: the nodes within their width of a counterscarp edge.
    for (let k = 0; k < this.banks.length; k += 64) {
      const out: [number, number][] = [];
      for (const e of this.banks.slice(k, k + 64)) {
        const w = this.pieces[e.piece].bankWidth;
        for (let j = Math.ceil((Math.min(e.ay, e.by) - w) / step); j * step <= Math.max(e.ay, e.by) + w; j++) for (let i = Math.ceil((Math.min(e.ax, e.bx) - w) / step); i * step <= Math.max(e.ax, e.bx) + w; i++) out.push([i, j]);
      }
      yield out;
    }
  }

  /** Height of the dug ground at (x, y), given the undug `height`. */
  lower(x: number, y: number, height: number): number {
    if (this.empty) return height;
    let cut = 0,
      rise = 0;
    for (const sp of this.spans) {
      const dx = x - sp.b.x,
        dy = y - sp.b.y,
        t = dx * sp.s.x + dy * sp.s.y,
        o = dx * sp.n.x + dy * sp.n.y;
      // Across the band the scarp profile; along it flat, past the causeway's edges by one slope (no ridge at the piece ends).
      if (t < sp.first || t > sp.last || Math.abs(o) > sp.half + sp.slope + 0.5) continue;
      const u = Math.min(1, Math.min(t - sp.first, sp.last - t) / sp.slope);
      cut = Math.max(cut, sp.depth * u * u * (3 - 2 * u));
    }
    const candidates = this.boxes.get(UrbanGroundCuts.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!candidates) return height - cut;
    for (const i of candidates) {
      const p = this.pieces[i];
      if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) continue;
      // Inside: parity of the edges of this piece crossed by a ray towards +x.
      let inside = false;
      for (const e of this.rows.get(Math.floor(y / ROW)) ?? []) {
        if (e.piece !== i || e.ay > y === e.by > y) continue;
        if (x < ((e.bx - e.ax) * (y - e.ay)) / (e.by - e.ay) + e.ax) inside = !inside;
      }
      if (!inside && !p.bankWidth) continue;
      let d = inside ? p.reach : p.bankWidth;
      for (const e of this.cells.get(UrbanGroundCuts.key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
        if (e.piece !== i || (!inside && !e.outer)) continue;
        const dx = e.bx - e.ax,
          dy = e.by - e.ay,
          l = dx * dx + dy * dy;
        const t = l ? Math.max(0, Math.min(1, ((x - e.ax) * dx + (y - e.ay) * dy) / l)) : 0;
        d = Math.min(d, Math.hypot(e.ax + t * dx - x, e.ay + t * dy - y));
      }
      if (inside) cut = Math.max(cut, moatCut(p.form, p.depth, p.slope, p.half, d));
      else rise = Math.max(rise, moatBankRise(p.form, d));
    }
    // A bank never stands in a ditch or a crossing.
    return cut > 0 ? height - cut : height + rise;
  }
}
