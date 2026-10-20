import { planPainting, paintingSvg, type FantasyOptions, type BrushLibrary, type PaintSample } from '../../../rust/bridge/fantasyPainting';
import { urbanPaintingMask, type UrbanPaintingContext } from '../../../rust/bridge/urbanPaintingMask';
import type { SettlementRaster, RoadOutput, Point } from '../../../rust/bridge/settlements';
import type { Layout } from '../../../rust/bridge/urban';
import { paintingRelief } from '../../../rust/bridge/paintingRelief';
interface DecorPaint { raster: SettlementRaster; seed: string; temperature: number; rain: number; layouts?: Layout[]; roads?: RoadOutput; city?: { center: Point; radius: number } }
const contexts = new WeakMap<SettlementRaster, { city: string; context: UrbanPaintingContext }>();
export function paintFantasyDecor(input: DecorPaint, library: BrushLibrary, options: FantasyOptions): string {
  const r = input.raster, n = r.n, cell = r.width / n, city = JSON.stringify(input.city);
  let entry = contexts.get(r);
  if (!entry || entry.city !== city || entry.context.layouts !== input.layouts || entry.context.roads !== input.roads) {
    entry = { city, context: { layouts: input.layouts, roads: input.roads, cities: input.city ? [input.city] : [] } };
    contexts.set(r, entry);
  }
  const occupied = urbanPaintingMask(r.width, n, { layouts: entry.context.layouts, cities: entry.context.cities });
  const relief = paintingRelief(r.height, n, r.width, r.width / 65 * 3);
  const sample = (x: number, y: number): PaintSample | undefined => {
    if (x < 0 || y < 0 || x >= r.width || y >= r.width) return;
    const ix = Math.min(n - 1, Math.floor(x / cell)), iy = Math.min(n - 1, Math.floor(y / cell)), i = iy * n + ix;
    return { ...relief(x, y), temperature: input.temperature, rain: input.rain, water: r.water[i] !== 0 || r.riverWidth[i] > 0, occupied: occupied(x, y) };
  };
  const stamps = planPainting({ x: 0, y: 0, width: r.width, height: r.width }, sample, { seed: input.seed, pitch: r.width / 65 * options.spacing, brushPitch: r.width / 65, density: options.density, size: options.size });
  return paintingSvg(stamps, library, 'urban-fantasy');
}
