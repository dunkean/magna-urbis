import { afterEach, expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Decor } from '../src/ui/decor';
import { projectNativeBuildingRecords } from '../src/ui/urbanBuildingProjection';
import { mountCity3d } from '../src/ui/city3d';
import parentGuest from './fixtures/native-parent-assembly-guest-plan.json';
import { projectParentRecords } from '../src/ui/urbanParentVisual';
import { parent3dWindow } from '../src/ui/urbanParent3d';
import type { ParentWindowSnapshot } from '../src/ui/urbanParentColdWindow';
import type { NativeParentBatch } from '../../rust/bridge/nativeParentContract';

const spies = vi.hoisted(() => ({ scenes: [] as unknown[], realize: vi.fn(), callbacks: [] as (() => void)[] }));
vi.mock('../../rust/bridge/architecture', () => ({ realizeUrbanBuilding: spies.realize }));
vi.mock('../src/ui/terrain3d', () => ({ TERRAIN_3D_FOV: Math.PI/3,
  Terrain3d: class {
    camera={x:0,y:0,distance:200,pitch:.8,yaw:0,exaggeration:1};
    constructor() {}
    setSurface() {} setTexture() {} setGroundMaterial() {} setForest() {} setHeightSampler() {} setTileLoader() {} resize() {} setActive() {} fit() {} north() {} invalidateTiles() {}
    getCamera() {return this.camera;} setCamera(c: typeof this.camera) {this.camera=c;}
    worldToScreen() {return [1,1];} setBuildings(scene: unknown) {spies.scenes.push(scene);}
    replaceBuildings() {return [];} getLodInfo() {return {};} dispose() {} pickBuilding() {return undefined;}
  },
}));

/** Minimal DOM sink for the consumer contract; no browser or WebGL is started. */
class ElementSink {
  hidden=false; innerHTML=''; textContent=''; className=''; id=''; dataset: Record<string,string>={}; style: Record<string,string>={};
  clientWidth=800;clientHeight=600;width=2;height=2;disabled=false;
  onclick?:()=>void; onchange?:()=>void; oninput?:()=>void;
  listeners=new Map<string,(event: unknown)=>void>(); children=new Map<string,ElementSink>();
  childNodes=[];
  setAttribute() {} closest() {return this;}
  append() {} remove() {} focus() {} addEventListener(name:string,listener:(event:unknown)=>void) {this.listeners.set(name,listener);}
  querySelector(name:string) {let child=this.children.get(name);if(!child){child=new ElementSink();this.children.set(name,child);}return child;}
  getContext() {return {createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:()=>{}};}
}
function environment() {
  const elements: ElementSink[]=[];
  vi.stubGlobal('document',{getElementById:()=>({}),createElement:()=>{const e=new ElementSink();elements.push(e);return e;}});
  vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});
  return {host:new ElementSink(),elements};
}
const native=fixture.chunks[0].delta as unknown as PlacementBatch;
const decor={meta:{id:'fixture',seed:'fixture',tags:{}},raster:{n:2,width:100,height:new Float32Array(4),water:new Uint8Array(4)}} as unknown as Decor;
afterEach(()=>{vi.unstubAllGlobals();spies.scenes.length=0;spies.callbacks.length=0;spies.realize.mockClear();});

it('uses the actual getProjection consumer API and never sends a projection to the legacy native fallback', () => {
  const env=environment(), projection=projectNativeBuildingRecords(native.buildings), legacy=vi.fn(()=>native);
  const view=mountCity3d({host:env.host as unknown as HTMLElement,getDecor:()=>decor,getScene:legacy,getProjection:()=>projection});
  try {
    view.show();expect(legacy).not.toHaveBeenCalled();expect(view.stats()).toMatchObject({buildings:2,compact:2,detailed:0});
    const scene=spies.scenes.at(-1) as {buildings: unknown[]};expect(scene.buildings[0]).toBe(projection.buildings[0]);
    const root=env.elements[0], detailButton=root.querySelector('[data-detail]');
    expect(detailButton.disabled).toBe(true);detailButton.onclick?.();
    expect(spies.realize).not.toHaveBeenCalled();expect('resolved' in projection.buildings[0]).toBe(false);
  } finally {view.dispose();}
});

it('renders a native parent member window through the real 3D consumer with no legacy plan realization', () => {
  const env=environment(), batch:NativeParentBatch=JSON.parse(parentGuest.data.batch_json), records=projectParentRecords(batch.parents,batch.materials);
  const projection=parent3dWindow({...records,complete:true,reason:''} as ParentWindowSnapshot), legacy=vi.fn(()=>native);
  const view=mountCity3d({host:env.host as unknown as HTMLElement,getDecor:()=>decor,getScene:legacy,getProjection:()=>projection});
  try{
    view.show();expect(legacy).not.toHaveBeenCalled();expect(view.stats()).toMatchObject({buildings:2,compact:2,detailed:0});
    const scene=spies.scenes.at(-1) as {buildings:unknown[]};expect(scene.buildings).toEqual(projection.buildings);
    expect(env.elements[0].querySelector('[data-detail]').disabled).toBe(true);expect(spies.realize).not.toHaveBeenCalled();
  }finally{view.dispose();}
});

it('rejects a cached exterior from an earlier same-ID projection and preserves empty-index precedence', () => {
  const env=environment();let projection=projectNativeBuildingRecords(native.buildings), cached: readonly PlacedBuilding[]=[];
  const update=vi.fn(),unsubscribe=vi.fn(),legacy=vi.fn(()=>native);
  const view=mountCity3d({host:env.host as unknown as HTMLElement,getDecor:()=>decor,getScene:legacy,getProjection:()=>projection,
    details:{setActiveView:vi.fn(),update,cached:()=>cached,subscribe:fn=>{spies.callbacks.push(fn);return unsubscribe;}}});
  try {
    view.show();expect(update).toHaveBeenCalled();
    // The native record really exists, but its old contour identity does not
    // belong to the re-parsed generation now indexed by the consumer.
    cached=[native.buildings[0]];projection=projectNativeBuildingRecords(structuredClone(native.buildings));
    view.refresh();spies.callbacks[0]();
    expect(view.stats()).toMatchObject({buildings:2,compact:2,detailed:0});
    projection=projectNativeBuildingRecords([]);view.refresh();
    expect(view.stats().buildings).toBe(0);expect(legacy).not.toHaveBeenCalled();
    expect(spies.realize).not.toHaveBeenCalled();
  } finally {view.dispose();expect(unsubscribe).toHaveBeenCalled();}
});
