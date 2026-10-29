// Real browser WebGPU benchmark. Own lightweight Vite server; no application boot.
// node scripts/benchmark_compact_terrain.mjs [--quick] [--out out/compact-terrain]
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
const web=fileURLToPath(new URL('..',import.meta.url)),root=resolve(web,'..');
const args=process.argv.slice(2),quick=args.includes('--quick'),singleWidth=args.includes('--width')?Number(args[args.indexOf('--width')+1]):5000,out=resolve(web,args.includes('--out')?args[args.indexOf('--out')+1]:'out/compact-terrain');
await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,root:web,logLevel:'warn',server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root]}},optimizeDeps:{noDiscovery:true,entries:[]},worker:{format:'es'},plugins:[{name:'compact-bench-page',configureServer(s){s.middlewares.use('/compact-bench',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body>Compact terrain benchmark</body></html>');});}}]});
await server.listen();
const address=server.httpServer.address(),origin=`http://127.0.0.1:${address.port}`;
console.log('Benchmark HTTP server:',origin);
const browserServer=await chromium.launchServer({channel:process.env.MAGNA_BROWSER_CHANNEL??'msedge',headless:true,timeout:20000,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--no-proxy-server']});
console.log('Benchmark browser launched');
const browser=await chromium.connect(browserServer.wsEndpoint());
console.log('Benchmark browser connected');
const watchdog=setTimeout(()=>{const pid=browserServer.process()?.pid;if(pid)execFile('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true},()=>{});},240000);
try{
  const page=await browser.newPage();page.on('pageerror',e=>console.error('PAGE',e.message));
  await page.goto(`${origin}/compact-bench`,{waitUntil:'domcontentloaded',timeout:20000});
  console.log('Browser connected; importing generation modules.');
  const result=await page.evaluate(async({root,quick,water,extra,singleWidth})=>{
    const {sampleRustTerrain}=await import(`/@fs/${root}/rust/bridge/terrain.ts`);
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)throw new Error('No WebGPU adapter available');
    const info=adapter.info;
    const rows=[],tiles=[];
    for(const width of quick?[singleWidth]:[5000,10000])for(const climate of quick?['temperate']:['temperate','arid','tropical']){
      const settings={source:'procedural-phasor',seed:`compact-${width}`,width,motifSize:3000,relief:'mountains',erosion:1,mountainMix:.5,resolution:512,
        compute:'gpu-f32',generationCompute:'gpu-erosion',climate,phasor:{quality:'balanced',intensity:1},hydrology:{enabled:false},coastMask:0,refine:false};
      const start=performance.now();
      const data=await sampleRustTerrain({id:rows.length+1,generation:rows.length+1,kind:'overview',display:'gl',settings,region:{x:0,y:0,extent:width,resolution:512},retainField:true},undefined,(message)=>console.debug(message));
      const ms=performance.now()-start;
      if(data.height.some(v=>!Number.isFinite(v)))throw new Error('Non-finite terrain');
      const field=data.field?.data??data.height,n=data.field?.n??data.resolution;
      let lo=Infinity,hi=-Infinity,sum=0,slope=0,hash=2166136261;
      for(let i=0;i<field.length;i++){lo=Math.min(lo,field[i]);hi=Math.max(hi,field[i]);sum+=field[i];if(i%n) slope+=Math.abs(field[i]-field[i-1]);}
      for(const byte of new Uint8Array(field.buffer,field.byteOffset,field.byteLength))hash=Math.imul(hash^byte,16777619);
      rows.push({width,climate,ms,prepareMs:data.prepareMs,backend:data.generationBackend,sampling:data.backend,n,lo,hi,mean:sum/field.length,meanSlopeX:slope/field.length/(width/n),hash:(hash>>>0).toString(16),profiles:data.erosionProfile});
      if(quick||climate==='temperate')tiles.push({width,climate,n,heights:Array.from(field)});
    }
    // Actual before/after heights, plus scalar reference samples. No cached replay.
    const {generateCompactTerrain}=await import(`/@fs/${root}/rust/bridge/terrainCompactErosion.ts`);
    const {gpuContext}=await import(`/@fs/${root}/rust/bridge/terrainGpu.ts`);
    const {phasorAt,phasorUniforms}=await import(`/@fs/${root}/rust/bridge/terrainPhasor.ts`);
    const context=await gpuContext(),s={source:'procedural-phasor',seed:'compact-proof',width:5000,motifSize:3000,relief:'mountains',erosion:1,mountainMix:.5,resolution:512,climate:'temperate',phasor:{quality:'balanced',intensity:0}};
    const bare=await generateCompactTerrain(context,s);s.phasor.intensity=1;const detail=await generateCompactTerrain(context,s);const again=await generateCompactTerrain(context,s);
    const n=1024,cell=s.width/n,u=phasorUniforms(s),at=(x,y)=>bare[Math.max(0,Math.min(1023,y))*1024+Math.max(0,Math.min(1023,x))];
    const height=(x,y)=>{const px=Math.max(0,Math.min(1023,x/cell-.5)),py=Math.max(0,Math.min(1023,y/cell-.5)),a=Math.floor(px),b=Math.floor(py),tx=px-a,ty=py-b;return (at(a,b)*(1-tx)+at(a+1,b)*tx)*(1-ty)+(at(a,b+1)*(1-tx)+at(a+1,b+1)*tx)*ty;};
    let square=0,max=0,changed=0,repeatMax=0,cpuGpuMax=0;
    for(let i=0;i<bare.length;i++){const d=detail[i]-bare[i];square+=d*d;max=Math.max(max,Math.abs(d));changed+=Math.abs(d)>.001?1:0;repeatMax=Math.max(repeatMax,Math.abs(detail[i]-again[i]));}
    for(let j=0;j<64;j++){const x=32+j*15,y=128+(j*97)%768,i=y*n+x;const cpu=phasorAt((x+.5)*cell,(y+.5)*cell,cell,u[1],u[3],u[2],height);cpuGpuMax=Math.max(cpuGpuMax,Math.abs(cpu-detail[i]));}
    if(max<.001||cpuGpuMax>.05||repeatMax>.001)throw new Error(`Phasor invariant failed: max=${max}, scalar=${cpuGpuMax}, repeat=${repeatMax}`);
    tiles.push({width:5000,climate:'before-phasor',n,heights:Array.from(bare)},{width:5000,climate:'after-phasor',n,heights:Array.from(detail)});
    const proof={deltaRmsM:Math.sqrt(square/bare.length),deltaMaxM:max,changedOver1mmFraction:changed/bare.length,repeatMaxM:repeatMax,cpuGpuMaxM:cpuGpuMax};
    const waterRows=[];
    if(water){
      const {DEFAULT_HYDROLOGY}=await import(`/@fs/${root}/web/src/v2/terrainSettings.ts`);
      for(const width of [5000,10000]){
        const settings={...s,width,seed:`compact-water-${width}`,compute:'gpu-f32',generationCompute:'gpu-erosion',hydrology:{...DEFAULT_HYDROLOGY,engine:'rust',compute:'cpu',condMode:'none',resolution:512}};
        const start=performance.now();const data=await sampleRustTerrain({id:200+width,generation:200+width,kind:'overview',display:'gl',settings,region:{x:0,y:0,extent:width,resolution:512},retainField:true});
        if(data.hydrologyError||!data.hydrology)throw new Error(data.hydrologyError??'Hydrology missing');
        const h=data.hydrology;let sq=0,max=0;for(let i=0;i<h.adjustedHeight.length;i++){const d=h.adjustedHeight[i]-h.baseHeight[i];sq+=d*d;max=Math.max(max,Math.abs(d));}
        waterRows.push({width,totalMs:performance.now()-start,prepareMs:data.prepareMs,hydrologyMs:h.generationMs,rivers:h.riverCount,lakes:h.lakeCount,adjustmentRmsM:Math.sqrt(sq/h.adjustedHeight.length),maxAdjustmentM:max,finite:h.adjustedHeight.every(Number.isFinite)});
      }
    }
    const extraRows=[];
    if(extra)for(const c of [{relief:'flat'},{relief:'valley'},{relief:'canyon'},{relief:'mountains',coastMask:255},{relief:'hills',cpu:true}]){
      const settings={...s,seed:`compact-extra-${c.relief}-${c.coastMask??0}`,coastMask:c.coastMask??0,islandMode:'island',relief:c.relief,phasor:{quality:'fast',intensity:.7},compute:c.cpu?'wasm':'gpu-f32',generationCompute:c.cpu?'cpu':'gpu-erosion',hydrology:{enabled:false}};
      const start=performance.now();const data=await sampleRustTerrain({id:300+extraRows.length,generation:300+extraRows.length,kind:'overview',display:'gl',settings,region:{x:0,y:0,extent:settings.width,resolution:128},retainField:true});
      if(data.height.some(v=>!Number.isFinite(v)))throw new Error('Invalid extra case');
      if(c.coastMask&&data.coastBackend!=='gpu-f32')throw new Error(`Coastal GPU fallback: ${data.coastReason}`);
      if(c.coastMask&&!data.height.some(v=>v<0))throw new Error('Coast has no sea');
      extraRows.push({...c,totalMs:performance.now()-start,backend:data.generationBackend,coastBackend:data.coastBackend,min:Math.min(...data.height),max:Math.max(...data.height)});
    }
    return {extraRows,userAgent:navigator.userAgent,gpu:{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter},rows,proof,waterRows,tiles};
  },{root:root.replace(/\\/g,'/'),quick,singleWidth,water:args.includes('--water'),extra:args.includes('--extra')});
  for(const tile of result.tiles)await writeFile(resolve(out,`${tile.width}-${tile.climate}.f32`),Buffer.from(new Float32Array(tile.heights).buffer));
  delete result.tiles;
  await writeFile(resolve(out,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error);throw error;}finally{
  clearTimeout(watchdog);
  await Promise.race([browser.close(),new Promise(r=>setTimeout(r,3000))]);
  await browserServer.close().catch(()=>{});await server.close();
}
