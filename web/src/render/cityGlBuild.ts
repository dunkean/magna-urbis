/** City GPU renderer — geometry, built once per plan (no DOM, no WebGL: runs in a worker,
 * in Node tests or on the main thread).
 *  - Fills: polygons packed as flat float32 coordinates relative to a city origin
 *    (millimetre precision over tens of kilometres), triangulated by earcut (holes
 *    bridged), plus outline edge pairs on the same vertices. Every vertex carries a
 *    feature id; colours live in a per-feature texture, so a view, palette, layer or
 *    level-of-detail change never touches the geometry.
 *  - Strokes (streets, walls): one instance per centreline segment, extruded and
 *    antialiased on the GPU (round joins and caps from a capsule distance field).
 *  - Points (towers): one instance per disc.
 * The triangulation can be split over workers by polygon ranges (cityGlWorker.ts). */
import type { Point, Shape } from '../../../rust/bridge/urban';
import type { CityBuildings, CityScene } from './cityCanvas';
import { isBoardwalk } from './cityGround';
import { earcut } from './cityGlEarcut';

export interface CityGlRange { start: number; count: number }

// ---------------------------------------------------------------- polygon packing
/** Polygons as flat arrays: rings[r]..rings[r+1] are the vertices of ring r,
 * polys[p]..polys[p+1] the rings of polygon p (outer first), features[p] its feature. */
export interface CityGlPolygons { coords: Float32Array; rings: Uint32Array; polys: Uint32Array; features: Uint32Array }

class Grow<T extends Float32Array | Uint32Array> {
  length = 0;
  constructor(public data: T) {}
  reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    const next = new (this.data.constructor as new (n: number) => T)(Math.max(this.length + n, this.data.length * 2));
    next.set(this.data.subarray(0, this.length) as never); this.data = next;
  }
  push(v: number): void { this.reserve(1); this.data[this.length++] = v; }
  done(): T { return this.data.slice(0, this.length) as T; }
}

export class CityGlPacker {
  private coords = new Grow(new Float32Array(1 << 16));
  private rings = new Grow(new Uint32Array(1 << 12));
  private polys = new Grow(new Uint32Array(1 << 11));
  private features = new Grow(new Uint32Array(1 << 11));
  constructor(readonly origin: Point) { this.rings.push(0); this.polys.push(0); }
  get vertexCount(): number { return this.coords.length / 2; }
  get polygonCount(): number { return this.features.length; }
  /** One polygon (outer ring + holes) for `feature`. Degenerate rings are skipped;
   * a repeated closing point is dropped (earcut and the outlines close rings). */
  add(shape: Shape, feature: number): void {
    if (!shape?.outer || shape.outer.length < 3) return;
    let added = 0;
    for (const ring of [shape.outer, ...(shape.holes ?? [])]) {
      if (!ring || ring.length < 3) continue;
      const closed = ring.length > 3 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y;
      const n = closed ? ring.length - 1 : ring.length, ox = this.origin.x, oy = this.origin.y;
      this.coords.reserve(n * 2);
      const data = this.coords.data;
      for (let i = 0; i < n; i++) { data[this.coords.length++] = ring[i].x - ox; data[this.coords.length++] = ring[i].y - oy; }
      this.rings.push(this.coords.length / 2); added++;
    }
    if (!added) return;
    this.polys.push(this.rings.length - 1); this.features.push(feature);
  }
  done(): CityGlPolygons { return { coords: this.coords.done(), rings: this.rings.done(), polys: this.polys.done(), features: this.features.done() }; }
}

