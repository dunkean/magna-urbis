/** Final native snapshots exclude their own later metrics line. This gate
 * checks a drained writer, not an already closed process or a latency target. */
export function verifyNativeLogMode(metrics, requested='synchronous') {
  const fail=reason=>{throw new Error('Native log evidence: '+reason);};
  if(!['synchronous','threaded'].includes(requested))fail('unknown requested mode');
  const timing=metrics?.nativeLogTiming, threaded=requested==='threaded';
  if(timing?.mode!==requested||timing.version!==`native-log-timing-${threaded?2:1}`)fail('requested mode was not applied');
  if(!Array.isArray(timing.recent)||!timing.recent.length||!timing.maximaByEvent||typeof timing.maximaByEvent!=='object')fail('missing output timing');
  const output=threaded?'enqueueMs':'printMs', other=threaded?'printMs':'enqueueMs';
  for(const sample of timing.recent){
    if(sample.mode!==requested||![sample.serializeMs,sample.mainWallMs,sample[output]].every(n=>Number.isFinite(n)&&n>=0)||other in sample)fail('main output timing is missing or mislabeled');
    if(threaded&&sample.accepted!==true)fail('rejected output');
  }
  for(const sample of Object.values(timing.maximaByEvent)){
    if(!Number.isFinite(sample?.[output])||sample[output]<0||other in sample)fail('maximal output timing is mislabeled');
  }
  if(!threaded){if(timing.writer!==null)fail('unexpected threaded writer');return timing;}
  const writer=timing.writer;
  if(writer?.version!=='surface-native-log-1'||writer.mode!=='threaded'||writer.sink!=='stdout'||writer.failure!==''
    ||writer.rejected!==0||writer.pending!==0||writer.pendingUtf8Bytes!==0||writer.queueDepth!==0||writer.inFlight!==false
    ||!Number.isSafeInteger(writer.accepted)||writer.accepted<1||writer.written!==writer.accepted||writer.lastWrittenSerial!==writer.accepted)fail('writer is missing, incomplete or not drained');
  if(writer.capacityUtf8Bytes!==16*1024*1024||writer.capacityMessages!==8192
    ||!Number.isSafeInteger(writer.maximumPending)||writer.maximumPending<0||writer.maximumPending>writer.capacityMessages
    ||!Number.isSafeInteger(writer.maximumPendingUtf8Bytes)||writer.maximumPendingUtf8Bytes<0||writer.maximumPendingUtf8Bytes>writer.capacityUtf8Bytes)fail('writer capacity contract changed');
  if(!Array.isArray(writer.recent)||!writer.recent.length)fail('missing actual writer output timings');
  for(const sample of writer.recent){
    if(![sample.printWallMs,sample.queueWaitMs].every(n=>Number.isFinite(n)&&n>=0)||'enqueueMs' in sample)fail('writer output timing is mislabeled');
  }
  return timing;
}
