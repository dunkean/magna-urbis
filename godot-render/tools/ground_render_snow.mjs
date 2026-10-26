// Export the retained Render shader's own snow coverage, not white RGB pixels.
// Instrumentation changes only the final output of an isolated offline GPU pass.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const web=path.resolve(arg('--web-root',path.join(project,'../../magna-urbis-render-original-reference/web')));
const {chromium}=await import(pathToFileURL(path.join(web,'node_modules/playwright/index.mjs')));
const root=path.join(project,'tiles'),catalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
const look=JSON.parse(await readFile(path.join(web,'out/render-original-reference/source-v15/source.json'),'utf8')).look;
const sha=b=>createHash('sha256').update(b).digest('hex');
const compiler=sha(await readFile(fileURLToPath(import.meta.url)));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-software-rasterizer','--use-angle=vulkan']});
try{
 const page=await browser.newPage();await page.goto(arg('--base','http://127.0.0.1:5203')+'/render-original-reference.html');
 await page.evaluate(()=>{
   const original=WebGL2RenderingContext.prototype.shaderSource;
   window.snowExportShaders=[];
   WebGL2RenderingContext.prototype.shaderSource=function(shader,source){
     if(source.includes('float snow=clamp(max(seasonal,perennial)*snowAmount')){
       const marker='color=surfaceMix(color,vec3(.94,.96,.97),surfaceCover(snow,crag,.35*variation));';
       if(!source.includes(marker))throw Error('Retained Render snow hook changed');
       window.snowExportShaders.push(source);
       source=source.replace('vec3 surfaceMaterial(', 'float exportedGroundSnow=0.0;\nvec3 surfaceMaterial(')
         .replace(marker,'exportedGroundSnow=surfaceCover(snow,crag,.35*variation);\n'+marker)
         .replace('outColor = vec4(color, uGroundCapture==1 ? coverage : uAlpha);','outColor = vec4(vec3(exportedGroundSnow),1.0);');
       if(!source.includes('outColor = vec4(vec3(exportedGroundSnow),1.0);'))throw Error('Render output hook changed');
     }
     return original.call(this,shader,source);
   };
 });
 for(const entry of catalog.tiles){
   if(args.includes('--tile')&&entry.id!==arg('--tile'))continue;
   const directory=path.join(root,path.dirname(entry.file)),meta=JSON.parse(await readFile(path.join(directory,'tile.json'),'utf8'));
   const identity=sha(JSON.stringify({compiler,height:meta.heightSha256,temperature:meta.temperature,precipitation:meta.precipitation,look}));
   try{const saved=JSON.parse(await readFile(path.join(directory,'surface-render-snow.json'),'utf8'));
     if(!args.includes('--force')&&saved.identity===identity&&sha(await readFile(path.join(directory,saved.file)))===saved.sha256){console.log('RETAINED SNOW '+entry.id);continue;}
   }catch{}
   const raw=await readFile(path.join(directory,meta.height));
   const result=await page.evaluate(async({base64,meta,look})=>{
     const {TerrainGl}=await import('./terrainGl.ts');const gpu=new TerrainGl(document.createElement('canvas'));
     const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
     gpu.setBase({x:0,y:0,width:meta.width,n:meta.n,data:new Float32Array(bytes.buffer)});
     gpu.setLook({...look,climate:{temperature:meta.temperature,precipitation:meta.precipitation},globalMin:meta.min,globalMax:meta.max,contours:false,refine:false,layers:{...look.layers,water:false},frame:false});
     gpu.setView({cx:20000,cy:20000,scale:4096/40000},4096,4096);
     const canvas=gpu.captureExact2D({width:4096,height:4096,view:{cx:20000,cy:20000,scale:4096/40000}}).canvas;
     const result={png:canvas.toDataURL('image/png').split(',')[1],shader:window.snowExportShaders[0]};
     gpu.dispose();return result;
   },{base64:raw.toString('base64'),meta,look});
   if(!result.shader)throw Error('Snow shader was not instrumented');
   const image=Buffer.from(result.png,'base64');await writeFile(path.join(directory,'surface-render-snow.png'),image);
   await writeFile(path.join(directory,'surface-render-snow.json'),JSON.stringify({identity,file:'surface-render-snow.png',sha256:sha(image),sourceShaderSha256:sha(result.shader),heightSha256:meta.heightSha256,look,climate:{temperature:meta.temperature,precipitation:meta.precipitation},origin:'retained-render-surfaceCover-snow-before-shading',n:4096},null,2));
   console.log('RENDER SNOW '+entry.id);
 }
}finally{await browser.close();}
