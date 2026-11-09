import type { ForestOccupation } from '../../../rust/bridge/terrainForest';
import type { Polygon } from '../gen/core/geom';
import { offsetRibbon } from '../gen/core/geom';
import { visitSegmentCells } from '../gen/core/grid';
import type { LandKind, LandUseLayer } from '../gen/types';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { buildingOccupationSurfaces } from './urbanBuildingProjection';
import { farmClearings, type ForestCorridor } from '../render/forestRoom';

/** Shared classes: 7 built reserve, 8 construction, 9 agricultural lane clearance, 11 forest clearing
 * (road corridor or farmstead ground, see render/forestRoom.ts): grass ground where no crown is rooted,
 * though crowns rooted outside may overhang it. */
const CLASS: Partial<Record<LandKind, number>> = { field: 1, meadow: 2, pasture: 3, orchard: 4, garden: 5, commons: 6, marsh: 10 };
const BUILT = 7, OCCUPIED = 8, CLEARANCE = 9, CLEARING = 11, RANGE = 8;

/** Merge accepted footprints and authorized circulation into the same retained
 * occupation contract, regardless of the building layer's visibility. */
export function withBuildingOccupation(source: ForestOccupation | undefined, scene: Building3dScene | undefined): ForestOccupation | undefined {
  const shapes = buildingOccupationShapes(scene);
  return shapes ? withOccupationShapes(source, shapes) : source;
}
type OccupationShape = { outer: Polygon; holes: Polygon[] };
/** Accepted footprints and authorized circulation of a scene; undefined without buildings. */
export function buildingOccupationShapes(scene: Building3dScene | undefined): OccupationShape[] | undefined {
  const buildings = scene?.occupationBuildings ?? scene?.buildings;
  if (!buildings?.length) return undefined;
  return buildings.flatMap(b => buildingOccupationSurfaces(b).flatMap(surface => surface)) as OccupationShape[];
}
/** Shapes as one transferable list: [shapes, (rings, (points, x, y…)…)…]. */
export function packOccupationShapes(shapes: readonly OccupationShape[]): Float64Array {
  let size = 1;
  for (const shape of shapes) { size += 2 + 2 * shape.outer.length; for (const hole of shape.holes) size += 1 + 2 * hole.length; }
  const out = new Float64Array(size);
  let at = 0;
  out[at++] = shapes.length;
  for (const shape of shapes) {
    out[at++] = 1 + shape.holes.length;
    for (const ring of [shape.outer, ...shape.holes]) { out[at++] = ring.length; for (const p of ring) { out[at++] = p.x; out[at++] = p.y; } }
  }
  return out;
}
export function unpackOccupationShapes(data: Float64Array): OccupationShape[] {
  let at = 0;
  const shapes: OccupationShape[] = [], count = data[at++];
  for (let s = 0; s < count; s++) {
    const rings: Polygon[] = [], ringCount = data[at++];
    for (let r = 0; r < ringCount; r++) {
      const ring: Polygon = [], points = data[at++];
      for (let k = 0; k < points; k++, at += 2) ring.push({ x: data[at], y: data[at + 1] });
      rings.push(ring);
    }
    shapes.push({ outer: rings[0], holes: rings.slice(1) });
  }
  return shapes;
}
/** withBuildingOccupation for already extracted shapes (the page packs them for the occupation worker). */
export function withOccupationShapes(source: ForestOccupation | undefined, shapes: readonly OccupationShape[]): ForestOccupation {
  let x0 = source?.x ?? Infinity, y0 = source?.y ?? Infinity, x1 = source ? source.x + source.width : -Infinity, y1 = source ? source.y + source.width : -Infinity;
  for (const shape of shapes) for (const p of shape.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const side = Math.max(x1 - x0, y1 - y0), cell = Math.max(.5, side / (1536 - RANGE * 2));
  const n = Math.min(1536, Math.ceil(side / cell) + RANGE * 2), x = Math.floor(x0 / cell) * cell - RANGE * cell, y = Math.floor(y0 / cell) * cell - RANGE * cell;
  const open = new Uint8Array(n * n), forest = new Uint8Array(n * n), cls = new Uint8Array(n * n);
  if (source) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const sx = Math.floor((x + (i + .5) * cell - source.x) / source.width * source.n), sy = Math.floor((y + (j + .5) * cell - source.y) / source.width * source.n);
    if (sx < 0 || sy < 0 || sx >= source.n || sy >= source.n) continue;
    const at = (sy * source.n + sx) * 4, index = j * n + i;
    if (!source.rgba[at + 3]) continue;
    cls[index] = source.rgba[at + 2]; open[index] = source.rgba[at] > 128 ? 1 : 0; forest[index] = source.rgba[at + 1] > 128 ? 1 : 0;
  }
  const occupied = (from: number, to: number): void => { cls.fill(OCCUPIED, from, to); open.fill(1, from, to); forest.fill(0, from, to); };
  for (const shape of shapes) {
    const rings = [shape.outer, ...shape.holes];
    fillRings(rings, x, y, cell, n, occupied);
    // Conservative boundary cells preserve walls and supports thinner than one
    // texel. Only the boundary rim is widened; courtyard interiors stay free.
    const mark = (i: number, j: number): void => { if (i >= 0 && j >= 0 && i < n && j < n) occupied(j * n + i, j * n + i + 1); };
    for (const ring of rings) for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const ax = (a.x - x) / cell, ay = (a.y - y) / cell, bx = (b.x - x) / cell, by = (b.y - y) / cell;
      let i = Math.floor(ax), j = Math.floor(ay);
      const endX = Math.floor(bx), endY = Math.floor(by), dx = bx - ax, dy = by - ay, sx = Math.sign(dx), sy = Math.sign(dy);
      const tx = dx ? 1 / Math.abs(dx) : Infinity, ty = dy ? 1 / Math.abs(dy) : Infinity;
      let nextX = dx ? (sx > 0 ? i + 1 - ax : ax - i) * tx : Infinity;
      let nextY = dy ? (sy > 0 ? j + 1 - ay : ay - j) * ty : Infinity;
      mark(i, j);
      for (let step = 0; (i !== endX || j !== endY) && step < n * 2 + 4; step++) {
        if (Math.abs(nextX - nextY) < 1e-12) { mark(i + sx, j); mark(i, j + sy); i += sx; j += sy; nextX += tx; nextY += ty; }
        else if (nextX < nextY) { i += sx; nextX += tx; }
        else { j += sy; nextY += ty; }
        mark(i, j);
      }
    }
  }
  const dOpen = signedDistance(open, n), dForest = signedDistance(forest, n), rgba = new Uint8Array(n * n * 4);
  let hash = 0x811c9dc5;
  for (let i = 0; i < n * n; i++) {
    const at = i * 4;
    rgba[at] = Math.max(0, Math.min(255, Math.round(128 + 16 * dOpen[i]))); rgba[at + 1] = Math.max(0, Math.min(255, Math.round(128 + 16 * dForest[i])));
    rgba[at + 2] = cls[i]; rgba[at + 3] = open[i] || forest[i] ? 255 : 0;
    hash = Math.imul(hash ^ cls[i] ^ rgba[at], 0x01000193);
  }
  return { x, y, width: n * cell, n, rgba, detail: source?.detail, key: `built-occ:${source?.key ?? ''}:${x}:${y}:${n * cell}:${n}:${hash >>> 0}` };
}

