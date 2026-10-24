/** Direct CPU before/after response cost. Retained source reconstruction only;
 * no browser, generator, registration or GPU is invoked. */
import{readFileSync,writeFileSync}from'node:fs';
import{parseArgs}from'node:util';
import{strict as assert}from'node:assert';
import{decodeSurfaceBinary}from'../src/surface/binary';
import{hydrateSurfaceWorld,retargetSurfaceWorld}from'../src/surface/compiler';
import{createGroundResponse}from'../src/surface/groundResponse';
import{sampleTerrainHeight}from'../src/surface/heightSampling';
import type{SurfaceWorld}from'../src/surface/model';
const{values}=parseArgs({options:{world:{type:'string'},legacy:{type:'string'},out:{type:'string'},rounds:{type:'string',default:'3'}}});
if(!values.world||!values.legacy||!values.out)throw Error('--world EXPLICIT_RESPONSE_WORLD --legacy ORIGINAL_PACKET --out REPORT [--rounds 3]');
const decodedCurrent=decodeSurfaceBinary<any>(readFileSync(values.world)),current=hydrateSurfaceWorld(decodedCurrent.world??decodedCurrent),decoded=decodeSurfaceBinary<any>(readFileSync(values.legacy)),legacy=hydrateSurfaceWorld(decoded.world??decoded),r=current.groundResponse!;
assert.ok(r);assert.equal(current.terrain.source.id,legacy.terrain.source.id);assert.equal(current.versions.environment,legacy.versions.environment);
assert.equal(legacy.groundResponse,undefined);
for(const key of Object.keys(current.fields))assert.deepEqual((current.fields as any)[key],(legacy.fields as any)[key],key+' canonical physical/legacy fields changed');
const rounds=Number(values.rounds);assert.ok(Number.isInteger(rounds)&&rounds>=3&&rounds<=20);
const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const create:number[]=[];for(let i=0;i<rounds;i++){const began=performance.now();assert.equal(createGroundResponse(r.grid,r.source,r.environmentVersion,r.materialLibraryVersion,r.fields).id,r.id);create.push(performance.now()-began);}
const results:any[]=[];
for(const n of [128,512]){
  const spacingM=4000/(n-1),heights=Float32Array.from({length:n*n},(_,i)=>sampleTerrainHeight(legacy.terrain,18000+(i%n)*spacingM,18000+Math.floor(i/n)*spacingM));
  const terrain={...legacy.terrain,width:n,height:n,originX:18000,originZ:18000,spacingM,heights};
  const times={legacy:[] as number[],response:[] as number[]};
  for(let round=0;round<rounds+1;round++)for(const mode of round%2?['response','legacy']as const:['legacy','response']as const){
    const began=performance.now();retargetSurfaceWorld(mode==='legacy'?legacy:current,terrain);if(round)times[mode].push(performance.now()-began);
  }
  results.push({width:n,height:n,sourceNativeSpacingM:terrain.source.nativeSpacingM,gridSpacingM:spacingM,times,medianLegacyMs:median(times.legacy),medianResponseMs:median(times.response)});
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(values.out,JSON.stringify({format:'direct-ground-response-cpu-cost',version:1,sourceGrid:current.terrain.width,sourceFieldsExactlyEqual:true,responseCreationAndDigestMs:create,responseCreationMedianMs:median(create),results,
  scope:'Alternating direct Node wall spans, one discarded projection warmup. Real retained V12 canonical512 fields with an explicit derived response table; projection heights reconstruct that same stored source (no new learned detail). No original worker initializer or end-to-end latency claim. Browser/scheduler/GPU timings are not measured.'},null,2)+'\n');
