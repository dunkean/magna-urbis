import {strict as assert} from 'node:assert';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {compileSurfaceWorld,fingerprint} from '../src/surface/compiler';
import {surfaceLayerInput} from '../tests/fixtures/surfaceLayerInput';
import frozen from '../tests/fixtures/surface-layer-legacy-baseline.json';
import {decodeSurfaceBinary} from '../src/surface/binary';
import {recoverRetainedPopulationSampler} from '../src/surface/retainedPopulation';
import type {Bounds,SurfaceWorld,SurfaceCandidate} from '../src/surface/model';
import type {PopulationOptions} from '../src/surface/population';

const {values}=parseArgs({options:{baseline:{type:'string'},optimized:{type:'string'},source:{type:'string'},out:{type:'string'}}});
if(!values.baseline||!values.optimized||!values.out)throw Error('--baseline population.ts --optimized population.ts --out report.json [--source retained.surfacebin]');
type Generate=(world:SurfaceWorld,bounds:Bounds,options?:PopulationOptions)=>SurfaceCandidate[];
const original:Generate=(await import(pathToFileURL(resolve(values.baseline)).href)).generateSurfaceCandidates;
const optimized:Generate=(await import(pathToFileURL(resolve(values.optimized)).href)).generateSurfaceCandidates;
const sha=(s:Uint8Array)=>createHash('sha256').update(s).digest('hex');
const moduleInfo=(path:string)=>{const data=readFileSync(resolve(path)),normalized=Buffer.from(data.toString('utf8').replaceAll('\r\n','\n'));return {path:resolve(path),sha256:sha(data),normalizedGitBlob:createHash('sha1').update(`blob ${normalized.length}\0`).update(normalized).digest('hex')};};
const checks:Array<Record<string,unknown>>=[];
function compare(name:string,world:SurfaceWorld,bounds:Bounds,options:PopulationOptions={}){
  const before=fingerprint(world);
  const started=performance.now(),a=original(world,bounds,options),baselineMs=performance.now()-started;
  const next=performance.now(),b=optimized(world,bounds,options),optimizedMs=performance.now()-next;
  assert.deepStrictEqual(b,a,name+' full records differ');assert.equal(fingerprint(world),before,name+' mutated input');
  checks.push({name,count:a.length,fingerprint:fingerprint(a),baselineMs,optimizedMs});return a;
}
const canonical=compileSurfaceWorld(surfaceLayerInput(),{topographicRadiiM:[32,64,128]});
const frozenRecords=compare('frozen-pre-layer-6422',canonical,{minX:32,minZ:32,maxX:480,maxZ:480});
assert.equal(frozenRecords.length,frozen.candidateCount);assert.equal(fingerprint(frozenRecords),frozen.candidateFingerprint);
const familySets:Array<SurfaceCandidate['family'][]|undefined>=[undefined,[],['tree'],['shrub'],['boulder'],['grass'],['debris'],['tree','boulder','grass']];
let matrixQueries=0,totalRecords=0,matchedErrors=0;
const outcome=(fn:Generate,world:SurfaceWorld,bounds:Bounds,options:PopulationOptions)=>{try{return{records:fn(world,bounds,options)};}catch(e){const x=e as Error&{budget?:string};return{error:{name:x.name,message:x.message,budget:x.budget}};}};
for(const [caseIndex,origin]of [-192.5,1_000_000_000.125].entries()){
  const world=structuredClone(canonical),t=world.terrain;t.originX=origin;t.originZ=-origin;
  world.bounds={minX:t.originX,minZ:t.originZ,maxX:t.originX+(t.width-1)*t.spacingM,maxZ:t.originZ+(t.height-1)*t.spacingM};
  world.seed=caseIndex===0?-2147483648:4294967295;
  // Deliberately adversarial direct-generator input. This is a compatibility
  // check of existing nearest fallback/NaN arithmetic, not a valid hydrated-world claim.
  for(const key of ['treeCover','shrubCover','grassCover','stoniness','litter','slope'] as const){
    const a=world.fields[key];for(let i=0;i<a.length;i++)a[i]=key==='slope'?[0,1.25,1.250001,NaN,Infinity][i%5]:[0,.2,.8,1,NaN,Infinity][i%6];
  }
  for(let i=0;i<world.fields.occupation.length;i++){world.fields.occupation[i]=i%6;world.fields.waterClass[i]=i%11===0?1:0;}
  const b=world.bounds,queries:Bounds[]=[b,{minX:b.minX,minZ:b.minZ,maxX:b.minX,maxZ:b.minZ},{minX:b.maxX,minZ:b.maxZ,maxX:b.maxX,maxZ:b.maxZ},
    {minX:b.minX-12,minZ:b.minZ-12,maxX:b.minX+63.99,maxZ:b.minZ+64.01},
    {minX:b.maxX+100,minZ:b.maxZ+100,maxX:b.maxX+120,maxZ:b.maxZ+120}];
  const immutable=fingerprint(world);
  for(const [qi,q]of queries.entries())for(const [fi,families]of familySets.entries())for(const retention of [0,.125,1])for(const includeOverhang of [false,true]){
    const options={families,retention,includeOverhang},a=outcome(original,world,q,options),b=outcome(optimized,world,q,options);
    assert.deepStrictEqual(b,a,`matrix ${caseIndex}/${qi}/${fi}/${retention}/${includeOverhang}`);matrixQueries++;totalRecords+=a.records?.length??0;if(a.error)matchedErrors++;
  }
  const failures=[{bounds:world.bounds,options:{maxCandidates:1}},{bounds:world.bounds,options:{maxCheckedSlots:1}},{bounds:{...world.bounds,minX:NaN},options:{}},{bounds:world.bounds,options:{signal:AbortSignal.abort()}}];
  for(const failure of failures){const capture=(fn:Generate)=>{try{fn(world,failure.bounds,failure.options);return null;}catch(e){const x=e as Error&{budget?:string};return{name:x.name,message:x.message,budget:x.budget};}};assert.deepStrictEqual(capture(optimized),capture(original));}
  assert.equal(fingerprint(world),immutable,'Adversarial matrix mutated its input');
}
let realSource:Record<string,unknown>|undefined;
if(values.source){
  const bytes=readFileSync(resolve(values.source)),packet=decodeSurfaceBinary<any>(bytes),recovered=recoverRetainedPopulationSampler(packet),world=recovered.sampler;
  const cx=(world.bounds.minX+world.bounds.maxX)/2,cz=(world.bounds.minZ+world.bounds.maxZ)/2;
  compare('real-retained-tree-4km',world,{minX:cx-2000,minZ:cz-2000,maxX:cx+2000,maxZ:cz+2000},{families:['tree'],includeOverhang:true});
  compare('real-retained-all-families-480m',world,{minX:cx-240,minZ:cz-240,maxX:cx+240,maxZ:cz+240},{includeOverhang:true});
  realSource={path:resolve(values.source),sha256:sha(bytes),canonicalTerrainHash:recovered.terrainHash,canonicalContextId:recovered.contextId};
}
const report={format:'independent-surface-population-optimization-review',version:1,status:'PASS',baseline:moduleInfo(values.baseline),optimized:moduleInfo(values.optimized),frozen:{count:frozenRecords.length,fingerprint:fingerprint(frozenRecords)},matrixQueries,matrixFullRecordComparisons:totalRecords,matchedErrors,checks,realSource,
  limits:'CPU/Node equivalence and single-run timings only. Adversarial nonfinite direct fields test legacy arithmetic compatibility, not hydrator validity. No browser, renderer or20s navigation claim.'};
mkdirSync(dirname(resolve(values.out)),{recursive:true});writeFileSync(resolve(values.out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
