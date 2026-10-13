import { isFantasyStyle, planPainting, paintingSvg, DEFAULT_FANTASY_OPTIONS, type FantasyOptions, type BrushLibrary, type FantasyStyle, type PaintOptions, type PaintSample } from './fantasyPainting';
import type { TerrainData, TerrainSettings } from './terrain';
import { climateOf } from './terrain';
export { isFantasyStyle, DEFAULT_FANTASY_OPTIONS };
export type { FantasyOptions };
let libraries: Record<FantasyStyle, BrushLibrary> | undefined;
export function registerFantasyBrushes(value: Record<FantasyStyle, BrushLibrary>): void { libraries = value; }
const scenes = new WeakMap<TerrainData, { water: TerrainData['water']; hydro: TerrainData['hydrology']; variants: Map<string, string> }>();
/** Whole-map overview owns brush positions; camera refinement never repaints stands. */
export function renderFantasyTerrain(terrain: TerrainData, style: FantasyStyle, settings: Pick<TerrainSettings, 'seed' | 'width'> & Partial<Pick<TerrainSettings, 'climate' | 'climateValues'>>, options = DEFAULT_FANTASY_OPTIONS): string {
  if (terrain.caveMask.length) return '';
  const key = JSON.stringify([style, settings.seed, settings.width, settings.climate, settings.climateValues, options]);
  let entry = scenes.get(terrain);
  if (!entry || entry.water !== terrain.water || entry.hydro !== terrain.hydrology) {
    entry = { water: terrain.water, hydro: terrain.hydrology, variants: new Map() }; scenes.set(terrain, entry);
  }
  const cache = entry.variants;
  const cached = cache.get(key); if (cached !== undefined) return cached;
  const n = terrain.resolution, climate = climateOf(settings as TerrainSettings), hydro = terrain.hydrology;
  const sample = (x: number, y: number): PaintSample | undefined => {
    const u = (x - terrain.x) / terrain.width, v = (y - terrain.y) / terrain.width;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return;
    const ix = Math.min(n - 1, Math.floor(u * n)), iy = Math.min(n - 1, Math.floor(v * n)), i = iy * n + ix;
    const vector = terrain.water;
    const vectorN = vector?.hydro.n ?? 0;
    const vectorWater = vector && vector.lake[Math.min(vectorN - 1, Math.floor(v * vectorN)) * vectorN + Math.min(vectorN - 1, Math.floor(u * vectorN))] !== 0;
    const water = hydro && hydro.waterField[Math.min(hydro.resolution - 1, Math.floor(v * hydro.resolution)) * hydro.resolution + Math.min(hydro.resolution - 1, Math.floor(u * hydro.resolution))] > 0;
    const h = terrain.height[i], dx = (terrain.height[iy * n + Math.min(n - 1, ix + 1)] - terrain.height[iy * n + Math.max(0, ix - 1)]) / (2 * terrain.width / n);
    const dy = (terrain.height[Math.min(n - 1, iy + 1) * n + ix] - terrain.height[Math.max(0, iy - 1) * n + ix]) / (2 * terrain.width / n);
    return { height: h, slope: Math.hypot(dx, dy), temperature: climate.temperature, rain: climate.precipitation, water: !!water || !!vectorWater };
  };
  const paint: PaintOptions = { seed: settings.seed, pitch: settings.width / 65 * options.spacing, density: options.density, size: options.size };
  const stamps = planPainting({ x: terrain.x, y: terrain.y, width: terrain.width, height: terrain.width }, sample, paint);
  if (!libraries) throw new Error('Fantasy brush sheets have not been registered by the page.');
  const scene = paintingSvg(stamps, libraries[style], `fantasy-${style}-${terrain.x}-${terrain.y}`);
  if (cache.size >= 6) cache.delete(cache.keys().next().value!);
  cache.set(key, scene); return scene;
}
