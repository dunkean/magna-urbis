import type { V2Settings } from '../contracts';
import type { Vec2 } from '../../gen/types';
import { rasterizeCoastTrace } from '../coastTrace';

type Point = [number, number];
export interface FmgNetwork {
  river?: { points: Point[]; widthKm: number };
  roads?: Point[][];
}
export interface ImportedRiver {
  points: Point[];
  width: number;
}

function path(value: unknown, limit: number, min: number, max: number): value is Point[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= limit && value.every(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max));
}

export function validateImportedRiver(value: unknown): asserts value is ImportedRiver {
  const river = value as Partial<ImportedRiver> | null;
  if (!river || !path(river.points, 12, 0, 1) || typeof river.width !== 'number' || !Number.isFinite(river.width) || river.width < 3 || river.width > 100) throw new Error('Invalid imported river.');
}

export function parseFmgNetwork(value: unknown): FmgNetwork | undefined {
  if (!value || typeof value !== 'object') return;
  const { river, roads } = value as Partial<FmgNetwork>;
  const water = river && path(river.points, 9, -2, 2) && Number.isFinite(river.widthKm) && river.widthKm >= 0 && river.widthKm <= 20 ? { points: river.points, widthKm: river.widthKm } : undefined;
  const land = Array.isArray(roads) && roads.length <= 8 ? roads.filter(r => path(r, 9, -2, 2)) : [];
  return water || land.length ? { river: water, roads: land.length ? land : undefined } : undefined;
}

function towardEdge(p: Vec2, neighbour: Vec2): Vec2 {
  const dx = p.x - neighbour.x, dy = p.y - neighbour.y;
  const t = Math.min(dx > 0 ? (1 - p.x) / dx : dx < 0 ? -p.x / dx : Infinity, dy > 0 ? (1 - p.y) / dy : dy < 0 ? -p.y / dy : Infinity);
  return Number.isFinite(t) ? { x: bound(p.x + dx * t), y: bound(p.y + dy * t) } : p;
}

const bound = (v: number) => Math.max(0, Math.min(1, v));
const scalePath = (points: Point[], dx = 0, dy = 0): Vec2[] => points.map(([x, y]) => ({ x: bound(0.5 + x * 0.4 + dx), y: bound(0.5 + y * 0.4 + dy) }));
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const distinct = (line: Vec2[]) => line.filter((p, i) => !i || distance(p, line[i - 1]) > 1e-5);

/** Preserve the bank the marker occupies. FMG's port marker may be almost on the centreline. */
function riverBankOffset(points: Point[], width: number, extent: number): [number, number] {
  let nearest = Infinity, normal: Point = [0, 0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (!length) continue;
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (length * length)));
    const x = a[0] + t * dx, y = a[1] + t * dy, d = Math.hypot(x, y);
    if (d >= nearest) continue;
    nearest = d;
    const side = x * dy - y * dx < 0 ? -1 : 1;
    normal = [side * dy / length, -side * dx / length];
  }
  const extra = Math.max(0, 0.045 + width / (2 * extent) - nearest * 0.4);
  return [normal[0] * extra, normal[1] * extra];
}

/** Both the studio's import and the iframe convert the same local network at their selected extent. */
export function applyFmgNetwork(settings: V2Settings, network: FmgNetwork, extent: number): void {
  const town = settings.region?.placement?.list?.[0];
  if (town) town.position = { x: extent / 2, y: extent / 2 };
  const coast = settings.terrain?.coastTrace;
  const sea = coast && rasterizeCoastTrace(coast, 96);
  const atSea = ({ x, y }: Vec2) => !!sea?.[Math.min(95, Math.floor(y * 96)) * 96 + Math.min(95, Math.floor(x * 96))];
  if (network.river) {
    const { points, widthKm } = network.river, width = Math.min(85, 8 + 1.8 * Math.sqrt(widthKm * 1000));
    const line = scalePath(points, ...riverBankOffset(points, width, extent));
    const first = line[0], last = line[line.length - 1];
    const river = distinct([towardEdge(first, line[1]), ...line, towardEdge(last, line[line.length - 2])]);
    if (river.length >= 2) settings.terrain = {
      ...settings.terrain,
      importedRiver: { points: river.map(({ x, y }) => [x, y]), width },
      hydrology: { ...settings.terrain?.hydrology, enabled: true, riverMode: 'vector' },
    };
  }
  if (network.roads?.length && settings.region) {
    const routes = Object.fromEntries(network.roads.flatMap((points, i) => {
      const line = scalePath(points), first = line[0], last = line[line.length - 1];
      // Extend through-going routes to the map edge. Retain genuine ends close to town.
      const center = { x: 0.5, y: 0.5 };
      if (distance(first, center) > 0.15) {
        const edge = towardEdge(first, line[1]);
        if (!atSea(edge)) line.unshift(edge);
      }
      if (distance(last, center) > 0.15) {
        const edge = towardEdge(last, line[line.length - 2]);
        if (!atSea(edge)) line.push(edge);
      }
      const nodes = distinct(line);
      if (nodes.length < 2) return [];
      const pieces = [{ path: nodes.map(p => ({ x: p.x * extent, y: p.y * extent })), width: 6, cls: 'main' as const }];
      return [[`draw:fmg-${i}`, pieces] as const];
    }));
    if (Object.keys(routes).length) {
      settings.region.roads = { ...settings.region.roads, exits: { highway: 0, main: 0, local: 0, track: 0 } };
      settings.roadOverrides = { ...settings.roadOverrides, routes };
    }
  }
}
