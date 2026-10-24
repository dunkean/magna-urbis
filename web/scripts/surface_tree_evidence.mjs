/** Renderer assets must be used by the displayed view, independently of the
 * immutable source/candidate contract. Counts do not assert GPU occlusion. */
export function verifyTreeAssetCapture(capture,manifest,{requireGeometry=false}={}) {
  const fail=reason=>{throw new Error('Tree asset evidence: '+reason);};
  const view=capture?.canopyView,assets=view?.treeAssets,profile=assets?.profile;
  if(assets?.enabled!==true||profile?.available!==true||profile.cpuOnly!==false
    ||profile.digest!==manifest.digest||profile.sourceAssetDigest!==manifest.sourceAssetDigest
    ||profile.pipelineVersion!==manifest.pipelineVersion||profile.triangles!==manifest.sourceGeometry.actualTriangles
    ||profile.impostorTriangles!==2||profile.views!==5)fail('requested asset is missing, stale or CPU-only');
  if(view.transitionPending!==false)fail('capture still has a pending atlas');
  if(!Number.isFinite(view.phase)||view.phase<0||view.phase>2)fail('invalid whole-view phase');
  if(view.phase>0&&view.activeAtlasSource?.rendererAssetDigest!==manifest.digest)fail('active atlas uses another renderer asset');
  if(view.phase>1&&(!view.geometryFilterCompatible||!Number.isFinite(view.geometryFilterRatio)
    ||view.geometryFilterRatio>view.geometryFilterMaximumRatio||view.geometryFilterMaximumRatio>8))fail('geometry exceeds its common C/V filter certificate');
  const hasPlan=assets.retainedCount!==undefined;
  if(hasPlan){
    for(const key of ['highCount','impostorCount','highTriangles','impostorTriangles','retainedCount','droppedCount'])
      if(!Number.isSafeInteger(assets[key])||assets[key]<0)fail('invalid actual plan counts');
    if(assets.droppedCount!==0||assets.retainedCount!==assets.highCount+assets.impostorCount
      ||assets.highCount>manifest.highMaxInstances||assets.highCount>14
      ||assets.highTriangles!==assets.highCount*profile.triangles||assets.impostorTriangles!==assets.impostorCount*2
      ||assets.highTriangles>manifest.highTriangleBudget||assets.highTriangles>2000000
      ||assets.highMinPixels!==manifest.highMinPixels||assets.highBudget!==manifest.highTriangleBudget)fail('tree identities or triangle budgets changed');
    if(capture.populationInstances?.families?.tree?.submitted!==assets.retainedCount)fail('plan differs from actually submitted tree buffers');
  }
  if(requireGeometry&&(!hasPlan||view.phase<=1||capture.populationInstances?.families?.tree?.alphaPositiveInFrustum<=0))fail('near view does not exercise actual visible tree geometry');
  return {profile,phase:view.phase,highCount:assets.highCount??0,impostorCount:assets.impostorCount??0,retainedCount:assets.retainedCount??0,
    highTriangles:assets.highTriangles??0,impostorTriangles:assets.impostorTriangles??0,geometryFilterCompatible:view.geometryFilterCompatible,
    scope:'Displayed aerial asset and actual submitted buffers; no GPU occlusion, artistic or 3D optical equivalence claim'};
}