/**
 * Rasterises applied rural land use into the shared occupation texture.
 * R and G hold signed distances (texels, positive inside) to the open and
 * forest regions, so bilinear sampling keeps sharp edges (Green 2007). The
 * raster covers only the occupied square, in the landuse/terrain frame (m).
 * Deterministic: same layer, same bytes.
 */
export function forestOccupation(landuse: LandUseLayer, maxN = 1536, minCell = 2, corridors: readonly ForestCorridor[] = []): ForestOccupation | undefined {
  const shapes: { rings: Polygon[]; cls: number; forest: boolean }[] = [];
  for (const area of landuse.areas) {
    const cls = CLASS[area.kind] ?? 0;
    if (cls || area.kind === 'forest') shapes.push({ rings: [area.poly, ...area.holes ?? []], cls, forest: !cls });
  }
  for (const ring of landuse.reserve) shapes.push({ rings: [ring], cls: BUILT, forest: false });
  for (const path of landuse.ways ?? []) {
    if (path.length < 2) continue;
    shapes.push({ rings: [offsetRibbon(path, 12)], cls: CLEARANCE, forest: false });
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const p of s.rings[0]) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!(maxX > minX && maxY > minY)) return undefined;
  const side = Math.max(maxX - minX, maxY - minY), cell = Math.max(minCell, side / (maxN - 2 * RANGE));
  const n = Math.min(maxN, Math.ceil(side / cell) + 2 * RANGE);
  // Cell-aligned origin: identical layers produce identical texel centres.
  const x = (Math.floor(minX / cell) - RANGE) * cell, y = (Math.floor(minY / cell) - RANGE) * cell;
  const cls = new Uint8Array(n * n), open = new Uint8Array(n * n), forest = new Uint8Array(n * n);
  // Built reserves override fields and woods drawn below them.
  for (const s of shapes.sort((a, b) => Number(a.cls === BUILT) - Number(b.cls === BUILT))) {
    fillRings(s.rings, x, y, cell, n, (from, to) => {
      cls.fill(s.cls, from, to); open.fill(s.forest ? 0 : 1, from, to); forest.fill(s.forest ? 1 : 0, from, to);
    });
  }
  // Forest clearings (farmsteads, road corridors) open only wild or wooded ground: fields and plots keep their class.
  // They never widen the raster: corridors outside the rural land use stay with the forest field.
  const clearing = (rings: Polygon[]): void => fillRings(rings, x, y, cell, n, (from, to) => {
    for (let i = from; i < to; i++) if (!cls[i] || forest[i]) { cls[i] = CLEARING; open[i] = 1; forest[i] = 0; }
  });
  for (const ring of farmClearings(landuse)) clearing([ring]);
  // Corridors are distance fields, not rasterized ribbons: a road a few texels wide filled cell by cell left a
  // staircase edge in the ground and the crowns. Each texel keeps its exact signed distance (texels, positive
  // inside) to the nearest corridor capsule; it is merged into the open/forest fields below.
  const corridor = corridorDistance([...corridors, ...landuse.forestCorridors ?? []], x, y, cell, n);
  if (corridor) for (let i = 0; i < n * n; i++) if (corridor[i] > 0 && (!cls[i] || forest[i])) cls[i] = CLEARING;
  // A 12 m lane can be thinner than a texel on a large map. Keep every crossed
  // cell open, as for thin building walls, rather than dropping the whole lane.
  for (const path of landuse.ways ?? []) for (let i = 1; i < path.length; i++) {
    visitSegmentCells({ w: n, h: n, cell }, { x: path[i - 1].x - x, y: path[i - 1].y - y },
      { x: path[i].x - x, y: path[i].y - y }, at => { cls[at] = CLEARANCE; open[at] = 1; forest[at] = 0; });
  }
  const dOpen = signedDistance(open, n), dForest = signedDistance(forest, n);
  // Union with the corridors: open grows to max(open, corridor), forest shrinks to min(forest, -corridor).
  // Every ground a corridor crosses is open afterwards (fields and plots already were), so the union is exact.
  if (corridor) for (let i = 0; i < n * n; i++) {
    const d = corridor[i]; if (d <= -RANGE) continue;
    if (d > dOpen[i]) dOpen[i] = d;
    if (-d < dForest[i]) dForest[i] = -d;
    if (d > 0) { open[i] = 1; forest[i] = 0; }
  }
  const rgba = new Uint8Array(n * n * 4);
  const enc = (d: number): number => Math.max(0, Math.min(255, Math.round(128 + 16 * d)));
  for (let i = 0, o = 0; i < n * n; i++, o += 4) {
    rgba[o] = enc(dOpen[i]); rgba[o + 1] = enc(dForest[i]); rgba[o + 2] = cls[i]; rgba[o + 3] = open[i] || forest[i] ? 255 : 0;
  }
  let hash = 0x811c9dc5;
  for (const word of new Uint32Array(rgba.buffer)) hash = Math.imul(hash ^ word, 0x01000193);
  return { x, y, width: n * cell, n, rgba, key: `occ:${x}:${y}:${n * cell}:${n}:${(hash >>> 0).toString(36)}` };
}

