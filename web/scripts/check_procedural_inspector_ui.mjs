import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const web=fileURLToPath(new URL('..',import.meta.url)),root=resolve(web,'..'),out=resolve(web,'out/procedural-stages');
await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,root:resolve(web,'src/ui'),logLevel:'warn',server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root]}},optimizeDeps:{noDiscovery:true,entries:[]},worker:{format:'es'},plugins:[{name:'built-benches',configureServer(s){s.middlewares.use((req,res,next)=>{const path=new URL(req.url,'http://localhost').pathname; if(!(/^\/(terrainbench|rustbench)\.html$/.test(path)||path.startsWith('/assets/')))return next();for(const directory of ['rust/out/browser','rust/out/benches']){const file=resolve(root,directory,'.'+path);if(existsSync(file)){res.setHeader('Content-Type',path.endsWith('.html')?'text/html':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.wasm')?'application/wasm':'application/octet-stream');createReadStream(file).pipe(res);return;}}next();});}}]});
await server.listen();const origin=process.env.MAGNA_BENCH_ORIGIN??`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--no-proxy-server']});

const errors=[],result={};
try{
 let page;
 const recipe=encodeURIComponent(JSON.stringify({preset:'compact',biome:true,regionalN:64,surfaceN:64,erosionTuning:{iterations:3},wind:{iterations:2,transport:.2}}));
 const common=`render=svg&source=procedural&width=5000&motif=3000&relief=mountains&auto=0&style=copernicus&hydro_enabled=0&forest=0&procedural=${recipe}`;
 for(const [name,compute,generation,serverUrl] of [['cpu','wasm','cpu',''],['gpu','gpu-f32','gpu-erosion',''],['hybrid','gpu-f32','gpu-all',''],...(process.env.MAGNA_NATIVE_STAGE_URL?[['native','wasm','native',process.env.MAGNA_NATIVE_STAGE_URL]]:[])]){
  await page?.close();page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));console.log('Testing '+name);
  const profile=name==='native'?'local':'web',query=`profile=${profile}&compute=${compute}&generation=${generation}&${name==='hybrid'?common.replace('procedural='+recipe,'procedural='+encodeURIComponent(JSON.stringify({preset:'classic',biome:true,regionalN:64,surfaceN:64,erosionTuning:{iterations:3},wind:{iterations:2,transport:.2}}))):common}`;
  const url=`${origin}/rustbench.html?profile=${profile}${serverUrl?'&localServer='+encodeURIComponent(serverUrl):''}#terrain?${query}`;
  await page.goto(url);const frame=page.frameLocator('#frames iframe').first(),panel=frame.locator('#proceduralPipeline');
  await panel.waitFor();assert.equal(await panel.locator('[data-stage]').count(),19);assert.equal(await panel.locator('canvas').count(),0);assert.equal(await frame.locator('dialog.procedural-inspector').count(),0);
  await page.waitForFunction(()=>{const f=document.querySelector('#frames iframe');return f?.contentWindow?.magnaBenchContext?.ready()&&f.contentDocument.querySelector('#terrainLoading')?.hidden;});
  const helpRows=await panel.locator('.pipeline-map-controls > .terrain-help-row').count();
  assert.equal(await panel.locator('[data-stage] > summary .pipeline-stage-toggle input').count(),19);assert.equal(await panel.locator('[data-stage] > summary [data-run-stage]').count(),19);
  assert(await panel.locator('[data-stage="prepare"] > summary input[type="checkbox"]').isChecked());assert(await panel.locator('[data-stage="prepare"] > summary input[type="checkbox"]').isDisabled());
  const phasorStage=panel.locator('[data-stage="phasor"]'),phasorToggle=phasorStage.locator('summary input[type="checkbox"]'),initialPhasor=await phasorToggle.isChecked();
  await phasorToggle.click();assert.equal(await phasorStage.evaluate(e=>e.open),false);assert.equal(await phasorToggle.isChecked(),!initialPhasor);await phasorToggle.click();assert.equal(await phasorStage.evaluate(e=>e.open),false);
  assert.equal(await panel.locator('#reliefStage[data-stage="prepare"]').count(),1);assert.equal(await frame.locator('.stages > #reliefStage').count(),0);
  assert(await panel.locator('#width').isVisible());assert.equal(await panel.locator('[data-map-size]').textContent(),'5 × 5 km');
  for(const km of [25,50,10]){await panel.locator(`[data-size="${km*1000}"]`).click();assert.equal(await panel.locator('#width').inputValue(),String(km*1000));assert.equal(await panel.locator('[data-map-size]').textContent(),`${km} × ${km} km`);}
  await panel.locator('[data-start]').click();await panel.locator('[data-stage="grids"][data-state="waiting"]').waitFor();
  await panel.locator('[data-next]').click();await panel.locator('[data-stage="initialize"][data-state="waiting"]').waitFor();
  const before=await frame.locator('#map').innerHTML();
  await panel.locator('[data-next]').click();await panel.locator('[data-stage="regional"][data-state="waiting"]').waitFor();
  assert.equal(await frame.locator('#viewport').getAttribute('data-pipeline-stage'),'initialize');
  assert.equal(await page.evaluate(()=>document.querySelector('#frames iframe').contentWindow.magnaBenchContext.capture().view.cx),5000);
  assert.notEqual(await frame.locator('#map').innerHTML(),before);assert.match(await panel.locator('[data-metrics]').textContent(),/Carte principale/);
  await panel.locator('[data-stage="regional"]').evaluate(e=>e.open=true);await panel.locator('#er_incision').fill('1.5');await panel.locator('#er_incision').dispatchEvent('change');
  assert(await panel.locator('[data-keep]').isDisabled());
  await panel.locator('[data-run-stage="phasor"]').click();assert.equal(await phasorStage.evaluate(e=>e.open),false);
  await panel.locator('[data-stage="wind"][data-state="waiting"]').waitFor();await panel.locator('[data-all]').click();
  await page.waitForFunction(()=>{const d=document.querySelector('#frames iframe')?.contentDocument;return d?.querySelector('#proceduralPipeline [data-status]')?.textContent?.includes('Pipeline terminé')&&d.querySelector('#terrainLoading')?.hidden;});
  assert.equal(await frame.locator('#terrainSketchEditor [data-id="input"]').inputValue(),'generated');
  assert.equal(await panel.locator('#compute').inputValue(),compute);assert.equal(await panel.locator('#generationCompute').inputValue(),generation);
  await panel.locator('[data-close]').click();await panel.waitFor({state:'hidden'});assert.equal(await frame.locator('#er_incision').inputValue(),'1.5');
  assert.equal(await frame.locator('.stages > #reliefStage').count(),1);assert.equal(await frame.locator('#width').inputValue(),'10000');assert(await frame.locator('#width').isVisible());assert(await frame.locator('#generate').isVisible());
  await frame.locator('#proceduralInspector').click();await panel.waitFor();
  await panel.locator('#width').fill('7500');await panel.locator('#width').dispatchEvent('change');assert.equal(await panel.locator('[data-map-size]').textContent(),'7,5 × 7,5 km');
  await frame.locator('#generate').click();
  await page.waitForFunction(()=>{const d=document.querySelector('#frames iframe')?.contentDocument;return d?.querySelector('#proceduralPipeline [data-status]')?.textContent?.includes('Pipeline terminé')&&d.querySelector('#terrainLoading')?.hidden;});
  assert.equal(await frame.locator('#terrainSketchEditor [data-id="input"]').inputValue(),'generated');
  assert.equal(await page.evaluate(()=>document.querySelector('#frames iframe').contentWindow.magnaBenchContext.capture().view.cx),3750);
  assert.equal(await page.evaluate(()=>new URL(document.querySelector('#frames iframe').contentWindow.location.href).searchParams.get('width')),'7500');
  await panel.locator('#terrainMethod').selectOption('neural');await panel.waitFor({state:'hidden'});assert(await frame.locator('#width').isVisible());assert.equal(await frame.locator('.stages > #reliefStage').count(),1);
  await frame.locator('#terrainMethod').selectOption('procedural');await panel.waitFor();assert.equal(await panel.locator('#width').inputValue(),'7500');assert.equal(await frame.locator('#width').count(),1);assert.equal(await frame.locator('#generate').count(),1);
  assert.equal(await panel.locator('.pipeline-map-controls > .terrain-help-row').count(),helpRows);assert.equal(await panel.locator('.pipeline-map-controls > .terrain-help-row:not(:has(label))').count(),0);
  await panel.locator('[data-stage]:not([data-stage="prepare"])').evaluateAll(nodes=>nodes.forEach(e=>e.open=false));await panel.locator('header').scrollIntoViewIfNeeded();await frame.locator('.stages').evaluate(e=>e.scrollLeft=0);assert(await frame.locator('#generate').isVisible());await page.screenshot({path:resolve(out,`integrated-${name}.png`)});console.log('Passed '+name);result[name]={inline:true,terrainInStack:true,sizePresets:true,customSizeApplied:true,viewFitsNewSize:true,sourceRestoration:true,mainMapPreview:true,stepping:true,globalGenerate:true,backendPreserved:true};
 }
 await page.goto(`${origin}/terrainbench.html?standalone=1&profile=web&compute=wasm&generation=cpu&${common}`);await page.locator('#proceduralPipeline #width').waitFor();assert.equal(await page.locator('#proceduralPipeline #width').inputValue(),'5000');assert.equal(await page.locator('#proceduralPipeline #reliefStage[data-stage="prepare"]').count(),1);result.terrainbench={terrainInStack:true,sizeVisible:true};
 assert.deepEqual(errors,[]);result.errors=errors;await writeFile(resolve(out,'integrated-ui-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error({errors,error:String(error)});throw error;}finally{await browser.close();await server.close();}
