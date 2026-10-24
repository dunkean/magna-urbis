import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{parseArgs}from'node:util';import{createHash}from'node:crypto';
import{decodeSurfaceBinary,encodeSurfaceBinary}from'../src/surface/binary';
import{recoverRetainedPopulationSampler}from'../src/surface/retainedPopulation';
import{generateSurfaceCandidatePagesInFrame}from'../src/surface/candidatePages';
import{terrainSampleBounds}from'../src/surface/candidatePages';
import{generateSurfaceCandidates}from'../src/surface/population';
import{sampleTerrainHeight}from'../src/surface/heightSampling';
import type{SurfaceCandidate}from'../src/surface/model';
import{packCandidateColumns,unpackCandidateColumns}from'../src/surface/candidateColumns';
import{validateSurfacePacket}from'../src/surface/packet';
const{values}=parseArgs({options:{source:{type:'string'},out:{type:'string'},report:{type:'string'},focus:{type:'string'},width:{type:'string',default:'4000'}}});
if(!values.source||!values.out||!values.report||!values.focus)throw new Error('Explicit retained-page refresh: --source FILE --out NEWFILE --report JSON --focus x,z [--width4000]. No generation or world migration.');
const inputPath=resolve(values.source),outputPath=resolve(values.out);if(inputPath===outputPath)throw new Error('Refresh output must be a new file');
if(existsSync(outputPath))throw new Error('Refresh output already exists; preserve the prior evidence and choose a new file');
const focus=values.focus.split(',').map(Number),[x,z]=focus,width=Number(values.width);if(focus.length!==2||![x,z,width].every(Number.isFinite)||width<=0||width>4000)throw new Error('Invalid focus/width');
const bytes=readFileSync(inputPath),packet:any=decodeSurfaceBinary(bytes);validateSurfacePacket(packet as unknown);
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const strip=(p:any)=>{const{candidates,candidateColumns,candidateBounds,candidatePages,...rest}=p;return rest};
const before=encodeSurfaceBinary(strip(packet)),recovered=recoverRetainedPopulationSampler(packet);
const translation=packet.candidatePages?.query?.sourceToWorldTranslation??packet.source?.frame?.frameTranslation??{x:0,z:0};
const identityDomain=packet.candidatePages?.query?.identityDomain;
const options={canonicalContextId:recovered.contextId,fineTerrain:packet.world.terrain,parentTerrain:recovered.parent,translation,sourceOrigin:identityDomain?{x:identityDomain.minX,z:identityDomain.minZ}:undefined};
const result=generateSurfaceCandidatePagesInFrame(recovered.sampler,{minX:x-width/2,minZ:z-width/2,maxX:x+width/2,maxZ:z+width/2},options);
result.candidatePages.query!.producer='explicit-retained-refresh';
const old=packet.candidateColumns?unpackCandidateColumns(packet.candidateColumns):packet.candidates??[];
// The previous query is independently replayed, so a disjoint new camera does
// not turn the intersecting-ID check into a vacuous zero-overlap assertion.
const replayQueries=new Map<string,{bounds:any;families:Set<SurfaceCandidate['family']>}>();
for(const family of ['tree','shrub','boulder','grass','debris'] as const){
  const bounds=packet.candidatePages?.[family]?.bounds??packet.candidateBounds,key=JSON.stringify(bounds);
  if(!bounds)throw new Error('Retained packet has no explicit population query bounds');
  const q=replayQueries.get(key)??{bounds,families:new Set<SurfaceCandidate['family']>()};q.families.add(family);replayQueries.set(key,q);
}
const previousById=new Map<string,ReturnType<typeof unpackCandidateColumns>[number]>();
const sourceTerrain={...recovered.sampler.terrain,originX:identityDomain?.minX??recovered.sampler.terrain.originX-translation.x,originZ:identityDomain?.minZ??recovered.sampler.terrain.originZ-translation.z};
const sourceSampler={...recovered.sampler,terrain:sourceTerrain,bounds:terrainSampleBounds(sourceTerrain)};
const inside=(b:ReturnType<typeof terrainSampleBounds>,cx:number,cz:number)=>cx>=b.minX&&cx<=b.maxX&&cz>=b.minZ&&cz<=b.maxZ;
const fineBounds=terrainSampleBounds(packet.world.terrain),parentBounds=terrainSampleBounds(recovered.parent);
for(const q of replayQueries.values()){
  const b=q.bounds,replay=generateSurfaceCandidates(sourceSampler,{minX:b.minX-translation.x,maxX:b.maxX-translation.x,minZ:b.minZ-translation.z,maxZ:b.maxZ-translation.z},{families:[...q.families],includeOverhang:true});
  for(const c of replay){c.x+=translation.x;c.z+=translation.z;
    if(inside(fineBounds,c.x,c.z))c.y=sampleTerrainHeight(packet.world.terrain,c.x,c.z);
    else if(inside(parentBounds,c.x,c.z))c.y=sampleTerrainHeight(recovered.parent,c.x,c.z);
  }
  for(const c of unpackCandidateColumns(packCandidateColumns(replay)))previousById.set(c.stableId,c);
}
let oldReplayed=0;for(const c of old){const known=previousById.get(c.stableId);if(!known)throw new Error('Retained candidate acceptance differs from the recorded recipe');if(JSON.stringify(c)!==JSON.stringify(known))throw new Error('Retained candidate fields do not replay exactly');oldReplayed++;}
const packed=packCandidateColumns(result.candidates),next=unpackCandidateColumns(packed),byid=new Map(next.map(c=>[c.stableId,c]));let shared=0,yChanged=0;
for(const c of old){const q=byid.get(c.stableId);if(!q)continue;shared++;const{y,...a}=c,{y:qy,...b}=q;if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Intersecting identity/rank/size/position changed');if(y!==qy)yChanged++;}
packet.candidateColumns=packed;delete packet.candidates;packet.candidateBounds=result.candidateBounds;packet.candidatePages=result.candidatePages;
if(!Buffer.from(before).equals(encodeSurfaceBinary(strip(packet))))throw new Error('World/source/terrain/urban/archives changed');
validateSurfacePacket(packet as unknown);const output=encodeSurfaceBinary(packet);mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,output);
const report={format:'explicit-retained-population-page-refresh',version:1,status:'passed',source:{path:inputPath,bytes:bytes.length,sha256:sha(bytes)},output:{path:outputPath,bytes:output.length,sha256:sha(output)},worldId:packet.world.id,canonicalContextId:recovered.contextId,canonicalTerrainHashVerified:recovered.terrainHash,oldCandidatesReplayedExactly:oldReplayed,intersectingCandidatesExactExceptDeclaredY:shared,intersectingYChanges:yChanged,newCount:next.length,candidatePages:result.candidatePages,allOtherPacketBytesExact:true,immutablePacketSha256:sha(before),scope:'Explicit retained population query only. Original world, ground, terrain, source, urban, indices and archives preserved. Not a new source/terrain refinement/native realization or GPU proof.'};
mkdirSync(dirname(resolve(values.report)),{recursive:true});writeFileSync(resolve(values.report),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
