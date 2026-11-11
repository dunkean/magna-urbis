// A saved decor (web/decors/<id>.decor, the file City Bench opens with `artifact=`) as the V2 world's terrain.
// Relief, water mask, water levels and river widths are the decor's own cells; nothing is regenerated.
// The decor raster itself stays on the terrain (`v2DecorRaster`): placement, roads and towns read it as is
// (rustSettlementRaster), so the V2 builds its city on exactly the ground City Bench uses.
import type { TerrainLayer, River, Polygon } from '../gen/types';
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import { slopeGrid } from '../gen/core/grid';
import { vectorizeRegions } from '../../../rust/bridge/landuseNative';
import { loadCoreWasm } from '../../../rust/bridge/wasmRuntime';
import { decodeDecor, type Decor } from '../ui/decor';
import type { V2TerrainLayer } from './terrainProjection';

export interface DecorTerrainLayer extends V2TerrainLayer { v2DecorRaster?: SettlementRaster; v2DecorId?: string; v2Decor?: Decor }

/** The decor raster retained on a V2 terrain, if the world was opened from a decor. */
export const decorRasterOf = (terrain: TerrainLayer): SettlementRaster | undefined => (terrain as DecorTerrainLayer).v2DecorRaster;

const riverClass = (width: number): NonNullable<River['cls']> => width >= 60 ? 'major' : width >= 12 ? 'river' : width >= 3 ? 'stream' : 'brook';
const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/** Centre lines of the decor's river cells, one polyline per connected component of a river id, upstream first. */
function riverLines(r: SettlementRaster): River[] {
  const n = r.n, cell = r.width / r.n, cells = new Map<number, number[]>();
  for (let i = 0; i < n * n; i++) if (r.water[i] === 3 && r.riverIds[i] >= 0) {
    const list = cells.get(r.riverIds[i]); if (list) list.push(i); else cells.set(r.riverIds[i], [i]);
  }
  const rivers: River[] = [], seen = new Uint8Array(n * n), dist = new Int32Array(n * n).fill(-1), parent = new Int32Array(n * n);
  const bfs = (start: number, id: number, visit?: (i: number) => void): number => {
    const queue = [start]; dist[start] = 0; parent[start] = -1; let far = start;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % n, y = (i - x) / n; visit?.(i);
      if (dist[i] > dist[far]) far = i;
      for (const [dx, dy] of NEIGHBOURS) {
        const gx = x + dx, gy = y + dy; if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
        const j = gy * n + gx; if (dist[j] >= 0 || r.water[j] !== 3 || r.riverIds[j] !== id) continue;
        dist[j] = dist[i] + 1; parent[j] = i; queue.push(j);
      }
    }
    return far;
  };
  for (const [id, list] of cells) for (const start of list) {
    if (seen[start]) continue;
    const component: number[] = [];
    const a = bfs(start, id, i => { seen[i] = 1; component.push(i); });
    for (const i of component) dist[i] = -1;
    const b = bfs(a, id);
    let chain: number[] = []; for (let i = b; i >= 0; i = parent[i]) chain.push(i);
    for (const i of component) dist[i] = -1;
    if (chain.length < 3) continue;
    if (r.waterLevel[chain[0]] < r.waterLevel[chain.at(-1)!]) chain = chain.reverse();
    // Every third cell, smoothed over its neighbours: the cell staircase becomes a centre line.
    const step = 3, picks: number[] = [];
    for (let k = 0; k < chain.length; k += step) picks.push(k);
    if (picks.at(-1) !== chain.length - 1) picks.push(chain.length - 1);
    const at = (k: number) => ({ x: (chain[k] % n + .5) * cell, y: (Math.floor(chain[k] / n) + .5) * cell });
    const path = picks.map((k, j) => {
      if (j === 0 || j === picks.length - 1) return at(k);
      let x = 0, y = 0, c = 0;
      for (let d = -step; d <= step; d++) { const p = at(Math.max(0, Math.min(chain.length - 1, k + d))); x += p.x; y += p.y; c++; }
      return { x: x / c, y: y / c };
    });
    const width = picks.map(k => { let w = 0; for (let d = -step; d <= step; d++) w = Math.max(w, r.riverWidth[chain[Math.max(0, Math.min(chain.length - 1, k + d))]]); return Math.max(1, w); });
    const end = chain.at(-1)!, ex = end % n, ey = (end - ex) / n;
    let mouth: River['mouth'] = ex === 0 || ey === 0 || ex === n - 1 || ey === n - 1 ? 'edge' : 'river';
    for (const [dx, dy] of NEIGHBOURS) {
      const gx = ex + dx, gy = ey + dy; if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
      const w = r.water[gy * n + gx]; if (w === 1) mouth = 'sea'; else if (w === 2 && mouth !== 'sea') mouth = 'lake';
    }
    const max = Math.max(...width);
    rivers.push({ path, width, id, main: max >= 12, cls: riverClass(max), mouth });
  }
  return rivers;
}

