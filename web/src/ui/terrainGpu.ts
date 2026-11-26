/**
 * TerrainGpu: the WebGPU renderer of the 2D ground, with the public surface and the passes of TerrainGl
 * (terrainGl.ts). The shaders are TerrainGl's, translated to WGSL by web/scripts/wgsl_shaders.ts
 * (terrainWgsl.generated.ts); Chrome and Edge compile WGSL without ANGLE's FXC step.
 *
 * Differences from the WebGL2 path, by construction:
 * - the generated vertex shaders flip clip-space y, so every offscreen target holds GL rows and the GL shader
 *   arithmetic (gl_FragCoord, texelFetch of targets, texture v) is unchanged; the map is drawn into an offscreen RGBA8
 *   target and flipped once onto the canvas (present);
 * - uniforms live in one storage block per program, written per draw into a frame buffer slot;
 * - look switches are pipeline overrides, created asynchronously (terrain/gpu/device.ts, pipelines.ts);
 * - captures and world tiles draw on canvases of their own, copied in the same task;
 * - a lost device is recreated, or the renderer continues as a TerrainGl (terrain/gpu/recovery.ts).
 *
 * This class assembles the parts of one device (terrain/gpu/: inputs, redraw, world tiles, captures), rebuilt
 * together on a new device, with what outlives a device: the look, the view, the pipelines' stand-in and idle
 * preparation, the content revision, the fallback presentation and the recovery.
 */
import { onDisplayQualityChange } from '../render/displayQuality';
import { styleTraits } from '../render/terrainStyle';
import type { Rect4, View } from '../render/view';
import type { ForestField, ForestOccupation } from '../../../rust/bridge/terrainForest';
import type { TerrainRenderer } from './terrainRenderer';
import { FallbackGround } from './terrain/fallbackGround';
import { ContentRevision, type InputChange } from './terrain/revision';
import { displayPixelRatio, type ViewState } from './terrain/redraw';
import { sharedGpu, type GpuShared } from './terrain/gpu/device';
import { GpuInputs, replayInputs } from './terrain/gpu/inputs';
import { GpuPipelines } from './terrain/gpu/pipelines';
import { GpuRedraw } from './terrain/gpu/redraw';
import { GpuWorldTiles } from './terrain/gpu/worldTiles';
import { GpuCaptures } from './terrain/gpu/captures';
import { GpuRecovery } from './terrain/gpu/recovery';
import type { HeightLayer, OverlayLayer, RetainedWaterOptions, SurfaceSample, TerrainLook, WaterLayer } from './terrain/contract';

/** A WebGPU map renderer on `canvas`, or undefined when WebGPU is not usable (see sharedGpu).
 * `glCanvas`: the factory's WebGL2 canvas, used if the device is lost for good (when it differs from
 * `canvas`, which keeps its WebGPU context). */
export async function createTerrainGpu(canvas: HTMLCanvasElement, forced: boolean, glCanvas?: HTMLCanvasElement): Promise<TerrainGpu | undefined> {
  const gpu = await sharedGpu(forced);
  return gpu && new TerrainGpu(canvas, gpu, forced, glCanvas !== canvas ? glCanvas : undefined);
}

/** The objects of one device, built together and rebuilt together on a new device. */
interface GpuParts {
  inputs: GpuInputs;
  redraw: GpuRedraw;
  tiles: GpuWorldTiles;
  captures: GpuCaptures;
}

export class TerrainGpu implements TerrainRenderer {
  private readonly context: GPUCanvasContext;
  private parts: GpuParts;
  private readonly pipelines: GpuPipelines;
  private readonly recovery: GpuRecovery;
  private look?: TerrainLook;
  private view?: ViewState;
  private frame = 0;
  private disposed = false;
  private capturing = false;
  private livePaused = false;
  private unlistenQuality?: () => void;
  private readonly fallbackGround = new FallbackGround();
  private readonly revision = new ContentRevision();
  /** A pipeline was created: the live view redraws; world tiles re-bake when the look's own pipelines became complete
   * (not for a speculative one). */
  private readonly pipelineCreated = (): void => {
    this.revision.noteLookComplete(!!this.look && !this.recovery.fallback && !this.gpu.lost && this.pipelines.created(this.look, this.parts.inputs.details.length > 0));
    this.request();
  };
  /** Last frame's GPU submission time, ms (CPU side). */
  get drawMs(): number {
    return this.recovery.fallback?.drawMs ?? this.parts.redraw.drawMs;
  }
  /** The backend actually drawing (WebGL2 after a definitive device loss). */
  get backend(): 'webgpu' | 'webgl' {
    return this.recovery.fallback ? 'webgl' : 'webgpu';
  }

