import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'fflate';

const origin=process.env.MAGNA_BENCH_ORIGIN??'http://127.0.0.1:5175',out='out/procedural-stages';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--no-proxy-server']});
const errors=[],report=[];
try {
  for(const [layout,preset] of [['rustbench','compact'],['terrainbench','classic']]){
    const page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
    const embedded=layout==='rustbench',recipe=encodeURIComponent(JSON.stringify({preset,biome:false,regionalN:64,surfaceN:64,erosionTuning:{iterations:3,surfaceIterations:0},enabled:{phasor:false}}));
    const query=`profile=web&render=svg&source=procedural&width=5000&motif=3000&relief=mountains&erosion=0.2&auto=0&compute=wasm&generation=cpu&hydro_enabled=0&forest=0&procedural=${recipe}`;
    await page.goto(embedded?`${origin}/rustbench.html?profile=web#terrain?${query}`:`${origin}/terrainbench.html?standalone=1&${query}`);
    const frame=embedded?page.frameLocator('#frames iframe').first():page,panel=frame.locator('#proceduralPipeline'),stage=frame.locator('[data-stage="customMask"]'),editor=stage.locator('#terrainSketchEditor'),canvas=frame.locator('#viewport > canvas.terrain-paint-overlay'),toggle=stage.locator('[data-mask-enabled]');
    const ready=()=>page.waitForFunction(embed=>{const w=embed?document.querySelector('#frames iframe')?.contentWindow:window;return w?.magnaBenchContext?.ready()&&w.document.querySelector('#terrainLoading')?.hidden;},embedded);
    const maskStats=async()=>{const e=await frame.locator('body').evaluate(()=>window.magnaBenchContext.capture().editor),weights=inflateSync(Buffer.from(e.mask,'base64url')).subarray(2);let sum=0,hash=0;for(let i=0;i<weights.length;i++){sum+=weights[i];hash=(hash+weights[i]*(i+1))%4294967291;}return {sum,hash,mode:e.mode,encoded:e.mask};};
    const stroke=async(tool,u=.35,v=.45)=>{await editor.locator('[data-id="tool"]').selectOption(tool);const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width*u,b.y+b.height*v);await page.mouse.down();await page.mouse.move(b.x+b.width*(u+.08),b.y+b.height*v,{steps:8});await page.mouse.up();};
    await ready();assert.equal(await panel.locator('[data-stage]').count(),19);assert.equal(await editor.locator('canvas').count(),0);assert.equal(await stage.evaluate(e=>e.open),false);assert.equal(await toggle.isChecked(),false);
    await panel.locator('[data-start]').click();await panel.locator('[data-stage="grids"][data-state="waiting"]').waitFor();
    await stage.locator('[data-run-stage="customMask"]').click();assert.equal(await stage.evaluate(e=>e.open),false);assert(await canvas.isVisible());assert(await toggle.isChecked());await ready();
    await panel.locator('[data-open-mask]').click();assert(await editor.locator('[data-id="tool"]').isVisible());
    const initialMap=await frame.locator('#map').innerHTML();await stroke('mountains');const painted=await maskStats();assert(painted.sum>0);assert.equal(await frame.locator('body').evaluate(()=>new URL(location.href).searchParams.has('zones')),false);
    const alpha=await canvas.evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let clear=0,max=0;for(let i=3;i<p.length;i+=4){if(!p[i])clear++;max=Math.max(max,p[i]);}return {clear,max,parent:c.parentElement.id,background:getComputedStyle(c).backgroundColor};});assert.equal(alpha.parent,'viewport');assert(alpha.clear>0&&alpha.max>0&&alpha.max<255);assert.equal(alpha.background,'rgba(0, 0, 0, 0)');
    await canvas.press('Control+z');assert.equal((await maskStats()).sum,0);await canvas.press('Control+Shift+z');assert.equal((await maskStats()).hash,painted.hash);
    await stroke('erase');assert((await maskStats()).sum<painted.sum);await canvas.press('Control+z');assert.equal((await maskStats()).hash,painted.hash);
    await editor.locator('[data-id="tool"]').selectOption('flat');await editor.locator('[data-id="fill"]').click();assert.equal((await maskStats()).sum,128*128*255);await editor.locator('[data-id="undo"]').click();assert.equal((await maskStats()).hash,painted.hash);
    await editor.locator('[data-id="clear"]').click();assert.equal((await maskStats()).sum,0);await editor.locator('[data-id="undo"]').click();assert.equal((await maskStats()).hash,painted.hash);
    const downloadPromise=page.waitForEvent('download');await editor.locator('[data-id="exportZones"]').click();const download=await downloadPromise,zoneBytes=await readFile(await download.path()),exported=JSON.parse(zoneBytes);assert.equal(exported.width,5000);assert.equal(exported.kind,'terrain-zones');
    await editor.locator('[data-id="clear"]').click();await editor.locator('[data-id="zonesFile"]').setInputFiles({name:'terrain-zones.json',mimeType:'application/json',buffer:zoneBytes});
    await page.waitForFunction(({embed,encoded})=>{const w=embed?document.querySelector('#frames iframe')?.contentWindow:window;return w?.magnaBenchContext?.capture()?.editor?.mask===encoded;},{embed:embedded,encoded:painted.encoded});
    // Zoom preserves physical coordinates: overlay extent follows the shared map camera.
    const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);const previous=await frame.locator('body').evaluate(()=>window.magnaBenchContext.capture().view.scale);await page.mouse.wheel(0,-180);
    await page.waitForFunction(({embed,scale})=>{const w=embed?document.querySelector('#frames iframe')?.contentWindow:window;return w.magnaBenchContext.capture().view.scale>scale;},{embed:embedded,scale:previous});
    const alignment=await canvas.evaluate(c=>{const v=window.magnaBenchContext.capture().view,p=c.parentElement;return {left:parseFloat(c.style.left),expectedLeft:p.clientWidth/2-v.cx*v.scale,size:parseFloat(c.style.width),expectedSize:Number(document.querySelector('#width').value)*v.scale};});assert(Math.abs(alignment.left-alignment.expectedLeft)<.01);assert(Math.abs(alignment.size-alignment.expectedSize)<.01);
    await page.screenshot({path:`${out}/custom-mask-paint-${layout}.png`});await canvas.press('Escape');assert.equal(await canvas.isVisible(),false);
    await panel.locator('[data-all]').click();await ready();assert((await frame.locator('#map').innerHTML())!==initialMap,'Tout calculer should apply the painted terrain.');
    const applied=await frame.locator('body').evaluate(()=>{const url=new URL(location.href),q=url.searchParams;return {zones:new URLSearchParams(url.hash.slice(1)).has('zones'),preset:JSON.parse(q.get('procedural')).preset,source:q.get('source')};});assert(applied.zones);assert.equal(applied.preset,preset);assert.equal(applied.source,'procedural');
    await toggle.click();assert.equal(await editor.locator('[data-id="input"]').inputValue(),'generated');assert.equal((await maskStats()).hash,painted.hash);assert.equal(await frame.locator('#generationCompute').isDisabled(),false);
    await toggle.click();assert.equal(await editor.locator('[data-id="input"]').inputValue(),'zones');assert.equal((await maskStats()).hash,painted.hash);
    // The existing metre-valued heightmap controls remain in the same input stage.
    const heightmap={version:1,resolution:8,processing:'surface',heights:Array.from({length:64},(_,i)=>100+i),width:5000,kind:'heightmap'};
    await editor.locator('[data-id="file"]').setInputFiles({name:'heightmap.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(heightmap))});
    await page.waitForFunction(embed=>{const d=embed?document.querySelector('#frames iframe')?.contentDocument:document;return d.querySelector('#terrainSketchEditor [data-id="input"]').value==='surface';},embedded);
    await toggle.click();assert.equal(await editor.locator('[data-id="input"]').inputValue(),'generated');await toggle.click();assert.equal(await editor.locator('[data-id="input"]').inputValue(),'surface');
    await editor.locator('.heightmap-tools > summary').click();await editor.locator('[data-id="exportSource"]').selectOption('draft');
    const jsonPromise=page.waitForEvent('download');await editor.locator('[data-id="export"]').click();assert.deepEqual(JSON.parse(await readFile(await (await jsonPromise).path(),'utf8')).heights,heightmap.heights);
    const pngPromise=page.waitForEvent('download');await editor.locator('[data-id="png"]').click();const png=await readFile(await (await pngPromise).path());assert.equal(png.readUInt32BE(0),0x89504e47);assert.equal(png[24],16);
    // Switching to neural restores this same input card, without a duplicate editor.
    await toggle.click();await panel.locator('#terrainMethod').selectOption('neural');assert.equal(await frame.locator('.stages > [data-stage="customMask"]').count(),1);assert.equal(await frame.locator('#terrainSketchEditor').count(),1);assert(await stage.locator('[data-run-stage="customMask"]').isVisible());
    await frame.locator('#terrainMethod').selectOption('procedural');assert.equal(await panel.locator('[data-stage="customMask"]').count(),1);
    report.push({layout,preset,interactiveInputStage:true,mainMapOverlay:true,transparent:true,brushAndEraser:true,undoRedo:true,fillAndClear:true,zoneImportExport:true,heightmapImportExport:true,zoomAligned:true,maskApplied:true,toggleRetainsDrawing:true,neuralCardRetained:true});console.log('Passed '+layout);await page.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/custom-mask-report.json`,JSON.stringify({report,errors},null,2));
}finally{await browser.close();}
