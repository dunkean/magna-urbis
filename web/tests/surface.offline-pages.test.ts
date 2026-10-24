import{describe,it,expect}from'vitest';
import{exportSurfaceInputPacket,exportSurfacePacket}from'../src/surface/adapters/export';
import{cropTerrain}from'../src/ui/benchTerrainTransfer';
import{createSurfaceWorkerProcessor}from'../src/surface/workerProcessor';
import{SURFACE_WORKER_PROTOCOL,type PreparedSurfaceWorkerSource}from'../src/surface/workerProtocol';
import{occupationFromMagnaScene}from'../src/surface/adapters/occupation';
import{packCandidateColumns,unpackCandidateColumns}from'../src/surface/candidateColumns';
import{generateSurfaceCandidates}from'../src/surface/population';
import{fingerprint}from'../src/surface/hash';
import{decodeSurfaceBinary}from'../src/surface/binary';
import{validateSurfacePacket}from'../src/surface/packet';
import{recoverRetainedPopulationSampler}from'../src/surface/retainedPopulation';
import type{SurfaceCompileInput}from'../src/surface/model';
import type{Decor}from'../src/ui/decor';
import{sampleTerrainHeight}from'../src/surface/heightSampling';

function input(n=20,spacingM=50):SurfaceCompileInput{return{seed:19,terrain:{width:n,height:n,originX:spacingM/2,originZ:spacingM/2,spacingM,heights:new Float32Array(n*n).fill(100),source:{id:'height-source',version:'v1',nativeSpacingM:spacingM,sourceLOD:0}},climate:{version:'explicit-test-climate',meanAnnualTempC:14,annualPrecipMm:1200}};}
function decor():Decor{return{meta:{id:'source-frame',seed:'page-frame',created:'2026-10-24',label:'source',query:'width=512&climate=temperate',width:512,tags:{},stats:{},settlements:[],waterSvg:'',regeneration:{query:'width=512',crops:[]}},raster:{n:16,width:512,height:new Float32Array(256).fill(100),water:new Uint8Array(256),waterLevel:new Float32Array(256).fill(NaN),riverWidth:new Float32Array(256),riverIds:new Int32Array(256),geometry:{land:[],water:[]}}}as unknown as Decor;}
describe('shared offline/live complete family pages',()=>{
  it('publishes the same family schema and stable inventory in offline JSON/binary and live worker packets',()=>{
    const source=input(),offline=exportSurfaceInputPacket(source,undefined,{}, {encoding:'binary'}),json=exportSurfaceInputPacket(source);
    validateSurfacePacket(offline);expect(fingerprint(packCandidateColumns(json.candidates!))).toBe(fingerprint(offline.candidateColumns));
    const prepared:PreparedSurfaceWorkerSource={input:{...source,occupation:occupationFromMagnaScene(source.terrain,{buildings:[]})},providerId:'fixture'};
    const processor=createSurfaceWorkerProcessor(v=>v as PreparedSurfaceWorkerSource),epochs={protocol:SURFACE_WORKER_PROTOCOL,sessionId:'session',sourceEpoch:'source',sceneEpoch:'scene'};
    processor.handle({...epochs,kind:'initialize',payload:prepared});
    const result=processor.handle({...epochs,kind:'compile',requestId:1,region:{x:0,y:0,extent:1000,resolution:40},terrain:{...source.terrain,width:40,height:40,originX:12.5,originZ:12.5,spacingM:25,heights:new Float32Array(1600).fill(100)}});
    expect(result.kind).toBe('compiled');if(result.kind!=='compiled')throw new Error(JSON.stringify(result));
    const live:any=decodeSurfaceBinary(new Uint8Array(result.binary));
    for(const family of ['tree','shrub','boulder','grass','debris'] as const)expect(live.candidatePages[family]).toEqual(offline.candidatePages[family]);
    expect(fingerprint(live.candidateColumns)).toBe(fingerprint(offline.candidateColumns));
    expect(offline.candidatePages.tree.bounds.maxX-offline.candidatePages.tree.bounds.minX).toBeGreaterThan(480);
  });
  it('keeps crop support bounded and preserves candidate identities under a declared common translation',()=>{
    const cropped=cropTerrain(decor(),128,96,160),a=exportSurfacePacket(cropped,undefined,{encoding:'binary'}),b=exportSurfacePacket(cropped,undefined,{encoding:'binary',originX:1000,originZ:-2000});
    const old=unpackCandidateColumns(a.candidateColumns!),translated=unpackCandidateColumns(b.candidateColumns!);expect(old.length).toBeGreaterThan(0);expect(translated).toHaveLength(old.length);
    for(let i=0;i<old.length;i++){expect(translated[i]).toEqual({...old[i],x:old[i].x+1000,z:old[i].z-2000});expect(old[i].x).toBeGreaterThanOrEqual(a.world.bounds.minX);expect(old[i].x).toBeLessThanOrEqual(a.world.bounds.maxX);expect(old[i].z).toBeGreaterThanOrEqual(a.world.bounds.minZ);expect(old[i].z).toBeLessThanOrEqual(a.world.bounds.maxZ);}
    for(const f of ['tree','shrub','boulder','grass','debris']as const){const aa=a.candidatePages[f].bounds;expect(aa).toEqual(a.world.bounds);expect(b.candidatePages[f].bounds).toEqual({minX:aa.minX+1000,maxX:aa.maxX+1000,minZ:aa.minZ-2000,maxZ:aa.maxZ-2000});}
    expect(b.candidatePages.query?.sourceToWorldTranslation).toEqual({x:1000,z:-2000});validateSurfacePacket(b);
  });
  it('bounds a default export adaptively without changing world identity, and never shrinks an explicit all request silently',()=>{
    const source=input(),normal=exportSurfaceInputPacket(source,undefined,{}, {encoding:'binary'}),limited=exportSurfaceInputPacket(source,undefined,{}, {encoding:'binary',candidateLimit:400});
    expect(limited.world.id).toBe(normal.world.id);expect(fingerprint(limited.world)).toBe(fingerprint(normal.world));expect(limited.candidateColumns!.count).toBeLessThanOrEqual(400);
    for(const family of ['tree','shrub','boulder','grass','debris']as const){const exact=packCandidateColumns(generateSurfaceCandidates(limited.world,limited.candidatePages[family].bounds,{families:[family],includeOverhang:true}));expect(exact.ids).toEqual(unpackCandidateColumns(limited.candidateColumns!).filter(c=>c.family===family).map(c=>c.stableId));}
    expect(()=>exportSurfaceInputPacket(source,undefined,{}, {candidateBounds:'all',candidateLimit:1})).toThrow(/budget/);
    expect(()=>exportSurfaceInputPacket(source,undefined,{}, {candidateBounds:{minX:-100,minZ:-100,maxX:-50,maxZ:-50}})).toThrow(/do not intersect exported source/);
  });
  it('requests a four-kilometre complete tree page on a large export, with actual source heights outside the local page',()=>{
    const source=input(17,256),t=source.terrain;
    for(let j=0;j<t.height;j++)for(let i=0;i<t.width;i++)t.heights[j*t.width+i]=100+.001*(t.originX+i*t.spacingM)+.002*(t.originZ+j*t.spacingM);
    const p=exportSurfaceInputPacket(source,undefined,{}, {encoding:'binary'}),page=p.candidatePages.tree;
    expect(page.requestedBounds.maxX-page.requestedBounds.minX).toBe(4000);expect(page.complete).toBe(true);
    const outside=unpackCandidateColumns(p.candidateColumns!).filter(c=>c.family==='tree'&&(c.x<p.candidateBounds.minX||c.x>p.candidateBounds.maxX||c.z<p.candidateBounds.minZ||c.z>p.candidateBounds.maxZ));
    expect(outside.length).toBeGreaterThan(0);
    for(const c of outside)expect(c.y).toBe(sampleTerrainHeight(t,c.x,c.z));
    expect(p.candidateColumns!.count).toBeLessThanOrEqual(100000);validateSurfacePacket(p);
  });
  it('recovers only a stored, terrain-hash-verified canonical sampler and refuses missing or edited heights',()=>{
    const source=input(),prepared:PreparedSurfaceWorkerSource={input:{...source,occupation:occupationFromMagnaScene(source.terrain,{buildings:[]})},providerId:'fixture'};
    const processor=createSurfaceWorkerProcessor(v=>v as PreparedSurfaceWorkerSource),epochs={protocol:SURFACE_WORKER_PROTOCOL,sessionId:'sampler',sourceEpoch:'source',sceneEpoch:'scene'};
    processor.handle({...epochs,kind:'initialize',payload:prepared});
    const result=processor.handle({...epochs,kind:'compile',requestId:1,region:{x:400,y:400,extent:40,resolution:8},terrain:{...source.terrain,width:8,height:8,originX:402.5,originZ:402.5,spacingM:5,heights:new Float32Array(64).fill(101)}});
    if(result.kind!=='compiled')throw new Error(JSON.stringify(result));const p:any=decodeSurfaceBinary(new Uint8Array(result.binary)),before=fingerprint(p);
    const recovered=recoverRetainedPopulationSampler(p);expect(recovered.sampler.terrain.heights).toEqual(source.terrain.heights);expect(fingerprint(p)).toBe(before);
    expect(()=>recoverRetainedPopulationSampler({...p,terrainParents:[]})).toThrow(/No stored/);
    const altered=structuredClone(p);altered.terrainParents[0].terrain.heights[0]+=1;expect(()=>recoverRetainedPopulationSampler(altered)).toThrow(/exact canonical terrain hash/);
  });
});
