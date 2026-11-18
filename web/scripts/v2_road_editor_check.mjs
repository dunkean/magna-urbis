// Run with: node --import ./scripts/shaderModuleStubs.mjs --import tsx scripts/v2_road_editor_check.mjs
import { chromium } from 'playwright';
import { preview as previewV2 } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { defaultSettings } from '../src/v2/settings.ts';
import { serializeProject } from '../src/v2/project.ts';

const out='out/v2-road-editor';await mkdir(out,{recursive:true});
const settings=defaultSettings(),size=6400,n=64;
settings.extent=size;settings.runtime={backend:'rust',compute:'cpu',source:'procedural'};
settings.appearance={renderer:'classic',style:'parchment'};
settings.region={resolution:n,roads:{wobble:0,exits:{highway:0,main:1,local:0,track:0}}};
const p=(x,y)=>({x,y}),grid=value=>({w:n,h:n,cell:size/n,data:new Float32Array(n*n).fill(value)});
const lines=[ [p(1000,3000),p(2000,3000),p(3000,3000)], [p(3000,3000),p(4200,3000),p(5400,3000)],
  [p(3000,0),p(3000,700),p(3000,1400)], [p(3000,1400),p(3000,2200),p(3000,3000)] ];
const ends=[[0,1],[1,2],[3,4],[4,1]];
const segments=lines.map((path,i)=>({class:'main',surface:'gravel',profile:'medieval',width:5,a:ends[i][0],b:ends[i][1],path,crossings:[],length:Math.hypot(path[0].x-path.at(-1).x,path[0].y-path.at(-1).y),grade:0,importance:1000}));
const town=(key,x)=>({key,index:key==='main'?0:1,main:key==='main',cls:'town',population:1000,culture:'european-organic',center:p(x,3000),radius:80,archetype:'plain',
  extent:[p(x-80,2920),p(x+80,2920),p(x+80,3080),p(x-80,3080)],region:[],fixed:true,detail:'lazy'});
const farm=(x,y)=>({pos:p(x,y),angle:0,culture:'european-organic',type:'longere',size:'family',
  buildings:[[p(x-10,y-10),p(x+10,y-10),p(x+10,y+10),p(x-10,y+10)]],
  yard:[p(x-25,y-25),p(x+25,y-25),p(x+25,y+25),p(x-25,y+25)],drive:[p(x,3000),p(x,y+30)]});
const world={seed:settings.options.seed,mapSize:size,options:settings.options,stats:{},settlements:[town('main',1000),town('east',5400)],
  terrain:{height:grid(20),slope:grid(0),flow:grid(1),seaLevel:0,seaFraction:0,coastline:[],lakes:[],rivers:[],water:new Uint8Array(n*n),receiver:new Int32Array(n*n).fill(-1),filled:new Float32Array(n*n).fill(20),downSide:'S',seaSide:null},
  roads:lines.map(path=>({path,controls:path,controlIndices:[0,1,2],kind:'major',width:5})),bridges:[],names:{family:'english',town:'Road editor fixture',entries:[]},
  landuse:{areas:[],reserve:[],farmsteads:[]},
  debug:{v2RustRegion:{placement:{settlements:[],activities:[],warnings:[],requested:2,usableKm2:40,ms:0},roads:{segments,
    junctions:[{point:p(1000,3000),site:'main',degree:1},{point:p(3000,3000),site:null,degree:3},{point:p(5400,3000),site:'east',degree:1},{point:p(3000,0),site:'exit',degree:1},{point:p(3000,1400),site:null,degree:2}],
    exits:[{requested:'main',class:'main',gateway:'main',point:p(3000,0),reason:null}],warnings:[],unreachable:[],routes:3,lengthByClass:{main:7400},lengthBySurface:{gravel:7400},ms:0}},v2BaseBridges:[],v2TownBridges:{}}};
