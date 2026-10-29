/** Adapt an already computed bench overview. No relief, drainage or river is regenerated here. */
import type { TerrainData } from '../../../rust/bridge/terrain';
import type { ForestField } from '../../../rust/bridge/terrainForest';
import type { TerrainLayer, Polygon, River } from '../gen/types';
import { slopeGrid } from '../gen/core/grid';
import { forCellsNearPolyline } from '../gen/core/field';
import { vectorize } from '../gen/landuse/rural';
import { riverWidths } from '../ui/vectorWaterRender';
import { channelWidth } from '../ui/riverVectors';

export interface V2TerrainLayer extends TerrainLayer {
  v2NativeTerrain?: TerrainData;
  v2ForestField?: ForestField;
  v2NaturalForest?: Float32Array;
  v2EngineStats?: Record<string, string | number>;
}
const at = (x: number, y: number, n: number, width: number): number => Math.max(0, Math.min(n - 1, Math.floor(y / width * n))) * n + Math.max(0, Math.min(n - 1, Math.floor(x / width * n)));
function polygons(mask: Uint8Array, n: number, cell: number): { outer: Polygon; holes: Polygon[] }[] {
  if (!mask.some(Boolean)) return [];
  return vectorize(Float32Array.from(mask), n, n, cell, cell * cell * .1, { x0: 0, y0: 0, x1: n - 1, y1: n - 1 });
}
function riverClass(width: number): NonNullable<River['cls']> { return width >= 60 ? 'major' : width >= 12 ? 'river' : width >= 3 ? 'stream' : 'brook'; }