function regions(mask: Uint8Array, n: number, cell: number): { outer: Polygon; holes: Polygon[] }[] {
  if (!mask.some(Boolean)) return [];
  return vectorizeRegions(Float32Array.from(mask), n, n, cell, cell * cell * .1, { x0: 0, y0: 0, x1: n - 1, y1: n - 1 });
}

/** V2 terrain of a decor: its exact cells, water polygons vectorised from its mask, rivers traced on its river cells. */
export async function decorTerrainLayer(decor: Decor, id: string): Promise<DecorTerrainLayer> {
  await loadCoreWasm();
  const r = decor.raster, n = r.n, length = n * n, cell = r.width / n, cave = decor.meta.tags.relief === 'cavern';
  const height = { w: n, h: n, cell, data: r.height.slice() };
  const water = new Uint8Array(length), sea = new Uint8Array(length), lake = new Uint8Array(length), filled = r.height.slice();
  const flow = { w: n, h: n, cell, data: new Float32Array(length).fill(1) }, receiver = new Int32Array(length).fill(-1);
  let seaCells = 0;
  for (let i = 0; i < length; i++) {
    const w = r.water[i];
    if (w === 1) { water[i] = 1; sea[i] = 1; seaCells++; }
    else if (w === 2) { water[i] = cave ? 4 : 2; if (!cave) lake[i] = 1; }
    else if (w === 3) { water[i] = 3; flow.data[i] = Math.max(1, r.riverWidth[i] ** 2); }
    if (w) filled[i] = Math.max(r.height[i], r.waterLevel[i]);
  }
  // D8 receivers on the water-filled surface (land use reads drainage directions).
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let best = filled[i], to = -1;
    for (const [dx, dy] of NEIGHBOURS) {
      const gx = x + dx, gy = y + dy; if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
      const j = gy * n + gx, drop = (filled[i] - filled[j]) / Math.hypot(dx, dy);
      if (filled[j] < best && drop > 0) { best = filled[j]; to = j; }
    }
    receiver[i] = to;
  }
  const seaRegions = regions(sea, n, cell), lakes = regions(lake, n, cell).flatMap(p => [p.outer, ...p.holes]);
  const edgeSea = [0, 0, 0, 0]; // N E S W
  for (let j = 0; j < n; j++) { edgeSea[0] += sea[j]; edgeSea[1] += sea[j * n + n - 1]; edgeSea[2] += sea[(n - 1) * n + j]; edgeSea[3] += sea[j * n]; }
  const sides = ['N', 'E', 'S', 'W'] as const, side = sides[edgeSea.indexOf(Math.max(...edgeSea))];
  return { height, slope: slopeGrid(height), flow, water, receiver, filled, seaLevel: 0, seaFraction: seaCells / length,
    coastline: seaRegions.map(p => p.outer), islands: seaRegions.flatMap(p => p.holes), lakes, rivers: riverLines(r),
    downSide: side, seaSide: seaCells ? side : null, v2DecorRaster: r, v2DecorId: id, v2Decor: decor,
    v2EngineStats: { backend: 'decor', decor: id } };
}

/** The V2 terrain of the decor carried by the settings (the gzip bytes of web/decors/<id>.decor). */
export function settingsDecorTerrain(decor: { id: string; bytes: Uint8Array }): Promise<DecorTerrainLayer> {
  return decorTerrainLayer(decodeDecor(decor.bytes), decor.id);
}

/** Original retained geometry, shared with City Bench without reconstructing river banks. */
export const retainedDecorOf = (terrain: TerrainLayer): Decor | undefined => (terrain as DecorTerrainLayer).v2Decor;
