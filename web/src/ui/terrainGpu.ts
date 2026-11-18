/**
 * TerrainGpu: the WebGPU renderer of the 2D ground, with the public surface and the passes of TerrainGl
 * (terrainGl.ts). The shaders are TerrainGl's, translated to WGSL by web/scripts/wgsl_shaders.ts
 * (terrainWgsl.generated.ts); Chrome and Edge compile WGSL without ANGLE's FXC step. The redraw description, the
 * parameter block, the variants, layers and retained water are shared with TerrainGl (terrain/); terrain/gpu/ holds
 * the device and pipelines, the storage block image, images and targets, the water passes and the brush atlas.
 *
 * Differences from the WebGL2 path, by construction:
 * - the generated vertex shaders flip clip-space y, so every offscreen target holds GL rows and the GL
 *   shader arithmetic (gl_FragCoord, texelFetch of targets, texture v) is unchanged; the map is drawn into
 *   an offscreen RGBA8 target and flipped once onto the canvas (present);
 * - uniforms live in one storage block per program, written per draw into a frame buffer slot;
 * - look switches are pipeline overrides; pipelines are created with createRenderPipelineAsync, the last
 *   drawn (or the preview) pipeline stands in meanwhile (terrain/gpu/device.ts);
 * - captures read a separate WebGPU canvas through drawImage, in the same task (no async readback). The
 *   capture methods stay synchronous: a pipeline still missing then is created synchronously, and the
 *   drawImage readback waits for its compilation (about 3-4 s for Render v2 on D3D12). Async callers await
 *   variantReady() first, which resolves once the look's pipelines exist, without blocking;
 * - world tiles draw on their own WebGPU canvas, so the display canvas and its fallback presentation stay as they are;
 * - a lost device (driver reset, GPU switch, device.destroy() from outside) is recreated with its pipelines
 *   and every GPU resource re-uploaded from the retained CPU inputs; if that fails, the renderer continues
 *   as a TerrainGl on a WebGL2 canvas when one can be had, otherwise captures throw a clear error.
 */
import { displayQualityUniform, onDisplayQualityChange } from '../render/displayQuality';
import { shoreRingPixels } from '../../../rust/bridge/terrainForestBeach';
import type { ForestField, ForestOccupation, LandDetail } from '../../../rust/bridge/terrainForest';
import { setSeasonCalendarGpu } from '../../../rust/bridge/terrainRenderV2Zones';
import { lakeDistances, seaDistanceSurface, type WaterSurface } from '../render/terrainWater';
import { styleTraits } from '../render/terrainStyle';
import type { Rect4, View } from '../render/view';
import { enterMapGpuLight, isMapContextLost, mapGpuLight, mapTextureCap } from './glContextRecovery';
import { TerrainGl } from './terrainGl';
import type { TerrainRenderer } from './terrainRenderer';
import { rendererOverride } from './rendererOverride';
import { cappedForest } from './terrain/gl/forest';
import { FallbackGround } from './terrain/fallbackGround';
import { ContentRevision } from './terrain/revision';
import { RetainedWaterSource } from './terrain/retainedWater';
import { SurfaceSamplerCache, dropHiddenDetails, heightAt, pushLayer } from './terrain/layers';
import { PREVIEW_VARIANT, SATELLITE_VARIANT, hasAuxPass, lookMode, lookVariant, mapPasses, speculativePrewarmAllowed, type TerrainVariant } from './terrain/variant';
import { captureLook, captureViewState, detailQuad, displayPixelRatio, fadeProgress, liveStyleRatio, lookPalettes, paintedWaterLook, redrawFrame, separateWaterLayer, settled, settledDetails, tileViewState, waterBand, type RedrawFrame } from './terrain/redraw';
import { writeFieldParams, writeLookParams, writeMapParamsAfterWaterLayer, writeWaterLayerParams, type LookBindings, type LookParamsState, type LookTexture } from './terrain/lookParams';
import { MAP_FORMAT, TERRAIN_TEXTURES, sharedGpu, type GpuShared } from './terrain/gpu/device';
import { Params } from './terrain/gpu/params';
import { GpuViewTargets, gpuImage, gpuTarget, releaseGpuLayer, releaseImage, rgbaImage, uploadGpuLayer, type ForestImages, type GpuHeightLayer, type GpuImage, type Surface } from './terrain/gpu/resources';
import { beginPass, renderRetainedWater, renderRivers, type GpuWaterPass } from './terrain/gpu/passes';
import { GpuBrushAtlas } from './terrain/gpu/brushes';
import { replayInputs, type RendererInputs } from './terrain/gpu/inputs';
import type { HeightLayer, OverlayLayer, RetainedWaterOptions, SurfaceSample, TerrainLook, ViewState, WaterLayer } from './terrain/types';
import * as WGSL from './terrainWgsl.generated';

export { prepareTerrainGpu } from './terrain/gpu/device';

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

/** A WebGPU map renderer on `canvas`, or undefined when WebGPU is not usable (see sharedGpu).
 * `glCanvas`: the factory's WebGL2 canvas, used if the device is lost for good (when it differs from
 * `canvas`, which keeps its WebGPU context). */
export async function createTerrainGpu(canvas: HTMLCanvasElement, forced: boolean, glCanvas?: HTMLCanvasElement): Promise<TerrainGpu | undefined> {
  const gpu = await sharedGpu(forced);
  return gpu && new TerrainGpu(canvas, gpu, forced, glCanvas !== canvas ? glCanvas : undefined);
}

const PRESENT_KEYS = ['present.0', 'present.1'];

