/** User-visible bench parity: configure before generation, run native stages and retain exact data. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.MAGNA_V2_URL??'http://127.0.0.1:5175';
const out='out/v2-features';await mkdir(out,{recursive:true});
const report={time:new Date().toISOString(),checks:{},errors:[]};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true});
page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));
await page.addInitScript(()=>{const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(args[0]?.action&&['terrain','region','roads','towns','town','all'].includes(args[0].action))(window.__v2Inputs??=[]).push({action:args[0].action,hasWorld:!!args[0].world,retainedWorldId:args[0].retainedWorldId});if(!this.__captureV2){this.__captureV2=true;this.addEventListener('message',({data})=>{if(data.type==='result'&&data.world){window.__v2World=data.world;window.__v2Results=(window.__v2Results??0)+1;}});}return send.apply(this,args);};});
const open=async selector=>page.locator(selector).evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
const field=path=>`#terrain-controls [data-setting-path="${path}"]`;
const input=async(selector,value)=>{await open(selector);await page.locator(selector).fill(String(value));await page.locator(selector).dispatchEvent('change');};
const select=async(selector,value)=>{await open(selector);await page.locator(selector).selectOption(value);};
const summary=()=>{const w=window.__v2World;const heights=w.terrain.height.data;let h=2166136261;const bytes=new Uint8Array(heights.buffer,heights.byteOffset,heights.byteLength);for(const value of bytes)h=Math.imul(h^value,16777619);return{mapSize:w.mapSize,stats:w.stats,terrain:{height:{data:h>>>0},v2NativeTerrain:!!w.terrain.v2NativeTerrain,rivers:w.terrain.rivers.map(r=>({id:r.id}))},settlements:w.settlements?.map(s=>({key:s.key,center:s.center,population:s.population})),roads:w.roads?.map(r=>({kind:r.kind})),debug:{v2RustRegion:!!w.debug?.v2RustRegion,v2RustCities:w.debug?.v2RustCities?Object.fromEntries(Object.entries(w.debug.v2RustCities).map(([key,city])=>[key,{layouts:city.layouts.map(l=>({id:l.id}))}])):undefined}};};
const job=async selector=>{const before=await page.evaluate(()=>window.__v2Results??0);await open(selector);await page.locator(selector).click();await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false',null,{timeout:300000});assert(await page.evaluate(before=>(window.__v2Results??0)>before,before),await page.locator('#job-log').textContent());console.log('Job passed:',selector);return page.evaluate(summary);};
try{
 await page.goto(`${base}/v2.html`);await page.locator('#language-select').waitFor();
 assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('#progress-card').isVisible(),false);assert.equal(await page.locator('#terrain-width').isEnabled(),true);
 await input('#terrain-width',2.8);assert.equal(await page.locator('#terrain-extent-auto').isChecked(),false);
 await page.locator('#terrain-coast-none').click();await page.locator('#terrain-coast-N').click();await page.locator('#terrain-coast-E').click();
 assert.equal(await page.locator('#terrain-coast-N').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#terrain-coast-E').getAttribute('aria-pressed'),'true');
 await select('#terrain-compute','cpu');await select(field('terrain.generationCompute'),'cpu');await select(field('terrain.relief'),'hills');await input(field('terrain.resolution'),128);await input(field('terrain.motifSize'),1700);await input(field('terrain.erosion'),.4);
 await select(field('terrain.hydrology.engine'),'rust');
 await open('#expert-open');await page.locator('#expert-open').click();const recipe=JSON.parse(await page.locator('#expert-json').inputValue());await page.locator('[data-close="expert-dialog"]').first().click();
 assert.equal(recipe.extent,2800);assert.equal(recipe.terrain.coastMask,5);assert.equal(recipe.terrain.motifSize,1700);assert.equal(recipe.terrain.resolution,128);
 console.log('Initial settings passed');report.checks.configureBeforeGeneration={width:recipe.extent,coastMask:recipe.terrain.coastMask,controls:await page.locator('[data-setting-path]').count()};
 let world=await job('#terrain-only');assert.equal(world.mapSize,2800);assert(world.terrain.v2NativeTerrain);assert.equal(world.stats.backend,'rust-wasm-cpu');
 const heightHash=hash(world.terrain.height.data),terrainKey=world.stats['v2.terrainKey'];report.checks.nativeTerrain={width:world.mapSize,backend:world.stats.backend,rivers:world.terrain.rivers.length};
 world=await job('#terrain-only');assert.equal(hash(world.terrain.height.data),heightHash);assert.equal(world.stats['v2.cache'],'memory');report.checks.terrainCache=true;
 await page.locator('#tab-settlements').click();await input('#town-count',2);await input('[data-option="population"]',120);
 world=await job('#region-only');assert.equal(world.stats['v2.regionBackend'],'rust-wasm-cpu');assert(world.debug.v2RustRegion);assert.equal(hash(world.terrain.height.data),heightHash);assert.equal(world.settlements.length,2);
 const sitesHash=hash(world.settlements.map(s=>[s.key,s.center,s.population]));report.checks.regionalPlacement={backend:world.stats['v2.regionBackend'],places:world.settlements.length,roads:world.roads.length};
 await select('#region-controls [data-setting-path="roads.level"]','imperial');await input('#region-controls [data-setting-path="roads.density"]',.8);
 world=await job('#roads-only');assert.equal(hash(world.settlements.map(s=>[s.key,s.center,s.population])),sitesHash);assert.equal(hash(world.terrain.height.data),heightHash);report.checks.rerouteRetainsSites=true;assert(await page.evaluate(()=>window.__v2Inputs.filter(input=>['region','roads'].includes(input.action)).every(input=>!input.hasWorld&&Number.isInteger(input.retainedWorldId))));report.checks.retainedGenerationInput=true;
 await select('#urban-backend','rust');await select('#urban-controls [data-setting-path="through"]','layout');world=await job('#towns-only');assert.equal(world.stats['v2.urbanStage:main'],'layout');assert(world.debug.v2RustCities.main.layouts.length);assert.equal(world.stats['v2.terrainKey'],terrainKey);report.checks.urbanStages=true;
 await page.locator('[data-town="main"]').click();assert(await page.locator('#local-urban-controls [data-setting-path]').count()>100);
 await input('#local-urban-controls [data-setting-path="layout.density"]',1.3);const patch=JSON.parse(await page.locator('#local-rust-json').inputValue());assert.equal(patch.layout.density,1.3);report.checks.localStructuredForms=true;
 await page.locator('#inspector .close').click();await page.locator('#view3d').click();await page.locator('.city3d:not([hidden])').waitFor();await page.waitForTimeout(1000);await page.screenshot({path:`${out}/native-3d.png`});assert.equal(await page.locator('#view3d').textContent(),'2D');report.checks.native3d=true;await page.locator('#view3d').click();
 const beforeLanguage=hash(await page.evaluate(summary));await page.locator('#language-select').selectOption('fr');assert.equal(await page.locator('html').getAttribute('lang'),'fr');assert.equal(hash(await page.evaluate(summary)),beforeLanguage);await open('#region-controls [data-setting-path="placement.mode"]');assert.match(await page.locator('#region-controls').innerText(),/Composition régionale/);report.checks.frenchRetainsWorld=true;
 await page.locator('#tab-terrain').click();await page.locator('#terrain-source').selectOption('neural-wasm');assert(await page.locator('[data-setting-path="terrain.neuralTuning.steps"]').count());assert(await page.locator('[data-setting-path="terrain.coarseModel"]').count());await open('#expert-open');await page.locator('#expert-open').click();const neural=JSON.parse(await page.locator('#expert-json').inputValue());assert.equal(neural.generation,'neural');assert.equal(neural.runtime.source,'neural-wasm');await page.locator('[data-close="expert-dialog"]').first().click();report.checks.neuralParametersAccessible=true;
 await page.locator('#terrain-source').selectOption('procedural');await page.screenshot({path:`${out}/french-terrain.png`});
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=String(error.stack??error);await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});console.error(report.failure);process.exitCode=1;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
