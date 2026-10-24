// Retain real neural 40 km surfaces and the existing Render map on disk.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const webRoot=path.resolve(arg('--web-root','../magna-urbis-render-original-reference/web'));
const {chromium}=await import(pathToFileURL(path.join(webRoot,'node_modules/playwright/index.mjs')));
const out=path.resolve(arg('--out',fileURLToPath(new URL('../tiles',import.meta.url))));
const base=arg('--base','http://127.0.0.1:5203'),neural=arg('--neural','http://127.0.0.1:8894');
const assetsBase=arg('--assets-base','http://127.0.0.1:5197');
const families=[['mountains','Montagne','mountains',0],['coastal-plain','Plaine avec côte','flat',16],['hills','Collines','hills',0],['coastal-mountains','Montagne avec côte directe','mountains',16],['valley','Vallée','valley',0],['coastal-valley','Vallée avec côte','valley',16],['plateau','Plateau','plateau',0]];
const climates=[['arid','Aride',23,150],['cold','Froid',1,550],['mediterranean','Méditerranéen',16,600],['tropical','Tropical',26,2300],['temperate','Default',18,1000],['oceanic','Océanique',11,1300]];
await mkdir(out,{recursive:true});
await writeFile(path.join(out,'.gdignore'),'');
// Retained terrains can be regenerated with water without any neural service.
if(existsSync(path.join(out,'catalog.json'))){
 const catalog=JSON.parse(await readFile(path.join(out,'catalog.json'),'utf8'));
 if(catalog.tiles?.length===42&&catalog.tiles.every(t=>t.n===1334&&t.neural?.nativeDefinitionRetained&&existsSync(path.join(out,t.id,'height.f32')))){
  await import('./hydrate_tiles.mjs');process.exit(0);
 }
}
console.log('Opening local Render reference');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-software-rasterizer']});
try{
 const page=await browser.newPage({viewport:{width:1100,height:900}});
 page.on('console',message=>console.log('Render: '+message.text()));
 page.on('requestfailed',request=>console.error('Request failed: '+request.url()+' '+request.failure()?.errorText));
 await page.route(base+'/neural/**',async route=>{const response=await fetch(route.request().url().replace(base,assetsBase));await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||'application/octet-stream',body:Buffer.from(await response.arrayBuffer())})});
 page.on('pageerror',e=>console.error(String(e)));
 await page.goto(base+'/render-original-reference.html');
 await page.waitForFunction(()=>!!window.renderOriginalReference);
 console.log('Loading conditioning runtime');
 await page.evaluate(async ({runtime,look})=>{
  const {TerrainGl}=await import('./terrainGl.ts');
  console.log('Terrain renderer imported');
  const {neuralModule}=await import(runtime);
  console.log('Conditioning wrapper imported');
  window.tileModule=await neuralModule(location.origin+'/neural/');
  console.log('WASM conditioning initialized');
  window.tileCanvas=document.createElement('canvas');window.tileGpu=new TerrainGl(window.tileCanvas);
  window.tileLook=look;
  console.log('Reference look ready');
 },{runtime:'/@fs/'+path.join(webRoot,'../rust/bridge/neuralBrowser.ts').replaceAll('\\','/'),look:JSON.parse(await readFile(path.join(webRoot,'out/render-original-reference/source-v15/source.json'),'utf8')).look});
 console.log('Generating native decoder surfaces');
 const tiles=[];
 for(const [family,label,relief,coasts] of families)for(const [climate,climateLabel,temperature,precipitation] of climates){
  const id=family+'--'+climate,dir=path.join(out,id);await mkdir(dir,{recursive:true});
  const descriptor={id,label:label+' · '+climateLabel,family,climate,relief,coasts,width:40000,n:Math.ceil(40000/30),height:'height.f32',map:'map.png',seed:'tile40-'+family+'-20261024',temperature,precipitation};
  const retained=existsSync(path.join(dir,'tile.json'))?JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8')):null;
  if(!retained?.neural?.nativeDefinitionRetained||retained.n!==descriptor.n){
   const result=await page.evaluate(async({descriptor,neural})=>{
    const d=descriptor;
    const params={seed:d.seed,relief:d.relief,mix:'0.5',coasts:String(d.coasts),islands:'island',climate:d.climate,noise:'0.05',steps:'4',landScale:'1',detail:'1',temperature:String(d.temperature),precipitation:String(d.precipitation),temperatureStd:({arid:'800',cold:'1100',mediterranean:'550',tropical:'150',temperate:'600',oceanic:'450'})[d.climate],precipitationCv:({arid:'85',cold:'35',mediterranean:'60',tropical:'50',temperate:'35',oceanic:'25'})[d.climate],noiseTemperature:'0.5',noiseTemperatureStd:'0.5',noisePrecipitation:'0.5',noisePrecipitationCv:'0.5',histogram:'0,0,0,0,0',coarseModel:'original',baseModel:'original',decoderModel:'original'};
    if(d.relief==='flat')params.reliefFixed='20';else if(d.relief==='hills')params.reliefFixed='110';else if(d.relief==='plateau')params.reliefFixed='100';else params.reliefScale='1';
    const conditioning=JSON.parse(window.tileModule.conditioning_json(JSON.stringify(params),''));
    params.outputResolution='native';
    const response=await fetch(neural+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({params,conditioning,edited:false})});
    if(!response.ok)throw Error(await response.text());
    const raw=new Uint8Array(await response.arrayBuffer()),height=new Float32Array(raw.buffer);
    const meta=JSON.parse(response.headers.get('X-Neural-Meta')||'{}');
    if(height.length!==d.n*d.n||height.some(x=>!Number.isFinite(x))||meta.nativeDefinitionRetained!==true||meta.decoderNativeCell!==30||meta.stages?.join(',')!=='coarse,base,decoder')throw Error('Native decoder definition not delivered');
    let min=Infinity,max=-Infinity,land=0;for(const h of height){min=Math.min(min,h);max=Math.max(max,h);if(h>0)land++}
    const gpu=window.tileGpu;
    gpu.setBase({x:0,y:0,width:40000,n:d.n,data:height});
    gpu.setLook({...window.tileLook,climate:{temperature:d.temperature,precipitation:d.precipitation},globalMin:min,globalMax:max,contours:false,refine:false,layers:{...window.tileLook.layers,water:true},frame:false});
    gpu.setView({cx:20000,cy:20000,scale:4096/40000},4096,4096);
    const capture=gpu.captureExact2D({width:4096,height:4096,view:{cx:20000,cy:20000,scale:4096/40000}});
    const encode=b=>{let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s)};
    return {height:encode(raw),png:capture.canvas.toDataURL('image/png').split(',')[1],meta,min,max,landFraction:land/height.length};
   },{descriptor,neural});
   const height=Buffer.from(result.height,'base64');
   await writeFile(path.join(dir,'height.f32'),height);await writeFile(path.join(dir,'map.png'),Buffer.from(result.png,'base64'));
   await writeFile(path.join(dir,'tile.json'),JSON.stringify({...descriptor,min:result.min,max:result.max,landFraction:result.landFraction,neural:result.meta,heightSha256:createHash('sha256').update(height).digest('hex'),scope:'Real raw neural heightfield; existing Render map draped on the same relief. No hydrology postprocessing or local detail generation.'},null,2));
  }
  tiles.push({...JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8')),file:id+'/tile.json'});
  console.log(`${tiles.length}/42 ${descriptor.label}`);
 }
 if(tiles.length!==42||new Set(tiles.map(t=>t.id)).size!==42)throw Error('Incomplete catalog');
 await writeFile(path.join(out,'catalog.json'),JSON.stringify({format:'magna-tile40-catalog',version:1,width:40000,defaultTile:'mountains--temperate',families:families.map(f=>({id:f[0],label:f[1]})),climates:climates.map(c=>({id:c[0],label:c[1]})),tiles},null,2));
}finally{await browser.close()}
await import('./hydrate_tiles.mjs');
