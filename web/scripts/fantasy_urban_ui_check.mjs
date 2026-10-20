import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('out/fantasy', {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true}), page = await browser.newPage({viewport:{width:1550,height:1000}}), errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  const base=process.argv[2]||'http://localhost:5174/urbanbench.html',offline=base.startsWith('file:');
  const openDecor=()=>page.locator('#decorFiles').setInputFiles('decors/d001-hills-inland-hamlet.decor');
  await page.goto(base+(offline?'?style=fantasy-color':'?decor=d001-hills-inland-hamlet&style=fantasy-color'));
  if(offline)await openDecor();
  await page.waitForFunction(()=>document.querySelectorAll('#fantasyPainting .fantasy-brushes > use').length>20,null,{timeout:120000});
  await page.waitForFunction(()=>!document.getElementById('urbanStatus')?.textContent.includes('Calcul'),null,{timeout:120000});
  await page.locator('#fit').click();
  const before=await page.evaluate(()=>({variants:new Set([...document.querySelectorAll('.fantasy-brushes > use')].map(s=>s.dataset.brush+':'+s.dataset.variant)).size,layout:document.querySelector('#urbanLayer')?.innerHTML,stamps:document.querySelectorAll('.fantasy-brushes > use').length}));
  assert(before.variants>8,'independent silhouettes are used in the map');
  await page.locator('#viewport').screenshot({path:'out/fantasy/urban-color.png'});
  await page.selectOption('#mapStyle','fantasy-ink');
  assert.equal(await page.locator('.fantasy-brushes > use').count(),before.stamps);
  assert.equal(await page.locator('#landuseLayer').evaluate(layer=>getComputedStyle(layer).display),'none');
  await page.locator('#viewport').screenshot({path:'out/fantasy/urban-ink.png'});
  await page.locator('#fantasyStyleControls > summary').click();
  await page.locator('#brush_density').evaluate(input=>{input.value='.5';input.dispatchEvent(new Event('input'));});
  await page.waitForFunction(before=>document.querySelectorAll('.fantasy-brushes > use').length<before,before.stamps);
  await page.waitForFunction(()=>new URL(location.href).searchParams.get('brush_density')==='.5'||new URL(location.href).searchParams.get('brush_density')==='0.5');
  for(const format of ['svg','png']){
    const download=page.waitForEvent('download');await page.locator('#fantasyExport_'+format).click();
    await page.locator('.export-crop [data-action="export"]').click();
    const result=await download;assert(result.suggestedFilename().endsWith('.'+format));await result.saveAs('out/fantasy/urban-export.'+format);
    const bytes=await readFile('out/fantasy/urban-export.'+format);
    if(format==='svg')assert(bytes.toString('utf8').startsWith('<svg'));else assert.equal(bytes.readUInt32BE(16),4096);
  }
  await page.reload();if(offline)await openDecor();await page.waitForFunction(()=>document.querySelector('.fantasy-brushes > use'));
  assert.equal(await page.inputValue('#mapStyle'),'fantasy-ink');assert.equal(await page.inputValue('#brush_density'),'0.5');
  await page.selectOption('#mapStyle','relief');assert.equal(await page.locator('.fantasy-brushes').count(),0);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({stamps:before.stamps,variants:before.variants,exports:true,replay:true,errors}));
}finally{await browser.close();}