  /** `canvas` changes only on a fall back to WebGL2 (terrainRendererCanvas reads it). */
  constructor(
    public canvas: HTMLCanvasElement,
    private gpu: GpuShared,
    forced = false,
    private readonly glCanvas?: HTMLCanvasElement,
  ) {
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU indisponible sur ce canevas');
    this.context = context;
    const alive = (): boolean => !this.disposed;
    this.pipelines = new GpuPipelines(gpu, () => !!this.parts.inputs.forest, alive);
    this.recovery = new GpuRecovery(forced, {
      disposed: () => this.disposed,
      rebuild: next => this.rebuild(next),
      giveUp: () => {
        const inputs = this.parts.inputs.snapshot(this.look, this.view);
        this.detach();
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        return { inputs, canvas: this.canvas, glCanvas: this.glCanvas, livePaused: this.livePaused };
      },
      fellBack: (_gl, canvas) => {
        this.canvas = canvas;
        this.revision.bump();
      },
    });
    this.parts = this.attach(gpu);
    this.unlistenQuality = onDisplayQualityChange(() => this.request());
  }
  /** Binds the renderer to a (new) device: canvas configuration, listeners and the device's parts. */
  private attach(gpu: GpuShared): GpuParts {
    this.gpu = gpu;
    this.context.configure({ device: gpu.device, format: gpu.canvasFormat, alphaMode: 'opaque' });
    gpu.listeners.add(this.pipelineCreated);
    gpu.lostListeners.add(this.recovery.onLost);
    const inputs = new GpuInputs(gpu.device);
    const redraw = new GpuRedraw(gpu, this.pipelines, inputs, { displayDrawn: () => this.fallbackGround.invalidate(this.canvas), alive: () => !this.disposed, animate: () => this.request(), shoreRingBaked: () => this.changed('content') });
    return { inputs, redraw, tiles: new GpuWorldTiles(gpu, redraw, inputs), captures: new GpuCaptures(gpu, redraw, inputs) };
  }
  private detach(): void {
    this.gpu.listeners.delete(this.pipelineCreated);
    this.gpu.lostListeners.delete(this.recovery.onLost);
  }
  /** Re-creates every GPU resource on `gpu` from the retained inputs (the old device's objects are dropped). */
  private rebuild(gpu: GpuShared): void {
    const inputs = this.parts.inputs.snapshot(this.look, this.view);
    this.detach();
    this.parts = this.attach(gpu);
    this.pipelines.attach(gpu);
    this.revision.bump();
    replayInputs(this, inputs);
  }
  private changed(change: InputChange): void {
    if (change === 'content') this.revision.bump();
    if (change !== 'none') this.request();
  }
  private get fallback(): TerrainRenderer | undefined {
    return this.recovery.fallback;
  }

