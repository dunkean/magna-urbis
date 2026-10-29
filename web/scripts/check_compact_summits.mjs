// End-to-end summit regression: physical GPU source, sampling, and V2 projection.
// MAGNA_BROWSER_CHANNEL=chrome node scripts/check_compact_summits.mjs --out out/compact-summits-before
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const web=fileURLToPath(new URL('..',import.meta.url)),root=resolve(web,'..');
const args=process.argv.slice(2),out=resolve(web,args.includes('--out')?args[args.indexOf('--out')+1]:'out/compact-summits');
await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,root:web,logLevel:'warn',server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root]}},optimizeDeps:{noDiscovery:true,entries:[]},worker:{format:'es'},plugins:[{name:'summit-page',configureServer(s){s.middlewares.use('/summits',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><body>Summit regression</body>');});}}]});
await server.listen();
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--no-proxy-server']});
try{
  const page=await browser.newPage();page.on('pageerror',e=>console.error(e));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/summits`);
  const result=await page.evaluate(async root=>{
    const {sampleRustTerrain}=await import(`/@fs/${root}/rust/bridge/terrain.ts`);
    const {projectEngineTerrain}=await import(`/@fs/${root}/web/src/v2/terrainProjection.ts`);
    const summarize=(a,n,width)=>{
      const sorted=a.slice().sort(),lo=sorted[0],hi=sorted.at(-1),q80=sorted[Math.floor(a.length*.8)],bins=new Map();
      let nearMax=0,flatTop=0,upper=0,exactFlat=0;
      for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
        const i=y*n+x,h=a[i],dif=Math.max(Math.abs(h-a[i-1]),Math.abs(h-a[i+1]),Math.abs(h-a[i-n]),Math.abs(h-a[i+n]));
        if(Math.abs(h-hi)<.0005)nearMax++;
        if(dif<.0005)exactFlat++;
        if(h>=q80){upper++;if(dif/(width/n)<.001)flatTop++;const k=Math.round(h*100);bins.set(k,(bins.get(k)??0)+1);}
      }
      const mostCommon=[...bins].sort((a,b)=>b[1]-a[1])[0];
      return {lo,hi,p80:q80,p99:sorted[Math.floor(a.length*.99)],maxPlateauFraction:nearMax/a.length,flatUpperFraction:flatTop/upper,exactFlatFraction:exactFlat/a.length,upperMode:mostCommon?.[0]/100,upperModeFraction:mostCommon?.[1]/upper};
    };
    const rows=[],tiles=[];
    const cases=[
      {seed:'magna-urbis-v2',width:6000,motifSize:10000},
      {seed:'magna-urbis-v2',width:6000,motifSize:10000,v2Defaults:true},
      {seed:'42',width:6000,motifSize:10000},
      {seed:'compact-proof',width:5000,motifSize:3000},
      {seed:'magna-urbis-v2',width:10000,motifSize:10000},
      {seed:'42',width:5000,motifSize:50000},
      {seed:'compact-proof',width:10000,motifSize:3000},
    ];
    for(const c of cases){
      const settings={source:'procedural-phasor',relief:'mountains',erosion:1,mountainMix:.5,resolution:512,compute:'gpu-f32',generationCompute:'gpu-erosion',climate:'temperate',phasor:{quality:'balanced',intensity:1},hydrology:{enabled:false},coastMask:0,refine:false,...c};
      if(c.v2Defaults){const {defaultSettings}=await import(`/@fs/${root}/web/src/v2/settings.ts`);const {effectiveTerrainSettings}=await import(`/@fs/${root}/web/src/v2/terrainSettings.ts`);const v2=defaultSettings();v2.options.relief='mountains';v2.runtime.source='procedural-phasor';Object.assign(settings,effectiveTerrainSettings(v2,c.width),{relief:'mountains',compute:'gpu-f32',generationCompute:'gpu-erosion'});}
      const start=performance.now();
      const d=await sampleRustTerrain({id:rows.length,generation:rows.length,kind:'overview',display:'gl',settings,region:{x:0,y:0,extent:c.width,resolution:512},retainField:true});
      const projected=projectEngineTerrain(d),field=d.field?.data??d.height,n=d.field?.n??512;
      rows.push({...c,ms:performance.now()-start,globalMax:d.globalMaxHeight,hydrologyError:d.hydrologyError,hydrology:!!d.hydrology,vector:!!d.water,raw:summarize(field,n,c.width),overview:summarize(d.height,512,c.width),v2:summarize(projected.height.data,512,c.width)});
      tiles.push({...c,n,kind:'physical',values:Array.from(field)},{...c,n:512,kind:'overview',values:Array.from(d.height)});
    }
    return {rows,tiles};
  },root.replaceAll('\\','/'));
  for(const tile of result.tiles)await writeFile(resolve(out,`${tile.seed}-${tile.width}-${tile.motifSize}${tile.v2Defaults?'-v2':''}-${tile.kind}.f32`),Buffer.from(new Float32Array(tile.values).buffer));
  delete result.tiles;
  await writeFile(resolve(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await server.close();}