export class TerrainGpu implements TerrainRenderer {
  private device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private capture?: { canvas: HTMLCanvasElement; context: GPUCanvasContext; opaque?: boolean };
  /** Last map variant drawn: it stands in while the look's own pipeline is created. */
  private lastVariant: TerrainVariant = PREVIEW_VARIANT;
  private forestVersion = 0;
  private capturing = false;
  private readonly fallbackGround = new FallbackGround();
  private livePaused = false;
  private readonly revision = new ContentRevision();
  /** A world tile is being drawn: on its own surface, the display canvas and its fallback presentation are untouched. */
  private tileRendering = false;
  /** Intermediate targets of the live view, of the world tiles, and the ones the current draw uses. */
  private liveTargets = new GpuViewTargets();
  private tileTargets = new GpuViewTargets();
  private targets = this.liveTargets;
  /** Opaque WebGPU canvas of the world tiles, kept at the tile size between bakes (no reconfiguration, no resize). */
  private tileCanvas?: { canvas: HTMLCanvasElement; context: GPUCanvasContext; device?: GPUDevice };
  private readonly retainedWater = new RetainedWaterSource();
  private base?: GpuHeightLayer;
  private details: GpuHeightLayer[] = [];
  private enhanced: GpuHeightLayer[] = [];
  private look?: TerrainLook;
  private readonly surface = new SurfaceSamplerCache();
  private lake?: GpuImage;
  private lakeMode = 0;
  private lakeN = 0;
  private overlay?: GpuImage;
  private coastDistance?: GpuImage;
  private shoreRing?: { layer: object; revision: number; image: GpuImage; x: number; y: number; width: number };
  /** A cast-shadow bake for a new light azimuth has landed in the shore ring: draw again to upload it. */
  private readonly ringChanged = (): void => {
    this.revision.bump();
    this.request();
  };
  private forest?: ForestImages;
  /** The forest field as given (the uploaded one may be capped, or absent in the light profile). */
  private forestSource?: ForestField;
  private occupation?: { data: ForestOccupation; image: GpuImage };
  private landDetail?: { data: LandDetail; image: GpuImage };
  private brushAtlas!: GpuBrushAtlas;
  private lakeInput?: Float32Array;
  private lakeWidth = 0;
  private seaSurface?: WaterSurface;
  private riverBuffer?: GPUBuffer;
  private riverCount = 0;
  private riverRegime = false;
  private view?: ViewState;
  private frame = 0;
  private disposed = false;
  private unlistenQuality?: () => void;
  private empty!: GpuImage;
  private emptyUint!: GpuImage;
  private readonly terrainParams = new Params(WGSL.WGSL_PARAMS.terrain);
  private readonly riverParams = new Params(WGSL.WGSL_PARAMS.river);
  private readonly waterParams = new Params(WGSL.WGSL_PARAMS.water);
  /** The terrain parameters while the auxiliary pass writes its own (restored after it). */
  private savedParams?: Uint8Array;
  /** Texture views of the map program by uniform name (TerrainGl's texture units): the map pass's, the auxiliary
   * pass's, and the one the look bindings write into. */
  private readonly mapTextures: Record<string, GPUTextureView> = {};
  private readonly auxTextures: Record<string, GPUTextureView> = {};
  private textures = this.mapTextures;
  /** Bind group entries of the map program, refilled for each draw. */
  private readonly terrainEntries: GPUBindGroupEntry[];
  /** The look's parameter block written into terrainParams and the texture record (lookParams.ts). */
  private readonly params: LookBindings;
  /** Per-frame storage slots of the draws' parameters (written once before the frame's submit). */
  private slots!: { buffer: GPUBuffer; staging: Uint8Array<ArrayBuffer>; used: number; align: number; slotSize: number };
  private readonly slot = (params: Params): GPUBufferBinding => {
    const s = this.slots,
      offset = Math.ceil(s.used / s.align) * s.align;
    if (offset + s.slotSize > s.staging.length) throw new Error('WebGPU map: too many draws in one frame');
    s.staging.set(params.bytes, offset);
    s.used = offset + params.bytes.length;
    return { buffer: s.buffer, offset, size: params.bytes.length };
  };
  /** A pipeline was created: the live view redraws; world tiles re-bake when the look's own pipelines became complete
   * (not for a speculative one, prewarmLikely). */
  private readonly redraw = (): void => {
    this.revision.noteLookComplete(!!this.look && !this.fallback && !this.gpu.lost && this.lookCreated(this.look));
    this.request();
  };
  /** Inputs kept only to rebuild the GPU state (setWater, setOverlay). */
  private waterInput?: WaterLayer;
  private overlayInput?: OverlayLayer;
  /** Device recovery in progress, recent losses (a device lost again and again falls back to WebGL2). */
  private recovering?: Promise<void>;
  private losses: number[] = [];
  /** After a definitive loss: the WebGL2 renderer everything is forwarded to, or the error captures throw. */
  private fallback?: TerrainGl;
  private failure?: Error;
  private readonly onLost = (): void => {
    if (this.disposed || this.recovering) return;
    this.recovering = this.recover().finally(() => {
      this.recovering = undefined;
    });
  };
  private gpuDrawMs = 0;
  /** Last frame's GPU submission time, ms (CPU side). */
  get drawMs(): number {
    return this.fallback?.drawMs ?? this.gpuDrawMs;
  }
  /** The backend actually drawing (WebGL2 after a definitive device loss). */
  get backend(): 'webgpu' | 'webgl' {
    return this.fallback ? 'webgl' : 'webgpu';
  }

  /** `canvas` changes only on a fall back to WebGL2 (terrainRendererCanvas reads it). */
  constructor(
    public canvas: HTMLCanvasElement,
    private gpu: GpuShared,
    private readonly forced = false,
    private readonly glCanvas?: HTMLCanvasElement,
  ) {
    this.device = gpu.device;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU indisponible sur ce canevas');
    this.context = context;
    this.terrainEntries = [{ binding: 0, resource: { buffer: undefined! } }, { binding: 1, resource: gpu.nearest }, { binding: 2, resource: gpu.linear }, ...TERRAIN_TEXTURES.map(name => ({ binding: WGSL.WGSL_TEXTURES[name], resource: undefined! as GPUTextureView }))];
    this.params = this.paramBindings();
    this.attach(gpu);
    this.unlistenQuality = onDisplayQualityChange(() => this.request());
  }
  setLivePaused(paused: boolean): void {
    this.livePaused = paused;
    if (this.fallback) this.fallback.setLivePaused(paused);
    if (paused) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.request();
  }

