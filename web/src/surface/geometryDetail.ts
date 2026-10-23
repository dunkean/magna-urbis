import { fingerprint } from './compiler';
import { sampleTerrainHeight, type ReconstructedTerrain } from './heightSampling';
import { rockUnitAtScenario,validateGeologyScenario,type TiltedStrataScenario } from './geologyScenario';
import { assertNotAborted, type Bounds, type SourceIdentity, type TerrainGrid } from './model';

/** Runtime storage remains a Float32Array for binary transport. This public view
 * deliberately exposes only read operations, never fill/set or mutable indexing. */
export interface ReadonlyDetailField { readonly length:number; readonly [index:number]:number }
export interface SourceSupportDescriptor {
  readonly format:'surface-source-support';readonly version:1;readonly geometryDetailId:string;
  readonly canonicalContextId?:string;readonly source:Readonly<SourceIdentity>;
  readonly supportM:number;readonly treeMaximumSlopeRadians:number;readonly vetoMinimumConfidence:1;
  readonly exposureRecipe:Readonly<{minimumSlopeRadians:number;maximumSlopeRadians:number}>;
  readonly provenance:string;
}
export interface SurfaceGeometryDetail {
  readonly format:'surface-geometry-detail';readonly version:1;readonly id:string;
  readonly canonicalContextId?:string;
  readonly supportDescriptor:SourceSupportDescriptor;
  readonly source:Readonly<SourceIdentity>;
  readonly grid:Readonly<{width:number;height:number;originX:number;originZ:number;spacingM:number}>;
  readonly reconstruction:'bilinear-samples'|'cubic-bspline-controls';
  /** Physical derivative baseline, never smaller than native source spacing. */
  readonly supportM:number;
  /** Coordinates with complete symmetric derivative + source-kernel support. */
  readonly fullSupportBounds:Readonly<Bounds>|null;
  readonly slopeRadians:ReadonlyDetailField;readonly aspectRadians:ReadonlyDetailField;
  /** Interleaved XYZ unit normals, east/up/south frame. */
  readonly normalXYZ:ReadonlyDetailField;
  /** Geometry-only steepness potential, NOT observed bare rock or soil cover. */
  readonly rockExposurePotential:ReadonlyDetailField;readonly edgeConfidence:ReadonlyDetailField;
  /** Exposure potential gated by actual derivative support confidence. Canonical
   * soil/deposit, water and occupation masks still condition its material use. */
  readonly bedrockExposure:ReadonlyDetailField;
  /** 0 vetoes visual tree support ONLY on fully supported >65deg source cliffs.
   * 1 includes uncertain edges: it means no geometry veto, not a soil survey. */
  readonly treeSupport:ReadonlyDetailField;
  /** Optional analytic geological descriptor evaluated on actual fine heights;
   * canonical bedrock/provenance fields remain unchanged. */
  readonly geologyScenario?:TiltedStrataScenario;readonly localBedrockUnitId?:ReadonlyDetailField;
  readonly statistics:Readonly<{minimumHeightM:number;maximumHeightM:number;meanSlopeRadians:number;meanRockExposurePotential:number;fullSupportFraction:number}>;
  readonly limitations:readonly string[];
}
export interface GeometryDetailOptions {
  supportM?:number;canonicalContextId?:string;signal?:AbortSignal;memoryBudgetBytes?:number;
  geologyScenario?:TiltedStrataScenario;
}

/** Real fine heights supply local support/normal/exposure potential without
 * recompiling canonical geology, soil fractions, hydrology, cover or candidates.
 * Synchronous: use the compiler worker for interruptible large requests. */