/** Signed distance (texels, positive inside) of each texel centre to the union of the corridor capsules, with the
 * half width interpolated along each segment; -RANGE (saturated) beyond reach. Undefined without corridors. */
function corridorDistance(corridors: readonly ForestCorridor[], x0: number, y0: number, cell: number, n: number): Float32Array | undefined {
  if (!corridors.length) return undefined;
  const out = new Float32Array(n * n).fill(-RANGE), reach = RANGE * cell;
  for (const c of corridors) for (let k = 1; k < c.path.length; k++) {
    const a = c.path[k - 1], b = c.path[k], ha = typeof c.half === 'number' ? c.half : c.half[k - 1], hb = typeof c.half === 'number' ? c.half : c.half[k];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, r = Math.max(ha, hb) + reach;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - x0) / cell)), i1 = Math.min(n - 1, Math.ceil((Math.max(a.x, b.x) + r - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r - y0) / cell)), j1 = Math.min(n - 1, Math.ceil((Math.max(a.y, b.y) + r - y0) / cell));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + .5) * cell - a.y;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + .5) * cell - a.x, t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
        const d = (ha + (hb - ha) * t - Math.hypot(px - t * dx, py - t * dy)) / cell, at = j * n + i;
        if (d > out[at]) out[at] = d;
      }
    }
  }
  return out;
}