// ---------------------------------------------------------------- triangulation
export interface CityGlTriangulation {
  /** Triangle vertex indices (into the packed vertices). */
  triangles: Uint32Array;
  /** Outline edges as vertex pairs. */
  lines: Uint32Array;
  /** Indices emitted per polygon (triangles ×3, lines ×2), to rebuild layer ranges. */
  polyTriangles: Uint32Array; polyLines: Uint32Array;
}
/** Triangulate polygons [from, to) of a packing. Vertex indices are global. */
export function triangulatePolygons(p: Pick<CityGlPolygons, 'coords' | 'rings' | 'polys'>, from = 0, to = p.polys.length - 1): CityGlTriangulation {
  const tri = new Grow(new Uint32Array(1 << 14)), lin = new Grow(new Uint32Array(1 << 14));
  const polyTriangles = new Uint32Array(Math.max(0, to - from)), polyLines = new Uint32Array(Math.max(0, to - from));
  const local: number[] = [], holes: number[] = [];
  for (let q = from; q < to; q++) {
    const r0 = p.polys[q], r1 = p.polys[q + 1], v0 = p.rings[r0], v1 = p.rings[r1];
    holes.length = 0;
    for (let r = r0 + 1; r < r1; r++) holes.push(p.rings[r] - v0);
    local.length = 0;
    earcut(p.coords.subarray(v0 * 2, v1 * 2), holes, local);
    tri.reserve(local.length);
    for (let i = 0; i < local.length; i++) tri.data[tri.length++] = v0 + local[i];
    polyTriangles[q - from] = local.length;
    lin.reserve((v1 - v0) * 2);
    for (let r = r0; r < r1; r++) {
      const a = p.rings[r], b = p.rings[r + 1];
      for (let i = a; i < b; i++) { lin.data[lin.length++] = i; lin.data[lin.length++] = i + 1 < b ? i + 1 : a; }
    }
    polyLines[q - from] = (v1 - v0) * 2;
  }
  return { triangles: tri.done(), lines: lin.done(), polyTriangles, polyLines };
}

/** Polygon ranges of about equal vertex counts, for parallel triangulation. */
export function splitPolygons(p: Pick<CityGlPolygons, 'rings' | 'polys'>, parts: number): Array<[number, number]> {
  const total = p.polys.length - 1, vertices = p.rings[p.rings.length - 1], out: Array<[number, number]> = [];
  if (total <= 0) return out;
  let from = 0;
  for (let k = 1; k <= parts && from < total; k++) {
    let to = from;
    if (k === parts) to = total;
    else { const goal = vertices * k / parts; while (to < total && p.rings[p.polys[to + 1]] <= goal) to++; to = Math.max(to, from + 1); }
    out.push([from, to]); from = to;
  }
  if (from < total) out[out.length - 1][1] = total;
  return out;
}
/** Self-contained slice of polygons [from, to): vertex indices rebased to 0 (worker input). */
export function slicePolygons(p: CityGlPolygons, from: number, to: number): { coords: Float32Array; rings: Uint32Array; polys: Uint32Array; vertexOffset: number } {
  const r0 = p.polys[from], r1 = p.polys[to], v0 = p.rings[r0], v1 = p.rings[r1];
  const rings = new Uint32Array(r1 - r0 + 1), polys = new Uint32Array(to - from + 1);
  for (let r = r0; r <= r1; r++) rings[r - r0] = p.rings[r] - v0;
  for (let q = from; q <= to; q++) polys[q - from] = p.polys[q] - r0;
  return { coords: p.coords.slice(v0 * 2, v1 * 2), rings, polys, vertexOffset: v0 };
}
/** Concatenate slice results (in order), shifting each by its vertex offset. */
export function mergeTriangulations(parts: Array<{ result: CityGlTriangulation; vertexOffset: number }>): CityGlTriangulation {
  const sum = (k: keyof CityGlTriangulation): number => parts.reduce((s, x) => s + x.result[k].length, 0);
  const out: CityGlTriangulation = { triangles: new Uint32Array(sum('triangles')), lines: new Uint32Array(sum('lines')), polyTriangles: new Uint32Array(sum('polyTriangles')), polyLines: new Uint32Array(sum('polyLines')) };
  const at = { triangles: 0, lines: 0, polyTriangles: 0, polyLines: 0 };
  for (const { result, vertexOffset } of parts) {
    for (const k of ['triangles', 'lines'] as const) {
      const src = result[k], dst = out[k], o = at[k];
      if (vertexOffset) for (let i = 0; i < src.length; i++) dst[o + i] = src[i] + vertexOffset; else dst.set(src, o);
      at[k] += src.length;
    }
    for (const k of ['polyTriangles', 'polyLines'] as const) { out[k].set(result[k], at[k]); at[k] += result[k].length; }
  }
  return out;
}