  /** Binds the renderer to a (new) device: canvas configuration, listeners and the device-wide images. */
  private attach(gpu: GpuShared): void {
    this.gpu = gpu;
    this.device = gpu.device;
    this.context.configure({ device: this.device, format: gpu.canvasFormat, alphaMode: 'opaque' });
    gpu.listeners.add(this.redraw);
    gpu.lostListeners.add(this.onLost);
    this.empty = gpuImage(this.device, 1, 1, 'r8unorm', new Uint8Array(1), 1);
    this.emptyUint = gpuImage(this.device, 1, 1, 'rgba32uint', new Uint32Array(4), 16);
    this.brushAtlas = new GpuBrushAtlas(this.device);
    this.terrainEntries[1].resource = gpu.nearest;
    this.terrainEntries[2].resource = gpu.linear;
    const align = this.device.limits.minStorageBufferOffsetAlignment;
    const slotSize = Math.ceil(Math.max(...Object.values(WGSL.WGSL_PARAMS).map(p => p.size)) / align) * align,
      count = 64;
    this.slots = { buffer: this.device.createBuffer({ label: 'map parameters', size: slotSize * count, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), staging: new Uint8Array(slotSize * count), used: 0, align, slotSize };
  }

  private inputs(): RendererInputs {
    return {
      look: this.look,
      view: this.view,
      base: this.base?.layer,
      details: this.details.map(d => d.layer),
      enhanced: this.enhanced.map(d => d.layer),
      retainedWater: this.retainedWater.input,
      water: this.waterInput,
      overlay: this.overlayInput,
      forest: this.forestSource,
      occupation: this.occupation?.data,
    };
  }

  /** After a device loss: a new device (shared with the other renderers), its pipelines and every resource
   * re-uploaded; after three failures, or a fourth loss within a minute, the WebGL2 fall back. */
  private async recover(): Promise<void> {
    // A lost device is rarely transient on a weak GPU (out of memory, a pipeline too heavy for the driver, or the
    // whole GPU process exiting on Mesa/Intel): the rebuilt device draws the light profile.
    enterMapGpuLight();
    const now = performance.now();
    this.losses = [...this.losses.filter(t => now - t < 60_000), now];
    let error: unknown = new Error('WebGPU : l’appareil est perdu à répétition.');
    for (let attempt = 0; attempt < 3 && this.losses.length <= 3; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      if (this.disposed) return;
      try {
        const gpu = await sharedGpu(this.forced);
        if (!gpu) throw new Error('WebGPU : plus d’adaptateur matériel.');
        if (this.disposed) return;
        if (gpu.lost) throw new Error('WebGPU : le nouvel appareil est déjà perdu.');
        this.rebuild(gpu);
        console.info('WebGPU map: device recreated, resources re-uploaded.');
        return;
      } catch (caught) {
        error = caught;
        console.warn('WebGPU map: device recreation failed:', caught);
      }
    }
    if (!this.disposed) this.fallBack(error);
  }
  /** Re-creates every GPU resource on `gpu` from the retained inputs (the old device's objects are dropped). */
  private rebuild(gpu: GpuShared): void {
    const inputs = this.inputs();
    this.gpu.listeners.delete(this.redraw);
    this.gpu.lostListeners.delete(this.onLost);
    this.attach(gpu);
    if (this.capture) this.capture.opaque = undefined; // reconfigured on the new device at next use
    this.lastVariant = PREVIEW_VARIANT;
    // The tile surface is reconfigured on the new device at its next use (tileSurface).
    this.liveTargets.forget();
    this.tileTargets.forget();
    this.retainedWater.clear();
    this.revision.bump();
    this.base = undefined;
    this.details = [];
    this.enhanced = [];
    this.lake = undefined;
    this.lakeInput = undefined;
    this.overlay = undefined;
    this.coastDistance = undefined;
    this.shoreRing = undefined;
    this.forest = undefined;
    this.forestSource = undefined;
    this.occupation = undefined;
    this.landDetail = undefined;
    this.riverBuffer = undefined;
    this.riverCount = 0;
    replayInputs(this, inputs);
  }
  /** Definitive loss: a TerrainGl on the factory's WebGL2 canvas, or on a fresh canvas put in place of this
   * one (a canvas keeps its first context type); otherwise captures throw `failure`. */
  private fallBack(error: unknown): void {
    const inputs = this.inputs(),
      reason = error instanceof Error ? error.message : String(error);
    this.gpu.listeners.delete(this.redraw);
    this.gpu.lostListeners.delete(this.onLost);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    let canvas = this.glCanvas;
    if (!canvas && this.canvas.isConnected) {
      canvas = this.canvas.cloneNode(false) as HTMLCanvasElement;
      this.canvas.replaceWith(canvas);
    }
    try {
      if (!canvas) throw new Error('aucun canevas WebGL2 disponible');
      let gl: TerrainGl;
      try {
        gl = new TerrainGl(canvas);
      } catch (lost) {
        // The factory canvas carries a context lost with the device (one GPU process): start from a fresh canvas.
        if (!isMapContextLost(lost)) throw lost;
        canvas = this.canvas.cloneNode(false) as HTMLCanvasElement;
        if (this.canvas.isConnected) this.canvas.replaceWith(canvas);
        gl = new TerrainGl(canvas);
      }
      gl.setLivePaused(this.livePaused);
      replayInputs(gl, inputs);
      this.fallback = gl;
      this.canvas = canvas;
      this.revision.bump();
      console.warn(`WebGPU map: device lost for good (${reason}); continuing with WebGL2.`);
    } catch (glError) {
      this.failure = new Error(`WebGPU indisponible pour la carte : appareil perdu (${reason}) et WebGL2 impossible (${glError instanceof Error ? glError.message : glError}).`);
      console.error(this.failure);
    }
  }
  /** The error a capture throws while the device is lost or after a failed recovery. */
  private unavailable(): Error {
    return this.failure ?? new Error('Le terrain est indisponible.');
  }

  private upload(layer: HeightLayer, pyramid: boolean): GpuHeightLayer {
    return uploadGpuLayer(this.device, layer, pyramid);
  }
  private release(layer: GpuHeightLayer | undefined): void {
    releaseGpuLayer(layer);
  }

  /** The whole map's control grid; drops detail layers. */
  setBase(layer: HeightLayer): void {
    if (this.fallback) return this.fallback.setBase(layer);
    this.enhanced.forEach(releaseGpuLayer);
    this.enhanced = [];
    this.release(this.base);
    this.details.forEach(releaseGpuLayer);
    this.details = [];
    this.base = this.upload(layer, true);
    releaseImage(this.coastDistance);
    this.coastDistance = undefined;
    this.seaSurface = layer.waterSurface ?? seaDistanceSurface({ height: layer.data, resolution: layer.n, width: layer.width, x: layer.x, y: layer.y });
    if (!layer.cave?.length) {
      const surface = this.seaSurface;
      this.coastDistance = gpuImage(this.device, surface.n, surface.n, 'r32float', surface.distance, 4);
    }
    this.revision.bump();
    this.request();
  }

  /** A finer square region drawn over the base, cross-faded in; keeps at most two. */
  setDetail(layer: HeightLayer | undefined): void {
    if (this.fallback) return this.fallback.setDetail(layer);
    this.revision.bump();
    if (!layer) {
      this.details.forEach(releaseGpuLayer);
      this.details = [];
      this.request();
      return;
    }
    const next = this.upload(layer, false);
    next.alpha = 0;
    next.fadeStart = performance.now();
    pushLayer(this.details, next, releaseGpuLayer);
    this.request();
  }

  setRenderV2Season(season: number): void {
    if (this.fallback) return this.fallback.setRenderV2Season(season);
    if (this.look) {
      this.look = { ...this.look, v2Season: season };
      this.revision.bump();
      this.request();
    }
  }
  setLook(look: TerrainLook): void {
    if (this.fallback) return this.fallback.setLook(look);
    this.look = look;
    this.revision.bump();
    this.request();
  }

  /** Explicit Render3D refinement only; ordinary 2D layers never consume it. */
  setEnhancedDetail(layer: HeightLayer | undefined): void {
    if (this.fallback) return this.fallback.setEnhancedDetail(layer);
    if (!layer) {
      if (this.enhanced.length) this.revision.bump();
      this.enhanced.forEach(releaseGpuLayer);
      this.enhanced = [];
      this.request();
      return;
    }
    if (this.enhanced.at(-1)?.layer === layer) return;
    this.revision.bump();
    const next = this.upload(layer, false);
    next.fadeStart = performance.now();
    pushLayer(this.enhanced, next, releaseGpuLayer);
    this.request();
  }

  setRetainedWater(svg: string | undefined, width = 1, options?: RetainedWaterOptions): void {
    if (this.fallback) return this.fallback.setRetainedWater(svg, width, options);
    if (!this.retainedWater.set(svg, width, options)) return;
    this.liveTargets.retained.invalidate();
    this.tileTargets.retained.invalidate();
    this.revision.bump();
    this.request();
  }

  setWater(water: WaterLayer | undefined): void {
    if (this.fallback) return this.fallback.setWater(water);
    this.waterInput = water;
    const width = this.look?.mapWidth ?? this.base?.layer.width ?? 0;
    if (water?.lake !== this.lakeInput || (water?.lake && (this.lakeN !== water.n || this.lakeWidth !== width))) {
      releaseImage(this.lake);
      this.lake = undefined;
      this.lakeInput = water?.lake;
      this.lakeWidth = width;
      if (water?.lake) {
        const distances = lakeDistances(water.lake, water.n, width),
          values = new Float32Array(water.n * water.n * 2);
        for (let i = 0; i < water.lake.length; i++) {
          values[i * 2] = water.lake[i];
          values[i * 2 + 1] = distances[i];
        }
        this.lake = gpuImage(this.device, water.n, water.n, 'rg32float', values, 8);
        this.lakeN = water.n;
      }
    }
    this.lakeMode = water?.shore === 'exact' ? 2 : 1;
    const rivers = water?.rivers ?? new Float32Array();
    this.riverCount = rivers.length / 9;
    this.riverRegime = !!water?.regime;
    if (rivers.byteLength) {
      if (!this.riverBuffer || this.riverBuffer.size < rivers.byteLength) {
        this.riverBuffer?.destroy();
        this.riverBuffer = this.device.createBuffer({ label: 'rivers', size: Math.ceil(rivers.byteLength / 4) * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      this.device.queue.writeBuffer(this.riverBuffer, 0, rivers as Float32Array<ArrayBuffer>);
    }
    this.revision.bump();
    this.request();
  }

  setOverlay(overlay: OverlayLayer | undefined): void {
    if (this.fallback) return this.fallback.setOverlay(overlay);
    this.overlayInput = overlay;
    releaseImage(this.overlay);
    this.overlay = overlay ? gpuImage(this.device, overlay.n, overlay.n, 'rgba8unorm', overlay.rgba, 4) : undefined;
    this.revision.bump();
    this.request();
  }

  setView(view: View, width: number, height: number): void {
    if (this.fallback) return this.fallback.setView(view, width, height);
    this.view = { view, width, height };
    this.request();
  }

  /** Render3D forest: texture uploads only. `undefined` restores the macro canopy of the material exactly. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): void {
    if (this.fallback) return this.fallback.setForest(field, occupation);
    const cap = mapTextureCap(this.device.limits.maxTextureDimension2D);
    if (field !== this.forestSource) {
      this.releaseForest();
      this.forestSource = field;
      // Light profile: no forest pass, no upload. Low-end GPUs: field and banks at most `cap` (TerrainGl.setForest).
      const shown = field && !mapGpuLight() ? cappedForest(field, cap) : undefined;
      this.forest = shown && {
        field: shown,
        texture: rgbaImage(this.device, shown, true),
        bank: shown.bank ? rgbaImage(this.device, { n: shown.n, rgba: shown.bank }, true) : undefined,
        beach: shown.beach ? gpuImage(this.device, shown.beach.n, shown.beach.n, 'r8unorm', shown.beach.data, 1) : undefined,
      };
    }
    if (occupation !== this.occupation?.data) {
      releaseImage(this.occupation?.image);
      this.occupation = occupation && { data: occupation, image: rgbaImage(this.device, occupation, true) };
    }
    const detail = mapGpuLight() || (occupation?.detail?.n ?? 0) > cap ? undefined : occupation?.detail;
    if (detail !== this.landDetail?.data) {
      releaseImage(this.landDetail?.image);
      this.landDetail = detail && { data: detail, image: rgbaImage(this.device, detail, true) };
    }
    this.forestVersion++;
    this.revision.bump();
    this.request();
  }
  private releaseForest(): void {
    if (!this.forest) return;
    releaseImage(this.forest.texture);
    releaseImage(this.forest.bank);
    releaseImage(this.forest.beach);
    this.forest = undefined;
  }

  /** Synchronous, as the captures below: await variantReady() first where the caller can wait, otherwise a
   * missing pipeline is created synchronously and the readback waits for it (3-4 s for Render v2). */
  captureMap(size = 2048, groundOverlay = false): HTMLCanvasElement {
    if (this.fallback) return this.fallback.captureMap(size, groundOverlay);
    if (!this.look) throw this.unavailable();
    return this.captureRegion({ x: 0, y: 0, width: this.look.mapWidth }, size, false, true, undefined, groundOverlay);
  }
  /** Draws the final look now (a missing pipeline is created synchronously: the next readback of the canvas
   * waits for it). Async callers await variantReady() first. */
  redrawForCapture(): void {
    if (this.fallback) return this.fallback.redrawForCapture();
    if (!this.base || !this.look || this.gpu.lost) throw this.unavailable();
    this.capturing = true;
    try {
      this.draw();
    } finally {
      this.capturing = false;
    }
  }

  /** Fallback display (terrain/fallbackGround.ts): present in the caller's animation frame without entering the
   * capture/readback path. */
  redrawNow(view?: View, width?: number, height?: number, interacting = false, pixelRatio = displayPixelRatio()): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.fallback) this.fallback.redrawNow(view, width, height, interacting, pixelRatio);
    else {
      if (view && width && height) this.view = { view, width, height };
      const state = this.view;
      if (state)
        this.fallbackGround.present(this.canvas, state.view, state.width, state.height, pixelRatio, interacting, (ratio, renderWidth, renderHeight) => {
          this.view = { ...state, width: renderWidth, height: renderHeight };
          try {
            return this.draw(ratio, pixelRatio);
          } finally {
            this.view = state;
          }
        });
    }
  }

  /** Live ground tile (TerrainGl.renderWorldTile): the live redraw's passes for the world square `box` at `px`² device
   * pixels, full quality, on the tile canvas (its own WebGPU context, kept at the tile size), with the tile's own
   * intermediate targets. The display canvas, its fallback presentation and the live view's caches are untouched.
   * The canvas must be copied in this task (the current texture of a WebGPU canvas expires with it). Undefined while
   * a pipeline of the look is being created: never a stand-in, never a synchronous pipeline. */
  renderWorldTile(box: Rect4, px: number): TexImageSource | undefined {
    if (this.fallback) return this.fallback.renderWorldTile(box, px);
    const look = this.look,
      size = box.maxX - box.minX;
    if (this.disposed || this.recovering || this.gpu.lost || !look || !this.base || !(size > 0) || px < 1 || !this.lookCreated(look)) return undefined;
    const surface = this.tileSurface();
    const ratio = liveStyleRatio(),
      previous = this.view,
      details = this.details,
      enhanced = this.enhanced;
    this.view = tileViewState(box, px, ratio);
    this.details = settledDetails(details);
    this.enhanced = enhanced.map(settled);
    this.targets = this.tileTargets;
    this.tileTargets.auxKey.invalidate();
    this.tileTargets.retained.invalidate();
    this.tileRendering = true;
    let drawn = false;
    try {
      drawn = this.draw(ratio, ratio, surface);
    } finally {
      this.tileRendering = false;
      this.targets = this.liveTargets;
      this.view = previous;
      this.details = details;
      this.enhanced = enhanced;
    }
    return drawn ? surface.canvas : undefined;
  }
  /** Changes whenever renderWorldTile would draw other pixels (inputs, created pipelines, style pixel ratio, fall back). */
  contentRevision(): number {
    return this.revision.value() + (this.fallback?.contentRevision() ?? 0);
  }
  /** Every pipeline the look's live redraw uses exists (map, auxiliary pass, blended detail); the river, composite,
   * water and present pipelines are created with the device (prepare). Starts the missing ones asynchronously. */
  private lookCreated(look: TerrainLook): boolean {
    const v = this.lookVariant(look);
    let created = true;
    for (const pass of mapPasses(v)) created = !!this.terrainPipeline(v, pass, 'none', false) && created;
    if (this.details.length) created = !!this.terrainPipeline(v, 'map', 'alpha', false) && created;
    return created;
  }
  private tileSurface(): Surface {
    if (!this.tileCanvas) {
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('webgpu');
      if (!context) throw new Error('WebGPU map: no context for the world tiles.');
      this.tileCanvas = { canvas, context };
    }
    if (this.tileCanvas.device !== this.device) {
      this.tileCanvas.context.configure({ device: this.device, format: this.gpu.canvasFormat, alphaMode: 'opaque' });
      this.tileCanvas.device = this.device;
    }
    return { canvas: this.tileCanvas.canvas, context: this.tileCanvas.context, opaque: true };
  }

  /** The capture canvas (its own WebGPU context), configured for opaque or premultiplied output. */
  private captureSurface(opaque: boolean): Surface {
    if (!this.capture) {
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('webgpu');
      if (!context) throw new Error('Impossible de préparer la capture WebGPU.');
      this.capture = { canvas, context };
    }
    if (this.capture.opaque !== opaque) {
      this.capture.context.configure({ device: this.device, format: this.gpu.canvasFormat, alphaMode: opaque ? 'opaque' : 'premultiplied' });
      this.capture.opaque = opaque;
    }
    return { canvas: this.capture.canvas, context: this.capture.context, opaque };
  }

  /** Render a world-space LOD tile with the same material and detail as the map. */
  captureRegion(region: { x: number; y: number; width: number }, size = 512, includeDetails = true, restoreDisplay = true, height?: HeightLayer, groundOverlay = false, alphaOnly?: Uint8Array): HTMLCanvasElement {
    if (this.fallback) return this.fallback.captureRegion(region, size, includeDetails, restoreDisplay, height, groundOverlay, alphaOnly);
    if (!this.base || !this.look || this.gpu.lost) throw this.unavailable();
    const previous = this.view,
      details = this.details,
      look = this.look,
      enhanced = this.enhanced;
    const capturedHeight = height ? this.upload(height, false) : undefined;
    const output = document.createElement('canvas');
    output.width = output.height = size;
    const context = output.getContext('2d', alphaOnly ? { willReadFrequently: true } : undefined);
    if (!context) throw new Error('Impossible de préparer le style 3D.');
    try {
      this.details = !groundOverlay && includeDetails ? settledDetails(details) : [];
      this.look = captureLook(look, groundOverlay);
      this.enhanced = capturedHeight ? [settled(capturedHeight)] : [];
      this.view = captureViewState(region, size);
      // The ground overlay keeps premultiplied coverage (TerrainGl reads it back from its own target, waiting
      // for the link); the colour capture is opaque, like the WebGL2 canvas it is copied from.
      const surface = this.captureSurface(!groundOverlay);
      // Every capture needs the requested look, including the opaque whole-map background.
      // A stand-in copied here would otherwise remain cached by the 3D view after compilation.
      this.draw(1, includeDetails ? displayPixelRatio() : 1, surface, true);
      context.drawImage(surface.canvas, 0, 0);
      if (alphaOnly) {
        const rgba = context.getImageData(0, 0, size, size).data;
        for (let i = 0; i < size * size; i++) alphaOnly[i] = rgba[i * 4 + 3];
      }
    } finally {
      this.view = previous;
      this.details = details;
      this.look = look;
      this.enhanced = enhanced;
      this.release(capturedHeight);
      if (restoreDisplay) this.draw();
    }
    return output;
  }

  /** Canonical 1 m water samples with a caller-supplied world-space halo. */
  captureWaterMask(region: { x: number; y: number; width: number }): Uint8Array {
    if (this.fallback) return this.fallback.captureWaterMask(region);
    const n = Math.round(region.width),
      alpha = new Uint8Array(n * n);
    const look = this.look;
    if (look && styleTraits(look.style).waterAlwaysDrawn) this.look = { ...look, layers: { ...look.layers, water: true } };
    try {
      this.captureRegion(region, n, false, false, undefined, true, alpha);
    } finally {
      this.look = look;
    }
    return alpha;
  }

  createSurfaceSampler(): SurfaceSample | undefined {
    if (this.fallback) return this.fallback.createSurfaceSampler();
    if (!this.base || !this.look) return undefined;
    return this.surface.sampler(this.base.layer, this.details[this.details.length - 1]?.layer, this.look);
  }

  /** Height (metres) the renderer shows at a world point, from the finest layer covering it. */
  heightAt(x: number, y: number): number | undefined {
    if (this.fallback) return this.fallback.heightAt(x, y);
    return heightAt(this.details, this.base, this.look?.floor ?? 0, x, y);
  }

  private lookVariant(look: TerrainLook): TerrainVariant {
    return lookVariant(look, !!this.forest);
  }
  private terrainPipeline(v: TerrainVariant, pass: 'map' | 'aux', blend: 'none' | 'alpha', wait: boolean): GPURenderPipeline | undefined {
    return this.gpu.pipeline(this.gpu.terrainKey(v, pass, blend), () => this.gpu.terrainDescriptor(v, pass, blend), wait);
  }
  /** The look's map variant once created; meanwhile the last drawn variant (or the preview) stands in. */
  private mapVariant(look: TerrainLook, wait: boolean): { variant: TerrainVariant; pipeline: GPURenderPipeline } | undefined {
    const target = this.lookVariant(look),
      pipeline = this.terrainPipeline(target, 'map', 'none', wait);
    if (pipeline) {
      this.prewarmLikely();
      return { variant: (this.lastVariant = target), pipeline };
    }
    for (const v of [this.lastVariant, PREVIEW_VARIANT]) {
      const standIn = this.terrainPipeline(v, 'map', 'none', false);
      if (standIn) return { variant: v, pipeline: standIn };
    }
    return undefined;
  }
  private prewarmStarted = false;
  /** Once the requested look is drawn, prepare the likely next ones while the page is idle: the Satellite map
   * pipelines (the heaviest look), then its 3D ground. Never before the requested look: a heavy compilation started
   * first delays it. A hit makes the later switch or 3D opening immediate; a miss costs background compiler time. */
  private prewarmLikely(): void {
    if (this.prewarmStarted || this.capturing) return;
    this.prewarmStarted = true;
    // No speculative heavy pipelines (nor a second 3D device) on an integrated/software GPU or after a loss.
    if (!speculativePrewarmAllowed()) return;
    whenIdle(async () => {
      const gpu = this.gpu;
      if (this.disposed || gpu.lost) return;
      const satellite = SATELLITE_VARIANT;
      const keys = mapPasses(satellite).map(pass => {
        this.terrainPipeline(satellite, pass, 'none', false);
        return gpu.terrainKey(satellite, pass, 'none');
      });
      await Promise.all(keys.map(key => gpu.settled(key)));
      if (this.disposed || gpu.lost || rendererOverride() === 'webgl') return;
      // The 3D view's Satellite ground (same Render v2 material, forest on): its own device, created here if needed.
      (await import('./terrain3dGpu')).prewarmTerrain3dGround(1, 1, 0);
    });
  }
  /** Pipeline keys of a look (map, auxiliary pass if any, blended map if detail layers are shown); starts
   * creating them. */
  private lookKeys(look: TerrainLook): string[] {
    const v = this.lookVariant(look),
      passes: ['map' | 'aux', 'none' | 'alpha'][] = hasAuxPass(v)
        ? [
            ['map', 'none'],
            ['aux', 'none'],
          ]
        : [['map', 'none']];
    if (this.details.length) passes.push(['map', 'alpha']);
    return passes.map(([pass, blend]) => {
      this.terrainPipeline(v, pass, blend, false);
      return this.gpu.terrainKey(v, pass, blend);
    });
  }
  /** Resolves once the current look's pipelines are created, without blocking: callers that can wait
   * (3D material tiles, illustration and export captures) capture after it, so the synchronous capture
   * finds every pipeline. Also waits for a device recovery in progress. */
  async variantReady(): Promise<void> {
    for (;;) {
      if (this.recovering) await this.recovering;
      if (this.fallback) return this.fallback.variantReady();
      if (!this.look || this.disposed || this.gpu.lost) return;
      const gpu = this.gpu,
        keys = this.lookKeys(this.look);
      const ready = await Promise.all(keys.map(key => gpu.settled(key)));
      if (gpu !== this.gpu || gpu.lost) continue; // device lost or recreated meanwhile
      if (!this.look || this.lookKeys(this.look).join() === keys.join()) {
        if (!ready.every(Boolean)) console.warn('WebGPU map: a pipeline of the look failed; the stand-in stays.');
        return;
      }
    }
  }

  private request(): void {
    this.fallbackGround.invalidate(this.canvas);
    if (this.disposed || this.frame || this.fallback || this.livePaused) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** The look block (lookParams.ts) into terrainParams and the current texture record. */
  private paramBindings(): LookBindings {
    const p = this.terrainParams;
    const viewOf = (texture: LookTexture): GPUTextureView => {
      const empty = this.empty.view;
      switch (texture) {
        case 'refined':
          return this.enhanced.at(-1)?.view ?? empty;
        case 'previousRefined':
          return this.enhanced.at(-2)?.view ?? empty;
        case 'coast':
          return this.coastDistance?.view ?? empty;
        case 'lake':
          return this.lake?.view ?? empty;
        case 'overlay':
          return this.overlay?.view ?? empty;
        case 'emptyAux':
          return this.emptyUint.view;
      }
    };
    return {
      int: (name, v) => p.int(name, v),
      uint: (name, v) => p.uint(name, v),
      float: (name, v) => p.float(name, v),
      vec2: (name, x, y) => p.vec2(name, x, y),
      vec3: (name, x, y, z) => p.vec3(name, x, y, z),
      vec4: (name, x, y, z, w) => p.vec4(name, x, y, z, w),
      floats: (name, size, values) => p.floats(name, size, values),
      texture: (name, _unit, texture) => {
        this.textures[name] = viewOf(texture);
      },
      sampler: () => {},
      forest: enabled => {
        const field = enabled ? this.forest : undefined,
          applied = this.occupation,
          empty = this.empty.view,
          textures = this.textures;
        textures.uForestField = field?.texture.view ?? empty;
        p.vec3('uForestRect', field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
        textures.uForestBank = field?.bank?.view ?? empty;
        p.int('uHasForestBank', field?.bank ? 1 : 0);
        p.float('uForestBankDensity', field?.field.bankDensity ?? 1);
        const beach = field?.field.beach;
        textures.uForestBeach = field?.beach?.view ?? empty;
        p.int('uHasForestBeach', field?.beach ? 1 : 0);
        p.vec3('uForestBeachRect', beach?.x ?? 0, beach?.y ?? 0, beach?.width ?? 1);
        textures.uOccupation = applied?.image.view ?? empty;
        p.int('uHasOccupation', applied ? 1 : 0);
        p.vec3('uOccupationRect', applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
        p.float('uOccupationN', applied?.data.n ?? 1);
      },
      landDetail: () => {
        const detail = this.landDetail;
        this.textures.uLandDetail = detail?.image.view ?? this.empty.view;
        p.int('uHasLandDetail', detail ? 1 : 0);
        p.vec3('uLandDetailRect', detail?.data.x ?? 0, detail?.data.y ?? 0, detail?.data.width ?? 1);
        p.float('uLandDetailN', detail?.data.n ?? 1);
      },
      // Shore ring and relief light (rgba16float: shore distance, openness, sky occlusion, horizon tangent toward
      // the light); a new light azimuth re-bakes the last channel off the frame path and bumps the revision.
      shoreRing: mode => {
        if (mode >= 2 && this.base) {
          const pixels = shoreRingPixels(this.base.layer, this.look!.lighting.azimuth, this.ringChanged);
          if (this.shoreRing?.layer !== this.base.layer || this.shoreRing.revision !== pixels.revision) {
            releaseImage(this.shoreRing?.image);
            const grid = pixels.grid;
            this.shoreRing = { layer: this.base.layer, revision: pixels.revision, image: gpuImage(this.device, grid.n, grid.n, 'rgba16float', pixels.half, 8), x: grid.x, y: grid.y, width: grid.width };
          }
        }
        this.textures.uShoreRing = this.shoreRing?.image.view ?? this.empty.view;
        p.vec3('uShoreRingRect', this.shoreRing?.x ?? 0, this.shoreRing?.y ?? 0, this.shoreRing?.width ?? 1);
      },
      brushes: (enabled, crownDetail) => {
        this.textures.uForestBrushAtlas = this.brushAtlas.bind(enabled, crownDetail);
        p.int('uCrownClumps', this.brushAtlas.crownClumps);
      },
      seasonCalendar: (zone, calendar) => setSeasonCalendarGpu(p, zone, calendar),
    };
  }
  /** The look block into `record` (every texture reset to its empty binding first). Returns uRefinedAlpha. */
  private writeLook(record: Record<string, GPUTextureView>, state: LookParamsState): number {
    const empty = this.empty.view;
    for (const name of TERRAIN_TEXTURES) record[name] = empty;
    record.uForestBrushAtlas = this.brushAtlas.placeholder;
    record.uAux = this.emptyUint.view;
    this.textures = record;
    return writeLookParams(this.params, state);
  }
  private terrainBindGroup(): GPUBindGroup {
    const entries = this.terrainEntries,
      textures = this.textures;
    entries[0].resource = this.slot(this.terrainParams);
    for (let i = 0; i < TERRAIN_TEXTURES.length; i++) entries[3 + i].resource = textures[TERRAIN_TEXTURES[i]];
    return this.device.createBindGroup({ layout: this.gpu.layouts.terrain, entries });
  }
  private readonly quad = [0, 0, 0, 0];
  /** One height layer (TerrainGl.drawLayer); details need the variant's blending pipeline. Returns true while it fades. */
  private drawLayer(encoderPass: GPURenderPassEncoder, layer: GpuHeightLayer, base: boolean, pipeline: GPURenderPipeline | undefined, frame: RedrawFrame, now: number): boolean {
    const p = this.terrainParams;
    this.textures.uField = layer.view;
    this.textures.uCave = layer.caveView ?? this.empty.view;
    writeFieldParams(p, layer, base);
    let fading = false;
    if (base) {
      p.float('uAlpha', 1);
      p.vec4('uQuad', 0, 0, frame.width, frame.height);
    } else {
      const alpha = fadeProgress(now, layer.fadeStart);
      fading = alpha < 1;
      p.float('uAlpha', 1 - (1 - alpha) ** 2);
      const q = detailQuad(layer.layer, frame, this.quad);
      p.vec4('uQuad', q[0], q[1], q[2], q[3]);
    }
    if (!pipeline) return fading;
    encoderPass.setPipeline(pipeline);
    encoderPass.setBindGroup(0, this.terrainBindGroup());
    encoderPass.draw(4);
    return fading;
  }

  /** One redraw (passes in terrain/redraw.ts) of `this.view` onto the display canvas, or onto `capture`. */
  private draw(pixelRatio = displayPixelRatio(), stylePixelRatio = pixelRatio, capture?: Surface, waitCapture = false): boolean {
    // A world tile leaves the display canvas as it is: its CSS-transformed preview stays valid.
    if (!this.tileRendering) this.fallbackGround.invalidate(this.canvas);
    const look = this.look,
      state = this.view,
      device = this.device;
    if (this.disposed || !look || !state || !this.base || this.gpu.lost) return false;
    const quality = displayQualityUniform(!(this.capturing || capture !== undefined || waitCapture || look.mesh3d === true));
    const wait = this.capturing || waitCapture;
    const chosen = this.mapVariant(look, wait);
    if (!chosen) return false;
    const started = performance.now();
    const dpr = pixelRatio,
      frame = redrawFrame(state, dpr),
      { width, height } = frame;
    const surface: Surface = capture ?? { canvas: this.canvas, context: this.context, opaque: true };
    if (surface.canvas.width !== width || surface.canvas.height !== height) {
      surface.canvas.width = width;
      surface.canvas.height = height;
    }
    const palettes = lookPalettes(look),
      v = this.lookVariant(look),
      p = this.terrainParams,
      targets = this.targets;
    this.slots.used = 0;
    const encoder = device.createCommandEncoder({ label: 'terrain map' });
    const mapTarget = (targets.map = gpuTarget(device, width, height, MAP_FORMAT, targets.map));
    const params: LookParamsState = {
      look,
      quality,
      frame,
      stylePixelRatio,
      dpr,
      scale: state.view.scale,
      palettes,
      mode: lookMode(look),
      forest: v.forest,
      base: this.base.layer,
      refined: this.enhanced.at(-1),
      previousRefined: this.enhanced.at(-2),
      coastal: !!this.coastDistance,
      sea: this.seaSurface,
      lake: this.lake ? this.lakeMode : 0,
      lakeN: this.lakeN,
      overlay: !!this.overlay,
      city: this.retainedWater.city,
    };
    let animating = this.writeLook(this.mapTextures, params) < 1;
    const now = performance.now();
    const water: GpuWaterPass = {
      device,
      gpu: this.gpu,
      encoder,
      slot: this.slot,
      targets,
      look,
      frame,
      stylePixelRatio,
      water: palettes.water,
      painted: paintedWaterLook(look) && !look.groundCapture,
      band: waterBand(look, this.seaSurface, palettes.water),
      wait,
      empty: this.empty.view,
      lake: this.lake,
      lakeMode: this.lakeMode,
      lakeN: this.lakeN,
      overlay: this.overlay,
      riverParams: this.riverParams,
      waterParams: this.waterParams,
    };
    const rivers = { buffer: this.riverBuffer, count: this.riverCount, regime: this.riverRegime };
    const separateWater = separateWaterLayer(look, v.forest);
    p.int('uUseWaterLayer', 0);
    if (separateWater) {
      const waterTarget = (targets.water = gpuTarget(device, width, height, MAP_FORMAT, targets.water));
      writeWaterLayerParams(p);
      const waterPass = beginPass(encoder, waterTarget, true, 'water layer');
      this.drawLayer(waterPass, this.base, true, chosen.pipeline, frame, now);
      waterPass.end();
      renderRivers(water, rivers, waterTarget);
      renderRetainedWater(water, this.retainedWater, waterTarget);
      writeMapParamsAfterWaterLayer(p, look, !!this.overlay);
      this.mapTextures.uWaterLayer = waterTarget.view;
      p.int('uUseWaterLayer', 1);
    }
    // Auxiliary pass (TerrainGl.renderAux): rendered only when its inputs changed.
    if (hasAuxPass(v)) {
      const aux = this.terrainPipeline(v, 'aux', 'none', wait);
      if (targets.aux?.width !== width || targets.aux.height !== height) targets.auxKey.invalidate();
      if (aux) {
        const key = targets.auxKey.scratch();
        key.length = 0;
        key.push(quality, width, height, frame.origin, frame.px, look.seed, look.climate, look.lighting, look.v2Season, look.v2Calendar, look.layers, look.refinement3d, look.mesh3d, look.style, look.waterLook);
        key.push(this.forestVersion, this.riverCount, this.retainedWater.key, this.lakeN, separateWater, this.base.layer.width, this.base.layer.n, this.enhanced.at(-1)?.fadeStart, this.coastDistance ? 1 : 0);
        if (targets.auxKey.changed()) {
          targets.aux = gpuTarget(device, width, height, 'rgba32uint', targets.aux);
          const saved = (this.savedParams ??= new Uint8Array(p.bytes.length));
          saved.set(p.bytes);
          this.writeLook(this.auxTextures, params);
          this.auxTextures.uWaterLayer = this.mapTextures.uWaterLayer;
          p.int('uUseWaterLayer', separateWater ? 1 : 0);
          const auxPass = beginPass(encoder, targets.aux, true, 'auxiliary');
          this.drawLayer(auxPass, this.base, true, aux, frame, now);
          auxPass.end();
          p.bytes.set(saved);
          this.textures = this.mapTextures;
          targets.auxKey.store();
        }
      }
      this.mapTextures.uAux = aux && targets.aux ? targets.aux.view : this.emptyUint.view;
      p.int('uHasAux', aux ? 1 : 0);
    }
    const mapPass = beginPass(encoder, mapTarget, true, 'map');
    this.drawLayer(mapPass, this.base, true, chosen.pipeline, frame, now);
    if (this.details.length) {
      const blended = this.terrainPipeline(chosen.variant, 'map', 'alpha', wait);
      for (const detail of this.details) animating = this.drawLayer(mapPass, detail, false, blended, frame, now) || animating;
    }
    mapPass.end();
    this.details = dropHiddenDetails(this.details, now, releaseGpuLayer);
    if (!separateWater) {
      renderRivers(water, rivers, mapTarget);
      renderRetainedWater(water, this.retainedWater, mapTarget);
    }
    // Present: GL rows flipped onto the canvas.
    const present = this.gpu.pipeline(PRESENT_KEYS[+surface.opaque], () => this.gpu.presentDescriptor(surface.opaque), true)!;
    const presentPass = encoder.beginRenderPass({ label: 'present', colorAttachments: [{ view: surface.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    presentPass.setPipeline(present);
    presentPass.setBindGroup(0, device.createBindGroup({ layout: present.getBindGroupLayout(0), entries: [{ binding: 0, resource: mapTarget.view }] }));
    presentPass.draw(4);
    presentPass.end();
    device.queue.writeBuffer(this.slots.buffer, 0, this.slots.staging, 0, Math.max(4, this.slots.used));
    device.queue.submit([encoder.finish()]);
    this.gpuDrawMs = performance.now() - started;
    if (animating) this.request();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.unlistenQuality?.();
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.gpu.listeners.delete(this.redraw);
    this.gpu.lostListeners.delete(this.onLost);
    if (this.fallback) {
      this.fallback.dispose();
      return;
    }
    this.liveTargets.dispose();
    this.tileTargets.dispose();
    this.tileCanvas?.context.unconfigure();
    this.release(this.base);
    this.details.forEach(releaseGpuLayer);
    this.enhanced.forEach(releaseGpuLayer);
    for (const image of [this.lake, this.overlay, this.coastDistance, this.shoreRing?.image, this.occupation?.image, this.landDetail?.image, this.empty, this.emptyUint]) releaseImage(image);
    this.brushAtlas.dispose();
    this.releaseForest();
    this.riverBuffer?.destroy();
    this.slots.buffer.destroy();
    this.context.unconfigure();
    this.capture?.context.unconfigure();
  }
}
