/** Real WASM/WebGPU regression: early stop, selective replay, parity and coastal placement. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const web=fileURLToPath(new URL('..',import.meta.url)),root=resolve(web,'..');
const server=await createServer({configFile:false,root:web,logLevel:'warn',server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root]}},optimizeDeps:{noDiscovery:true,entries:[]},worker:{format:'es'},plugins:[{name:'checkpoints',configureServer(s){s.middlewares.use('/checkpoints',(_q,r)=>{r.setHeader('Content-Type','text/html');r.end('<!doctype html><title>Relief checkpoints</title>');});}}]});
await server.listen();
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--no-proxy-server']});
try {
  const page=await browser.newPage();page.on('pageerror',error=>console.error(error));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/checkpoints`);
  const result=await page.evaluate(async ({root,nativeServer})=>{
    const {sampleRustTerrain,releaseTerrainCheckpoints}=await import(`/@fs/${root}/rust/bridge/terrain.ts`);
    const {gpuContext}=await import(`/@fs/${root}/rust/bridge/terrainGpu.ts`);
    const base={source:'procedural',seed:'v2-checkpoints',width:2400,motifSize:2400,relief:'mountains',erosion:.5,mountainMix:.5,resolution:64,compute:'wasm',generationCompute:'cpu',climate:'temperate',coastMask:16,refine:false,hydrology:{enabled:false},procedural:{biome:false,regionalN:64,surfaceN:64,erosionTuning:{iterations:2,surfaceIterations:1},enabled:{phasor:false},wind:{iterations:2,transport:.2}}};
    const kernels=['initialize','coastCut','regional','regionalFinish','reconstruct','amplitude','ridged','surface','normalize','phasor','posterior','wind','coasts'];
    let runtime;
    const request=settings=>({id:1,generation:1,kind:'overview',display:'svg',retainField:true,runtime,settings,region:{x:0,y:0,extent:settings.width,resolution:64}});
    const check=(condition,message)=>{if(!condition)throw new Error(message);};
    const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
    class Output extends Error {constructor(height){super('requested output');this.height=height;}}
    async function preview(settings,until){
      const ran=[],cached=[];let last;
      try {await sampleRustTerrain(request(settings),undefined,undefined,{previews:true,until,
        async before(stage){ran.push(stage);},
        async after(stage,height){if(height)last=height;if(stage===until)throw new Output(height??last);},
        async cached(stage,height){cached.push(stage);if(height)last=height;if(stage===until)throw new Output(height??last);},
      });throw new Error('stage did not stop');}catch(error){if(!(error instanceof Output))throw error;return {height:error.height,ran:ran.filter(s=>kernels.includes(s)),cached};}
    }
    async function exercise(settings,nativeRuntime){
      runtime=nativeRuntime;
      releaseTerrainCheckpoints();
      const regional=await preview(settings,'regional');
      check(regional.ran.includes('initialize'),'first run did not initialize');
      const surface=await preview(settings,'surface');
      check(!surface.ran.includes('regional')&&surface.cached.includes('regional'),'regional prefix was replayed');
      const repeated=await preview(settings,'surface');
      check(repeated.ran.length===0,'unchanged surface ran kernels: '+repeated.ran.join(','));
      check(equal(surface.height,repeated.height),'cached surface changed');
      const changed={...settings,procedural:{...settings.procedural,erosionTuning:{...settings.procedural.erosionTuning,surfaceIterations:2}}};
      const resumed=await preview(changed,'surface');
      check(resumed.ran.join(',')==='surface','surface edit replayed upstream: '+resumed.ran.join(','));
      releaseTerrainCheckpoints();const fresh=await preview(changed,'surface');
      check(equal(resumed.height,fresh.height),'resumed surface differs from a fresh run');
      const firstWind=await preview(changed,'wind');
      const windSettings={...changed,procedural:{...changed.procedural,wind:{iterations:3,transport:.2}}};
      const wind=await preview(windSettings,'wind');
      check(wind.ran.join(',')==='wind','wind edit replayed upstream: '+wind.ran.join(','));
      check(!equal(firstWind.height,wind.height),'wind edit had no effect');
      const moved={...windSettings,procedural:{...windSettings.procedural,coastAfter:'surface'}};
      const movedOutput=await preview(moved,'coastCut');
      check(movedOutput.height.some(h=>h<0),'moved coastal cut lost its sea');
      const a=await sampleRustTerrain(request(moved));
      check(a.height.some(h=>h<0)&&a.height.some(h=>h>0),'final coast must have sea and land');
      releaseTerrainCheckpoints();const b=await sampleRustTerrain(request(moved));
      check(equal(a.height,b.height),'fresh full terrain differs after moving the coast');
      const coastPositions=[];
      for(const coastAfter of ['initialize','regionalFinish','amplitude','ridged','surface','normalize']){
        const variant={...moved,procedural:{...moved.procedural,coastAfter}};
        const cut=await preview(variant,'coastCut');check(cut.height.some(h=>h<0),'coast cut has no sea at '+coastAfter);
        const final=await sampleRustTerrain(request(variant));check(final.height.some(h=>h<0)&&final.height.some(h=>h>0),'final coast disappeared at '+coastAfter);
        coastPositions.push(coastAfter);
      }
      const noFinishing=await sampleRustTerrain(request({...moved,procedural:{...moved.procedural,coastAfter:'normalize',enabled:{...moved.procedural.enabled,coasts:false}}}));
      check(noFinishing.height.every(Number.isFinite),'late cut with coastal finishing disabled produced invalid terrain');
      return {regional:regional.ran,surfaceAfterRegional:surface.ran,repeated:repeated.ran,surfaceEdit:resumed.ran,windEdit:wind.ran,exactParity:true,finalCoast:true,coastPositions};
    }
    const cpu=await exercise(base);
    const adapter=await gpuContext();
    const gpu=adapter?await exercise({...base,compute:'gpu-f32',generationCompute:'gpu-erosion'}):{unavailable:true};
    const compact=await exercise({...base,procedural:{...base.procedural,preset:'compact',enabled:{phasor:false,surface:true}}});
    const compactGpu=adapter?await exercise({...base,compute:'gpu-f32',generationCompute:'gpu-erosion',procedural:{...base.procedural,preset:'compact',enabled:{phasor:false,surface:true}}}):undefined;
    const native=nativeServer?await exercise({...base,generationCompute:'native'},{profile:'local',server:nativeServer}):undefined;
    releaseTerrainCheckpoints();
    return {cpu,gpu,compact,compactGpu,native};
  },{root:root.replaceAll('\\','/'),nativeServer:process.env.MAGNA_NATIVE_STAGE_URL});
  assert(result.cpu.exactParity);
  await mkdir(resolve(web,'out/relief-checkpoints'),{recursive:true});
  await writeFile(resolve(web,'out/relief-checkpoints/report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {await browser.close();await server.close();}
