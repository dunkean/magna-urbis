/** City GPU renderer — mean tone of the Canvas roof grain, for the live look (live compositor).
 *
 * The exact town (cityCanvas drawPlanRoofsSteps) fills each pan, on natural grounds, with its cover's grain pattern
 * (buildingMaterials coverGrainPattern: black and white marks of a mean-centred field, the light marks at .7) at
 * `globalAlpha = strength`, and lays the uneven snow mantle (a tile of the snow tone whose opacity is the depth) on the
 * snow patches. Over a pan colour c, one such fill leaves on average
 *     c · (1 − strength · Ā) + strength · W̄
 * with Ā the mean opacity of the tile and W̄ its mean premultiplied colour. The live look draws flat pans: it applies
 * exactly this mean (cityGl FILL_VS roof mode), so a roof keeps the tone of the exact one, only without its marks.
 *
 * The tiles are private to buildingMaterials.ts; their means are measured once by filling one tile period, pixel for
 * pixel, over black then over white with the same pattern the Canvas path uses: over black the mean is W̄, over white
 * it is 1 − Ā + W̄. One kind (all its levels) per `grainMeansStep` call, a few milliseconds each. */
import { COVER_GRAINS, coverGrainPattern, type CoverGrain, type SnowCover } from './buildingMaterials';

/** Levels of the grain tiles (buildingMaterials GRAIN_LEVELS), side of the finest tile and its metres per pixel. */
const LEVELS = 8, TILE = 256, PX_M = .05;
const KINDS: readonly (CoverGrain | SnowCover)[] = [...COVER_GRAINS, 'snow', 'snowShade'];
/** Per kind and level: mean premultiplied colour (r, g, b) and mean opacity. */
const means = new Map<string, [number, number, number, number]>();
let measured = 0, failed = false;
const perLevel = new Map<number, { grain: Float32Array; snow: Float32Array }>();

function measure(kind: CoverGrain | SnowCover, level: number): [number, number, number, number] {
  const n = Math.max(1, TILE >> level), s = PX_M * 2 ** level;
  const surface = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
  const ctx = surface.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D context');
  ctx.imageSmoothingEnabled = false; // one tile pixel per canvas pixel: no resampling of the marks
  const over = (ground: string): [number, number, number] => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = ground; ctx.fillRect(0, 0, n, n);
    // dir = π/2: the pattern is the tile scaled by `s` metres per tile pixel, unrotated; the context maps one tile
    // pixel to one canvas pixel, so one fill covers exactly one period.
    const pattern = coverGrainPattern(ctx, kind, level, Math.PI / 2, 0, 0);
    if (!pattern) throw new Error(`no grain pattern ${kind}`);
    ctx.setTransform(1 / s, 0, 0, 1 / s, 0, 0); ctx.fillStyle = pattern; ctx.fillRect(0, 0, n * s, n * s);
    const data = ctx.getImageData(0, 0, n, n).data, sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
    const k = 1 / (255 * n * n);
    return [sum[0] * k, sum[1] * k, sum[2] * k];
  };
  const black = over('#000000'), white = over('#ffffff');
  return [black[0], black[1], black[2], Math.max(0, Math.min(1, 1 - white[0] + black[0]))];
}
/** Measures the next kind (every level); true while kinds remain. A host without 2D canvas leaves the means at zero
 * (flat pans, as before). */
export function grainMeansStep(): boolean {
  if (measured >= KINDS.length || failed) return false;
  const kind = KINDS[measured];
  try { for (let level = 0; level < LEVELS; level++) means.set(`${kind}/${level}`, measure(kind, level)); }
  catch (error) { failed = true; console.warn('Roof grain means unavailable', error); return false; }
  measured++;
  return measured < KINDS.length;
}
export const grainMeansReady = (): boolean => failed || measured >= KINDS.length;
/** Uniforms of a grain level: `grain` = (Ā, W̄) per family in COVER_GRAINS order (FILL_VS uGrain[18]); `snow` =
 * premultiplied mean colour and mean opacity of the sunny and shaded snow tiles (uSnowMean[2]). */
export function grainLevelMeans(level: number): { grain: Float32Array; snow: Float32Array } {
  let out = perLevel.get(level);
  if (out) return out;
  const grain = new Float32Array(COVER_GRAINS.length * 2), snow = new Float32Array(8);
  COVER_GRAINS.forEach((kind, i) => { const m = means.get(`${kind}/${level}`); if (m) { grain[i * 2] = m[3]; grain[i * 2 + 1] = m[0]; } });
  (['snow', 'snowShade'] as const).forEach((kind, i) => { const m = means.get(`${kind}/${level}`); if (m) snow.set(m, i * 4); });
  out = { grain, snow };
  if (grainMeansReady()) perLevel.set(level, out);
  return out;
}
