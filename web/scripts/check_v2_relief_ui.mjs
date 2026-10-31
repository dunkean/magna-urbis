/** Real V2 controls: LED validity, cached display and moving the coast row. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const web=fileURLToPath(new URL('..',import.meta.url));
const server=await createServer({configFile:resolve(web,'vite.v2.config.ts'),logLevel:'warn',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--enable-unsafe-webgpu','--no-proxy-server']});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1480,height:1000}});page.setDefaultTimeout(120000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/v2.html?empty&lang=fr&threads=${process.env.MAGNA_WASM_THREADS??'off'}`);
  await page.locator('#expert-open').waitFor({state:'visible'});
  const edit=async change=>{await page.locator('#expert-open').click();const settings=JSON.parse(await page.locator('#expert-json').inputValue());change(settings);await page.locator('#expert-json').fill(JSON.stringify(settings));await page.locator('#expert-apply').click();assert.equal(await page.locator('#expert-error').textContent(),'');await page.locator('#expert-dialog').waitFor({state:'hidden'});};
  await edit(s=>{s.generation='procedural';s.extent=2400;s.options.seed='relief-ui-checkpoints';s.runtime={backend:'rust',source:'procedural',compute:'cpu'};s.terrain={relief:'mountains',resolution:64,motifSize:2400,coastMask:16,compute:'wasm',generationCompute:'cpu',refine:false,hydrology:{enabled:false},forest:{enabled:false},procedural:{biome:false,regionalN:64,surfaceN:64,erosionTuning:{iterations:2,surfaceIterations:1},enabled:{phasor:false},wind:{iterations:2,transport:.2}}};});
  const led=id=>page.locator(`#row-${id}`).getAttribute('data-led');
  const run=async id=>{const before=await page.locator('#job-log').textContent();await page.locator(`#row-${id} .stage-run`).click();await page.waitForFunction(()=>document.querySelector('#app')?.getAttribute('aria-busy')==='false');const log=(await page.locator('#job-log').textContent()).slice(before.length);assert(!log.includes('Échec'),log);assert.match(await page.locator('#footer-status').textContent(),/Carte prête/);return log;};
  assert.equal(await led('relief-regional'),'pending');assert.equal(await led('relief-phasor'),'disabled');
  await run('relief-regional');assert.equal(await led('relief-regional'),'valid');assert.equal(await led('relief-surface'),'pending');
  const repeated=await run('relief-regional');assert.match(repeated,/Sortie intermédiaire conservée/);
  await run('relief-surface');assert.equal(await led('relief-surface'),'valid');
  await edit(s=>{s.terrain.procedural.erosionTuning.surfaceIterations=2;});
  assert.equal(await led('relief-regional'),'valid');assert.equal(await led('relief-surface'),'pending');
  const changed=await run('relief-surface');assert.match(changed,/regional · cached/);assert(!changed.includes('initialize · done'),changed);
  await page.locator('#row-relief-coast-cut .stage-title').click();
  await page.locator('#body-relief-coast-cut select').selectOption('surface');
  await page.waitForFunction(()=>document.querySelector('#row-relief-coast-cut')?.previousElementSibling?.id==='row-relief-surface');
  assert.equal(await led('relief-coast-cut'),'pending');
  await run('relief-coast-cut');assert.equal(await led('relief-coast-cut'),'valid');
  await page.locator('#row-relief-coast-cut .stage-node').click();assert.equal(await led('relief-coast-cut'),'disabled');
  await page.locator('#row-relief-coast-cut .stage-node').click();assert.equal(await led('relief-coast-cut'),'valid');
  await page.locator('#random-seed').click();
  await page.waitForFunction(()=>document.querySelector('#row-relief-regional')?.getAttribute('data-led')==='pending'&&document.querySelector('#row-relief-coast-cut')?.getAttribute('data-led')==='pending');
  assert.deepEqual(errors,[]);
  const out=resolve(web,'out/relief-checkpoints');await mkdir(out,{recursive:true});await page.screenshot({path:resolve(out,'v2-leds.png'),fullPage:true});await writeFile(resolve(out,'ui-report.json'),JSON.stringify({threeLedStates:true,selectiveInvalidation:true,cachedDisplay:true,movableCoast:true,seedInvalidation:true,errors},null,2));
  console.log('V2 relief UI: LED states, selective invalidation, cached output and movable coast passed.');
} finally {await browser.close();await server.close();}
