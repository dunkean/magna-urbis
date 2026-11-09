/** Town grove (cityGrove): the grove that grows between the buildings of a forest culture, and the timber walkways that link
 * its tree platforms (tree dwellings and giant trees). Display-only derivation from the layouts (blocks, streets)
 * and the placed buildings (footprints, tree-dwelling massing), shared by the 2D plan and the 3D city, deterministic
 * (positions hash on world coordinates and the layout key; no dependence on draw order). */
import type { Layout, Point, Shape } from '../../../rust/bridge/urban';
import type { ArchitectureVolume, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { MaterialSlots } from '../../../rust/bridge/housesContract';
import { pieceVolumes, readMassing } from './cityMassing';
import type { TreeDwelling } from './cityTrees';

/** Culture data: trunk spacing of the grove between the buildings (m), share of giant trees carrying a platform,
 * longest walkway span (m), share of the grid kept (clearings). A culture absent here grows no town grove. */
export const TOWN_CANOPY: Readonly<Record<string, { spacing: number; giants: number; span: number; keep: number }>> = {
  elven: { spacing: 9.5, giants: 0.22, span: 32, keep: 0.86 },
};
const DEFAULT_SPAN = 30;

export interface CanopyLobe { x: number; y: number; r: number; z: number; tone: number }
export interface CanopyTree {
  x: number; y: number; /** Crown radius (m). */ r: number; /** Trunk height under the crown (m). */ h: number; trunk: number; seed: number;
  lobes: CanopyLobe[]; /** Platform deck above the ground (m), radius (m); giants and tree dwellings. */ deck?: number; deckR?: number; dwelling?: boolean;
}
export interface CanopyWalkway { a: Point; b: Point; /** Deck heights above the local ground at a and b (m). */ za: number; zb: number }
export interface CanopyStair { x: number; y: number; /** Radius of the spiral around the trunk (m). */ r: number; trunk: number; z: number }
export interface CityCanopy { trees: CanopyTree[]; dwellings: CanopyTree[]; walkways: CanopyWalkway[]; stairs: CanopyStair[] }

const EMPTY: CityCanopy = { trees: [], dwellings: [], walkways: [], stairs: [] };
function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(Math.round(x * 8) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 8) | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35); return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function hashText(text: string): number { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
function inside(ring: readonly Point[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
function edgeDistance(ring: readonly Point[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l)) : 0;
    d = Math.min(d, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
  }
  return d;
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
const segmentPointDistance = (a: Point, b: Point, p: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
};

/** Bins of items by bounding box, on a square grid. */
class Bins<T> {
  private cells = new Map<number, T[]>();
  constructor(private size: number) {}
  private key(i: number, j: number): number { return (i + 32768) * 65536 + (j + 32768); }
  add(item: T, x0: number, y0: number, x1: number, y1: number): void {
    for (let i = Math.floor(x0 / this.size); i <= Math.floor(x1 / this.size); i++) for (let j = Math.floor(y0 / this.size); j <= Math.floor(y1 / this.size); j++) {
      const k = this.key(i, j); let c = this.cells.get(k); if (!c) this.cells.set(k, c = []); c.push(item);
    }
  }
  near(x0: number, y0: number, x1: number, y1: number): Set<T> {
    const out = new Set<T>();
    for (let i = Math.floor(x0 / this.size); i <= Math.floor(x1 / this.size); i++) for (let j = Math.floor(y0 / this.size); j <= Math.floor(y1 / this.size); j++) for (const t of this.cells.get(this.key(i, j)) ?? []) out.add(t);
    return out;
  }
}

/** Irregular broadleaf crown: a dark lower layer, a body of lobes and a lit top, all from one seed. */
function lobesOf(x: number, y: number, r: number, h: number, seed: number): CanopyLobe[] {
  const out: CanopyLobe[] = [], n = 4 + Math.floor(hash2(x, y, seed + 1) * 3), phase = hash2(x, y, seed + 2) * Math.PI * 2;
  out.push({ x, y, r: r * 0.62, z: h + r * 0.35, tone: 0.45 });
  for (let i = 0; i < n; i++) {
    const a = phase + i * Math.PI * 2 / n + (hash2(x, y, seed + 10 + i) - 0.5) * 0.9, d = r * (0.36 + 0.2 * hash2(x, y, seed + 20 + i));
    const lr = r * (0.42 + 0.16 * hash2(x, y, seed + 30 + i));
    out.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: lr, z: h + r * (0.05 + 0.3 * hash2(x, y, seed + 40 + i)), tone: 0.2 + 0.4 * hash2(x, y, seed + 50 + i) });
  }
  const a = phase + 2.2;
  out.push({ x: x - r * 0.12 + Math.cos(a) * r * 0.1, y: y - r * 0.14 + Math.sin(a) * r * 0.1, r: r * 0.42, z: h + r * 0.75, tone: 1 });
  return out;
}

/** Tree dwellings of the placed buildings, as canopy trees (their crowns are the dwelling's own lobes). */
function dwellingsOf(buildings: readonly PlacedBuilding[]): { tree: CanopyTree; culture: string }[] {
  const out: { tree: CanopyTree; culture: string }[] = [];
  for (const b of buildings) {
    const massing = readMassing((b as PlacedBuilding & { programme?: unknown }).programme, b.footprint, b.id); if (!massing) continue;
    b.footprint.forEach((shape, i) => {
      for (const v of massing[i] ? pieceVolumes(shape, massing[i]) : []) {
        const t: TreeDwelling | undefined = v.tree; if (!t) continue;
        const top = t.platforms.reduce<TreeDwelling['platforms'][number] | undefined>((best, p) => !best || p.height > best.height ? p : best, undefined);
        const x = t.center.x, y = t.center.y;
        out.push({ culture: b.culture?.culture ?? '', tree: { x, y, r: t.radius, h: t.height, trunk: t.trunkRadius, seed: hashText(b.id) + i, dwelling: true,
          lobes: t.crowns.map(c => ({ x: c.x, y: c.y, r: (c.rx + c.ry) / 2, z: c.z, tone: c.tone ?? 0.5 })), deck: top ? top.height + 0.22 : undefined, deckR: top?.radius } });
      }
    });
  }
  return out;
}

const CACHE = new WeakMap<object, WeakMap<object, CityCanopy>>();
/** Canopy of every layout whose culture has a town grove, and walkways between the tree platforms. */
export function cityCanopy(layouts: readonly Layout[] | undefined, buildings: readonly PlacedBuilding[] | undefined): CityCanopy {
  if (!layouts?.length || !buildings?.length) return EMPTY;
  let byBuildings = CACHE.get(layouts); if (!byBuildings) CACHE.set(layouts, byBuildings = new WeakMap());
  let canopy = byBuildings.get(buildings);
  if (!canopy) byBuildings.set(buildings, canopy = deriveCanopy(layouts, buildings));
  return canopy;
}

function deriveCanopy(layouts: readonly Layout[], buildings: readonly PlacedBuilding[]): CityCanopy {
  const groves = layouts.filter(l => TOWN_CANOPY[l.culture]);
  const dwellingList = dwellingsOf(buildings);
  if (!groves.length && !dwellingList.length) return EMPTY;
  // Building cores block trunks and walkways; tree dwellings block grove trunks under their crowns.
  const cores: { ring: Point[]; core: Point[] }[] = [];
  const coreBins = new Bins<number>(32);
  for (const b of buildings) {
    const massing = readMassing((b as PlacedBuilding & { programme?: unknown }).programme, b.footprint, b.id);
    b.footprint.forEach((shape, i) => {
      if (massing?.[i]?.volumes?.some(v => v.form === 'tree') || shape.outer.length < 3) return;
      const ring = shape.outer, cx = ring.reduce((s, p) => s + p.x, 0) / ring.length, cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
      const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
      coreBins.add(cores.length, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      cores.push({ ring, core: ring.map(p => ({ x: cx + (p.x - cx) * 0.7, y: cy + (p.y - cy) * 0.7 })) });
    });
  }
  const dwellingBins = new Bins<number>(32);
  dwellingList.forEach((d, i) => dwellingBins.add(i, d.tree.x - d.tree.r, d.tree.y - d.tree.r, d.tree.x + d.tree.r, d.tree.y + d.tree.r));
  const trees: CanopyTree[] = [];
  for (const layout of groves) {
    const cfg = TOWN_CANOPY[layout.culture], s = cfg.spacing, salt = hashText(layout.key);
    for (const block of layout.blocks) {
      const ring = block.shape.outer; if (ring.length < 3) continue;
      const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
      for (let i = Math.floor(Math.min(...xs) / s); i <= Math.floor(Math.max(...xs) / s); i++) for (let j = Math.floor(Math.min(...ys) / s); j <= Math.floor(Math.max(...ys) / s); j++) {
        if (hash2(i, j, salt) > cfg.keep) continue;
        const x = (i + 0.1 + 0.8 * hash2(i, j, salt + 1)) * s, y = (j + 0.1 + 0.8 * hash2(i, j, salt + 2)) * s;
        if (!inside(ring, x, y) || block.shape.holes.some(h => inside(h, x, y))) continue;
        const edge = edgeDistance(ring, x, y); if (edge < 1.6) continue;
        let clear = Infinity;
        for (const k of coreBins.near(x - 12, y - 12, x + 12, y + 12)) { const c = cores[k]; clear = Math.min(clear, inside(c.ring, x, y) ? -1 : edgeDistance(c.ring, x, y)); if (clear < 1.3) break; }
        if (clear < 1.3) continue;
        let underDwelling = false;
        for (const k of dwellingBins.near(x, y, x, y)) { const d = dwellingList[k].tree; if (Math.hypot(d.x - x, d.y - y) < d.r * 0.85 + 1.5) { underDwelling = true; break; } }
        if (underDwelling) continue;
        const giant = hash2(i, j, salt + 3) < cfg.giants;
        // Crowns overhang the lots and the buildings, not more than a few metres over a street.
        const r = Math.max(2.4, Math.min(s * (giant ? 1.15 + 0.3 * hash2(i, j, salt + 4) : 0.5 + 0.38 * hash2(i, j, salt + 4)), edge + 2.6));
        const h = r * (0.85 + 0.35 * hash2(i, j, salt + 5)) + 2.2, trunk = 0.22 + r * (giant ? 0.09 : 0.06), seed = (salt + i * 7919 + j * 104729) >>> 0;
        const deck = giant ? Math.min(14, Math.max(6, h * 0.82)) : undefined;
        trees.push({ x, y, r, h, trunk, seed, lobes: lobesOf(x, y, r, h, seed), ...(deck ? { deck, deckR: Math.max(trunk + 1.4, r * 0.42) } : {}) });
      }
    }
  }
  const dwellings = dwellingList.map(d => d.tree);
  const { walkways, stairs } = linkPlatforms([...dwellings.filter(d => d.deck), ...trees.filter(t => t.deck)],
    dwellingList.map(d => TOWN_CANOPY[d.culture]?.span).find(Boolean) ?? groves.map(l => TOWN_CANOPY[l.culture].span)[0] ?? DEFAULT_SPAN, cores, coreBins);
  return { trees, dwellings, walkways, stairs };
}

/** Walkways: the minimum spanning forest of the platforms closer than `span`, plus a few short loops; never across a
 * building core or another trunk, never steeper than 1:3. One spiral stair per linked group, and a few more. */
function linkPlatforms(nodes: CanopyTree[], span: number, cores: { ring: Point[]; core: Point[] }[], coreBins: Bins<number>): { walkways: CanopyWalkway[]; stairs: CanopyStair[] } {
  if (nodes.length < 2) return { walkways: [], stairs: [] };
  const bins = new Bins<number>(span);
  nodes.forEach((n, i) => bins.add(i, n.x, n.y, n.x, n.y));
  const edge = (i: number, j: number): CanopyWalkway | undefined => {
    const p = nodes[i], q = nodes[j], d = Math.hypot(q.x - p.x, q.y - p.y); if (d > span || d < 1) return undefined;
    const ux = (q.x - p.x) / d, uy = (q.y - p.y) / d, ra = (p.deckR ?? 1) * 0.92, rb = (q.deckR ?? 1) * 0.92;
    if (d - ra - rb < 1.5) return undefined;
    const a = { x: p.x + ux * ra, y: p.y + uy * ra }, b = { x: q.x - ux * rb, y: q.y - uy * rb };
    if (Math.abs(p.deck! - q.deck!) > (d - ra - rb) / 3) return undefined;
    for (const k of coreBins.near(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
      const core = cores[k].core; if (inside(core, a.x, a.y) || inside(core, b.x, b.y)) return undefined;
      for (let m = 0, n = core.length - 1; m < core.length; n = m++) if (segmentsCross(a, b, core[n], core[m])) return undefined;
    }
    for (const k of bins.near(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
      if (k === i || k === j) continue; const o = nodes[k]; if (segmentPointDistance(a, b, o) < o.trunk + 0.8) return undefined;
    }
    return { a, b, za: p.deck!, zb: q.deck! };
  };
  const candidates: { i: number; j: number; d: number }[] = [];
  nodes.forEach((n, i) => { for (const j of bins.near(n.x - span, n.y - span, n.x + span, n.y + span)) if (j > i) { const d = Math.hypot(nodes[j].x - n.x, nodes[j].y - n.y); if (d <= span) candidates.push({ i, j, d }); } });
  candidates.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const parent = nodes.map((_, i) => i), find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const walkways: CanopyWalkway[] = [], degree = new Array<number>(nodes.length).fill(0);
  const crossesAny = (w: CanopyWalkway): boolean => walkways.some(o => segmentsCross(w.a, w.b, o.a, o.b));
  const extras: { i: number; j: number; d: number }[] = [];
  for (const c of candidates) {
    const ri = find(c.i), rj = find(c.j);
    if (ri === rj) { if (c.d < span * 0.62) extras.push(c); continue; }
    const w = edge(c.i, c.j); if (!w || crossesAny(w)) continue;
    parent[ri] = rj; walkways.push(w); degree[c.i]++; degree[c.j]++;
  }
  for (const c of extras) {
    if (hash2(nodes[c.i].x + nodes[c.j].x, nodes[c.i].y + nodes[c.j].y, 77) > 0.22 || degree[c.i] > 3 || degree[c.j] > 3) continue;
    const w = edge(c.i, c.j); if (!w || crossesAny(w)) continue;
    walkways.push(w); degree[c.i]++; degree[c.j]++;
  }
  // Stairs: the first platform of every linked group, and about one platform in eight.
  const stairs: CanopyStair[] = [], seen = new Set<number>();
  nodes.forEach((n, i) => {
    if (!degree[i]) return; const root = find(i);
    if (seen.has(root) && hash2(n.x, n.y, 91) > 0.13) return;
    seen.add(root); stairs.push({ x: n.x, y: n.y, r: n.trunk + 0.9, trunk: n.trunk, z: n.deck! });
  });
  return { walkways, stairs };
}

// ------------------------------------------------------------------ 2D plan

export interface CanopyDrawOptions { viewport: { minX: number; minY: number; maxX: number; maxY: number }; mpp: number; palette: string; night?: boolean }
interface CanopyInk { shade: string; dark: string; mid: string; light: string; stroke?: string; wood: string; rail: string; flat?: boolean }
const INKS: Record<string, CanopyInk> = {
  parchment: { shade: 'rgba(46,38,24,0.26)', dark: '#4f6139', mid: '#71844c', light: '#9fac6c', stroke: '#3a432a', wood: '#b08c5c', rail: '#5b4330' },
  terrain: { shade: 'rgba(0,0,0,0.32)', dark: '#2a4421', mid: '#3f632f', light: '#6c8f45', wood: '#a7845a', rail: '#4d3826' },
  atlas: { shade: 'rgba(30,30,20,0.24)', dark: '#58764a', mid: '#7c9c62', light: '#a9c48a', stroke: '#465a3a', wood: '#b9976a', rail: '#5d4632' },
  ink: { shade: 'rgba(0,0,0,0)', dark: '#c9d3b0', mid: '#c9d3b0', light: '#c9d3b0', stroke: '#56654a', wood: '#efe6d2', rail: '#4b3d2c', flat: true },
  growth: { shade: 'rgba(0,0,0,0)', dark: '#cbd6b4', mid: '#cbd6b4', light: '#cbd6b4', stroke: '#5c6b4a', wood: '#efe6d2', rail: '#4b3d2c', flat: true },
};
const darken = (hex: string, k: number): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
  const v = parseInt(m[1], 16), c = [v >> 16 & 255, v >> 8 & 255, v & 255].map(x => Math.round(x * k));
  return `rgb(${c.join(',')})`;
};
/** Shade direction of the plan (south-east, as the building shadows), per metre of height. */
const SHADE = { x: 0.32, y: 0.42 };

/** The grove, the tree-dwelling crowns and the walkways over the plan, after the buildings. */
export function drawCityCanopy(ctx: CanvasRenderingContext2D, canopy: CityCanopy, o: CanopyDrawOptions): void {
  if (!canopy.trees.length && !canopy.dwellings.length) return;
  const base = INKS[o.palette] ?? INKS.terrain, ink: CanopyInk = o.night ? { ...base, dark: darken(base.dark, 0.42), mid: darken(base.mid, 0.42), light: darken(base.light, 0.45), wood: darken(base.wood, 0.45) } : base;
  const v = o.viewport, pad = 20, px = (n: number): number => n * o.mpp;
  const visible = (t: CanopyTree): boolean => t.x + t.r + pad > v.minX && t.x - t.r - pad < v.maxX && t.y + t.r + pad > v.minY && t.y - t.r - pad < v.maxY;
  const all = [...canopy.dwellings, ...canopy.trees].filter(visible);
  const far = o.mpp > 2.5, flat = !!ink.flat;
  const disc = (path: Path2D, x: number, y: number, r: number): void => { path.moveTo(x + r, y); path.arc(x, y, r, 0, Math.PI * 2); };
  ctx.save();
  // Cast shadows of the crowns on the ground (and on the low roofs they overhang).
  if (!flat) {
    const shade = new Path2D();
    for (const t of all) { const k = t.h + t.r * 0.6; disc(shade, t.x + SHADE.x * k * 0.35, t.y + SHADE.y * k * 0.35, t.r * 0.95); }
    ctx.fillStyle = ink.shade; ctx.fill(shade);
  }
  if (flat || far) {
    const crowns = new Path2D(); for (const t of all) disc(crowns, t.x, t.y, t.r);
    ctx.fillStyle = flat ? ink.mid : ink.mid; ctx.fill(crowns);
    if (ink.stroke) { ctx.strokeStyle = ink.stroke; ctx.lineWidth = px(flat ? 0.6 : 0.45); ctx.stroke(crowns); }
  } else {
    // Layers: dark lower lobes (offset to the shade side), the body, then the lit tops (offset to the light).
    const dark = new Path2D(), mid = new Path2D(), light = new Path2D(), rim = new Path2D();
    for (const t of all) for (const l of t.lobes) {
      disc(rim, l.x + l.r * 0.08, l.y + l.r * 0.1, l.r * 1.04);
      disc(dark, l.x + l.r * 0.1, l.y + l.r * 0.13, l.r);
      if (l.tone > 0.3) disc(mid, l.x - l.r * 0.04, l.y - l.r * 0.05, l.r * (0.72 + 0.16 * l.tone));
      if (l.tone > 0.55) disc(light, l.x - l.r * 0.2, l.y - l.r * 0.24, l.r * 0.5 * l.tone);
    }
    if (ink.stroke) { ctx.strokeStyle = ink.stroke; ctx.lineWidth = px(0.9); ctx.stroke(rim); }
    ctx.fillStyle = ink.dark; ctx.fill(dark);
    ctx.fillStyle = ink.mid; ctx.fill(mid);
    ctx.globalAlpha = 0.85; ctx.fillStyle = ink.light; ctx.fill(light); ctx.globalAlpha = 1;
  }
  // Walkways among the crowns: a light shadow below, rails, planks; spiral stairs as a ring of treads.
  const ways = canopy.walkways.filter(w => Math.max(w.a.x, w.b.x) + pad > v.minX && Math.min(w.a.x, w.b.x) - pad < v.maxX && Math.max(w.a.y, w.b.y) + pad > v.minY && Math.min(w.a.y, w.b.y) - pad < v.maxY);
  if (ways.length) {
    const width = Math.max(1.5, px(1.3)), line = new Path2D(), shade = new Path2D();
    for (const w of ways) {
      line.moveTo(w.a.x, w.a.y); line.lineTo(w.b.x, w.b.y);
      if (!flat) { const ka = w.za * 0.3, kb = w.zb * 0.3; shade.moveTo(w.a.x + SHADE.x * ka, w.a.y + SHADE.y * ka); shade.lineTo(w.b.x + SHADE.x * kb, w.b.y + SHADE.y * kb); }
    }
    ctx.lineCap = 'butt';
    if (!flat) { ctx.strokeStyle = 'rgba(20,16,8,0.22)'; ctx.lineWidth = width; ctx.stroke(shade); }
    ctx.strokeStyle = ink.rail; ctx.lineWidth = width + Math.max(0.45, px(0.9)); ctx.stroke(line);
    ctx.strokeStyle = ink.wood; ctx.lineWidth = width - Math.max(0.2, px(0.4)); ctx.stroke(line);
    if (o.mpp < 0.45 && !flat) {
      const planks = new Path2D(), half = width / 2;
      for (const w of ways) {
        const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, l = Math.hypot(dx, dy); if (l < 0.5) continue;
        const ux = dx / l, uy = dy / l;
        for (let s = 0.4; s < l; s += 0.75) { const x = w.a.x + ux * s, y = w.a.y + uy * s; planks.moveTo(x - uy * half, y + ux * half); planks.lineTo(x + uy * half, y - ux * half); }
      }
      ctx.strokeStyle = ink.rail; ctx.globalAlpha = 0.5; ctx.lineWidth = px(0.5); ctx.stroke(planks); ctx.globalAlpha = 1;
    }
    const treads = new Path2D();
    for (const s of canopy.stairs) {
      if (s.x + pad < v.minX || s.x - pad > v.maxX || s.y + pad < v.minY || s.y - pad > v.maxY) continue;
      treads.moveTo(s.x + s.r, s.y); treads.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; treads.moveTo(s.x + Math.cos(a) * s.trunk, s.y + Math.sin(a) * s.trunk); treads.lineTo(s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r); }
    }
    ctx.strokeStyle = ink.rail; ctx.lineWidth = Math.max(0.25, px(0.7)); ctx.stroke(treads);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ 3D

type Mesh = ArchitectureVolume['roof_mesh'];
const TRUNK = 'city3d:tree:trunk@4b3c2a', TIMBER = 'city3d:wall:timber';
const CROWN = ['city3d:tree:crown@34502a', 'city3d:tree:crown@4c6d36', 'city3d:tree:crown@668a45', 'city3d:tree:crown@83a65a'];
const crownMaterial = (tone: number): string => CROWN[Math.min(CROWN.length - 1, Math.floor(tone * CROWN.length))];

function addFace(mesh: Mesh, points: { x: number; y: number; z: number }[], material: string): void {
  if (points.length < 3) return;
  const a = points[0], b = points[1], c = points[2];
  let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const base = mesh.vertices.length; mesh.vertices.push(...points);
  mesh.faces.push({ vertices: points.map((_, i) => base + i), normal: [nx, ny, nz], material, kind: 'slab' });
}
/** Lofted ring sections (outward faces). */
function loft(mesh: Mesh, rings: { x: number; y: number; z: number }[][], material: string, cap = false): void {
  for (let k = 1; k < rings.length; k++) {
    const a = rings[k - 1], b = rings[k];
    for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; addFace(mesh, [a[i], a[j], b[j], b[i]], material); }
  }
  if (cap) addFace(mesh, rings[rings.length - 1], material);
}
/** A rounded lobe: flattened underside, broad shoulders, domed top. */
function lobe(mesh: Mesh, x: number, y: number, z: number, r: number, material: string, n: number): void {
  const levels = [[0.55, -0.25], [1, 0.12], [0.86, 0.55], [0.45, 0.85]];
  const ring = (k: number, dz: number, i0: number): { x: number; y: number; z: number }[] => Array.from({ length: n }, (_, i) => { const a = (i + i0 * 0.5) / n * Math.PI * 2; return { x: x + Math.cos(a) * r * k, y: y + Math.sin(a) * r * k, z: z + dz * r }; });
  const rings = levels.map(([k, dz], i) => ring(k, dz, i));
  loft(mesh, rings, material, true);
  addFace(mesh, [...rings[0]].reverse(), material);
}
function treeMesh(mesh: Mesh, t: CanopyTree, ground: number, light: boolean): void {
  const n = light ? 5 : 7, lean = { x: (hash2(t.x, t.y, 5) - 0.5) * t.r * 0.18, y: (hash2(t.x, t.y, 6) - 0.5) * t.r * 0.18 };
  const ring = (f: number, k: number): { x: number; y: number; z: number }[] => Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2, root = f === 0 ? 1 + 0.35 * Math.cos(a * 3 + t.seed) : 1;
    return { x: t.x + lean.x * f + Math.cos(a) * t.trunk * k * root, y: t.y + lean.y * f + Math.sin(a) * t.trunk * k * root, z: ground + t.h * f };
  });
  loft(mesh, [ring(0, 1.6), ring(0.15, 1.05), ring(0.65, 0.85), ring(1.05, 0.6)], TRUNK);
  // Limbs from the upper trunk to the outer lobes.
  const top = { x: t.x + lean.x * 0.7, y: t.y + lean.y * 0.7, z: ground + t.h * 0.7 };
  for (const l of t.lobes.slice(1, light ? 3 : 5)) {
    const w = t.trunk * 0.38, end = { x: l.x, y: l.y, z: ground + l.z + l.r * 0.1 }, dx = end.x - top.x, dy = end.y - top.y, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d * w, ny = dx / d * w;
    addFace(mesh, [{ x: top.x + nx, y: top.y + ny, z: top.z }, { x: top.x - nx, y: top.y - ny, z: top.z }, { x: end.x - nx * 0.5, y: end.y - ny * 0.5, z: end.z }, { x: end.x + nx * 0.5, y: end.y + ny * 0.5, z: end.z }], TRUNK);
    addFace(mesh, [{ x: top.x, y: top.y, z: top.z + w }, { x: top.x + nx, y: top.y + ny, z: top.z }, { x: end.x + nx * 0.5, y: end.y + ny * 0.5, z: end.z }, { x: end.x, y: end.y, z: end.z + w * 0.5 }], TRUNK);
  }
  const lobes = light ? [t.lobes[0], ...t.lobes.slice(1, -1).filter((_, i) => i % 2 === 0), t.lobes[t.lobes.length - 1]] : t.lobes;
  for (const l of lobes) lobe(mesh, l.x + lean.x, l.y + lean.y, ground + l.z, l.r, crownMaterial(l.tone), light ? 6 : 9);
  if (t.deck && !t.dwelling) {   // giant tree: a ring deck around the trunk with its rail posts
    const z = ground + t.deck, m = light ? 8 : 12, r = t.deckR!;
    const outer = Array.from({ length: m }, (_, i) => { const a = i / m * Math.PI * 2; return { x: t.x + lean.x * t.deck! / t.h + Math.cos(a) * r, y: t.y + lean.y * t.deck! / t.h + Math.sin(a) * r }; });
    addFace(mesh, outer.map(p => ({ ...p, z })), TIMBER); addFace(mesh, [...outer].reverse().map(p => ({ ...p, z: z - 0.25 })), TIMBER);
    loft(mesh, [outer.map(p => ({ ...p, z: z - 0.25 })), outer.map(p => ({ ...p, z }))], TIMBER);
    if (!light) loft(mesh, [outer.map(p => ({ ...p, z: z + 0.9 })), outer.map(p => ({ ...p, z: z + 1.0 }))], TIMBER);
  }
}
function box(mesh: Mesh, a: Point, b: Point, half: number, z0a: number, z1a: number, z0b: number, z1b: number, material: string): void {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l * half, ny = dx / l * half;
  const p = [{ x: a.x + nx, y: a.y + ny }, { x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny }];
  const lo = [z0a, z0a, z0b, z0b], hi = [z1a, z1a, z1b, z1b];
  addFace(mesh, p.map((q, i) => ({ ...q, z: hi[i] })), material);
  addFace(mesh, [...p].reverse().map((q, i) => ({ ...q, z: lo[3 - i] })), material);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; addFace(mesh, [{ ...p[i], z: lo[i] }, { ...p[j], z: lo[j] }, { ...p[j], z: hi[j] }, { ...p[i], z: hi[i] }], material); }
}
/** A slightly sagging plank deck with posts and hand rails, end to end. */
function walkwayMesh(mesh: Mesh, w: CanopyWalkway, ga: number, gb: number): void {
  const l = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), steps = Math.max(2, Math.ceil(l / 3.2)), sag = Math.min(0.9, l * 0.025);
  const at = (t: number): { p: Point; z: number } => ({ p: { x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t }, z: (ga + w.za) * (1 - t) + (gb + w.zb) * t - sag * 4 * t * (1 - t) });
  const dx = (w.b.x - w.a.x) / l, dy = (w.b.y - w.a.y) / l, side = (p: Point, k: number): Point => ({ x: p.x - dy * k, y: p.y + dx * k });
  for (let s = 0; s < steps; s++) {
    const A = at(s / steps), B = at((s + 1) / steps);
    box(mesh, A.p, B.p, 0.75, A.z - 0.2, A.z, B.z - 0.2, B.z, TIMBER);
    for (const k of [-0.7, 0.7]) {
      box(mesh, side(A.p, k), side(B.p, k), 0.05, A.z + 0.95, A.z + 1.05, B.z + 0.95, B.z + 1.05, TIMBER);
      const post = side(A.p, k); box(mesh, { x: post.x - dx * 0.06, y: post.y - dy * 0.06 }, { x: post.x + dx * 0.06, y: post.y + dy * 0.06 }, 0.06, A.z, A.z + 1.05, A.z, A.z + 1.05, TIMBER);
    }
  }
}
/** Spiral stair around a trunk, from the ground to the platform. */
function stairMesh(mesh: Mesh, s: CanopyStair, ground: number): void {
  const steps = Math.max(8, Math.round(s.z / 0.45)), turn = Math.max(1, s.z / 6);
  for (let k = 0; k < steps; k++) {
    const a = k / steps * turn * Math.PI * 2, z = ground + s.z * (k + 1) / steps;
    const inner = { x: s.x + Math.cos(a) * s.trunk, y: s.y + Math.sin(a) * s.trunk }, outer = { x: s.x + Math.cos(a) * (s.r + 0.6), y: s.y + Math.sin(a) * (s.r + 0.6) };
    box(mesh, inner, outer, 0.32, z - 0.1, z, z - 0.1, z, TIMBER);
  }
}

