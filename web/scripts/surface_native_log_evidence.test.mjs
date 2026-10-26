import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNativeLogMode} from './surface_native_log_evidence.mjs';
const fixture=mode=>({nativeLogTiming:{version:`native-log-timing-${mode==='threaded'?2:1}`,mode,
  recent:[{mode,serializeMs:1,mainWallMs:2,[mode==='threaded'?'enqueueMs':'printMs']:1,...(mode==='threaded'?{accepted:true}:{})}],
  maximaByEvent:{capture:{[mode==='threaded'?'enqueueMs':'printMs']:1}},
  writer:mode==='threaded'?{version:'surface-native-log-1',mode:'threaded',sink:'stdout',failure:'',rejected:0,pending:0,pendingUtf8Bytes:0,queueDepth:0,inFlight:false,
    accepted:2,written:2,lastWrittenSerial:2,capacityUtf8Bytes:16777216,capacityMessages:8192,maximumPending:2,maximumPendingUtf8Bytes:100,
    recent:[{printWallMs:2,queueWaitMs:1}]}:null}});
test('final synchronous and drained threaded snapshots retain distinct timing contracts',()=>{
  for(const mode of ['synchronous','threaded'])assert.equal(verifyNativeLogMode(fixture(mode),mode).mode,mode);
});
test('ignored mode, output loss, unfinished queue, enlarged bounds and timing relabeling fail closed',()=>{
  assert.throws(()=>verifyNativeLogMode(fixture('synchronous'),'threaded'));
  for(const [path,value] of [['writer.rejected',1],['writer.pending',1],['writer.written',1],['writer.inFlight',true],['writer.failure','overflow'],['writer.capacityMessages',999999],['writer.maximumPendingUtf8Bytes',16777217],['recent.0.accepted',false],['recent.0.printMs',1],['writer.recent.0.enqueueMs',1]]){
    const data=fixture('threaded');let target=data.nativeLogTiming;const keys=path.split('.');for(const key of keys.slice(0,-1))target=target[key];target[keys.at(-1)]=value;
    assert.throws(()=>verifyNativeLogMode(data,'threaded'),path);
  }
});
