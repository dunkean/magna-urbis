/** Small manifest/renderer-evidence gates. Never copy source arrays into CDP logs. */
type Row=Record<string,any>;
const record=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const nonnegative=(value:unknown):value is number=>finite(value)&&value>=0;
const FIELDS:Record<string,string>={groundMaterial:'u16',groundMaterialSecondary:'u16',groundMaterialBlend:'f32',groundMaterialMeanColor:'u32',
  lowCoverMaterial:'u16',lowCoverMaterialSecondary:'u16',lowCoverMaterialBlend:'f32',lowCoverMaterialMeanColor:'u32',lowCoverOpacity:'f32'};

/** Presence alone does not prove that the rendered ground uses the new layers. */
export function verifyExplicitLayerCapture(capture:unknown,packet:unknown,visibility:Readonly<{ground:boolean;lowCover:boolean;trees:boolean}>={ground:true,lowCover:true,trees:true}):Row {
  if(!record(capture)||!record(packet)||!record(capture.renderedSnapshot)||!record(capture.surfaceLayers)||!record(packet.surfaceLayers)||!record(packet.versions)||!record(packet.terrain))throw new Error('Missing explicit rendered surface-layer evidence');
  const layer=capture.surfaceLayers,meta=packet.surfaceLayers,display=capture.renderedSnapshot;
  if(layer.worldId!==display.worldId||layer.worldId!==packet.worldId||layer.version!=='surface-layers-1'||meta.version!==layer.version
    ||layer.groundAvailability!=='explicit'||layer.lowCoverAvailability!=='explicit'||meta.groundAvailability!=='explicit'||meta.lowCoverAvailability!=='explicit'
    ||typeof meta.fieldsVersion!=='string'||!meta.fieldsVersion||layer.projectedFieldsVersion!==meta.fieldsVersion
    ||typeof packet.versions.surfaceLayers!=='string'||!packet.versions.surfaceLayers||layer.canonicalFieldsVersion!==packet.versions.surfaceLayers
    ||layer.legacyFallback!==false
    ||layer.renderMode!=='three-physical-layers'||!record(layer.visibility)||Object.entries(visibility).some(([key,value])=>layer.visibility[key]!==value))throw new Error('Rendered layers use legacy, unavailable, stale or hidden support/cover/trees');
  const n=packet.terrain.width*packet.terrain.height;
  const fromCanonical=typeof packet.contextId==='string'&&!!packet.contextId;
  const grid=fromCanonical?packet.canonicalGrid:packet.terrain;
  if(layer.textureSource!==(fromCanonical?'canonical':'world')||layer.textureFieldsVersion!==(fromCanonical?packet.versions.surfaceLayers:meta.fieldsVersion)
    ||!record(layer.textureGrid)||!record(grid)||['width','height','originX','originZ','spacingM'].some(key=>!finite(layer.textureGrid[key])||!finite(grid[key])||Math.abs(layer.textureGrid[key]-grid[key])>1e-7))throw new Error('Layer textures do not match the actual canonical/projected source grid');
  if(!Number.isSafeInteger(n)||n<4||!record(packet.layerFieldDescriptors))throw new Error('Missing exact typed surface-layer manifest');
  for(const[name,dtype]of Object.entries(FIELDS)){
    const descriptor=packet.layerFieldDescriptors[name];
    if(!record(descriptor)||descriptor.dtype!==dtype||descriptor.length!==n)throw new Error('Invalid explicit surface-layer array '+name);
  }
  const response=layer.groundResponse,version=packet.versions.groundResponse;
  if(version!==undefined){
    if(typeof version!=='string'||!/^gr-sha256-1:[a-f0-9]{64}$/.test(version)||!record(response)||response.available!==true||response.version!=='surface-ground-response-1'||response.id!==version
      ||response.quantization!=='float32-potentials; uint16-recipe; stored-srgb8-at-canonical-knots'||!record(response.sourceGrid)
      ||['width','height','originX','originZ','spacingM'].some(key=>!finite(response.sourceGrid[key])||Math.abs(response.sourceGrid[key]-grid[key])>1e-7)
      ||!finite(response.sourceNativeSpacingM)||response.sourceNativeSpacingM<=0||response.imageBytes!==grid.width*grid.height*48)
      throw new Error('Rendered ground response is unavailable, stale or uses a different canonical physical grid');
  }else if(record(response)&&response.available===true)throw new Error('Legacy packet claims an unavailable physical ground response');
  return layer;
}

