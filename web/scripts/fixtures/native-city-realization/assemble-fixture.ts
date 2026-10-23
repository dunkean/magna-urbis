import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only path configuration differs from the executed, SHA-recorded out/ probe.
const flags=Object.fromEntries(process.argv.slice(2).reduce<string[][]>((pairs,arg,i,args)=>i%2 ? pairs : [...pairs,[arg,args[i+1]]],[]));
const folder=(value:string)=>path.resolve(value).replaceAll('\\','/')+'/';
const root=folder(flags['--root'] ?? fileURLToPath(new URL('../../../../',import.meta.url)));
const out=folder(flags['--out'] ?? root+'web/out/surface/native-city-realization');
if(!flags['--base']) throw new Error('Required: --base <bound source .surfacebin> [--root <repo>] [--out <ignored output directory>]');
const source=path.resolve(flags['--base']);
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const json=async(path:string)=>JSON.parse(await readFile(out+path,'utf8'));
const [{nativeExteriorDetail},{exportMagnaBuildings},{packUrbanColumns,unpackUrbanColumns},{magnaUrbanIdentity},{decodeSurfaceBinary,encodeSurfaceBinary},{fingerprint}]=await Promise.all([
 import(pathToFileURL(root+'web/src/render/urbanBuildingDetails.ts').href),
 import(pathToFileURL(root+'web/src/surface/adapters/magna.ts').href),
 import(pathToFileURL(root+'web/src/surface/urbanColumns.ts').href),
 import(pathToFileURL(root+'web/src/surface/adapters/magnaUrban.ts').href),
 import(pathToFileURL(root+'web/src/surface/binary.ts').href),
 import(pathToFileURL(root+'web/src/surface/compiler.ts').href),
]);
const plans=await json('new-plans-500-response.json'), old=await json('accepted-500-source-clone.json');
const planningReport=await json('new-plans-500-report.json'),realizationReport=await json('new-realize-accepted-report.json');
const responses=(await readFile(out+'new-realize-accepted-responses.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
assert.equal(plans.data.buildings.length,responses.length);
const originalByID=new Map<string,any>(old.buildings.map((b:any)=>[b.id,b]));
const originalCloneSHA=sha(await readFile(out+'accepted-500-source-clone.json'));
const sourceBytes=await readFile(source),sourceSHA=sha(sourceBytes);
const packet:any=decodeSurfaceBinary(sourceBytes),originalWorld=fingerprint(packet.world),originalParent=fingerprint(packet.terrainParents),originalSource=fingerprint(packet.source);
const oldUrban=unpackUrbanColumns(packet.urban),oldUrbanID=magnaUrbanIdentity(packet.urban);
const unchanged=(building:any)=>JSON.stringify({id:building.id,parcel_id:building.parcel_id,transform:building.transform,ground_z_m:building.ground_z_m,footprint:building.footprint,roof_footprint:building.roof_footprint,resolved:building.resolved,levels:building.volumes.map((v:any)=>v.levels),materials:building.volumes.map((v:any)=>v.materials)});
const realized:any[]=[],differences:any[]=[],mappingRefusals:any[]=[];
for(let i=0;i<responses.length;i++){
 const plan=plans.data.buildings[i],response=responses[i];
 if(!response.ok)continue;
 const inputSnapshot=unchanged(plan);
 try{
  const result=nativeExteriorDetail(plan,response.data);
  assert.equal(unchanged(plan),inputSnapshot,'native conversion mutated new source plan');
  assert.equal(unchanged(result.building),inputSnapshot,'native conversion changed plan geometry/levels/materials/transform');
  const original=originalByID.get(plan.id)!;
  differences.push({id:plan.id,oldGroundZM:original.ground_z_m,newGroundZM:plan.ground_z_m,groundDeltaM:plan.ground_z_m-original.ground_z_m,
   oldTransform:original.transform,newTransform:plan.transform,
   sourceFootprintExact:JSON.stringify(original.footprint)===JSON.stringify(plan.footprint),
   oldLevels:original.volumes.map((v:any)=>v.levels.length),newLevels:plan.volumes.map((v:any)=>v.levels.length),
   oldRecipe:original.recipe_id,newRecipe:plan.recipe_id,oldVariant:original.variant_id,newVariant:plan.variant_id});
  realized.push(result.building);
 }catch(error){mappingRefusals.push({id:plan.id,error:String(error)});}
}
await writeFile(out+'native-world-realized-buildings.json',JSON.stringify({buildings:realized,materials:plans.data.materials,generator_version:plans.data.generator_version}));
await writeFile(out+'new-vs-old-plan-comparison.json',JSON.stringify({differences,mappingRefusals},null,2));
assert.equal(mappingRefusals.length,0,'do not publish a fixture that silently drops failed native world mappings');
assert.equal(realized.length,419,'This pinned reference fixture expects419 genuine native exteriors; inspect new native refusals instead of relabelling another count.');
const acceptedIDs=new Set(realized.map(b=>b.id)),refused=planningReport.refusals;
const exported=exportMagnaBuildings({buildings:realized,materials:plans.data.materials});
for(const building of exported.buildings) Object.assign(building.presentation,{nativePlanVersion:plans.data.generator_version,nativeGeneratorVersion:responses[0].data.generator_version,nativeExteriorRealization:'realize-plan; interiors=false',sourceInputBuildingId:building.id});
const rawUrban:any={...oldUrban,...exported,occupationSource:'accepted-records',
 occupationBuildings:oldUrban.occupationBuildings.map((b:any)=>({...b,realizationStatus:acceptedIDs.has(b.id)?'new-native-exterior-realized':'retained-source-plan-unrealized-in-this-fixture',
  sourcePlanVersion:'architectural-plans-1',nativeLevelsBaseline:'retained-original-accepted-source-plan',renderedExteriorPlanVersion:acceptedIDs.has(b.id)?plans.data.generator_version:null})),
 realization:{format:'new-native-realization-from-source-footprints',version:1,attemptedSourcePlots:500,realizedExteriorBuildings:realized.length,retainedUnrealizedSourcePlots:refused.length,
  currentPlanVersion:plans.data.generator_version,currentGeneratorVersion:responses[0].data.generator_version,interiors:false,occupationBaseline:'all500-original-accepted-source-plots-retained; canonical occupation unchanged'},
 presentation:{...oldUrban.presentation,nativeGeometryProducer:'plans::plan_batch + plans::realize_plan + nativeExteriorDetail; native source geometry, not renderer roof synthesis'}};
const urban=packUrbanColumns(rawUrban),urbanID=magnaUrbanIdentity(urban);
assert.notEqual(urbanID,oldUrbanID);
const derivation={format:'new-native-realization-from-source-footprints',version:1,sourceCacheSha256:planningReport.sourceCacheSha256,
 sourcePlacementRequestsSha256:planningReport.sourcePlacementRequestsSha256,planningRequestSha256:planningReport.requestSha256,
 planningResponseSha256:planningReport.responseSha256,realizationRequestJsonlSha256:realizationReport.requestJsonlSha256,
 realizationResponseJsonlSha256:realizationReport.responseJsonlSha256,nativeExecutableSha256:realizationReport.executableSha256,
 attempted:500,currentPlans:plans.data.buildings.length,nativeExteriors:realized.length,unrealizedSourcePlots:refused.length,
 planVersion:plans.data.generator_version,generatorVersion:responses[0].data.generator_version,interiors:false,
 acceptedIDs:[...acceptedIDs],planningRefusals:refused,canonicalOccupationBaseline:'original500-source-plots',freshNeuralGeneration:false};
const next:any={...packet,urban,urbanId:urbanID,
 source:{...packet.source,urbanId:urbanID,sceneContextId:fingerprint({urbanID,derivation}),sceneEpoch:fingerprint(derivation),
  derivedUrban:{...derivation,offlineFixtureOnly:true,liveHandshakeQualified:false},
  derivedUrbanResponseArchive:{format:'magna-native-source-responses-1',encoding:'utf8-json-and-jsonl',
   planningRequestJSON:new Uint8Array(await readFile(out+'new-plans-500-request.json')),
   planningResponseJSON:new Uint8Array(await readFile(out+'new-plans-500-response.json')),
   exteriorResponsesJSONL:new Uint8Array(await readFile(out+'new-realize-accepted-responses.jsonl'))},
  ...(packet.source.frame ? {frame:{...packet.source.frame,liveCompatible:false,liveIncompatibleReason:'offline derived native-house realization fixture; original live browser scene is not this new urban identity'}} : {})}};
assert.equal(fingerprint(packet.world),originalWorld);assert.equal(fingerprint(packet.terrainParents),originalParent);assert.equal(fingerprint(packet.source),originalSource);
const encoded=encodeSurfaceBinary(next),manifestLength=new DataView(encoded.buffer,encoded.byteOffset).getUint32(8,true);
await writeFile(out+'native-current-419-source-footprints.surfacebin',encoded);
const revived:any=decodeSurfaceBinary(encoded);
assert.equal(magnaUrbanIdentity(revived.urban),urbanID);
assert.equal(fingerprint(revived.world),originalWorld);assert.equal(fingerprint(revived.terrainParents),originalParent);
assert.equal(sha(revived.source.derivedUrbanResponseArchive.planningRequestJSON),planningReport.requestSha256);
assert.equal(sha(revived.source.derivedUrbanResponseArchive.planningResponseJSON),planningReport.responseSha256);
assert.equal(sha(revived.source.derivedUrbanResponseArchive.exteriorResponsesJSONL),realizationReport.responseJsonlSha256);
assert.equal(sha(await readFile(source)),sourceSHA);assert.equal(sha(await readFile(out+'accepted-500-source-clone.json')),originalCloneSHA);
const roofTriangles=exported.buildings.reduce((n:number,b:any)=>n+b.triangles.filter((t:any)=>t.surface==='roof').length,0);
const report={format:'native-current-exterior-fixture-from-actual-source-footprints',version:1,status:'source-fixture-built-awaiting-native-render',
 file:out+'native-current-419-source-footprints.surfacebin',bytes:encoded.byteLength,sha256:sha(encoded),manifestBytes:manifestLength,
 provenance:derivation,oldUrbanID,newUrbanID:urbanID,worldAndTerrainParentsByteFingerprintUnchanged:true,oldSourcePacketUnchanged:true,
 roundtripUrbanIdentityExact:true,sourceAcceptedOccupationRecords:oldUrban.occupationBuildings.length,newRenderedBuildings:exported.buildings.length,
 currentNativeProducerInputsAndResolvedResponsesArchivedByteExactly:true,
 roofTriangles,allNewPlanIdentityGroundFootprintsLevelsMaterialsPreservedByNativeWorldConversion:mappingRefusals.length===0,
 acceptedOldFootprintExactJSONCount:differences.filter(d=>d.sourceFootprintExact).length,
 maxNewVsOldConstructionPlaneDeltaM:Math.max(...differences.map(d=>Math.abs(d.groundDeltaM))),
 limitations:['New current native plans/exteriors, not replay of incompatible legacy houses-2 plans.','419 native exteriors from500 source plot attempts;81 explicit native planning refusals remain accepted legacy occupation plots without new meshes.','Interiors false; native realization does not certify complete city/site/access/capacity or universally valid terrain supports.','No GPU render, fine neural terrain or live-handshake claim for this new fixture.']};
await writeFile(out+'native-current-419-fixture-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({file:report.file,bytes:report.bytes,manifestBytes:manifestLength,realized:report.newRenderedBuildings,occupation:report.sourceAcceptedOccupationRecords,roofTriangles,urbanID,sourceUnchanged:true}));
