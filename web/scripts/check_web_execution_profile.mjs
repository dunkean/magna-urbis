import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.env.MAGNA_BENCH_ORIGIN??'http://127.0.0.1:5175',out='out/web-execution';await mkdir(out,{recursive:true});
// Stock browser flags: do not enable unsafe WebGPU or force a graphics backend.
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--no-proxy-server']});
const report=[];
const fakeGpu=`Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});`;
try{
 for(const scenario of ['cpu-switch','gpu-switch','gpu-unavailable','native-to-web']){
  const context=await browser.newContext({viewport:{width:1500,height:1050}});
  if(scenario==='gpu-unavailable')await context.addInitScript(({code})=>{
    (0,eval)(code);const NativeWorker=window.Worker;
    window.Worker=new Proxy(NativeWorker,{construct(target,args){const [url,options]=args;const absolute=new URL(String(url),location.href).href;const blob=new Blob([code+'\nconst pending=[];self.onmessage=e=>pending.push(e.data);await import('+JSON.stringify(absolute)+');for(const data of pending)self.dispatchEvent(new MessageEvent("message",{data}));'],{type:'application/javascript'});return Reflect.construct(target,[URL.createObjectURL(blob),{...options,type:'module'}]);}});
  },{code:fakeGpu});
  const page=await context.newPage();page.setDefaultTimeout(60000);const errors=[];let modelRequests=0;page.on('request',r=>{if(/\/neural\//.test(r.url()))modelRequests++;});page.on('pageerror',e=>errors.push(e.message));
  const recipe=encodeURIComponent(JSON.stringify({preset:'compact',biome:true,regionalN:64,surfaceN:64,erosionTuning:{iterations:3},enabled:{phasor:false}}));
  const initial=scenario==='cpu-switch'?'compute=wasm&generation=cpu':scenario==='native-to-web'?'compute=wasm&generation=native':'compute=gpu-f32&generation=gpu-erosion';
  const url=`${origin}/rustbench.html?profile=local&localServer=http%3A%2F%2F127.0.0.1%3A8795#terrain?source=procedural&${initial}&render=svg&relief=mountains&width=5000&auto=0&hydro_enabled=0&forest=0&procedural=${recipe}`;
  console.log('Testing '+scenario);await page.goto(url);
  await page.waitForFunction(()=>{const w=document.querySelector('#frames iframe')?.contentWindow;return w?.magnaBenchContext?.ready()&&w.document.querySelector('#terrainLoading')?.hidden;},null,{timeout:60000});
  await page.locator('.shell-header [data-execution-profile] select').selectOption('web');
  await page.waitForURL(/profile=web/);
  await page.waitForFunction(()=>{const d=document.querySelector('#frames iframe')?.contentDocument;return d&&(d.querySelector('#terrainLoading')?.hidden||d.querySelector('#terrainLoading')?.dataset.phase==='error'||d.querySelector('#status')?.textContent?.includes('Rust engine error:'));},null,{timeout:65000});
  const frame=page.frameLocator('#frames iframe').first();const state=await frame.locator('body').evaluate(()=>({source:document.querySelector('#terrainSource')?.value,compute:document.querySelector('#compute')?.value,generation:document.querySelector('#generationCompute')?.value,status:document.querySelector('#status')?.textContent,loading:document.querySelector('#terrainLoading')?.textContent,hidden:document.querySelector('#terrainLoading')?.hidden,ready:window.magnaBenchContext?.ready()}));
  await page.screenshot({path:`${out}/${scenario}.png`});report.push({scenario,...state,modelRequests,errors});console.log(JSON.stringify(report.at(-1)));
  await context.close();
 }
 await writeFile(`${out}/profile-report.json`,JSON.stringify(report,null,2));
 if(process.env.MAGNA_ASSERT_WEB_FIX==='1'){
  for(const item of report){assert.equal(item.source,'procedural');assert.equal(item.modelRequests,0);assert(item.ready&&item.hidden,`${item.scenario}: ${item.status}`);assert.deepEqual(item.errors,[]);}
  assert.equal(report[0].compute,'wasm');assert.equal(report[0].generation,'cpu');assert.equal(report[3].generation,'cpu');
 }
}finally{await browser.close();}
