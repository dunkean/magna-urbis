// node --import ./scripts/shaderModuleStubs.mjs --import tsx scripts/v2_contour_editing_check.mjs
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {editableContours} from '../src/v2/contourEdits.ts';
import {splitContour} from '../src/v2/contourGeometry.ts';
import {polygonArea} from '../src/v2/urbanEditOptions.ts';
import {parseProjectBinary} from '../src/v2/projectBinary.ts';

const out='out/contour-editing';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],dialogs=[],report=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
const world=()=>page.evaluate(()=>{const w=window.__v2Test.world();return {settlements:w.settlements.map(({urban,...t})=>t),debug:{v2RustCities:w.debug.v2RustCities}};});
const ready=()=>page.waitForFunction(()=>document.querySelector('.v2-contour-session')?.getAttribute('aria-busy')==='false'&&document.querySelector('#app')?.getAttribute('aria-busy')==='false',null,{timeout:180000});
const overlay=()=>page.locator('.v2-contour-overlay:not([hidden])'),points=()=>overlay().locator('[data-contour-role=point]');
let screen,townKey;
async function frame(shape){
  const xs=shape.outer.map(p=>p.x),ys=shape.outer.map(p=>p.y),box=await page.locator('#map').boundingBox();
  const view={cx:(Math.min(...xs)+Math.max(...xs))/2,cy:(Math.min(...ys)+Math.max(...ys))/2,scale:Math.min(4,(box.width-360)/Math.max(1,Math.max(...xs)-Math.min(...xs)),(box.height-180)/Math.max(1,Math.max(...ys)-Math.min(...ys)))};
  await page.evaluate(view=>window.__v2Test.setView(view),view);
  screen=p=>({x:box.x+box.width/2+(p.x-view.cx)*view.scale,y:box.y+box.height/2+(p.y-view.cy)*view.scale});
  await page.waitForTimeout(60);
}
async function click(p,double=false){const s=screen(p);await page.mouse[double?'dblclick':'click'](s.x,s.y,{delay:double?90:0});}
async function undo(){await page.keyboard.press('Control+z');await ready();}
const pairFor=shape=>{
  let best;const indices=Array.from({length:Math.min(10,shape.outer.length)},(_,i)=>Math.floor(i*shape.outer.length/Math.min(10,shape.outer.length)));
  for(const i of indices)for(const j of indices.filter(j=>j>i+1))try{
    const parts=splitContour(shape,i,j),area=Math.min(...parts.map(polygonArea));if(!best||area>best.area)best={i,j,area};
  }catch{}
  return best;
};
async function save(name){
  const download=page.waitForEvent('download');await page.locator('#save-map').click();await (await download).saveAs(`${out}/${name}.muproj`);
  const bytes=await readFile(`${out}/${name}.muproj`);return parseProjectBinary(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
try{
  // Review decors are local fixtures, not part of the production distribution.
  await page.route('**/decors/city-01-river-plain-s.decor',route=>route.fulfill({path:'decors/city-01-river-plain-s.decor',contentType:'application/octet-stream'}));
  await page.goto(`${process.env.MAGNA_V2_URL??'http://127.0.0.1:4174'}/v2.html?empty&test=1&lang=en&profile=web&threads=off`);
  await page.waitForFunction(()=>window.__v2Test?.ready);
  console.log('Generating a real city with browser WASM');
  await page.evaluate(async()=>{
    await window.__v2Test.prepare({decor:'city-01-river-plain-s',culture:'european-organic',population:1000,seed:'contour-ui',fortification:'none'});
    await window.__v2Test.generateLoaded('main');
  });
  const initial=await world();townKey=initial.settlements[0].key;assert(initial.debug.v2RustCities?.[townKey]?.partitions?.[0]?.parcels.length,'real native cadastre generated');
  await page.locator('#family-tab-map').click();
  for(const kind of ['parcel','block','quarter']){
    const before=await world(),candidates=editableContours(before,kind).filter(t=>kind==='block'?t.layout.blocks[t.index].kind==='block':kind==='parcel'?before.debug.v2RustCities[t.town].partitions[0].parcels[t.index].use==='plot':true).sort((a,b)=>polygonArea(b.shape)-polygonArea(a.shape)).slice(0,8).map(t=>({t,pair:pairFor(t.shape)})).filter(x=>x.pair?.area>(kind==='quarter'?60:kind==='block'?25:3)).sort((a,b)=>b.pair.area-a.pair.area),{t,pair}=candidates[0]??{};
    assert(t,`${kind}: splittable real contour`);console.log('Testing',kind,t.id,t.shape.outer.length);
    await page.locator(`[data-contour-tool=${kind}]`).click();await frame(t.shape);await click(t.shape.outer[pair.i]);
    assert.equal(await overlay().locator('[data-contour-role=point][data-selected=true]').count(),1);
    assert.equal(await overlay().locator('[data-contour-role=cut]').count(),1);assert.equal(await overlay().locator('[data-contour-role=delete]').count(),1);
    const n=await points().count();await page.waitForTimeout(450);await click(t.shape.outer[pair.i],true);
    assert.equal(await overlay().locator('[data-contour-role=point][data-selected=true]').count(),0,'double control selects outline');
    const edges=t.shape.outer.map((p,i)=>({p,q:t.shape.outer[(i+1)%t.shape.outer.length]})).sort((a,b)=>Math.hypot(b.p.x-b.q.x,b.p.y-b.q.y)-Math.hypot(a.p.x-a.q.x,a.p.y-a.q.y));
    const {p,q}=edges[0],mid={x:(p.x+q.x)/2,y:(p.y+q.y)/2};
    await click(mid,true);await ready();assert.equal(await points().count(),n+1,'double edge adds persistent control');
    await undo();assert.equal(await points().count(),n);assert.deepEqual((await world()).debug.v2RustCities[townKey],before.debug.v2RustCities[townKey]);
    // Split produces native closed surfaces and rebuilds their actual cadastre.
    await page.waitForTimeout(450);await click(t.shape.outer[pair.i]);await overlay().locator('[data-contour-role=cut]').click();await click(t.shape.outer[pair.j]);await ready();
    const after=await world(),count=editableContours(after,kind).length;assert(count>editableContours(before,kind).length,`${kind}: split publishes an additional actual area`);
    const saved=await save(`split-${kind}`),local=saved.settings.urban.local[t.town],edits=kind==='quarter'?local.layout.overrides.quarters:kind==='block'?local.parcels.overrides.blocks:local.parcels.overrides.parcels;
    assert.equal(edits[t.id].parts.length,2,'split is retained by project export');
    assert.deepEqual(saved.world.debug.v2RustCities[townKey].layouts,after.debug.v2RustCities[townKey].layouts,'saved actual layout is exact');
    await undo();assert.deepEqual((await world()).debug.v2RustCities[townKey],before.debug.v2RustCities[townKey],'one undo restores native descendants');
    await page.locator('[data-contour-finish]').click();assert(await page.locator('.v2-contour-session').isHidden());
    report.push({kind,insert:true,split:true,undo:true,save:true,areas:count});
  }
  await page.screenshot({path:`${out}/contours.png`});assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  await writeFile(`${out}/browser-report.json`,JSON.stringify({ok:true,report},null,2));console.log(report);
}catch(error){await page.screenshot({path:`${out}/browser-failure.png`});console.error('Toasts:',await page.locator('.toast').allTextContents());throw error;}
finally{await browser.close();}
