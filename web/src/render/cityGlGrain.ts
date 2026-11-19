/** City GPU renderer — mean tone of the Canvas uneven snow mantle, for the live look (live compositor).
 *
 * The exact town (cityCanvas drawPlanRoofsSteps) lays the uneven snow mantle on the snow patches of natural grounds:
 * a tile of the snow tone whose opacity is the depth (buildingMaterials coverGrainPattern 'snow' / 'snowShade'), at
 * `globalAlpha = strength`. Over a pan colour c, one such fill leaves on average
 *     c · (1 − strength · Ā) + strength · W̄
 * with Ā the mean opacity of the tile and W̄ its mean premultiplied colour. The live look applies exactly this mean
 * (cityGl FILL_VS snow patch), so a snowed roof keeps the tone of the exact one, without its thin places. The cover
 * grain itself is drawn as marks from the tiles (render/world/buildingsGrain.ts).
 *
 * The tiles are private to buildingMaterials.ts; their means are measured once by filling one tile period, pixel for
 * pixel, over black then over white with the same pattern the Canvas path uses: over black the mean is W̄, over white
 * it is 1 − Ā + W̄. One kind (all its levels) per `grainMeansStep` call, a few milliseconds each. */
import { coverGrainPattern, type SnowCover } from './buildingMaterials';

/** Levels of the grain tiles (buildingMaterials GRAIN_LEVELS), side of the finest tile and its metres per pixel. */
const LEVELS = 8,
  TILE = 256,
  PX_M = 0.05;
const KINDS: readonly SnowCover[] = ['snow', 'snowShade'];
/** Per kind and level: mean premultiplied colour (r, g, b) and mean opacity. */
const means = new Map<string, [number, number, number, number]>();
let measured = 0,
  failed = false;
const perLevel = new Map<number, Float32Array>();

function measure(kind: SnowCover, level: number): [number, number, number, number] {
  const n = Math.max(1, TILE >> level),
    s = PX_M * 2 ** level;
  const surface = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
  const ctx = surface.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D context');
  ctx.imageSmoothingEnabled = false; // one tile pixel per canvas pixel: no resampling of the marks
  const over = (ground: string): [number, number, number] => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, n, n);
    // dir = π/2: the pattern is the tile scaled by `s` metres per tile pixel, unrotated; the context maps one tile
    // pixel to one canvas pixel, so one fill covers exactly one period.
    const pattern = coverGrainPattern(ctx, kind, level, Math.PI / 2, 0, 0);
    if (!pattern) throw new Error(`no grain pattern ${kind}`);
    ctx.setTransform(1 / s, 0, 0, 1 / s, 0, 0);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, n * s, n * s);
    const data = ctx.getImageData(0, 0, n, n).data,
      sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
    }
    const k = 1 / (255 * n * n);
    return [sum[0] * k, sum[1] * k, sum[2] * k];
  };
  const black = over('#000000'),
    white = over('#ffffff');
  return [black[0], black[1], black[2], Math.max(0, Math.min(1, 1 - white[0] + black[0]))];
}
/** Measures the next kind (every level); true while kinds remain. A host without 2D canvas leaves the means at zero
 * (flat snow patches). */
export function grainMeansStep(): boolean {
  if (measured >= KINDS.length || failed) return false;
  const kind = KINDS[measured];
  try {
    for (let level = 0; level < LEVELS; level++) means.set(`${kind}/${level}`, measure(kind, level));
  } catch (error) {
    failed = true;
    console.warn('Roof snow means unavailable', error);
    return false;
  }
  measured++;
  return measured < KINDS.length;
}
export const grainMeansReady = (): boolean => failed || measured >= KINDS.length;
/** Premultiplied mean colour and mean opacity of the sunny and shaded snow tiles at a grain level (FILL_VS uSnowMean[2]). */
export function snowMeans(level: number): Float32Array {
  let out = perLevel.get(level);
  if (out) return out;
  out = new Float32Array(8);
  KINDS.forEach((kind, i) => {
    const m = means.get(`${kind}/${level}`);
    if (m) out!.set(m, i * 4);
  });
  if (grainMeansReady()) perLevel.set(level, out);
  return out;
}
