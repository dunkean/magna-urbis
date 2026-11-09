import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  let resolve!: (value: boolean) => void, available=false;
  let ready = new Promise<boolean>(r => { resolve = r; });
  const candidates: any[] = [], originals: any[] = [];
  class View {
    active = true; settled = false; disposed = false; backend: string;
    constructor(backend = 'webgl') { this.backend=backend; (backend==='webgl'?originals:candidates).push(this); }
    getStatus() { return this.backend; } get isActive() { return this.active; } isSettled() { return this.settled; }
    transferTo(view: View) { view.active=this.active; } getCamera() { return {}; } setCamera() {} showStatus() {} dispose() { this.disposed=true; }
  }
  return { View, candidates, originals, get ready() { return ready; }, get available() { return available; }, resolve: (v:boolean)=>{available=v;resolve(v);}, reset() { available=false; candidates.length=0; originals.length=0; ready=new Promise(r=>{resolve=r;}); } };
});
vi.mock('../../src/ui/terrain3d',()=>({Terrain3d:class extends mocks.View { constructor() { super('webgl'); } }}));
vi.mock('../../src/ui/terrain3dGpu',()=>({prepareTerrain3dGpu:()=>mocks.ready,createTerrain3dGpu:()=>mocks.available ? new mocks.View('webgpu') : undefined}));
vi.mock('../../src/ui/rendererOverride',()=>({rendererOverride:()=>undefined}));
const fakeElement = () => ({ dataset:{}, style:{}, setAttribute(){},addEventListener(){},remove(){}, after(){}, getClientRects(){return [1];}, isConnected:true,clientWidth:100,clientHeight:100,offsetLeft:0,offsetTop:0,clientLeft:0,clientTop:0 });
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();mocks.reset();
  vi.stubGlobal('performance',{now:()=>Date.now()});
  vi.stubGlobal('navigator',{gpu:{}});vi.stubGlobal('document',{createElement:()=>fakeElement()});
  vi.stubGlobal('ResizeObserver',class { observe(){} disconnect(){} });vi.stubGlobal('MutationObserver',class { observe(){} disconnect(){} });
  vi.stubGlobal('getComputedStyle',()=>({zIndex:'0'}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
async function start() {
  const module=await import('../../src/ui/terrain3dRenderer');
  const canvas=fakeElement();const view=module.createTerrain3d(canvas as unknown as HTMLCanvasElement,()=>{});
  mocks.resolve(true);await module.terrain3dBackendReady();await Promise.resolve();await Promise.resolve();
  return {view,canvas};
}
describe('3D backend warmup',()=>{
  it('disposes an unready candidate after the deadline without replacing the working view',async()=>{
    const {view,canvas}=await start();expect(mocks.candidates).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(45200);
    expect(mocks.candidates[0].disposed).toBe(true);expect(mocks.originals[0].disposed).toBe(false);
    expect(view.getStatus('renderer')).toBe('webgl');expect(canvas.dataset).toMatchObject({rendererUpgrade:'timeout'});
    view.dispose();
  });
  it('promotes a candidate only once it has finished preparing',async()=>{
    const {view,canvas}=await start();mocks.candidates[0].settled=true;
    await vi.advanceTimersByTimeAsync(150);
    expect(mocks.originals[0].disposed).toBe(true);expect(mocks.candidates[0].disposed).toBe(false);
    expect(view.getStatus('renderer')).toBe('webgpu');expect(canvas.dataset).toMatchObject({rendererUpgrade:'ready'});
    view.dispose();
  });
  it('keeps the working frame while a cold Satellite shader takes more than ten seconds',async()=>{
    const {view}=await start();
    await vi.advanceTimersByTimeAsync(25000);
    expect(mocks.candidates[0].disposed).toBe(false);
    expect(view.getStatus('renderer')).toBe('webgl');
    mocks.candidates[0].settled=true;
    await vi.advanceTimersByTimeAsync(150);
    expect(view.getStatus('renderer')).toBe('webgpu');
    expect(mocks.originals[0].disposed).toBe(true);
    view.dispose();
  });
});
