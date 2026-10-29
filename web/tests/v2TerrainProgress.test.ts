import {afterEach,describe,expect,it,vi} from 'vitest';
import {gpuSetupDeadline,loadTerrainRuntime,type TerrainWorkProgress} from '../../rust/bridge/terrainProgress';
import {translateRuntimeMessage} from '../src/v2/runtimeMessages';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('observable terrain startup and bounded driver setup',()=>{
  it('streams the actual module bytes and reports compilation only after its body was consumed',async()=>{
    const events:{message:string;work?:TerrainWorkProgress}[]=[];
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3,4]));controller.close();}}),{headers:{'content-length':'4','content-type':'application/wasm'}})));
    await loadTerrainRuntime('https://local.test/engine.wasm',async response=>{expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1,2,3,4]);expect(events.at(-1)?.work?.stage).toBe('runtime-compile');},(message,work)=>events.push({message,work}));
    expect(events.at(-1)?.work?.stage).toBe('runtime-ready');expect(events.some(e=>e.work?.completed===4&&e.work.total===4)).toBe(true);
    expect(events.findIndex(e=>e.work?.stage==='runtime-compile')).toBeGreaterThan(events.findIndex(e=>e.work?.stage==='runtime-download'));
  });
  it('never compares decoded gzip bytes against the compressed Content-Length',async()=>{
    const events:TerrainWorkProgress[]=[];vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(32),{headers:{'content-length':'8','content-encoding':'gzip','content-type':'application/wasm'}})));
    await loadTerrainRuntime('https://local.test/engine.wasm',async response=>{expect(response.headers.has('content-encoding')).toBe(false);expect((await response.arrayBuffer()).byteLength).toBe(32);},(_message,work)=>{if(work)events.push(work);});
    expect(events.filter(e=>e.stage==='runtime-download').every(e=>!e.total)).toBe(true);expect(events.some(e=>e.completed===32)).toBe(true);
  });
  it('reports a failed download before attempting to compile HTML/error bytes',async()=>{
    const initialize=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>new Response('missing',{status:404})));
    await expect(loadTerrainRuntime('/missing.wasm',initialize)).rejects.toThrow('HTTP 404');expect(initialize).not.toHaveBeenCalled();
  });
  it('bounds only unresolved GPU setup and cancels its watchdog after success',async()=>{
    vi.useFakeTimers();const pending=gpuSetupDeadline(new Promise(()=>{}),40);const refused=expect(pending).rejects.toThrow('WebGPU');await vi.advanceTimersByTimeAsync(40);await refused;
    await expect(gpuSetupDeadline(Promise.resolve('ready'),40)).resolves.toBe('ready');expect(vi.getTimerCount()).toBe(0);
  });
  it('translates measured and indeterminate phase messages in both UI languages',()=>{
    const pairs=[['Moteur Rust/WASM · 13.0 / 13.0 Mio reçus','Rust/WASM engine · 13.0 / 13.0 MiB received'],['Moteur Rust/WASM · 13.0 Mio reçus','Rust/WASM engine · 13.0 MiB received'],['GPU · shaders d’érosion prêts 12/37','GPU · erosion shaders ready 12/37'],['CPU · échantillonnage du relief 512 × 512…','CPU · sampling the terrain 512 × 512…'],['GPU · encodage de 60 cycles de relief et 3 passes d’érosion…','GPU · encoding 60 terrain cycles and 3 erosion passes…'],['CPU · génération du relief et érosion…','CPU · generating terrain and erosion…']]as const;
    for(const[fr,en]of pairs){expect(translateRuntimeMessage(fr,'en')).toBe(en);expect(translateRuntimeMessage(en,'fr')).toBe(fr);}
  });
});
