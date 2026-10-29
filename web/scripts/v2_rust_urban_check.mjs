import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const backend = process.env.MAGNA_URBAN_BACKEND ?? 'rust';
const moduleRoot = '/@fs/' + fileURLToPath(new URL('../src/v2', import.meta.url)).replace(/\\/g, '/');
const out = new URL(`../out/v2-${backend}-urban/`, import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge' });
try {
 const page = await browser.newPage();
 page.on('console', m => { if(m.type()==='error') process.stderr.write(m.text()+'\n'); });
 page.on('pageerror', e=>process.stderr.write(e.message+'\n'));
 await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174'}/v2.html?empty=1`);
 const result = await page.evaluate(async({moduleRoot,backend})=>{
  const { defaultSettings } = await import(moduleRoot+'/settings.ts');
  const { generateTerrain,planRegion,generateTownStage }=await import(moduleRoot+'/engine.ts');
  const s=defaultSettings();s.extent=1600;s.settlementCount=1;s.options={...s.options,size:'hamlet',population:120,relief:'flat',coast:'none',river:'none',walls:'none',castle:'no',importedHeight:{w:8,h:8,rgba:new Uint8Array(0),elevations:new Float32Array(64).fill(20)}};
  s.urban={backend,houses:{floors:2},local:{main:{houses:{floors:3}}}};
  let world=await generateTerrain(s);world=await planRegion(world,s);const region=structuredClone(world);
  const metrics=[],progress=[];
  for(const stage of ['layout','parcels','programme','buildings']) {
   const started=performance.now();
   world=await generateTownStage(world,s,'main',stage,p=>progress.push(p.label));
   const snap=world.debug.v2RustCities.main;
   metrics.push({stage,ms:Math.round(performance.now()-started),quarters:world.urban.quarters.length,streets:world.urban.streets.length,parcels:world.urban.parcels.length,buildings:world.urban.buildings.length,refusals:snap.scene?.refusals.length??0,backend:world.stats['v2.urbanBackend'],generator:snap.scene?.generator_version});
  }
  const snap=world.debug.v2RustCities.main;
  if(!world.urban.buildings.length)throw new Error('Aucun bâtiment architectural Rust généré. '+JSON.stringify(metrics)+' '+JSON.stringify(snap.scene?.refusals.slice(0,3)));
  if(metrics.slice(0,3).some(m=>m.buildings))throw new Error('Les étapes amont ont déjà créé des maisons.');
  if(!snap.layouts[0]||!snap.partitions[0]||!snap.requests.length)throw new Error('Snapshot incomplet.');
  const beforeLayout=snap.layoutKey,beforeParcel=snap.parcelKey,beforeHouse=snap.buildingKey;
  const request=snap.requests[0];const untouched = JSON.stringify(snap.scene.buildings.filter(b=>b.parcel_id!==request.parcel_id));s.urban.buildings={[`main/${request.id}`]:{seed:"one-house-seed",overrides:{floors:2}}};
  world=await generateTownStage(world,s,'main','buildings');
  const changed=world.debug.v2RustCities.main;
  if(changed.layoutKey!==beforeLayout||changed.parcelKey!==beforeParcel||changed.buildingKey===beforeHouse)throw new Error('Invalidation locale maisons incorrecte.');
  if(changed.lastBuildingRequests!==1)throw new Error('Toutes les maisons ont été reconstruites pour une seule modification.');
  const target=changed.scene.buildings.find(b=>b.parcel_id===request.parcel_id);
  if(!target||!target.volumes.some(v=>v.levels.length===2))throw new Error('La priorité maison2/local3/global2 est incorrecte. '+JSON.stringify({target:target?.volumes.map(v=>v.levels.length),refusals:changed.scene.refusals}));
  if(JSON.stringify(changed.scene.buildings.filter(b=>b.parcel_id!==request.parcel_id))!==untouched)throw new Error('Une maison non modifiée a changé.');
  const replay=await generateTownStage(region,s,'main','buildings');
  if(JSON.stringify(replay.debug.v2RustCities.main.scene.buildings)!==JSON.stringify(changed.scene.buildings))throw new Error('La recette ne reproduit pas les modifications interactives.');
  s.urban.buildings[`main/${request.id}`].overrides.floors=4;
  world=await generateTownStage(world,s,'main','buildings');
  const refused=world.debug.v2RustCities.main;
  if(refused.scene.buildings.some(b=>b.parcel_id===request.parcel_id)||!refused.scene.refusals.some(r=>r.parcel_id===request.parcel_id))throw new Error('La source incompatible avec4 étages n’a pas été refusée.');
  const layoutAgain=await generateTownStage(world,s,'main','layout');
  if(layoutAgain.stats['v2.urbanRefusals:main']!==0||layoutAgain.debug.v2RustCities.main.warnings.some(w=>w.includes('Étages hors plage')))throw new Error('Un refus de maison est affiché à l’étape plan.');
  return {metrics,progress,localHouseInvalidation:true,incrementalHouseRequests:changed.lastBuildingRequests,unrelatedHousesUnchanged:true,houseFloorPrecedence:{global:2,local:3,house:2},invalidFourStoreysExplicitlyRefused:true,recipeReproducesInteractiveEdits:true,stageWarningsScoped:true,requestId:request.id,project:(await import(moduleRoot+'/project.ts')).serializeProject(s,world)};
 },{moduleRoot,backend});
 await writeFile(new URL('project.json',out),result.project);delete result.project;
 await writeFile(new URL('results.json',out),JSON.stringify(result,null,2));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
} finally { await browser.close(); }