// ---------------------------------------------------------------- fill meshes
/** World-space box of a spatial chunk: polygons (or segments) of one CELL-metre grid
 * cell, contiguous in the buffers, so a frame draws only the chunks in view (consecutive
 * visible chunks merge into one draw call). */
export type CityGlBox4 = [number, number, number, number];
export const CITY_GL_CELL = 512;
export interface CityGlChunk { box: CityGlBox4; triangles: CityGlRange; lines: CityGlRange }
export interface CityGlFillLayer { features: [number, number]; polygons: [number, number]; triangles: CityGlRange; lines: CityGlRange; chunks: CityGlChunk[] }
export interface CityGlFillMesh {
  origin: Point;
  positions: Float32Array; vertexFeatures: Uint32Array; triangles: Uint32Array; lines: Uint32Array;
  layers: Record<string, CityGlFillLayer>;
  featureCount: number;
}
export interface CityGlSourceLayer { features: [number, number]; polygons: [number, number]; chunks: Array<{ box: CityGlBox4; polygons: [number, number] }> }
export interface CityGlFillSource { polygons: CityGlPolygons; layers: Record<string, CityGlSourceLayer>; featureCount: number; origin: Point }

const shapesBox = (shapes: readonly Shape[]): CityGlBox4 => {
  const b: CityGlBox4 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of shapes) for (const p of s?.outer ?? []) { if (p.x < b[0]) b[0] = p.x; if (p.y < b[1]) b[1] = p.y; if (p.x > b[2]) b[2] = p.x; if (p.y > b[3]) b[3] = p.y; }
  return b;
};
const grow4 = (c: CityGlBox4, b: CityGlBox4): void => { if (b[0] < c[0]) c[0] = b[0]; if (b[1] < c[1]) c[1] = b[1]; if (b[2] > c[2]) c[2] = b[2]; if (b[3] > c[3]) c[3] = b[3]; };
const cellKey = (b: CityGlBox4): number => Number.isFinite(b[0])
  ? (Math.floor((b[1] + b[3]) / 2 / CITY_GL_CELL) + 32768) * 65536 + Math.floor((b[0] + b[2]) / 2 / CITY_GL_CELL) + 32768 : -1;
/** Pack items (each a list of shapes sharing one feature id = firstFeature + item index)
 * grouped by grid cell, row-major; one chunk per occupied cell. */
