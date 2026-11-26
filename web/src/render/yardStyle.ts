import type { Point } from '../../../rust/bridge/urban';
import { cultureIdentity, type PaletteRgb } from './buildingPalette';
import type { CityPalette } from './cityCanvas';
import type { YardBoundary } from './cityLotEnclosures';

/** One look for yard boundaries, read by the plan stroke and by the 3D mesh. */
export type YardMaterial = YardBoundary['material'];
export interface YardStyle {
  /** Final sRGB of the boundary as seen: plan stroke, mesh body once lit. */ color: string;
  /** Its companion: wall coping, hedge crown, second tone of a wooden sheet. */ accent: string;
  /** Gate jambs and posts: dark enough to mark a gap of a few pixels; wood, except in a wall. */ jamb: string;
  /** Real width on the plan (m). */ width: number;
  /** Smallest apparent width of the plan stroke (px). */ minPx: number;
  /** Plan stroke opacity: high enough to keep a clean line over any ground. */ alpha: number;
}
const rgb = (hex: string): PaletteRgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as PaletteRgb;
const hex = (c: readonly number[]): string =>
  '#' +
  c
    .map(v =>
      Math.max(0, Math.min(255, Math.round(v * 255)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const mix = (a: readonly number[], b: readonly number[], t: number): number[] => a.map((v, i) => v + (b[i] - v) * t);
const shade = (c: readonly number[], k: number): number[] => c.map(v => v * k);
/** Four hedge tones by climate, earthy rather than green; the families of cultureIdentity pick one. */
const HEDGES: Record<string, string> = { temperate: '#5f5340', dry: '#7b6a4b', lush: '#524c38', cold: '#5b5549' };
const CLIMATE: Record<string, string> = {
  whitewash: 'dry',
  aegean: 'dry',
  sand: 'dry',
  ochre: 'dry',
  felt: 'dry',
  highland: 'cold',
  norse: 'cold',
  dwarven: 'cold',
  duergar: 'cold',
  drow: 'cold',
  necropolis: 'cold',
  giant: 'cold',
  tropical: 'lush',
  mesoamerican: 'lush',
  elven: 'lush',
  swamp: 'lush',
  tidal: 'lush',
  myconid: 'lush',
};
const WOOD = rgb('#77634c'),
  WATTLE = rgb('#8a7857'),
  SEPIA = rgb('#6b5236');
const MONO = new Set<CityPalette>(['parchment', 'ink']);
const STYLES = new Map<string, YardStyle>();

/** Hedges follow the climate of the culture's family, wood leans towards its wall colour, walls take its wall and stone.
 * Parchment and ink pull everything towards their sepia. */
export function yardStyle(material: YardMaterial, culture = '', palette: CityPalette = 'terrain', fenceStyle?: YardBoundary['fenceStyle']): YardStyle {
  const key = `${material}/${culture}/${MONO.has(palette) ? 'mono' : ''}/${fenceStyle ?? ''}`;
  let style = STYLES.get(key);
  if (style) return style;
  const c = cultureIdentity(culture),
    ink = (v: readonly number[]): string => hex(MONO.has(palette) ? mix(v, SEPIA, 0.2) : v);
  const post = ink(shade(mix(WOOD, c.wall, 0.22), 0.7));
  if (material === 'hedge') {
    const tone = rgb(HEDGES[CLIMATE[c.family] ?? 'temperate']);
    style = { color: ink(tone), accent: ink(mix(tone, [0.72, 0.66, 0.5], 0.22)), jamb: post, width: 0.6, minPx: 1.2, alpha: 0.92 };
  } else if (material === 'wall') {
    const body = shade(mix(c.wall, c.stone, 0.35), 0.8);
    const coping = shade(mix(c.roof, body, 0.5), 0.85);
    style = { color: ink(body), accent: ink(coping), jamb: ink(shade(coping, 0.75)), width: 0.45, minPx: 1.2, alpha: 0.95 };
  } else {
    const wood = mix(fenceStyle === 'plank' ? WOOD : WATTLE, c.wall, 0.22);
    style = { color: ink(wood), accent: ink(shade(wood, 0.84)), jamb: post, width: 0.16, minPx: 1, alpha: 0.92 };
  }
  STYLES.set(key, style);
  return style;
}
/** Do not over-expose narrow walls to compensate for their shaded side: the lit
 * side otherwise clips to white and reads as a parcel selection outline. */
const SIDE_LIGHT = 1;
export const TOP_LIGHT = 1;
/** Matte yard albedo (six hex digits); its directional shade belongs to the mesh. */
export const yardMeshTint = (color: string, light = SIDE_LIGHT): string => hex(shade(rgb(color), 1 / light)).slice(1);

export interface YardRun {
  path: Point[];
  closed: boolean;
  source: YardBoundary;
}
export interface YardGate {
  a: Point;
  b: Point;
  source: YardBoundary;
}
const RUNS = new WeakMap<readonly YardBoundary[], { runs: YardRun[]; gates: YardGate[] }>();
const MIN_STEP = 0.05,
  GATE_MIN = 0.8,
  GATE_MAX = 4.4;
const lookOf = (e: YardBoundary): string => `${e.material}/${e.fenceStyle ?? ''}/${e.culture ?? ''}/${e.height ?? ''}`;

const paths = new WeakMap<YardBoundary, Point[] | null>();
function yardPath(e: YardBoundary): Point[] | null {
  const held = paths.get(e);
  if (held !== undefined) return held;
  const path: Point[] = [];
  for (const p of e.path) {
    const q = path[path.length - 1];
    if (Number.isFinite(p.x) && Number.isFinite(p.y) && (!q || Math.hypot(p.x - q.x, p.y - q.y) >= MIN_STEP)) path.push(p);
  }
  const result = path.length >= 2 && path.every((p, i) => !i || Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) <= 2000) ? path : null;
  paths.set(e, result);
  return result;
}
/** The boundaries as drawn: pieces of the same look meeting end to end become one polyline, so a corner is a true joint, and at
 * a junction the straightest pair goes through while the others butt into it. Ends left free and facing each other across a
 * short gap are the jambs of a gate. Bad input (non-finite or km-long sides) is left out. */
export function yardRuns(enclosures: readonly YardBoundary[]): { runs: YardRun[]; gates: YardGate[] } {
  const cached = RUNS.get(enclosures);
  if (cached) return cached;
  const pieces: { path: Point[]; source: YardBoundary }[] = [];
  for (const e of enclosures) {
    const path = yardPath(e);
    if (path) pieces.push({ path, source: e });
  }
  // end 2i: the head of piece i; end 2i + 1: its tail. `outward` is the direction of the piece as it reaches that end.
  const pointOf = (end: number): Point => {
    const p = pieces[end >> 1].path;
    return end & 1 ? p[p.length - 1] : p[0];
  };
  const outward = (end: number): Point => {
    const p = pieces[end >> 1].path,
      a = end & 1 ? p[p.length - 1] : p[0],
      b = end & 1 ? p[p.length - 2] : p[1],
      l = Math.hypot(a.x - b.x, a.y - b.y);
    return { x: (a.x - b.x) / l, y: (a.y - b.y) / l };
  };
  const nodes = new Map<string, number[]>();
  pieces.forEach((piece, i) => {
    const look = lookOf(piece.source);
    for (const end of [2 * i, 2 * i + 1]) {
      const p = pointOf(end),
        k = `${look}|${Math.round(p.x * 20)},${Math.round(p.y * 20)}`,
        l = nodes.get(k);
      if (l) l.push(end);
      else nodes.set(k, [end]);
    }
  });
  const link = new Int32Array(2 * pieces.length).fill(-1),
    lone = new Uint8Array(2 * pieces.length);
  for (const ends of nodes.values()) {
    if (ends.length === 1) {
      lone[ends[0]] = 1;
      continue;
    }
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const u = outward(ends[i]),
          v = outward(ends[j]);
        pairs.push([u.x * v.x + u.y * v.y, ends[i], ends[j]]);
      }
    pairs.sort((a, b) => a[0] - b[0]); // two pieces reaching a node head-on continue each other: most opposed first
    for (const [, a, b] of pairs)
      if (link[a] < 0 && link[b] < 0) {
        link[a] = b;
        link[b] = a;
      }
  }
  const seen = new Uint8Array(pieces.length),
    runs: YardRun[] = [];
  const walk = (start: number): void => {
    const path: Point[] = [];
    let end = start,
      closed = false;
    for (;;) {
      const i = end >> 1;
      seen[i] = 1;
      const part = end & 1 ? [...pieces[i].path].reverse() : pieces[i].path;
      path.push(...(path.length ? part.slice(1) : part));
      const next = link[end ^ 1];
      if (next < 0) break;
      if (seen[next >> 1]) {
        closed = next === start;
        break;
      }
      end = next;
    }
    runs.push({ path, closed, source: pieces[start >> 1].source });
  };
  for (let end = 0; end < link.length; end++) if (link[end] < 0 && !seen[end >> 1]) walk(end);
  for (let i = 0; i < pieces.length; i++) if (!seen[i]) walk(2 * i);
  // gates: two free ends of one look, aimed at each other across a short gap
  const cells = new Map<string, number[]>(),
    C = GATE_MAX,
    cell = (x: number, y: number): string => `${Math.floor(x / C)},${Math.floor(y / C)}`;
  const free: number[] = [];
  for (let end = 0; end < link.length; end++)
    if (lone[end]) {
      free.push(end);
      const p = pointOf(end),
        k = cell(p.x, p.y),
        l = cells.get(k);
      if (l) l.push(end);
      else cells.set(k, [end]);
    }
  const taken = new Uint8Array(link.length),
    gates: YardGate[] = [];
  for (const end of free) {
    if (taken[end]) continue;
    const a = pointOf(end),
      u = outward(end),
      look = lookOf(pieces[end >> 1].source);
    let best = -1,
      near = Infinity;
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (const other of cells.get(cell(a.x + x * C, a.y + y * C)) ?? []) {
          if (other === end || taken[other] || lookOf(pieces[other >> 1].source) !== look) continue;
          const b = pointOf(other),
            dx = b.x - a.x,
            dy = b.y - a.y,
            d = Math.hypot(dx, dy);
          if (d < GATE_MIN || d > GATE_MAX || d >= near) continue;
          const v = outward(other);
          if ((u.x * dx + u.y * dy) / d > 0.9 && -(v.x * dx + v.y * dy) / d > 0.9) {
            near = d;
            best = other;
          }
        }
    if (best >= 0) {
      taken[end] = taken[best] = 1;
      gates.push({ a, b: pointOf(best), source: pieces[end >> 1].source });
    }
  }
  const result = { runs, gates };
  RUNS.set(enclosures, result);
  return result;
}

interface BoundaryNode {
  boundary: YardBoundary;
  ends: Point[];
  look: string;
  order: number;
  component?: BoundaryGroup;
}
interface BoundaryGroup {
  nodes: BoundaryNode[];
  geometry: ReturnType<typeof yardRuns>;
}
/** Connected components of same-look endpoints within gate reach. Every possible through joint and gate
 * pairing is internal to one such component. Invalidation follows old and new links across tile boundaries. */
export class RetainedYardRuns {
  private source?: readonly YardBoundary[];
  private nodes = new Map<string, BoundaryNode[]>();
  private bins = new Map<string, Set<BoundaryNode>>();
  private groups = new Set<BoundaryGroup>();
  private result: ReturnType<typeof yardRuns> = { runs: [], gates: [] };
  private keys = new WeakMap<YardBoundary, string>();
  private key(e: YardBoundary): string {
    let key = this.keys.get(e);
    if (key === undefined) this.keys.set(e, (key = JSON.stringify([lookOf(e), e.path.map(p => [p.x, p.y])])));
    return key;
  }
  private bin(p: Point, look: string, dx = 0, dy = 0) {
    return look + '|' + (Math.floor(p.x / GATE_MAX) + dx) + ',' + (Math.floor(p.y / GATE_MAX) + dy);
  }
  private neighbours(n: BoundaryNode): Set<BoundaryNode> {
    const found = new Set<BoundaryNode>();
    for (const p of n.ends)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const other of this.bins.get(this.bin(p, n.look, dx, dy)) ?? []) {
            if (other !== n && other.ends.some(q => Math.hypot(p.x - q.x, p.y - q.y) <= GATE_MAX)) found.add(other);
          }
    return found;
  }
  update(list: readonly YardBoundary[]): ReturnType<typeof yardRuns> {
    if (list === this.source) return this.result;
    const next = new Map<string, BoundaryNode[]>(),
      pending = new Set<BoundaryNode>(),
      invalid = new Set<BoundaryGroup>(),
      last = new Map<BoundaryGroup, number>();
    const order = new Map<YardBoundary, number>();
    for (const [i, e] of list.entries()) {
      const key = this.key(e);
      let bucket = next.get(key);
      if (!bucket) next.set(key, (bucket = []));
      let n = this.nodes.get(key)?.[bucket.length];
      if (!n) {
        const path = yardPath(e);
        if (!path) continue;
        // Separate identical occurrences, preserving the tie order the exact town passes to yardRuns.
        n = { boundary: { ...e }, ends: [path[0], path[path.length - 1]], look: lookOf(e), order: i };
        pending.add(n);
        for (const p of n.ends) {
          const k = this.bin(p, n.look);
          let group = this.bins.get(k);
          if (!group) this.bins.set(k, (group = new Set()));
          group.add(n);
        }
        for (const near of this.neighbours(n)) if (near.component) invalid.add(near.component);
      } else if (n.component) {
        if (n.order < (last.get(n.component) ?? -1)) invalid.add(n.component);
        last.set(n.component, n.order);
      }
      n.order = i;
      bucket.push(n);
      order.set(n.boundary, i);
    }
    for (const [k, old] of this.nodes)
      for (let i = next.get(k)?.length ?? 0; i < old.length; i++) {
        const n = old[i];
        if (n.component) invalid.add(n.component);
        for (const p of n.ends) {
          const key = this.bin(p, n.look),
            bin = this.bins.get(key);
          bin?.delete(n);
          if (!bin?.size) this.bins.delete(key);
        }
      }
    for (const group of invalid) {
      this.groups.delete(group);
      for (const n of group.nodes)
        if (order.has(n.boundary)) {
          n.component = undefined;
          pending.add(n);
        }
    }
    while (pending.size) {
      const first = pending.values().next().value!,
        nodes = [first];
      pending.delete(first);
      for (let n = 0; n < nodes.length; n++) for (const near of this.neighbours(nodes[n])) if (pending.delete(near)) nodes.push(near);
      nodes.sort((a, b) => a.order - b.order);
      const group = { nodes, geometry: yardRuns(nodes.map(n => n.boundary)) };
      for (const n of nodes) n.component = group;
      this.groups.add(group);
    }
    this.source = list;
    this.nodes = next;
    const runs = [...this.groups].flatMap(g => g.geometry.runs).sort((a, b) => Number(a.closed) - Number(b.closed) || order.get(a.source)! - order.get(b.source)!);
    const gates = [...this.groups].flatMap(g => g.geometry.gates).sort((a, b) => order.get(a.source)! - order.get(b.source)!);
    return (this.result = { runs, gates });
  }
}