const MATERIALS: MaterialSlots = { frame: TIMBER, infill: TIMBER, coating: TIMBER, base: TIMBER, cladding: TIMBER, roof_frame: TIMBER };
function placed(id: string, mesh: Mesh, footprint: Shape[], low: number, high: number, origin: Point): PlacedBuilding {
  const volume: ArchitectureVolume = { id, footprint, levels: [], z_m: low, wall_height_m: high - low, roof_height_m: 0, roof_system: 'RF-FLAT', roof_pitch_deg: 0, overhang_m: 0,
    roof_spec: {} as ArchitectureVolume['roof_spec'], materials: MATERIALS, role: 'main', envelope: 'open', roof_mesh: mesh, foundation: { footprint: [], z_min_m: low, z_max_m: low } };
  return { id, parcel_id: '', function: 'open_space', culture: { culture: '', pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
    recipe_id: 'city3d-canopy', variant_id: 'canopy', transform: { origin, orientation_deg: 0 }, ground_z_m: low, footprint, roof_footprint: footprint,
    courtyards: [], circulation: [], entrance: origin, access_id: '', volumes: [volume], useful_area_m2: 0, domestic_units: 0,
    structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null } as unknown as PlacedBuilding;
}
/** Above this many grove trees, each one takes its light mesh (fewer sides and lobes). */
const LIGHT_GROVE_FROM = 1500;
/** Grove trees, walkways and stairs as display meshes, in chunks of CHUNK metres (one ground per chunk). */
export function city3dCanopy(canopy: CityCanopy, heightAt?: (x: number, y: number) => number): PlacedBuilding[] {
  const CHUNK = 48, chunks = new Map<string, { mesh: Mesh; footprint: Shape[]; low: number; high: number; origin: Point; kind: string }>();
  const ground = (x: number, y: number): number => { const h = heightAt?.(x, y); return Number.isFinite(h) ? h! : 0; };
  const chunk = (kind: string, x: number, y: number): { mesh: Mesh; footprint: Shape[]; low: number; high: number; origin: Point; kind: string } => {
    const key = `${kind}:${Math.floor(x / CHUNK)}:${Math.floor(y / CHUNK)}`;
    let c = chunks.get(key); if (!c) chunks.set(key, c = { mesh: { vertices: [], faces: [], edges: [], groups: [] }, footprint: [], low: Infinity, high: -Infinity, origin: { x, y }, kind });
    return c;
  };
  const light = canopy.trees.length > LIGHT_GROVE_FROM;
  // One ground per chunk (the lowest trunk foot): the display exaggeration lifts a chunk with its relief.
  const lows = new Map<string, number>();
  for (const t of canopy.trees) { const k = `${Math.floor(t.x / CHUNK)}:${Math.floor(t.y / CHUNK)}`; lows.set(k, Math.min(lows.get(k) ?? Infinity, ground(t.x, t.y))); }
  for (const t of canopy.trees) {
    const c = chunk('grove', t.x, t.y), g = ground(t.x, t.y);
    treeMesh(c.mesh, t, g, light);
    c.footprint.push({ outer: [{ x: t.x - t.trunk, y: t.y - t.trunk }, { x: t.x + t.trunk, y: t.y - t.trunk }, { x: t.x + t.trunk, y: t.y + t.trunk }, { x: t.x - t.trunk, y: t.y + t.trunk }], holes: [] });
    c.low = Math.min(c.low, lows.get(`${Math.floor(t.x / CHUNK)}:${Math.floor(t.y / CHUNK)}`)!); c.high = Math.max(c.high, g + t.h + t.r * 1.6);
  }
  for (const w of canopy.walkways) {
    const ga = ground(w.a.x, w.a.y), gb = ground(w.b.x, w.b.y), c = chunk('walk', (w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2);
    walkwayMesh(c.mesh, w, ga, gb);
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l * 0.75, ny = dx / l * 0.75;
    c.footprint.push({ outer: [{ x: w.a.x + nx, y: w.a.y + ny }, { x: w.a.x - nx, y: w.a.y - ny }, { x: w.b.x - nx, y: w.b.y - ny }, { x: w.b.x + nx, y: w.b.y + ny }], holes: [] });
    c.low = Math.min(c.low, ga, gb); c.high = Math.max(c.high, ga + w.za + 1.1, gb + w.zb + 1.1);
  }
  for (const s of canopy.stairs) {
    const g = ground(s.x, s.y), c = chunk('walk', s.x, s.y);
    stairMesh(c.mesh, s, g);
    c.footprint.push({ outer: [{ x: s.x - s.r, y: s.y - s.r }, { x: s.x + s.r, y: s.y - s.r }, { x: s.x + s.r, y: s.y + s.r }, { x: s.x - s.r, y: s.y + s.r }], holes: [] });
    c.low = Math.min(c.low, g); c.high = Math.max(c.high, g + s.z);
  }
  return [...chunks.entries()].filter(([, c]) => c.mesh.faces.length).map(([key, c]) => placed(`city3d-canopy:${key}`, c.mesh, c.footprint, c.low, c.high, c.origin));
}
