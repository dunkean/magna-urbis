import { planPainting, paintingSvg, type FantasyOptions, type BrushLibrary, type PaintSample } from '../../../rust/bridge/fantasyPainting';
import { urbanPaintingMask, type UrbanPaintingContext } from '../../../rust/bridge/urbanPaintingMask';
import type { SettlementRaster, RoadOutput, Point } from '../../../rust/bridge/settlements';
import type { Layout } from '../../../rust/bridge/urban';
interface DecorPaint { raster: SettlementRaster; seed: string; temperature: number; rain: number; layouts?: Layout[]; roads?: RoadOutput; city?: { center: Point; radius: number } }
const contexts = new WeakMap<SettlementRaster, { city: string; context: UrbanPaintingContext }>();
export function paintFantasyDecor(input: DecorPaint, library: BrushLibrary, options: FantasyOptions): string {
  const r = input.raster, n = r.n, cell = r.width / n, city = JSON.stringify(input.city);
  let entry = contexts.get(r);
  if (!entry || entry.city !== city || entry.context.layouts !== input.layouts || entry.context.roads !== input.roads) {
    entry = { city, context: { layouts: input.layouts, roads: input.roads, cities: input.city ? [input.city] : [] } };
    contexts.set(r, entry);
  }
  const occupied = urbanPaintingMask(r.width, n, entry.context);
  const sample = (x: number, y: number): PaintSample | undefined => {
    if (x < 0 || y < 0 || x >= r.width || y >= r.width) return;
    const ix = Math.min(n - 1, Math.floor(x / cell)), iy = Math.min(n - 1, Math.floor(y / cell)), i = iy * n + ix;
    const dx = (r.height[iy * n + Math.min(n - 1, ix + 1)] - r.height[iy * n + Math.max(0, ix - 1)]) / (2 * cell);
    const dy = (r.height[Math.min(n - 1, iy + 1) * n + ix] - r.height[Math.max(0, iy - 1) * n + ix]) / (2 * cell);
    return { height: r.height[i], slope: Math.hypot(dx, dy), temperature: input.temperature, rain: input.rain, water: r.water[i] !== 0 || r.riverWidth[i] > 0, occupied: occupied(x, y) };
  };
  const stamps = planPainting({ x: 0, y: 0, width: r.width, height: r.width }, sample, { seed: input.seed, pitch: r.width / 65 * options.spacing, density: options.density, size: options.size });
  return paintingSvg(stamps, library, 'urban-fantasy');
}
