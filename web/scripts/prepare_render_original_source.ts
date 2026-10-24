import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import{heightPyramid}from'../src/ui/terrainSurface';
import{DEFAULT_FRACTAL_DETAIL,seedHash}from'../../rust/bridge/terrainAdjust';
import{DEFAULT_TERRAIN_LIGHTING,DEFAULT_TERRAIN_LAYERS}from'../src/render/terrainLighting';
const args=process.argv.slice(2),get=(key:string,fallback='')=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const heightPath=get('--heightfield'),reportPath=get('--source-report'),out=path.resolve(get('--out','out/render-original-reference/source-v15'));
if(!heightPath||!reportPath)throw Error('--heightfield and --source-report required; no generation/resampling');
const raw=await readFile(heightPath),report=JSON.parse(await readFile(reportPath,'utf8')),meta=report.neuralOutput;
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
if(meta?.width!==1024||meta.height!==1024||raw.length!==1024*1024*4||sha(raw)!==meta.sha256)throw Error('Actual neural response shape/hash mismatch');
const heights=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
if(heights.some(v=>!Number.isFinite(v)))throw Error('Non-finite controls');
let min=Infinity,max=-Infinity;for(const v of heights){min=Math.min(min,v);max=Math.max(max,v)}
await mkdir(out,{recursive:true});await writeFile(path.join(out,'height.f32'),raw);
const pyramid=heightPyramid(heights,1024),levels=[];let levelBytes=0;
for(let i=0;i<pyramid.length;i++){const bytes=new Uint8Array(pyramid[i].buffer);await writeFile(path.join(out,`height-lod${i}.f32`),bytes);levelBytes+=bytes.length;levels.push({file:`height-lod${i}.f32`,width:1024>>i,height:1024>>i,bytes:bytes.length,sha256:sha(bytes)})}
const seed=String(report.seed);
const source:any={format:'magna-render-original-source',version:1,height:{file:'height.f32',n:1024,x:0,y:0,width:40000,sha256:sha(raw),format:'RF'},source:{stage:meta.sourceStage,neural:meta.meta,archiveSha256:meta.sha256,seed,retained:true,freshGenerationForThisReference:false,noResampling:true},look:{style:'render',waterStyle:'render',mapWidth:40000,globalMin:min,globalMax:max,climate:{temperature:18,precipitation:1000},lighting:{...DEFAULT_TERRAIN_LIGHTING},layers:{...DEFAULT_TERRAIN_LAYERS},contours:true,contourStep:100,flatRelief:false,refine:true,sourceCell:40000/1024,seed:seedHash(seed),detail:{...DEFAULT_FRACTAL_DETAIL},floor:0,frame:false,background:'#f1f0e9',mesh3d:false},view:{cx:20000,cy:20000,scale:1024/40000},heightPyramid:{source:'original heightPyramid(), F32 bytes',bytes:levelBytes,levels},water:{mode:'none',scope:'no hydrology synthesized from raw neural controls'}};
const archivePath=get('--surface-source'),runtime=get('--archive-runtime');
if(archivePath){
 if(!runtime)throw Error('--archive-runtime required for one-time CPU extraction');
 const{decodeSurfaceBinary}=await import(pathToFileURL(path.join(runtime,'binary.ts')).href);
 const{restoreSurfaceSource}=await import(pathToFileURL(path.join(runtime,'adapters/sourceArchive.ts')).href);
 const bytes=await readFile(archivePath),packet=decodeSurfaceBinary(bytes),original=restoreSurfaceSource(packet.source);
 const material=original.meta?.waterMaterial;
 if(original.meta?.seed!==seed||original.meta?.width!==40000)throw Error('Water archive seed/domain mismatch');
 await writeFile(path.join(out,'retained-water.svg'),original.meta.waterSvg??'','utf8');
 source.water={mode:'retained-svg',svgFile:'retained-water.svg',scope:'unchanged original retained water; raw neural controls are pre-hydrology, no physical consistency claim',archiveSha256:sha(bytes)};
 if(material?.field){const lake=Buffer.from(material.field,'base64');if(lake.length!==material.n*material.n*4)throw Error('Lake shape mismatch');await writeFile(path.join(out,'lake.f32'),lake);Object.assign(source.water,{lakeFile:'lake.f32',n:material.n,shore:'exact',width:material.width,referenceWidth:material.referenceWidth})}
}
await writeFile(path.join(out,'source.json'),JSON.stringify(source,null,2),'utf8');
console.log(JSON.stringify({out,sourceSha256:sha(raw),heightMin:min,heightMax:max,mips:pyramid.length,mipBytes:levelBytes,water:source.water.mode,noGeneration:true,noGpu:true,noSurfaceWorldInBrowser:true}));
