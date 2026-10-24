import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {strict as assert} from 'node:assert';

const {values}=parseArgs({options:{root:{type:'string'},capture:{type:'string'},out:{type:'string'},serials:{type:'string'},server:{type:'string',default:'http://127.0.0.1:8893'}}});
if(!values.root||!values.capture||!values.out)throw Error('--root ROOT --capture CAPTURE-DIRECTORY --out NEW-DIRECTORY [--serials 21,204,253] [--server http://127.0.0.1:8893]');
const root=resolve(values.root),capture=resolve(values.capture),out=resolve(values.out);
const report=JSON.parse(readFileSync(resolve(capture,'report.json'),'utf8')),revision=report.code?.selectedRepository?.head;
if(typeof revision!=='string'||!/^[a-f0-9]{40}$/.test(revision))throw Error('Capture has no exact producer revision');
const serials=values.serials?.split(',').map(Number);
if(serials&&(!serials.length||serials.some(s=>!Number.isSafeInteger(s)||s<0)||new Set(serials).size!==serials.length))throw Error('Pass distinct nonnegative native request serials');
// Read-only imports must really be the frozen producer being replayed. Neither
// missing compile inputs nor a changed compiler may be silently substituted.
assert.equal(execFileSync('git',['diff',revision,'--name-only','--','web/src/surface'],{cwd:root,encoding:'utf8'}).trim(),'','Surface producer differs from the recorded snapshot');
const load=(name:string)=>import(pathToFileURL(resolve(root,'web/src/surface',name)).href);
const [{decodeSurfaceBinary,encodeSurfaceBinary},{recoverRetainedPopulationSampler},{retargetSurfaceWorld,fingerprint},
  {generateSurfaceCandidatePages},{packCandidateColumns},{compareRefinementParent},{validateSurfacePacket}]=await Promise.all([
  load('binary.ts'),load('retainedPopulation.ts'),load('compiler.ts'),load('candidatePages.ts'),load('candidateColumns.ts'),load('registrationBinding.ts'),load('packet.ts')]);
