import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const origin=process.env.MAGNA_BENCH_ORIGIN??'http://127.0.0.1:5175',out='out/procedural-stages';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--no-proxy-server']});
const report=[],errors=[];
try {
  for(const layout of ['rustbench','terrainbench']){
    const page=await browser.newPage({viewport:{width:1500,height:1050}});page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
    const recipe=encodeURIComponent(JSON.stringify({preset:'compact',biome:true,regionalN:64,surfaceN:64,erosionTuning:{iterations:3},enabled:{phasor:false}}));
    const query=`profile=web&render=svg&source=procedural&compute=wasm&generation=cpu&relief=mountains&width=5000&auto=0&hydro_enabled=0&forest=0&procedural=${recipe}`;
    await page.goto(layout==='rustbench'?`${origin}/rustbench.html?profile=web#terrain?${query}`:`${origin}/terrainbench.html?standalone=1&${query}`);
    const frame=layout==='rustbench'?page.frameLocator('#frames iframe').first():page;
    await page.waitForFunction(embedded=>{const w=embedded?document.querySelector('#frames iframe')?.contentWindow:window;return w?.magnaBenchContext?.ready()&&w.document.querySelector('#terrainLoading')?.hidden;},layout==='rustbench');
    const panel=frame.locator('#proceduralPipeline'),coasts=panel.locator('[data-stage="coasts"]');
    assert.equal(await panel.locator('[data-stage] > summary .pipeline-stage-toggle input').count(),20);
    assert.equal(await panel.locator('[data-stage] > summary [data-run-stage]').count(),20);
    assert.equal(await frame.locator('#coastStage').isVisible(),false);assert.equal(await frame.locator('#hydroStage').isVisible(),false);
    await panel.locator('#reliefStage > summary').click({position:{x:25,y:12}});assert.equal(await panel.locator('#reliefStage').evaluate(e=>e.open),false);
    await panel.locator('[data-open-coasts]').click();assert.equal(await coasts.evaluate(e=>e.open),true);
    assert(await coasts.locator('[data-coast="N"]').isVisible());assert.equal(await coasts.locator('#coastControl #islandMode').count(),1);
    await coasts.locator('#coastAll').click();assert(await coasts.locator('#islandMode').isVisible());await coasts.locator('#islandMode').selectOption('archipelago');
    await coasts.locator('[data-procedural-param="coastIterations"]').fill('2');await coasts.locator('[data-procedural-param="coastIterations"]').dispatchEvent('change');
    await coasts.locator(':scope > summary').press('Enter');assert.equal(await coasts.evaluate(e=>e.open),false);
    const toggle=coasts.locator('summary input[type="checkbox"]');assert(await toggle.isChecked());await toggle.click();assert.equal(await toggle.isChecked(),false);assert.equal(await coasts.evaluate(e=>e.open),false);await toggle.click();
    await coasts.locator('[data-run-stage="coasts"]').click();assert.equal(await coasts.evaluate(e=>e.open),false);
    await panel.locator('[data-stage="sampling"][data-state="waiting"]').waitFor();
    assert.equal(await frame.locator('#viewport').getAttribute('data-pipeline-stage'),'coasts');
    const metrics=await panel.locator('[data-metrics]').textContent(),minimum=Number(metrics.match(/·\s*(-?[\d.]+)\s*→/)?.[1]);assert(minimum<0,metrics);
    await panel.locator('[data-all]').click();await page.waitForFunction(embedded=>{const d=embedded?document.querySelector('#frames iframe')?.contentDocument:document;return d?.querySelector('#proceduralPipeline [data-status]')?.textContent?.includes('Pipeline terminé')&&d.querySelector('#terrainLoading')?.hidden;},layout==='rustbench');
    const applied=await frame.locator('body').evaluate(()=>{const q=new URL(location.href).searchParams;return {coasts:q.get('coasts'),islands:q.get('islands'),recipe:JSON.parse(q.get('procedural'))};});
    assert.equal(applied.coasts.split(',').length,8);assert.equal(applied.islands,'archipelago');assert.equal(applied.recipe.coastIterations,2);
    for(let cycle=0;cycle<2;cycle++){
      await panel.locator('[data-close]').click();assert(await frame.locator('#coastStage #coastAll').isVisible());assert(await frame.locator('#islandMode').isVisible());
      await frame.locator('#coastAll').click();assert.equal(await frame.locator('#islandMode').isVisible(),false);
      await frame.locator('#proceduralInspector').click();await panel.locator('[data-open-coasts]').click();assert(await coasts.locator('#coastAll').isVisible());
      await coasts.locator('#coastAll').click();assert(await coasts.locator('#islandMode').isVisible());assert.equal(await coasts.locator('#islandMode').inputValue(),'archipelago');
    }
    if(!await panel.locator('#terrainMethod').isVisible())await panel.locator('#reliefStage > summary').click({position:{x:25,y:12}});
    await panel.locator('#terrainMethod').selectOption('neural');assert(await frame.locator('#coastStage #coastAll').isVisible());assert.equal(await frame.locator('#reliefStage .pipeline-stage-actions').isVisible(),false);
    await frame.locator('#terrainMethod').selectOption('procedural');await panel.locator('[data-open-coasts]').click();assert(await coasts.locator('#coastAll').isVisible());assert(await coasts.locator('#islandMode').isVisible());
    const position=await coasts.evaluate(row=>({top:row.querySelector('summary').getBoundingClientRect().top,toolbarBottom:document.querySelector('#proceduralPipeline .inspector-actions').getBoundingClientRect().bottom}));assert(position.top>=position.toolbarBottom,JSON.stringify(position));
    assert.equal(await frame.locator('#coastControl').count(),1);assert.equal(await frame.locator('#islandMode').count(),1);
    await page.screenshot({path:`${out}/coasts-headers-${layout}.png`});
    report.push({layout,headerActions:19,closedStageToggle:true,closedStagePlay:true,coastShortcut:true,marinePreviewMinimum:minimum,settingsApplied:true,controlsRestored:true});console.log('Passed '+layout);await page.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/coasts-headers-report.json`,JSON.stringify({report,errors},null,2));
}finally{await browser.close();}
