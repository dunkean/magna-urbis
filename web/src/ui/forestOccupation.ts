import type { ForestOccupation } from '../../../rust/bridge/terrainForest';
import type { Polygon } from '../gen/core/geom';
import type { LandKind, LandUseLayer } from '../gen/types';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { buildingOccupationSurfaces } from './urbanBuildingProjection';

/** Shared classes: 7 is a general built reserve, 8 an occupied construction. */
const CLASS: Partial<Record<LandKind, number>> = { field: 1, meadow: 2, pasture: 3, orchard: 4, garden: 5, commons: 6 };
const BUILT = 7, OCCUPIED = 8, RANGE = 8;

/** Merge accepted footprints and authorized circulation into the same retained
 * occupation contract, regardless of the building layer's visibility. */
export function withBuildingOccupation(source: ForestOccupation | undefined, scene: Building3dScene | undefined): ForestOccupation | undefined {
  const buildings = scene?.occupationBuildings ?? scene?.buildings;
  if (!buildings?.length) return source;
  const shapes = buildings.flatMap(b => buildingOccupationSurfaces(b).flatMap(surface => surface));
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
    fill(rings, x, y, cell, n, occupied);
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
  return { x, y, width: n * cell, n, rgba, key: `built-occ:${source?.key ?? ''}:${x}:${y}:${n * cell}:${n}:${hash >>> 0}` };
}

/**
 * Rasterises applied rural land use into the shared occupation texture.
 * R and G hold signed distances (texels, positive inside) to the open and
 * forest regions, so bilinear sampling keeps sharp edges (Green 2007). The
 * raster covers only the occupied square, in the landuse/terrain frame (m).
 * Marsh is left to the material. Deterministic: same layer, same bytes.
 */
export function forestOccupation(landuse: LandUseLayer, maxN = 1536, minCell = 2): ForestOccupation | undefined {
  const shapes: { rings: Polygon[]; cls: number; forest: boolean }[] = [];
  for (const area of landuse.areas) {
    const cls = CLASS[area.kind] ?? 0;
    if (cls || area.kind === 'forest') shapes.push({ rings: [area.poly, ...area.holes ?? []], cls, forest: !cls });
  }
  for (const ring of landuse.reserve) shapes.push({ rings: [ring], cls: BUILT, forest: false });
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
    fill(s.rings, x, y, cell, n, (from, to) => {
      cls.fill(s.cls, from, to); open.fill(s.forest ? 0 : 1, from, to); forest.fill(s.forest ? 1 : 0, from, to);
    });
  }
  const dOpen = signedDistance(open, n), dForest = signedDistance(forest, n);
  const rgba = new Uint8Array(n * n * 4);
  const enc = (d: number): number => Math.max(0, Math.min(255, Math.round(128 + 16 * d)));
  for (let i = 0, o = 0; i < n * n; i++, o += 4) {
    rgba[o] = enc(dOpen[i]); rgba[o + 1] = enc(dForest[i]); rgba[o + 2] = cls[i]; rgba[o + 3] = open[i] || forest[i] ? 255 : 0;
  }
  let hash = 0x811c9dc5;
  for (const word of new Uint32Array(rgba.buffer)) hash = Math.imul(hash ^ word, 0x01000193);
  return { x, y, width: n * cell, n, rgba, key: `occ:${x}:${y}:${n * cell}:${n}:${(hash >>> 0).toString(36)}` };
}

/** Even-odd scanline fill of texel centres inside the rings, as [from, to) index spans. */
function fill(rings: Polygon[], x0: number, y0: number, cell: number, n: number, span: (from: number, to: number) => void): void {
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
function signedDistance(mask: Uint8Array, n: number): Float32Array {
  const d = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, m = mask[i];
    const edge = (x > 0 && mask[i - 1] !== m) || (x < n - 1 && mask[i + 1] !== m) || (y > 0 && mask[i - n] !== m) || (y < n - 1 && mask[i + n] !== m);
    d[i] = edge ? 0 : 1e20;
  }
  edt(d, n);
  for (let i = 0; i < n * n; i++) d[i] = (Math.sqrt(d[i]) + 0.5) * (mask[i] ? 1 : -1);
  return d;
}

/** In-place squared Euclidean distance transform (Felzenszwalb & Huttenlocher 2012), columns in cache-sized blocks. */
function edt(d: Float32Array, n: number): void {
  const B = 16, f = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), block = new Float32Array(B * n);
  const line = (src: Float32Array, offset: number): void => {
    for (let q = 0; q < n; q++) f[q] = src[offset + q];
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; src[offset + q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let c0 = 0; c0 < n; c0 += B) {
    const w = Math.min(B, n - c0);
    for (let r = 0; r < n; r++) for (let c = 0; c < w; c++) block[c * n + r] = d[r * n + c0 + c];
    for (let c = 0; c < w; c++) line(block, c * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < w; c++) d[r * n + c0 + c] = block[c * n + r];
  }
  for (let r = 0; r < n; r++) line(d, r * n);
}
