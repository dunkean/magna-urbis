/**
 * 3D view backend selection: WebGPU (terrain3dGpu.ts) when the browser gives a hardware adapter, a device
 * and the stand-in pipelines, otherwise WebGL2 (Terrain3d). Same rationale and URL override as the map
 * (terrainRenderer.ts): `?renderer=webgl` forces WebGL2, `?renderer=webgpu` forces WebGPU.
 *
 * The owners hold one Terrain3d and one canvas for the session, but the backend may change under them:
 * - a view opened before the WebGPU device is ready starts on WebGL2 and is upgraded once it is: the WebGPU
 *   view is prepared silently with the same inputs, and shown in place of the WebGL2 one when its frame is
 *   complete (tiles and ground variant), with the same camera;
 * - a lost WebGPU device is recreated and the view rebuilt from its retained CPU-side inputs; after three
 *   failed attempts, or a fourth loss within a minute, the view continues on WebGL2.
 * A canvas keeps its first context, so a new backend draws into its own canvas laid exactly over the owner's
 * (Overlay); the owner's canvas keeps the input, focus and status attributes (data-renderer...), and the
 * Terrain3d the owner holds is a proxy that forwards to the displayed view.
 */
import { Terrain3d, type Terrain3dOptions } from './terrain3d';
import { rendererOverride, type RendererOverride } from './rendererOverride';

export type Terrain3dBackend = RendererOverride;
type GpuModule = typeof import('./terrain3dGpu');

const forced = rendererOverride();
let gpuModule: GpuModule | undefined;
let state: 'off' | 'pending' | 'ready' | 'failed' = 'off';
let preparing: Promise<void> = Promise.resolve();
if (forced !== 'webgl' && typeof navigator !== 'undefined' && navigator.gpu) {
  state = 'pending';
  preparing = import('./terrain3dGpu')
    .then(async module => { gpuModule = module; state = await module.prepareTerrain3dGpu(forced === 'webgpu') ? 'ready' : 'failed'; })
    .catch(error => { state = 'failed'; console.warn('WebGPU 3D view unavailable, using WebGL2:', error); });
}

/** Resolves once the WebGPU device is prepared or refused (for pages that can wait before creating a view). */
export function terrain3dBackendReady(): Promise<void> { return preparing; }

/** A 3D view on `canvas` (Terrain3d's constructor arguments), WebGPU when prepared, else WebGL2 (upgraded to
 * WebGPU when the device becomes ready). */
export function createTerrain3d(canvas: HTMLCanvasElement, onChange: () => void, onRender?: () => void, options: Terrain3dOptions = {}): Terrain3d {
  return new Terrain3dHost(canvas, onChange, onRender, options).view;
}

/** Which backend draws a view created by createTerrain3d (it changes on an upgrade or a definitive loss). */
export function terrain3dBackend(view: Terrain3d): Terrain3dBackend {
  return view.getStatus('renderer') === 'webgpu' ? 'webgpu' : 'webgl';
}

const RECOVERY_ATTEMPTS = 3, RECOVERY_DELAY_MS = 500, LOSS_WINDOW_MS = 60_000, WARMUP_LIMIT_MS = 10_000;
/** Calls that change a view's inputs or camera: also applied to a view being prepared behind it. */
const MIRRORED = new Set<PropertyKey>(['setSurface', 'setHeightSampler', 'setGroundMaterial', 'setRenderV2Season', 'setTileBoundaries', 'setBuildings',
  'replaceBuildings', 'setForest', 'setTileLoader', 'invalidateTiles', 'setTexture', 'setCamera', 'setActive', 'resize', 'fit', 'zoom', 'north']);

/** A drawing canvas laid exactly over the owner's element (same offset parent, box and stacking), without
 * pointer events: the element underneath keeps the input. It follows the element's box and visibility. */
