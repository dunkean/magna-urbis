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
  if(![512,1024,2048,4096].includes(sampler.size)||!Number.isSafeInteger(sampler.sourceSamples)||sampler.sourceSamples<4||sampler.sourceSamples>7*1024**2
    ||!Number.isSafeInteger(sampler.holes)||sampler.holes<0||sampler.holes>sampler.size**2
    ||![sampler.spacingM,sampler.sampleMs,sampler.totalMs].every(n=>Number.isFinite(n)&&n>=0)||sampler.spacingM===0||sampler.sampleMs>sampler.totalMs)fail('invalid bounded sampler result');
  // Historical low-count records remain readable. Expanded chains require the
  // checked new runtime contract, rather than merely raising a numeric gate.
  if(sampler.sourceBudgetVersion!==undefined||sampler.sourceSamples>1572864){
    if(sampler.sourceBudgetVersion!=='height-source-chain-2'||sampler.sourceSampleBudget!==7*1024**2
      ||!Number.isSafeInteger(sampler.sourceLayers)||sampler.sourceLayers<1||sampler.sourceLayers>7
      ||!Number.isSafeInteger(sampler.sourceBytes)||sampler.sourceBytes<4*sampler.sourceSamples||sampler.sourceBytes>8*sampler.sourceSamples
      ||!Number.isSafeInteger(sampler.nativeKnownBufferUpperBytes)
      ||sampler.nativeKnownBufferUpperBytes<sampler.sourceBytes+8*sampler.sourceSamples+8*sampler.size**2
      ||sampler.nativeKnownBufferUpperBytes>384*1024**2)fail('invalid source-chain budget contract');
  }
  return sampler;
}