export function deriveSurfaceGeometryDetail(terrain:TerrainGrid,options:GeometryDetailOptions={}):SurfaceGeometryDetail {
  assertNotAborted(options.signal);
  const n=terrain.width*terrain.height,s=terrain.source;
  if(!Number.isInteger(terrain.width)||!Number.isInteger(terrain.height)||terrain.width<2||terrain.height<2||!Number.isSafeInteger(n)
    ||!(terrain.heights instanceof Float32Array)||terrain.heights.length!==n||![terrain.originX,terrain.originZ,terrain.spacingM].every(Number.isFinite)||terrain.spacingM<=0
    ||!s||typeof s.id!=='string'||!s.id||typeof s.version!=='string'||!s.version||!Number.isFinite(s.nativeSpacingM)||s.nativeSpacingM<=0||!Number.isFinite(s.sourceLOD))throw new Error('Invalid real source terrain for geometry detail');
  if(options.geologyScenario)validateGeologyScenario(options.geologyScenario);
  const requiredBytes=n*(8*4+1+(options.geologyScenario?2:0));
  if(requiredBytes>(options.memoryBudgetBytes??128*1024*1024))throw new Error('Geometry detail exceeds memory budget before allocation');
  const minimumSupport=Math.max(terrain.spacingM,s.nativeSpacingM),supportM=options.supportM??minimumSupport;
  if(!Number.isFinite(supportM)||supportM<minimumSupport)throw new Error('Geometry derivative support cannot be finer than source nativeSpacingM or sample spacing');
  if(options.canonicalContextId!==undefined&&(typeof options.canonicalContextId!=='string'||!options.canonicalContextId))throw new Error('Invalid canonical context reference');
  for(const height of terrain.heights)if(!Number.isFinite(height))throw new Error('Non-finite real source geometry height; no replacement is permitted');
  const reconstruction=(terrain as ReconstructedTerrain).reconstruction??'bilinear-samples';
  if(!['bilinear-samples','cubic-bspline-controls'].includes(reconstruction))throw new Error('Unsupported geometry reconstruction kernel');
  const slopeRadians=new Float32Array(n),aspectRadians=new Float32Array(n),normalXYZ=new Float32Array(n*3),rockExposurePotential=new Float32Array(n),edgeConfidence=new Float32Array(n);
  const bedrockExposure=new Float32Array(n),treeSupport=new Uint8Array(n),localBedrockUnitId=options.geologyScenario?new Uint16Array(n):undefined;
  const minX=terrain.originX,minZ=terrain.originZ,maxX=minX+(terrain.width-1)*terrain.spacingM,maxZ=minZ+(terrain.height-1)*terrain.spacingM;
  const padding=supportM+(reconstruction==='cubic-bspline-controls'?2*terrain.spacingM:0);
  const fullSupportBounds=maxX-minX>=2*padding&&maxZ-minZ>=2*padding?{minX:minX+padding,minZ:minZ+padding,maxX:maxX-padding,maxZ:maxZ-padding}:null;
  const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  let minimumHeightM=Infinity,maximumHeightM=-Infinity,sumSlope=0,sumExposure=0,fullySupported=0;
  for(let i=0;i<n;i++){
    if(!(i%4096))assertNotAborted(options.signal);
    const x=minX+i%terrain.width*terrain.spacingM,z=minZ+Math.floor(i/terrain.width)*terrain.spacingM;
    const left=Math.max(minX,x-supportM),right=Math.min(maxX,x+supportM),top=Math.max(minZ,z-supportM),bottom=Math.min(maxZ,z+supportM);
    const dx=(sampleTerrainHeight(terrain,right,z)-sampleTerrainHeight(terrain,left,z))/(right-left),dz=(sampleTerrainHeight(terrain,x,bottom)-sampleTerrainHeight(terrain,x,top))/(bottom-top);
    const length=Math.hypot(dx,1,dz),slope=Math.atan(Math.hypot(dx,dz));
    slopeRadians[i]=slope;aspectRadians[i]=Math.atan2(-dz,-dx);normalXYZ[i*3]=-dx/length;normalXYZ[i*3+1]=1/length;normalXYZ[i*3+2]=-dz/length;
    const exposure=smooth(22*Math.PI/180,60*Math.PI/180,slope);
    const confidence=Math.max(0,Math.min(1,Math.min(x-minX,maxX-x,z-minZ,maxZ-z)/padding));
    rockExposurePotential[i]=exposure;edgeConfidence[i]=confidence;bedrockExposure[i]=exposure*confidence;
    treeSupport[i]=Number(confidence<1||slope<=65*Math.PI/180);
    const height=sampleTerrainHeight(terrain,x,z);minimumHeightM=Math.min(minimumHeightM,height);maximumHeightM=Math.max(maximumHeightM,height);sumSlope+=slope;sumExposure+=exposure;if(edgeConfidence[i]>=1)fullySupported++;
    if(localBedrockUnitId)localBedrockUnitId[i]=rockUnitAtScenario(options.geologyScenario!,x,z,height);
  }
  const grid={width:terrain.width,height:terrain.height,originX:minX,originZ:minZ,spacingM:terrain.spacingM};
  const id=`geometry-detail:${fingerprint([grid,s,reconstruction,supportM,options.canonicalContextId,options.geologyScenario,terrain.heights])}`;
  return {format:'surface-geometry-detail',version:1,id,
    supportDescriptor:{format:'surface-source-support',version:1,geometryDetailId:id,canonicalContextId:options.canonicalContextId,source:{...s},supportM,
      treeMaximumSlopeRadians:65*Math.PI/180,vetoMinimumConfidence:1,exposureRecipe:{minimumSlopeRadians:22*Math.PI/180,maximumSlopeRadians:60*Math.PI/180},
      provenance:'Deterministic physical derivatives of the supplied real heightfield using its declared reconstruction and native spacing. No candidate seed, inventory or environmental context is modified.'},
    canonicalContextId:options.canonicalContextId,source:{...s},grid,reconstruction,supportM,fullSupportBounds,slopeRadians,aspectRadians,normalXYZ,rockExposurePotential,edgeConfidence,bedrockExposure,treeSupport,
    geologyScenario:options.geologyScenario?structuredClone(options.geologyScenario):undefined,localBedrockUnitId,
    statistics:{minimumHeightM,maximumHeightM,meanSlopeRadians:sumSlope/n,meanRockExposurePotential:sumExposure/n,fullSupportFraction:fullySupported/n},
    limitations:['Geometry-only derivative fields; canonical soil, climate, drainage, rock identities and population acceptance remain unchanged.',
      'Rock exposure is a declared steepness potential, not observed bedrock: combine it with canonical soil/deposit depth, occupation, water and cover before material use.',
      'Tree support is a conservative visual cliff veto only (>65 degrees with complete physical source support). It never changes candidate inventory, stable IDs or acceptance; uncertain edges are not vetoed.',
      'Source-edge derivatives have incomplete exterior support; edgeConfidence/fullSupportBounds report this. Supply padded real terrain for matching adjacent patches.',
      'Fine slope does not reconstruct missing fine drainage, deposit boundaries, geological contacts or calibrated sediment/pedological processes.']};
}

