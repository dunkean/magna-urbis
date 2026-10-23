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
  return layer;
}

/** Source-map visibility is distinct from a physical water/bed consistency test.
 * A retained source can conflict with a refined bed without losing map authority. */
export function verifyWaterCapture(capture:unknown,options:{requireSourceMap?:boolean}={}):Row {
  if(!record(capture)||!record(capture.renderedSnapshot)||!record(capture.water))throw new Error('Missing per-view water authority/representation evidence');
  const water=capture.water;
  if(water.worldId!==capture.renderedSnapshot.worldId||typeof water.authority!=='string'||!water.authority)throw new Error('Water evidence differs from the displayed world');
  if(water.authority!=='magna-urbis-fixed-hydrology'||water.fixedVectorDisplayAvailable!==true){
    if(typeof water.fixedHydrologyFallbackReason!=='string'||!water.fixedHydrologyFallbackReason.trim())throw new Error('Silent water fallback');
    if(options.requireSourceMap)throw new Error('Regional source-map water fell back: '+water.fixedHydrologyFallbackReason);
    return water;
  }
  for(const key of ['sourceVectorRequestedAreaM2','sourceVectorAreaM2','sourceVectorMissingAreaM2','missingLevelTriangles'])if(!nonnegative(water[key]))throw new Error('Malformed source water coverage '+key);
  if(water.sourceVectorCoverageComplete!==true||water.sourceVectorMissingAreaM2!==0||water.missingLevelTriangles!==0||water.budgetLimited!==false
    ||typeof water.fixedHydrologyFallbackReason==='string'&&!!water.fixedHydrologyFallbackReason.trim())throw new Error('Source vector omission, budget limit or mixed fallback');
  if(options.requireSourceMap&&(water.sourceVectorRequestedAreaM2<=0||water.sourceVectorAreaM2<=0||!Number.isSafeInteger(water.sourceVertices)||water.sourceVertices<3||water.waterPresentation!=='source-map-terrain-projection'
    ||water.projectionCullMask!==1||water.sourceLevelsUnchanged!==true||water.physicalWaterSurfaceClaimed!==false||water.minimumRiverStrokeApplied!==false))
    throw new Error('Regional water is not an unedited terrain-only source-map projection');
  if(water.waterPresentation==='source-map-terrain-projection'&&(water.projectionCullMask!==1||water.sourceLevelsUnchanged!==true
    ||water.physicalWaterSurfaceClaimed!==false||water.minimumRiverStrokeApplied!==false||typeof water.subpixelPolicy!=='string'||!water.subpixelPolicy))
    throw new Error('Source-map projection hides physical edits, roof projection or subpixel stroke changes');
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
export function verifyLayerIsolationProbe(proof:unknown):Row {
  if(!record(proof)||proof.version!==1||!Array.isArray(proof.views)||proof.views.length!==4)throw new Error('Missing four-view layer-isolation proof');
  const expected=[{ground:true,lowCover:true,trees:true},{ground:true,lowCover:false,trees:true},{ground:true,lowCover:true,trees:false},{ground:true,lowCover:false,trees:false}];
  const first=proof.views[0];
  const native=proof.format==='magna-layer-isolation-proof';
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
  }
  if(native&&new Set(proof.views.map((view:Row)=>view.centralPixelSha256)).size!==4)throw new Error('Native layer toggles did not produce four distinct central images');
  return proof;
}
