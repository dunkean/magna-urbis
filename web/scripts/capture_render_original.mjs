import{chromium}from'playwright';import{mkdir,writeFile,readFile}from'node:fs/promises';import path from'node:path';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
const args=process.argv.slice(2),get=(key,fallback)=>{const at=args.indexOf(key);return at<0?fallback:args[at+1]};
const base=get('--base','http://127.0.0.1:5203'),out=path.resolve(get('--out','out/render-original-reference/captures'));
const widths=get('--widths','40000,40,10').split(',').map(Number);if(widths.some(x=>!Number.isFinite(x)||x<=0))throw Error('Invalid widths');
const processes=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"$p=@(Get-CimInstance Win32_Process -Filter \"Name LIKE 'Godot%'\" | Select-Object ProcessId,CommandLine);ConvertTo-Json -Compress -InputObject $p"],{encoding:'utf8',windowsHide:true}).trim()||'[]');
const activeDemo=()=>processes().filter(p=>/surface-demo-v15|render-godot-original/i.test(p.CommandLine??''));
if(activeDemo().length)throw Error('User demo open; reference GPU not started');
await mkdir(out,{recursive:true});const errors=[];const report={version:1,status:'running',scope:'original WebGL Render2D, same literal shader; archived real NN controls, no new generation; terrain-only first parity stage',startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),clean:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()==='',sourceHeightSha256:'3c7c2f32e37844842f058208e21522543bcec69125348e115390f83d5b814159',captures:[],errors};
let browser,interrupted=false,watchBusy=false;
const timer=setInterval(()=>{if(watchBusy)return;watchBusy=true;try{if(activeDemo().length){interrupted=true;void browser?.close()}}finally{watchBusy=false}},1000);
try{
 browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-software-rasterizer','--enable-gpu']});
 const page=await browser.newPage({viewport:{width:1300,height:900},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 let folder=out;
 await page.exposeBinding('__saveOriginalFile',async(_,{file,base64})=>{const destination=path.resolve(folder,file);if(!destination.startsWith(folder+path.sep))throw Error('Fixture path outside output');await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,Buffer.from(base64,'base64'))});
 await page.goto(base+'/render-original-reference.html',{waitUntil:'networkidle'});
 await page.evaluate(()=>window.renderOriginalReference.sourceReady.then(({source})=>source.height.sha256));
 await page.evaluate(()=>window.renderOriginalReference.init());
 for(const width of widths){
  folder=path.join(out,String(width)+'m');await mkdir(folder,{recursive:true});
  const summary=await page.evaluate(async width=>{
   const result=await window.renderOriginalReference.exportFixture(width);
   for(const[file,data]of Object.entries(result.files)){let s='';for(let i=0;i<data.length;i+=32768)s+=String.fromCharCode(...data.subarray(i,i+32768));await window.__saveOriginalFile({file,base64:btoa(s)})}
   const gl=document.getElementById('reference').getContext('webgl2');const debug=gl.getExtension('WEBGL_debug_renderer_info');
   return{width,fixture:'fixture.json',draws:result.fixture.draws.length,outputTarget:result.fixture.outputTarget,uEnhanced3d:result.fixture.draws.filter(d=>d.program==='terrain').map(d=>d.uniforms.uEnhanced3d),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),programs:result.fixture.draws.map(d=>d.program),unknownBindings:result.fixture.draws.flatMap(d=>Object.entries(d.textures).filter(([,v])=>v.startsWith('untracked')).map(([k,v])=>({sampler:k,key:v}))),heightFiles:Object.values(result.fixture.data).filter(d=>d.format==='RF').map(d=>({file:d.file,width:d.width,height:d.height,mips:d.mips.length}))};
  },width);
  if(summary.uEnhanced3d.some(v=>v!==0))throw Error('Original2D capture changed enhanced3D flag');
  if(summary.unknownBindings.length)throw Error('Untracked sampler bindings: '+JSON.stringify(summary.unknownBindings));
  summary.referenceSha256=createHash('sha256').update(await readFile(path.join(folder,'reference.png'))).digest('hex');report.captures.push(summary);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(summary));
 }
 if(errors.length)throw Error('Browser/shader errors: '+errors.join('\n'));
 report.status='complete';
}catch(error){report.status=interrupted?'incomplete-user-handoff':'failed';errors.push(String(error));process.exitCode=1}
finally{clearInterval(timer);await browser?.close();report.finishedAt=new Date().toISOString();report.userDemoObserved=interrupted;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,captures:report.captures.length,errors}))}
