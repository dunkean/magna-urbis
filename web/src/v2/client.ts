import EngineWorker from './engine.worker?worker';
import { runtimeWorkerOptions } from './platform';
import { RenderReadiness } from '../render/renderReadiness';
import { getLanguage } from './i18n';
import { getDistanceUnit } from './units';
import RenderWorker from '../ui/renderWorker?worker';
import { internTerrain } from './terrainIntern';
import { internLocalEdit } from './localEditIntern';
import { createViewer, type Viewer } from '../ui/viewer';
import { createCanvasRenderer, type CanvasRenderer } from '../render/canvas';
import { displayWorld } from '../render/displayWorld';
import { liveDevicePixelRatio } from '../render/displayQuality';
import type { World } from '../gen/types';
import type { V2Settings, V2Progress, V2TownStage, V2WorkerResponse } from './contracts';
import type { ResourcePayload } from '../../../rust/bridge/resources';
import type { DisplayOpts, RResponse } from '../ui/protocol';
import { generationWorldInput } from './workerWorld';
import { renderProjection } from './renderProjection';
import { packWorldLanduse, unpackWorldLanduse } from './landusePack';
import { packWorldPartitions, unpackWorldPartitions } from './urbanPack';
import { sameDisplay } from './displayState';
import type { BenchRenderer } from './benchRenderer';
import type { MinimalRenderer } from './minimalRenderer';
import { resolveSettingsAppearance, resolvedDisplayOptions } from './appearance';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { prefersCpuSatelliteGround } from './machineTier';
import type { FrameRequest } from '../ui/viewer';
import type { ExportLayers } from '../render/exportLayers';
import type { MapPick } from './display/composedView';
import { screenToWorld } from '../render/view';
import type { ExportFrame } from './display/exactFrame';
import { createCameraPose, groundPoint, isTilted, poseCamera } from '../render/world/camera';
import { publishWasmThreads, wasmWorkerFailed, wasmWorkerOptions } from '../../../rust/bridge/wasmThreads';
import { loadRenderGeometry, renderGeometryReady } from '../../../rust/bridge/renderGeometry';
import { mapPresentation } from './mapPresentation';
import { ensureDesktopNeuralServer } from './desktopNeural';
import { prepareBrowserNeuralDownload } from './neuralDownload';
import { browserRuntimeSettings, engineIdentityOf, runtimeForRun, RuntimeFallbackState, type ServiceCapabilities } from './runtimeChoices';
import { markNativeUnavailable } from '../../../rust/bridge/nativeAvailability';
import { reportDrawnLabels } from './drawnLabels';

/** Delay of the miniature after a new live frame (its first frame must not wait for it). */
const MINI_DELAY_MS = 350;
/** Interval of the renderer diagnostics written on the canvas while frames follow each other (noteBenchStats). */
const BENCH_STATS_MS = 250;

export type Action = 'terrain' | 'region' | 'roads' | 'towns' | 'town' | 'settlements' | 'all';

/** The world input of an engine request: a retained id, or the world with its town partitions packed. */
function packedWorldInput(action: Action, world: World | undefined, retained?: { id: number; world: World }): { input: ReturnType<typeof generationWorldInput>; transfer: ArrayBuffer[] } {
  const input = generationWorldInput(action, world, retained);
  if (!input.world) return { input, transfer: [] };
  const packed = packWorldPartitions(input.world);
  return { input: { ...input, world: packed.world }, transfer: packed.transfer };
}

/** Delay between replacing the engine worker after a heavy result and unpacking it: the terminated worker's heap is released. */
const HEAVY_RELEASE_MS = 1000;
/** The world without its towns (urban layers, native town snapshots): what a terrain-only request needs. */
function townlessWorld(world: World): World {
  const { v2RustCities: _cities, ...debug } = world.debug ?? {};
  return { ...world, urban: undefined, settlements: world.settlements?.map(({ urban: _urban, ...place }) => place), ...(world.debug ? { debug } : {}) } as World;
}

