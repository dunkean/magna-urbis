// node --import ./scripts/shaderModuleStubs.mjs --import tsx scripts/v2_urban_road_check.mjs
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseProject,serializeProject} from '../src/v2/project.ts';
import {projectRustTown} from '../src/v2/rustTownProjection.ts';
import {siteVisualScene} from '../src/ui/urbanSilhouettes.ts';

const out='out/v2-road-editor',project=parseProject(await readFile(`${out}/fixture.json`,'utf8'));
const {world,settings}=project,p=(x,y)=>({x,y}),square=(x,y,s)=>({outer:[p(x,y),p(x+s,y),p(x+s,y+s),p(x,y+s)],holes:[]});
const layout={key:'main',center:p(1200,3100),culture:'european-organic',warnings:[],quarters:[{shape:square(900,2900,1100),phase:0}],
  streets:[{path:[p(1000,3000),p(1400,3000)],widths:[4,4],rank:3,role:'lane'},
    {path:[p(1400,3000),p(1400,3400)],widths:[3,3],rank:3,role:'lane'}],
  blocks:[{shape:square(1100,3020,150),kind:'block',quarter:0,axis:p(1,0)},{shape:square(1700,3500,150),kind:'block',quarter:0,axis:p(1,0)}]};
const partitions=[{key:'main',warnings:[],parcels:layout.blocks.map((b,block)=>({id:`fixture-parcel-${block}`,shape:b.shape,block,use:'plot',axis:p(1,0),rank:1,front:null}))}];
const sites=partitions[0].parcels.map((parcel,offset)=>({id:`${parcel.id}/building`,parcel_id:parcel.id,offset,function:'domestic',culture:{culture:'european-organic',pack:'european',mode:'historical_strict',borrowing:null},surface:[parcel.shape],preview:true,ground_z_m:20,entrance:parcel.shape.outer[0],access_id:''}));
const snapshot={backend:'rust-wasm-cpu',stage:'buildings',layoutKey:'urban-road-fixture',layouts:[layout],partitions,programmePartitions:partitions,sites,scene:siteVisualScene(sites),buildingIds:[],warnings:[]};
world.landuse=undefined;world.roads=[];world.bridges=[];world.debug.v2RustCities={main:snapshot};world.debug.v2RustRegion.roads={segments:[],junctions:[],exits:[],warnings:[],unreachable:[],routes:0,lengthByClass:{},lengthBySurface:{},ms:0};
world.urban=projectRustTown(snapshot,1000,'european-organic');world.settlements=[{...world.settlements[0],center:layout.center,core:layout.center,radius:500,extent:layout.quarters[0].shape.outer,urban:world.urban}];
world.debug.v2RustRegion.placement.settlements=world.settlements.map(t=>({...t,urban:undefined}));world.stats['v2.terrainKey']='urban-road-flat';
settings.urban={backend:'rust',architecture:'silhouette',through:'buildings'};settings.region.autoBuildPopulation=0;
await writeFile(`${out}/urban-streets.json`,serializeProject(settings,world));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],dialogs=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
const reveal=selector=>page.locator(selector).evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement){if(p.tagName==='DETAILS')p.open=true;if(p.classList.contains('stage-body')&&p.hidden)document.querySelector(`[aria-controls="${p.id}"]`)?.click();}});
const ready=()=>page.waitForFunction(()=>document.querySelector('.v2-network-banner:not([hidden])')?.getAttribute('aria-busy')==='false',null,{timeout:120000});
try{
  await page.goto(`${process.env.MAGNA_V2_URL??'http://127.0.0.1:4174'}/v2.html?empty&test=1&lang=fr&threads=single`);
  await reveal('#import-open');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/urban-streets.json`);
  await page.locator('#import-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');
  await page.locator('#family-tab-map').click();await page.evaluate(()=>window.__v2Test.setView({cx:1400,cy:3300,scale:.65}));
  await page.locator('[data-network-quick=roads]').click();
  const box=await page.locator('#map').boundingBox(),view=await page.evaluate(()=>window.__v2Test.getView());
  const screen=(x,y)=>({x:box.x+box.width/2+(x-view.cx)*view.scale,y:box.y+box.height/2+(y-view.cy)*view.scale});
  const click=async(x,y)=>{const q=screen(x,y);await page.mouse.click(q.x,q.y);};
  await click(1200,3000);assert.match(await page.locator('#edit-roads').innerText(),/Rue de ville/);
  const a=screen(1200,3000),b=screen(1200,3120);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();await ready();
  assert.equal(await page.locator('#road-towns-dialog').count(),0);
  const draft=await page.evaluate(()=>window.__v2Test.world());
  const manual=draft.debug.v2RustCities.main.layouts[0].streets;
  assert(manual.some(s=>s.path.some(p=>Math.abs(p.x-1200)<5&&Math.abs(p.y-3120)<5)),'actual city street follows the edit');
  assert.deepEqual(draft.debug.v2RustCities.main.scene,snapshot.scene,'buildings are retained during editing');
  await page.locator('[data-road-validate]').click();const dialog=page.locator('#road-towns-dialog');await dialog.waitFor();
  assert.match(await dialog.innerText(),/îlots touchés/);await dialog.locator('[data-choice=rebuild]').click();
  await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false',null,{timeout:120000});
  const bar=page.locator('[data-road-session]');await bar.waitFor({state:'hidden',timeout:120000});
  const result=await page.evaluate(()=>window.__v2Test.world()),city=result.debug.v2RustCities.main;
  assert.deepEqual(city.layouts[0].streets,manual,'local rebuilding preserves manual streets');
  assert.deepEqual(city.layouts[0].blocks[1],layout.blocks[1],'untouched block is exact');
  assert.deepEqual(city.partitions[0].parcels.find(p=>p.id==='fixture-parcel-1'),partitions[0].parcels[1],'untouched cadastre is exact');
  assert.deepEqual(city.scene.buildings.find(p=>p.parcel_id==='fixture-parcel-1'),snapshot.scene.buildings[1],'untouched house is exact');
  assert(result.stats['v2.roadRebuiltBlocks']>=1);assert.equal(city.layoutKey,'urban-road-fixture');assert(city.streetEdits.length);
  await page.screenshot({path:`${out}/urban-streets.png`});
  await page.locator('[data-network-quick=roads]').click();await page.getByRole('button',{name:'Annuler la modification de route',exact:true}).click();
  await ready();assert.deepEqual((await page.evaluate(()=>window.__v2Test.world())).debug.v2RustCities.main.layouts[0].streets,manual,'undoing Finish keeps the individual road gesture available');
  await page.keyboard.press('Control+z');await ready();assert.deepEqual((await page.evaluate(()=>window.__v2Test.world())).debug.v2RustCities.main.layouts[0],layout);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  const report={ok:true,localBlocks:result.stats['v2.roadRebuiltBlocks'],parcels:city.partitions[0].parcels.length,retainedHouse:true,manualStreet:true};
  await writeFile(`${out}/urban-report.json`,JSON.stringify(report,null,2));console.log(report);
}catch(error){await page.screenshot({path:`${out}/urban-streets-failure.png`});console.error('Toasts:',await page.locator('.toast').allTextContents());throw error;}
finally{await browser.close();}