/** Source-map visibility is distinct from a physical water/bed consistency test.
 * A retained source can conflict with a refined bed without losing map authority. */
export function verifyWaterCapture(capture:unknown,options:{requireSourceMap?:boolean;allowEmptySourceMap?:boolean;waterSymbolWidthPx?:number;screenMetresPerPixel?:number;waterVectorTint?:'source-classes'|'uniform'}={}):Row {
  if(!record(capture)||!record(capture.renderedSnapshot)||!record(capture.water))throw new Error('Missing per-view water authority/representation evidence');
  const water=capture.water;
  const expectedUniform=options.waterVectorTint==='uniform';
  if(options.waterVectorTint!==undefined&&!['source-classes','uniform'].includes(options.waterVectorTint))throw new Error('Unknown requested water vector tint');
  if(['uniformVectorTint','sourceVectorTintVersion','sourceVectorTintPolicy'].some(key=>water[key]!==undefined)
    &&(typeof water.uniformVectorTint!=='boolean'||water.sourceVectorTintVersion!=='source-vector-tint-1'
      ||water.sourceVectorTintPolicy!==(water.uniformVectorTint?'uniform-untyped-vectors-explicit-sea':'source-classes')))
    throw new Error('Inconsistent water vector tint metadata');
  if(expectedUniform||water.uniformVectorTint===true){
    if(!expectedUniform||water.uniformVectorTint!==true||water.sourceVectorTintVersion!=='source-vector-tint-1'
      ||water.sourceVectorTintPolicy!=='uniform-untyped-vectors-explicit-sea'||water.sourceWaterPartitionAvailable!==true
      ||water.waterPresentation!=='source-map-terrain-projection'||water.authority!=='magna-urbis-fixed-hydrology'||water.fixedVectorDisplayAvailable!==true)
      throw new Error('Undeclared, missing or non-source-map uniform vector tint');
    const vector=water.sourceVectorVertexCount,sea=water.sourceSeaVertexCount,total=water.sourceVertices;
    if([vector,sea,total].some(n=>!Number.isSafeInteger(n)||n<0||n%3!==0)||total>999996||vector+sea!==total)throw new Error('Uniform vector tint hides the original vector/sea partition');
    const colors=['vectorLinearTint','bankSymbolLinearTint','seaLinearTint'];
    if(colors.some(key=>!Array.isArray(water[key])||water[key].length!==3||water[key].some((n:unknown)=>!nonnegative(n)))
      ||water.vectorLinearTint.some((n:number,i:number)=>n!==water.bankSymbolLinearTint[i])
      ||water.vectorTintClassClaim!=='untyped retained vector polygons; explicit sea union only')throw new Error('Uniform vector tint invents a class or changes the declared fill/bank tint');
  }
  const expectedSymbol=options.waterSymbolWidthPx??0,actualSymbol=water.symbolWidthPx??0;
  if(!finite(expectedSymbol)||expectedSymbol<0||expectedSymbol>1.25||!finite(actualSymbol)||Math.abs(actualSymbol-expectedSymbol)>1e-12)throw new Error('Undeclared or unrequested water symbology');
  if(water.worldId!==capture.renderedSnapshot.worldId||typeof water.authority!=='string'||!water.authority)throw new Error('Water evidence differs from the displayed world');
  if(water.authority!=='magna-urbis-fixed-hydrology'||water.fixedVectorDisplayAvailable!==true){
    if(typeof water.fixedHydrologyFallbackReason!=='string'||!water.fixedHydrologyFallbackReason.trim())throw new Error('Silent water fallback');
    if(options.requireSourceMap||expectedSymbol>0)throw new Error('Regional source-map water fell back: '+water.fixedHydrologyFallbackReason);
    return water;
  }
  for(const key of ['sourceVectorRequestedAreaM2','sourceVectorAreaM2','sourceVectorMissingAreaM2','missingLevelTriangles'])if(!nonnegative(water[key]))throw new Error('Malformed source water coverage '+key);
  if(water.sourceVectorCoverageComplete!==true||water.sourceVectorMissingAreaM2!==0||water.missingLevelTriangles!==0||water.budgetLimited!==false
    ||typeof water.fixedHydrologyFallbackReason==='string'&&!!water.fixedHydrologyFallbackReason.trim())throw new Error('Source vector omission, budget limit or mixed fallback');
  const emptySourceMap=options.allowEmptySourceMap===true&&water.empty===true&&water.sourceVectorRequestedAreaM2===0&&water.sourceVectorAreaM2===0&&water.sourceVertices===0;
  if(options.requireSourceMap&&((!emptySourceMap&&(water.sourceVectorRequestedAreaM2<=0||water.sourceVectorAreaM2<=0||!Number.isSafeInteger(water.sourceVertices)||water.sourceVertices<3))||water.waterPresentation!=='source-map-terrain-projection'
    ||water.projectionCullMask!==1||water.sourceLevelsUnchanged!==true||water.physicalWaterSurfaceClaimed!==false||water.minimumRiverStrokeApplied!==false))
    throw new Error('Regional water is not an unedited terrain-only source-map projection');
  if(water.waterPresentation==='source-map-terrain-projection'&&(water.projectionCullMask!==1||water.sourceLevelsUnchanged!==true
    ||water.physicalWaterSurfaceClaimed!==false||water.minimumRiverStrokeApplied!==false||typeof water.subpixelPolicy!=='string'||!water.subpixelPolicy))
    throw new Error('Source-map projection hides physical edits, roof projection or subpixel stroke changes');
  if(expectedSymbol>0){
    if(water.waterPresentation!=='source-map-terrain-projection'||water.waterSymbolVersion!=='source-water-symbol-2'
      ||water.waterSymbolPolicy!=='retained-vector-water-ring-outline'||water.sourceGeometryUnchanged!==true||water.symbolicPhysicalWidthClaim!==false||water.symbolCoverageSeparateFromSourceArea!==true
      ||!finite(water.screenMetresPerPixel)||water.screenMetresPerPixel<=0||!finite(water.paddingSymbolMetres)
      ||Math.abs(water.paddingSymbolMetres-expectedSymbol*water.screenMetresPerPixel*.5)>1e-9*Math.max(1,water.paddingSymbolMetres)
      ||!['orthographic-map-ground-scale','oblique-ground-scale-approximation'].includes(water.screenScalePolicy)
      ||!Number.isInteger(water.resolution)||water.resolution<64||water.resolution>4096||!finite(water.metresPerTexel)||water.metresPerTexel<=0||water.metresPerTexel>water.screenMetresPerPixel*(1+1e-12)
      ||!nonnegative(water.symbolCoverageEstimatedImageBytes)||water.symbolCoverageEstimatedImageBytes<water.resolution**2*4||!finite(water.symbolCoverageImageBudgetBytes)||water.symbolCoverageImageBudgetBytes<=0||water.symbolCoverageImageBudgetBytes>256*1024*1024||water.symbolCoverageEstimatedImageBytes>water.symbolCoverageImageBudgetBytes
      ||!finite(water.symbolKernelRadiusTexels)||water.symbolKernelRadiusTexels<0||water.symbolKernelRadiusTexels>4||Math.abs(water.symbolKernelRadiusTexels-water.paddingSymbolMetres/water.metresPerTexel)>1e-9
      ||typeof water.symbolRasterLimit!=='string'||!water.symbolRasterLimit||!/^([a-f0-9]{64})$/.test(water.sourceGeometrySha256))throw new Error('Symbolic water hides its footprint, source invariance or image budget');
    if(water.sourceContourVersion!=='source-water-contours-1'||!Number.isSafeInteger(water.sourceContourPointCount)||water.sourceContourPointCount<0||water.sourceContourPointCount>500000
      ||!Number.isSafeInteger(water.sourceContourRingCount)||water.sourceContourRingCount<0||water.sourceContourRingCount>8192||water.sourceContourComplete!==true||water.sourceContourBudgetLimited!==false
      ||!/^[a-f0-9]{64}$/.test(water.sourceContourSha256)||water.sourceContourPrecision!=='float64-world-xz; subtract in double before renderer vectors'
      ||typeof water.sourceContourScope!=='string'||!water.sourceContourScope||typeof water.symbolSeaPolicy!=='string'||!water.symbolSeaPolicy
      ||!nonnegative(water.symbolContourEstimatedBytes)||water.symbolContourEstimatedBytes<water.sourceContourPointCount*16||!finite(water.symbolContourBudgetBytes)||water.symbolContourBudgetBytes<=0||water.symbolContourBudgetBytes>256*1024*1024||water.symbolContourEstimatedBytes>water.symbolContourBudgetBytes
      ||!finite(water.symbolStrokeWidthBakePx)||Math.abs(water.symbolStrokeWidthBakePx-2*water.symbolKernelRadiusTexels)>1e-9
      ||water.sourceVectorRequestedAreaM2>0&&(water.sourceContourPointCount<3||water.sourceContourRingCount<1))throw new Error('Symbolic water lacks complete source vector contours or a bounded vector stroke');
    if(water.sourceVertices>0&&(!/^[a-f0-9]{64}$/.test(water.sourceCoverageImageSha256)||!/^[a-f0-9]{64}$/.test(water.symbolCoverageImageSha256)))throw new Error('Symbolic coverage image is not distinguished from source coverage');
    const expectedMPP=options.screenMetresPerPixel??(water.screenScalePolicy==='orthographic-map-ground-scale'?capture.metresPerPixel:undefined);
    if(expectedMPP!==undefined&&(!finite(expectedMPP)||expectedMPP<=0||Math.abs(water.screenMetresPerPixel-expectedMPP)>1e-9*expectedMPP))throw new Error('Water symbol uses a stale or dishonest screen scale');
  }else if(water.sourceGeometryUnchanged===false||water.symbolicPhysicalWidthClaim===true
    ||water.waterSymbolPolicy!==undefined&&water.waterSymbolPolicy!=='disabled-original-contours'
    ||water.waterSymbolVersion!==undefined&&!['source-water-symbol-1','source-water-symbol-2'].includes(water.waterSymbolVersion)
    ||water.paddingSymbolMetres!==undefined&&water.paddingSymbolMetres!==0||water.symbolCoverageImageSha256!==undefined)throw new Error('Original contour mode hides symbols or claims physical source edits');
  const samples=water.vectorBedDiagnosticSamples,conflicts=water.vectorBedDiagnosticConflicts;
  if(samples!==undefined||conflicts!==undefined){
    if(!Number.isSafeInteger(samples)||samples<0||!Number.isSafeInteger(conflicts)||conflicts<0||conflicts>samples
      ||!nonnegative(water.vectorBedDiagnosticMaximumDeltaM)||!nonnegative(water.vectorBedDiagnosticMissing))throw new Error('Malformed bounded bed-conflict diagnostic');
    // No zero-conflict gate: source-map contours do not assert a physical water surface.
  }
  return water;
}

