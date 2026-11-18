/** Selection/setup contract: model downloads remain an explicit Settings action. No model weights are fetched. */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const out=new URL('../out/neural-setup/',import.meta.url);await mkdir(out,{recursive:true});
const bytes=[1,2,3,4],sha256=createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const manifest={profile:'setup-test',engineRevision:'test',runtimeSha256:'a'.repeat(64),models:Object.fromEntries(['coarse','base','decoder'].map(name=>[name,{file:`${name}.bin`,bytes:bytes.length,sha256}]))};
const dev=await createServer({mode:'rustbench',server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await dev.listen();
const args=['--enable-unsafe-webgpu'];if(process.env.MAGNA_TEST_ADAPTER_LUID)args.push(`--use-adapter-luid=${process.env.MAGNA_TEST_ADAPTER_LUID}`);
const browser=await chromium.launch({channel:'msedge',headless:true,args});
const report={checks:[],weights:[],errors:[]};
try{
 for(const gpu of [true,false]){
  const context=await browser.newContext({viewport:{width:1500,height:1000}});
  if(!gpu)await context.addInitScript(()=>Object.defineProperty(navigator,'gpu',{get:()=>undefined}));
  const page=await context.newPage();page.setDefaultTimeout(90000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('request',request=>{if(/\/neural\/models\/(?!manifest\.json)/.test(request.url()))report.weights.push(request.url());});
  await page.route('**/neural/models/manifest.json',route=>route.fulfill({json:manifest}));
  await page.goto(`http://127.0.0.1:${dev.httpServer.address().port}/v2.html?empty&test=1&lang=en`,{waitUntil:'domcontentloaded'});
  await page.locator('#boot-splash').waitFor({state:'detached'});
  assert.equal(await page.locator('#source-neural').isDisabled(),false);
  await page.evaluate(()=>document.querySelector('#neural-model-manager').open=false);
  await page.locator('#source-neural').click();
  await page.locator('#hardware-dialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#source-neural').getAttribute('aria-busy')==='false');
  assert(await page.locator('#neural-model-manager').evaluate(section=>section.open));
  await page.locator('#neural-model-download-all').waitFor({state:'visible'});
  assert.equal(await page.locator('#neural-model-manager [data-model]').count(),3);
  await page.screenshot({path:fileURLToPath(new URL(gpu?'missing-models.png':'no-webgpu.png',out))});
  report.checks.push(gpu?'Missing models opens Settings at model download':'Unavailable WebGPU keeps setup accessible');
  await page.locator('#hardware-dialog [data-close]').first().click();
  await page.evaluate(async({manifest,bytes})=>{
   const cache=await caches.open('magna-urbis-neural-models-v1'),assets=new URL('./previous-build/neural/',location.href);
   // Existing downloads from a previous hosting path; even the catalogue has been lost.
   await cache.delete(new URL('./neural/models/manifest.json',location.href).href);
   for(const [name,entry] of Object.entries(manifest.models)){
    const url=new URL(`models/old-${entry.file}`,assets);url.searchParams.set('sha256',entry.sha256);
    await cache.put(url.href,new Response(new Uint8Array(bytes),{headers:{'X-Magna-Model-Bytes':String(entry.bytes),'X-Magna-Model-Name':name}}));
   }
  },{manifest,bytes});
  await page.locator('#source-procedural').click();await page.locator('#source-neural').click();
  await page.waitForFunction(()=>document.querySelector('#source-neural').getAttribute('aria-busy')==='false');
  if(gpu){
   assert.equal(await page.locator('#hardware-dialog').isVisible(),false);
   report.checks.push('A saved set from another hosting path is recovered without a saved catalogue or weight downloads');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.locator('#boot-splash').waitFor({state:'detached'});
   await page.locator('#source-neural').click();
   await page.waitForFunction(()=>document.querySelector('#source-neural').getAttribute('aria-busy')==='false');
   assert.equal(await page.locator('#hardware-dialog').isVisible(),false);
   await page.locator('#hardware-open').click();
   await page.waitForFunction(()=>document.querySelectorAll('#neural-model-manager [data-stored="true"]').length===3);
   assert.equal(await page.locator('#neural-model-download-all').isDisabled(),true);
   report.checks.push('Reload and model Settings recognize all existing files and disable redundant downloads');
   await page.locator('[data-model="base"] [data-action="remove"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-model="base"]')?.getAttribute('data-stored')==='false');
   await page.locator('#hardware-dialog [data-close]').first().click();
   await page.locator('#source-neural').click();
   await page.locator('#hardware-dialog').waitFor({state:'visible'});
   report.checks.push('Selecting Neural again detects a deleted model');
  }else assert(await page.locator('#hardware-dialog').isVisible());
  await context.close();
 }
 assert.deepEqual(report.weights,[]);assert.deepEqual(report.errors,[]);
 report.ok=true;console.log('Neural setup browser contract passed');
}finally{await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));await browser.close();await dev.close();}
