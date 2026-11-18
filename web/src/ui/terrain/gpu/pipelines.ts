/**
 * The map pipelines a TerrainGpu uses on the shared device (device.ts): the look's map and auxiliary pipelines and
 * the blended one for detail layers, the stand-in while they are created (the last drawn variant, else the
 * preview), readiness for world tiles and variantReady, and the idle preparation of the likely next look.
 */
import { rendererOverride } from '../../rendererOverride';
import { PREVIEW_VARIANT, SATELLITE_VARIANT, hasAuxPass, lookVariant, mapPasses, speculativePrewarmAllowed, type TerrainVariant } from '../variant';
import type { GpuShared } from './device';
import type { TerrainLook } from '../contract';

/** Runs `task` when the page is idle (at the latest after a few seconds). */
function whenIdle(task: () => unknown): void {
  const run = (): void => {
    void Promise.resolve()
      .then(task)
      .catch(error => console.warn('Idle preparation failed:', error));
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

export class GpuPipelines {
  /** Last map variant drawn: it stands in while the look's own pipeline is created. */
  private lastVariant: TerrainVariant = PREVIEW_VARIANT;
  private prewarmStarted = false;
  constructor(
    private gpu: GpuShared,
    /** A forest field is on the GPU (lookVariant). */
    private readonly forestUploaded: () => boolean,
    private readonly alive: () => boolean,
  ) {}
  /** A new device: its pipelines start again from the preview. */
  attach(gpu: GpuShared): void {
    this.gpu = gpu;
    this.lastVariant = PREVIEW_VARIANT;
  }
  lookVariant(look: TerrainLook): TerrainVariant {
    return lookVariant(look, this.forestUploaded());
  }
  terrain(v: TerrainVariant, pass: 'map' | 'aux', blend: 'none' | 'alpha', wait: boolean): GPURenderPipeline | undefined {
    return this.gpu.pipeline(this.gpu.terrainKey(v, pass, blend), () => this.gpu.terrainDescriptor(v, pass, blend), wait);
  }
  /** The look's map variant once created; meanwhile the last drawn variant (or the preview) stands in. `capturing`:
   * no idle preparation is started by a capture. */
  map(look: TerrainLook, wait: boolean, capturing: boolean): { variant: TerrainVariant; pipeline: GPURenderPipeline } | undefined {
    const target = this.lookVariant(look),
      pipeline = this.terrain(target, 'map', 'none', wait);
    if (pipeline) {
      if (!capturing) this.prewarmLikely();
      return { variant: (this.lastVariant = target), pipeline };
    }
    for (const v of [this.lastVariant, PREVIEW_VARIANT]) {
      const standIn = this.terrain(v, 'map', 'none', false);
      if (standIn) return { variant: v, pipeline: standIn };
    }
    return undefined;
  }
  /** Every pipeline the look's live redraw uses exists (map, auxiliary pass, blended detail when `details`); the
   * river, composite, water and present pipelines are created with the device. Starts the missing ones. */
  created(look: TerrainLook, details: boolean): boolean {
    const v = this.lookVariant(look);
    let created = true;
    for (const pass of mapPasses(v)) created = !!this.terrain(v, pass, 'none', false) && created;
    if (details) created = !!this.terrain(v, 'map', 'alpha', false) && created;
    return created;
  }
  /** Pipeline keys of a look (map, auxiliary pass if any, blended map if detail layers are shown); starts
   * creating them. */
  keys(look: TerrainLook, details: boolean): string[] {
    const v = this.lookVariant(look),
      passes: ['map' | 'aux', 'none' | 'alpha'][] = hasAuxPass(v)
        ? [
            ['map', 'none'],
            ['aux', 'none'],
          ]
        : [['map', 'none']];
    if (details) passes.push(['map', 'alpha']);
    return passes.map(([pass, blend]) => {
      this.terrain(v, pass, blend, false);
      return this.gpu.terrainKey(v, pass, blend);
    });
  }
  /** Once the requested look is drawn, prepare the likely next ones while the page is idle: the Satellite map
   * pipelines (the heaviest look), then its 3D ground. Never before the requested look: a heavy compilation started
   * first delays it. A hit makes the later switch or 3D opening immediate; a miss costs background compiler time. */
  private prewarmLikely(): void {
    if (this.prewarmStarted) return;
    this.prewarmStarted = true;
    // No speculative heavy pipelines (nor a second 3D device) on an integrated/software GPU or after a loss.
    if (!speculativePrewarmAllowed()) return;
    whenIdle(async () => {
      const gpu = this.gpu;
      if (!this.alive() || gpu.lost) return;
      const satellite = SATELLITE_VARIANT;
      const keys = mapPasses(satellite).map(pass => {
        this.terrain(satellite, pass, 'none', false);
        return gpu.terrainKey(satellite, pass, 'none');
      });
      await Promise.all(keys.map(key => gpu.settled(key)));
      if (!this.alive() || gpu.lost || rendererOverride() === 'webgl') return;
      // The 3D view's Satellite ground (same Render v2 material, forest on): its own device, created here if needed.
      (await import('../../terrain3dGpu')).prewarmTerrain3dGround(1, 1, 0);
    });
  }
}
