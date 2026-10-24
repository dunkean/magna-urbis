import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const {values}=parseArgs({options:{baseline:{type:'string'},optimized:{type:'string'},source:{type:'string'},out:{type:'string'}}});
if(!values.baseline||!values.optimized||!values.source||!values.out)throw Error('--baseline population.ts --optimized population.ts --source retained.surfacebin --out report.json');
const own=dirname(fileURLToPath(import.meta.url)),surface=resolve(own,'../src/surface');
const basePath=resolve(values.baseline),optimizedPath=resolve(values.optimized),sourcePath=resolve(values.source);
const quote=p=>JSON.stringify(p.replaceAll('\\','/'));
const bundle=async contents=>(await build({stdin:{contents,resolveDir:own,loader:'ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false})).outputFiles[0].text;
const baseline=await bundle(`export {generateSurfaceCandidates} from ${quote(basePath)};export {recoverRetainedPopulationSampler} from ${quote(resolve(surface,'retainedPopulation.ts'))};export {decodeSurfaceBinary} from ${quote(resolve(surface,'binary.ts'))};export {fingerprint} from ${quote(resolve(surface,'hash.ts'))};`);
const optimized=await bundle(`export {generateSurfaceCandidates} from ${quote(optimizedPath)};`);
const bytes=await readFile(sourcePath),sha=b=>createHash('sha256').update(b).digest('hex');
const worker=`import * as base from '/baseline.js';import * as next from '/optimized.js';
try{
const data=await(await fetch('/source.surfacebin')).arrayBuffer(),packet=base.decodeSurfaceBinary(new Uint8Array(data));
const recovered=base.recoverRetainedPopulationSampler(packet),world=recovered.sampler;
const immutable=base.fingerprint(world),cx=(world.bounds.minX+world.bounds.maxX)/2,cz=(world.bounds.minZ+world.bounds.maxZ)/2;
const run=(fn,width,families)=>fn(world,{minX:cx-width/2,minZ:cz-width/2,maxX:cx+width/2,maxZ:cz+width/2},{families,includeOverhang:true});
run(base.generateSurfaceCandidates,100);run(next.generateSurfaceCandidates,100);
const checks=[];
for(const [name,width,families]of [['trees-4km',4000,['tree']],['all-families-480m',480,undefined]]){
const baselineMs=[],optimizedMs=[];let count=0,hash='';
for(let repeat=0;repeat<3;repeat++){
let a,b;
const optimizedFirst=repeat%2===1;
const timed=(fn,times)=>{const start=performance.now(),records=run(fn,width,families);times.push(performance.now()-start);return records;};
if(optimizedFirst){b=timed(next.generateSurfaceCandidates,optimizedMs);a=timed(base.generateSurfaceCandidates,baselineMs);}else{a=timed(base.generateSurfaceCandidates,baselineMs);b=timed(next.generateSurfaceCandidates,optimizedMs);}
if(a.length!==b.length)throw Error(name+' count differs');
for(let i=0;i<a.length;i++){const keys=Object.keys(a[i]);if(keys.length!==Object.keys(b[i]).length)throw Error(name+' keys differ');for(const k of keys)if(!Object.is(a[i][k],b[i][k]))throw Error(name+' full record differs '+i+'/'+k);}
count=a.length;hash=base.fingerprint(a);
}
const median=a=>[...a].sort((x,y)=>x-y)[1];checks.push({name,count,fingerprint:hash,baselineMs,optimizedMs,baselineMedianMs:median(baselineMs),optimizedMedianMs:median(optimizedMs),speedup:median(baselineMs)/median(optimizedMs)});
}
if(base.fingerprint(world)!==immutable)throw Error('Generator mutated canonical world');
postMessage({status:'PASS',checks,canonicalContextId:recovered.contextId,canonicalTerrainHash:recovered.terrainHash,canonicalInputUnchanged:true,hardwareConcurrency:navigator.hardwareConcurrency});
}catch(error){postMessage({status:'FAIL',error:String(error),stack:error.stack});}`;
const server=createServer((req,res)=>{
  const pages={'/':'<!doctype html><title>CPU population proof</title>','/baseline.js':baseline,'/optimized.js':optimized,'/worker.js':worker};
  if(req.url==='/source.surfacebin'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length});createReadStream(sourcePath).pipe(res);return;}
  const body=pages[req.url];if(body===undefined){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':req.url==='/'?'text/html':'text/javascript'});res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
const cached=resolve(process.env.LOCALAPPDATA??'','ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe');
browser=await chromium.launch({...existsSync(cached)?{executablePath:cached}:{channel:'msedge'},headless:true,args:['--disable-gpu']});
const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
const result=await page.evaluate(()=>new Promise((resolve,reject)=>{const w=new Worker('/worker.js',{type:'module'});const timer=setTimeout(()=>{w.terminate();reject(Error('CPU worker proof timed out'));},120000);w.onmessage=e=>{clearTimeout(timer);w.terminate();resolve(e.data);};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message));};}));
const report={format:'chromium-worker-population-optimization-proof',version:1,...result,browser:browser.version(),baseline:{path:basePath,sha256:sha(await readFile(basePath))},optimized:{path:optimizedPath,sha256:sha(await readFile(optimizedPath))},source:{path:sourcePath,bytes:bytes.length,sha256:sha(bytes)},scope:'Real Chromium module Worker, same retained source and full records. CPU only, GPU disabled,3 repetitions per query, alternating order. No native rendering/fresh-generation/navigation or60FPS claim.'};
await mkdir(dirname(resolve(values.out)),{recursive:true});await writeFile(resolve(values.out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
if(result.status!=='PASS')process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
