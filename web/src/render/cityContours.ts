import type { TerrainData } from '../../../rust/bridge/terrain';
import type { Relief } from '../gen/options';
import type { World } from '../gen/types';
import { slopeGrid } from '../gen/core/grid';
import { contourSet, CONTOUR_INTERVAL } from './contours';

export interface CityContourPaths { step: number; thin: string; index: string }
const cache = new WeakMap<TerrainData, { world: World; relief: Relief; paths: Map<number, CityContourPaths> }>();

/** Fixed physical levels, thinned by powers of two in overview; panning never changes them. */
export function cityContourInterval(relief: Relief, scale: number): number {
  const base = CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1);
  return base * 2 ** Math.max(0, Math.floor(Math.log2(1 / Math.max(1e-6, scale) / 4)));
}

/** Same samples, smoothing, slope filtering and index levels as Terrain Bench, without repainting its raster. */
export function cityContourPaths(terrain: TerrainData, landform: string, scale: number): CityContourPaths {
  if (terrain.caveMask.length || landform === 'cavern') return { step: 0, thin: '', index: '' };
  const relief: Relief = landform === 'flat' || landform === 'hills' || landform === 'valley' ? landform : 'mountains';
  let entry = cache.get(terrain);
  if (!entry || entry.relief !== relief) {
    const height = { w: terrain.resolution, h: terrain.resolution, cell: terrain.width / terrain.resolution, data: terrain.height };
    const world = { terrain: { height, slope: slopeGrid(height) }, options: { relief } } as unknown as World;
    entry = { world, relief, paths: new Map() }; cache.set(terrain, entry);
  }
  const step = cityContourInterval(relief, scale), retained = entry.paths.get(step);
  if (retained) return retained;
  const contours = contourSet(entry.world, terrain.width / 1600, step, true);
  const pathData = (lines: typeof contours.thin): string => lines.map(path => path.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') + (path.closed ? 'Z' : '')).join('');
  const paths = { step, thin: pathData(contours.thin), index: pathData(contours.index) };
  entry.paths.set(step, paths); return paths;
}