assert.equal(report.code.selectedRepository.head,revision,'Capture producer differs');
const savedBytes=readFileSync(resolve(capture,'live-refinement.surfacebin')),saved=decodeSurfaceBinary(savedBytes),recovered=recoverRetainedPopulationSampler(saved);
const parent=recovered.parent,field={width:parent.spacingM*parent.width,n:parent.width,data:parent.heights};
const sha=(a:Uint8Array)=>createHash('sha256').update(a).digest('hex');
const immutable=fingerprint({world:saved.world,parents:saved.terrainParents,urban:saved.urban,source:saved.source});
const outputs:any[]=[];
mkdirSync(out,{recursive:true});
for(const event of report.browserEvents.filter((e:any)=>e.kind==='worker-compiled')){
  const summary=event.packet,q=summary.source.request;
  const serial=report.navigation.result.liveAcceptance.find((e:any)=>e.worldId===summary.worldId)?.requestSerial;
  if(serials?!serials.includes(serial):!q.preview)continue;
  assert.equal(q.knownContextId,recovered.contextId,'Only the saved known-context request can be replayed');
  assert.equal(q.knownSceneContextId,saved.source.sceneContextId,'Saved scene differs; refusing missing scene reconstruction');
  const sourceEvent=report.network.find((e:any)=>e.url.endsWith('/refinement/tile')&&e.meta?.n===summary.terrain.width&&Math.abs(e.meta.x-q.x)<1e-8&&Math.abs(e.meta.y-q.y)<1e-8);
  assert.ok(sourceEvent?.request,'Original tile request was not archived');
  assert.ok(Number.isInteger(serial),'Original native request serial unavailable');
  const file=resolve(out,`preview-${serial}.surfacebin`);if(existsSync(file))throw Error('Output exists; retain previous evidence');
  const began=performance.now(),response=await fetch(`${values.server}/refinement/tile`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sourceEvent.request),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Retained source unavailable (${response.status}): ${await response.text()}. No register/generate fallback.`);
  const meta=JSON.parse(response.headers.get('X-Neural-Meta')??'{}'),raw=new Uint8Array(await response.arrayBuffer()),sourceQueryMs=performance.now()-began;
  for(const key of ['id','x','y','width','n','sourceCell','lod','version','decoderUsed'])assert.deepEqual(meta[key],sourceEvent.meta[key],`Replay metadata differs: ${key}`);
  assert.equal(raw.length,summary.terrain.width*summary.terrain.height*4);
  const terrain={...summary.terrain,source:{...summary.terrain.source},heights:new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength))};
  assert.equal(fingerprint(terrain),summary.versions.terrain,'Requeried terrain does not reproduce the original terrain hash');
  const comparison=compareRefinementParent(field,terrain,field);
  assert.deepEqual(comparison,JSON.parse(terrain.source.provenance.split('parentComparison=')[1]),'Requeried heights do not reproduce original parent diagnostics');
  const startRetarget=performance.now(),world=retargetSurfaceWorld(recovered.sampler,terrain),retargetMs=performance.now()-startRetarget;
  assert.equal(world.id,summary.worldId,'Retarget world identity differs from the original summary');
  assert.deepEqual(world.versions,summary.versions,'Retarget versions differ');assert.deepEqual(world.surfaceLayers,summary.surfaceLayers,'Projected layer descriptors differ');
  const startPages=performance.now(),bounds={minX:q.x,minZ:q.y,maxX:q.x+q.extent,maxZ:q.y+q.extent};
  const pages=generateSurfaceCandidatePages(recovered.sampler,bounds,{canonicalContextId:recovered.contextId,fineTerrain:terrain,parentTerrain:parent}),pagesMs=performance.now()-startPages;
  // The bounded driver summary omits presentation; the initial saved packet
  // carries the exact immutable shared presentation used by the same scene epoch.
  const source={originalSource:summary.source.originalSource,live:summary.source.live,provider:summary.source.provider,presentation:saved.source.presentation,
    compilation:summary.source.compilation,registrationBinding:summary.source.registrationBinding,canonicalContextId:summary.source.canonicalContextId,
    sceneContextId:summary.source.sceneContextId,sourceEpoch:summary.source.sourceEpoch,sceneEpoch:summary.source.sceneEpoch,request:summary.source.request};
  const packet={format:'magna-surface-packet',version:1,presentation:saved.presentation,urbanId:saved.urbanId,world:{...world,canonicalContext:undefined},terrainParents:undefined,urban:undefined,
    candidateColumns:packCandidateColumns(pages.candidates),candidateBounds:pages.candidateBounds,candidatePages:pages.candidatePages,source};
  validateSurfacePacket(packet);const bytes=encodeSurfaceBinary(packet);writeFileSync(file,bytes);
  // A separate standalone diagnostic carries already-known context/scene. The
  // compact packet above is the representation to use for actual warm-cache profiling.
  const standalone={...packet,world:{...world},terrainParents:saved.terrainParents,urban:saved.urban,source:{...saved.source,...source}};
  const standaloneFile=resolve(out,`preview-${serial}-standalone.surfacebin`),standaloneBytes=encodeSurfaceBinary(standalone);writeFileSync(standaloneFile,standaloneBytes);
  outputs.push({serial,originalRequestId:event.requestId,originalWorldId:summary.worldId,request:q,originalTileRequest:sourceEvent.request,sourceQueryMs,retargetMs,pagesMs,
    originalTerrainHashMatched:true,originalParentDiagnosticsMatched:true,originalWorldIdMatched:true,originalVersionsMatched:true,originalSurfaceLayerDescriptorMatched:true,
    candidateCount:pages.candidates.length,candidatePages:pages.candidatePages,originalWireBytes:summary.bytes,compact:{file,bytes:bytes.length,sha256:sha(bytes)},standalone:{file:standaloneFile,bytes:standaloneBytes.length,sha256:sha(standaloneBytes)}});
  console.log(JSON.stringify({serial,worldId:world.id,candidateCount:pages.candidates.length,compactFile:file,sha256:sha(bytes)}));
}
assert.equal(fingerprint({world:saved.world,parents:saved.terrainParents,urban:saved.urban,source:saved.source}),immutable,'Saved packet mutated');
if(serials)assert.deepEqual(outputs.map(o=>o.serial).sort((a,b)=>a-b),[...serials].sort((a,b)=>a-b),'Some selected serials were not replayed');
const result={format:'explicit-retained-preview-replay',version:1,status:'PASS',producerRevision:revision,sourceCapture:capture,initialCachePacket:resolve(capture,'live-refinement.surfacebin'),savedPacketSha256:sha(savedBytes),canonicalContextId:recovered.contextId,canonicalTerrainHash:recovered.terrainHash,outputs,
  sourceGenerationRequested:false,registrationRequested:false,savedPacketUnchanged:true,
  scope:'Explicit retained query replay, not archived original BODY. Existing Python registration only; no registration/generation fallback. Original terrain hash,parent diagnostics,world id,versions and projected layer descriptor verified. Canonical context borrowed exactly; no unavailable compiler inputs inferred. Retarget+pages from the captured producer semantics, not a reconstructed initial worker compilation. Compact output omits known context/scene as production did. Standalone variant adds known context/scene for diagnostic loading. Whole BODY byte equality with original cannot be asserted because it was not saved.'};
writeFileSync(resolve(out,'report.json'),JSON.stringify(result,null,2)+'\n');