class Overlay {
  readonly canvas = document.createElement('canvas');
  private readonly sizes = new ResizeObserver(() => this.sync());
  private readonly attributes = new MutationObserver(() => this.sync());
  constructor(private readonly element: HTMLElement) {
    const canvas = this.canvas;
    canvas.dataset.terrain3dSurface = ''; canvas.setAttribute('aria-hidden', 'true'); canvas.tabIndex = -1;
    Object.assign(canvas.style, { position: 'absolute', right: 'auto', bottom: 'auto', margin: '0', padding: '0', border: '0', pointerEvents: 'none', visibility: 'hidden' });
    element.after(canvas);
    this.sizes.observe(element);
    this.attributes.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    // The owner may watch the restoration of a WebGL2 context on its element (terrainbench).
    canvas.addEventListener('webglcontextrestored', () => element.dispatchEvent(new Event('webglcontextrestored')));
    this.sync();
  }
  show(): void { this.canvas.style.visibility = ''; }
  sync(): void {
    const element = this.element, style = this.canvas.style;
    if (!element.isConnected || !element.getClientRects().length) { style.display = 'none'; return; }
    Object.assign(style, { display: 'block', left: `${element.offsetLeft + element.clientLeft}px`, top: `${element.offsetTop + element.clientTop}px`,
      width: `${element.clientWidth}px`, height: `${element.clientHeight}px`, zIndex: getComputedStyle(element).zIndex });
  }
  dispose(): void { this.sizes.disconnect(); this.attributes.disconnect(); this.canvas.remove(); }
}

/** The displayed view behind the owner's Terrain3d, and its backend switches. */
class Terrain3dHost {
  /** What the owner holds: forwards every member to the displayed view. */
  readonly view: Terrain3d;
  private current: Terrain3d;
  /** The current view's own canvas when it is not the owner's. */
  private overlay?: Overlay;
  /** A WebGPU view being prepared behind a WebGL2 one (upgrade). */
  private warming?: { view: Terrain3d; overlay: Overlay; started: number; timer?: ReturnType<typeof setTimeout> };
  private losses: number[] = [];
  private recovering = false;
  /** After a definitive loss: WebGL2 for the rest of the session. */
  private final = false;
  private disposed = false;

  constructor(private readonly element: HTMLCanvasElement, private readonly onChange: () => void, private readonly onRender: (() => void) | undefined,
    private readonly options: Terrain3dOptions) {
    this.current = this.initial();
    this.view = new Proxy(Object.create(Terrain3d.prototype) as Terrain3d, {
      get: (_, key) => {
        if (key === 'dispose') return () => this.dispose();
        const view = this.current, value: unknown = Reflect.get(view, key, view);
        if (typeof value !== 'function') return value;
        const warming = this.warming?.view;
        if (!warming || !MIRRORED.has(key)) return value.bind(view);
        return (...args: unknown[]) => {
          const result: unknown = value.apply(view, args);
          try { (Reflect.get(warming, key) as (...a: unknown[]) => unknown).apply(warming, args); }
          catch (error) { console.warn('WebGPU 3D view (in preparation):', error); this.abandonWarmup(); }
          return result;
        };
      },
      set: (_, key, value) => Reflect.set(this.current, key, value),
    });
  }

  private initial(): Terrain3d {
    if (forced !== 'webgl') {
      const view = this.create('webgpu', this.element, false);
      if (view) return view;
    }
    if (forced === 'webgpu' && state !== 'pending' && state !== 'ready') console.warn('WebGPU indisponible pour la vue 3D (?renderer=webgpu) : WebGL2.');
    const view = this.create('webgl', this.element, false)!;
    // Opened before the device (first preparation, or a new one after a loss elsewhere): upgrade when it is ready.
    if (forced !== 'webgl' && (state === 'pending' || state === 'ready')) {
      const device = state === 'pending' ? preparing : gpuModule!.prepareTerrain3dGpu(false).then(() => undefined);
      void device.then(() => this.upgrade(), () => { /* stays on WebGL2 */ });
    }
    return view;
  }

  /** A view on `canvas`; its callbacks reach the owner only while it is the displayed one. */
  private create(backend: Terrain3dBackend, canvas: HTMLCanvasElement, silent: boolean): Terrain3d | undefined {
    let view: Terrain3d | undefined;
    const shown = (): boolean => view === this.current && !this.disposed;
    const onChange = (): void => { if (shown()) this.onChange(); };
    const onRender = this.onRender && ((): void => { if (shown()) this.onRender!(); });
    const options: Terrain3dOptions = { ...this.options, element: this.element, silent };
    view = backend === 'webgpu'
      ? gpuModule?.createTerrain3dGpu(canvas, onChange, onRender, options, () => this.lost(view!))
      : new Terrain3d(canvas, onChange, onRender, options);
    return view;
  }

