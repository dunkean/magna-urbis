import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCanopySampler} from './surface_canopy_evidence.mjs';
const h='a'.repeat(64);
const capture=()=>({worldId:'world',renderedSnapshot:{sourceEpoch:'s',sceneEpoch:'c'},canopySampler:{version:'native-canopy-raster-1',requested:true,eligible:true,used:true,sourceWorldId:'world',sourceEpoch:'s',sceneEpoch:'c',executableSha256:h,sourceInputSha256:h,outputPayloadSha256:h,width:1024,height:1024,treeCount:400,nativeKnownBufferUpperBytes:100*1024*1024,sampleMs:20,totalMs:500}});
test('native canopy raster requires actual source, executable and bounded payload evidence',()=>{assert.equal(verifyCanopySampler(capture(),h).used,true);assert.equal(verifyCanopySampler({},undefined).required,false);});
test('unavailable source atlas stays explicit and is never claimed as native output',()=>{const c=capture();c.canopySampler={requested:true,eligible:false,used:false,sourceWorldId:'world',reason:'Complete tree page does not cover this view'};assert.equal(verifyCanopySampler(c,h).used,false);c.canopySampler.reason='';assert.throws(()=>verifyCanopySampler(c,h));});
test('stale worlds, false use, changed binary, missing hashes and enlarged budgets fail',()=>{for(const patch of [{sourceWorldId:'old'},{used:false},{sourceEpoch:'old'},{executableSha256:'b'.repeat(64)},{sourceInputSha256:''},{width:4096},{treeCount:100001},{nativeKnownBufferUpperBytes:512*1024*1024},{sampleMs:NaN},{totalMs:0}]){const c=capture();Object.assign(c.canopySampler,patch);assert.throws(()=>verifyCanopySampler(c,h));}});