  setLivePaused(paused: boolean): void {
    this.livePaused = paused;
    if (this.fallback) this.fallback.setLivePaused(paused);
    if (paused) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.request();
  }
  /** The whole map's control grid; drops detail layers. */
  setBase(layer: HeightLayer): void {
    if (this.fallback) return this.fallback.setBase(layer);
    this.changed(this.parts.inputs.setBase(layer));
  }
  /** A finer square region drawn over the base, cross-faded in; keeps at most two. */
  setDetail(layer: HeightLayer | undefined): void {
    if (this.fallback) return this.fallback.setDetail(layer);
    this.changed(this.parts.inputs.setDetail(layer));
  }
  /** Explicit Render3D refinement only; ordinary 2D layers never consume it. */
  setEnhancedDetail(layer: HeightLayer | undefined): void {
    if (this.fallback) return this.fallback.setEnhancedDetail(layer);
    this.changed(this.parts.inputs.setEnhancedDetail(layer));
  }
  setRetainedWater(svg: string | undefined, width = 1, options?: RetainedWaterOptions): void {
    if (this.fallback) return this.fallback.setRetainedWater(svg, width, options);
    this.changed(this.parts.inputs.setRetainedWater(svg, width, options));
  }
  setWater(water: WaterLayer | undefined): void {
    if (this.fallback) return this.fallback.setWater(water);
    this.changed(this.parts.inputs.setWater(water, this.look?.mapWidth));
  }
  setOverlay(overlay: OverlayLayer | undefined): void {
    if (this.fallback) return this.fallback.setOverlay(overlay);
    this.changed(this.parts.inputs.setOverlay(overlay));
  }
  /** The paper map's lit land, drawn under the woods of its tree symbols (render/treeSymbols.ts). */
  setLandBackdrop(image: HTMLCanvasElement | undefined): void {
    if (this.fallback) return this.fallback.setLandBackdrop(image);
    this.changed(this.parts.inputs.setLandBackdrop(image));
  }
  /** Render3D forest: texture uploads only. `undefined` restores the macro canopy of the material exactly. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): void {
    if (this.fallback) return this.fallback.setForest(field, occupation);
    this.changed(this.parts.inputs.setForest(field, occupation));
  }
  setRenderV2Season(season: number): void {
    if (this.fallback) return this.fallback.setRenderV2Season(season);
    if (!this.look) return;
    this.look = { ...this.look, v2Season: season };
    this.changed('content');
  }
  setLook(look: TerrainLook): void {
    if (this.fallback) return this.fallback.setLook(look);
    this.look = look;
    this.changed('content');
  }
  setView(view: View, width: number, height: number): void {
    if (this.fallback) return this.fallback.setView(view, width, height);
    this.view = { view, width, height };
    this.request();
  }

  /** Resolves once the current look's pipelines are created, without blocking: callers that can wait
   * (3D material tiles, illustration and export captures) capture after it, so the synchronous capture
   * finds every pipeline. Also waits for a device recovery in progress. */
  async variantReady(): Promise<void> {
    for (;;) {
      if (this.recovery.recovering) await this.recovery.recovering;
      if (this.fallback) return this.fallback.variantReady();
      if (!this.look || this.disposed || this.gpu.lost) return;
      const gpu = this.gpu,
        keys = this.pipelines.keys(this.look, this.parts.inputs.details.length > 0);
      const ready = await Promise.all(keys.map(key => gpu.settled(key)));
      if (gpu !== this.gpu || gpu.lost) continue; // device lost or recreated meanwhile
      if (!this.look || this.pipelines.keys(this.look, this.parts.inputs.details.length > 0).join() === keys.join()) {
        if (!ready.every(Boolean)) console.warn('WebGPU map: a pipeline of the look failed; the stand-in stays.');
        return;
      }
    }
  }

  /** Live ground tile (terrain/gpu/worldTiles.ts). */
  renderWorldTile(box: Rect4, px: number, treePlane?: TerrainLook['treePlane']): TexImageSource | undefined {
    if (this.fallback) return this.fallback.renderWorldTile(box, px, treePlane);
    if (this.disposed || this.recovery.recovering) return undefined;
    return this.parts.tiles.render(treePlane && this.look ? { ...this.look, treePlane } : this.look, box, px, look => this.pipelines.created(look, this.parts.inputs.details.length > 0));
  }
  /** Changes whenever renderWorldTile would draw other pixels (inputs, created pipelines, style pixel ratio, fall back). */
  contentRevision(): number {
    return this.revision.value() + (this.fallback?.contentRevision() ?? 0);
  }

