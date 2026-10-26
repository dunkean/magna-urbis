import test from 'node:test';import assert from 'node:assert/strict';
import {verifyHeightSampler} from './surface_height_evidence.mjs';
const sha='a'.repeat(64);
const fixture=()=>({worldId:'world',renderedSnapshot:{worldId:'world',sourceEpoch:'source-1',sceneEpoch:'scene-1'},heightSampler:{version:'gd-height-batch-1',mode:'explicit-native-batch',requested:true,used:true,eligible:true,executableSha256:sha,sourceWorldId:'world',sourceEpoch:'source-1',sceneEpoch:'scene-1',sourceInputSha256:'b'.repeat(64),outputPayloadSha256:'c'.repeat(64),size:4096,sourceSamples:266240,holes:0,spacingM:.625,sampleMs:400,totalMs:1800}});
test('native image requires actual sampler/source/hash evidence; legacy remains explicit',()=>{
 assert.equal(verifyHeightSampler(fixture(),sha).size,4096);
 assert.equal(verifyHeightSampler({heightSampler:{mode:'gd-scalar'}}).requested,false);
 assert.throws(()=>verifyHeightSampler(fixture()));
});

test('full live chains require checked expanded-budget provenance and bounded allocations',()=>{
 const data=fixture();Object.assign(data.heightSampler,{sourceSamples:1618660,sourceLayers:7,sourceBytes:1618660*4,sourceSampleBudget:7*1024**2,sourceBudgetVersion:'height-source-chain-2',nativeKnownBufferUpperBytes:256*1024**2});
 assert.equal(verifyHeightSampler(data,sha).sourceSamples,1618660);
 for(const [key,value] of [['sourceSamples',7*1024**2+1],['sourceLayers',8],['sourceSampleBudget',8*1024**2],['sourceBudgetVersion',undefined],['sourceBudgetVersion','unknown'],['sourceBytes',1],['nativeKnownBufferUpperBytes',385*1024**2],['nativeKnownBufferUpperBytes',1]]){
  const bad=structuredClone(data);bad.heightSampler[key]=value;assert.throws(()=>verifyHeightSampler(bad,sha),key);
 }
 const maximum=structuredClone(data);Object.assign(maximum.heightSampler,{sourceSamples:7*1024**2,sourceBytes:7*1024**2*8,nativeKnownBufferUpperBytes:300*1024**2});
 assert.equal(verifyHeightSampler(maximum,sha).sourceSamples,7340032);
});
test('ignored request, stale source, altered binary, missing hash and exceeded budgets fail closed',()=>{
 for(const [key,value]of [['used',false],['eligible',false],['executableSha256','d'.repeat(64)],['sourceWorldId','old'],['sceneEpoch','old'],['sourceInputSha256',null],['holes',16777217],['size',8192],['sourceSamples',2000000],['sampleMs',3000]]){
  const data=fixture();data.heightSampler[key]=value;assert.throws(()=>verifyHeightSampler(data,sha),key);
 }
});
