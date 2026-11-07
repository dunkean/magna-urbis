import type { TerrainData } from '../../../rust/bridge/terrain';
import type { Relief } from '../gen/options';
import type { World } from '../gen/types';
import { slopeGrid } from '../gen/core/grid';
import { contourSet, CONTOUR_INTERVAL } from './contours';

export interface CityContourPaths { step: number; thin: string; index: string }
interface Entry { terrain: TerrainData; world: World; relief: Relief; slope: number; paths: Map<string, CityContourPaths> }
const cache = new WeakMap<TerrainData, Entry>();
/** Thin lines stay this many pixels apart on a typical slope: a contour map reads the shape, not a hatching. */
const LINE_GAP_PX = 18;
const NICE_STEPS = [1, 2, 5, 10];

/** Round physical levels, thinned as the view widens; panning never changes them. */
export function cityContourInterval(relief: Relief, scale: number, slope = 0): number {
  const base = CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1);
  const wanted = Math.max(base * 2 ** Math.max(0, Math.floor(Math.log2(1 / Math.max(1e-6, scale) / 4))), slope * LINE_GAP_PX / Math.max(1e-6, scale));
  const decade = 10 ** Math.floor(Math.log10(wanted));
  return Math.max(base, NICE_STEPS.map(n => n * decade).find(step => step >= wanted * .999) ?? wanted);
}
/** Slope that most of the land stays under: steep gullies must not thin the lines of the whole map. */
function typicalSlope(data: Float32Array): number {
  const stride = Math.max(1, Math.floor(data.length / 20000)), sample: number[] = [];
  for (let i = 0; i < data.length; i += stride) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.floor(sample.length * .75)] ?? 0;
}
/** Box blur of the height field, three passes (close to a gaussian): lines flow at the scale they are read, without the grid's steps. */
function smoothedHeight(height: { w: number; h: number; data: Float32Array }, radius: number): Float32Array {
  const { w, h } = height; let from: Float32Array = height.data, to: Float32Array = new Float32Array(from.length);
  for (let pass = 0; pass < 6; pass++) {
    const horizontal = pass % 2 === 0, lines = horizontal ? h : w, size = horizontal ? w : h, stride = horizontal ? 1 : w, next = horizontal ? w : 1, span = 2 * radius + 1;
    for (let line = 0; line < lines; line++) {
      const origin = line * next; let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += from[origin + Math.min(size - 1, Math.max(0, i)) * stride];
      for (let i = 0; i < size; i++) {
        to[origin + i * stride] = sum / span;
        sum += from[origin + Math.min(size - 1, i + radius + 1) * stride] - from[origin + Math.max(0, i - radius) * stride];
      }
    }
    if (pass === 0) { from = to; to = new Float32Array(from.length); } else [from, to] = [to, from];
  }
  return from;
}

/** Same samples, slope filtering and index levels as Terrain Bench, without repainting its raster; smoothing follows the zoom. */
export function cityContourPaths(terrain: TerrainData, landform: string, scale: number): CityContourPaths {
  if (terrain.caveMask.length || landform === 'cavern') return { step: 0, thin: '', index: '' };
  const relief: Relief = landform === 'flat' || landform === 'hills' || landform === 'valley' ? landform : 'mountains';
  let entry = cache.get(terrain);
  if (!entry || entry.relief !== relief) {
    const height = { w: terrain.resolution, h: terrain.resolution, cell: terrain.width / terrain.resolution, data: terrain.height }, slope = slopeGrid(height);
    entry = { terrain, world: { terrain: { height, slope }, options: { relief } } as unknown as World, relief, slope: typicalSlope(slope.data), paths: new Map() }; cache.set(terrain, entry);
  }
  // One detail level per doubling of the zoom, so the cache stays small and a zoom step does not redraw every line.
  const metresPerPixel = 2 ** Math.round(Math.log2(1 / Math.max(1e-6, scale))), step = cityContourInterval(relief, scale, entry.slope), key = `${step}:${metresPerPixel}`, retained = entry.paths.get(key);
  if (retained) return retained;
  const height = entry.world.terrain.height, radius = Math.min(10, Math.max(1, Math.round(metresPerPixel * 5 / height.cell)));
  const world = { ...entry.world, terrain: { ...entry.world.terrain, height: { ...height, data: smoothedHeight(height, radius) } } } as World;
  const contours = contourSet(world, Math.min(terrain.width / 1600, metresPerPixel * 1.5), step, true);
  const pathData = (lines: typeof contours.thin): string => lines.map(path => path.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') + (path.closed ? 'Z' : '')).join('');
  const paths = { step, thin: pathData(contours.thin), index: pathData(contours.index) };
  entry.paths.set(key, paths); return paths;
}
