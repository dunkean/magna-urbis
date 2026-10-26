// Add the Terrain Bench vector water chain to retained native neural terrains.
// No neural service is needed. Raw height.f32 remains the immutable source.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const web=path.resolve(arg('--web-root','../magna-urbis-render-original-reference/web'));
const out=path.resolve(arg('--out',fileURLToPath(new URL('../tiles',import.meta.url))));
await writeFile(path.join(out,'.gdignore'),''); // Loaded explicitly, never imported as Godot assets.
const {tsImport}=await import(pathToFileURL(path.join(web,'node_modules/tsx/dist/esm/api/index.mjs')));
const load=p=>tsImport(pathToFileURL(path.join(web,p)).href,import.meta.url);
const {computeVectorWater}=await load('src/ui/vectorWater.ts');
const {runoffModel}=await load('src/ui/waterBalance.ts');
const {vectorWaterSvg,vectorOverlayPixels,lakeShores}=await load('src/ui/vectorWaterRender.ts');
const {encodePng}=await load('src/render/raster.ts');
const {waterMaterialPixels}=await load('src/render/terrainWater.ts');
const {terrainStyle}=await load('src/render/terrainStyle.ts');
const {lakeField}=await load('src/ui/lakeGeometry.ts');
const {chromium}=await import(pathToFileURL(path.join(web,'node_modules/playwright/index.mjs')));
const {Resvg}=await import(pathToFileURL(path.join(web,'node_modules/@resvg/resvg-js/index.js')));
const catalog=JSON.parse(await readFile(path.join(out,'catalog.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-software-rasterizer','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=native']});
const report={version:1,engine:'vector',startedAt:new Date().toISOString(),tiles:[],climateChecks:[]};
try{
 const page=await browser.newPage({viewport:{width:1100,height:900}});
 page.on('pageerror',e=>{throw e});
 await page.goto('about:blank');
 for(const entry of catalog.tiles){
  const dir=path.join(out,entry.id),meta=JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8'));
  const raw=await readFile(path.join(dir,'height.f32'));
  if(sha(raw)!==meta.heightSha256||raw.length!==meta.n**2*4)throw Error('Invalid retained source: '+meta.id);
  const height=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  const climate={temperature:meta.temperature,precipitation:meta.precipitation},runoff=runoffModel(climate);
  // A reference runoff of 300 mm/year gives the existing 4.8 km² threshold.
  // Dry climates need larger catchments to sustain a visible channel.
  const settings={riverArea:Math.min(16,4.8*Math.sqrt(300/Math.max(3,runoff.r0))),lakeDepth:1,lakeArea:10,riverMode:'vector',flatSlope:1,sinuosity:1.8,widthScale:3,balance:true,braiding:1,anabranching:true,terrainInfluence:true,avulsions:true,confluence:'climate',deltas:true};
  if(meta.hydrology?.version===2&&JSON.stringify(meta.hydrology.settings)===JSON.stringify(settings)&&!args.includes('--force')){
   for(const file of [meta.map,meta.hydrology.surface,meta.hydrology.svg,meta.hydrology.network,meta.hydrology.grids.file,...meta.hydrology.layers.map(l=>l.file)])await readFile(path.join(dir,file));
   Object.assign(entry,meta);report.tiles.push({id:meta.id,...meta.hydrology});console.log('Retained completed water '+meta.id);continue;
  }
  console.log('HYDROLOGY '+meta.id+' threshold='+settings.riverArea.toFixed(2)+' km²');
  const started=performance.now(),water=computeVectorWater(height,meta.n,meta.width,settings,climate,meta.seed);
  console.log('Computed vector water '+meta.id);
  const display={style:'render',showLakes:true,showOxbows:true,riverArea:settings.riverArea,riverMode:'vector',overlay:'none'};
  const shore=lakeField(water.lake,meta.n);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40000 40000">'+vectorWaterSvg(water,display,false)+'</svg>';
  if(svg.includes('<image'))throw Error('Vector archive contains raster water');
  const surface=height.slice();let wetCells=0;
  for(let i=0;i<surface.length;i++)if(water.lake[i]){surface[i]=Math.max(surface[i],water.lakeLevel?.[i]??water.hydro.filled[i]);wetCells++}
  const layers=[];
  for(const [id,label,legend] of [
   ['v-basins','Bassins versants','Une couleur par exutoire : mer, bord de carte ou lac fermé.'],
   ['v-accumulation','Accumulation / ruissellement','Surface drainée pondérée par le ruissellement. Bleu → cyan ; échelle logarithmique.'],
   ['v-depth','Réservoirs potentiels / dépressions','Profondeur sous le seuil de débordement : orange → rouge, de 0 à 50 m et plus.'],
   ['v-lakes','Lacs / bilan des réservoirs','Bleu : lac ouvert ; violet : lac fermé. Intensité selon la profondeur.']
  ]){
   const pixels=vectorOverlayPixels(water,id),file=id+'.png';
   await writeFile(path.join(dir,file),encodePng(pixels.rgba,pixels.n,pixels.n,4,1));layers.push({id,label,legend,file});
  }
  const flow=new Uint8Array(meta.n**2*4),h=water.hydro;
  const colours=[[70,130,255],[30,210,230],[70,220,100],[220,210,30],[255,140,30],[240,60,80],[200,70,240],[130,90,250]];
  for(let c=0;c<h.receiver.length;c++){
   const r=h.receiver[c];if(h.sea[c]||r<0)continue;
   const angle=Math.atan2(Math.floor(r/meta.n)-Math.floor(c/meta.n),r%meta.n-c%meta.n);
   const bin=(Math.round(angle/(Math.PI/4))+8)%8;flow.set([...colours[bin],170],c*4);
  }
  await writeFile(path.join(dir,'flow.png'),encodePng(flow,meta.n,meta.n,4,1));
  layers.push({id:'flow',label:'Directions d’écoulement',legend:'Direction aval : est bleu, sud vert, ouest orange, nord violet ; intermédiaires entre ces teintes.',file:'flow.png'});
  const fields={basin:h.basin,receiver:h.receiver,accumulation:h.accumulation,filled:h.filled,sea:h.sea,lake:water.lake,lakeLevel:water.lakeLevel,lakeKind:water.lakeKind};
  let offset=0;const schema={},chunks=[];
  for(const [name,a] of Object.entries(fields)){if(!a)continue;const bytes=Buffer.from(a.buffer,a.byteOffset,a.byteLength);schema[name]={offset,bytes:bytes.length,type:a.constructor.name};chunks.push(bytes);offset+=bytes.length}
  await writeFile(path.join(dir,'hydrology-grids.bin.gz'),gzipSync(Buffer.concat(chunks)));
  console.log('Rendering 4K '+meta.id);
  // Compose the existing Render terrain with its normal retained SVG water
  // adapter. Keep the terrain-only original for repeatable regeneration.
  let baseMap;try{baseMap=await readFile(path.join(dir,'terrain-render.png'))}catch{baseMap=await readFile(path.join(dir,'map.png'));await writeFile(path.join(dir,'terrain-render.png'),baseMap)}
  // The chain already retains a shore distance field. Reuse it for the shared
  // Render palette instead of querying every land pixel against every shore.
  const distance=Float32Array.from(shore.distance,v=>v*meta.width/meta.n);
  const waterPng=encodePng(waterMaterialPixels(distance,terrainStyle('render').water,meta.width),meta.n,meta.n,3,1);
  const material='<defs><clipPath id="lake-clip"><path d="'+lakeShores(water)+'" clip-rule="evenodd"/></clipPath></defs><image width="40000" height="40000" href="data:image/png;base64,'+Buffer.from(waterPng).toString('base64')+'" clip-path="url(#lake-clip)"/>';
  const materialSvg='<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="4096" viewBox="0 0 40000 40000">'+vectorWaterSvg(water,display,false)+material+'</svg>';
  const overlay=new Resvg(materialSvg,{fitTo:{mode:'width',value:4096}}).render().asPng();
  const png=await page.evaluate(async ({base,overlay})=>{
   const image=async bytes=>{const img=new Image();img.src='data:image/png;base64,'+bytes;await img.decode();return img};
   const canvas=document.createElement('canvas');canvas.width=4096;canvas.height=4096;const ctx=canvas.getContext('2d');
   ctx.drawImage(await image(base),0,0);ctx.drawImage(await image(overlay),0,0);return canvas.toDataURL('image/png').split(',')[1];
  },{base:baseMap.toString('base64'),overlay:Buffer.from(overlay).toString('base64')});
  const surfaceBytes=Buffer.from(surface.buffer),map=Buffer.from(png,'base64');
  const hydrology={version:2,engine:'vector',riverMode:'vector',balance:true,sourceHeightSha256:meta.heightSha256,settings,runoff:{r0:runoff.r0,e0:runoff.e0,aridity:runoff.aridity},rivers:water.rivers.rivers.length,riverKm:water.rivers.lengthKm,lakes:water.lakes,closedLakes:water.closedLakes,lakeAreaKm2:water.lakeAreaKm2,wetCells,svg:'water.svg',network:'water.json',surface:'surface.f32',surfaceSha256:sha(surfaceBytes),mapSha256:sha(map),layers,grids:{file:'hydrology-grids.bin.gz',n:meta.n,width:meta.width,endianness:'little',fields:schema},generationMs:performance.now()-started};
  await writeFile(path.join(dir,'water.svg'),svg);
  await writeFile(path.join(dir,'water.json'),JSON.stringify({format:'magna-vector-water',version:1,width:meta.width,settings,climate,rivers:water.rivers,lakeShoresSvg:'water.svg'}));
  await writeFile(path.join(dir,'surface.f32'),surfaceBytes);
  await writeFile(path.join(dir,'map.png'),map);
  Object.assign(meta,{hydrology,scope:'Native neural source retained unchanged; Terrain Bench vector rivers and climate-balanced lakes; Render map and lake surface regenerated.'});
  await writeFile(path.join(dir,'tile.json'),JSON.stringify(meta,null,2));
  Object.assign(entry,meta);report.tiles.push({id:meta.id,...hydrology});
  console.log(`${report.tiles.length}/42 ${meta.id}: ${hydrology.rivers} rivers, ${hydrology.riverKm.toFixed(1)} km, ${hydrology.lakes} lakes`);
 }
 for(const family of catalog.families){
  const dry=report.tiles.find(t=>t.id===family.id+'--arid'),wet=report.tiles.find(t=>t.id===family.id+'--tropical');
  const ok=dry.rivers<wet.rivers&&dry.riverKm<wet.riverKm;
  report.climateChecks.push({family:family.id,aridRivers:dry.rivers,tropicalRivers:wet.rivers,aridKm:dry.riverKm,tropicalKm:wet.riverKm,ok});
 }
 await writeFile(path.join(out,'catalog.json'),JSON.stringify(catalog,null,2));
 report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'hydrology-report.json'),JSON.stringify(report,null,2));
 if(report.tiles.length!==42||report.climateChecks.some(c=>!c.ok))throw Error('Hydrology climate validation failed; inspect hydrology-report.json');
}finally{await browser.close()}
// Context depends on the completed DEM/drainage pair, not on Render colours.
const ground=spawnSync(arg('--python','python'),[fileURLToPath(new URL('./surface_context.py',import.meta.url)),'--out',out,...(args.includes('--force')?['--force']:[])],{stdio:'inherit'});
if(ground.error)throw ground.error;
if(ground.status!==0)throw Error('Ground context generation failed; install tools/requirements-ground.txt in the selected Python environment.');