/** Negative/single-variable diagnostic snapshots must retain the same physical
 * source and context while revealing bare ground beneath low cover and crowns. */
export function verifyLayerIsolationProbe(proof:unknown,options:{requireInstances?:boolean;expectedWidthM?:number}={}):Row {
  if(!record(proof)||![1,2].includes(proof.version)||!Array.isArray(proof.views)||proof.views.length!==4)throw new Error('Missing four-view layer-isolation proof');
  const expected=[{ground:true,lowCover:true,trees:true},{ground:true,lowCover:false,trees:true},{ground:true,lowCover:true,trees:false},{ground:true,lowCover:false,trees:false}];
  const first=proof.views[0];
  const native=proof.format==='magna-layer-isolation-proof';
  const requireInstances=options.requireInstances??proof.requireInstances??false;
  const families=['tree','trunk','grass','shrub','debris','boulder'];
  if(requireInstances&&(!native||proof.version!==2||proof.requireInstances!==true))throw new Error('Near layer probe did not require actual geometry instances');
  if(options.expectedWidthM!==undefined&&(!finite(proof.widthM)||Math.abs(proof.widthM-options.expectedWidthM)>1e-9*options.expectedWidthM))throw new Error('Layer probe camera width differs from its requested view');
  for(let i=0;i<proof.views.length;i++){
    const view=proof.views[i];
    if(!record(view)||!record(view.visibility)||Object.entries(expected[i]).some(([key,value])=>view.visibility[key]!==value)
      ||['terrainVersion','canonicalContextId','groundFieldsVersion','inventoryFingerprint','geometryDetailId'].some(key=>typeof view[key]!=='string'||!view[key]||view[key]!==first[key])
      ||view.groundSampleFingerprint!==first.groundSampleFingerprint||typeof view.groundSampleFingerprint!=='string'||!view.groundSampleFingerprint)
      throw new Error('Layer toggle changed physical source/support/ground/inventory or omitted a visibility case');
    if(!nonnegative(view.lowCoverOpacity)||view.lowCoverOpacity>1||!nonnegative(view.treeOpticalCoverage)||view.treeOpticalCoverage>1
      ||!expected[i].lowCover&&view.lowCoverOpacity!==0||!expected[i].trees&&view.treeOpticalCoverage!==0)throw new Error('Disabled low cover or trees remain optically present');
    if(native&&(!finite(view.physicalLowCoverMean)||view.physicalLowCoverMean<=0||!finite(view.physicalTreeCoverMean)||view.physicalTreeCoverMean<=0
      ||Math.abs(view.physicalLowCoverMean-first.physicalLowCoverMean)>1e-9||Math.abs(view.physicalTreeCoverMean-first.physicalTreeCoverMean)>1e-9
      ||typeof view.centralPixelSha256!=='string'||!/^[a-f0-9]{64}$/.test(view.centralPixelSha256)))throw new Error('Native probe omitted visible cover/tree support or central image evidence');
    if(proof.version===2){
      if(!finite(proof.widthM)||proof.widthM<=0||!finite(view.widthM)||Math.abs(view.widthM-proof.widthM)>1e-9*proof.widthM||typeof view.worldId!=='string'||view.worldId!==first.worldId
        ||!record(view.focus)||!finite(view.focus.x)||!finite(view.focus.y)||view.focus.x!==first.focus?.x||view.focus.y!==first.focus?.y||typeof view.oblique!=='boolean'||view.oblique!==first.oblique
        ||['canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','instanceBufferFingerprint'].some(k=>typeof view[k]!=='string'||!/^[a-f0-9]{64}$/.test(view[k])||view[k]!==first[k])
        ||!record(view.layerUniforms)||Object.entries(expected[i]).some(([k,v])=>view.layerUniforms[k]!==v))throw new Error('Layer toggle changed actual context/source/geometry/buffers or did not bind shader visibility');
      const instances=view.populationInstances,base=first.populationInstances;
      if(requireInstances&&!record(instances?.families))throw new Error('Near layer probe omitted actual geometry counts');
      if(record(instances?.families)){
        if(!record(base?.families)||typeof instances.scope!=='string'||!instances.scope||typeof instances.treeResidualEnabled!=='boolean'||typeof instances.treeOpticalShadowEnabled!=='boolean'
          ||!expected[i].trees&&(instances.treeResidualEnabled||instances.treeOpticalShadowEnabled))throw new Error('Disabled trees retain residual canopy or total optical shadow');
        for(const family of families){
          const c=instances.families[family],initial=base.families[family];
          if(!record(c)||!record(initial)||['submitted','nodeVisible','alphaPositiveInFrustum'].some(k=>!Number.isSafeInteger(c[k])||c[k]<0)
            ||c.alphaPositiveInFrustum>c.nodeVisible||c.nodeVisible>c.submitted||c.submitted!==initial.submitted)throw new Error('Actual instance allocation/count metadata changed or is malformed');
          const enabled=family==='boulder'||(['tree','trunk'].includes(family)?expected[i].trees:expected[i].lowCover);
          if(!enabled&&(c.nodeVisible!==0||c.alphaPositiveInFrustum!==0))throw new Error('Disabled tree/low-cover instance family remains visible');
          if(enabled&&(c.nodeVisible!==initial.nodeVisible||c.alphaPositiveInFrustum!==initial.alphaPositiveInFrustum))throw new Error('Independent family visibility changed with another layer');
        }
      }
    }
  }
  if(native&&new Set(proof.views.map((view:Row)=>view.centralPixelSha256)).size!==4)throw new Error('Native layer toggles did not produce four distinct central images');
  if(requireInstances&&(first.populationInstances.families.tree.alphaPositiveInFrustum<=0
    ||['grass','shrub','debris'].reduce((sum,f)=>sum+first.populationInstances.families[f].alphaPositiveInFrustum,0)<=0))throw new Error('Near view has no actual visible tree and low-cover geometry to qualify');
  if(proof.version===2){
    const restored=proof.restored;
    if(!record(restored)||['worldId','terrainVersion','canonicalContextId','groundFieldsVersion','inventoryFingerprint','geometryDetailId','groundSampleFingerprint','canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','instanceBufferFingerprint'].some(k=>restored[k]!==first[k])
      ||!record(restored.layerUniforms)||['ground','lowCover','trees'].some(k=>restored.layerUniforms[k]!==true))throw new Error('Restoring layers changed physical data or failed shader restoration');
    if(requireInstances&&families.some(f=>!record(restored.populationInstances?.families?.[f])||['submitted','nodeVisible','alphaPositiveInFrustum'].some(k=>restored.populationInstances.families[f][k]!==first.populationInstances.families[f][k])))throw new Error('Actual geometry was not restored after layer toggles');
  }
  return proof;
}
