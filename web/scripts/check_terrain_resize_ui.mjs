import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const origin=process.env.MAGNA_BENCH_ORIGIN??'http://127.0.0.1:5175',out='out/procedural-stages';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'chrome',headless:true,args:['--no-proxy-server']});
const errors=[],report={};
try {
  const page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  // The reported case: classic GPU erosion, 12 km landforms and Rust hydrology/conditioning.
  const query=new URLSearchParams({profile:'web',engine:'rust',v:'4',seed:'42',width:'50000',motif:'12000',relief:'mountains',erosion:'1',style:'parchment',auto:'0',source:'procedural',procedural:JSON.stringify({biome:true,preset:'classic'}),render:'svg',compute:'gpu-f32',generation:'gpu-erosion',hydro_enabled:'1',hydro_engine:'rust',hydro_compute:'auto',hydro_resolution:'512',hydro_condMode:'both',hydro_condStrength:'2',hydro_condDepth:'30',hydro_condLength:'3000',forest:'0',view:'25000,25000,0.02068'});
  await page.goto(`${origin}/rustbench.html?profile=web#terrain?${query}`);
  const frame=page.frameLocator('#frames iframe').first(),panel=frame.locator('#proceduralPipeline');
  const ready=width=>page.waitForFunction(expected=>{const w=document.querySelector('#frames iframe')?.contentWindow,d=w?.document;return w?.magnaBenchContext?.ready()&&d.querySelector('#terrainLoading')?.hidden&&new URL(w.location.href).searchParams.get('width')===String(expected);},width);
  await ready(50000);report.initial=await frame.locator('#status').textContent();
  // Do not blur the size field first: validation used to shift the arrow during this click.
  await panel.locator('#width').fill('10000');const started=Date.now();await panel.locator('[data-run-stage="prepare"]').click();await ready(10000);report.resizeMs=Date.now()-started;
  const result=await frame.locator('body').evaluate(()=>({view:window.magnaBenchContext.capture().view,status:document.querySelector('#status').textContent,compute:document.querySelector('#compute').value,generation:document.querySelector('#generationCompute').value,motif:document.querySelector('#motifSize').value}));
  assert.equal(result.view.cx,5000);assert.equal(result.view.cy,5000);assert.equal(result.motif,'12000');assert.equal(result.compute,'gpu-f32');assert.equal(result.generation,'gpu-erosion');assert(!result.status.includes('error'));report.result=result;
  await panel.locator('[data-run-stage="initialize"]').click();await panel.locator('[data-stage="regional"][data-state="waiting"]').waitFor();
  assert.equal(await frame.locator('#terrainLoading').isVisible(),false);assert.equal(await panel.locator('#generate').getAttribute('aria-busy'),null);assert.match(await panel.locator('[data-status]').textContent(),/En pause/);report.pauseVisibleWithoutSpinner=true;
  await panel.locator('[data-all]').click();await ready(10000);
  await panel.locator('[data-stage]').evaluateAll(rows=>rows.forEach(row=>row.open=false));
  const headers=await panel.locator('[data-stage] > summary').evaluateAll(nodes=>nodes.map(node=>({title:node.textContent.trim(),height:node.getBoundingClientRect().height,hasTime:!!node.querySelector('[data-pipeline-time]')?.textContent})));
  assert.equal(headers.length,19);assert(headers.every(header=>header.height<=34),JSON.stringify(headers));assert.equal(headers.filter(header=>header.hasTime).length,18);report.singleLineHeaders=true;
  await panel.locator('header').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/resize-50-to-10.png`});
  await page.goto(`${origin}/terrainbench.html?standalone=1&profile=web&source=procedural&render=svg&compute=wasm&generation=cpu&hydro_enabled=0&forest=0&auto=0`);await page.locator('#motifSize').waitFor();assert.equal(await page.locator('#motifSize').inputValue(),'10000');report.defaultMotif=10000;
  assert.deepEqual(errors,[]);await writeFile(`${out}/resize-report.json`,JSON.stringify({report,errors},null,2));console.log(JSON.stringify({resizeMs:report.resizeMs,pausedWithoutSpinner:true,singleLineHeaders:true,defaultMotif:10000,errors}));
}finally{await browser.close();}
