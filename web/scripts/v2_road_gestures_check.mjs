// node --import ./scripts/shaderModuleStubs.mjs --import tsx scripts/v2_road_gestures_check.mjs
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseProject,serializeProject} from '../src/v2/project.ts';

const out='out/v2-road-editor',base=parseProject(await readFile(`${out}/fixture.json`,'utf8'));
base.world.landuse=undefined;delete base.world.debug.v2RustCities;
await writeFile(`${out}/gestures.json`,serializeProject(base.settings,base.world));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],nativeDialogs=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{nativeDialogs.push(d.message());await d.dismiss();});
page.on('framenavigated',frame=>{if(frame===page.mainFrame())console.log('Navigation',frame.url());});
const reveal=selector=>page.locator(selector).evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement){if(p.tagName==='DETAILS')p.open=true;if(p.classList.contains('stage-body')&&p.hidden)document.querySelector(`[aria-controls="${p.id}"]`)?.click();}});
const overlay=()=>page.locator('.v2-network-overlay:not([hidden])');
const vertices=()=>overlay().locator('[data-role=vertex][data-road][data-selected]');
const selected=()=>overlay().locator('[data-role=vertex][data-selected=true]');
const ready=()=>page.waitForFunction(()=>document.querySelector('.v2-network-banner:not([hidden])')?.getAttribute('aria-busy')==='false',null,{timeout:60000});
const snapshot=()=>page.evaluate(()=>window.__v2Test.world());
let screen;
async function load(name){
  await reveal('#import-open');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/${name}.json`);
  await page.locator('#import-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');
  await page.locator('#family-tab-map').click();await page.evaluate(()=>window.__v2Test.setView({cx:2800,cy:2800,scale:.18}));await page.locator('[data-network-quick=roads]').click();
  const box=await page.locator('#map').boundingBox(),view=await page.evaluate(()=>window.__v2Test.getView());
  screen=(x,y)=>({x:box.x+box.width/2+(x-view.cx)*view.scale,y:box.y+box.height/2+(y-view.cy)*view.scale});
}
async function click(x,y,double=false){const q=screen(x,y);if(double)await page.mouse.dblclick(q.x,q.y,{delay:85});else await page.mouse.click(q.x,q.y);}
async function drag(x,y,tx,ty,hold=false){const a=screen(x,y),b=screen(tx,ty);await page.mouse.move(a.x,a.y);await page.mouse.down();if(hold)await page.waitForTimeout(580);await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();await ready();}
async function undo(){await page.keyboard.press('Control+z');await ready();}
try{
  await page.goto(`${process.env.MAGNA_V2_URL??'http://127.0.0.1:5174'}/v2.html?empty&test=1&lang=en&threads=single`);
  await load('gestures');
  console.log('Selecting a line and a control under the first click');
  await click(1500,3000);assert.equal(await selected().count(),0);assert.equal(await vertices().count(),3);
  await click(2000,3000);assert.equal(await selected().count(),1);assert.equal(await overlay().locator('[data-role=remove-control]').count(),1);assert.equal(await overlay().locator('[data-role=cut-control]').count(),1);
  await page.waitForTimeout(450);await click(2000,3000,true);assert.equal(await selected().count(),0,'double-clicking a control selects the line');
  const original=(await snapshot()).roads.map(r=>r.path);
  console.log('Double-click adds a point and one undo removes it');
  await click(1500,3000,true);await ready();assert.equal(await vertices().count(),4);assert.equal(await selected().count(),1);
  await undo();assert.equal(await vertices().count(),3);assert.deepEqual((await snapshot()).roads.map(r=>r.path),original);
  await click(1500,3000,true);await ready();
  console.log('One-click scissors splits the line; undo restores it');
  const beforeCut=await snapshot();await overlay().locator('[data-role=cut-control]').click();await ready();assert.equal((await snapshot()).roads.length,beforeCut.roads.length+1);
  await undo();assert.deepEqual((await snapshot()).roads.map(r=>r.path),beforeCut.roads.map(r=>r.path));
  console.log('Long-press selects the control segment; moving it moves both ends');
  await click(1500,3000,true); // selected point -> line
  const a=screen(1750,3000);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.waitForTimeout(580);await page.mouse.up();
  assert.equal(await overlay().locator('[data-role=segment]').count(),1);
  const start=await snapshot(),roadIndex=Number(await overlay().locator('[data-role=road]').getAttribute('data-road'));
  await drag(1750,3000,1790,3080);const moved=await snapshot(),controls=moved.roads[roadIndex].controls;
  assert(controls.some(p=>Math.abs(p.x-1540)<2&&Math.abs(p.y-3080)<2));assert(controls.some(p=>Math.abs(p.x-2040)<2&&Math.abs(p.y-3080)<2));
  await undo();assert.deepEqual((await snapshot()).roads.map(r=>r.path),start.roads.map(r=>r.path));
  console.log('Delete applies to the segment and undo restores both connections');
  await page.keyboard.press('Delete');await ready();assert.equal((await snapshot()).roads.length,start.roads.length+1);await undo();
  assert.deepEqual((await snapshot()).roads.map(r=>r.path),start.roads.map(r=>r.path));
  // Explicit add command follows exactly the same persisted control operation.
  await reveal('#edit-roads button[aria-label="Add a waypoint"]');await page.locator('#edit-roads button[aria-label="Add a waypoint"]').click();await click(2500,3000);await ready();assert.equal(await vertices().count(),5);
  await page.keyboard.press('Delete');await ready();assert.equal(await vertices().count(),4);await undo();assert.equal(await vertices().count(),5);
  await click(2500,3000,true);assert.equal(await selected().count(),0);
  const beforeDelete=await snapshot();await page.keyboard.press('Delete');await ready();assert.equal((await snapshot()).roads.length,beforeDelete.roads.length-1);
  await page.locator('[data-network-quick=roads]').click();await page.keyboard.press('Control+z');assert.equal((await snapshot()).roads.length,beforeDelete.roads.length,'undo works after closing the tool');
  await page.locator('[data-network-quick=roads]').click();await ready();
  const finish=page.locator('[data-road-validate]'),mini=await page.locator('#minimap').boundingBox(),fb=await finish.boundingBox();assert(fb.y+fb.height<mini.y,'Finish Editing sits above minimap');assert.equal(await finish.innerText(),'Finish Editing');
  assert((await page.locator('[data-road-feedback]').innerText()).length>0);
  await finish.click();await page.locator('[data-road-session]').waitFor({state:'hidden'});
  await page.keyboard.press('Control+z');await ready();assert(await overlay().isVisible(),'undoing Finish restores the draft');await undo();assert.deepEqual((await snapshot()).roads.map(r=>r.path),start.roads.map(r=>r.path),'gestures remain individually undoable after Finish');
  console.log('Checking a visible urban approach, then validation and retained manual route');
  await load('town-access');await click(1400,3000);assert.match(await page.locator('#edit-roads').innerText(),/Town access/);
  const count=await vertices().count();await page.waitForTimeout(450);await click(1400,3000,true);await ready();assert.equal(await vertices().count(),count+1);assert.equal(await selected().count(),1);
  assert.equal(await overlay().locator('[data-role=cut-control]').count(),1);
  await drag(1400,3000,1400,3200);const urbanDraft=await snapshot(),streets=urbanDraft.debug.v2RustCities.main.layouts[0].streets;
  assert(streets.some(s=>s.path.some(p=>Math.abs(p.x-1400)<2&&Math.abs(p.y-3200)<2)));
  assert.equal(await page.locator('#road-towns-dialog').count(),0);
  await page.locator('[data-road-validate]').click();const dialog=page.locator('#road-towns-dialog');await dialog.waitFor();await dialog.locator('[data-choice=access]').click();await page.locator('[data-road-session]').waitFor({state:'hidden',timeout:120000});
  assert.deepEqual((await snapshot()).debug.v2RustCities.main.layouts[0].streets,streets,'minimal adaptation retains the manual urban approach');
  assert.match((await snapshot()).stats['v2.roadEditReport'],/settlements checked/);
  await page.screenshot({path:`${out}/gestures.png`});assert.deepEqual(errors,[]);assert.deepEqual(nativeDialogs,[]);
  const report={ok:true,clickPoint:true,doubleClickPointAndLine:true,segmentHoldAndMove:true,deletePointSegmentLine:true,oneClickCut:true,undoAfterDeleteAndClose:true,finishAboveMinimap:true,urbanApproach:true,validationFeedback:true};
  await writeFile(`${out}/gestures-report.json`,JSON.stringify(report,null,2));console.log(report);
}catch(error){await page.screenshot({path:`${out}/gestures-failure.png`});console.error('Errors',errors,'Toasts',await page.locator('.toast').allTextContents());throw error;}
finally{await browser.close();}
