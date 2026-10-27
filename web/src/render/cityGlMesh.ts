/** City Bench WebGL prototype: the plan as GPU-ready typed arrays, built once per plan.
 * Fills (footprint, blocks, parcels, buildings) are earcut triangles on one shared
 * vertex buffer, with outline edge pairs on the same vertices; streets are one
 * instance per centreline segment (extruded in the vertex shader, so the minimum
 * pixel width follows the zoom). Every vertex carries a feature id: a view or
 * palette change only rewrites the per-feature colour table, never the geometry.
 * Coordinates are relative to `origin` so float32 keeps millimetres on a 16 km map. */
import type { Point, Shape } from '../../../rust/bridge/urban';
import type { CityBuildings, CityScene } from './cityCanvas';
import { earcut } from './cityGlEarcut';

export type CityGlFillLayer = 'footprint' | 'blocks' | 'parcels' | 'buildings';
export interface CityGlRange { start: number; count: number }
export interface CityGlMesh {
  origin: Point;
  /** x, y per vertex (float32, metres from origin). */
  positions: Float32Array;
  /** Feature id per vertex (index into the colour table). */
  vertexFeatures: Uint32Array;
  /** Triangle indices, grouped by layer. */
  triangles: Uint32Array;
  fillRanges: Record<CityGlFillLayer, CityGlRange>;
  /** Line pairs on the same vertices (ring edges), grouped by layer. */
  lines: Uint32Array;
  lineRanges: Record<'blocks' | 'parcels' | 'buildings', CityGlRange>;
  /** Street segments: ax, ay, bx, by, full width (m), rank — minor ranks first, so
   * "rank ≤ k" is a suffix of the instance range. */
  segments: Float32Array;
  segmentFeatures: Uint32Array;
  /** First segment of each rank threshold: rankStart[k] = first instance with rank ≤ k. */
  rankStart: number[];
  /** Feature id ranges in the colour table. */
  features: { footprint: number; blocks: number; parcels: number; buildings: number; streets: number; total: number };
  stats: { vertices: number; triangles: number; lines: number; segments: number; ms: number };
}

class Grow<T extends Float32Array | Uint32Array> {
  length = 0;
  constructor(public data: T) {}
  reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    const next = new (this.data.constructor as { new(n: number): T })(Math.max(this.length + n, this.data.length * 2));
    next.set(this.data.subarray(0, this.length) as never); this.data = next;
  }
  push(v: number): void { this.reserve(1); this.data[this.length++] = v; }
  done(): T { return this.data.slice(0, this.length) as T; }
}

