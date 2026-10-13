import { planPainting, paintingSvg, type FantasyOptions, type BrushLibrary, type PaintSample } from '../../../rust/bridge/fantasyPainting';
import type { SettlementRaster, RoadOutput, Point } from '../../../rust/bridge/settlements';
import type { Layout, Shape } from '../../../rust/bridge/urban';
interface DecorPaint { raster: SettlementRaster; seed: string; temperature: number; rain: number; layouts?: Layout[]; roads?: RoadOutput; city?: { center: Point; radius: number } }
interface Exclusion { n: number; values: Uint8Array; candidates: Map<number, Shape[]> }
const masks = new WeakMap<SettlementRaster, Exclusion & { layouts?: Layout[]; roads?: RoadOutput; city: string }>();
function inside(x: number, y: number, ring: Point[]): boolean {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}
function exclusion(input: DecorPaint): Exclusion {
  const { raster: r, layouts, roads, city } = input, cityKey = JSON.stringify(city), previous = masks.get(r);
  if (previous && previous.layouts === layouts && previous.roads === roads && previous.city === cityKey) return previous;
  const n = Math.min(512, r.n), mask = new Uint8Array(n * n), candidates = new Map<number, Shape[]>(), cell = r.width / n;
  const bounds = (x0: number, y0: number, x1: number, y1: number, test: (x: number, y: number) => boolean, shape?: Shape): void => {
    for (let y = Math.max(0, Math.floor(y0 / cell)); y <= Math.min(n - 1, Math.ceil(y1 / cell)); y++) for (let x = Math.max(0, Math.floor(x0 / cell)); x <= Math.min(n - 1, Math.ceil(x1 / cell)); x++) {
      const i = y * n + x;
      if (shape) { const list = candidates.get(i); if (list) list.push(shape); else candidates.set(i, [shape]); }
      if (test((x + .5) * cell, (y + .5) * cell)) mask[i] = 1;
    }
  };
  const shapes: Shape[] = (layouts ?? []).flatMap(l => l.quarters.map(q => q.shape));
  for (const shape of shapes) {
    if (!shape.outer.length) continue;
    bounds(Math.min(...shape.outer.map(p => p.x)), Math.min(...shape.outer.map(p => p.y)), Math.max(...shape.outer.map(p => p.x)), Math.max(...shape.outer.map(p => p.y)),
      (x, y) => inside(x, y, shape.outer) && !shape.holes.some(hole => inside(x, y, hole)), shape);
  }
  if (!shapes.length && city) bounds(city.center.x - city.radius, city.center.y - city.radius, city.center.x + city.radius, city.center.y + city.radius, (x, y) => Math.hypot(x - city.center.x, y - city.center.y) < city.radius);
  for (const road of roads?.segments ?? []) for (let i = 1; i < road.path.length; i++) {
    const a = road.path[i - 1], b = road.path[i], clearance = Math.max(cell * 1.5, road.width / 2);
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    bounds(Math.min(a.x, b.x) - clearance, Math.min(a.y, b.y) - clearance, Math.max(a.x, b.x) + clearance, Math.max(a.y, b.y) + clearance, (x, y) => {
      const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
      return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) < clearance;
    });
  }
  const result = { n, layouts, roads, city: cityKey, values: mask, candidates }; masks.set(r, result); return result;
}
export function paintFantasyDecor(input: DecorPaint, library: BrushLibrary, options: FantasyOptions): string {
  const r = input.raster, n = r.n, cell = r.width / n, mask = exclusion(input);
  const hasQuarters = input.layouts?.some(layout => layout.quarters.length), maskCell = r.width / mask.n;
  const sample = (x: number, y: number): PaintSample | undefined => {
    if (x < 0 || y < 0 || x >= r.width || y >= r.width) return;
    const ix = Math.min(n - 1, Math.floor(x / cell)), iy = Math.min(n - 1, Math.floor(y / cell)), i = iy * n + ix;
    const dx = (r.height[iy * n + Math.min(n - 1, ix + 1)] - r.height[iy * n + Math.max(0, ix - 1)]) / (2 * cell);
    const dy = (r.height[Math.min(n - 1, iy + 1) * n + ix] - r.height[Math.max(0, iy - 1) * n + ix]) / (2 * cell);
    const mi = Math.floor(y / maskCell) * mask.n + Math.floor(x / maskCell);
    const exactQuarter = !mask.values[mi] && mask.candidates.get(mi)?.some(shape => inside(x, y, shape.outer) && !shape.holes.some(hole => inside(x, y, hole)));
    const city = input.city, initialCity = !hasQuarters && city && Math.hypot(x - city.center.x, y - city.center.y) < city.radius;
    return { height: r.height[i], slope: Math.hypot(dx, dy), temperature: input.temperature, rain: input.rain, water: r.water[i] !== 0 || r.riverWidth[i] > 0, occupied: mask.values[mi] !== 0 || !!exactQuarter || !!initialCity };
  };
  const stamps = planPainting({ x: 0, y: 0, width: r.width, height: r.width }, sample, { seed: input.seed, pitch: r.width / 65 * options.spacing, density: options.density, size: options.size });
  return paintingSvg(stamps, library, 'urban-fantasy');
}