export function projectEngineTerrain(data: TerrainData): V2TerrainLayer {
  const n = data.resolution, length = n * n, width = data.width, cell = width / n;
  if (data.x !== 0 || data.y !== 0 || !Number.isInteger(n) || data.height.length !== length || !data.height.every(Number.isFinite)) throw new Error('An entire finite bench overview is required.');
  const height = { w: n, h: n, cell, data: data.height.slice() };
  const water = new Uint8Array(length), sea = new Uint8Array(length), lake = new Uint8Array(length);
  const flow = { w: n, h: n, cell, data: new Float32Array(length) }, receiver = new Int32Array(length).fill(-1), filled = height.data.slice();
  const vector = data.water, hydro = data.hydrology, cave = data.caveMask;
  let seaCells = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, wx = (x + .5) * cell, wy = (y + .5) * cell;
    if (cave.length && cave[i]) { water[i] = 4; continue; }
    const hn = vector?.hydro.n ?? hydro?.resolution ?? n, hi = at(wx, wy, hn, width);
    const seaMask = vector?.hydro.sea ?? hydro?.seaMask;
    const isSea = seaMask ? !!seaMask[hi] : !cave.length && height.data[i] <= 0;
    if (isSea) { water[i] = 1; sea[i] = 1; seaCells++; }
    else if (vector ? !!vector.lake[hi] : hydro ? !!hydro.lakeLabels[hi] && hydro.lakeDepth[hi] > 0 : false) { water[i] = 2; lake[i] = 1; }
    const accum = vector?.hydro.accumulation ?? hydro?.accumulation;
    const receivers = vector?.hydro.receiver ?? hydro?.receivers;
    const levels = vector?.hydro.filled ?? hydro?.filled;
    if (accum) flow.data[i] = accum[hi] / (cell * cell);
    if (levels) filled[i] = levels[hi];
    if (receivers) {
      let r = receivers[hi], steps = 0;
      // A coarser world grid can contain several drainage-grid cells. Follow through that same cell.
      while (r >= 0 && r < hn * hn && steps++ < hn * 2) {
        const target = at((r % hn + .5) * width / hn, (Math.floor(r / hn) + .5) * width / hn, n, width);
        if (target !== i) { receiver[i] = target; break; }
        const next = receivers[r]; if (next === r) break; r = next;
      }
    }
  }
  const rivers: River[] = [];
  if (vector?.rivers) {
    const network = vector.rivers;
    for (const line of [...network.rivers, ...network.braids, ...network.distributaries, ...network.oxbows]) {
      const path = Array.from({ length: line.points.length / 2 }, (_, j) => ({ x: line.points[j * 2], y: line.points[j * 2 + 1] }));
      if (path.length < 2) continue;
      const widths = riverWidths(vector, line, network.oxbows.includes(line) ? 1 : 0), max = Math.max(...widths);
      const mouthCell = at(path.at(-1)!.x, path.at(-1)!.y, vector.hydro.n, width);
      rivers.push({ path, width: widths, id: line.id ?? rivers.length, area: [...line.area], main: max >= 12,
        cls: riverClass(max), host: line.joins !== undefined && line.joins >= 0 ? line.joins : undefined,
        mouth: line.joins !== undefined && line.joins >= 0 ? 'river' : vector.hydro.sea[mouthCell] ? 'sea' : vector.lake[mouthCell] ? 'lake' : 'edge' });
    }
  } else if (vector) {
    // Grid mode draws the already routed D8 graph. Chain its edges, without fitting new vector meanders.
    const h = vector.hydro, hn = h.n, hc = width / hn, active = new Uint8Array(hn * hn), donors = new Uint8Array(hn * hn);
    const threshold = (vector.riverArea ?? Math.max(.02, .003 * (width / 1000) ** 2)) * 1e6;
    for (let i = 0; i < active.length; i++) if (!h.sea[i] && !vector.lake[i] && h.accumulation[i] >= threshold) active[i] = 1;
    for (let i = 0; i < active.length; i++) if (active[i] && h.receiver[i] >= 0 && active[h.receiver[i]]) donors[h.receiver[i]]++;
    for (let start = 0; start < active.length; start++) {
      if (!active[start] || donors[start] === 1) continue;
      const path: River['path'] = [], widths: number[] = [], areas: number[] = [];
      let i = start, terminal = -1;
      for (let count = 0; count < active.length; count++) {
        path.push({ x: (i % hn + .5) * hc, y: (Math.floor(i / hn) + .5) * hc });
        widths.push(channelWidth(h.accumulation[i], vector.widthScale ?? 1)); areas.push(h.accumulation[i]);
        const next = h.receiver[i]; terminal = next;
        if (next < 0 || next >= active.length || next === i) break;
        i = next;
        if (!active[i] || donors[i] !== 1) {
          path.push({ x: (i % hn + .5) * hc, y: (Math.floor(i / hn) + .5) * hc });
          widths.push(channelWidth(h.accumulation[i], vector.widthScale ?? 1)); areas.push(h.accumulation[i]); break;
        }
      }
      if (path.length < 2) continue;
      const max = widths.reduce((a, b) => Math.max(a, b), 0);
      rivers.push({ path, width: widths, id: start, area: areas, cls: riverClass(max), main: max >= 12,
        host: terminal >= 0 && active[terminal] && donors[terminal] !== 1 ? terminal : undefined,
        mouth: terminal >= 0 && h.sea[terminal] ? 'sea' : terminal >= 0 && vector.lake[terminal] ? 'lake' : terminal >= 0 && active[terminal] ? 'river' : 'edge' });
    }
  } else if (hydro) {
    const points = hydro.riverPoints;
    for (let id = 0; id < hydro.riverOffsets.length - 1; id++) {
      const path: River['path'] = [], widths: number[] = [];
      for (let j = hydro.riverOffsets[id]; j < hydro.riverOffsets[id + 1]; j++) { path.push({ x: points[j * 4], y: points[j * 4 + 1] }); widths.push(points[j * 4 + 2]); }
      if (path.length < 2) continue;
      const meta = id * 6, flags = hydro.riverMeta[meta + 4], host = hydro.riverMeta[meta + 3], max = Math.max(...widths);
      rivers.push({ path, width: widths, id: hydro.riverMeta[meta], main: !!(flags & 1), edgeFed: !!(flags & 2),
        source: flags & 16 ? 'lake' : flags & 2 ? 'edge' : 'spring', cls: riverClass(max),
        host: host ? host - 1 : undefined, mouth: flags & 4 ? 'sea' : flags & 8 ? 'lake' : host ? 'river' : 'edge' });
    }
  }
  // The planning raster follows the actual selected, retained vector network, including braids/oxbows/deltas.
  for (const river of rivers) for (let j = 1; j < river.path.length; j++) {
    const radius = Math.max(cell * .6, river.width[j - 1] / 2, river.width[j] / 2);
    forCellsNearPolyline([river.path[j - 1], river.path[j]], n, n, cell, radius, i => { if (!water[i]) water[i] = 3; });
  }
  const seaRegions = polygons(sea, n, cell);
  let lakes: Polygon[];
  if (hydro) {
    // Keep native ring coordinates. Their nesting is retained by SVG's even-odd water clip.
    lakes = [];
    for (let ring = 0; ring + 1 < hydro.lakeOffsets.length; ring++) {
      const poly: Polygon = [];
      for (let j = hydro.lakeOffsets[ring]; j < hydro.lakeOffsets[ring + 1]; j++) poly.push({ x: hydro.lakePoints[j * 2], y: hydro.lakePoints[j * 2 + 1] });
      if (poly.length >= 3) lakes.push(poly);
    }
  } else lakes = polygons(lake, n, cell).flatMap(r => [r.outer, ...r.holes]);
  const edgeSea = [0, 0, 0, 0]; // N E S W
  for (let j = 0; j < n; j++) { edgeSea[0] += sea[j]; edgeSea[1] += sea[j * n + n - 1]; edgeSea[2] += sea[(n - 1) * n + j]; edgeSea[3] += sea[j * n]; }
  const sides = ['N', 'E', 'S', 'W'] as const, side = sides[edgeSea.indexOf(Math.max(...edgeSea))];
  const terrain: V2TerrainLayer = { height, slope: slopeGrid(height), flow, water, receiver, filled, seaLevel: 0, seaFraction: seaCells / length,
    coastline: seaRegions.map(r => r.outer), islands: seaRegions.flatMap(r => r.holes), lakes, rivers,
    downSide: side, seaSide: seaCells ? side : null, v2NativeTerrain: data };
  if (cave.length) {
    const solid = Uint8Array.from(cave, value => value ? 1 : 0), floor = Uint8Array.from(cave, value => value ? 0 : 1);
    terrain.caverns = { floor: polygons(floor, n, cell), solid: polygons(solid, n, cell), mask: solid,
      clearance: new Float32Array(length), chambers: [] };
  }
  return terrain;
}
