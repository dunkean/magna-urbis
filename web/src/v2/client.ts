import EngineWorker from './engine.worker?worker';
import RenderWorker from '../ui/renderWorker?worker';
import { createViewer, type Viewer } from '../ui/viewer';
import { createCanvasRenderer, type CanvasRenderer } from '../render/canvas';
import { displayWorld } from '../render/displayWorld';
import type { World } from '../gen/types';
import type { V2Settings, V2Progress, V2TownStage } from './contracts';
import type { DisplayOpts, RResponse } from '../ui/protocol';
import { generationWorldInput } from './workerWorld';
import { renderProjection } from './renderProjection';
import { sameDisplay } from './displayState';
import type { BenchRenderer } from './benchRenderer';
import type { FrameRequest } from '../ui/viewer';
import type { ExportLayers } from '../render/exportLayers';

export type Action = 'terrain' | 'region' | 'roads' | 'towns' | 'town' | 'all';

/** Generation and drawing stay on separate workers; a failed job keeps the previous map. */
export class StudioClient {
  private engine = new EngineWorker();
  private render: Worker | null = null;
  private syncRenderer: CanvasRenderer | null = null;
  private id = 0;
  private drawingId = 0;
  private pending: { id: number; resolve: (world: World) => void; reject: (error: Error) => void } | null = null;
  private world: World | null = null;
  private appearanceSettings?: V2Settings;
  private bench?: BenchRenderer;
  private benchActive = false;
  private appearanceRevision = 0;
  private brushSourcesSent = false;
  private appearanceWork:Promise<void>=Promise.resolve();
  private appearanceRequest=0;
  private benchMiniRevision = -1;
  private benchMiniSize = 0;
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
      if (m.id !== this.pending?.id) return;
      if (m.type === 'progress') this.onProgress(m.progress);
      else if (m.type === 'result') { const p = this.pending!; this.pending = null; this.retained={id:m.id,world:m.world};p.resolve(m.world); }
      else if (m.type === 'error') { const p = this.pending!; this.pending = null; p.reject(new Error(m.error)); }
    };
    this.engine.onerror = e => { this.pending?.reject(new Error(e.message || 'Le moteur de génération a été interrompu.')); this.pending = null; this.retained=undefined;this.engine.terminate(); this.engine = new EngineWorker(); this.attachEngine(); };
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
      else if (m.type === 'frame') { this.viewer.present(m, m.gen === this.drawingId); if(m.gen===this.pendingDraw?.gen){clearTimeout(this.pendingDraw.timer);this.pendingDraw.resolve();this.pendingDraw=null;} }
      else if (m.type === 'error') { const error=new Error(m.error); if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.reject(error);this.pendingDraw=null;}else this.onError(error); }
    };
    render.onerror = e => {const error=new Error(e.message || 'Le rendu de la carte a été interrompu.');if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.reject(error);this.pendingDraw=null;}else this.onError(error);};
    render.postMessage({ type: 'display', display: this.display });
    if(this.display.painted){this.brushSourcesSent=true;const {BRUSH_SOURCES}=await import('../render/assets/brushAssets');render.postMessage({type:'brushes',sources:BRUSH_SOURCES});}
  }
  run(action: Action, settings: V2Settings, world?: World, key?: string, townStage?:V2TownStage): Promise<World> {
    if (this.pending) return Promise.reject(new Error('Un calcul est déjà en cours.'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      try{this.engine.postMessage({ id, action, settings, ...generationWorldInput(action,world,this.retained),key, townStage,assetBase:document.baseURI });}catch(error){this.pending=null;reject(error instanceof Error?error:new Error(String(error)));}
    });
  }
  cancel(): void {
    if (!this.pending) return;
    this.pending.reject(new DOMException('Calcul annulé. La carte précédente est conservée.', 'AbortError'));
    this.pending = null;this.retained=undefined; this.engine.terminate(); this.engine = new EngineWorker(); this.attachEngine();
  }
  /** Imported projects replace the old worker source; release its heavyweight archives. */
  invalidateRetained():void{this.retained=undefined;this.engine.postMessage({type:'release'});}
  async clear():Promise<void>{
    this.benchActive=false;this.appearanceRevision++;this.bench?.dispose();this.bench=undefined;this.classicBackground=undefined;
    this.invalidateRetained();this.world=null;this.syncRenderer?.dispose();this.syncRenderer=null;
    if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.resolve();this.pendingDraw=null;}
    this.render?.terminate();this.render=null;await this.init();
  }
  async show(world: World, keepView = false): Promise<void> {
    const mapChanged = this.world?.mapSize !== world.mapSize;
    if(this.world!==world)this.benchMiniRevision=-1;
    this.world = world;
    this.syncRenderer?.dispose(); this.syncRenderer = null;
    const settings=this.appearanceSettings;
    const useBench=settings && settings.appearance?.renderer!=='classic' && (settings.appearance?.renderer==='bench'||!!settings.appearance?.terrainStyle||!!world.debug?.v2RustCities);
    if(useBench){
      const {BenchRenderer}=await import('./benchRenderer');
      this.bench??=new BenchRenderer(()=>{if(this.benchActive&&this.world)this.viewer.contentChanged(this.world.mapSize,true);});
      await this.bench.set(world,settings);
      this.benchActive=true;
      this.viewer.setSource({request:frame=>void this.drawBench(frame)});
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
      this.render.postMessage({ type: 'attach', gen, port: channel.port1 }, [channel.port1]);
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
  private async drawBench(frame:FrameRequest):Promise<void>{
    const revision=this.appearanceRevision;
    const renderer=this.bench;
    if(!renderer||!this.benchActive){this.viewer.present({...frame,mini:undefined,ms:0,band:0,scale:frame.view.scale},false);return;}
    try{
      const surface=renderer.draw(frame.view,frame.w,frame.h,frame.dpr);
      const cityStats=JSON.stringify(renderer.stats.city??{}),style=String(renderer.stats.style),backend=String(renderer.stats.renderer);
      const bitmap=await createImageBitmap(surface);
      if(!this.benchActive||revision!==this.appearanceRevision||this.bench!==renderer){this.viewer.present({...frame,bitmap,mini:undefined,ms:0,band:0,scale:frame.view.scale},false);return;}
      let mini:ImageBitmap|undefined;
      if(frame.mini&&this.world&&(this.benchMiniRevision!==revision||this.benchMiniSize!==frame.mini)){const size=this.world.mapSize;mini=await createImageBitmap(renderer.draw({cx:size/2,cy:size/2,scale:frame.mini/size},frame.mini,frame.mini,1));this.benchMiniRevision=revision;this.benchMiniSize=frame.mini;}
      if(!this.benchActive||revision!==this.appearanceRevision||this.bench!==renderer){this.viewer.present({...frame,bitmap,mini,ms:0,band:0,scale:frame.view.scale},false);return;}
      this.canvas.dataset.renderer=backend;this.canvas.dataset.renderStyle=style;
      this.canvas.dataset.cityRender=cityStats;
      this.viewer.present({...frame,bitmap,mini,ms:0,band:0,scale:frame.view.scale},this.benchActive&&revision===this.appearanceRevision);
    }catch(error){this.onError(error instanceof Error?error:new Error(String(error)));this.viewer.present({...frame,mini:undefined,ms:0,band:0,scale:frame.view.scale},false);}
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
    const a=settings.appearance;
    this.display={...this.display,colors:a?.colors,buildings:a?.buildings,layers:{roads:a?.roads??true},style:a?.style??settings.options.style,contours:a?.contours??settings.options.contours,landuse:a?.landuse??settings.options.landuse,labels:a?.labels??true,legend:a?.legend??false,cartouche:a?.cartouche??false,painted:a?.painted,vegetation:a?.vegetation};
    if(this.render&&a?.painted&&!this.brushSourcesSent){const {BRUSH_SOURCES}=await import('../render/assets/brushAssets');this.render.postMessage({type:'brushes',sources:BRUSH_SOURCES});this.brushSourcesSent=true;}
    if(this.render)this.render.postMessage({type:'display',display:this.display});
    const needsBench=a?.renderer!=='classic'&&(a?.renderer==='bench'||!!a?.terrainStyle||!!this.world?.debug?.v2RustCities);
    if(this.world&&(!this.render||this.benchActive||needsBench))await this.show(this.world,true);
    else if(this.world){this.canvas.dataset.renderer='Classic Canvas';this.canvas.dataset.renderStyle=this.display.style;this.canvas.dataset.cityRender='{}';this.viewer.invalidate();}
    else if(this.render)this.render.postMessage({type:'display',display:this.display});
    } catch(error) {
      this.appearanceSettings=previousSettings;this.display=previousDisplay;
      if(this.render)this.render.postMessage({type:'display',display:this.display});
      throw error;
    }
  }
  async prepare3dBackground():Promise<void>{
    if(this.benchActive){this.bench?.backgroundUrl();return;}
    if(!this.world)return;
    const key=JSON.stringify(this.display);
    if(this.classicBackground?.world===this.world&&this.classicBackground.key===key)return;
    const {renderSvg}=await import('../render/svg');
    const brushes=this.display.painted?(await import('../render/assets/brushAssets')).BRUSH_SOURCES:undefined;
    const svg=renderSvg(this.world,{...this.display,brushes,width:2048,labels:false,legend:false,cartouche:false,layers:{city:false,streets:false,labels:false,decor:false}});
    this.classicBackground={world:this.world,key,url:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`};
  }
  backgroundUrl():string|undefined{return this.benchActive?this.bench?.backgroundUrl():this.classicBackground?.url;}
  async exportBench(settings:V2Settings,size:number,layers:Partial<ExportLayers>):Promise<HTMLCanvasElement>{
    if(!this.world)throw new Error('Create a region first.');
    const {BenchRenderer}=await import('./benchRenderer');
    const world=this.world,snapshot={...settings,appearance:settings.appearance?structuredClone(settings.appearance):undefined},renderer=new BenchRenderer(()=>{},true,this.bench?.rasterContext());
    try{
      await renderer.set(world,snapshot,layers);
      const rendered=await renderer.capture(size),copy=document.createElement('canvas');copy.width=copy.height=size;copy.getContext('2d')!.drawImage(rendered,0,0);return copy;
    }finally{renderer.dispose();}
  }
  setDisplay(patch: Partial<DisplayOpts>): void {
    const next={...this.display,...patch};if(sameDisplay(this.display,next))return;this.display=next;
    if (this.render) this.render.postMessage({ type: 'display', display: this.display });
    else if (this.world) this.show({ ...this.world, options: { ...this.world.options, contours: this.display.contours ?? true, landuse: this.display.landuse ?? true, labels: this.display.labels } }, true);
  }
  destroy(): void { this.cancel();this.bench?.dispose(); if(this.pendingDraw){clearTimeout(this.pendingDraw.timer);this.pendingDraw.resolve();this.pendingDraw=null;}this.engine.terminate(); this.render?.terminate(); this.syncRenderer?.dispose(); this.viewer.destroy(); }
}
