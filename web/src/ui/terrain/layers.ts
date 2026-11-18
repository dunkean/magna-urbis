/**
 * Height layers of the 2D ground, backend-independent: the stack policy of the regional detail layers and of the
 * Render3D refinements (at most two each, the newer cross-faded over the older), and the CPU reading of what the
 * renderer shows (heightAt, the surface sampler of the 3D views). Both TerrainGl and TerrainGpu keep their uploaded
 * layers in this shape; only the upload and the release differ.
 */
import { createGroundDisplacementSampler } from '../../../../rust/bridge/terrainGround';
import { styleTraits } from '../../render/terrainStyle';
import { createTerrainSurfaceSampler } from '../terrainSurface';
import { DETAIL_FADE_MS } from './redraw';
import type { HeightLayer, SurfaceSample, TerrainLook } from './contract';

/** An uploaded height layer: the CPU layer, its pyramid, its fade start (performance.now()). */
export interface StackedLayer {
  layer: HeightLayer;
  levels: Float32Array[];
  alpha: number;
  fadeStart: number;
}

/** Adds a layer on top of `stack`, releasing the oldest beyond two. */
export function pushLayer<T extends StackedLayer>(stack: T[], next: T, release: (layer: T | undefined) => void): void {
  stack.push(next);
  while (stack.length > 2) release(stack.shift());
}
/** A detail fully faded in hides the older ones beneath it: they are released. Returns the kept stack. */
export function dropHiddenDetails<T extends StackedLayer>(details: T[], now: number, release: (layer: T | undefined) => void): T[] {
  let opaque = -1;
  for (let i = 0; i < details.length; i++) if (now - details[i].fadeStart >= DETAIL_FADE_MS) opaque = i;
  if (opaque <= 0) return details;
  for (let i = 0; i < opaque; i++) release(details[i]);
  return details.slice(opaque);
}

/** Uniform cubic B-spline weights at `t`, written into `out`. */
function splineWeights(t: number, out: number[]): number[] {
  out[0] = (1 - t) ** 3 / 6;
  out[1] = (3 * t ** 3 - 6 * t * t + 4) / 6;
  out[2] = (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6;
  out[3] = t ** 3 / 6;
  return out;
}
const wx: number[] = [0, 0, 0, 0],
  wy: number[] = [0, 0, 0, 0];
/** Height (metres) of `layer`'s B-spline at a world point, or undefined outside it. */
function layerHeight(layer: HeightLayer, x: number, y: number): number | undefined {
  const cell = layer.width / layer.n;
  if (x < layer.x || y < layer.y || x > layer.x + layer.width || y > layer.y + layer.width) return undefined;
  const gx = (x - layer.x) / cell - 0.5,
    gy = (y - layer.y) / cell - 0.5,
    fx = Math.floor(gx),
    fy = Math.floor(gy);
  splineWeights(gx - fx, wx);
  splineWeights(gy - fy, wy);
  const n = layer.n;
  let h = 0;
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const cx = Math.max(0, Math.min(n - 1, fx + i - 1)),
        cy = Math.max(0, Math.min(n - 1, fy + j - 1));
      h += layer.data[cy * n + cx] * wx[i] * wy[j];
    }
  return h;
}
/** Height (metres) the renderer shows at a world point, from the finest layer covering it (the newest detail first). */
export function heightAt(details: readonly StackedLayer[], base: StackedLayer | undefined, floor: number, x: number, y: number): number | undefined {
  for (let k = details.length - 1; k >= 0; k--) {
    const h = layerHeight(details[k].layer, x, y);
    if (h !== undefined) return Math.max(h, floor);
  }
  if (!base) return undefined;
  const h = layerHeight(base.layer, x, y);
  return h === undefined ? undefined : Math.max(h, floor);
}

/** The refined surface of the look (the 3D views' ground), rebuilt only when the base, the shown detail or the
 * inputs it reads change. */
export class SurfaceSamplerCache {
  private cache?: { base: HeightLayer; detail?: HeightLayer; key: string; sample: SurfaceSample };
  sampler(base: HeightLayer, detail: HeightLayer | undefined, look: TerrainLook): SurfaceSample {
    const refine = (look.refinement3d ?? 'noise') === 'noise';
    const ground = styleTraits(look.style).ground3d && (look.refinement3d ?? 'noise') !== 'source';
    // Not per frame: called when a 3D view or a probe asks for the surface.
    const key = JSON.stringify([refine, ground, look.climate, look.floor, look.sourceCell, look.seed, look.detail]);
    if (!this.cache || this.cache.base !== base || this.cache.detail !== detail || this.cache.key !== key) {
      const sample = createTerrainSurfaceSampler(base, { ...look, refine }, detail ? [detail] : [], true);
      const macroSampler = ground ? createTerrainSurfaceSampler(base, { ...look, refine: false }, [], false) : undefined;
      this.cache = { base, detail, key, sample: ground ? createGroundDisplacementSampler(sample, { seed: look.seed, sourceCell: look.sourceCell, macroSampler, climate: look.climate ? [look.climate.temperature, look.climate.precipitation] : undefined }) : sample };
    }
    return this.cache.sample;
  }
}