await writeFile(`${out}/fixture.json`,serializeProject(settings,world));
const barrierWorld=structuredClone(world);
barrierWorld.roads=[];barrierWorld.settlements=[];barrierWorld.landuse=undefined;
barrierWorld.debug.v2RustRegion.roads={segments:[],junctions:[],exits:[],routes:0,warnings:[],unreachable:[],lengthByClass:{},lengthBySurface:{},ms:0};
for(let y=0;y<n;y++)if(y<18||y>28)for(let x=29;x<=34;x++){
  barrierWorld.terrain.water[y*n+x]=1;barrierWorld.terrain.height.data[y*n+x]=-10;barrierWorld.terrain.filled[y*n+x]=-10;
}
await writeFile(`${out}/water-barrier.json`,serializeProject(settings,barrierWorld));
const mountainWorld=structuredClone(barrierWorld);
mountainWorld.terrain.water.fill(0);mountainWorld.terrain.height.data.fill(20);mountainWorld.terrain.filled.fill(20);
for(let y=0;y<n;y++)if(y<18||y>28)for(let x=29;x<=34;x++){
  mountainWorld.terrain.height.data[y*n+x]=1500;mountainWorld.terrain.filled[y*n+x]=1500;
}
const mountainSettings=structuredClone(settings);mountainSettings.region.roads.wobble=1.2;
await writeFile(`${out}/mountain-barrier.json`,serializeProject(mountainSettings,mountainWorld));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true,
  userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let built;