  /** Synchronous, as the captures below: await variantReady() first where the caller can wait, otherwise a
   * missing pipeline is created synchronously and the readback waits for it (3-4 s for Render v2). */
  captureMap(size = 2048, groundOverlay = false): HTMLCanvasElement {
    if (this.fallback) return this.fallback.captureMap(size, groundOverlay);
    if (!this.look) throw this.recovery.unavailable();
    return this.captureRegion({ x: 0, y: 0, width: this.look.mapWidth }, size, false, true, undefined, groundOverlay);
  }
  /** Draws the final look now (a missing pipeline is created synchronously: the next readback of the canvas
   * waits for it). Async callers await variantReady() first. */
  redrawForCapture(): void {
    if (this.fallback) return this.fallback.redrawForCapture();
    if (!this.parts.inputs.base || !this.look || this.gpu.lost) throw this.recovery.unavailable();
    this.capturing = true;
    try {
      this.draw();
    } finally {
      this.capturing = false;
    }
  }
  /** Render a world-space LOD tile with the same material and detail as the map (terrain/gpu/captures.ts). */
  captureRegion(region: { x: number; y: number; width: number }, size = 512, includeDetails = true, restoreDisplay = true, height?: HeightLayer, groundOverlay = false, alphaOnly?: Uint8Array): HTMLCanvasElement {
    if (this.fallback) return this.fallback.captureRegion(region, size, includeDetails, restoreDisplay, height, groundOverlay, alphaOnly);
    return this.capture(this.look, region, size, includeDetails, restoreDisplay, height, groundOverlay, alphaOnly);
  }
  /** Canonical 1 m water samples with a caller-supplied world-space halo. */
  captureWaterMask(region: { x: number; y: number; width: number }): Uint8Array {
    if (this.fallback) return this.fallback.captureWaterMask(region);
    const n = Math.round(region.width),
      alpha = new Uint8Array(n * n),
      look = this.look;
    this.capture(look && styleTraits(look.style).waterAlwaysDrawn ? { ...look, layers: { ...look.layers, water: true } } : look, region, n, false, false, undefined, true, alpha);
    return alpha;
  }
  private capture(look: TerrainLook | undefined, region: { x: number; y: number; width: number }, size: number, includeDetails: boolean, restoreDisplay: boolean, height: HeightLayer | undefined, groundOverlay: boolean, alphaOnly?: Uint8Array): HTMLCanvasElement {
    if (!this.parts.inputs.base || !look || this.gpu.lost) throw this.recovery.unavailable();
    return this.parts.captures.region(look, region, size, includeDetails, restoreDisplay ? () => this.draw() : undefined, height, groundOverlay, alphaOnly);
  }

  createSurfaceSampler(): SurfaceSample | undefined {
    if (this.fallback) return this.fallback.createSurfaceSampler();
    return this.look && this.parts.inputs.createSurfaceSampler(this.look);
  }
  /** Height (metres) the renderer shows at a world point, from the finest layer covering it. */
  heightAt(x: number, y: number): number | undefined {
    if (this.fallback) return this.fallback.heightAt(x, y);
    return this.parts.inputs.heightAt(x, y, this.look?.floor ?? 0);
  }

  /** Fallback display (terrain/fallbackGround.ts): present in the caller's animation frame; `interacting` moves the
   * picture painted at rest instead of drawing. */
  redrawNow(view?: View, width?: number, height?: number, interacting = false, pixelRatio = displayPixelRatio()): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.fallback) return this.fallback.redrawNow(view, width, height, interacting, pixelRatio);
    if (view && width && height) this.view = { view, width, height };
    const state = this.view;
    if (state) this.fallbackGround.present(this.canvas, state.view, state.width, state.height, pixelRatio, interacting, () => this.draw(pixelRatio));
  }
  private request(): void {
    this.fallbackGround.invalidate(this.canvas);
    if (this.disposed || this.frame || this.fallback || this.livePaused) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }
  /** The live view on the display canvas. */
  private draw(pixelRatio = displayPixelRatio(), stylePixelRatio = pixelRatio): boolean {
    const { inputs, redraw } = this.parts;
    if (!this.look || !this.view) {
      this.fallbackGround.invalidate(this.canvas);
      return false;
    }
    const surface = { canvas: this.canvas, context: this.context, opaque: true };
    return redraw.draw({ look: this.look, view: this.view, details: inputs.details, enhanced: inputs.enhanced, pixelRatio, stylePixelRatio, surface, offscreen: false, targets: redraw.liveTargets, wait: this.capturing, capturing: this.capturing, tile: false });
  }

  dispose(): void {
    if (this.disposed) return;
    this.unlistenQuality?.();
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.detach();
    if (this.fallback) {
      this.fallback.dispose();
      return;
    }
    const { inputs, redraw, tiles, captures } = this.parts;
    tiles.dispose();
    redraw.dispose();
    inputs.dispose();
    this.context.unconfigure();
    captures.dispose();
  }
}
