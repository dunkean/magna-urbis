import { isFantasyStyle, planPainting, paintingSvg, DEFAULT_FANTASY_OPTIONS, type FantasyOptions, type BrushLibrary, type FantasyStyle, type PaintOptions, type PaintSample } from './fantasyPainting';
import type { TerrainData, TerrainSettings } from './terrain';
import { climateOf } from './terrain';
import { urbanPaintingMask, type UrbanPaintingContext } from './urbanPaintingMask';
import { paintingRelief } from './paintingRelief';
export { isFantasyStyle, DEFAULT_FANTASY_OPTIONS };
export type { FantasyOptions };
let libraries: Record<FantasyStyle, BrushLibrary> | undefined;
export function registerFantasyBrushes(value: Record<FantasyStyle, BrushLibrary>): void { libraries = value; }
const scenes = new WeakMap<TerrainData, { water: TerrainData['water']; hydro: TerrainData['hydrology']; urban?: UrbanPaintingContext; variants: Map<string, string> }>();
/** Whole-map overview owns brush positions; camera refinement never repaints stands. */
export function renderFantasyTerrain(terrain: TerrainData, style: FantasyStyle, settings: Pick<TerrainSettings, 'seed' | 'width'> & Partial<Pick<TerrainSettings, 'climate' | 'climateValues'>>, options = DEFAULT_FANTASY_OPTIONS, urban?: UrbanPaintingContext): string {
  if (terrain.caveMask.length) return '';
  const key = JSON.stringify([style, settings.seed, settings.width, settings.climate, settings.climateValues, options]);
  let entry = scenes.get(terrain);
  if (!entry || entry.water !== terrain.water || entry.hydro !== terrain.hydrology || entry.urban !== urban) {
    entry = { water: terrain.water, hydro: terrain.hydrology, urban, variants: new Map() }; scenes.set(terrain, entry);
  }
  const cache = entry.variants;
  const cached = cache.get(key); if (cached !== undefined) return cached;
  const n = terrain.resolution, climate = climateOf(settings as TerrainSettings), hydro = terrain.hydrology;
  const occupied = urban && urbanPaintingMask(settings.width, n, { layouts: urban.layouts, cities: urban.cities });
  const relief = paintingRelief(terrain.height, n, terrain.width, settings.width / 65 * 3);
  const sample = (x: number, y: number): PaintSample | undefined => {
    const u = (x - terrain.x) / terrain.width, v = (y - terrain.y) / terrain.width;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return;
    const vector = terrain.water;
    const vectorN = vector?.hydro.n ?? 0;
    const vectorWater = vector && vector.lake[Math.min(vectorN - 1, Math.floor(v * vectorN)) * vectorN + Math.min(vectorN - 1, Math.floor(u * vectorN))] !== 0;
    const water = hydro && hydro.waterField[Math.min(hydro.resolution - 1, Math.floor(v * hydro.resolution)) * hydro.resolution + Math.min(hydro.resolution - 1, Math.floor(u * hydro.resolution))] > 0;
    return { ...relief(x - terrain.x, y - terrain.y), temperature: climate.temperature, rain: climate.precipitation, water: !!water || !!vectorWater, occupied: occupied?.(x, y) };
  };
  const paint: PaintOptions = { seed: settings.seed, pitch: settings.width / 65 * options.spacing, brushPitch: settings.width / 65, density: options.density, size: options.size };
  const stamps = planPainting({ x: terrain.x, y: terrain.y, width: terrain.width, height: terrain.width }, sample, paint);
  if (!libraries) throw new Error('Fantasy brush sheets have not been registered by the page.');
  const scene = paintingSvg(stamps, libraries[style], `fantasy-${style}-${terrain.x}-${terrain.y}`);
  if (cache.size >= 6) cache.delete(cache.keys().next().value!);
  cache.set(key, scene); return scene;
}
