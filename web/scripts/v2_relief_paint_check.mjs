/** Original drawing and generated-terrain modifications are independent, resettable layers. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const web=fileURLToPath(new URL('..',import.meta.url)),out=resolve(web,'out/relief-paint');await mkdir(out,{recursive:true});
const server=process.env.MAGNA_V2_URL?undefined:await createServer({configFile:resolve(web,'vite.v2.config.ts'),logLevel:'warn',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server?.listen();
const origin=process.env.MAGNA_V2_URL??`http://127.0.0.1:${server.httpServer.address().port}/v2.html`;
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--no-proxy-server']});
try{
  const page=await browser.newPage({viewport:{width:1480,height:1000}}),errors=[];page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}?empty&test=1&lang=fr&threads=off`);await page.locator('#boot-splash').waitFor({state:'hidden'});
  const modal=page.locator('#relief-paint-dialog');
  const recipe=async change=>{await page.locator('#expert-open').click();const s=JSON.parse(await page.locator('#expert-json').inputValue());if(change){change(s);await page.locator('#expert-json').fill(JSON.stringify(s));await page.locator('#expert-apply').click();assert.equal(await page.locator('#expert-error').textContent(),'');}else await page.locator('#expert-dialog [data-close]').first().click();return s;};
  const physical=()=>page.evaluate(()=>{const w=window.__v2Test.world(),p=w.terrain.v2NativeTerrain?.physical;return{n:p?.n??w.terrain.height.w,height:Array.from(p?.height??w.terrain.height.data)};});
  const run=async action=>{await action();await page.waitForFunction(()=>document.querySelector('#app')?.getAttribute('aria-busy')==='false');const log=await page.locator('#job-log').textContent();assert(!log.includes('Échec'),log);};
  const regenerate=()=>run(()=>page.locator('#generate-region').click());
  const stroke=async()=>{const r=await modal.locator('.paint-overlay').boundingBox();await page.mouse.move(r.x+r.width*.4,r.y+r.height*.5);await page.mouse.down();await page.mouse.move(r.x+r.width*.6,r.y+r.height*.5,{steps:6});await page.mouse.up();};
  const same=(a,b,label)=>{assert.equal(a.length,b.length,label);const max=a.reduce((v,h,i)=>Math.max(v,Math.abs(h-b[i])),0);assert(max<.0001,`${label}: max difference ${max}`);};
  assert.equal(await page.locator('.sidebar-footer #run-chain img').count(),1);assert.equal(await page.locator('#relief-editor-open,.paint-modes').count(),0);
  assert.equal(await page.locator('#relief-modify-open').evaluate(e=>e.previousElementSibling.id),'relief-advanced-open');
  assert.equal(await page.locator('#relief-draw-open').isVisible(),false);
  await recipe(s=>{s.generation='procedural';s.extent=2400;s.options.seed='MU2.'+Buffer.from(JSON.stringify({b:'drawing-vs-modification',v:{'relief-noise':1}})).toString('base64url');s.runtime={backend:'rust',source:'procedural',compute:'cpu'};s.terrain={relief:'mountains',resolution:64,sampleSpacing:37.5,motifSize:2400,coastMask:16,compute:'wasm',generationCompute:'cpu',refine:false,hydrology:{enabled:false},forest:{enabled:false},procedural:{biome:false,regionalN:64,surfaceN:64,erosionTuning:{iterations:2,surfaceIterations:1},enabled:{phasor:false},wind:{iterations:0,transport:0}}};});
  await regenerate();const automatic=await physical();
  await page.locator('#source-heightmap').click();await page.locator('#relief-draw-open').click();assert.match(await modal.locator('h2').textContent(),/Dessiner/);
  await modal.locator('[data-zone="3"]').click();await stroke();await page.screenshot({path:resolve(out,'drawing-base.png')});await modal.locator('[data-action=save]').click();
  const drawnRecipe=await recipe(),drawing=drawnRecipe.terrain.drawing;assert(drawing.heights.some(h=>h>0));assert.equal(drawing.processing,undefined);assert.equal(drawnRecipe.terrain.sketch,undefined);assert.equal(drawnRecipe.terrain.modification,undefined);
  await page.locator('#source-procedural').click();await page.locator('#source-heightmap').click();assert.deepEqual((await recipe()).terrain.drawing,drawing);
  same((await physical()).height,automatic.height,'saving the base leaves the displayed world intact');
  await regenerate();const natural=await physical();
  assert(natural.height.some((h,i)=>Math.abs(h-automatic.height[i])>.1),'drawing must change the generated terrain, including after a cached coast');
  // Coarse input samples are not the generated surface: noise/refinement/erosion have run.
  const direct=Array.from({length:natural.n**2},(_,i)=>{const x=(i%natural.n+.5)*drawing.resolution/natural.n-.5,y=(Math.floor(i/natural.n)+.5)*drawing.resolution/natural.n-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const at=(a,b)=>drawing.heights[Math.max(0,Math.min(drawing.resolution-1,b))*drawing.resolution+Math.max(0,Math.min(drawing.resolution-1,a))];return(at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;});
  assert(natural.height.some((h,i)=>Math.abs(h-direct[i])>.01),'drawing must be processed, not used as an exact surface');
  await page.locator('#relief-modify-open').click();assert.match(await modal.locator('h2').textContent(),/Modifier/);assert.equal(await modal.locator('.paint-zone-tools').isVisible(),false);
  await stroke();await modal.locator('[data-action=undo]').click();await modal.locator('[data-action=redo]').click();await page.screenshot({path:resolve(out,'modification-layer.png')});await modal.locator('[data-action=save]').click();
  const edited=await recipe();assert.deepEqual(edited.terrain.drawing,drawing);assert.equal(edited.terrain.sketch,undefined);assert(edited.terrain.modification.delta.some(v=>v>0));
  await regenerate();const modified=await physical();same(modified.height,natural.height.map((h,i)=>Math.fround(h+edited.terrain.modification.delta[i])),'modifier is added to the generated base');
  await regenerate();same((await physical()).height,modified.height,'repeated generation must not accumulate modifications');
  await page.locator('#relief-modify-open').click();await modal.locator('[data-action=reset-height]').click();await run(()=>modal.locator('[data-id=apply]').click());
  const resetModification=await recipe();assert.equal(resetModification.terrain.modification,undefined);assert.deepEqual(resetModification.terrain.drawing,drawing);same((await physical()).height,natural.height,'reset modifier restores the unmodified generation');
  // Saving a new modifier and then resetting the original drawing clears both dependent layers.
  await page.locator('#relief-modify-open').click();await stroke();await modal.locator('[data-action=save]').click();assert((await recipe()).terrain.modification);
  await page.locator('#relief-draw-open').click();await modal.locator('[data-action=reset-height]').click();await run(()=>modal.locator('[data-id=apply]').click());
  const resetDrawing=await recipe();for(const key of ['drawing','modification','sketch','zones'])assert.equal(resetDrawing.terrain[key],undefined);same((await physical()).height,automatic.height,'reset drawing returns to automatic procedural terrain');
  await page.locator('#source-procedural').click();await page.locator('#source-heightmap').click();assert.equal((await recipe()).terrain.drawing,undefined);
  // Reset also cleans snapshots saved by the previous editor implementation.
  await recipe(s=>{s.terrain.sketch={version:1,resolution:64,heights:modified.height,processing:'surface'};});await page.locator('#relief-modify-open').click();await modal.locator('[data-action=reset-height]').click();await run(()=>modal.locator('[data-id=apply]').click());assert.equal((await recipe()).terrain.sketch,undefined);same((await physical()).height,automatic.height,'legacy snapshots can be removed');
  await page.locator('#relief-modify-open').click();await modal.locator('[data-action=help]').click();assert.equal(await modal.locator('#relief-paint-help').isVisible(),true);await modal.locator('[data-action=help]').click();
  for(const width of [1024,768,390]){await page.setViewportSize({width,height:900});await page.waitForTimeout(100);assert.equal(await modal.evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.screenshot({path:resolve(out,`separate-layout-${width}.png`)});}
  await page.keyboard.press('Escape');await page.setViewportSize({width:1480,height:1000});
  // File import keeps its original surface semantics and resolution; only drawing is a coarse base.
  const imported={version:1,resolution:256,heights:Array.from({length:256**2},(_,i)=>i%127),processing:'surface'};
  await page.evaluate(()=>{window.__heightmapImported=false;document.addEventListener('relief-source-changed',()=>{window.__heightmapImported=true;},{once:true});});
  await page.locator('.relief-paint-host input[data-id=file]').setInputFiles({name:'heightmap.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
  await page.waitForFunction(()=>window.__heightmapImported);const importedRecipe=await recipe();assert.deepEqual(importedRecipe.terrain.sketch,imported);assert.equal(importedRecipe.terrain.drawing,undefined);assert.equal(importedRecipe.terrain.modification,undefined);assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'separate-layers-report.json'),JSON.stringify({proceduralDrawing:true,independentModifiers:true,noAccumulation:true,resetModifier:true,resetDrawing:true,legacyCleanup:true,responsive:true,errors},null,2));
  console.log('Relief drawing/modification: procedural base, independent offsets, no accumulation, both resets, legacy cleanup, history and responsive popup passed.');
}finally{await browser.close();await server?.close();}