/** Continuous normal query; aspect is derived from the interpolated normal so
 * the +/-pi wrap cannot flip a downslope direction. */
export function sampleSurfaceGeometryDetail(detail:SurfaceGeometryDetail,x:number,z:number) {
  const g=detail.grid,gx=(x-g.originX)/g.spacingM,gz=(z-g.originZ)/g.spacingM;
  if(![gx,gz].every(Number.isFinite)||gx<0||gz<0||gx>g.width-1||gz>g.height-1)throw new Error('Geometry detail query lies outside its actual sample support');
  const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz;
  const value=(field:ReadonlyDetailField,stride=1,channel=0)=>{
    const at=(xx:number,zz:number)=>field[(Math.min(g.height-1,zz)*g.width+Math.min(g.width-1,xx))*stride+channel];
    return (at(ix,iz)*(1-u)+at(ix+1,iz)*u)*(1-v)+(at(ix,iz+1)*(1-u)+at(ix+1,iz+1)*u)*v;
  };
  const nx=value(detail.normalXYZ,3,0),ny=value(detail.normalXYZ,3,1),nz=value(detail.normalXYZ,3,2),length=Math.hypot(nx,ny,nz);
  const slopeRadians=Math.acos(Math.max(-1,Math.min(1,ny/length))),confidence=value(detail.edgeConfidence);
  return {slopeRadians,aspectRadians:Math.atan2(nz,nx),normalXYZ:[nx/length,ny/length,nz/length] as const,
    rockExposurePotential:value(detail.rockExposurePotential),edgeConfidence:confidence,bedrockExposure:value(detail.bedrockExposure),
    treeSupport:confidence<1||slopeRadians<=65*Math.PI/180,
    localBedrockUnitId:detail.localBedrockUnitId?.[Math.round(gz)*g.width+Math.round(gx)]};
}
