/**
 * Underdark mushrooms of a 3D terrain view: the instance stream around the orbit target (terrain3dFungi.ts builds it,
 * nearest first, three levels of detail), rebuilt when the target moves a third of the near radius, the abundance or
 * the cavern changes. Nothing outside the Underdark. The backend uploads and draws the instances.
 */
import { buildFungi, buildFungiSteps, FUNGUS_FAR, FUNGUS_NEAR, FUNGUS_STRIDE, type FungusInputs, type FungusStream } from '../../terrain3dFungi';
import { spline, type TerrainSurface } from './surface';
import type { TerrainViewContext } from './context';
import type { TerrainResources } from './contract';
import type { TerrainCameraRig } from './camera';
import type { TerrainCavern } from './cavern';
import type { TerrainForest } from './forest';

export class UnderdarkFungi {
  /** Instances uploaded, and per level of detail (drawn in that order). */
  count = 0;
  tiers: [number, number, number] = [0, 0, 0];
  private key = '';
  private jobs = 0;

  constructor(
    private readonly context: TerrainViewContext,
    private readonly resources: TerrainResources,
    private readonly surface: TerrainSurface,
    private readonly rig: TerrainCameraRig,
    private readonly cavern: TerrainCavern,
    private readonly forest: TerrainForest,
    private readonly waterAt: (x: number, y: number) => number,
  ) {}

  /** The surface changed: the next frame starts a new stream. */
  reset(): void {
    this.key = '';
    this.count = 0;
  }

  prepare(): void {
    const context = this.context,
      g = context.ground,
      cavern = this.cavern.field,
      layer = this.surface.layer,
      c = this.rig.camera;
    const abundance = g?.underdark && cavern && layer && !context.useMapShader ? this.cavern.settings().fungi : 0;
    if (!abundance || !cavern || !layer) {
      this.count = 0;
      this.key = '';
      return;
    }
    const step = FUNGUS_NEAR / 3,
      craftedBeds = !!context.look.craftedBeds,
      key = [Math.round(c.x / step), Math.round(c.y / step), abundance, this.cavern.revision, craftedBeds ? this.forest.occupation?.data?.key ?? 'awaiting-beds' : 'standard'].join('|');
    if (key === this.key || (this.jobs > 0 && !context.fullQualityCapture)) return;
    this.key = key;
    const inputs: FungusInputs = {
      seed: g!.seed >>> 0,
      cavern,
      abundance,
      towns: g!.townSites ?? g!.townGlow,
      farms: g!.farmBeds,
      craftedBeds,
      occupation: this.forest.occupation?.data,
      raw: (x, y) => spline(layer.data, layer.n, (x - layer.x) / layer.width, (y - layer.y) / layer.width),
      height: (x, y) => this.surface.heightAt(x, y),
      water: (x, y) => this.waterAt(x, y),
    };
    const view = { x: c.x, y: c.y };
    const install = (stream: FungusStream): void => {
      this.count = stream.values.length / FUNGUS_STRIDE;
      this.tiers = stream.counts;
      if (this.count) this.resources.uploadFungi(stream.values);
    };
    if (context.fullQualityCapture) {
      install(buildFungi(inputs, view));
      return;
    }
    const epoch = context.epoch,
      current = (): boolean => !context.disposed && epoch === context.epoch && this.key === key;
    this.jobs++;
    void context.preparation
      .run(buildFungiSteps(inputs, view), current, 1e15)
      .then(stream => {
        if (!current()) return;
        install(stream);
        context.request();
      })
      // A cancelled stream (patches cleared, e.g. a new height sampler) is rebuilt on the next frame, not when the focus next moves.
      .catch(error => {
        if (this.key === key) {
          this.key = '';
          context.request();
        }
        if (error?.name !== 'AbortError') console.warn('Underdark mushrooms:', error);
      })
      .finally(() => {
        this.jobs--;
        if (!this.key && !context.disposed) context.request();
      });
  }

  /** uFungusArea of the ground: where the modelled mushrooms stand (the painted caps give way to them), none without. */
  area(): [number, number, number, number] {
    return this.count ? this.fade() : [0, 0, 0, 0];
  }

  /** fungusFade of the mushroom shader: the stream's centre and its fade radii. */
  fade(): [number, number, number, number] {
    return [this.rig.camera.x, this.rig.camera.y, FUNGUS_FAR * 0.8, FUNGUS_FAR];
  }
}
