// Restore a terrain-only Render baseline directly from an immutable neural tile.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const web=path.resolve(arg('--web-root','../magna-urbis-render-original-reference/web'));
const tile=arg('--tile','mountains--arid'),dir=fileURLToPath(new URL('../tiles/'+tile+'/',import.meta.url));
const meta=JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8'));
const raw=await readFile(path.join(dir,'height.f32'));
const look=JSON.parse(await readFile(path.join(web,'out/render-original-reference/source-v15/source.json'),'utf8')).look;
const {chromium}=await import(pathToFileURL(path.join(web,'node_modules/playwright/index.mjs')));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-software-rasterizer','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=native']});
try{
 const page=await browser.newPage();await page.goto(arg('--base','http://127.0.0.1:5203')+'/render-original-reference.html');
 const png=await page.evaluate(async({base64,meta,look})=>{
  const {TerrainGl}=await import('./terrainGl.ts');const gpu=new TerrainGl(document.createElement('canvas'));
  const b=atob(base64),bytes=new Uint8Array(b.length);for(let i=0;i<b.length;i++)bytes[i]=b.charCodeAt(i);
  gpu.setBase({x:0,y:0,width:meta.width,n:meta.n,data:new Float32Array(bytes.buffer)});
  gpu.setLook({...look,climate:{temperature:meta.temperature,precipitation:meta.precipitation},globalMin:meta.min,globalMax:meta.max,contours:false,refine:false,layers:{...look.layers,water:true},frame:false});
  gpu.setView({cx:20000,cy:20000,scale:4096/40000},4096,4096);
  return gpu.captureExact2D({width:4096,height:4096,view:{cx:20000,cy:20000,scale:4096/40000}}).canvas.toDataURL('image/png').split(',')[1];
 },{base64:raw.toString('base64'),meta,look});
 await writeFile(path.join(dir,'terrain-render.png'),Buffer.from(png,'base64'));console.log('Terrain-only baseline restored: '+tile);
}finally{await browser.close()}