const overlay=()=>page.locator('.v2-network-overlay:not([hidden])');
const handles=()=>overlay().locator('[data-role=vertex][data-selected]');
const handle=(road,index)=>overlay().locator(`[data-role=vertex][data-road="${road}"][data-index="${index}"]`);
const action=role=>overlay().locator(`[data-role=${role}]`);
const reveal=selector=>page.locator(selector).evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement){if(parent.tagName==='DETAILS')parent.open=true;if(parent.classList.contains('stage-body')&&parent.hidden)document.querySelector(`[aria-controls="${parent.id}"]`)?.click();}});
const ready=()=>page.waitForFunction(()=>document.querySelector('.v2-network-banner:not([hidden])')?.getAttribute('aria-busy')==='false',null,{timeout:90000});
async function save(name){
  await reveal('#export-open');await page.locator('#export-open').click();await page.locator('#export-format').selectOption('project');
  const waiting=page.waitForEvent('download');await page.locator('#export-go').click();const download=await waiting;
  const text=await readFile(await download.path(),'utf8');await writeFile(`${out}/${name}.json`,text);
  if(await page.locator('#export-dialog').isVisible())await page.locator('[data-close="export-dialog"]').first().click();
  return JSON.parse(text);
}
try{
  if(process.env.MAGNA_V2_BUILT==='1')built=await previewV2({configFile:'vite.v2.config.ts',preview:{host:'127.0.0.1',port:0,strictPort:false}});
  const base=built?`http://127.0.0.1:${built.httpServer.address().port}`:process.env.MAGNA_V2_URL??'http://127.0.0.1:5174';
  await page.goto(`${base}/v2.html?empty&test=1&lang=en&threads=${encodeURIComponent(process.env.MAGNA_ROAD_THREADS??'auto')}`);
  await page.locator('#browserAdvice').waitFor();assert.match(await page.locator('#browserAdvice').innerText(),/For the best performance/);
  await page.locator('#language-select').selectOption('fr');assert.match(await page.locator('#browserAdvice').innerText(),/Pour de meilleures performances/);
  await page.locator('#language-select').selectOption('ru');assert.match(await page.locator('#browserAdvice').innerText(),/производительности/);
  await page.locator('#language-select').selectOption('en');await page.locator('#browserAdvice button').click();
  await reveal('#import-open');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/fixture.json`);
  await page.locator('#import-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');
  await page.locator('#family-tab-map').click();
  const map=await page.locator('#map').boundingBox(),view=await page.evaluate(()=>window.__v2Test.getView()),scale=view.scale;
  const screen=(x,y)=>({x:map.x+map.width/2+(x-view.cx)*scale,y:map.y+map.height/2+(y-view.cy)*scale});
  const click=async(x,y)=>{const q=screen(x,y);await page.mouse.click(q.x,q.y);};
  const drag=async(x,y,tx,ty)=>{const a=screen(x,y),b=screen(tx,ty);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();await ready();};
  await page.locator('[data-network-quick=roads]').click();
  console.log('Testing selection, connected movement and history');
  // Point -> whole road selection. A whole-road drag preserves both connected endpoints.
  await click(2000,3000);assert.equal(await action('remove-control').count(),0);
  await handle(0,1).click();assert.equal(await action('remove-control').count(),1);assert.equal(await action('cut-control').count(),1);
  await click(1600,3000);assert.equal(await action('remove-control').count(),0);
  await drag(1600,3000,1600,3400);
  const moved=await save('moved');assert.deepEqual(moved.world.roads[0].path[0],p(1000,3000));assert.deepEqual(moved.world.roads[0].path.at(-1),p(3000,3000));
  assert(Math.abs(moved.world.roads[0].controls[1].y-3400)<20);assert.equal(moved.world.debug.v2RustRegion.roads.junctions[1].degree,3);
  await page.getByRole('button',{name:'Undo road edit',exact:true}).click();await ready();assert(Math.abs(Number(await handle(0,1).getAttribute('cy'))-3000)<1);
  await page.getByRole('button',{name:'Redo road edit',exact:true}).click();await ready();assert(Number(await handle(0,1).getAttribute('cy'))>3300);
  await page.getByRole('button',{name:'Undo road edit',exact:true}).click();await ready();
  // Double click inserts a constraint and selects it immediately; minus removes only that constraint.
  console.log('Testing insertion, constraint removal and cutting');
  const q=screen(1500,3000);await page.mouse.dblclick(q.x,q.y);await ready();
  assert.equal(await handles().count(),4);
  assert.equal(await overlay().locator('[data-selected=true]').getAttribute('data-index'),'1');
  await action('remove-control').click();await ready();assert.equal(await handles().count(),3);
  // Scissors show the cut first, then commit two separate tips. Undo/redo includes the whole operation.
  await handle(0,1).click();await action('cut-control').click();assert.match(await page.locator('.v2-network-banner:not([hidden])').innerText(),/red gap/);
  await page.screenshot({path:`${out}/cut-preview.png`});await action('cut-control').click();await ready();
  const cut=await save('cut');assert.equal(cut.world.roads.length,5);
  assert(Math.hypot(cut.world.roads[0].path.at(-1).x-cut.world.roads[4].path[0].x,cut.world.roads[0].path.at(-1).y-cut.world.roads[4].path[0].y)>1);
  await page.getByRole('button',{name:'Undo road edit',exact:true}).click();await ready();
  // Entry deletion requires confirmation, removes the exclusive two-edge stem, and updates counts.
  console.log('Testing regional entries and their requested counts');
  const quality=page.getByRole('button',{name:'Full quality',exact:true});if(await quality.count())await quality.click();
  await click(3000,0);assert.equal(await action('delete-entry').count(),1);
  await action('delete-entry').click();await page.locator('#delete-road-entry-dialog [data-choice=cancel]').click();assert.equal(await action('delete-entry').count(),1);
  await action('delete-entry').click();await page.locator('#delete-road-entry-dialog [data-choice=confirm]').click();await ready();
  const deleted=await save('entry-deleted');assert.equal(deleted.world.roads.length,2);assert.deepEqual(deleted.world.debug.v2RustRegion.roads.exits,[]);assert.equal(deleted.settings.region.roads.exits.main,0);
  await page.getByRole('button',{name:'Undo road edit',exact:true}).click();await ready();
  await click(3000,0);await drag(3000,0,3400,-100);
  const entryMoved=await save('entry-moved');const entry=entryMoved.world.debug.v2RustRegion.roads.exits[0];assert.equal(entry.point.y,0);assert(Math.abs(entry.point.x-3400)<30);assert.equal(entry.connected,true);
  // A click outside the map creates an exact border entry and finishes the route.
  console.log('Testing waypoint creation, Escape and save/reopen');
  await page.locator('[data-network-quick=draw]').click();await click(1800,4900);await click(4300,4900);await click(6600,4900);await ready();
  const outside=await save('outside-entry');assert.equal(outside.world.roads.length,5);assert.equal(outside.world.roads[4].controls.length,3);assert.equal(outside.world.roads[4].path.at(-1).x,size);
  assert.equal(outside.settings.region.roads.exits.local,1);assert.equal(outside.world.debug.v2RustRegion.roads.exits.length,2);
  // Escape finishes a multi-waypoint draft; saved controls survive reopening and zoom.
  await page.locator('[data-network-quick=draw]').click();await click(1300,5600);await click(2100,5600);await click(3300,5700);await page.keyboard.press('Escape');await ready();
  const final=await save('final');assert.equal(final.world.roads.length,6);assert.equal(final.world.roads[5].controls.length,3);
  for(const road of final.world.roads)if(road.controls)assert.deepEqual(road.controlIndices.map(i=>road.path[i]),road.controls);
  await page.screenshot({path:`${out}/editor.png`});
  await reveal('#import-open');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/final.json`);
  await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');
  await page.locator('[data-network-quick=roads]').click();await click(2100,5600);assert.equal(await handles().count(),3);
  const selected=await handles().count();await page.mouse.wheel(0,-300);await page.waitForTimeout(250);assert.equal(await handles().count(),selected);
  // Qualify the real packaged engine: the straight chord crosses sea, so the route must find the dry gap.
  await reveal('#import-open');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/water-barrier.json`);
  await page.locator('#import-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');
  await page.locator('#family-tab-map').click();await page.evaluate(v=>window.__v2Test.setView(v),view);
  await page.locator('[data-network-quick=draw]').click();await click(1000,1300);await click(5400,1300);await page.keyboard.press('Escape');await ready();
  const detour=await page.evaluate(()=>window.__v2Test.world().roads[0]?.path);
  assert(detour?.length>2);assert(Math.max(...detour.map(q=>q.y))>1700,'the engine routes around the sea barrier through its dry gap');
  await page.screenshot({path:`${out}/water-detour.png`});
  // The same UI must avoid an impassable grade, both when creating and when editing an existing route.
  await reveal('#import-open');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/mountain-barrier.json`);
  await page.locator('#import-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');
  await page.locator('#family-tab-map').click();await page.evaluate(v=>window.__v2Test.setView(v),view);
  await page.locator('[data-network-quick=draw]').click();await click(1000,1300);await click(5400,1300);
  await reveal('[data-road-reroll]');await page.locator('[data-road-reroll]').click();await page.keyboard.press('Escape');await ready();
  const mountain=await page.evaluate(()=>window.__v2Test.world().roads[0]);
  assert.equal(mountain.routingVariant,1);assert.equal(mountain.controls.length,2);
  assert(mountain.path.length>mountain.controls.length);assert(Math.max(...mountain.path.map(q=>q.y))>1700,'creation follows the dry mountain pass');
  await click(5400,1300);await drag(5400,1300,5400,1000);
  const editedMountain=await page.evaluate(()=>window.__v2Test.world().roads[0]);
  assert(Math.max(...editedMountain.path.map(q=>q.y))>1700,'editing reroutes through the pass rather than joining the moved controls geometrically');
  assert(editedMountain.path.length>editedMountain.controls.length);assert.equal(editedMountain.routingVariant,1);
  await reveal('[data-road-reroll]');await page.locator('[data-road-reroll]').click();await ready();
  const alternative=await page.evaluate(()=>window.__v2Test.world().roads[0]);
  assert(Math.max(...alternative.path.map(q=>q.y))>1700);assert.deepEqual(alternative.controls,editedMountain.controls);
  assert(alternative.routingVariant>editedMountain.routingVariant,'the die installs a different feasible variant on this terrain');
  assert.notDeepEqual(alternative.path,editedMountain.path);
  await page.screenshot({path:`${out}/mountain-edited.png`});
  assert.deepEqual(errors,[]);await writeFile(`${out}/report.json`,JSON.stringify({selection:true,rerouting:true,undoRedo:true,cut:true,regionalEntries:true,creation:true,saveReopen:true,localization:true,realWaterDetour:true,realSlopeDetourOnCreationAndEdit:true,routeDice:true,errors},null,2));
  console.log('Road editor browser check passed: selection, routing, cutting, entries, history, save/reopen, localization.');
}catch(error){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});console.error('Browser errors:',errors);throw error;}
finally{await browser.close();await built?.close();}
