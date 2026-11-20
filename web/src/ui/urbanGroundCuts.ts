import type { Point } from '../../../rust/bridge/housesContract';
import { netPolygonArea } from '../gen/core/geom';
import { moatDepth, moatSpans, type MoatSpan } from '../render/city3dMoat';

/** Ground cuts of the 3D terrain: the moats of the town circuits, dug by their depth with sloped scarp and
 * counterscarp. Built once per set of circuits (`city3d.ts` hands it to the terrain with `setGroundCuts`);
 * the terrain lowers its tile heights through `lower`, as it raises or lowers building footings
 * (urbanBuildingGround.ts). Walls, bridges and quays keep the undug ground (the town's placement height).
 * A moat piece lowers the ground inside its polygon only: depth × smoothstep(distance to its edge / slope).
 * Edges shared by two pieces (tiles of one moat) are not banks, so a moat tiled by the engine digs as one. */
interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  piece: number;
  bank: boolean;
}
interface Piece {
  depth: number;
  slope: number;
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
  private readonly spans: (MoatSpan & { slope: number })[] = [];
  readonly empty: boolean;

  constructor(circuits: readonly Circuit[] = []) {
    const key = (p: Point): string => `${Math.round(p.x * 20)},${Math.round(p.y * 20)}`;
    const shared = new Map<string, number>();
    const rings: { ring: Point[]; piece: number }[] = [];
    for (const e of circuits) for (const span of moatSpans(e.gatehouses ?? [], e.ditch ?? [])) this.spans.push({ ...span, slope: Math.max(0.5, Math.min(span.depth * 1.2, 0.45 * (span.last - span.first))) });
    for (const e of circuits)
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
        const area = netPolygonArea(outer, holes);
        // Mean band width: area over half the perimeter.
        const depth = moatDepth(d),
          width = (2 * area) / Math.max(1, perimeter);
        // Scarp about 1:1.2, never past the middle of the band.
        const piece = this.pieces.push({ depth, slope: Math.max(0.5, Math.min(depth * 1.2, 0.45 * width)), x0, y0, x1, y1 }) - 1;
        for (const ring of all) rings.push({ ring, piece });
      }
    for (const { ring, piece } of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        const edge: Edge = { ax: a.x, ay: a.y, bx: b.x, by: b.y, piece, bank: (shared.get([key(a), key(b)].sort().join('|')) ?? 0) < 2 };
        for (let r = Math.floor(Math.min(a.y, b.y) / ROW); r <= Math.floor(Math.max(a.y, b.y) / ROW); r++) this.at(this.rows, r, edge);
        if (!edge.bank) continue;
        const reach = this.pieces[piece].slope;
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

  /** Height of the dug ground at (x, y), given the undug `height`. */
  lower(x: number, y: number, height: number): number {
    if (this.empty) return height;
    let cut = 0;
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
      if (!inside) continue;
      let d = p.slope;
      for (const e of this.cells.get(UrbanGroundCuts.key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
        if (e.piece !== i) continue;
        const dx = e.bx - e.ax,
          dy = e.by - e.ay,
          l = dx * dx + dy * dy;
        const t = l ? Math.max(0, Math.min(1, ((x - e.ax) * dx + (y - e.ay) * dy) / l)) : 0;
        d = Math.min(d, Math.hypot(e.ax + t * dx - x, e.ay + t * dy - y));
      }
      const s = Math.min(1, d / p.slope);
      cut = Math.max(cut, p.depth * s * s * (3 - 2 * s));
    }
    return height - cut;
  }
}
