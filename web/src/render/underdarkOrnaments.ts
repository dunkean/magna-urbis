/** Underdark town ornaments (display only): drow spider webs strung between their tall towers, out to the cave floor
 * and over a couple of squares; duergar forge vents with an ember glow, iron spikes along the roofs of their keeps and
 * barracks, squat guard towers at the outer street ends and the unguarded gates.
 *
 * One derivation from the layouts and the placed buildings (`underdarkOrnaments`, cached per input pair) feeds the 2D plan
 * (`drawUnderdarkOrnaments`, called by the shared `finishCityFrame`) and the 3D city (`city3dUnderdarkOrnaments`, built
 * once with the other structures in `mountCity3d`), so V2, City Bench and the render board draw the same ornaments.
 * Deterministic: everything hashes on the layout key and building ids, never on draw order.
 * Budget: a web is at most ~180 triangles, a forge 14, a spike 2, a guard tower ~40; their volumes are `minor`, so the
 * 3D overview LOD drops them with the chimneys. Ember faces use the lit-opening material: they glow only when the
 * shared Underdark lights decision (underdarkLighting.ts) turns the town's lamps on. */
import type { Layout, Point, Shape } from '../../../rust/bridge/urban';
import type { ArchitectureVolume, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { MaterialSlots } from '../../../rust/bridge/housesContract';
import { MINOR_VOLUME_ROLE, building3dHeight, type Building3dVisual } from './urbanBuildingGeometry';

/** Culture data: which ornaments a town of the culture carries. */
export const UNDERDARK_ORNAMENTS: Readonly<Record<string, { webs?: boolean; forges?: boolean; spikes?: boolean; guards?: boolean }>> = { 'drow-enclave': { webs: true }, 'duergar-hold': { forges: true, spikes: true, guards: true } };

/** A web anchor: on a building (`rise` = share of its height) or on the floor (`rise` in metres above the ground). */
export interface WebAnchor {
  x: number;
  y: number;
  rise: number;
  building?: string;
}
export interface OrnamentWeb {
  id: string;
  kind: 'span' | 'canopy';
  frame: WebAnchor[];
  radials: number;
  turns: number;
  seed: number;
}
export interface OrnamentForge {
  id: string;
  building: string;
  x: number;
  y: number;
  size: number;
  /** Forge mouth on the nearest wall and its outward normal. */ mouth: [Point, Point];
  normal: Point;
  ring: Point[];
}
export interface OrnamentSpikes {
  id: string;
  building: string;
  points: { x: number; y: number; ux: number; uy: number }[];
  ring: Point[];
}
export interface OrnamentGuard {
  id: string;
  x: number;
  y: number;
  ux: number;
  uy: number;
  half: number;
  height: number;
}
export interface UnderdarkOrnaments {
  webs: OrnamentWeb[];
  forges: OrnamentForge[];
  spikes: OrnamentSpikes[];
  guards: OrnamentGuard[];
  heights: ReadonlyMap<string, number>;
}

type Source = Pick<PlacedBuilding, 'id' | 'footprint'> & { function?: string };
const EMPTY: UnderdarkOrnaments = { webs: [], forges: [], spikes: [], guards: [], heights: new Map() };
const CACHE = new WeakMap<object, WeakMap<object, UnderdarkOrnaments>>();

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const unit = (text: string): number => hashText(text) / 4294967296;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
function inRing(ring: readonly Point[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
const ringArea = (ring: readonly Point[]): number => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return s / 2;
};

interface Item {
  id: string;
  ring: Point[];
  c: Point;
  area: number;
  role: string;
  fn: string;
  landmark: boolean;
  height: number;
  box: [number, number, number, number];
}
function itemOf(b: Source): Item | undefined {
  let ring: Point[] | undefined,
    area = 0;
  for (const s of b.footprint ?? []) {
    const a = Math.abs(ringArea(s.outer));
    if (a > area) {
      area = a;
      ring = s.outer;
    }
  }
  if (!ring || ring.length < 3 || area < 4) return undefined;
  let x = 0,
    y = 0,
    x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of ring) {
    x += p.x;
    y += p.y;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const programme = (b as { programme?: { role?: string; landmark?: boolean } }).programme;
  let height = 0;
  try {
    height = building3dHeight(b as Building3dVisual);
  } catch {
    height = 0;
  }
  return { id: b.id, ring, c: { x: x / ring.length, y: y / ring.length }, area, role: (programme?.role ?? '').toLowerCase(), fn: b.function ?? '', landmark: !!programme?.landmark, height: Number.isFinite(height) ? height : 0, box: [x0, y0, x1, y1] };
}
const containing = (items: readonly Item[], x: number, y: number): Item | undefined => items.find(i => x >= i.box[0] && x <= i.box[2] && y >= i.box[1] && y <= i.box[3] && inRing(i.ring, x, y));

/** Ornaments of every Underdark layout of the town (empty for the other cultures). */
export function underdarkOrnaments(layouts: readonly Layout[] | undefined, buildings: readonly Source[] | undefined): UnderdarkOrnaments {
  if (!layouts?.length || !buildings?.length || !layouts.some(l => UNDERDARK_ORNAMENTS[l.culture])) return EMPTY;
  let byBuildings = CACHE.get(layouts);
  if (!byBuildings) CACHE.set(layouts, (byBuildings = new WeakMap()));
  let plan = byBuildings.get(buildings);
  if (!plan) byBuildings.set(buildings, (plan = deriveOrnaments(layouts, buildings)));
  return plan;
}

function deriveOrnaments(layouts: readonly Layout[], buildings: readonly Source[]): UnderdarkOrnaments {
  const out: UnderdarkOrnaments & { heights: Map<string, number> } = { webs: [], forges: [], spikes: [], guards: [], heights: new Map() };
  const targets = layouts.map(layout => {
    const kind = UNDERDARK_ORNAMENTS[layout.culture];
    if (!kind) return undefined;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const q of layout.quarters)
      for (const p of q.shape.outer) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    return Number.isFinite(x0) ? { layout, kind, box: [x0 - 15, y0 - 15, x1 + 15, y1 + 15] as const, items: [] as Item[] } : undefined;
  });
  for (const b of buildings) {
    if (b.id.startsWith('city3d-')) continue;
    const item = itemOf(b);
    if (!item) continue;
    const t = targets.find(t => t && item.c.x >= t.box[0] && item.c.x <= t.box[2] && item.c.y >= t.box[1] && item.c.y <= t.box[3]);
    if (t) t.items.push(item);
  }
  for (const t of targets) {
    if (!t || !t.items.length) continue;
    const { layout, kind, items } = t;
    if (kind.webs) drowWebs(layout, items, out);
    if (kind.forges) duergarForges(layout, items, out);
    if (kind.spikes) duergarSpikes(layout, items, out);
    if (kind.guards) duergarGuards(layout, items, out);
  }
  return out;
}

// ---------------------------------------------------------------- drow webs
const TOWER_ROLE = /tower|spire|sanctum|temple|worship|power|palace|keep|citadel|monument/;
function drowWebs(layout: Layout, items: Item[], out: UnderdarkOrnaments & { heights: Map<string, number> }): void {
  const n = items.length,
    key = layout.key,
    centre = layout.center;
  const anchorAt = (x: number, y: number, rise: number): WebAnchor => {
    const host = containing(items, x, y);
    if (host) {
      out.heights.set(host.id, host.height);
      return { x, y, rise: 1, building: host.id };
    }
    return { x, y, rise };
  };
  if (n >= 4) {
    const score = (i: Item): number => (i.height > 0 ? i.height : 6) + (i.landmark ? 25 : 0) + (TOWER_ROLE.test(i.role) ? 15 : 0) + Math.min(20, Math.sqrt(i.area) * 0.4) + unit(`${key}:${i.id}`) * 2;
    const towers = [...items].sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1)).slice(0, clamp(Math.round(Math.sqrt(n) / 4), 2, 6));
    const tower = (i: Item): WebAnchor => {
      out.heights.set(i.id, i.height);
      return { x: i.c.x, y: i.c.y, rise: 0.9, building: i.id };
    };
    // Spans between towers: medium distances first, each tower holding at most two webs.
    const pairs: [Item, Item, number][] = [];
    for (let a = 0; a < towers.length; a++)
      for (let b = a + 1; b < towers.length; b++) {
        const d = Math.hypot(towers[b].c.x - towers[a].c.x, towers[b].c.y - towers[a].c.y);
        if (d >= 16 && d <= 150) pairs.push([towers[a], towers[b], d]);
      }
    pairs.sort((p, q) => Math.abs(p[2] - 55) - Math.abs(q[2] - 55));
    const used = new Map<string, number>(),
      spans = clamp(1 + Math.floor(n / 220), 1, 4);
    let made = 0;
    for (const [a, b, d] of pairs) {
      if (made >= spans) break;
      if ((used.get(a.id) ?? 0) >= 2 || (used.get(b.id) ?? 0) >= 2) continue;
      used.set(a.id, (used.get(a.id) ?? 0) + 1);
      used.set(b.id, (used.get(b.id) ?? 0) + 1);
      const id = `${key}:span:${made}`,
        s = unit(id),
        side = s < 0.5 ? -1 : 1,
        mx = (a.c.x + b.c.x) / 2,
        my = (a.c.y + b.c.y) / 2;
      const nx = (-(b.c.y - a.c.y) / d) * side,
        ny = ((b.c.x - a.c.x) / d) * side,
        reach = d * (0.38 + 0.2 * s),
        slide = (s - 0.5) * 0.3 * d;
      const gx = mx + nx * reach + ((b.c.x - a.c.x) / d) * slide,
        gy = my + ny * reach + ((b.c.y - a.c.y) / d) * slide;
      out.webs.push({ id, kind: 'span', frame: [tower(a), tower(b), anchorAt(gx, gy, 0.6)], radials: 9 + Math.floor(s * 3), turns: 5, seed: hashText(id) });
      made++;
    }
    // Out to the cave: the outermost towers throw a web to a stalagmite and the floor beyond the last houses.
    const outward = n > 500 ? 2 : n > 60 ? 1 : 0;
    const far = [...towers].sort((a, b) => Math.hypot(b.c.x - centre.x, b.c.y - centre.y) - Math.hypot(a.c.x - centre.x, a.c.y - centre.y));
    for (let k = 0; k < Math.min(outward, far.length); k++) {
      const t = far[k],
        dx = t.c.x - centre.x,
        dy = t.c.y - centre.y,
        l = Math.hypot(dx, dy) || 1,
        ux = dx / l,
        uy = dy / l;
      const id = `${key}:cave:${k}`,
        s = unit(id),
        reach = 30 + 22 * s,
        turn = 0.42;
      const p1 = { x: t.c.x + (ux * Math.cos(turn) - uy * Math.sin(turn)) * reach, y: t.c.y + (ux * Math.sin(turn) + uy * Math.cos(turn)) * reach };
      const p2 = { x: t.c.x + (ux * Math.cos(-turn) - uy * Math.sin(-turn)) * reach * 0.85, y: t.c.y + (ux * Math.sin(-turn) + uy * Math.cos(-turn)) * reach * 0.85 };
      out.webs.push({ id, kind: 'span', frame: [tower(t), anchorAt(p1.x, p1.y, 7 + 5 * s), anchorAt(p2.x, p2.y, 0.5)], radials: 10, turns: 5, seed: hashText(id) });
    }
  }
  // Canopies over a couple of squares, hung from the surrounding roofs.
  const squares = (layout.blocks ?? [])
    .map(b => ({ b, area: Math.abs(ringArea(b.shape.outer)) }))
    .filter(({ b, area }) => (b.kind === 'place' || b.kind === 'market') && area >= 100 && area <= 6000 && b.shape.outer.length >= 3)
    .sort((p, q) => q.area - p.area)
    .slice(0, n > 150 ? 2 : 1);
  squares.forEach(({ b }, k) => {
    const ring = b.shape.outer,
      m = Math.min(6, ring.length),
      cx = ring.reduce((s, p) => s + p.x, 0) / ring.length,
      cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    const frame: WebAnchor[] = [];
    for (let j = 0; j < m; j++) {
      const p = ring[Math.floor((j * ring.length) / m)],
        dx = cx - p.x,
        dy = cy - p.y,
        l = Math.hypot(dx, dy) || 1,
        inset = Math.min(1, l * 0.2);
      frame.push({ x: p.x + (dx / l) * inset, y: p.y + (dy / l) * inset, rise: 7 });
    }
    const id = `${key}:canopy:${k}`;
    out.webs.push({ id, kind: 'canopy', frame, radials: 12, turns: 6, seed: hashText(id) });
  });
}

