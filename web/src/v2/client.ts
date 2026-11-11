import EngineWorker from './engine.worker?worker';
import RenderWorker from '../ui/renderWorker?worker';
import { createViewer, type Viewer } from '../ui/viewer';
import { createCanvasRenderer, type CanvasRenderer } from '../render/canvas';
import { displayWorld } from '../render/displayWorld';
import type { World } from '../gen/types';
import type { V2Settings, V2Progress, V2TownStage } from './contracts';
import type { ResourcePayload } from '../../../rust/bridge/resources';
import type { DisplayOpts, RResponse } from '../ui/protocol';
import { generationWorldInput } from './workerWorld';
import { renderProjection } from './renderProjection';
import { sameDisplay } from './displayState';
import type { BenchRenderer } from './benchRenderer';
import { resolveSettingsAppearance, resolvedDisplayOptions } from './appearance';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import type { FrameRequest } from '../ui/viewer';
import type { ExportLayers } from '../render/exportLayers';
import { publishWasmThreads, wasmWorkerFailed, wasmWorkerOptions } from '../../../rust/bridge/wasmThreads';
import { loadRenderGeometry, renderGeometryReady } from '../../../rust/bridge/renderGeometry';
import { mapPresentation } from './mapPresentation';
import { ensureDesktopNeuralServer } from './desktopNeural';

/** Delay of the miniature after a new live frame (its first frame must not wait for it). */
const MINI_DELAY_MS = 350;

export type Action = 'terrain' | 'region' | 'roads' | 'towns' | 'town' | 'settlements' | 'all';

