import {chromium} from 'playwright';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const web=fileURLToPath(new URL('..',import.meta.url)),root=resolve(web,'..'),out=resolve(web,'out/procedural-stages');await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,root:web,logLevel:'warn',server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root]}},optimizeDeps:{noDiscovery:true,entries:[]},worker:{format:'es'},plugins:[{name:'stages',configureServer(s){s.middlewares.use('/stages',(_q,r)=>{r.setHeader('Content-Type','text/html');r.end('<!doctype html><body>Stage validation</body>');});}}]});await server.listen();
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--no-proxy-server']});
try{
 const page=await browser.newPage();page.on('pageerror',e=>console.error(e));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/stages`);
 const r=await page.evaluate(async root=>{
  const {sampleRustTerrain}=await import(`/@fs/${root}/rust/bridge/terrain.ts`),{generateGpuTerrain}=await import(`/@fs/${root}/rust/bridge/terrainErosion.ts`),{generateCompactTerrain}=await import(`/@fs/${root}/rust/bridge/terrainCompactErosion.ts`),{gpuContext}=await import(`/@fs/${root}/rust/bridge/terrainGpu.ts`);
  const base={source:'procedural-phasor',seed:'stages-parity',width:5000,motifSize:3000,relief:'mountains',erosion:1,mountainMix:.5,resolution:128,compute:'gpu-f32',generationCompute:'gpu-erosion',climate:'temperate',phasor:{quality:'balanced',intensity:1},hydrology:{enabled:false},coastMask:0,refine:false};
  const request=settings=>({id:1,generation:1,kind:'overview',display:'gl',settings,region:{x:0,y:0,extent:settings.width,resolution:128},retainField:true});
  await sampleRustTerrain(request(base));const context=await gpuContext(),rows=[];
  for(const [source,fn] of [['procedural',generateGpuTerrain],['procedural-phasor',generateCompactTerrain]]){
   const settings={...base,source},events=[];const control={async before(stage){events.push('before:'+stage);},async after(stage,h){if(h?.some(x=>!Number.isFinite(x)))throw new Error('Non-finite preview');events.push('after:'+stage);}};
   const t=performance.now(),fast=await fn(context,settings),fastMs=performance.now()-t;const start=performance.now(),stepped=await fn(context,settings,{nativeEnvironmentMs:0,control});let max=0;for(let i=0;i<fast.length;i++)max=Math.max(max,Math.abs(fast[i]-stepped[i]));
   rows.push({source,fastMs,steppedMs:performance.now()-start,maxDifference:max,events});
  }
  const {erodeWindGpu}=await import(`/@fs/${root}/rust/bridge/terrainWind.ts`);const field=Float32Array.from({length:64*64},(_,i)=>100+20*Math.exp(-((i%64-32)**2+(Math.floor(i/64)-32)**2)/150));
  const a=await erodeWindGpu(context,field,640,{iterations:12,azimuth:45,transport:.8}),b=await erodeWindGpu(context,field,640,{iterations:12,azimuth:225,transport:.8});let mass=0,change=0,dir=0;for(let i=0;i<a.length;i++){mass+=a[i]-field[i];change=Math.max(change,Math.abs(a[i]-field[i]));dir=Math.max(dir,Math.abs(a[i]-b[i]));}if(!a.every(Number.isFinite))throw new Error('Wind produced invalid terrain');
  const variants=[];
  const small={...base,procedural:{biome:false,regionalN:128,surfaceN:128,erosionTuning:{iterations:4},enabled:{ridged:false,surface:false,phasor:false}}};
  const variantsToCheck=[
   ['all-optional-off',generateCompactTerrain,{...small,procedural:{...small.procedural,enabled:{...small.procedural.enabled,regional:false,regionalFinish:false,amplitude:false,normalize:false}}}],
   ['original-plus-phasor-bspline',generateGpuTerrain,{...small,source:'procedural',procedural:{...small.procedural,reconstruction:'bspline',enabled:{...small.procedural.enabled,phasor:true}}}],
   ['compact-ridged-surface-cubic',generateCompactTerrain,{...small,procedural:{...small.procedural,reconstruction:'cubic',erosionTuning:{iterations:4,surfaceIterations:2,detail:.1},enabled:{ridged:true,surface:true,phasor:false}}}],
  ];
  for(const [name,fn,settings] of variantsToCheck){const h=await fn(context,settings);variants.push({name,finite:h.every(Number.isFinite),min:Math.min(...h.subarray(0,60000)),max:Math.max(...h.subarray(0,60000))});}
  const wet=await generateCompactTerrain(context,{...small,climate:'tropical',procedural:{...small.procedural,biome:true}}),dry=await generateCompactTerrain(context,{...small,climate:'arid',procedural:{...small.procedural,biome:true}});let biomeDifference=0;for(let i=0;i<wet.length;i++)biomeDifference=Math.max(biomeDifference,Math.abs(wet[i]-dry[i]));
  const cpuSettings={...base,source:'procedural',compute:'wasm',generationCompute:'cpu',erosionTuning:{iterations:4,surfaceIterations:0},procedural:{biome:true,posterior:{mode:'none'},wind:{iterations:2,transport:.4}},climate:'arid',seed:'cpu-wind'};
  const cpu=await sampleRustTerrain(request(cpuSettings)),cpuNoWind=await sampleRustTerrain(request({...cpuSettings,procedural:{...cpuSettings.procedural,wind:{iterations:0}}}));let cpuWindDifference=0;for(let i=0;i<cpu.height.length;i++)cpuWindDifference=Math.max(cpuWindDifference,Math.abs(cpu.height[i]-cpuNoWind.height[i]));
  const cpuPhasor=await sampleRustTerrain(request({...cpuSettings,procedural:{biome:true,wind:{iterations:0},enabled:{phasor:true}}}));let cpuPhasorDifference=0;for(let i=0;i<cpu.height.length;i++)cpuPhasorDifference=Math.max(cpuPhasorDifference,Math.abs(cpuPhasor.height[i]-cpuNoWind.height[i]));
  const cpuParitySettings={...cpuSettings,seed:'cpu-stage-parity'},cpuFast=await sampleRustTerrain(request(cpuParitySettings));const cpuEvents=[];const cpuStep=await sampleRustTerrain(request(cpuParitySettings),undefined,undefined,{previews:true,async before(s){cpuEvents.push('before:'+s);},async after(s,h){if(h?.some(v=>!Number.isFinite(v)))throw new Error('Invalid CPU stage');cpuEvents.push('after:'+s);}});let cpuStageDifference=0;for(let i=0;i<cpuFast.field.data.length;i++)cpuStageDifference=Math.max(cpuStageDifference,Math.abs(cpuFast.field.data[i]-cpuStep.field.data[i]));
  const fullEvents=[];const start=performance.now();
  // Full bridge uses the same optional controller as the worker, including posterior/coast/water stages.
  const fullData=await sampleRustTerrain(request({...base,seed:'stages-full',procedural:{biome:true,wind:{iterations:2,transport:.2},posterior:{mode:'erosion',strength:.2}},coastMask:16}),undefined,undefined,{async before(s){fullEvents.push('before:'+s);},async after(s,h){if(h?.some(x=>!Number.isFinite(x)))throw new Error('Invalid bridge preview');fullEvents.push('after:'+s);}});
  const fullMs=performance.now()-start,{DEFAULT_HYDROLOGY}=await import(`/@fs/${root}/rust/bridge/hydrology.ts`),waterChecks=[];
  for(const engine of ['rust','vector']){
   const terrain=await sampleRustTerrain(request({...base,seed:'stages-full',procedural:{biome:true,wind:{iterations:2,transport:.2},posterior:{mode:'erosion',strength:.2}},coastMask:16,hydrology:{...DEFAULT_HYDROLOGY,enabled:true,engine,compute:'cpu',resolution:256,vectorResolution:512,condMode:'none'}}));
   waterChecks.push({engine,finite:terrain.height.every(Number.isFinite)&&terrain.field.data.every(Number.isFinite),present:!!(engine==='rust'?terrain.hydrology:terrain.water),error:terrain.hydrologyError??null});
  }
  Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});const noGpu=await sampleRustTerrain(request({...cpuSettings,seed:'without-webgpu'}),undefined,undefined,{previews:false,async before(){},async after(){}});
  return {cpuParity:{maxDifference:cpuStageDifference,events:cpuEvents,noGpuFinite:noGpu.height.every(Number.isFinite),noGpuBackend:noGpu.generationBackend},rows,variants,biomeDifference,cpu:{backend:cpu.generationBackend,finite:cpu.height.every(Number.isFinite)&&cpuPhasor.height.every(Number.isFinite),windDifferenceM:cpuWindDifference,phasorDifferenceM:cpuPhasorDifference},wind:{massErrorM:mass,maxChangeM:change,directionDifferenceM:dir},full:{events:fullEvents,ms:fullMs,backend:fullData.generationBackend,finite:fullData.height.every(Number.isFinite)},waterChecks};
 },root.replaceAll('\\','/'));
 for(const row of r.rows){assert.equal(row.maxDifference,0);assert(row.events.includes('after:surface'));}
 assert(Math.abs(r.wind.massErrorM)<.05);assert(r.wind.maxChangeM>.001);assert(r.wind.directionDifferenceM>.001);assert(r.full.finite);assert(r.full.events.includes('after:wind'));assert(r.full.events.includes('after:hydrology'));
 assert(r.variants.every(v=>v.finite));assert(r.biomeDifference>.01);assert(r.cpu.finite);assert.equal(r.cpu.backend,'cpu');assert(r.cpu.windDifferenceM>.001);assert(r.cpu.phasorDifferenceM>.0001);
 assert.equal(r.cpuParity.maxDifference,0);assert(r.cpuParity.events.includes('after:initialize'));assert(r.cpuParity.noGpuFinite);assert.equal(r.cpuParity.noGpuBackend,'cpu');
 assert(r.waterChecks.every(v=>v.finite&&v.present&&!v.error));
 await writeFile(resolve(out,'gpu-report.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));
}finally{await browser.close();await server.close();}
