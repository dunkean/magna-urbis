// Export original Rust/Render3D material guides and cover from their actual GPU
// calculation. The original forest itself stays live in original_forest.gdshaderinc.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const web=path.resolve(project,'../../magna-urbis-render-original-reference/web');
if(execFileSync('git',['-C',web,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='dff14f387a6d1edc89d93737f861ee91e022a5aa')throw Error('Original Render3D reference moved');
execFileSync('git',['-C',web,'diff','--quiet','HEAD','--','../rust/bridge/terrainMaterial.ts','src/ui/terrainGl.ts']);
const {chromium}=await import(pathToFileURL(path.join(web,'node_modules/playwright/index.mjs')));
const root=path.join(project,'tiles');const catalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
const look=JSON.parse(await readFile(path.join(web,'out/render-original-reference/source-v15/source.json'),'utf8')).look;
const sha=data=>createHash('sha256').update(data).digest('hex');
const args=process.argv.slice(2);const only=args.includes('--tile')?args[args.indexOf('--tile')+1]:null;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-software-rasterizer','--use-angle=vulkan']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5203/render-original-reference.html');
 await page.evaluate(()=>{
  const original=WebGL2RenderingContext.prototype.shaderSource;window.originalCoverSource='';
  WebGL2RenderingContext.prototype.shaderSource=function(shader,source){
   if(source.includes('float snow=clamp(max(seasonal,perennial)*snowAmount')){
    window.originalCoverSource=source;
    source=source.replace('vec3 surfaceMaterial(', 'uniform int uOriginalExportMode;\nvec4 originalCoverMask=vec4(0.);\nvec3 surfaceMaterial(');
    const marker='color=surfaceMix(color,sediment*.9,flats*(1.-sstep(240.,960.,fp))*.8);';
    if(!source.includes(marker))throw Error('Original cover hook changed');
    source=source.replace(marker,'originalCoverMask=vec4(surfaceCover(herbs*(1.-outcrop),sward,.12*variation),1.-(1.-flats*(1.-sstep(240.,960.,fp))*.8)*(1.-beach*.8),woods,outcrop);\n'+marker);
    source=source.replace('outColor = vec4(color, uGroundCapture==1 ? coverage : uAlpha);',
      'outColor=uOriginalExportMode==0?vec4(originalCoverMask.rgb,1.):(uOriginalExportMode==4?vec4(vec3(originalCoverMask.a),1.):(uOriginalExportMode==1?vec4(renderGuideColor,1.):(uOriginalExportMode==2?vec4(renderGuideOpen,1.):vec4(renderGuideClosed,1.))));');
    if(!source.includes('outColor=uOriginalExportMode==0?vec4(originalCoverMask.rgb,1.)'))throw Error('Original cover output hook changed');
   }
   original.call(this,shader,source);
  };
 });
 for(const entry of catalog.tiles){
  if(only&&entry.id!==only)continue;
  const dir=path.join(root,path.dirname(entry.file)),meta=JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8'));
  const raw=await readFile(path.join(dir,meta.height));
  const result=await page.evaluate(async({base64,meta,look})=>{
   const {TerrainGl}=await import('./terrainGl.ts');const gpu=new TerrainGl(document.createElement('canvas'));
   const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
   gpu.setBase({x:0,y:0,width:meta.width,n:meta.n,data:new Float32Array(bytes.buffer)});
   gpu.setLook({...look,style:'render3d',climate:{temperature:meta.temperature,precipitation:meta.precipitation},globalMin:meta.min,globalMax:meta.max,contours:false,refine:false,refinement3d:'source',layers:{...look.layers,water:false},frame:false});
   gpu.setView({cx:20000,cy:20000,scale:4096/40000},4096,4096);
   const images=[];
   for(let mode=0;mode<5;mode++){
    gpu.gl.useProgram(gpu.terrain);gpu.gl.uniform1i(gpu.gl.getUniformLocation(gpu.terrain,'uOriginalExportMode'),mode);
    const canvas=gpu.captureExact2D({width:4096,height:4096,view:{cx:20000,cy:20000,scale:4096/40000}}).canvas;
    images.push(canvas.toDataURL('image/png').split(',')[1]);
   }
   const source=window.originalCoverSource;gpu.dispose();return {images,source};
  },{base64:raw.toString('base64'),meta,look});
  // Canvas PNG exports unpremultiply RGB by alpha. A data mask must stay
  // opaque; exporting outcrop separately avoids zeroing/clipping the RGB masks.
  const names=['cover','color','open','closed','outcrop'];const files=[];
  for(let i=0;i<names.length;i++){const file='original-'+names[i]+'.png';const bytes=Buffer.from(result.images[i],'base64');await writeFile(path.join(dir,file),bytes);files.push({role:names[i],file,sha256:sha(bytes)});}
  await writeFile(path.join(dir,'original-cover.json'),JSON.stringify({version:2,profile:'original-render3d',maskChannels:['herbs','sand-deposits','woods','opaque'],sourceHead:'dff14f387a6d1edc89d93737f861ee91e022a5aa',shaderSha256:sha(result.source),heightSha256:meta.heightSha256,n:4096,climate:[meta.temperature,meta.precipitation],seed:look.seed,files},null,2));
  console.log('ORIGINAL COVER '+entry.id);
 }
}finally{await browser.close();}
