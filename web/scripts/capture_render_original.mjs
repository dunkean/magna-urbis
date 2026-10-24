import{chromium}from'playwright';import{mkdir,writeFile,readFile,open}from'node:fs/promises';import path from'node:path';import{execFileSync,execFile}from'node:child_process';import{createHash}from'node:crypto';import{promisify}from'node:util';
const args=process.argv.slice(2),get=(key,fallback)=>{const at=args.indexOf(key);return at<0?fallback:args[at+1]};
const base=get('--base','http://127.0.0.1:5203'),out=path.resolve(get('--out','out/render-original-reference/captures'));
const widths=get('--widths','40000,40,10').split(',').map(Number);if(widths.some(x=>!Number.isFinite(x)||x<=0))throw Error('Invalid widths');
const processes=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"$p=@(Get-CimInstance Win32_Process -Filter \"Name LIKE 'Godot%'\" | Select-Object ProcessId,CommandLine);ConvertTo-Json -Compress -InputObject $p"],{encoding:'utf8',windowsHide:true}).trim()||'[]');
const activeDemo=()=>processes().filter(p=>/surface-demo-v15|render-godot-original/i.test(p.CommandLine??''));
if(activeDemo().length)throw Error('User demo open; reference GPU not started');
const execAsync=promisify(execFile);
const demoAsync=async()=>{const{stdout}=await execAsync('powershell.exe',['-NoProfile','-Command',"$p=@(Get-CimInstance Win32_Process -Filter \"Name LIKE 'Godot%'\" | Select-Object ProcessId,CommandLine);ConvertTo-Json -Compress -InputObject $p"],{windowsHide:true});return JSON.parse(stdout.trim()||'[]').filter(p=>/surface-demo-v15|render-godot-original/i.test(p.CommandLine??''))};
await mkdir(out,{recursive:true});const errors=[];const report={version:1,status:'running',scope:'original WebGL Render2D, same literal shader; archived real NN controls, no new generation; terrain-only first parity stage',startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),clean:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()==='',sourceHeightSha256:'3c7c2f32e37844842f058208e21522543bcec69125348e115390f83d5b814159',captures:[],errors};
let browser,interrupted=false,watchBusy=false;
const timer=setInterval(async()=>{if(watchBusy)return;watchBusy=true;try{if((await demoAsync()).length){interrupted=true;void browser?.close()}}catch(error){errors.push('Demo watcher failed: '+String(error));interrupted=true;void browser?.close()}finally{watchBusy=false}},1000);
const step=async(name,promise,timeout=30000)=>{const start=performance.now();console.log('REFERENCE_STEP '+name);try{return await Promise.race([promise,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Timed out: '+name)),timeout);t.unref()})])}finally{console.log('REFERENCE_ELAPSED '+name+' '+(performance.now()-start).toFixed(3)+'ms')}};
const handles=new Map();
try{
 report.angle=get('--angle','default');
 browser=await chromium.launch({channel:get('--channel','msedge'),headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-software-rasterizer','--enable-gpu',...get('--angle','').split(',').filter(Boolean).map(v=>'--use-angle='+v),...(get('--angle','')==='vulkan'?['--enable-features=Vulkan','--use-vulkan=native']:[])]});
 const page=await browser.newPage({viewport:{width:1300,height:900},deviceScaleFactor:1});page.on('pageerror',e=>{errors.push(String(e));console.error('PAGE_ERROR '+String(e))});page.on('console',m=>{console.log('BROWSER '+m.type()+' '+m.text());if(m.type()==='error')errors.push(m.text())});page.on('requestfailed',r=>console.error('REQUEST_FAILED '+r.url()+' '+r.failure()?.errorText));await page.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
 let folder=out;
 await page.exposeBinding('__saveOriginalFile',async(_,{file,base64,offset,total})=>{const destination=path.resolve(folder,file);if(!destination.startsWith(folder+path.sep))throw Error('Fixture path outside output');if(!handles.has(destination)){await mkdir(path.dirname(destination),{recursive:true});handles.set(destination,await open(destination,'w'))}const data=Buffer.from(base64,'base64');await handles.get(destination).write(data,0,data.length,offset);if(offset+data.length>=total){await handles.get(destination).close();handles.delete(destination)}});
 await step('page',page.goto(base+'/render-original-reference.html?compile-log=1',{waitUntil:'domcontentloaded'}));
 await step('API',page.waitForFunction(()=>!!window.renderOriginalReference));
 await step('sourceCPU',page.evaluate(()=>window.renderOriginalReference.sourceReady.then(({source})=>source.height.sha256)));
 await step('WebGL_init',page.evaluate(()=>window.renderOriginalReference.init()));
 for(const width of widths){
  folder=path.join(out,String(width)+'m');await mkdir(folder,{recursive:true});
  const summary=await step('capture_'+width,page.evaluate(async width=>{
   const result=await window.renderOriginalReference.exportFixture(width);
   for(const[file,data]of Object.entries(result.files)){if(!data.length)await window.__saveOriginalFile({file,base64:'',offset:0,total:0});for(let at=0;at<data.length;at+=32768){const chunk=data.subarray(at,at+32768);await window.__saveOriginalFile({file,base64:btoa(String.fromCharCode(...chunk)),offset:at,total:data.length})}}
   const gl=document.getElementById('reference').getContext('webgl2');const debug=gl.getExtension('WEBGL_debug_renderer_info');
   return{width,fixture:'fixture.json',draws:result.fixture.draws.length,outputTarget:result.fixture.outputTarget,uEnhanced3d:result.fixture.draws.filter(d=>d.program==='terrain').map(d=>d.uniforms.uEnhanced3d),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),programs:result.fixture.draws.map(d=>d.program),unknownBindings:result.fixture.draws.flatMap(d=>Object.entries(d.textures).filter(([,v])=>v.startsWith('untracked')).map(([k,v])=>({sampler:k,key:v}))),heightFiles:Object.values(result.fixture.data).filter(d=>d.format==='RF').map(d=>({file:d.file,width:d.width,height:d.height,mips:d.mips.length}))};
  },width));
  if(summary.uEnhanced3d.some(v=>v!==0))throw Error('Original2D capture changed enhanced3D flag');
  if(summary.unknownBindings.length)throw Error('Untracked sampler bindings: '+JSON.stringify(summary.unknownBindings));
  summary.referenceSha256=createHash('sha256').update(await readFile(path.join(folder,'reference.png'))).digest('hex');report.captures.push(summary);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(summary));
 }
 if(errors.length)throw Error('Browser/shader errors: '+errors.join('\n'));
 report.status='complete';
}catch(error){report.status=interrupted?'incomplete-user-handoff':'failed';errors.push(String(error));process.exitCode=1}
finally{clearInterval(timer);await browser?.close();for(const handle of handles.values())await handle.close().catch(()=>{});report.finishedAt=new Date().toISOString();report.userDemoObserved=interrupted;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,captures:report.captures.length,errors}))}
