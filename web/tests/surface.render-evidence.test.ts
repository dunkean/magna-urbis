import{describe,it,expect}from'vitest';
import{verifyExplicitLayerCapture,verifyLayerIsolationProbe,verifyWaterCapture}from'../scripts/surface_render_evidence';
import{compileSurfaceWorld,sampleSurface}from'../src/surface/compiler';
import{fingerprint}from'../src/surface/hash';
import{selectSurfaceLayerView}from'../src/surface/surfaceLayers';
import{generateSurfaceCandidates}from'../src/surface/population';
import{surfaceLayerInput}from'./fixtures/surfaceLayerInput';

function fixture(){
  const types={groundMaterial:'u16',groundMaterialSecondary:'u16',groundMaterialBlend:'f32',groundMaterialMeanColor:'u32',lowCoverMaterial:'u16',lowCoverMaterialSecondary:'u16',lowCoverMaterialBlend:'f32',lowCoverMaterialMeanColor:'u32',lowCoverOpacity:'f32'};
  const meta={version:'surface-layers-1',groundAvailability:'explicit',lowCoverAvailability:'explicit',fieldsVersion:'projected-fields'};
  const packet={worldId:'displayed-world',contextId:'canonical-context',canonicalGrid:{width:512,height:512,originX:39.0625,originZ:39.0625,spacingM:78.125},surfaceLayers:meta,versions:{surfaceLayers:'canonical-fields'},terrain:{width:128,height:128},
    layerFieldDescriptors:Object.fromEntries(Object.entries(types).map(([name,dtype])=>[name,{dtype,length:128*128}]))};
  const capture={renderedSnapshot:{worldId:packet.worldId},surfaceLayers:{...meta,projectedFieldsVersion:meta.fieldsVersion,worldId:packet.worldId,canonicalFieldsVersion:'canonical-fields',textureSource:'canonical',textureFieldsVersion:'canonical-fields',textureGrid:{...packet.canonicalGrid},legacyFallback:false,renderMode:'three-physical-layers',visibility:{ground:true,lowCover:true,trees:true}},
    water:{worldId:packet.worldId,authority:'magna-urbis-fixed-hydrology',fixedVectorDisplayAvailable:true,sourceVectorRequestedAreaM2:15000,sourceVectorAreaM2:15000,sourceVectorMissingAreaM2:0,sourceVectorCoverageComplete:true,missingLevelTriangles:0,budgetLimited:false,
      waterPresentation:'source-map-terrain-projection',sourceVertices:600,projectionCullMask:1,sourceLevelsUnchanged:true,physicalWaterSurfaceClaimed:false,minimumRiverStrokeApplied:false,subpixelPolicy:'original contour coverage only',
      vectorBedDiagnosticSamples:2048,vectorBedDiagnosticConflicts:1790,vectorBedDiagnosticMissing:0,vectorBedDiagnosticMaximumDeltaM:85}};
  return{packet,capture};
}
describe('new rendered layer and fixed source-map evidence',()=>{
  it('joins actual layer usage and canonical texture source to exact nine typed packet descriptors',()=>{const f=fixture();expect(verifyExplicitLayerCapture(f.capture,f.packet)).toBe(f.capture.surfaceLayers);});
  it('rejects legacy/unavailable layers, stale application metadata, wrong array lengths/types and hidden layers',()=>{
    for(const alter of[(f:any)=>f.capture.surfaceLayers.groundAvailability='legacy-composite-unavailable',(f:any)=>f.packet.surfaceLayers.lowCoverAvailability='legacy-composite-unavailable',
      (f:any)=>f.capture.surfaceLayers.worldId='requested-but-not-rendered',(f:any)=>f.capture.surfaceLayers.textureFieldsVersion='old-canonical',
      (f:any)=>f.capture.surfaceLayers.renderMode='legacy-composite',(f:any)=>delete f.packet.layerFieldDescriptors.lowCoverOpacity,
      (f:any)=>f.packet.layerFieldDescriptors.groundMaterial.dtype='f32',(f:any)=>f.packet.layerFieldDescriptors.lowCoverOpacity.length=100,
      (f:any)=>f.capture.surfaceLayers.visibility.lowCover=false,(f:any)=>f.capture.surfaceLayers.visibility.trees=false,
      (f:any)=>f.capture.surfaceLayers.textureGrid.spacingM=99,(f:any)=>f.capture.surfaceLayers.textureSource='world',(f:any)=>f.capture.surfaceLayers.legacyFallback=true]){
      const f=fixture();alter(f);expect(()=>verifyExplicitLayerCapture(f.capture,f.packet)).toThrow();
    }
  });
  it('accepts complete source-map visibility despite real physical bed conflicts without claiming repaired water',()=>{
    const{capture}=fixture();expect(verifyWaterCapture(capture,{requireSourceMap:true})).toBe(capture.water);
    expect(capture.water.vectorBedDiagnosticConflicts).toBeGreaterThan(0);expect(capture.water.physicalWaterSurfaceClaimed).toBe(false);
  });
  it('keeps the regional nonempty-vector gate while allowing only an explicitly empty near projection',()=>{
    const{capture}=fixture();const water:any=capture.water;
    Object.assign(water,{empty:true,sourceVectorRequestedAreaM2:0,sourceVectorAreaM2:0,sourceVertices:0});
    expect(()=>verifyWaterCapture(capture,{requireSourceMap:true})).toThrow(/Regional/);
    expect(verifyWaterCapture(capture,{requireSourceMap:true,allowEmptySourceMap:true})).toBe(water);
    for(const change of[{empty:false},{sourceVertices:3},{sourceVectorMissingAreaM2:1},{sourceVectorCoverageComplete:false},{waterPresentation:'physical-depth-tested'}]){
      const bad=structuredClone(capture);Object.assign(bad.water,change);expect(()=>verifyWaterCapture(bad,{requireSourceMap:true,allowEmptySourceMap:true})).toThrow();
    }
  });
  it('accepts only explicitly requested symbolic coverage with separate source geometry/image evidence and honest screen scale',()=>{
    const{capture}=fixture();const water:any=capture.water;
    Object.assign(water,{waterSymbolVersion:'source-water-symbol-1',waterSymbolPolicy:'all-water-source-coverage-aa-disk',symbolWidthPx:1.25,
      screenMetresPerPixel:20,paddingSymbolMetres:12.5,screenScalePolicy:'orthographic-map-ground-scale',sourceGeometryUnchanged:true,symbolicPhysicalWidthClaim:false,symbolCoverageSeparateFromSourceArea:true,
      resolution:2562,metresPerTexel:19.6,symbolKernelRadiusTexels:12.5/19.6,symbolCoverageEstimatedImageBytes:87517920,symbolCoverageImageBudgetBytes:268435456,symbolRasterLimit:'Initial AA source raster is authoritative',sourceGeometrySha256:'1'.repeat(64),sourceCoverageImageSha256:'2'.repeat(64),symbolCoverageImageSha256:'3'.repeat(64)});
    expect(()=>verifyWaterCapture(capture,{requireSourceMap:true})).toThrow(/unrequested/);
    expect(verifyWaterCapture(capture,{requireSourceMap:true,waterSymbolWidthPx:1.25,screenMetresPerPixel:20})).toBe(water);
    for(const alter of[(w:any)=>w.sourceVectorMissingAreaM2=1,(w:any)=>w.symbolicPhysicalWidthClaim=true,(w:any)=>w.sourceGeometryUnchanged=false,
      (w:any)=>delete w.waterSymbolVersion,(w:any)=>w.waterSymbolPolicy='physical-river-widening',(w:any)=>w.paddingSymbolMetres=200,
      (w:any)=>w.screenMetresPerPixel=30,(w:any)=>w.metresPerTexel=21,(w:any)=>w.resolution=8192,(w:any)=>w.symbolCoverageSeparateFromSourceArea=false,
      (w:any)=>delete w.symbolCoverageImageSha256,(w:any)=>delete w.sourceGeometrySha256,(w:any)=>w.symbolCoverageEstimatedImageBytes=900000000]){
      const bad=structuredClone(capture);alter(bad.water);expect(()=>verifyWaterCapture(bad,{requireSourceMap:true,waterSymbolWidthPx:1.25,screenMetresPerPixel:20})).toThrow();
    }
    expect(()=>verifyWaterCapture(fixture().capture,{waterSymbolWidthPx:1.25})).toThrow(/unrequested/);
    for(const hidden of[{waterSymbolPolicy:'all-water-source-coverage-aa-disk'},{paddingSymbolMetres:1},{symbolCoverageImageSha256:'3'.repeat(64)}]){
      const f=fixture();Object.assign(f.capture.water,hidden);expect(()=>verifyWaterCapture(f.capture)).toThrow(/hides symbols/);
    }
  });
  it('requires regional source vectors without omissions and refuses roof projection, level editing or hidden fallback',()=>{
    for(const alter of[(w:any)=>w.sourceVectorMissingAreaM2=1,(w:any)=>w.sourceVectorCoverageComplete=false,(w:any)=>w.missingLevelTriangles=1,(w:any)=>w.budgetLimited=true,
      (w:any)=>w.waterPresentation='physical-depth-tested',(w:any)=>w.sourceVertices=0,(w:any)=>w.sourceVectorAreaM2=0,(w:any)=>w.projectionCullMask=3,(w:any)=>w.sourceLevelsUnchanged=false,
      (w:any)=>w.physicalWaterSurfaceClaimed=true,(w:any)=>w.minimumRiverStrokeApplied=true,(w:any)=>w.worldId='other-world',
      (w:any)=>w.vectorBedDiagnosticConflicts=3000,(w:any)=>w.fixedHydrologyFallbackReason='hidden mixed fallback']){
      const{capture}=fixture();alter(capture.water);expect(()=>verifyWaterCapture(capture,{requireSourceMap:true})).toThrow();
    }
    const{capture}=fixture();capture.water={worldId:'displayed-world',authority:'magna-retained-physical-raster',fixedVectorDisplayAvailable:false}as any;
    expect(()=>verifyWaterCapture(capture)).toThrow(/Silent/);
    (capture.water as any).fixedHydrologyFallbackReason='source vector geometry unavailable';expect(verifyWaterCapture(capture)).toBe(capture.water);
    expect(()=>verifyWaterCapture(capture,{requireSourceMap:true})).toThrow(/fell back/);
  });
  it('proves four physical-layer visibility cases using an actual compiled soil/candidate inventory without editing support',()=>{
    const world=compileSurfaceWorld(surfaceLayerInput()),physical=sampleSurface(world,96,256).surfaceLayers;
    const fieldsBefore=fingerprint(world.fields),sourceBefore=fingerprint(world.terrain),inventoryFingerprint=fingerprint(generateSurfaceCandidates(world,{minX:64,minZ:64,maxX:256,maxZ:256}));
    const proof={version:1,views:[{ground:true,lowCover:true,trees:true},{ground:true,lowCover:false,trees:true},{ground:true,lowCover:true,trees:false},{ground:true,lowCover:false,trees:false}].map(visibility=>{
      const view=selectSurfaceLayerView(physical,visibility);
      return{visibility,terrainVersion:world.versions.terrain,canonicalContextId:world.id,groundFieldsVersion:world.versions.surfaceLayers!,inventoryFingerprint,geometryDetailId:world.geometryDetail!.id,
        groundSampleFingerprint:fingerprint(view.ground),lowCoverOpacity:view.lowCover!.opacity,treeOpticalCoverage:view.trees.crownCover};
    })};
    expect(verifyLayerIsolationProbe(proof)).toBe(proof);expect(fingerprint(world.fields)).toBe(fieldsBefore);expect(fingerprint(world.terrain)).toBe(sourceBefore);
    for(const edit of[(p:any)=>p.views[3].treeOpticalCoverage=.2,(p:any)=>p.views[3].lowCoverOpacity=.2,(p:any)=>p.views[2].terrainVersion='edited',
      (p:any)=>p.views[2].groundSampleFingerprint='wrong-soil',(p:any)=>p.views[1].inventoryFingerprint='new-seed',(p:any)=>p.views.pop()]){
      const bad=structuredClone(proof);edit(bad);expect(()=>verifyLayerIsolationProbe(bad)).toThrow();
    }
    const native={...proof,format:'magna-layer-isolation-proof',views:proof.views.map((view,i)=>({...view,physicalLowCoverMean:physical.lowCover!.opacity,physicalTreeCoverMean:physical.trees.crownCover,centralPixelSha256:String(i).repeat(64)}))};
    expect(verifyLayerIsolationProbe(native)).toBe(native);
    const noPixelChange=structuredClone(native);noPixelChange.views[3].centralPixelSha256=noPixelChange.views[0].centralPixelSha256;expect(()=>verifyLayerIsolationProbe(noPixelChange)).toThrow(/distinct/);
  });
});
