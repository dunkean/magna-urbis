const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const fail=why=>{throw new Error('Native canopy evidence: '+why);};
/** Raster preparation is separate from actually displaying the atlas/geometry. */
export function verifyCanopySampler(capture,expectedExecutableSha256){
  if(!expectedExecutableSha256)return {required:false};
  if(!hash(expectedExecutableSha256))fail('invalid expected executable hash');
  const m=capture?.canopySampler,world=capture?.renderedWorldId??capture?.worldId;
  if(!m||m.requested!==true||typeof world!=='string'||m.sourceWorldId!==world)fail('request/source world not joined');
  if(m.eligible===false){
    if(m.used!==false||typeof m.reason!=='string'||!m.reason.trim())fail('unavailable atlas needs explicit reason');
    return {required:true,requested:true,used:false,eligible:false,reason:m.reason,sourceWorldId:world};
  }
  if(m.eligible!==true||m.used!==true||m.version!=='native-canopy-raster-1'||m.executableSha256!==expectedExecutableSha256)fail('native renderer was not used');
  for(const k of ['sourceInputSha256','outputPayloadSha256'])if(!hash(m[k]))fail(k);
  if(!integer(m.width,2,2048)||!integer(m.height,2,2048)||(m.width&(m.width-1))||(m.height&(m.height-1)))fail('grid budget');
  if(!integer(m.treeCount,0,100000)||!integer(m.nativeKnownBufferUpperBytes,m.width*m.height*40,384*1024*1024))fail('inventory/buffer budget');
  if(!finite(m.sampleMs)||!finite(m.totalMs)||m.sampleMs<0||m.totalMs<m.sampleMs||m.totalMs>130000)fail('wall timings');
  const source=capture.renderedSnapshot;
  for(const key of ['sourceEpoch','sceneEpoch'])if(source?.[key]!==undefined&&m[key]!==source[key])fail(key+' mismatch');
  return {required:true,...m,scope:'Exact renderer-only raster prepared; atlas phase and displayed geometry are separate evidence.'};
}
