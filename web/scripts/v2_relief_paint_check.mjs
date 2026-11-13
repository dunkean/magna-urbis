/** Real mini-paint: generated global source, grayscale underlay, strokes, history and engine handoff. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const web=fileURLToPath(new URL('..',import.meta.url)),out=resolve(web,'out/relief-paint');await mkdir(out,{recursive:true});
const server=process.env.MAGNA_V2_URL?undefined:await createServer({configFile:resolve(web,'vite.v2.config.ts'),logLevel:'warn',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
await server?.listen();
const origin=process.env.MAGNA_V2_URL??`http://127.0.0.1:${server.httpServer.address().port}/v2.html`;
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--no-proxy-server']});
try{
  const page=await browser.newPage({viewport:{width:1480,height:1000}}),errors=[];page.setDefaultTimeout(120000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}?empty&test=1&lang=fr&threads=off`);await page.locator('#boot-splash').waitFor({state:'hidden'});
  const modal=page.locator('#relief-paint-dialog'),open=()=>page.locator('#relief-editor-open').click();
  const recipe=async change=>{await page.locator('#expert-open').click();const s=JSON.parse(await page.locator('#expert-json').inputValue());if(change){change(s);await page.locator('#expert-json').fill(JSON.stringify(s));await page.locator('#expert-apply').click();assert.equal(await page.locator('#expert-error').textContent(),'');}else await page.locator('#expert-dialog [data-close]').first().click();return s;};
  const physical=()=>page.evaluate(()=>{const w=window.__v2Test.world(),p=w.terrain.v2NativeTerrain?.physical;return{n:p?.n??w.terrain.height.w,height:Array.from(p?.height??w.terrain.height.data)};});
  const run=async action=>{await action();await page.waitForFunction(()=>document.querySelector('#app')?.getAttribute('aria-busy')==='false');assert(!(await page.locator('#job-log').textContent()).includes('Échec'));};
  const stroke=async()=>{const r=await modal.locator('.paint-overlay').boundingBox();await page.mouse.move(r.x+r.width*.46,r.y+r.height*.5);await page.mouse.down();await page.mouse.move(r.x+r.width*.58,r.y+r.height*.5,{steps:5});await page.mouse.up();};
  assert.equal(await page.locator('.sidebar-footer #run-chain,#relief-editing').count(),0);
  assert.equal(await page.locator('.app-header #run-chain img').count(),1);
  assert.equal(await page.locator('#relief-editor-open img').evaluate(e=>e.complete&&e.naturalWidth===128),true);
  await recipe(s=>{s.generation='procedural';s.extent=2400;s.options.seed='MU2.'+Buffer.from(JSON.stringify({b:'mini-paint-check',v:{'relief-noise':1,'water-hydrology':2}})).toString('base64url');s.runtime={backend:'rust',source:'procedural',compute:'cpu'};s.terrain={relief:'mountains',resolution:64,sampleSpacing:37.5,motifSize:2400,coastMask:0,compute:'wasm',generationCompute:'cpu',refine:false,hydrology:{enabled:false},forest:{enabled:false},procedural:{biome:false,regionalN:64,surfaceN:64,erosionTuning:{iterations:2,surfaceIterations:1},enabled:{phasor:false},wind:{iterations:0,transport:0}}};});
  await run(()=>page.locator('#generate-region').click());const initial=await physical();
  await open();assert.equal(await modal.locator('select').count(),0);
  const gray=await modal.locator('.paint-base').evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,512,512).data;let gray=true;const distinct=new Set();for(let i=0;i<p.length;i+=4){gray&&=p[i]===p[i+1]&&p[i]===p[i+2];distinct.add(p[i]);}return{gray,levels:distinct.size};});
  assert(gray.gray&&gray.levels>10);await modal.locator('[data-action=help]').click();assert.equal(await modal.locator('#relief-paint-help').isVisible(),true);await page.screenshot({path:resolve(out,'help.png')});await modal.locator('[data-action=help]').click();
  await modal.locator('[data-action=use-generated]').click();await stroke();await modal.locator('[data-action=cancel]').click();assert.equal((await recipe()).terrain.sketch,undefined);assert.deepEqual(await physical(),initial);
  await open();await modal.locator('[data-action=use-generated]').click();await modal.locator('[data-action=save]').click();
  const source=(await recipe()).terrain.sketch;assert.equal(source.processing,'surface');assert.equal(source.resolution,initial.n);assert.deepEqual(source.heights,initial.height);
  await open();await stroke();assert.equal(await modal.locator('[data-action=undo]').isEnabled(),true);await modal.locator('.paint-overlay').focus();await page.keyboard.press('Control+z');await page.keyboard.press('Control+Shift+z');await page.screenshot({path:resolve(out,'sculpt.png')});await modal.locator('[data-action=save]').click();
  const painted=(await recipe()).terrain.sketch;assert.equal(painted.heights[0],source.heights[0]);assert(painted.heights.some((h,i)=>h>source.heights[i]));assert.deepEqual(await physical(),initial);
  await open();await run(()=>modal.locator('[data-id=apply]').click());const generated=await physical();assert.deepEqual(generated.height,painted.heights);
  await open();await modal.locator('[data-mode=zones]').click();await modal.locator('[data-zone="3"]').click();await stroke();await modal.locator('[data-action=save]').click();
  const zoned=await recipe();assert.equal(zoned.terrain.sketch,undefined);assert(zoned.terrain.zones.weights.some(v=>v>0));assert.deepEqual(await physical(),generated);
  await open();await page.screenshot({path:resolve(out,'zones-over-generated.png')});
  const opacity=await modal.locator('.paint-overlay').evaluate(c=>c.getContext('2d').getImageData(0,0,512,512).data.some((v,i)=>i%4===3&&v>0));assert(opacity);
  await modal.locator('[data-action=zoom-in]').click();assert.equal(await modal.locator('[data-zoom]').textContent(),'125%');await modal.locator('[data-action=fit]').click();
  for(const width of [1024,768,390]){await page.setViewportSize({width,height:900});await page.waitForTimeout(100);assert.equal(await modal.evaluate(e=>e.scrollWidth>e.clientWidth),false);assert.equal(await modal.locator('.relief-paint-body').evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.screenshot({path:resolve(out,`layout-${width}.png`)});}
  await page.keyboard.press('Escape');assert.equal(await modal.isVisible(),false);assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'report.json'),JSON.stringify({generatedSource:true,exactMetreHandoff:true,grayscalePreview:true,strokes:true,undoRedo:true,cancelPreservesMap:true,zones:true,responsive:true,errors},null,2));
  console.log('Relief mini-paint: exact generated source, 8-bit underlay, real strokes, history, cancel/save/generate, zone masks and responsive dialog passed.');
}finally{await browser.close();await server?.close();}