/** Threads of a web from its frame in 3D (2D drops z): the frame, the radials and one spiral from the hub outwards. */
export function webThreads(web: OrnamentWeb, frame: readonly { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[][] {
  const m = frame.length;
  if (m < 3) return [];
  const perim: number[] = [0];
  for (let i = 0; i < m; i++) {
    const a = frame[i],
      b = frame[(i + 1) % m];
    perim.push(perim[i] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const total = perim[m];
  if (!(total > 1)) return [];
  const at = (s: number): { x: number; y: number; z: number } => {
    s = ((s % total) + total) % total;
    let i = 0;
    while (i < m - 1 && perim[i + 1] < s) i++;
    const a = frame[i],
      b = frame[(i + 1) % m],
      t = (s - perim[i]) / Math.max(1e-9, perim[i + 1] - perim[i]);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  };
  const hub = { x: frame.reduce((s, p) => s + p.x, 0) / m, y: frame.reduce((s, p) => s + p.y, 0) / m, z: frame.reduce((s, p) => s + p.z, 0) / m };
  hub.z -= web.kind === 'canopy' ? 1.2 : Math.min(4, total * 0.02);
  const R = web.radials,
    K = web.turns,
    offset = (((web.seed % 1000) / 1000) * total) / R;
  const ends = Array.from({ length: R }, (_, j) => at(offset + ((j + 0.25 * (((web.seed >>> (j % 24)) & 1) - 0.5)) * total) / R));
  const threads: { x: number; y: number; z: number }[][] = [[...frame, frame[0]]];
  for (const e of ends) threads.push([hub, e]);
  const spiral: { x: number; y: number; z: number }[] = [],
    t0 = 0.14,
    t1 = 0.9;
  for (let k = 0; k < K; k++)
    for (let j = 0; j < R; j++) {
      const t = t0 + ((k + j / R) * (t1 - t0)) / K,
        e = ends[j];
      spiral.push({ x: hub.x + (e.x - hub.x) * t, y: hub.y + (e.y - hub.y) * t, z: hub.z + (e.z - hub.z) * t - Math.sin(Math.PI * t) * 0.15 });
    }
  threads.push(spiral);
  return threads;
}

// ---------------------------------------------------------------- duergar
const FORGE_ROLE = /smith|forge|smelt|foundry|kiln|metal|factory|workshop|arsenal|mine|ore|activity|craft/;
const SPIKE_ROLE = /keep|barrack|tower|arsenal|fort|castle|citadel|garrison|guard|defen[cs]e/;
function longAxis(ring: readonly Point[]): { c: Point; ux: number; uy: number; half: number } {
  let best = 0,
    ux = 1,
    uy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > best) {
      best = l;
      ux = (b.x - a.x) / l;
      uy = (b.y - a.y) / l;
    }
  }
  let s0 = Infinity,
    s1 = -Infinity,
    t0 = Infinity,
    t1 = -Infinity;
  for (const p of ring) {
    const s = p.x * ux + p.y * uy,
      t = -p.x * uy + p.y * ux;
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
  }
  const s = (s0 + s1) / 2,
    t = (t0 + t1) / 2;
  return { c: { x: s * ux - t * uy, y: s * uy + t * ux }, ux, uy, half: (s1 - s0) / 2 };
}
function duergarForges(layout: Layout, items: Item[], out: UnderdarkOrnaments & { heights: Map<string, number> }): void {
  const key = layout.key,
    n = items.length;
  let pool = items.filter(i => FORGE_ROLE.test(i.role));
  if (!pool.length) pool = items.filter(i => i.fn === 'workshop' || i.fn === 'warehouse');
  if (!pool.length) {
    // The industrial quarter: districts of a craft role.
    const quarters = new Set((layout.structure?.districts ?? []).filter(d => /craft|industr/.test(d.role ?? '')).flatMap(d => d.quarters));
    const shapes = [...quarters].map(q => layout.quarters[q]?.shape).filter((s): s is Shape => !!s);
    pool = items.filter(i => shapes.some(s => inRing(s.outer, i.c.x, i.c.y)));
  }
  if (!pool.length) pool = items.filter(i => unit(`${key}:forge:${i.id}`) < 0.14);
  const chosen = pool
    .filter(i => i.area >= 24)
    .sort((a, b) => unit(`${key}:f:${a.id}`) - unit(`${key}:f:${b.id}`))
    .slice(0, clamp(Math.round(n / 14), 2, 20));
  for (const i of chosen) {
    const ax = longAxis(i.ring),
      side = unit(`${key}:v:${i.id}`) < 0.5 ? -1 : 1;
    let x = ax.c.x + ax.ux * ax.half * 0.45 * side,
      y = ax.c.y + ax.uy * ax.half * 0.45 * side;
    if (!inRing(i.ring, x, y)) {
      x = ax.c.x;
      y = ax.c.y;
      if (!inRing(i.ring, x, y)) continue;
    }
    // Forge mouth: the middle of the wall nearest the vent.
    let best = Infinity,
      mouth: [Point, Point] = [i.ring[0], i.ring[1]],
      normal = { x: 0, y: 1 };
    const ccw = ringArea(i.ring) > 0;
    for (let k = 0; k < i.ring.length; k++) {
      const a = i.ring[k],
        b = i.ring[(k + 1) % i.ring.length],
        l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l < 2.4) continue;
      const t = clamp(((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (l * l), 0, 1),
        d = Math.hypot(a.x + (b.x - a.x) * t - x, a.y + (b.y - a.y) * t - y);
      if (d < best) {
        best = d;
        const ex = (b.x - a.x) / l,
          ey = (b.y - a.y) / l,
          mt = clamp(t * l, 1.1, l - 1.1);
        mouth = [
          { x: a.x + ex * (mt - 0.8), y: a.y + ey * (mt - 0.8) },
          { x: a.x + ex * (mt + 0.8), y: a.y + ey * (mt + 0.8) },
        ];
        normal = ccw ? { x: ey, y: -ex } : { x: -ey, y: ex };
      }
    }
    out.heights.set(i.id, i.height);
    out.forges.push({ id: `${key}:forge:${i.id}`, building: i.id, x, y, size: clamp(Math.sqrt(i.area) * 0.12, 0.9, 1.6), mouth, normal, ring: i.ring });
  }
}
function duergarSpikes(layout: Layout, items: Item[], out: UnderdarkOrnaments & { heights: Map<string, number> }): void {
  let pool = items.filter(i => SPIKE_ROLE.test(i.role));
  if (!pool.length) pool = items.filter(i => i.landmark);
  for (const i of pool.sort((a, b) => b.area - a.area).slice(0, 10)) {
    const points: OrnamentSpikes['points'] = [],
      ccw = ringArea(i.ring) > 0;
    for (let k = 0; k < i.ring.length && points.length < 40; k++) {
      const a = i.ring[k],
        b = i.ring[(k + 1) % i.ring.length],
        l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l < 1.5) continue;
      const ex = (b.x - a.x) / l,
        ey = (b.y - a.y) / l,
        count = Math.max(1, Math.floor(l / 2.4));
      for (let s = 0; s < count && points.length < 40; s++) {
        const t = ((s + 0.5) * l) / count;
        points.push({ x: a.x + ex * t, y: a.y + ey * t, ux: ccw ? ey : -ey, uy: ccw ? -ex : ex });
      }
    }
    if (!points.length) continue;
    out.heights.set(i.id, i.height);
    out.spikes.push({ id: `${layout.key}:spikes:${i.id}`, building: i.id, points, ring: i.ring });
  }
}
function duergarGuards(layout: Layout, items: Item[], out: UnderdarkOrnaments): void {
  const key = layout.key,
    n = items.length,
    centre = layout.center,
    limit = clamp(Math.round(n / 90) + 2, 2, 8),
    guards: OrnamentGuard[] = [];
  const cell = (p: Point): string => `${Math.round(p.x / 3)}:${Math.round(p.y / 3)}`;
  const counts = new Map<string, number>();
  const streets = layout.streets.filter(s => s.path.length >= 2 && !/bridge|ford|pier|boardwalk|walkway|quay|stairs/.test(s.role));
  for (const s of streets)
    for (const p of s.path)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const k = `${Math.round(p.x / 3) + dx}:${Math.round(p.y / 3) + dy}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
  const towers = (layout.enclosures ?? []).flatMap(e => [...(e.towers_detail ?? []).map(t => t.center), ...(e.gatehouses ?? []).map(g => g.passage[0])]);
  const guarded = (p: Point): boolean => towers.some(t => Math.hypot(t.x - p.x, t.y - p.y) < 14) || guards.some(g => Math.hypot(g.x - p.x, g.y - p.y) < 30);
  const candidates: { p: Point; ux: number; uy: number; width: number; d: number }[] = [];
  for (const s of streets) {
    if (s.rank > 2) continue;
    for (const end of [0, s.path.length - 1]) {
      const p = s.path[end],
        q = s.path[end === 0 ? 1 : end - 1];
      // A street end only: no other street passes within ~3 m (the end's own path counts 9 neighbouring cells at most twice).
      let others = 0;
      for (const o of streets) if (o !== s && o.path.some(v => cell(v) === cell(p) || Math.hypot(v.x - p.x, v.y - p.y) < 3)) others++;
      if (others) continue;
      const l = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      candidates.push({ p, ux: (p.x - q.x) / l, uy: (p.y - q.y) / l, width: s.widths[end === 0 ? 0 : s.widths.length - 1] ?? 4, d: Math.hypot(p.x - centre.x, p.y - centre.y) });
    }
  }
  for (const e of layout.enclosures ?? [])
    for (const g of e.gates) {
      if (e.gatehouses?.length) continue;
      let best = Infinity,
        ux = 1,
        uy = 0;
      for (let k = 0; k + 1 < e.path.length; k++) {
        const a = e.path[k],
          b = e.path[k + 1],
          l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l < 0.5) continue;
        const d = Math.hypot((a.x + b.x) / 2 - g.x, (a.y + b.y) / 2 - g.y);
        if (d < best) {
          best = d;
          ux = -(b.y - a.y) / l;
          uy = (b.x - a.x) / l;
        }
      }
      if ((g.x - centre.x) * ux + (g.y - centre.y) * uy < 0) {
        ux = -ux;
        uy = -uy;
      }
      candidates.push({ p: g, ux, uy, width: 6, d: Math.hypot(g.x - centre.x, g.y - centre.y) + 1e3 });
    }
  candidates.sort((a, b) => b.d - a.d);
  for (const c of candidates) {
    if (guards.length >= limit) break;
    const half = 2.4,
      s = unit(`${key}:g:${Math.round(c.p.x)}:${Math.round(c.p.y)}`) < 0.5 ? -1 : 1;
    for (const side of [s, -s]) {
      const off = c.width / 2 + half + 1.2,
        x = c.p.x - c.uy * off * side,
        y = c.p.y + c.ux * off * side;
      if (guarded({ x, y })) break;
      const box = (k: number, j: number): boolean => !!containing(items, x + (k * c.ux - j * c.uy) * half, y + (k * c.uy + j * c.ux) * half);
      if (box(0, 0) || box(1, 1) || box(-1, 1) || box(1, -1) || box(-1, -1)) continue;
      guards.push({ id: `${key}:guard:${guards.length}`, x, y, ux: c.ux, uy: c.uy, half, height: 7.5 + unit(`${key}:gh:${guards.length}`) * 2 });
      break;
    }
  }
  out.guards.push(...guards);
}

// ---------------------------------------------------------------- 2D
export interface OrnamentDrawOptions {
  viewport: { minX: number; minY: number; maxX: number; maxY: number };
  mpp: number;
  palette?: string;
  /** Lamps on (shared Underdark lights decision). */ lit: boolean;
}
/** Webs and spikes from this scale down (m per pixel); forges and guard towers from FAR_MPP. */
export const ORNAMENT_NEAR_MPP = 1.2,
  ORNAMENT_FAR_MPP = 2.2;
const WEB_PATHS = new WeakMap<OrnamentWeb, Path2D>();
const disc = (path: Path2D, x: number, y: number, r: number): void => {
  for (let k = 0; k <= 8; k++) {
    const a = (k * Math.PI) / 4;
    if (k) path.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else path.moveTo(x + r, y);
  }
  path.closePath();
};
/** Plan drawing (world-coordinate context): thin vector webs, vent and ember glow, roof spikes, guard towers. */
export function drawUnderdarkOrnaments(ctx: CanvasRenderingContext2D, plan: UnderdarkOrnaments, o: OrnamentDrawOptions): void {
  if (o.mpp > ORNAMENT_FAR_MPP || !(plan.webs.length || plan.forges.length || plan.spikes.length || plan.guards.length)) return;
  const v = o.viewport,
    pad = 60,
    px = (n: number): number => n * o.mpp,
    ink = o.palette === 'parchment' || o.palette === 'ink';
  const near = (x: number, y: number): boolean => x > v.minX - pad && x < v.maxX + pad && y > v.minY - pad && y < v.maxY + pad;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (o.mpp <= ORNAMENT_NEAR_MPP && plan.webs.length) {
    // Silk: cold violet on the dark ground, ink on paper; fades out between 0.8 and 1.2 m/px.
    ctx.strokeStyle = ink ? '#4d4260' : '#d3c9f2';
    ctx.lineWidth = Math.max(0.1, px(0.75));
    ctx.globalAlpha = (ink ? 0.32 : 0.42) * clamp((ORNAMENT_NEAR_MPP - o.mpp) / 0.4, 0, 1);
    for (const web of plan.webs) {
      if (!web.frame.some(a => near(a.x, a.y))) continue;
      let path = WEB_PATHS.get(web);
      if (!path) {
        path = new Path2D();
        for (const thread of webThreads(
          web,
          web.frame.map(a => ({ x: a.x, y: a.y, z: 0 })),
        ))
          thread.forEach((p, i) => (i ? path!.lineTo(p.x, p.y) : path!.moveTo(p.x, p.y)));
        WEB_PATHS.set(web, path);
      }
      ctx.stroke(path);
    }
  }
  ctx.globalAlpha = 1;
  if (plan.guards.length) {
    const body = new Path2D(),
      spikes = new Path2D();
    for (const g of plan.guards) {
      if (!near(g.x, g.y)) continue;
      const c = (k: number, j: number, r = g.half): [number, number] => [g.x + (k * g.ux - j * g.uy) * r, g.y + (k * g.uy + j * g.ux) * r];
      body.moveTo(...c(1, 1));
      body.lineTo(...c(-1, 1));
      body.lineTo(...c(-1, -1));
      body.lineTo(...c(1, -1));
      body.closePath();
      if (o.mpp <= ORNAMENT_NEAR_MPP)
        for (const [k, j] of [
          [1, 1],
          [-1, 1],
          [-1, -1],
          [1, -1],
        ]) {
          const [x, y] = c(k, j, g.half * 1.45);
          spikes.moveTo(...c(k, j, g.half * 0.8));
          spikes.lineTo(x, y);
        }
    }
    ctx.fillStyle = ink ? '#6a6058' : '#3a3633';
    ctx.strokeStyle = ink ? '#2c241c' : '#151413';
    ctx.lineWidth = px(0.8);
    ctx.fill(body);
    ctx.stroke(body);
    ctx.lineWidth = px(0.9);
    ctx.stroke(spikes);
  }
  if (o.mpp <= 0.6 && plan.spikes.length) {
    const path = new Path2D();
    for (const s of plan.spikes)
      for (const p of s.points) {
        if (!near(p.x, p.y)) continue;
        const ex = -p.uy,
          ey = p.ux;
        path.moveTo(p.x - ex * 0.3, p.y - ey * 0.3);
        path.lineTo(p.x + p.ux * 0.8, p.y + p.uy * 0.8);
        path.lineTo(p.x + ex * 0.3, p.y + ey * 0.3);
        path.closePath();
      }
    ctx.fillStyle = ink ? '#2c241c' : '#1b1b1e';
    ctx.fill(path);
  }
  if (plan.forges.length) {
    const vents = new Path2D(),
      glow = new Path2D(),
      core = new Path2D(),
      mouths = new Path2D();
    for (const f of plan.forges) {
      if (!near(f.x, f.y)) continue;
      const h = f.size / 2;
      vents.rect(f.x - h, f.y - h, f.size, f.size);
      if (o.lit) {
        disc(glow, f.x, f.y, Math.max(2.6, px(4)));
        disc(core, f.x, f.y, Math.max(0.55, px(1.4)));
        const [a, b] = f.mouth;
        mouths.moveTo(a.x, a.y);
        mouths.lineTo(b.x, b.y);
      }
    }
    ctx.fillStyle = ink ? '#2c241c' : '#211d1b';
    ctx.fill(vents);
    if (o.lit) {
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#ff7a2e';
      ctx.fill(glow);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ffb45a';
      ctx.fill(core);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ff8c3a';
      ctx.lineWidth = Math.max(0.35, px(1.2));
      ctx.stroke(mouths);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 3D
type Mesh = ArchitectureVolume['roof_mesh'];
type V3 = { x: number; y: number; z: number };
const SILK = 'city3d:web@cdc4ee',
  IRON = 'city3d:iron@2a2726',
  EMBER = 'city3d:wall:lit@6a2a12',
  STONE = 'city3d:wall:stone@3b3836',
  SLAB = 'city3d:cover:stone@2e2c2a';
const MATERIALS: MaterialSlots = { frame: STONE, infill: STONE, coating: STONE, cladding: SLAB, base: STONE, roof_frame: STONE };
function face(mesh: Mesh, points: readonly V3[], material: string, normal?: [number, number, number]): void {
  const base = mesh.vertices.length;
  mesh.vertices.push(...points.map(p => ({ x: p.x, y: p.y, z: p.z })));
  let n = normal;
  if (!n) {
    const [a, b, c] = points,
      ux = b.x - a.x,
      uy = b.y - a.y,
      uz = b.z - a.z,
      vx = c.x - a.x,
      vy = c.y - a.y,
      vz = c.z - a.z;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      l = Math.hypot(nx, ny, nz) || 1;
    n = [nx / l, ny / l, nz / l];
  }
  mesh.faces.push({ vertices: points.map((_, i) => base + i), normal: n, material, kind: 'slab' } as Mesh['faces'][number]);
}
/** `overviewFaces`: a standing body kept by the far LOD (its first faces); without it the whole ornament is a minor volume the
 * overview drops. */
function placed(id: string, variant: string, mesh: Mesh, footprint: Shape[], roof: Shape[], low: number, high: number, origin: Point, overviewFaces?: number): PlacedBuilding {
  const volume = {
    id,
    footprint: roof,
    levels: [],
    z_m: low,
    wall_height_m: Math.max(0.1, high - low),
    roof_height_m: 0,
    roof_system: 'RF-FLAT',
    roof_pitch_deg: 0,
    overhang_m: 0,
    roof_spec: {} as ArchitectureVolume['roof_spec'],
    materials: MATERIALS,
    role: overviewFaces ? 'main' : MINOR_VOLUME_ROLE,
    envelope: 'open',
    roof_mesh: mesh,
    ...(overviewFaces ? { overview_faces: [0, overviewFaces] } : {}),
  } as unknown as ArchitectureVolume;
  return {
    id,
    parcel_id: '',
    function: 'open_space',
    culture: { culture: '', pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
    recipe_id: 'city3d-underdark',
    variant_id: variant,
    transform: { origin, orientation_deg: 0 },
    ground_z_m: low,
    footprint,
    roof_footprint: roof,
    courtyards: [],
    circulation: [],
    entrance: origin,
    access_id: '',
    volumes: [volume],
    useful_area_m2: 0,
    domestic_units: 0,
    structural_features: [],
    simplification: 'recipe_volumes',
    diagnostics: [],
    resolved: null,
  } as unknown as PlacedBuilding;
}
/** One ribbon quad per thread segment, `width` wide in the web plane (normal `n`). */
function ribbon(mesh: Mesh, a: V3, b: V3, n: [number, number, number], width: number): void {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z,
    l = Math.hypot(dx, dy, dz);
  if (l < 0.05) return;
  let sx = dy * n[2] - dz * n[1],
    sy = dz * n[0] - dx * n[2],
    sz = dx * n[1] - dy * n[0];
  const sl = Math.hypot(sx, sy, sz);
  if (sl < 1e-6) return;
  sx *= width / 2 / sl;
  sy *= width / 2 / sl;
  sz *= width / 2 / sl;
  face(
    mesh,
    [
      { x: a.x - sx, y: a.y - sy, z: a.z - sz },
      { x: b.x - sx, y: b.y - sy, z: b.z - sz },
      { x: b.x + sx, y: b.y + sy, z: b.z + sz },
      { x: a.x + sx, y: a.y + sy, z: a.z + sz },
    ],
    SILK,
    n,
  );
}
const square = (x: number, y: number, h: number): Shape => ({
  outer: [
    { x: x - h, y: y - h },
    { x: x + h, y: y - h },
    { x: x + h, y: y + h },
    { x: x - h, y: y + h },
  ],
  holes: [],
});
function spike(mesh: Mesh, x: number, y: number, z: number, ux: number, uy: number, h: number, w: number): void {
  const top = { x: x + ux * h * 0.15, y: y + uy * h * 0.15, z: z + h };
  face(mesh, [{ x: x - uy * w, y: y + ux * w, z }, { x: x + uy * w, y: y - ux * w, z }, top], IRON);
  face(mesh, [{ x: x - ux * w, y: y - uy * w, z }, { x: x + ux * w, y: y + uy * w, z }, top], IRON);
}

/** 3D meshes of the ornaments. `display` gives the shown buildings (their real height and ground). */
export function city3dUnderdarkOrnaments(plan: UnderdarkOrnaments, heightAt?: (x: number, y: number) => number, display?: readonly Building3dVisual[]): PlacedBuilding[] {
  if (!plan.webs.length && !plan.forges.length && !plan.spikes.length && !plan.guards.length) return [];
  const ground = (x: number, y: number): number => {
    const h = heightAt?.(x, y);
    return Number.isFinite(h) ? h! : 0;
  };
  const shown = new Map<string, { ground: number; height: number }>();
  if (display && plan.heights.size)
    for (const b of display)
      if (plan.heights.has(b.id)) {
        let h = 0;
        try {
          h = building3dHeight(b);
        } catch {
          h = 0;
        }
        shown.set(b.id, { ground: Number.isFinite(b.ground_z_m) ? b.ground_z_m! : NaN, height: h });
      }
  const top = (id: string, x: number, y: number): { ground: number; height: number } => {
    const s = shown.get(id),
      g = s && Number.isFinite(s.ground) ? s.ground : ground(x, y);
    const h = s?.height || plan.heights.get(id) || 9;
    return { ground: g, height: h };
  };
  const out: PlacedBuilding[] = [];
  for (const web of plan.webs) {
    let low = Infinity,
      high = -Infinity;
    const frame = web.frame.map(a => {
      const t = a.building ? top(a.building, a.x, a.y) : { ground: ground(a.x, a.y), height: 0 };
      const z = t.ground + (a.building ? t.height * a.rise : a.rise);
      low = Math.min(low, t.ground);
      high = Math.max(high, z);
      return { x: a.x, y: a.y, z };
    });
    const threads = webThreads(web, frame);
    if (!threads.length) continue;
    // Newell normal of the frame: the plane the silk ribbons lie in.
    let nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < frame.length; i++) {
      const a = frame[i],
        b = frame[(i + 1) % frame.length];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const nl = Math.hypot(nx, ny, nz) || 1,
      n: [number, number, number] = nl > 1e-6 ? [nx / nl, ny / nl, nz / nl] : [0, 0, 1];
    const mesh: Mesh = { vertices: [], faces: [], edges: [], groups: [] };
    for (const thread of threads) for (let i = 1; i < thread.length; i++) ribbon(mesh, thread[i - 1], thread[i], n, thread === threads[0] ? 0.22 : 0.15);
    const roof: Shape[] = [{ outer: frame.map(p => ({ x: p.x, y: p.y })), holes: [] }];
    out.push(placed(`city3d-underdark:web:${web.id}`, web.kind, mesh, [], roof, low, high, { x: frame[0].x, y: frame[0].y }));
  }
  for (const f of plan.forges) {
    const t = top(f.building, f.x, f.y),
      roofZ = t.ground + t.height,
      h = f.size / 2,
      z1 = roofZ + 2.2,
      mesh: Mesh = { vertices: [], faces: [], edges: [], groups: [] };
    const c = [
      { x: f.x - h, y: f.y - h },
      { x: f.x + h, y: f.y - h },
      { x: f.x + h, y: f.y + h },
      { x: f.x - h, y: f.y + h },
    ];
    for (let k = 0; k < 4; k++) {
      const a = c[k],
        b = c[(k + 1) % 4];
      face(
        mesh,
        [
          { ...a, z: roofZ - 0.3 },
          { ...b, z: roofZ - 0.3 },
          { ...b, z: z1 },
          { ...a, z: z1 },
        ],
        IRON,
      );
    }
    // Ember mouth of the vent (glows with the town's lamps) under an iron rim, and the forge mouth on the wall.
    const r = h * 0.72;
    face(
      mesh,
      [
        { x: f.x - r, y: f.y - r, z: z1 - 0.05 },
        { x: f.x + r, y: f.y - r, z: z1 - 0.05 },
        { x: f.x + r, y: f.y + r, z: z1 - 0.05 },
        { x: f.x - r, y: f.y + r, z: z1 - 0.05 },
      ],
      EMBER,
      [0, 0, 1],
    );
    for (let k = 0; k < 4; k++) {
      const a = c[k],
        b = c[(k + 1) % 4],
        ia = { x: f.x + (a.x - f.x) * 0.72, y: f.y + (a.y - f.y) * 0.72 },
        ib = { x: f.x + (b.x - f.x) * 0.72, y: f.y + (b.y - f.y) * 0.72 };
      face(
        mesh,
        [
          { ...a, z: z1 },
          { ...b, z: z1 },
          { ...ib, z: z1 },
          { ...ia, z: z1 },
        ],
        IRON,
        [0, 0, 1],
      );
    }
    const [ma, mb] = f.mouth,
      off = 0.06,
      g = t.ground;
    face(
      mesh,
      [
        { x: ma.x + f.normal.x * off, y: ma.y + f.normal.y * off, z: g + 0.2 },
        { x: mb.x + f.normal.x * off, y: mb.y + f.normal.y * off, z: g + 0.2 },
        { x: mb.x + f.normal.x * off, y: mb.y + f.normal.y * off, z: g + 1.6 },
        { x: ma.x + f.normal.x * off, y: ma.y + f.normal.y * off, z: g + 1.6 },
      ],
      EMBER,
      [f.normal.x, f.normal.y, 0],
    );
    out.push(placed(`city3d-underdark:forge:${f.id}`, 'forge', mesh, [], [{ outer: f.ring, holes: [] }], g, z1, { x: f.x, y: f.y }));
  }
  for (const s of plan.spikes) {
    const p0 = s.points[0],
      t = top(s.building, p0.x, p0.y),
      z = t.ground + t.height,
      mesh: Mesh = { vertices: [], faces: [], edges: [], groups: [] };
    for (const p of s.points) spike(mesh, p.x - p.ux * 0.2, p.y - p.uy * 0.2, z, p.ux, p.uy, 1, 0.2);
    out.push(placed(`city3d-underdark:spikes:${s.id}`, 'spikes', mesh, [], [{ outer: s.ring, holes: [] }], t.ground, z + 1, { x: p0.x, y: p0.y }));
  }
  for (const gt of plan.guards) {
    const mesh: Mesh = { vertices: [], faces: [], edges: [], groups: [] },
      h = gt.half;
    const c = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ].map(([k, j]) => ({ x: gt.x + (k * gt.ux - j * gt.uy) * h, y: gt.y + (k * gt.uy + j * gt.ux) * h }));
    const g = Math.min(...c.map(p => ground(p.x, p.y))) - 0.3,
      z1 = Math.max(...c.map(p => ground(p.x, p.y))) + gt.height;
    if (ringArea(c) < 0) c.reverse();
    for (let k = 0; k < 4; k++) {
      const a = c[k],
        b = c[(k + 1) % 4];
      face(
        mesh,
        [
          { ...a, z: g },
          { ...b, z: g },
          { ...b, z: z1 },
          { ...a, z: z1 },
        ],
        STONE,
      );
    }
    face(
      mesh,
      c.map(p => ({ ...p, z: z1 })),
      SLAB,
      [0, 0, 1],
    );
    const r = h * 0.3;
    face(
      mesh,
      [
        { x: gt.x - r, y: gt.y - r, z: z1 + 0.04 },
        { x: gt.x + r, y: gt.y - r, z: z1 + 0.04 },
        { x: gt.x + r, y: gt.y + r, z: z1 + 0.04 },
        { x: gt.x - r, y: gt.y + r, z: z1 + 0.04 },
      ],
      EMBER,
      [0, 0, 1],
    );
    for (let k = 0; k < 4; k++) {
      const a = c[k],
        b = c[(k + 1) % 4],
        l = Math.hypot(b.x - a.x, b.y - a.y),
        ex = (b.x - a.x) / l,
        ey = (b.y - a.y) / l;
      for (const t of [0.15, 0.5, 0.85]) spike(mesh, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, z1, ey, -ex, 1.1, 0.22);
    }
    // The body (4 walls and the slab) stays at the overview LOD; brazier and spikes go with the chimneys.
    out.push(placed(`city3d-underdark:guard:${gt.id}`, 'guard', mesh, [square(gt.x, gt.y, h)], [square(gt.x, gt.y, h)], g, z1, { x: gt.x, y: gt.y }, 5));
  }
  return out;
}

/** Triangles of a list of ornament meshes (budget checks). */
export const ornamentTriangles = (buildings: readonly PlacedBuilding[]): number => buildings.reduce((n, b) => n + b.volumes.reduce((m, v) => m + (v.roof_mesh?.faces ?? []).reduce((k, f) => k + f.vertices.length - 2, 0), 0), 0);