/** Generation and drawing stay on separate workers; a failed job keeps the previous map. */
export class StudioClient {
  onEngineReset?: () => void;
  // The worker name carries `?threads=`; after a worker death, the single-thread package.
  private engine = new EngineWorker(runtimeWorkerOptions(wasmWorkerOptions('magna-v2')));
  private render: Worker | null = null;
  private syncRenderer: CanvasRenderer | null = null;
  private id = 0;
  private drawingId = 0;
  /** `local`: a local edit of town `key` made from `base` (`internLocalEdit` keeps the unchanged objects of `base`). */
  private pending: { id: number; resolve: (world: World) => void; reject: (error: Error) => void; progress?: (p: V2Progress) => void; local?: { base: World; key: string } } | null = null;
  private neuralDownload?: AbortController;
  /** Lazy resource payload requests (worker message `resources`), and the payload of the last terrain. */
  private resourceRequests = new Map<number, { resolve: (payload: ResourcePayload | undefined) => void; reject: (error: Error) => void }>();
  private resourceCache?: { key: string; payload: Promise<ResourcePayload | undefined> };
  private world: World | null = null;
  private appearanceSettings?: V2Settings;
  private bench?: BenchRenderer;
  private minimal?: MinimalRenderer;
  private minimalActive = false;
  private benchActive = false;
  private appearanceRevision = 0;
  private brushSourcesSent = false;
  private appearanceWork: Promise<void> = Promise.resolve();
  private appearanceRequest = 0;
  private readiness?: RenderReadiness;
  private benchMiniRevision = -1;
  /** One resolution per (settings, world, preview): show() and applyAppearance() share it. */
  private resolutions: { settings: V2Settings; world: World | undefined; preview: boolean; resolved: ResolvedAppearance }[] = [];
  private presentations = new WeakMap<World, { key: string; inputs: unknown[]; world: World }>();
  /** Presentation creates a names product. Its identity changes with its inputs,
   * never merely because the same retained map is shown in another style. */
  private presentWorld(world: World): World {
    const key = JSON.stringify([getLanguage(), getDistanceUnit(), this.appearanceSettings?.naming?.mode, this.appearanceSettings?.naming?.mapLanguage, this.appearanceSettings?.naming?.script]);
    const inputs = [world.terrain, world.roads, world.landuse, world.settlements, world.names, world.options, world.debug, world.urban, world.site, world.stats, world.seed, world.mapSize];
    const hit = this.presentations.get(world);
    if (hit?.key === key && inputs.every((input, i) => input === hit.inputs[i])) return hit.world;
    const shown = mapPresentation(world, this.appearanceSettings);
    this.presentations.set(world, { key, inputs, world: shown });
    return shown;
  }
  private benchMiniSize = 0;
  private benchMiniDue = false;
  private benchMiniTimer?: ReturnType<typeof setTimeout>;
  /** Intermediate invalidations may redraw the live map while its new look is still compiling. */
  private benchPreparing = 0;
  /** Latest show(): a show still awaiting its renderer (bench set-up, geometry, worker) never installs an older look over a newer one. */
  private showRequest = 0;
  /** The bench set() in flight, if any. */
  private benchSetting?: Promise<void>;
  private retained?: { id: number; world: World };
  private pendingDraw: { gen: number; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private display: DisplayOpts = { style: 'parchment', contours: true, landuse: true, labels: true, legend: false, cartouche: false };
  readonly viewer: Viewer;
  constructor(
    private canvas: HTMLCanvasElement,
    container: HTMLElement,
    minimap: HTMLCanvasElement,
    private onProgress: (p: V2Progress) => void,
    private onError: (e: Error) => void,
    onView?: () => void,
  ) {
    this.viewer = createViewer({ canvas, container, minimap, onError, onView });
    this.attachEngine();
  }
  private interned(pending: NonNullable<StudioClient['pending']>, message: Extract<V2WorkerResponse, { type: 'result' | 'local-result' }>): World {
    if (message.type === 'local-result') {
      if (pending.local?.key !== message.delta.key) throw new Error('Local edit result does not match its requested town.');
      return internLocalEdit(pending.local.base, message.delta);
    }
    return internTerrain(this.world, unpackWorldPartitions(unpackWorldLanduse(message.world)));
  }
  private attachEngine(): void {
    this.engine.onmessage = ({ data: m }) => {
      if (m.type !== 'progress') publishWasmThreads(m.wasm);
      const lazy = this.resourceRequests.get(m.id);
      if (lazy) {
        this.resourceRequests.delete(m.id);
        if (m.type === 'resources') lazy.resolve(m.payload);
        else if (m.type === 'error') lazy.reject(new Error(m.error));
        return;
      }
      if (m.id !== this.pending?.id) return;
      if (m.type === 'progress') {
        if (m.progress.stage === 'runtime-fallback') {
          if (m.progress.detail) markNativeUnavailable(m.progress.detail);
          if (this.runtimePreference) this.recordRuntime(browserRuntimeSettings(this.runtimePreference));
        } else (this.pending!.progress ?? this.onProgress)(m.progress);
      } else if ((m.type === 'result' || m.type === 'local-result') && m.heavy) {
        // A heavy town: free the worker's copy (its whole heap) before materialising the page's, then unpack.
        const p = this.pending!;
        this.pending = null;
        this.replaceEngine();
        void import('../render/cityBuildingsParallel').then(
          module => module.releaseCityBuildingWorkers(),
          () => undefined,
        );
        setTimeout(() => {
          try {
            p.resolve(this.interned(p, m));
          } catch (error) {
            p.reject(error instanceof Error ? error : new Error(String(error)));
          }
        }, HEAVY_RELEASE_MS);
      } else if (m.type === 'result' || m.type === 'local-result') {
        const p = this.pending!;
        this.pending = null;
        try {
          const world = this.interned(p, m);
          this.retained = { id: m.id, world };
          p.resolve(world);
        } catch (error) {
          this.retained = undefined;
          p.reject(error instanceof Error ? error : new Error(String(error)));
        }
      } else if (m.type === 'error') {
        const p = this.pending!;
        this.pending = null;
        p.reject(new Error(m.error));
      }
    };
    this.engine.onerror = e => {
      this.failResources(new Error(e.message || 'engine worker error'));
      wasmWorkerFailed(e.message || 'engine worker error');
      this.pending?.reject(new Error(e.message || 'Le moteur de génération a été interrompu.'));
      this.pending = null;
      this.retained = undefined;
      this.engine.terminate();
      this.engine = new EngineWorker(runtimeWorkerOptions(wasmWorkerOptions('magna-v2')));
      this.attachEngine();
      this.onEngineReset?.();
    };
  }
  /** A fresh engine worker in place of the current one (its retained world and native session caches are dropped). */
  private replaceEngine(): void {
    this.failResources(new Error('The generation worker was replaced.'));
    this.retained = undefined;
    this.engine.terminate();
    this.engine = new EngineWorker(runtimeWorkerOptions(wasmWorkerOptions('magna-v2')));
    this.attachEngine();
  }
  async init(): Promise<void> {
    // Composite and Minimal own their surfaces; start the classic worker only when it is actually selected.
    if (!this.appearanceSettings || this.resolve(this.appearanceSettings, this.world ?? undefined, true).path !== 'classic') return;
    let render: Worker;
    try {
      render = new RenderWorker();
    } catch {
      return;
    }
    const ready = await new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => resolve(false), 5000);
      render.onmessage = ({ data }: MessageEvent<RResponse>) => {
        if (data.type === 'ready') {
          clearTimeout(timeout);
          resolve(data.ok);
        }
      };
      render.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
      render.postMessage({ type: 'init', dpr: liveDevicePixelRatio() });
    });
    if (!ready) {
      render.terminate();
      return;
    }
    this.render = render;
    this.brushSourcesSent = false;
    this.viewer.setSource({ request: frame => render.postMessage({ type: 'view', ...frame }) });
    render.onmessage = ({ data: m }: MessageEvent<RResponse>) => {
      if (this.benchActive || this.minimalActive) {
        if (m.type === 'frame') this.viewer.present(m, false);
        return;
      }
      if (m.type === 'content') this.viewer.contentChanged(m.mapSize, true, m.marker);
      else if (m.type === 'frame') {
        const shown = this.viewer.present(m, m.gen === this.drawingId);
        if (shown) {
          reportDrawnLabels(m.labels.map(label => label.id));
          this.canvas.dataset.renderer = 'Classic Canvas';
          this.canvas.dataset.renderStyle = this.display.style;
          this.canvas.dataset.cityRender = '{}';
        }
        if (shown && m.gen === this.pendingDraw?.gen) {
          clearTimeout(this.pendingDraw.timer);
          this.pendingDraw.resolve();
          this.pendingDraw = null;
        }
      } else if (m.type === 'error') {
        const error = new Error(m.error);
        if (this.pendingDraw) {
          clearTimeout(this.pendingDraw.timer);
          this.pendingDraw.reject(error);
          this.pendingDraw = null;
        } else this.onError(error);
      }
    };
    render.onerror = e => {
      const error = new Error(e.message || 'Le rendu de la carte a été interrompu.');
      if (this.pendingDraw) {
        clearTimeout(this.pendingDraw.timer);
        this.pendingDraw.reject(error);
        this.pendingDraw = null;
      } else this.onError(error);
    };
    render.postMessage({ type: 'display', display: this.display });
    if (this.display.painted) {
      this.brushSourcesSent = true;
      const { BRUSH_SOURCES } = await import('../render/assets/brushAssets');
      render.postMessage({ type: 'brushes', sources: BRUSH_SOURCES });
    }
  }
  /** The engine in use changed (native ⇄ browser): Settings shows it; no notice is raised. */
  onRuntimeStatusChange?: () => void;
  runtimeCapabilities?: () => ServiceCapabilities;
  /** Resolves when the startup service probe is done: a run started earlier waits for it to choose its backends. */
  capabilitiesReady?: () => Promise<unknown>;
  readonly runtimeFallback = new RuntimeFallbackState();
  private runtimePreference?: V2Settings;
  private recordRuntime(effective: V2Settings): void {
    if (this.runtimePreference) this.runtimeFallback.update(this.runtimePreference, effective);
    this.onRuntimeStatusChange?.();
  }
  run(
    action: Action,
    settings: V2Settings,
    world?: World,
    key?: string,
    townStage?: V2TownStage,
    terrainStage?: string,
    keys?: string[],
    cityOutput?: string,
    progress?: (p: V2Progress) => void,
    keepUrbanLanes = false,
    roadEdit?: 'access' | 'rebuild',
    localEdit = false,
  ): Promise<World> {
    if (this.pending) return Promise.reject(new Error('Un calcul est déjà en cours.'));
    // The display's code and GPU preparation do not depend on the result: load them while the engine computes.
    if (this.resolve(settings, world, true).path !== 'minimal') {
      void import('./benchRenderer').catch(() => undefined);
      if (!prefersCpuSatelliteGround() || this.resolve(settings, world, true).ground.traits.satelliteVariant === 0) {
        void import('../ui/terrainRenderer').then(
          module => module.prewarmTerrainRenderer(),
          () => undefined,
        );
      }
      if (['town', 'towns', 'all'].includes(action))
        void import('../render/cityBuildingsParallel').then(
          module => module.prewarmCityBuildingWorkers(),
          () => undefined,
        );
    }
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, progress, ...(localEdit && world && key ? { local: { base: world, key } } : {}) };
      this.runtimePreference = { ...settings, runtime: settings.runtime && { ...settings.runtime }, urban: settings.urban && { ...settings.urban } };
      const dispatch = async () => {
        if (this.runtimeCapabilities && !this.runtimeCapabilities().checked) await this.capabilitiesReady?.();
        const selected = await runtimeForRun(settings, this.runtimeCapabilities?.(), action);
        if (this.pending?.id !== id) return;
        settings = selected.settings;
        this.recordRuntime(selected.nativeOffline ? settings : this.runtimePreference!);
        selected.notes.forEach(label => (progress ?? this.onProgress)({ stage: 'runtime-info', label, completed: 0, total: 0 }));
        if (['terrain', 'all'].includes(action) && settings.runtime?.source === 'neural-wasm' && !settings.options.importedHeight && !settings.decor && !settings.terrain?.sketch?.processing) {
          const controller = new AbortController();
          this.neuralDownload = controller;
          try {
            await prepareBrowserNeuralDownload(new URL(settings.runtime.neuralAssets ?? './neural/', document.baseURI).href, controller.signal, event => (progress ?? this.onProgress)(event), settings.runtime.compute);
          } finally {
            if (this.neuralDownload === controller) this.neuralDownload = undefined;
          }
        }
        if (['terrain', 'all'].includes(action) && settings.runtime?.source === 'neural' && !settings.options.importedHeight && !settings.decor && !settings.terrain?.sketch?.processing) {
          const neuralServer = await ensureDesktopNeuralServer(settings.runtime.neuralServer ?? 'http://127.0.0.1:8792', label => this.onProgress({ stage: 'neural-startup', label, completed: 0, total: 0 }));
          settings = { ...settings, runtime: { ...settings.runtime, neuralServer } };
        }
        // Cancellation may have replaced the worker while native weights were loading.
        if (this.pending?.id !== id) return;
        // A resent world carries its town partitions packed (copies: the page keeps its objects).
        const sent = packedWorldInput(action, world, this.retained);
        this.engine.postMessage({ id, action, settings, ...sent.input, key, keys, townStage, terrainStage, cityOutput, keepUrbanLanes, roadEdit, localEdit, assetBase: document.baseURI }, sent.transfer);
      };
      void dispatch().catch(error => {
        if (this.pending?.id === id) {
          this.pending = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
  cancel(): void {
    this.neuralDownload?.abort();
    if (!this.pending) return;
    this.pending.reject(new DOMException('Calcul annulé. La carte précédente est conservée.', 'AbortError'));
    this.pending = null;
    this.retained = undefined;
    this.engine.terminate();
    this.engine = new EngineWorker(runtimeWorkerOptions(wasmWorkerOptions('magna-v2')));
    this.attachEngine();
    // Requests of the terminated worker never answer: settle them instead of caching a promise that hangs.
    this.failResources(new DOMException('Computation cancelled.', 'AbortError'));
    this.onEngineReset?.();
  }
  private failResources(error: Error): void {
    for (const request of this.resourceRequests.values()) request.reject(error);
    this.resourceRequests.clear();
    this.resourceCache = undefined;
  }
  /** Resource payload of the world's terrain, fetched once per terrain (lazily: only when a resource layer is drawn). */
  resources(world: World): Promise<ResourcePayload | undefined> {
    const settings = this.appearanceSettings;
    if (!settings) return Promise.resolve(undefined);
    const key = JSON.stringify([world.stats['v2.terrainKey'] ?? null, world.stats['v2.waterEditRevision'] ?? 0, world.mapSize, world.seed, settings.runtime?.backend, engineIdentityOf(settings)]);
    if (this.resourceCache?.key === key) return this.resourceCache.payload;
    const id = ++this.id;
    const payload = new Promise<ResourcePayload | undefined>((resolve, reject) => {
      this.resourceRequests.set(id, { resolve, reject });
      // Resources read the terrain only: a world the worker does not hold goes without its towns.
      try {
        const sent = packedWorldInput('region', world === this.retained?.world ? world : townlessWorld(world), this.retained);
        this.engine.postMessage({ type: 'resources', id, settings, ...sent.input }, sent.transfer);
      } catch (error) {
        this.resourceRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.resourceCache = { key, payload };
    payload.catch(() => {
      if (this.resourceCache?.payload === payload) this.resourceCache = undefined;
    });
    return payload;
  }
  /** End a background pass without dropping the worker's retained map. FIFO behind its last batch. */
  releaseUrbanLanes(): void {
    this.engine.postMessage({ type: 'release-urban-lanes' });
  }
  /** Imported projects replace the old worker source; release its heavyweight archives. */
  invalidateRetained(): void {
    this.retained = undefined;
    this.engine.postMessage({ type: 'release' });
  }
  async clear(): Promise<void> {
    this.viewer.clear();
    this.minimalActive = false;
    this.minimal?.dispose();
    this.minimal = undefined;
    this.resolutions = [];
    this.presentations = new WeakMap();
    this.resourceCache = undefined;
    this.benchActive = false;
    this.appearanceRevision++;
    this.bench?.dispose();
    this.bench = undefined;
    this.benchSetting = undefined;
    this.invalidateRetained();
    this.world = null;
    this.syncRenderer?.dispose();
    this.syncRenderer = null;
    if (this.pendingDraw) {
      clearTimeout(this.pendingDraw.timer);
      this.pendingDraw.resolve();
      this.pendingDraw = null;
    }
    this.render?.terminate();
    this.render = null;
    await this.init();
  }
  async show(world: World, keepView = false, requested?: RenderReadiness): Promise<void> {
    const nextRequest = requested ?? new RenderReadiness('2d');
    this.readiness = nextRequest;
    // A preference redraw (language, units) or a new world may start while a style switch is still preparing its
    // renderer: whichever show() started last owns the map, an older one returns once its await is over.
    const showRequest = ++this.showRequest,
      superseded = (): boolean => showRequest !== this.showRequest;
    const mapChanged = this.world?.mapSize !== world.mapSize;
    // The same map again (another stage of its generation, an edit, a redraw): the camera stays where the user put it.
    if (this.world && this.world.seed === world.seed && !mapChanged) keepView = true;
    if (this.world !== world) {
      this.benchMiniRevision = -1;
      this.resolutions = [];
      if (this.world?.stats['v2.terrainKey'] !== world.stats['v2.terrainKey']) this.resourceCache = undefined;
    }
    this.world = world;
    // A language/unit change redraws the same retained world with different labels.
    this.benchMiniRevision = -1;
    const minimalSettings = this.appearanceSettings;
    const minimalAppearance = minimalSettings && this.resolve(minimalSettings, world, true);
    if (minimalSettings && minimalAppearance?.path === 'minimal') {
      this.benchActive = false;
      this.bench?.dispose();
      this.bench = undefined;
      this.benchSetting = undefined;
      this.syncRenderer?.dispose();
      this.syncRenderer = null;
      this.render?.terminate();
      this.render = null;
      const { MinimalRenderer } = await import('./minimalRenderer');
      if (superseded()) return;
      this.minimal ??= new MinimalRenderer(() => this.viewer.invalidate());
      await this.minimal.set(world, minimalSettings, minimalAppearance, {}, nextRequest);
      if (superseded()) return;
      this.minimalActive = true;
      // The spinner and the scripts see the Minimal map at once, not after its first frames.
      clearTimeout(this.minimalStatsTimer);
      this.minimalFrameAt = 0;
      this.writeMinimalStats();
      this.viewer.setDirectSource({ element: this.minimal.element, draw: frame => this.drawMinimal(frame) });
      this.viewer.contentChanged(world.mapSize, keepView && !mapChanged);
      return;
    }
    this.minimalActive = false;
    this.minimal?.dispose();
    this.minimal = undefined;
    if (!renderGeometryReady()) {
      await loadRenderGeometry();
      if (superseded()) return;
    }
    world = this.presentWorld(world);
    this.syncRenderer?.dispose();
    this.syncRenderer = null;
    const settings = this.appearanceSettings;
    const resolved = settings && this.resolve(settings, world, true);
    const useBench = !!settings && resolved!.path === 'composite';
    if (useBench) {
      const { BenchRenderer } = await import('./benchRenderer');
      if (superseded()) return;
      this.bench ??= new BenchRenderer(() => {
        if (this.benchActive && this.world && !this.bench?.redrawOnly) {
          this.benchMiniRevision = -1;
        }
        if (this.benchActive && this.world) this.viewer.contentChanged(this.world.mapSize, true);
      });
      this.viewer.setRelief(() => this.bench?.relief());
      this.viewer.setWalkCollisions(() => this.bench?.walkCollisions());
      this.bench.resourceSource = w => this.resources(w);
      // One bench set() at a time: two interleaved sets (style switch + language redraw) share the renderer's passes and
      // could leave the older look on screen. A newer show() waits for the one in flight; a superseded one gives up.
      while (this.benchSetting) {
        await this.benchSetting.catch(() => {});
        if (superseded()) return;
      }
      this.benchPreparing++;
      const setting = this.bench.set(world, settings!, resolved!, {}, nextRequest);
      this.benchSetting = setting;
      try {
        await setting;
      } finally {
        this.benchPreparing--;
        if (this.benchSetting === setting) this.benchSetting = undefined;
      }
      // A newer show() already installed its look (e.g. parchment through the render worker): never put this older one back.
      if (superseded()) return;
      if (!this.benchActive) this.render?.postMessage({ type: 'release' });
      this.benchActive = true;
      this.viewer.setDirectSource({ element: this.bench.element, draw: frame => this.drawBench(frame) });
      this.viewer.contentChanged(world.mapSize, keepView && !mapChanged);
      return;
    }
    this.benchActive = false;
    if (!this.render) {
      await this.init();
      if (superseded()) return;
    }
    if (this.render) this.viewer.setSource({ request: frame => this.render!.postMessage({ type: 'view', ...frame }) });
    if (this.render) {
      const channel = new MessageChannel();
      const gen = ++this.drawingId;
      if (this.pendingDraw) {
        clearTimeout(this.pendingDraw.timer);
        this.pendingDraw.resolve();
        this.pendingDraw = null;
      }
      const drawn = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingDraw = null;
          reject(new Error('Le rendu de la carte a dépassé 60 secondes.'));
        }, 60000);
        this.pendingDraw = { gen, resolve, reject, timer };
      });
      this.render.postMessage({ type: 'attach', gen, port: channel.port1, display: this.display }, [channel.port1]);
      const projected = packWorldLanduse(renderProjection(world));
      channel.port2.postMessage({ type: 'world', gen, world: projected.world, final: true, stage: 'done' }, projected.transfer);
      channel.port2.close();
      this.viewer.contentChanged(world.mapSize, keepView && !mapChanged);
      return drawn;
    } else {
      const displayed = { ...world, options: { ...world.options, contours: this.display.contours ?? world.options.contours, landuse: this.display.landuse ?? world.options.landuse, labels: this.display.labels ?? world.options.labels } };
      const images = this.display.painted ? await (await import('./display/paintedBrushes')).paintedBrushes() : undefined;
      this.syncRenderer = createCanvasRenderer(this.canvas, displayWorld(displayed, this.display.layers, this.display.buildings), this.display.style, {
        colors: this.display.colors,
        brushes: images ?? undefined,
        vegetation: this.display.vegetation,
        get dpr() {
          return liveDevicePixelRatio();
        },
      });
      this.syncRenderer.setOverlays({ cartouche: this.display.cartouche ?? false, legend: this.display.legend ?? false, labels: this.display.labels ?? true });
      this.viewer.setRenderer(this.syncRenderer, world.mapSize, keepView);
      return Promise.resolve();
    }
  }
  private drawMinimal(frame: FrameRequest): { mini?: HTMLCanvasElement; ms: number; band: number; scale: number } {
    const renderer = this.minimal;
    if (!renderer || !this.minimalActive) return { ms: 0, band: 0, scale: frame.view.scale };
    renderer.drawLive(frame.view, frame.w, frame.h, frame.dpr);
    let mini: HTMLCanvasElement | undefined;
    if (frame.mini && (this.benchMiniRevision !== this.appearanceRevision || this.benchMiniSize !== frame.mini)) {
      mini = renderer.drawMini(frame.mini);
      this.benchMiniRevision = this.appearanceRevision;
      this.benchMiniSize = frame.mini;
    }
    this.minimalFrameAt = performance.now();
    this.minimalStatsTimer ??= setTimeout(this.writeMinimalStats, BENCH_STATS_MS);
    return { mini, ms: renderer.stats.frameMs, band: 0, scale: frame.view.scale };
  }
  private minimalFrameAt = 0;
  private minimalStatsTimer?: ReturnType<typeof setTimeout>;
  /** Diagnostics of the Minimal map on the canvas (`data-*`, read by the loading spinner and the test scripts), written
   * once its frames have stopped for BENCH_STATS_MS and only where a value changed: no page DOM write in the frames of
   * a gesture (Minimal is the slow-laptop path). */
  private readonly writeMinimalStats = (): void => {
    const wait = this.minimalFrameAt + BENCH_STATS_MS - performance.now();
    if (wait > 0) {
      this.minimalStatsTimer = setTimeout(this.writeMinimalStats, wait);
      return;
    }
    this.minimalStatsTimer = undefined;
    const renderer = this.minimal;
    if (!renderer || !this.minimalActive) return;
    const data = this.canvas.dataset,
      set = (key: string, value: string): void => {
        if (data[key] !== value) data[key] = value;
      };
    set('renderer', 'minimal');
    set('renderStyle', 'minimal');
    set('renderFrameMs', String(renderer.stats.frameMs));
    set('renderGeometryBuildMs', String(renderer.stats.geometryBuildMs));
    set('renderFeatures', String(renderer.stats.features));
    set('terrainBackend', 'cpu');
    set('renderPending', '0');
    set('renderPasses', '[]');
    set('cityRender', '{}');
  };
  private drawBench(frame: FrameRequest): { mini?: HTMLCanvasElement; ms: number; band: number; scale: number } {
    const started = performance.now();
    const renderer = this.bench;
    if (!renderer || !this.benchActive) return { ms: 0, band: 0, scale: frame.view.scale };
    let mini: HTMLCanvasElement | undefined;
    // The whole-map miniature costs as much as a full frame: the live view shows first, the miniature follows in a later frame.
    if (frame.mini && !this.benchPreparing && (this.benchMiniRevision !== this.appearanceRevision || this.benchMiniSize !== frame.mini)) {
      if (this.benchMiniDue) {
        this.benchMiniDue = false;
        mini = renderer.drawMini(frame.mini);
        // Content still arriving (progressive display, dirty tiles): keep the revision stale so the miniature is drawn again.
        if (renderer.miniComplete) {
          this.benchMiniRevision = this.appearanceRevision;
          this.benchMiniSize = frame.mini;
        } else if (!this.benchMiniTimer)
          this.benchMiniTimer = setTimeout(() => {
            this.benchMiniTimer = undefined;
            if (!this.benchActive) return;
            this.benchMiniDue = true;
            this.viewer.invalidate();
          }, MINI_DELAY_MS);
      } else if (!this.benchMiniTimer)
        this.benchMiniTimer = setTimeout(() => {
          this.benchMiniTimer = undefined;
          if (!this.benchActive) return;
          this.benchMiniDue = true;
          this.viewer.invalidate();
        }, MINI_DELAY_MS);
    }
    // Restore the live camera after a miniature capture, in this same animation frame.
    renderer.drawLive(frame.view, frame.w, frame.h, frame.dpr);
    this.noteBenchStats(renderer);
    renderer.noteFrame(started);
    return { mini, ms: performance.now() - started, band: 0, scale: frame.view.scale };
  }
  private benchStatsAt = 0;
  private benchStatsTimer?: ReturnType<typeof setTimeout>;
  /** Diagnostics of the map renderer on the canvas (`data-*`, read by the loading spinner, the test scripts and the
   * probes). The pending count is exact after every frame, written only when it changes. The others are serialized at
   * most every BENCH_STATS_MS, and once more after the last frame: written in every frame of a gesture, a dozen
   * attribute mutations (two of them JSON of the town and pass statistics) made the page recompute styles per frame. */
  private noteBenchStats(renderer: BenchRenderer): void {
    const data = this.canvas.dataset,
      pending = String(renderer.pendingWork());
    if (data.renderPending !== pending) data.renderPending = pending;
    if (performance.now() - this.benchStatsAt >= BENCH_STATS_MS) {
      this.writeBenchStats(renderer);
      return;
    }
    this.benchStatsTimer ??= setTimeout(() => {
      this.benchStatsTimer = undefined;
      if (this.benchActive && this.bench) this.writeBenchStats(this.bench);
    }, BENCH_STATS_MS);
  }
  private writeBenchStats(renderer: BenchRenderer): void {
    this.benchStatsAt = performance.now();
    const data = this.canvas.dataset,
      set = (key: string, value: string): void => {
        if (data[key] !== value) data[key] = value;
      };
    set('renderer', String(renderer.stats.renderer));
    set('renderStyle', String(renderer.stats.style));
    set('terrainBackend', String(renderer.stats.terrainBackend));
    set('renderRequest', String(renderer.requestId ?? ''));
    set('renderRetainedBytes', String(renderer.retainedBytes()));
    set('cityRender', JSON.stringify(renderer.stats.city ?? {}));
    set('renderPending', String(renderer.pendingWork()));
    set('renderPasses', JSON.stringify(renderer.stats.passes ?? []));
  }
  /** Progressive display finished (captures and test scripts wait for it). */
  displaySettled(): Promise<void> {
    if (this.minimalActive) return this.minimal!.settled();
    return this.benchActive && this.bench ? this.bench.settled() : Promise.resolve();
  }
  /** Display work still owed to the map (tiles, textures, programs). */
  displayPending(): number {
    return this.benchActive && this.bench ? this.bench.pendingWork() : 0;
  }
  /** The tilted view on screen as a picture (the PNG of the view); undefined in the top view or without the bench. */
  captureView(): HTMLCanvasElement | undefined {
    return this.benchActive ? this.bench?.captureView() : undefined;
  }
  /** The ground point under the CSS pixel (sx, sy) of the map, in the top view or tilted; undefined in the sky. */
  groundAt(sx: number, sy: number, w: number, h: number): { x: number; y: number } | undefined {
    const view = this.viewer.getView();
    if (!isTilted(view)) {
      const [x, y] = screenToWorld(view, w, h, sx, sy);
      return { x, y };
    }
    const relief = this.bench?.relief(),
      point: [number, number] = [0, 0];
    return groundPoint(poseCamera(this.groundPose, view, h, relief), sx, sy, w, h, relief, point) ? { x: point[0], y: point[1] } : undefined;
  }
  private readonly groundPose = createCameraPose();
  /** What lies under the CSS pixel (sx, sy) of the map: the ground point (map metres) and, in a tilted view, the building
   * volume in front of it, with the metres a pixel spans there. Undefined where the pixel shows no ground (the sky of a
   * tilted view). */
  pickAt(sx: number, sy: number, w: number, h: number): MapPick | undefined {
    const view = this.viewer.getView();
    if (this.benchActive && this.bench) return this.bench.pick(view, w, h, sx, sy);
    const [x, y] = screenToWorld(view, w, h, sx, sy);
    return { x, y, metresPerPixel: 1 / view.scale };
  }
  /** Tints the volume of the selected building in the tilted view (its volume id; undefined: none). */
  highlightBuilding(id: string | undefined): void {
    this.bench?.highlightBuilding(id);
  }
  prepareViewportCapture(): void {
    if (this.minimalActive) this.minimal?.prepareCapture();
    if (this.benchActive) this.bench?.prepareCapture();
  }
  /** Resolve the appearance for the current products. `previewAware`: a stage-preview world is inspected through its elevation. */
  private resolve(settings: V2Settings, world: World | undefined, previewAware: boolean): ResolvedAppearance {
    const preview = previewAware && !!world && !!world.stats['v2.previewStage'];
    const hit = this.resolutions.find(entry => entry.settings === settings && entry.world === world && entry.preview === preview);
    if (hit) return hit.resolved;
    const resolved = resolveSettingsAppearance(settings, world, 'view2d', { preview });
    this.resolutions = [{ settings, world, preview, resolved }, ...this.resolutions.slice(0, 3)];
    return resolved;
  }
  /** Appearance changes redraw retained geometry. They never enter the generation worker. */
  setAppearance(settings: V2Settings): Promise<void> {
    const request = ++this.appearanceRequest;
    const readiness = new RenderReadiness('2d');
    const snapshot = { ...settings, appearance: settings.appearance ? structuredClone(settings.appearance) : undefined };
    const work = this.appearanceWork
      .catch(() => {})
      .then(() => {
        if (request !== this.appearanceRequest) return;
        this.readiness = readiness;
        return this.applyAppearance(snapshot);
      });
    this.appearanceWork = work;
    return work;
  }
  private async applyAppearance(settings: V2Settings): Promise<void> {
    const previousSettings = this.appearanceSettings,
      previousDisplay = this.display;
    try {
      this.appearanceSettings = settings;
      this.appearanceRevision++;
      const display = this.resolve(settings, this.world ?? undefined, false);
      this.display = { ...this.display, ...resolvedDisplayOptions(display), colors: display.palette.colors };
      const needsBench = this.resolve(settings, this.world ?? undefined, true).path !== 'classic';
      if (this.render && !needsBench && display.cartography.painted && !this.brushSourcesSent) {
        const { BRUSH_SOURCES } = await import('../render/assets/brushAssets');
        this.render.postMessage({ type: 'brushes', sources: BRUSH_SOURCES });
        this.brushSourcesSent = true;
      }
      if (this.world && (!this.render || this.benchActive || this.minimalActive || needsBench)) await this.show(this.world, true, this.readiness);
      else if (this.world) {
        if (!sameDisplay(previousDisplay, this.display)) this.render?.postMessage({ type: 'display', display: this.display });
        this.canvas.dataset.renderer = 'Classic Canvas';
        this.canvas.dataset.renderStyle = this.display.style;
        this.canvas.dataset.cityRender = '{}';
      } else if (this.render && !needsBench && !sameDisplay(previousDisplay, this.display)) this.render.postMessage({ type: 'display', display: this.display });
    } catch (error) {
      this.appearanceSettings = previousSettings;
      this.display = previousDisplay;
      if (this.render && !this.benchActive) this.render.postMessage({ type: 'display', display: this.display });
      throw error;
    }
  }
  async exportBench(settings: V2Settings, resolved: ResolvedAppearance, size: number, layers: Partial<ExportLayers>, frame?: ExportFrame, source = this.world): Promise<HTMLCanvasElement> {
    // Style switches may still be preparing the shared GPU resources. Export waits for that work.
    for (;;) {
      const work = this.appearanceWork;
      await work;
      if (work === this.appearanceWork) break;
    }
    if (!source) throw new Error('Create a region first.');
    if (resolved.path === 'minimal') {
      const { MinimalRenderer } = await import('./minimalRenderer'),
        renderer = new MinimalRenderer(() => {});
      try {
        await renderer.set(source, settings, resolved, layers);
        return await renderer.capture(size);
      } finally {
        renderer.dispose();
      }
    }
    const { BenchRenderer } = await import('./benchRenderer');
    // Use the viewer's async GPU path for exports too. Forcing the raster path recompiles the
    // satellite material in synchronous WebGL even when the viewer already runs on WebGPU.
    const world = mapPresentation(source, settings),
      snapshot = { ...settings, appearance: settings.appearance ? structuredClone(settings.appearance) : undefined },
      renderer = new BenchRenderer(() => {}, false, this.bench?.rasterContext(), this.bench?.sharedResources());
    renderer.resourceSource = w => this.resources(w);
    let rendered: HTMLCanvasElement | undefined;
    try {
      await renderer.set(world, snapshot, resolved, layers);
      rendered = await renderer.capture(size, undefined, frame);
      const copy = document.createElement('canvas');
      copy.width = rendered.width;
      copy.height = rendered.height;
      copy.getContext('2d')!.drawImage(rendered, 0, 0);
      return copy;
    } finally {
      if (rendered) rendered.width = rendered.height = 0;
      renderer.dispose();
    }
  }
  setDisplay(patch: Partial<DisplayOpts>): void {
    const next = { ...this.display, ...patch };
    if (sameDisplay(this.display, next)) return;
    this.display = next;
    if (this.render) {
      if (!this.benchActive) this.render.postMessage({ type: 'display', display: this.display });
    } else if (this.world) this.show({ ...this.world, options: { ...this.world.options, contours: this.display.contours ?? true, landuse: this.display.landuse ?? true, labels: this.display.labels } }, true);
  }
  /** Page unload: the job is dropped, not rejected, so its continuation cannot touch a UI that is being torn down. */
  destroy(): void {
    clearTimeout(this.benchStatsTimer);
    this.neuralDownload?.abort();
    this.pending = null;
    this.retained = undefined;
    this.minimal?.dispose();
    this.bench?.dispose();
    if (this.pendingDraw) {
      clearTimeout(this.pendingDraw.timer);
      this.pendingDraw.resolve();
      this.pendingDraw = null;
    }
    this.engine.terminate();
    this.render?.terminate();
    this.syncRenderer?.dispose();
    this.viewer.destroy();
  }
}
