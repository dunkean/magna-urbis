// node --import ./scripts/shaderModuleStubs.mjs --import tsx scripts/v2_road_dependents_check.mjs
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseProject,serializeProject} from '../src/v2/project.ts';
import {projectRustTown} from '../src/v2/rustTownProjection.ts';

const out='out/v2-road-editor',project=parseProject(await readFile(`${out}/fixture.json`,'utf8'));
const {world,settings}=project,p=(x,y)=>({x,y});
world.landuse.farmsteads=[];
const shape={outer:[p(900,2900),p(1100,2900),p(1100,3100),p(900,3100)],holes:[]};
const inner={path:[p(900,3000),p(1000,3000),p(1100,3000)],widths:[5,5,5],role:'street',rank:1};
const layout={key:'main',culture:'european-organic',center:p(1000,3000),quarters:[{shape,phase:0}],blocks:[],warnings:[],
  streets:[inner,{path:[p(1100,3000),p(1500,3000),p(2000,3000)],widths:[5,5,5],role:'approach',rank:1}]};
const snapshot={backend:'rust-wasm-cpu',stage:'layout',layouts:[layout],buildingIds:[],layoutKey:'road-test',warnings:[]};
world.debug.v2RustCities={main:snapshot};world.urban=projectRustTown(snapshot,1000,'european-organic');world.settlements[0].urban=world.urban;
world.debug.v2RustRegion.placement.settlements=world.settlements.map(t=>({...t,urban:undefined}));
world.stats['v2.terrainKey']='road-editor-dependents';world.stats['v2.urbanStage:main']='layout';
settings.region.autoBuildPopulation=0;settings.urban={backend:'rust',through:'layout'};
await writeFile(`${out}/town-access.json`,serializeProject(settings,world));
const farmWorld=structuredClone(world);farmWorld.settlements[0].population=10;farmWorld.settlements[0].cls='farmstead';farmWorld.settlements[0].detail='farmstead';
farmWorld.debug.v2RustRegion.placement.settlements[0].population=10;
await writeFile(`${out}/isolated-access.json`,serializeProject(settings,farmWorld));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
const nativeDialogs=[];page.on('dialog',async d=>{nativeDialogs.push(d.message());await d.dismiss();});
page.on('pageerror',e=>errors.push(e.message));
const reveal=selector=>page.locator(selector).evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement){if(p.tagName==='DETAILS')p.open=true;if(p.classList.contains('stage-body')&&p.hidden)document.querySelector(`[aria-controls="${p.id}"]`)?.click();}});
const ready=()=>page.waitForFunction(()=>document.querySelector('.v2-network-banner:not([hidden])')?.getAttribute('aria-busy')==='false',null,{timeout:120000});
try{
  await page.goto('http://127.0.0.1:4174/v2.html?empty&test=1&lang=en');
  await reveal('#import-open');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/town-access.json`);
  await page.locator('#import-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');
  await page.locator('#family-tab-map').click();await page.locator('[data-network-quick=roads]').click();
  const box=await page.locator('#map').boundingBox(),view=await page.evaluate(()=>window.__v2Test.getView());
  const screen=(x,y)=>({x:box.x+box.width/2+(x-view.cx)*view.scale,y:box.y+box.height/2+(y-view.cy)*view.scale});
  const bar=()=>page.locator('[data-road-session]');
  const validate=()=>page.locator('[data-road-validate]').click();
  const snapshot=()=>page.evaluate(()=>window.__v2Test.world());
  async function move(from,to){
    const a=screen(from.x,from.y),b=screen(to.x,to.y);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();await ready();
    assert.equal(await page.locator('#road-towns-dialog').count(),0,'no town question during a gesture');
  }
  await move(p(1600,3000),p(1600,3400));
  assert.deepEqual((await snapshot()).debug.v2RustCities.main.layouts[0],layout,'town is unchanged in the road draft');
  assert.equal(await bar().getAttribute('data-pending'),'true');
  const middle=page.locator('.v2-network-overlay [data-role=vertex][data-road="0"][data-index="1"]');
  const mx=Number(await middle.getAttribute('cx')),my=Number(await middle.getAttribute('cy'));
  await move(p(mx,my),p(mx+80,my+120));
  assert.deepEqual((await snapshot()).debug.v2RustCities.main.layouts[0],layout);
  await validate();const dialog=page.locator('#road-towns-dialog');await dialog.waitFor();
  await page.screenshot({path:`${out}/session-validation.png`});
  await dialog.locator('[data-choice=edit]').click();await dialog.waitFor({state:'detached'});await ready();assert.equal(await bar().getAttribute('data-pending'),'true');
  await validate();await dialog.waitFor();await dialog.locator('[data-choice=access]').click();await dialog.waitFor({state:'detached'});await bar().waitFor({state:'hidden'});
  const access=await page.evaluate(()=>window.__v2Test.world());
  assert.deepEqual(access.debug.v2RustCities.main.layouts[0].streets[0],inner);
  const approaches=access.debug.v2RustCities.main.layouts[0].streets.filter(s=>s.role==='approach');
  assert(approaches.length);assert(approaches.some(s=>s.path.at(-1).y>3010));
  assert.equal(access.debug.v2RustCities.main.layoutKey,'road-test');assert.equal(access.stats['v2.roadAccessUnreachable'],'');
  await page.locator('[data-network-quick=roads]').click();await page.getByRole('button',{name:'Undo road edit',exact:true}).click();await ready();
  assert.deepEqual(await page.evaluate(()=>window.__v2Test.world().debug.v2RustCities.main.layouts[0]),layout);
  assert.deepEqual((await snapshot()).roads[0].path,world.roads[0].path,'one undo restores the complete validated batch');
  await move(p(1600,3000),p(1600,3400));
  await page.locator('[data-road-cancel]').click();await bar().waitFor({state:'hidden'});
  assert.deepEqual((await snapshot()).roads[0].path,world.roads[0].path,'cancel discards the draft');
  await page.locator('[data-network-quick=roads]').click();await move(p(1600,3000),p(1600,3400));
  await page.locator('#edit-done').click();await dialog.waitFor();await dialog.locator('[data-choice=rebuild]').click();await dialog.waitFor({state:'detached'});await bar().waitFor({state:'hidden'});
  const rebuilt=await page.evaluate(()=>window.__v2Test.world());
  assert.notEqual(rebuilt.debug.v2RustCities.main.layoutKey,'road-test');assert.equal(rebuilt.debug.v2RustCities.main.stage,'layout');
  assert(Math.abs(rebuilt.roads[0].controls[1].y-3400)<20,'a full town rebuild preserves the hand-edited road');
  await reveal('#import-open');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/isolated-access.json`);
  await page.locator('#import-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');
  await page.locator('#family-tab-map').click();await page.evaluate(v=>window.__v2Test.setView(v),view);await page.locator('[data-network-quick=roads]').click();
  await move(p(1600,3000),p(1600,3400));assert.equal((await snapshot()).debug.v2RustCities.main.layoutKey,'road-test');
  await validate();await bar().waitFor({state:'hidden'});assert.notEqual(await page.evaluate(()=>window.__v2Test.world().debug.v2RustCities.main.layoutKey),'road-test');
  assert.deepEqual(errors,[]);assert.deepEqual(nativeDialogs,[]);await page.screenshot({path:`${out}/town-dependents.png`});
  await writeFile(`${out}/dependents-report.json`,JSON.stringify({sessionDraft:true,noPromptDuringGestures:true,validationOnly:true,continueEditing:true,cancelRestoresBaseline:true,compoundUndo:true,accessOnly:true,fullRebuild:true,automaticFarmRebuildOnValidation:true,editedRoadRetained:true,errors,nativeDialogs},null,2));
  console.log('Town dependent check passed.');
}catch(error){await page.screenshot({path:`${out}/town-dependents-failure.png`}).catch(()=>{});console.error(errors);throw error;}
finally{await browser.close();}