  /** Shows `next` (on `overlay`) in place of the current view, which is released. */
  private swap(next: Terrain3d, overlay: Overlay): void {
    const previous = this.current, previousOverlay = this.overlay;
    this.current = next; this.overlay = overlay;
    overlay.show(); next.showStatus();
    previous.dispose(); previousOverlay?.dispose();
  }

  /** WebGL2 → WebGPU once the device is ready: prepared silently, shown when its frame is complete. */
  private upgrade(): void {
    if (this.disposed || this.final || this.warming || terrain3dBackend(this.current) === 'webgpu') return;
    const overlay = new Overlay(this.element);
    let view: Terrain3d | undefined;
    try { view = this.create('webgpu', overlay.canvas, true); }
    catch (error) { console.warn('WebGPU 3D view: upgrade failed, staying on WebGL2:', error); }
    if (!view) { overlay.dispose(); return; }
    try { this.current.transferTo(view); }
    catch (error) { console.warn('WebGPU 3D view: upgrade failed, staying on WebGL2:', error); view.dispose(); overlay.dispose(); return; }
    this.warming = { view, overlay, started: performance.now() };
    this.settle();
  }
  private settle(): void {
    const warming = this.warming;
    if (!warming || this.disposed) return;
    // A closed view has nothing to keep on screen; otherwise wait for the new frame (bounded).
    if (!this.current.isActive || warming.view.isSettled() || performance.now() - warming.started > WARMUP_LIMIT_MS) {
      this.warming = undefined;
      warming.view.setCamera(this.current.getCamera());
      this.swap(warming.view, warming.overlay);
      console.info(`WebGPU 3D view: upgraded from WebGL2 after ${Math.round(performance.now() - warming.started)} ms of preparation.`);
      return;
    }
    warming.timer = setTimeout(() => this.settle(), 150);
  }
  private abandonWarmup(): void {
    const warming = this.warming;
    if (!warming) return;
    this.warming = undefined; clearTimeout(warming.timer);
    warming.view.dispose(); warming.overlay.dispose();
  }

  /** The device of `view` is lost: recover the displayed view (a view in preparation is dropped). */
  private lost(view: Terrain3d): void {
    if (this.disposed) return;
    if (this.warming?.view === view) { this.abandonWarmup(); return; }
    if (view !== this.current || this.recovering) return;
    this.recovering = true;
    void this.recover().finally(() => { this.recovering = false; });
  }
  /** A new device, a new WebGPU view rebuilt from the lost one's inputs; else the WebGL2 fall back. */
  private async recover(): Promise<void> {
    const now = performance.now();
    this.losses = [...this.losses.filter(t => now - t < LOSS_WINDOW_MS), now];
    let error: unknown = new Error('WebGPU : l’appareil est perdu à répétition.');
    for (let attempt = 0; attempt < RECOVERY_ATTEMPTS && this.losses.length <= 3; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY_MS * attempt));
      if (this.disposed) return;
      let overlay: Overlay | undefined, view: Terrain3d | undefined;
      try {
        if (!gpuModule || !await gpuModule.prepareTerrain3dGpu(forced === 'webgpu')) throw new Error('WebGPU : plus d’adaptateur matériel.');
        if (this.disposed) return;
        overlay = new Overlay(this.element);
        view = this.create('webgpu', overlay.canvas, true);
        if (!view) throw new Error('WebGPU : le nouvel appareil est déjà perdu.');
        this.current.transferTo(view);
        this.swap(view, overlay);
        console.info('WebGPU 3D view: device recreated, resources re-uploaded.');
        return;
      } catch (caught) {
        view?.dispose(); overlay?.dispose();
        error = caught; console.warn('WebGPU 3D view: device recreation failed:', caught);
      }
    }
    if (!this.disposed) this.fallBack(error);
  }
  private fallBack(error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error), overlay = new Overlay(this.element);
    try {
      const view = this.create('webgl', overlay.canvas, true)!;
      this.current.transferTo(view);
      this.final = true;
      this.swap(view, overlay);
      console.warn(`WebGPU 3D view: device lost for good (${reason}); continuing with WebGL2.`);
    } catch (glError) {
      overlay.dispose();
      console.error(`Vue 3D indisponible : appareil WebGPU perdu (${reason}) et WebGL2 impossible (${glError instanceof Error ? glError.message : glError}).`);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abandonWarmup();
    this.current.dispose(); this.overlay?.dispose(); this.overlay = undefined;
  }
}
