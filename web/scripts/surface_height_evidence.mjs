/** Join the actually displayed RF/control plane to the explicitly selected
 * executable and source. A fast-path request alone is not evidence of use. */
export function verifyHeightSampler(capture,executableSha256){
  const sampler=capture?.heightSampler,display=capture?.renderedSnapshot;
  const fail=message=>{throw Error('Height sampler evidence: '+message);};
  if(executableSha256===undefined){
    if(sampler?.used===true)fail('unrequested native sampler');
    return {requested:false,mode:sampler?.mode??'legacy-gd-scalar'};
  }
  if(!/^[a-f0-9]{64}$/.test(executableSha256))fail('invalid executable identity');
  if(sampler?.version!=='gd-height-batch-1'||sampler.mode!=='explicit-native-batch'
    ||sampler.requested!==true||sampler.used!==true||sampler.eligible!==true
    ||sampler.executableSha256!==executableSha256)fail('requested native sampler was not actually used');
  if(!display||sampler.sourceWorldId!==display.worldId||capture.worldId!==undefined&&capture.worldId!==display.worldId
    ||['sourceEpoch','sceneEpoch'].some(key=>display[key]!==undefined&&display[key]!==null&&sampler[key]!==display[key]))fail('sampler belongs to another displayed source');
  for(const key of ['sourceInputSha256','outputPayloadSha256'])if(!/^[a-f0-9]{64}$/.test(sampler[key]))fail('missing checked input/output digest');
  if(![512,1024,2048,4096].includes(sampler.size)||!Number.isSafeInteger(sampler.sourceSamples)||sampler.sourceSamples<4||sampler.sourceSamples>1572864
    ||!Number.isSafeInteger(sampler.holes)||sampler.holes<0||sampler.holes>sampler.size**2
    ||![sampler.spacingM,sampler.sampleMs,sampler.totalMs].every(n=>Number.isFinite(n)&&n>=0)||sampler.spacingM===0||sampler.sampleMs>sampler.totalMs)fail('invalid bounded sampler result');
  return sampler;
}