/** Even-odd scanline fill of texel centres inside the rings, as [from, to) index spans. */
export function fillRings(rings: Polygon[], x0: number, y0: number, cell: number, n: number, span: (from: number, to: number) => void): void {
  let top = n, bottom = -1;
  const rows = new Map<number, number[]>();
  for (const ring of rings) for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    if (a.y === b.y) continue;
    const lo = Math.max(0, Math.ceil((Math.min(a.y, b.y) - y0) / cell - 0.5)), hi = Math.min(n - 1, Math.ceil((Math.max(a.y, b.y) - y0) / cell - 0.5) - 1);
    for (let j = lo; j <= hi; j++) {
      const yc = y0 + (j + 0.5) * cell, t = (yc - a.y) / (b.y - a.y);
      let list = rows.get(j); if (!list) rows.set(j, list = []);
      list.push(a.x + t * (b.x - a.x)); top = Math.min(top, j); bottom = Math.max(bottom, j);
    }
  }
  for (let j = top; j <= bottom; j++) {
    const xs = rows.get(j); if (!xs) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), to = Math.min(n - 1, Math.ceil((xs[k + 1] - x0) / cell - 0.5) - 1);
      if (from <= to) span(j * n + from, j * n + to + 1);
    }
  }
}

/**
 * Signed Euclidean distance in texels, positive inside, zero midway between
 * texel centres. One transform to the boundary texels (those with a 4-neighbour
 * on the other side) gives both signs: d = ±(distance + 1/2).
 */
/** Reach of the transform: the retained R/G channels saturate at |d| = 8 texels (128 + 16 d), so past 12 texels the exact value is never read. */
const REACH = 12, FAR = REACH * REACH;
const ROOTS = Float64Array.from({ length: FAR + 1 }, (_, i) => Math.sqrt(i));
function signedDistance(mask: Uint8Array, n: number): Float32Array {
  // Squared distance to the nearest boundary texel of the same column, capped at FAR.
  const column = new Uint8Array(n * n).fill(FAR), last = new Int32Array(n).fill(-REACH);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, m = mask[i];
    if ((x > 0 && mask[i - 1] !== m) || (x < n - 1 && mask[i + 1] !== m) || (y > 0 && mask[i - n] !== m) || (y < n - 1 && mask[i + n] !== m)) last[x] = y;
    const dy = y - last[x]; if (dy < REACH) column[i] = dy * dy;
  }
  last.fill(n + REACH);
  for (let y = n - 1; y >= 0; y--) for (let x = 0; x < n; x++) {
    const i = y * n + x; if (column[i] === 0) last[x] = y;
    const dy = last[x] - y; if (dy < REACH && dy * dy < column[i]) column[i] = dy * dy;
  }
  // Row pass: exact min over q of (x − q)² + g(q), capped at FAR, as the lower envelope of the parabolas
  // of the texels within reach (Felzenszwalb & Huttenlocher 2012): linear per row. Texels with g = FAR
  // never go below FAR. Values are small integers, so the result is exact.
  const squared = new Uint8Array(n * n).fill(FAR), d = new Float32Array(n * n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let k = -1;
    for (let q = 0; q < n; q++) {
      const g = column[row + q]; if (g >= FAR) continue;
      const fq = g + q * q;
      if (k < 0) { k = 0; v[0] = q; z[0] = -Infinity; z[1] = Infinity; continue; }
      let p = v[k], s = (fq - column[row + p] - p * p) / (2 * (q - p));
      while (s <= z[k]) { k--; p = v[k]; s = (fq - column[row + p] - p * p) / (2 * (q - p)); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    if (k < 0) continue;
    for (let x = 0, j = 0; x < n; x++) {
      while (z[j + 1] < x) j++;
      const value = (x - v[j]) * (x - v[j]) + column[row + v[j]];
      if (value < FAR) squared[row + x] = value;
    }
  }
  for (let i = 0; i < n * n; i++) d[i] = (ROOTS[squared[i]] + 0.5) * (mask[i] ? 1 : -1);
  return d;
}
