/** Cold procedural generation: measured worker phases and the visible EN/FR status UI. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin=process.env.V2_CHECK_URL??'http://127.0.0.1:5175/v2.html';
const output=resolve('out/v2-procedural-progress');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.setDefaultTimeout(30000);
await page.addInitScript(()=>{
  const proof=window.__terrainProof={events:[],ui:[],results:[],failures:[]};
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',({data})=>{
    if(data.type==='progress')proof.events.push({at:performance.now(),...data.progress});
    if(data.type==='result'&&data.world)proof.results.push({at:performance.now(),stats:data.world.stats,mapSize:data.world.mapSize});
    if(data.type==='error')proof.failures.push(data.error);
  });}};
  document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{
    const label=document.querySelector('#progress-label'),detail=document.querySelector('#progress-detail'),meter=document.querySelector('#progress');
    if(!label||document.querySelector('#progress-card')?.hidden)return;
    const row={at:performance.now(),label:label.textContent,detail:detail?.textContent,value:meter?.getAttribute('value')??null};
    const previous=proof.ui.at(-1);if(!previous||row.label!==previous.label||row.detail!==previous.detail||row.value!==previous.value)proof.ui.push(row);
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['value','hidden']}));
});
const reveal=async selector=>page.locator(selector).evaluate(element=>{for(let p=element.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
const input=async(selector,value)=>{await reveal(selector);await page.locator(selector).fill(String(value));await page.locator(selector).dispatchEvent('change');};
try{
  await page.goto(`${origin}?empty&lang=en`,{waitUntil:'domcontentloaded'});
  await page.locator('#terrain-only').waitFor();
  await input('#seed',`progress-proof-${Date.now()}`);
  await input('[data-setting-path="terrain.resolution"]',128);
  await reveal('[data-setting-path="terrain.hydrology.resolution"]');await page.locator('[data-setting-path="terrain.hydrology.resolution"]').selectOption('256');
  const started=Date.now();await page.locator('#terrain-only').click();
  await page.waitForFunction(()=>window.__terrainProof.events.some(e=>e.stage==='terrain-generation'),null,{timeout:120000});
  await page.screenshot({path:resolve(output,'01-generating-en.png')});
  await page.locator('#language-select').selectOption('fr');
  await page.screenshot({path:resolve(output,'02-generating-fr.png')});
  await page.waitForFunction(()=>window.__terrainProof.results.length>0&&document.querySelector('#app')?.getAttribute('aria-busy')==='false',null,{timeout:180000});
  const proof=await page.evaluate(()=>window.__terrainProof);
  const stages=new Set(proof.events.map(e=>e.stage));
  for(const expected of ['compute','terrain-module','runtime-download','runtime-compile','runtime-ready','terrain-generation','terrain-sampling','terrain-drainage','terrain-retain','terrain-projection','biome'])assert(stages.has(expected),`Missing actual phase ${expected}`);
  assert(proof.ui.some(e=>e.label==='CPU · generating terrain and erosion…'&&e.value===null),'EN terrain phase is visible and indeterminate');
  assert(proof.ui.some(e=>e.label==='CPU · génération du relief et érosion…'&&e.value===null),'FR terrain phase is visible and indeterminate');
  assert(proof.events.some(e=>e.stage==='runtime-download'&&e.completed>0),'Actual module bytes observed');
  assert(!stages.has('gpu-erosion-compile'),'Auto mode avoids the software adapter erosion compiler');
  assert.deepEqual(proof.failures,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:resolve(output,'03-complete-fr.png')});
  const footer=await page.locator('#footer-status').textContent();
  const report={ok:true,elapsedMs:Date.now()-started,origin,footer,stages:[...stages],...proof,errors};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,elapsedMs:report.elapsedMs,footer,stages:report.stages,events:proof.events.length,visibleUpdates:proof.ui.length,output}));
}finally{await browser.close();}