/** Generation and drawing stay on separate workers; a failed job keeps the previous map. */
export class StudioClient {
  onEngineReset?: () => void;
  // The worker name carries `?threads=`; after a worker death, the single-thread package.
  private engine = new EngineWorker(wasmWorkerOptions('magna-v2'));
  private render: Worker | null = null;
  private syncRenderer: CanvasRenderer | null = null;
  private id = 0;
  private drawingId = 0;
  private pending: { id: number; resolve: (world: World) => void; reject: (error: Error) => void } | null = null;
  /** Lazy resource payload requests (worker message `resources`), and the payload of the last terrain. */
  private resourceRequests = new Map<number, { resolve: (payload: ResourcePayload | undefined) => void; reject: (error: Error) => void }>();
  private resourceCache?: { key: string; payload: Promise<ResourcePayload | undefined> };
  private world: World | null = null;
  private appearanceSettings?: V2Settings;
  private bench?: BenchRenderer;
  private benchActive = false;
  private appearanceRevision = 0;
  private brushSourcesSent = false;
  private appearanceWork:Promise<void>=Promise.resolve();
  private appearanceRequest=0;
  private benchMiniRevision = -1;
  /** One resolution per (settings, world, preview): show() and applyAppearance() share it. */
  private resolutions: { settings: V2Settings; world: World | undefined; preview: boolean; resolved: ResolvedAppearance }[] = [];
  private benchMiniSize = 0;
  private benchMiniDue = false;
  private benchMiniTimer?: ReturnType<typeof setTimeout>;
  /** Intermediate invalidations may redraw the live map while its new look is still compiling. */
  private benchPreparing = 0;
  private classicBackground?:{world:World;key:string;url:string};
  private retained?:{id:number;world:World};
  private pendingDraw: { gen:number; resolve:()=>void; reject:(e:Error)=>void; timer:ReturnType<typeof setTimeout> } | null = null;
  private display: DisplayOpts = { style: 'parchment', contours: true, landuse: true, labels: true, legend: false, cartouche: false };
  readonly viewer: Viewer;
  constructor(private canvas: HTMLCanvasElement, container: HTMLElement, minimap: HTMLCanvasElement, private onProgress: (p: V2Progress) => void, private onError: (e: Error) => void, onView?: () => void) {
    this.viewer = createViewer({ canvas, container, minimap, onError, onView });
    this.attachEngine();
  }
  private attachEngine(): void {
    this.engine.onmessage = ({ data: m }) => {
      if (m.type !== 'progress') publishWasmThreads(m.wasm);
      const lazy = this.resourceRequests.get(m.id);
      if (lazy) { this.resourceRequests.delete(m.id); if (m.type === 'resources') lazy.resolve(m.payload); else if (m.type === 'error') lazy.reject(new Error(m.error)); return; }
      if (m.id !== this.pending?.id) return;
      if (m.type === 'progress') this.onProgress(m.progress);
      else if (m.type === 'result') { const p = this.pending!; this.pending = null; this.retained={id:m.id,world:m.world};p.resolve(m.world); }
      else if (m.type === 'error') { const p = this.pending!; this.pending = null; p.reject(new Error(m.error)); }
    };
    this.engine.onerror = e => { this.failResources(new Error(e.message || 'engine worker error')); wasmWorkerFailed(e.message || 'engine worker error'); this.pending?.reject(new Error(e.message || 'Le moteur de génération a été interrompu.')); this.pending = null; this.retained=undefined;this.engine.terminate(); this.engine = new EngineWorker(wasmWorkerOptions('magna-v2')); this.attachEngine(); this.onEngineReset?.(); };
  }
  async init(): Promise<void> {
    let render:Worker;
    try{render=new RenderWorker();}catch{return;}
    const ready = await new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => resolve(false), 5000);
      render.onmessage = ({ data }: MessageEvent<RResponse>) => { if (data.type === 'ready') { clearTimeout(timeout); resolve(data.ok); } };
      render.onerror = () => { clearTimeout(timeout); resolve(false); };
      render.postMessage({ type: 'init', dpr: window.devicePixelRatio || 1 });
    });
    if (!ready) { render.terminate(); return; }
    this.render = render;this.brushSourcesSent=false;
    this.viewer.setSource({ request: frame => render.postMessage({ type: 'view', ...frame }) });
    render.onmessage = ({ data: m }: MessageEvent<RResponse>) => {
      if(this.benchActive){if(m.type==='frame')this.viewer.present(m,false);return;}
      if (m.type === 'content') this.viewer.contentChanged(m.mapSize, true, m.marker);
      else if (m.type === 'frame') {
        const shown=this.viewer.present(m, m.gen === this.drawingId);
        if(shown){this.canvas.dataset.renderer='Classic Canvas';this.canvas.dataset.renderStyle=this.display.style;this.canvas.dataset.cityRender='{}';}
        if(shown&&m.gen===this.pendingDraw?.gen){clearTimeout(this.pendingDraw.timer);this.pendingDraw.resolve();this.pendingDraw=null;}
      }
      else if (m.type === 'error') { const error=new Error(m.error); if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.reject(error);this.pendingDraw=null;}else this.onError(error); }
    };
    render.onerror = e => {const error=new Error(e.message || 'Le rendu de la carte a été interrompu.');if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.reject(error);this.pendingDraw=null;}else this.onError(error);};
    render.postMessage({ type: 'display', display: this.display });
    if(this.display.painted){this.brushSourcesSent=true;const {BRUSH_SOURCES}=await import('../render/assets/brushAssets');render.postMessage({type:'brushes',sources:BRUSH_SOURCES});}
  }
  run(action: Action, settings: V2Settings, world?: World, key?: string, townStage?:V2TownStage, terrainStage?: string, keys?: string[], cityOutput?: string): Promise<World> {
    if (this.pending) return Promise.reject(new Error('Un calcul est déjà en cours.'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      const dispatch = async () => {
        if (['terrain', 'all'].includes(action) && settings.runtime?.source === 'neural'
          && !settings.options.importedHeight && !settings.decor && !settings.terrain?.sketch?.processing) {
          const neuralServer = await ensureDesktopNeuralServer(settings.runtime.neuralServer ?? 'http://127.0.0.1:8792',
            label => this.onProgress({ stage: 'neural-startup', label, completed: 0, total: 0 }));
          settings = { ...settings, runtime: { ...settings.runtime, neuralServer } };
        }
        // Cancellation may have replaced the worker while native weights were loading.
        if (this.pending?.id !== id) return;
        this.engine.postMessage({ id, action, settings, ...generationWorldInput(action,world,this.retained),key, keys, townStage,terrainStage,cityOutput,assetBase:document.baseURI });
      };
      void dispatch().catch(error => { if (this.pending?.id === id) { this.pending=null;reject(error instanceof Error?error:new Error(String(error))); } });
    });
  }
  cancel(): void {
    if (!this.pending) return;
    this.pending.reject(new DOMException('Calcul annulé. La carte précédente est conservée.', 'AbortError'));
    this.pending = null;this.retained=undefined; this.engine.terminate(); this.engine = new EngineWorker(wasmWorkerOptions('magna-v2')); this.attachEngine();
    this.onEngineReset?.();
  }
  private failResources(error: Error): void { for (const request of this.resourceRequests.values()) request.reject(error); this.resourceRequests.clear(); this.resourceCache = undefined; }
  /** Resource payload of the world's terrain, fetched once per terrain (lazily: only when a resource layer is drawn). */
  resources(world: World): Promise<ResourcePayload | undefined> {
    const settings = this.appearanceSettings;
    if (!settings) return Promise.resolve(undefined);
    const key = JSON.stringify([world.stats['v2.terrainKey'] ?? null, world.stats['v2.waterEditRevision'] ?? 0, world.mapSize, world.seed, settings.runtime?.backend]);
    if (this.resourceCache?.key === key) return this.resourceCache.payload;
    const id = ++this.id;
    const payload = new Promise<ResourcePayload | undefined>((resolve, reject) => {
      this.resourceRequests.set(id, { resolve, reject });
      try { this.engine.postMessage({ type: 'resources', id, settings, ...generationWorldInput('region', world, this.retained) }); }
      catch (error) { this.resourceRequests.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
    this.resourceCache = { key, payload };
    payload.catch(() => { if (this.resourceCache?.payload === payload) this.resourceCache = undefined; });
    return payload;
  }
  /** Imported projects replace the old worker source; release its heavyweight archives. */
  invalidateRetained():void{this.retained=undefined;this.engine.postMessage({type:'release'});}
  async clear():Promise<void>{
    this.viewer.clear();
    this.resolutions=[];this.resourceCache=undefined;
    this.benchActive=false;this.appearanceRevision++;this.bench?.dispose();this.bench=undefined;this.classicBackground=undefined;
    this.invalidateRetained();this.world=null;this.syncRenderer?.dispose();this.syncRenderer=null;
    if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.resolve();this.pendingDraw=null;}
    this.render?.terminate();this.render=null;await this.init();
  }
  async show(world: World, keepView = false): Promise<void> {
    if (!renderGeometryReady()) await loadRenderGeometry(); // synchronous Rust render geometry (city ground, coast, contours)
    const mapChanged = this.world?.mapSize !== world.mapSize;
    if(this.world!==world){this.benchMiniRevision=-1;this.resolutions=[];if(this.world?.stats['v2.terrainKey']!==world.stats['v2.terrainKey'])this.resourceCache=undefined;}
    this.world = world;
    // A language/unit change redraws the same retained world with different labels.
    this.benchMiniRevision = -1;
    world = mapPresentation(world, this.appearanceSettings);
    this.syncRenderer?.dispose(); this.syncRenderer = null;
    const settings=this.appearanceSettings;
    const resolved=settings&&this.resolve(settings,world,true);
    const useBench=!!settings&&resolved!.path==='composite';
    if(useBench){
      const {BenchRenderer}=await import('./benchRenderer');
      this.bench??=new BenchRenderer(()=>{if(this.benchActive&&this.world)this.viewer.contentChanged(this.world.mapSize,true);});
      this.bench.resourceSource=w=>this.resources(w);
      this.benchPreparing++;
      try{await this.bench.set(world,settings!,resolved!);}finally{this.benchPreparing--;}
      if(!this.benchActive)this.render?.postMessage({type:'release'});
      this.benchActive=true;
      this.viewer.setDirectSource({element:this.bench.element,draw:frame=>this.drawBench(frame)});
      this.viewer.contentChanged(world.mapSize,keepView&&!mapChanged);
      return;
    }
    this.benchActive=false;
    if(this.render)this.viewer.setSource({request:frame=>this.render!.postMessage({type:'view',...frame})});
    if (this.render) {
      const channel = new MessageChannel();
      const gen = ++this.drawingId;
      if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.resolve();this.pendingDraw=null;}
      const drawn=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{this.pendingDraw=null;reject(new Error('Le rendu de la carte a dépassé 60 secondes.'));},60000);this.pendingDraw={gen,resolve,reject,timer};});
      this.render.postMessage({ type: 'attach', gen, port: channel.port1, display: this.display }, [channel.port1]);
      channel.port2.postMessage({ type: 'world', gen, world:renderProjection(world),final: true, stage: 'done' });
      channel.port2.close();
      this.viewer.contentChanged(world.mapSize, keepView && !mapChanged);
      return drawn;
    } else {
      const displayed={...world,options:{...world.options,contours:this.display.contours??world.options.contours,landuse:this.display.landuse??world.options.landuse,labels:this.display.labels??world.options.labels}};
      const images=this.display.painted?await(await import('./benchRenderer')).paintedBrushes():undefined;
      this.syncRenderer = createCanvasRenderer(this.canvas, displayWorld(displayed, this.display.layers, this.display.buildings), this.display.style, { colors: this.display.colors, brushes:images??undefined,vegetation:this.display.vegetation,get dpr() { return window.devicePixelRatio || 1; } });
      this.syncRenderer.setOverlays({ cartouche: this.display.cartouche??false, legend: this.display.legend??false,labels:this.display.labels??true });
      this.viewer.setRenderer(this.syncRenderer, world.mapSize, keepView);
      return Promise.resolve();
    }
  }
  private drawBench(frame:FrameRequest):{mini?:HTMLCanvasElement;ms:number;band:number;scale:number}{
    const started=performance.now();
    const renderer=this.bench;
    if(!renderer||!this.benchActive)return{ms:0,band:0,scale:frame.view.scale};
    let mini:HTMLCanvasElement|undefined;
    // The whole-map miniature costs as much as a full frame: the live view shows first, the miniature follows in a later frame.
    if(frame.mini&&!this.benchPreparing&&(this.benchMiniRevision!==this.appearanceRevision||this.benchMiniSize!==frame.mini)){
      if(this.benchMiniDue){
        this.benchMiniDue=false;mini=renderer.drawMini(frame.mini);this.benchMiniRevision=this.appearanceRevision;this.benchMiniSize=frame.mini;
      }else if(!this.benchMiniTimer)this.benchMiniTimer=setTimeout(()=>{this.benchMiniTimer=undefined;if(!this.benchActive)return;this.benchMiniDue=true;this.viewer.invalidate();},MINI_DELAY_MS);
    }
    // Restore the live camera after a miniature capture, in this same animation frame.
    renderer.drawLive(frame.view,frame.w,frame.h,frame.dpr);
    this.canvas.dataset.renderer=String(renderer.stats.renderer);this.canvas.dataset.renderStyle=String(renderer.stats.style);
    this.canvas.dataset.terrainBackend=String(renderer.stats.terrainBackend);
    this.canvas.dataset.cityRender=JSON.stringify(renderer.stats.city??{});this.canvas.dataset.renderPending=String(renderer.pendingWork());this.canvas.dataset.renderPasses=JSON.stringify(renderer.stats.passes??[]);
    return{mini,ms:performance.now()-started,band:0,scale:frame.view.scale};
  }
  prepareViewportCapture():void{if(this.benchActive)this.bench?.prepareCapture();}
  /** Resolve the appearance for the current products. `previewAware`: a stage-preview world is inspected through its elevation. */
  private resolve(settings:V2Settings,world:World|undefined,previewAware:boolean):ResolvedAppearance{
    const preview=previewAware&&!!world&&!!world.stats['v2.previewStage'];
    const hit=this.resolutions.find(entry=>entry.settings===settings&&entry.world===world&&entry.preview===preview);
    if(hit)return hit.resolved;
    const resolved=resolveSettingsAppearance(settings,world,'view2d',{preview});
    this.resolutions=[{settings,world,preview,resolved},...this.resolutions.slice(0,3)];return resolved;
  }
  /** Appearance changes redraw retained geometry. They never enter the generation worker. */
  setAppearance(settings:V2Settings):Promise<void>{
    const request=++this.appearanceRequest;
    const snapshot={...settings,appearance:settings.appearance?structuredClone(settings.appearance):undefined};
    const work=this.appearanceWork.catch(()=>{}).then(()=>request===this.appearanceRequest?this.applyAppearance(snapshot):undefined);this.appearanceWork=work;return work;
  }
  private async applyAppearance(settings:V2Settings):Promise<void>{
    const previousSettings=this.appearanceSettings,previousDisplay=this.display;
    try {
    this.appearanceSettings=settings;this.appearanceRevision++;
    const display=this.resolve(settings,this.world??undefined,false);
    this.display={...this.display,...resolvedDisplayOptions(display),colors:display.palette.colors};
    const needsBench=this.resolve(settings,this.world??undefined,true).path==='composite';
    if(this.render&&!needsBench&&display.cartography.painted&&!this.brushSourcesSent){const {BRUSH_SOURCES}=await import('../render/assets/brushAssets');this.render.postMessage({type:'brushes',sources:BRUSH_SOURCES});this.brushSourcesSent=true;}
    if(this.world&&(!this.render||this.benchActive||needsBench))await this.show(this.world,true);
    else if(this.world){if(!sameDisplay(previousDisplay,this.display))this.render?.postMessage({type:'display',display:this.display});this.canvas.dataset.renderer='Classic Canvas';this.canvas.dataset.renderStyle=this.display.style;this.canvas.dataset.cityRender='{}';}
    else if(this.render&&!needsBench&&!sameDisplay(previousDisplay,this.display))this.render.postMessage({type:'display',display:this.display});
    } catch(error) {
      this.appearanceSettings=previousSettings;this.display=previousDisplay;
      if(this.render&&!this.benchActive)this.render.postMessage({type:'display',display:this.display});
      throw error;
    }
  }
  async prepare3dBackground():Promise<void>{
    // A style switch may still be setting up the bench and compiling its look. Capturing earlier
    // would cache the old map or its preview, or enter a second synchronous pipeline compilation.
    for(;;){const work=this.appearanceWork;await work;if(work===this.appearanceWork)break;}
    if(this.benchActive){if(!this.bench?.groundBackground())this.bench?.backgroundUrl();return;}
    if(!this.world)return;
    const key=JSON.stringify(this.display);
    if(this.classicBackground?.world===this.world&&this.classicBackground.key===key)return;
    const {renderSvg}=await import('../render/svg');
    const brushes=this.display.painted?(await import('../render/assets/brushAssets')).BRUSH_SOURCES:undefined;
    const svg=renderSvg(this.world,{...this.display,brushes,width:2048,labels:false,legend:false,cartouche:false,layers:{city:false,streets:false,roads:false,labels:false,decor:false}}); // roads: vectors per 3D tile (city3d), not this map raster
    this.classicBackground={world:this.world,key,url:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`};
  }
  groundBackground():HTMLCanvasElement|undefined{return this.benchActive?this.bench?.groundBackground():undefined;}
  backgroundUrl():string|undefined{return this.benchActive?this.bench?.backgroundUrl():this.classicBackground?.url;}
  /** The classic 3D background already holds the land use. */
  physicalGround(){return this.benchActive?this.bench?.physicalGround():undefined;}
  async exportBench(settings:V2Settings,resolved:ResolvedAppearance,size:number,layers:Partial<ExportLayers>):Promise<HTMLCanvasElement>{
    if(!this.world)throw new Error('Create a region first.');
    const {BenchRenderer}=await import('./benchRenderer');
    const world=mapPresentation(this.world,settings),snapshot={...settings,appearance:settings.appearance?structuredClone(settings.appearance):undefined},renderer=new BenchRenderer(()=>{},true,this.bench?.rasterContext(),this.bench?.sharedResources());
    renderer.resourceSource=w=>this.resources(w);
    try{
      await renderer.set(world,snapshot,resolved,layers);
      const rendered=await renderer.capture(size),copy=document.createElement('canvas');copy.width=copy.height=size;copy.getContext('2d')!.drawImage(rendered,0,0);return copy;
    }finally{renderer.dispose();}
  }
  setDisplay(patch: Partial<DisplayOpts>): void {
    const next={...this.display,...patch};if(sameDisplay(this.display,next))return;this.display=next;
    if (this.render) { if(!this.benchActive)this.render.postMessage({ type: 'display', display: this.display }); }
    else if (this.world) this.show({ ...this.world, options: { ...this.world.options, contours: this.display.contours ?? true, landuse: this.display.landuse ?? true, labels: this.display.labels } }, true);
  }
  destroy(): void { this.cancel();this.bench?.dispose(); if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.resolve();this.pendingDraw=null;}this.engine.terminate(); this.render?.terminate(); this.syncRenderer?.dispose(); this.viewer.destroy(); }
}