function packLayer(packer: CityGlPacker, items: ReadonlyArray<readonly Shape[]>, firstFeature: number): CityGlSourceLayer {
  const boxes = items.map(shapesBox), keys = boxes.map(cellKey);
  const order = items.map((_, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
  const p0 = packer.polygonCount, chunks: CityGlSourceLayer['chunks'] = [];
  let current: CityGlSourceLayer['chunks'][number] | undefined, key = NaN;
  for (const i of order) {
    if (!current || keys[i] !== key) {
      if (current) current.polygons[1] = packer.polygonCount;
      current = { box: [Infinity, Infinity, -Infinity, -Infinity], polygons: [packer.polygonCount, packer.polygonCount] }; chunks.push(current); key = keys[i];
    }
    for (const shape of items[i]) packer.add(shape, firstFeature + i);
    grow4(current.box, boxes[i]);
  }
  if (current) current.polygons[1] = packer.polygonCount;
  return { features: [firstFeature, firstFeature + items.length], polygons: [p0, packer.polygonCount], chunks: chunks.filter(c => c.polygons[1] > c.polygons[0]) };
}

export function cityOrigin(scene: Pick<CityScene, 'extent'>): Point {
  const e = scene.extent;
  return Number.isFinite(e.minX) ? { x: Math.round((e.minX + e.maxX) / 2), y: Math.round((e.minY + e.maxY) / 2) } : { x: 0, y: 0 };
}
/** Plan polygons: footprint, blocks, parcels (feature ids in that order). */
export function packPlan(scene: CityScene, origin = cityOrigin(scene)): CityGlFillSource {
  const packer = new CityGlPacker(origin), layers: CityGlFillSource['layers'] = {};
  let feature = 0;
  const layer = (name: string, items: readonly Shape[]): void => { layers[name] = packLayer(packer, items.map(s => [s]), feature); feature += items.length; };
  layer('footprint', scene.footprint);
  layers.blocks = packLayer(packer, scene.blocks.map(b => b.ground ?? [b.shape]), feature); feature += scene.blocks.length;
  layers.parcels = packLayer(packer, scene.parcels.map(p => p.ground ?? [p.shape]), feature); feature += scene.parcels.length;
  layer('quays', (scene.quays ?? []).map(q => q.shape));
  return { polygons: packer.done(), layers, featureCount: feature, origin };
}
/** Building polygons: every shape of a building's surface shares its feature id (= item index). */
export function packBuildings(buildings: CityBuildings | undefined, origin: Point): CityGlFillSource {
  const packer = new CityGlPacker(origin), items = buildings?.items ?? [], roofs = buildings?.roofs;
  const layers: Record<string, CityGlSourceLayer> = { buildings: packLayer(packer, items.map(b => b.surface), 0) };
  if (!roofs) return { polygons: packer.done(), layers, featureCount: items.length, origin };
  // Features: buildings [0, n), roof pans [n, n + r), shadows [n + r, 2n + r).
  layers.roofs = packLayer(packer, roofs.shapes.map(s => [s]), items.length);
  layers.shadows = packLayer(packer, roofs.shadows, items.length + roofs.shapes.length);
  return { polygons: packer.done(), layers, featureCount: 2 * items.length + roofs.shapes.length, origin };
}
/** Assemble a fill mesh from a packing and its triangulation. */
export function fillMesh(source: CityGlFillSource, t: CityGlTriangulation): CityGlFillMesh {
  const { polygons: p } = source, vertexFeatures = new Uint32Array(p.coords.length / 2);
  for (let q = 0; q + 1 < p.polys.length; q++) vertexFeatures.fill(p.features[q], p.rings[p.polys[q]], p.rings[p.polys[q + 1]]);
  const triStart = new Uint32Array(t.polyTriangles.length + 1), lineStart = new Uint32Array(t.polyLines.length + 1);
  for (let q = 0; q < t.polyTriangles.length; q++) { triStart[q + 1] = triStart[q] + t.polyTriangles[q]; lineStart[q + 1] = lineStart[q] + t.polyLines[q]; }
  const layers: Record<string, CityGlFillLayer> = {};
  const ranges = (p: [number, number]): { triangles: CityGlRange; lines: CityGlRange } => ({
    triangles: { start: triStart[p[0]], count: triStart[p[1]] - triStart[p[0]] }, lines: { start: lineStart[p[0]], count: lineStart[p[1]] - lineStart[p[0]] } });
  for (const [name, l] of Object.entries(source.layers)) layers[name] = { features: l.features, polygons: l.polygons, ...ranges(l.polygons), chunks: l.chunks.map(c => ({ box: c.box, ...ranges(c.polygons) })) };
  return { origin: source.origin, positions: p.coords, vertexFeatures, triangles: t.triangles, lines: t.lines, layers, featureCount: source.featureCount };
}
export const buildFillMeshSync = (source: CityGlFillSource): CityGlFillMesh => fillMesh(source, triangulatePolygons(source.polygons));

/** Topmost feature of a layer whose triangles contain a world point (CPU check of
 * what the GPU draws; used by tests and as a fallback pick). */
export function meshFeatureAt(mesh: CityGlFillMesh, layer: string, point: Point): number | undefined {
  const l = mesh.layers[layer]; if (!l) return undefined;
  const x = point.x - mesh.origin.x, y = point.y - mesh.origin.y, P = mesh.positions, T = mesh.triangles;
  let hit: number | undefined;
  for (let i = l.triangles.start; i < l.triangles.start + l.triangles.count; i += 3) {
    const a = T[i] * 2, b = T[i + 1] * 2, c = T[i + 2] * 2;
    const d1 = (x - P[b]) * (P[a + 1] - P[b + 1]) - (P[a] - P[b]) * (y - P[b + 1]);
    const d2 = (x - P[c]) * (P[b + 1] - P[c + 1]) - (P[b] - P[c]) * (y - P[c + 1]);
    const d3 = (x - P[a]) * (P[c + 1] - P[a + 1]) - (P[c] - P[a]) * (y - P[a + 1]);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) hit = mesh.vertexFeatures[T[i]];
  }
  return hit;
}

// ---------------------------------------------------------------- stroke and point instances
/** Stroke instance: ax, ay, bx, by, width (m), min width (CSS px), along (m from the
 * polyline start, for dashes), feature id (u32), meta (u32). 36 bytes. */
export const STROKE_STRIDE = 9;
export const META = { rank: 0xf, crossing: 1 << 4, buttStart: 1 << 5, buttEnd: 1 << 6, dash: 1 << 7, solidEdge: 1 << 8 } as const;
export interface CityGlStrokes {
  data: ArrayBuffer; count: number;
  /** Spatial chunks in instance order (boxes padded by the stroke width); absent = draw all. */
  chunks?: Array<{ box: CityGlBox4; first: number; count: number }>;
  /** firstWithRank[k]: first instance whose sort key ≤ k (instances are sorted minor → major, crossings last). */
  firstWithRank: number[];
}
const STREET_MIN_PX = [3, 2.4, 1.6, 1.1, 0.8];
const CROSSINGS = new Set(['bridge', 'causeway', 'ford', 'pier', 'boardwalk', 'walkway']);
function strokeWriter(segments: number): { f: Float32Array; u: Uint32Array; buffer: ArrayBuffer; n: number; put(a: Point, b: Point, o: Point, width: number, minPx: number, along: number, feature: number, meta: number): void } {
  const buffer = new ArrayBuffer(Math.max(1, segments) * STROKE_STRIDE * 4), f = new Float32Array(buffer), u = new Uint32Array(buffer);
  const w = { f, u, buffer, n: 0, put(a: Point, b: Point, o: Point, width: number, minPx: number, along: number, feature: number, meta: number): void {
    const i = w.n++ * STROKE_STRIDE;
    f[i] = a.x - o.x; f[i + 1] = a.y - o.y; f[i + 2] = b.x - o.x; f[i + 3] = b.y - o.y; f[i + 4] = width; f[i + 5] = minPx; f[i + 6] = along; u[i + 7] = feature; u[i + 8] = meta;
  } };
  return w;
}
/** Polyline → segment instances; butt flags on the two ends only (joins stay round). */
function putPolyline(w: ReturnType<typeof strokeWriter>, path: readonly Point[], o: Point, width: number, minPx: number, feature: number, meta: number, butt: boolean): void {
  let along = 0, first = -1, last = -1;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1e-4)) continue;
    if (first < 0) first = w.n;
    last = w.n; w.put(a, b, o, width, minPx, along, feature, meta); along += len;
  }
  if (butt && first >= 0) { w.u[first * STROKE_STRIDE + 8] |= META.buttStart; w.u[last * STROKE_STRIDE + 8] |= META.buttEnd; }
}
/** Streets: feature = street index in the scene. Minor ranks first, crossings last. */
export function buildStreetStrokes(scene: CityScene, origin: Point): CityGlStrokes {
  const key = (i: number): number => { const s = scene.streets[i]; return CROSSINGS.has(s.role) ? -1 : Math.min(15, Math.max(0, s.rank)); };
  // Rank first (draw order, level-of-detail suffix), then grid cell (culling).
  const boxes = scene.streets.map(s => { const b = shapesBox([{ outer: s.street.path, holes: [] }]); return [b[0] - s.width, b[1] - s.width, b[2] + s.width, b[3] + s.width] as CityGlBox4; });
  const cells = boxes.map(cellKey);
  const order = scene.streets.map((_, i) => i).sort((a, b) => key(b) - key(a) || cells[a] - cells[b] || a - b);
  const chunks: NonNullable<CityGlStrokes['chunks']> = [];
  let chunkKey = '';
  const w = strokeWriter(scene.streets.reduce((s, x) => s + Math.max(0, x.street.path.length - 1), 0));
  const firstWithRank = new Array(16).fill(-1);
  for (const i of order) {
    const s = scene.streets[i], k = key(i), rank = Math.min(15, Math.max(0, s.rank));
    for (let r = Math.max(0, k); r < 16; r++) if (firstWithRank[r] < 0) firstWithRank[r] = w.n;
    const meta = rank | (CROSSINGS.has(s.role) ? META.crossing : 0) | (s.role === 'ford' ? META.dash : 0) | (s.role === 'bridge' || s.role === 'quay' || s.role === 'mole' ? META.solidEdge : 0);
    const ck = `${k}|${cells[i]}`, before = w.n;
    putPolyline(w, s.street.path, origin, s.width, isBoardwalk(s.role) ? 0.8 : s.role === 'mole' ? 3.4 : STREET_MIN_PX[Math.min(4, rank)], i, meta, s.role === 'bridge' || s.role === 'quay' || s.role === 'mole');
    if (w.n === before) continue;
    let chunk = chunks[chunks.length - 1];
    if (!chunk || ck !== chunkKey) { chunk = { box: [Infinity, Infinity, -Infinity, -Infinity], first: before, count: 0 }; chunks.push(chunk); chunkKey = ck; }
    chunk.count = w.n - chunk.first; grow4(chunk.box, boxes[i]);
  }
  for (let r = 0; r < 16; r++) if (firstWithRank[r] < 0) firstWithRank[r] = w.n;
  return { data: w.buffer.slice(0, w.n * STROKE_STRIDE * 4), count: w.n, firstWithRank, chunks };
}
/** Walls: feature = wall index; pieces already stop at the gates. Width 2 m (palisade,
 * dashed) or 3.5 m, at least 2.4 px (1.6 px far, set by the renderer). */