export function buildCityGlMesh(scene: CityScene, buildings?: CityBuildings, origin?: Point): CityGlMesh {
  const start = performance.now();
  const o = origin ?? { x: (scene.extent.minX + scene.extent.maxX) / 2, y: (scene.extent.minY + scene.extent.maxY) / 2 };
  const pos = new Grow(new Float32Array(1 << 16)), feat = new Grow(new Uint32Array(1 << 15)), tri = new Grow(new Uint32Array(1 << 16)), lin = new Grow(new Uint32Array(1 << 16));
  const flat: number[] = [], holes: number[] = [], local: number[] = [];
  let feature = 0;
  const addShape = (shape: Shape, id: number, outline: boolean): void => {
    flat.length = 0; holes.length = 0;
    const rings = [shape.outer, ...(shape.holes ?? [])].filter(r => r.length >= 3);
    if (!rings.length || shape.outer.length < 3) return;
    for (const [ri, ring] of rings.entries()) {
      if (ri) holes.push(flat.length / 2);
      // Closed rings repeat their first point: drop it (earcut and the outlines close themselves).
      const n = ring.length > 3 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.length - 1 : ring.length;
      for (let i = 0; i < n; i++) flat.push(ring[i].x - o.x, ring[i].y - o.y);
    }
    const base = pos.length / 2, count = flat.length / 2;
    pos.reserve(flat.length); feat.reserve(count);
    for (let i = 0; i < flat.length; i++) pos.data[pos.length++] = flat[i];
    for (let i = 0; i < count; i++) feat.data[feat.length++] = id;
    local.length = 0; earcut(flat, holes, local);
    tri.reserve(local.length); for (const i of local) tri.data[tri.length++] = base + i;
    if (outline) {
      const bounds = [0, ...holes, count];
      lin.reserve(count * 2);
      for (let r = 0; r + 1 < bounds.length; r++) for (let i = bounds[r]; i < bounds[r + 1]; i++) {
        lin.data[lin.length++] = base + i; lin.data[lin.length++] = base + (i + 1 < bounds[r + 1] ? i + 1 : bounds[r]);
      }
    }
  };
  const range = (from: number, buffer: Grow<Uint32Array>): CityGlRange => ({ start: from, count: buffer.length - from });

  const features = { footprint: 0, blocks: 0, parcels: 0, buildings: 0, streets: 0, total: 0 };
  let t0 = tri.length;
  features.footprint = feature;
  for (const shape of scene.footprint) addShape(shape, feature++, false);
  const footprint = range(t0, tri);
  t0 = tri.length; let l0 = lin.length; features.blocks = feature;
  for (const block of scene.blocks) { for (const shape of block.ground ?? [block.shape]) addShape(shape, feature, true); feature++; }
  const blocks = range(t0, tri), blockLines = range(l0, lin);
  t0 = tri.length; l0 = lin.length; features.parcels = feature;
  for (const parcel of scene.parcels) { for (const shape of parcel.ground ?? [parcel.shape]) addShape(shape, feature, true); feature++; }
  const parcels = range(t0, tri), parcelLines = range(l0, lin);
  t0 = tri.length; l0 = lin.length; features.buildings = feature;
  for (const building of buildings?.items ?? []) { for (const shape of building.surface) addShape(shape, feature, true); feature++; }
  const builtFill = range(t0, tri), builtLines = range(l0, lin);

  // Streets: minor ranks first (drawn under majors), crossings last.
  features.streets = feature;
  const order = scene.streets.map((s, i) => i).sort((a, b) => rankKey(scene.streets[b]) - rankKey(scene.streets[a]));
  const seg = new Grow(new Float32Array(1 << 15)), segFeat = new Grow(new Uint32Array(1 << 13));
  const rankStart: number[] = new Array(10).fill(-1);
  for (const i of order) {
    const s = scene.streets[i], key = rankKey(s), id = features.streets + i, path = s.street.path;
    // Sorted by descending key: the first segment with key ≤ k opens the suffix of rank k.
    for (let k = key; k <= 9; k++) if (rankStart[k] < 0) rankStart[k] = seg.length / 6;
    seg.reserve((path.length - 1) * 6); segFeat.reserve(path.length - 1);
    for (let k = 1; k < path.length; k++) {
      seg.data.set([path[k - 1].x - o.x, path[k - 1].y - o.y, path[k].x - o.x, path[k].y - o.y, s.width, Math.max(0, key)], seg.length); seg.length += 6;
      segFeat.data[segFeat.length++] = id;
    }
  }
  for (let k = 0; k <= 9; k++) if (rankStart[k] < 0) rankStart[k] = seg.length / 6;
  feature += scene.streets.length;
  features.total = feature;
  const mesh: CityGlMesh = {
    origin: o, positions: pos.done(), vertexFeatures: feat.done(), triangles: tri.done(), lines: lin.done(),
    fillRanges: { footprint, blocks, parcels, buildings: builtFill }, lineRanges: { blocks: blockLines, parcels: parcelLines, buildings: builtLines },
    segments: seg.done(), segmentFeatures: segFeat.done(), rankStart, features,
    stats: { vertices: pos.length / 2, triangles: tri.length / 3, lines: lin.length / 2, segments: seg.length / 6, ms: 0 },
  };
  mesh.stats.ms = performance.now() - start;
  return mesh;
}
/** Crossings sort above every rank (key 0); otherwise the street rank (0 = major). */
const CROSSINGS = new Set(['bridge', 'causeway', 'ford']);
function rankKey(s: { rank: number; role: string }): number { return CROSSINGS.has(s.role) ? 0 : Math.min(9, Math.max(0, s.rank)); }

/** Bytes the GPU holds for a mesh (vertex + index + instance buffers). */
export function cityGlBytes(mesh: CityGlMesh): number {
  return mesh.positions.byteLength + mesh.vertexFeatures.byteLength + mesh.triangles.byteLength + mesh.lines.byteLength + mesh.segments.byteLength + mesh.segmentFeatures.byteLength;
}
