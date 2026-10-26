import{describe,it,expect}from'vitest';
import{verifyLayerIsolationProbe}from'../scripts/surface_render_evidence';
import{parseLayerProbeWidths,assertCompletedLayerProbeBatch}from'../scripts/surface_layer_probe_batch';

function proof(widthM=160){
  const visibilities=[{ground:true,lowCover:true,trees:true},{ground:true,lowCover:false,trees:true},{ground:true,lowCover:true,trees:false},{ground:true,lowCover:false,trees:false}];
  const counts={tree:12,trunk:12,grass:30,shrub:5,debris:4,boulder:2};
  const views=visibilities.map((visibility,i)=>({visibility,widthM,focus:{x:20000,y:20000},oblique:false,worldId:'actual-source-'+widthM,terrainVersion:'terrain-values',canonicalContextId:'same-canonical-context',groundFieldsVersion:'ground-values',inventoryFingerprint:'inventory-at-'+widthM,geometryDetailId:'detail-'+widthM,groundSampleFingerprint:'ground-samples',
    ...Object.fromEntries(['canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','instanceBufferFingerprint'].map((k,n)=>[k,(n+4).toString().repeat(64)])),
    layerUniforms:{...visibility},physicalLowCoverMean:.45,physicalTreeCoverMean:.3,lowCoverOpacity:visibility.lowCover?.45:0,treeOpticalCoverage:visibility.trees?.3:0,centralPixelSha256:String(i).repeat(64),
    populationInstances:{scope:'Actual geometry metadata fixture; not GPU occlusion',treeResidualEnabled:visibility.trees,treeOpticalShadowEnabled:visibility.trees,
      families:Object.fromEntries(Object.entries(counts).map(([family,count])=>{const enabled=family==='boulder'||(['tree','trunk'].includes(family)?visibility.trees:visibility.lowCover);return[family,{submitted:count,nodeVisible:enabled?count:0,alphaPositiveInFrustum:enabled?Math.floor(count*.7):0}]}))}}));
  return{format:'magna-layer-isolation-proof',version:2,status:'complete',requireInstances:widthM<=160,widthM,views,restored:structuredClone(views[0])};
}
describe('regional and near physical-layer qualification',()=>{
  it('keeps default compatibility while parsing a bounded distinct width list',()=>{
    expect(parseLayerProbeWidths()).toEqual([10000]);expect(parseLayerProbeWidths('10000, 160')).toEqual([10000,160]);
    for(const bad of['','10000,','160,160','NaN','Infinity','-160','0','9','40001','10,20,30,40,50,60,70,80,90'])expect(()=>parseLayerProbeWidths(bad)).toThrow();
  });
  it('requires all requested widths, not just the first successful legacy alias',()=>{
    const phases=[10000,160].map(widthM=>({status:'complete',widthM,result:proof(widthM)}));
    expect(()=>assertCompletedLayerProbeBatch(phases,[10000,160])).not.toThrow();
    for(const mutate of[(a:any[])=>a.pop(),(a:any[])=>a[1].status='failed',(a:any[])=>a[1].result.requireInstances=false,(a:any[])=>delete a[1].result.widthM,(a:any[])=>a.reverse()]){
      const bad=structuredClone(phases);mutate(bad);expect(()=>assertCompletedLayerProbeBatch(bad,[10000,160])).toThrow();
    }
  });
  it('qualifies actual instance masks and unchanged physical bytes independently at each width',()=>{
    const near=proof(),regional=proof(10000);
    // Different geometry/inventory across views is legitimate. Equality is per view.
    expect(near.views[0].inventoryFingerprint).not.toBe(regional.views[0].inventoryFingerprint);
    expect(verifyLayerIsolationProbe(near,{requireInstances:true,expectedWidthM:160})).toBe(near);
    expect(verifyLayerIsolationProbe(regional,{expectedWidthM:10000})).toBe(regional);
  });
  it('rejects nominal potential masks without actual geometry, remaining instances, optical shadows or buffer changes',()=>{
    const alterations=[(p:any)=>delete p.views[0].populationInstances,(p:any)=>{p.views[0].populationInstances.families.tree.alphaPositiveInFrustum=0},
      (p:any)=>{for(const f of ['grass','shrub','debris'])p.views[0].populationInstances.families[f].alphaPositiveInFrustum=0},
      (p:any)=>p.views[1].populationInstances.families.grass.nodeVisible=1,(p:any)=>p.views[2].populationInstances.families.tree.alphaPositiveInFrustum=1,
      (p:any)=>p.views[2].populationInstances.treeResidualEnabled=true,(p:any)=>p.views[3].populationInstances.treeOpticalShadowEnabled=true,
      (p:any)=>p.views[1].populationInstances.families.boulder.alphaPositiveInFrustum=0,(p:any)=>p.views[2].populationInstances.families.tree.submitted=0,
      (p:any)=>p.views[2].layerUniforms.trees=true,(p:any)=>p.views[3].instanceBufferFingerprint='f'.repeat(64),
      (p:any)=>p.views[1].canonicalContextFingerprint='f'.repeat(64),(p:any)=>p.views[2].projectedGroundFieldsVersion='f'.repeat(64),
      (p:any)=>p.views[3].geometryDetailFingerprint='f'.repeat(64),(p:any)=>p.views[1].parentTerrainFingerprint='f'.repeat(64),
      (p:any)=>p.views[2].worldId='other-source',(p:any)=>p.views[3].focus.x++,(p:any)=>p.views[2].oblique=true,(p:any)=>p.restored.inventoryFingerprint='not-restored'];
    for(const alter of alterations){const bad=proof();alter(bad);expect(()=>verifyLayerIsolationProbe(bad,{requireInstances:true,expectedWidthM:160})).toThrow();}
    expect(()=>verifyLayerIsolationProbe(proof(),{requireInstances:true,expectedWidthM:10000})).toThrow(/width/);
  });
});
