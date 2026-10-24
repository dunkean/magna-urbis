import test from 'node:test';import assert from 'node:assert/strict';
import {verifyHeightSampler} from './surface_height_evidence.mjs';
const sha='a'.repeat(64);
const fixture=()=>({worldId:'world',renderedSnapshot:{worldId:'world',sourceEpoch:'source-1',sceneEpoch:'scene-1'},heightSampler:{version:'gd-height-batch-1',mode:'explicit-native-batch',requested:true,used:true,eligible:true,executableSha256:sha,sourceWorldId:'world',sourceEpoch:'source-1',sceneEpoch:'scene-1',sourceInputSha256:'b'.repeat(64),outputPayloadSha256:'c'.repeat(64),size:4096,sourceSamples:266240,holes:0,spacingM:.625,sampleMs:400,totalMs:1800}});
test('native image requires actual sampler/source/hash evidence; legacy remains explicit',()=>{
 assert.equal(verifyHeightSampler(fixture(),sha).size,4096);
 assert.equal(verifyHeightSampler({heightSampler:{mode:'gd-scalar'}}).requested,false);
 assert.throws(()=>verifyHeightSampler(fixture()));
});
test('ignored request, stale source, altered binary, missing hash and exceeded budgets fail closed',()=>{
 for(const [key,value]of [['used',false],['eligible',false],['executableSha256','d'.repeat(64)],['sourceWorldId','old'],['sceneEpoch','old'],['sourceInputSha256',null],['holes',16777217],['size',8192],['sourceSamples',2000000],['sampleMs',3000]]){
  const data=fixture();data.heightSampler[key]=value;assert.throws(()=>verifyHeightSampler(data,sha),key);
 }
});