export function buildWallStrokes(scene: CityScene, origin: Point): CityGlStrokes {
  const w = strokeWriter(scene.walls.reduce((s, wall) => s + wall.pieces.reduce((t, p) => t + Math.max(0, p.length - 1), 0), 0));
  scene.walls.forEach((wall, i) => {
    const palisade = wall.kind === 'palisade';
    for (const piece of wall.pieces) putPolyline(w, piece, origin, palisade ? 2 : 3.5, 2.4, i, palisade ? META.dash : 0, true);
  });
  return { data: w.buffer.slice(0, w.n * STROKE_STRIDE * 4), count: w.n, firstWithRank: new Array(16).fill(0) };
}
/** Towers of stone walls (gate towers first): x, y relative to the origin. */
export function buildTowers(scene: CityScene, origin: Point): Float32Array {
  const out: number[] = [];
  for (const wall of scene.walls) if (wall.kind !== 'palisade') for (const t of [...wall.gateTowers, ...wall.towers]) out.push(t.x - origin.x, t.y - origin.y);
  return new Float32Array(out);
}

/** Ranges [start, count] of the chunks overlapping a view box, consecutive ones merged;
 * `pad` widens the chunk boxes (strokes with a minimum pixel width), ranges are clipped
 * to start at `from` (level-of-detail suffix of the street instances). */
export function visibleRanges<T extends { box: CityGlBox4 }>(chunks: readonly T[], view: { minX: number; minY: number; maxX: number; maxY: number }, range: (c: T) => CityGlRange, pad = 0, from = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of chunks) {
    const b = c.box, r = range(c), end = r.start + r.count;
    if (!r.count || end <= from) continue;
    if (b[0] - pad > view.maxX || b[2] + pad < view.minX || b[1] - pad > view.maxY || b[3] + pad < view.minY) continue;
    const start = Math.max(from, r.start), last = out[out.length - 1];
    if (last && last[0] + last[1] === start) last[1] = end - last[0]; else out.push([start, end - start]);
  }
  return out;
}
