import {TerrainGl,renderOriginalShaderSources,type TerrainLook} from './terrainGl';
import {zipSync} from 'fflate';
const status=document.getElementById('status')!;
const initialize=document.getElementById('initialize') as HTMLButtonElement;
const draw=document.getElementById('draw') as HTMLButtonElement;
const capture=document.getElementById('capture') as HTMLButtonElement;
const input=(key:string)=>document.getElementById(key) as HTMLInputElement;
const canvas=document.getElementById('reference') as HTMLCanvasElement;
const defaultSourceUrl=new URL('../../out/render-original-reference/source-v15/source.json',import.meta.url);
const sourceUrl=new URL(new URLSearchParams(location.search).get('source')??defaultSourceUrl.href,location.href);
let gpu:TerrainGl|undefined;
const sourceReady=(async()=>{
 const response=await fetch(sourceUrl);if(!response.ok)throw Error('Source locale introuvable : '+sourceUrl);
 const source=await response.json();if(source.format!=='magna-render-original-source'||source.version!==1)throw Error('Source non supportée');
 const raw=await fetch(new URL(source.height.file,sourceUrl)).then(r=>{if(!r.ok)throw Error('Heightfield absent');return r.arrayBuffer()});
 const bytes=new Uint8Array(raw);const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(bytes.length!==source.height.n*source.height.n*4||sha!==source.height.sha256)throw Error('Heightfield taille/hash incorrect');
 const heights=new Float32Array(raw);if(heights.some(v=>!Number.isFinite(v)))throw Error('Heightfield non fini');
 status.textContent=`Prêt CPU : ${source.height.n}², ${source.height.width}m, SHA ${sha}\nGPU arrêté. Eau source conservée : ${source.water.mode}.`;
 initialize.disabled=false;return {source,heights};
})();
function view(widthM:number,x:number,z:number){if(![widthM,x,z].every(Number.isFinite)||widthM<=0)throw Error('Vue invalide');return{cx:x,cy:z,scale:1024/widthM}}
async function init(){
 if(gpu)return;const{source,heights}=await sourceReady;
 const context=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});
 if(!context)throw Error('WebGL2 indisponible');const debug=context.getExtension('WEBGL_debug_renderer_info');console.log('ORIGINAL_CONTEXT '+(debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER)));
 gpu=new TerrainGl(canvas);
 gpu.setBase({x:source.height.x,y:source.height.y,width:source.height.width,n:source.height.n,data:heights});
 gpu.setLook({...source.look,layers:{...source.look.layers,water:false}} as TerrainLook);
 gpu.setView(view(Number(input('width').value),Number(input('x').value),Number(input('z').value)),1024,640);
 initialize.disabled=true;draw.disabled=false;capture.disabled=false;
 status.textContent='Render original actif — terrain, eau vectorielle OFF explicitement. Aucun nouveau champ physique.';
}
async function exportFixture(widthM:number,x=20000,z=20000){
 if(!gpu)throw Error('Initialiser explicitement le GPU avant capture');
 const{source}=await sourceReady;const result=gpu.captureExact2D({width:1024,height:640,view:view(widthM,x,z)});
 const png=new Uint8Array(await (await fetch(result.canvas.toDataURL('image/png'))).arrayBuffer());
 const fixture:any=result.fixture;
 fixture.source={...fixture.source,neuralSource:source.source,heightSource:source.height,waterSource:source.water,referenceScope:'original terrain2D program at DPR1; retained water world paths archived but not rendered in this initial parity fixture'};
 fixture.reference={pngFile:'reference.png',rgbaFile:'reference.rgba',width:1024,height:640,rowOrder:'top-first'};
 const files:Record<string,Uint8Array>={...result.files,'reference.png':png,'reference.rgba':result.rgba};
 const shaders=renderOriginalShaderSources();fixture.shaderSources={};
 for(const[name,program]of Object.entries(shaders)){
  fixture.shaderSources[name]={};
  for(const[stage,code]of Object.entries(program)){const file=`shaders/${name}.${stage}.glsl`;files[file]=new TextEncoder().encode(code);fixture.shaderSources[name][stage]={file};}
 }
 if(source.water.svgFile){const response=await fetch(new URL(source.water.svgFile,sourceUrl));if(!response.ok)throw Error('Retained world water paths absent');files['source/retained-water.svg']=new Uint8Array(await response.arrayBuffer());fixture.retainedWater={svgFile:'source/retained-water.svg',width:source.height.width,rendered:false};}
 fixture.fileSha256={};for(const[file,data]of Object.entries(files))fixture.fileSha256[file]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
 files['fixture.json']=new TextEncoder().encode(JSON.stringify(fixture,null,2));return{fixture,files};
}
initialize.onclick=()=>void init().catch(showError);
draw.onclick=()=>{try{gpu!.setView(view(Number(input('width').value),Number(input('x').value),Number(input('z').value)),1024,640)}catch(error){showError(error)}};
capture.onclick=()=>void(async()=>{capture.disabled=true;const result=await exportFixture(Number(input('width').value),Number(input('x').value),Number(input('z').value));const archive=zipSync(result.files,{level:0});const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([archive as BlobPart]));link.download=`render-original-${input('width').value}m.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),5000);status.textContent='Fixture et PNG exportés, source et shader originaux conservés.';capture.disabled=false})().catch(showError);
function showError(error:unknown){status.textContent=String(error);console.error(error)}
Object.assign(window,{renderOriginalReference:{sourceReady,init,exportFixture,shaderSources:renderOriginalShaderSources}});
sourceReady.catch(showError);
