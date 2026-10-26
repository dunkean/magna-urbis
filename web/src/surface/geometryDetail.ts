import { fingerprint } from './hash';
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
  /** Context-conditioned material opacity. This does not change raw geometry id;
   * the world compiler binds canonicalEnvironmentVersion and versions this layer. */
  readonly surfaceConditioning?:{
    readonly version:'surface-conditioning-1';readonly canonicalEnvironmentVersion:string;
    readonly bedrockExposure:ReadonlyDetailField;
  };
  readonly statistics:Readonly<{minimumHeightM:number;maximumHeightM:number;meanSlopeRadians:number;meanRockExposurePotential:number;fullSupportFraction:number}>;
  readonly limitations:readonly string[];
}
export interface GeometryDetailOptions {
  supportM?:number;canonicalContextId?:string;signal?:AbortSignal;memoryBudgetBytes?:number;
  geologyScenario?:TiltedStrataScenario;
}
const MAX_FLOAT_SLOPE=1.570796251296997; // largest Float32 <= pi/2
function detailId(terrain:TerrainGrid,grid:SurfaceGeometryDetail['grid'],reconstruction:SurfaceGeometryDetail['reconstruction'],supportM:number,contextId?:string,scenario?:TiltedStrataScenario):string {
  return `geometry-detail:${fingerprint([grid,terrain.source,reconstruction,supportM,contextId,scenario,terrain.heights])}`;
}
function detailBudget(n:number,scenario:boolean,conditioning:boolean,budget=128*1024*1024):void {
  if(!Number.isSafeInteger(budget)||budget<0||n*(8*4+1+(scenario?2:0)+(conditioning?4:0))>budget)throw new Error('Geometry detail exceeds memory budget before allocation');
}

/** Real fine heights supply local support/normal/exposure potential without
 * recompiling canonical geology, soil fractions, hydrology, cover or candidates.
 * Synchronous: use the compiler worker for interruptible large requests. */
export function deriveSurfaceGeometryDetail(terrain:TerrainGrid,options:GeometryDetailOptions={}):SurfaceGeometryDetail {
  assertNotAborted(options.signal);
  const n=terrain.width*terrain.height,s=terrain.source;
  if(!Number.isInteger(terrain.width)||!Number.isInteger(terrain.height)||terrain.width<2||terrain.height<2||!Number.isSafeInteger(n)
    ||!(terrain.heights instanceof Float32Array)||terrain.heights.length!==n||![terrain.originX,terrain.originZ,terrain.spacingM].every(Number.isFinite)||terrain.spacingM<=0
    ||!s||typeof s.id!=='string'||!s.id||typeof s.version!=='string'||!s.version||!Number.isFinite(s.nativeSpacingM)||s.nativeSpacingM<=0||!Number.isFinite(s.sourceLOD)
    ||s.sourceLODKnown!==undefined&&typeof s.sourceLODKnown!=='boolean'||s.provenance!==undefined&&typeof s.provenance!=='string')throw new Error('Invalid real source terrain for geometry detail');
  if(options.geologyScenario)validateGeologyScenario(options.geologyScenario);
  detailBudget(n,!!options.geologyScenario,false,options.memoryBudgetBytes);
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
    slopeRadians[i]=Math.min(MAX_FLOAT_SLOPE,slope);aspectRadians[i]=Math.atan2(-dz,-dx);normalXYZ[i*3]=-dx/length;normalXYZ[i*3+1]=1/length;normalXYZ[i*3+2]=-dz/length;
    const exposure=smooth(22*Math.PI/180,60*Math.PI/180,slope);
    const confidence=Math.max(0,Math.min(1,Math.min(x-minX,maxX-x,z-minZ,maxZ-z)/padding));
    rockExposurePotential[i]=exposure;edgeConfidence[i]=confidence;bedrockExposure[i]=exposure*confidence;
    treeSupport[i]=Number(confidence<1||slope<=65*Math.PI/180);
    const height=sampleTerrainHeight(terrain,x,z);minimumHeightM=Math.min(minimumHeightM,height);maximumHeightM=Math.max(maximumHeightM,height);sumSlope+=slope;sumExposure+=exposure;if(edgeConfidence[i]>=1)fullySupported++;
    if(localBedrockUnitId)localBedrockUnitId[i]=rockUnitAtScenario(options.geologyScenario!,x,z,height);
  }
  const grid={width:terrain.width,height:terrain.height,originX:minX,originZ:minZ,spacingM:terrain.spacingM};
  const id=detailId(terrain,grid,reconstruction,supportM,options.canonicalContextId,options.geologyScenario);
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
  // Flat aspects have no physical direction. Normalize signed zero as JSON
  // transports it as +0; otherwise atan2(-0,-0) invents a pi-sized change.
  return {slopeRadians,aspectRadians:nx===0&&nz===0?0:Math.atan2(nz||0,nx||0),normalXYZ:[nx/length||0,ny/length,nz/length||0] as const,
    rockExposurePotential:value(detail.rockExposurePotential),edgeConfidence:confidence,bedrockExposure:value(detail.bedrockExposure),
    treeSupport:confidence<1||slopeRadians<=65*Math.PI/180,
    localBedrockUnitId:detail.localBedrockUnitId?.[Math.round(gz)*g.width+Math.round(gx)]};
}

const plain=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>!d.get&&!d.set);
function metadata(value:unknown,parents=new Set<object>(),depth=0,counter={n:0}):void {
  if(++counter.n>100000||depth>64)throw new Error('Geometry detail metadata exceeds validation limits');
  if(value===undefined||value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Non-finite geometry detail metadata');return;}
  if(!Array.isArray(value)&&!plain(value)||parents.has(value as object))throw new Error('Invalid or cyclic geometry detail metadata');
  parents.add(value as object);
  for(const [key,entry] of Object.entries(value as object)){
    if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe geometry detail metadata key');
    metadata(entry,parents,depth+1,counter);
  }
  parents.delete(value as object);
}
type DetailArray=Float32Array|Uint8Array|Uint16Array;
function checkDetail(value:unknown,terrain:TerrainGrid,canonicalContextId:string|undefined,memoryBudgetBytes:number|undefined,restore:boolean):SurfaceGeometryDetail {
  if(!plain(value)||value.format!=='surface-geometry-detail'||value.version!==1)throw new Error('Unsupported geometry detail');
  const r=value,n=terrain?.width*terrain?.height;
  if(!terrain||!Number.isInteger(terrain.width)||!Number.isInteger(terrain.height)||terrain.width<2||terrain.height<2||!Number.isSafeInteger(n)
    ||!(terrain.heights instanceof Float32Array)||terrain.heights.length!==n||![terrain.originX,terrain.originZ,terrain.spacingM].every(Number.isFinite)||terrain.spacingM<=0
    ||!terrain.source||typeof terrain.source.id!=='string'||!terrain.source.id||typeof terrain.source.version!=='string'||!terrain.source.version
    ||!Number.isFinite(terrain.source.sourceLOD)||!Number.isFinite(terrain.source.nativeSpacingM)||terrain.source.nativeSpacingM<=0
    ||terrain.source.sourceLODKnown!==undefined&&typeof terrain.source.sourceLODKnown!=='boolean'||terrain.source.provenance!==undefined&&typeof terrain.source.provenance!=='string')throw new Error('Invalid source terrain for geometry detail validation');
  detailBudget(n,r.geologyScenario!==undefined,r.surfaceConditioning!==undefined,memoryBudgetBytes);
  for(const key of ['grid','source','supportDescriptor','statistics','limitations','geologyScenario'])metadata(r[key]);
  if(r.canonicalContextId!==undefined&&(typeof r.canonicalContextId!=='string'||!r.canonicalContextId)
    ||canonicalContextId!==undefined&&r.canonicalContextId!==canonicalContextId)throw new Error('Geometry detail canonical context mismatch');
  const grid={width:terrain.width,height:terrain.height,originX:terrain.originX,originZ:terrain.originZ,spacingM:terrain.spacingM};
  const reconstruction=(terrain as ReconstructedTerrain).reconstruction??'bilinear-samples';
  if(!['bilinear-samples','cubic-bspline-controls'].includes(reconstruction)||r.reconstruction!==reconstruction
    ||!plain(r.grid)||fingerprint(r.grid)!==fingerprint(grid)||!plain(r.source)||fingerprint(r.source)!==fingerprint(terrain.source))throw new Error('Geometry detail source/grid/kernel mismatch');
  if(!Number.isFinite(r.supportM)||r.supportM<Math.max(terrain.spacingM,terrain.source.nativeSpacingM))throw new Error('Invalid geometry detail physical support');
  if(r.geologyScenario!==undefined)validateGeologyScenario(r.geologyScenario);
  if((r.geologyScenario===undefined)!==(r.localBedrockUnitId===undefined))throw new Error('Local geology requires its explicit scenario and unit-id field together');
  const id=detailId(terrain,grid,reconstruction,r.supportM,r.canonicalContextId,r.geologyScenario);
  if(r.id!==id)throw new Error('Geometry detail identity differs from actual source height content/context');
  const descriptor=r.supportDescriptor;
  if(!plain(descriptor)||descriptor.format!=='surface-source-support'||descriptor.version!==1||descriptor.geometryDetailId!==id
    ||descriptor.canonicalContextId!==r.canonicalContextId||fingerprint(descriptor.source)!==fingerprint(terrain.source)||descriptor.supportM!==r.supportM
    ||descriptor.treeMaximumSlopeRadians!==65*Math.PI/180||descriptor.vetoMinimumConfidence!==1
    ||!plain(descriptor.exposureRecipe)||descriptor.exposureRecipe.minimumSlopeRadians!==22*Math.PI/180||descriptor.exposureRecipe.maximumSlopeRadians!==60*Math.PI/180
    ||typeof descriptor.provenance!=='string'||!descriptor.provenance.trim())throw new Error('Inconsistent source support descriptor');
  if(!Array.isArray(r.limitations)||!r.limitations.length||r.limitations.some((v:unknown)=>typeof v!=='string'||!v.trim()))throw new Error('Invalid geometry detail limitations');
  const array=(input:unknown,count:number,Ctor:typeof Float32Array|typeof Uint8Array|typeof Uint16Array,key:string,min:number,max:number):DetailArray=>{
    const typed=input instanceof Ctor;
    if(!typed&&(!restore||!Array.isArray(input))||(input as ArrayLike<number>)?.length!==count)throw new Error(`Invalid ${key} length or typed constructor`);
    const values=input as ArrayLike<number>;
    for(let i=0;i<count;i++)if(typeof values[i]!=='number'||!Number.isFinite(values[i])||values[i]<min||values[i]>max
      ||Ctor!==Float32Array&&!Number.isInteger(values[i]))throw new Error(`Invalid ${key} numeric value`);
    return typed?input as DetailArray:new Ctor(input as number[]);
  };
  const out:Record<string,any>={...r};
  for(const key of ['slopeRadians','aspectRadians','rockExposurePotential','edgeConfidence','bedrockExposure'])out[key]=array(r[key],n,Float32Array,key,key==='aspectRadians'?-Math.PI-1e-6:0,key==='slopeRadians'?Math.PI/2:key==='aspectRadians'?Math.PI+1e-6:1);
  out.normalXYZ=array(r.normalXYZ,n*3,Float32Array,'normalXYZ',-1,1);
  out.treeSupport=array(r.treeSupport,n,Uint8Array,'treeSupport',0,1);
  if(r.localBedrockUnitId!==undefined)out.localBedrockUnitId=array(r.localBedrockUnitId,n,Uint16Array,'localBedrockUnitId',1,65535);
  if(r.surfaceConditioning!==undefined){
    const c=r.surfaceConditioning;
    if(!plain(c)||c.version!=='surface-conditioning-1'||typeof c.canonicalEnvironmentVersion!=='string'||!c.canonicalEnvironmentVersion.trim())throw new Error('Invalid surface conditioning version/context');
    const {bedrockExposure:_,...conditioningMetadata}=c;metadata(conditioningMetadata);
    out.surfaceConditioning={...c,bedrockExposure:array(c.bedrockExposure,n,Float32Array,'surfaceConditioning.bedrockExposure',0,1)};
  }
  const minX=grid.originX,minZ=grid.originZ,maxX=minX+(grid.width-1)*grid.spacingM,maxZ=minZ+(grid.height-1)*grid.spacingM;
  const padding=r.supportM+(reconstruction==='cubic-bspline-controls'?2*grid.spacingM:0);
  const fullSupportBounds=maxX-minX>=2*padding&&maxZ-minZ>=2*padding?{minX:minX+padding,minZ:minZ+padding,maxX:maxX-padding,maxZ:maxZ-padding}:null;
  metadata(r.fullSupportBounds);
  if(fingerprint(r.fullSupportBounds)!==fingerprint(fullSupportBounds))throw new Error('Geometry detail full-support bounds mismatch');
  const near=(a:number,b:number,tolerance=2e-6)=>Math.abs(a-b)<=tolerance;
  let minimumHeightM=Infinity,maximumHeightM=-Infinity,sumSlope=0,sumExposure=0,fullySupported=0;
  for(let i=0;i<n;i++){
    if(!Number.isFinite(terrain.heights[i]))throw new Error('Non-finite actual geometry source height');
    const x=minX+i%grid.width*grid.spacingM,z=minZ+Math.floor(i/grid.width)*grid.spacingM;
    const left=Math.max(minX,x-r.supportM),right=Math.min(maxX,x+r.supportM),top=Math.max(minZ,z-r.supportM),bottom=Math.min(maxZ,z+r.supportM);
    const dx=(sampleTerrainHeight(terrain,right,z)-sampleTerrainHeight(terrain,left,z))/(right-left),dz=(sampleTerrainHeight(terrain,x,bottom)-sampleTerrainHeight(terrain,x,top))/(bottom-top);
    const length=Math.hypot(dx,1,dz),slope=Math.atan(Math.hypot(dx,dz)),aspect=Math.atan2(-dz,-dx);
    const q=Math.max(0,Math.min(1,(slope-22*Math.PI/180)/(38*Math.PI/180))),exposure=q*q*(3-2*q);
    const confidence=Math.max(0,Math.min(1,Math.min(x-minX,maxX-x,z-minZ,maxZ-z)/padding));
    const nx=out.normalXYZ[i*3],ny=out.normalXYZ[i*3+1],nz=out.normalXYZ[i*3+2];
    if(!near(Math.hypot(nx,ny,nz),1)||ny<0||!near(nx,-dx/length)||!near(ny,1/length)||!near(nz,-dz/length)
      ||!near(out.slopeRadians[i],Math.min(MAX_FLOAT_SLOPE,slope))||Math.abs(Math.atan2(Math.sin(out.aspectRadians[i]-aspect),Math.cos(out.aspectRadians[i]-aspect)))>2e-6
      ||!near(out.rockExposurePotential[i],exposure)||!near(out.edgeConfidence[i],confidence)||!near(out.bedrockExposure[i],exposure*confidence)
      ||out.treeSupport[i]!==Number(confidence<1||slope<=65*Math.PI/180))throw new Error('Geometry detail fields differ from actual source derivatives/support');
    const height=sampleTerrainHeight(terrain,x,z);minimumHeightM=Math.min(minimumHeightM,height);maximumHeightM=Math.max(maximumHeightM,height);sumSlope+=slope;sumExposure+=exposure;if(out.edgeConfidence[i]>=1)fullySupported++;
    if(r.geologyScenario&&out.localBedrockUnitId[i]!==rockUnitAtScenario(r.geologyScenario,x,z,height))throw new Error('Local bedrock ids differ from the explicit source-height scenario');
  }
  const expectedStats={minimumHeightM,maximumHeightM,meanSlopeRadians:sumSlope/n,meanRockExposurePotential:sumExposure/n,fullSupportFraction:fullySupported/n};
  if(!plain(r.statistics)||Object.entries(expectedStats).some(([key,v])=>typeof r.statistics[key]!=='number'||!near(r.statistics[key],v,1e-6*Math.max(1,Math.abs(v)))))throw new Error('Inconsistent geometry detail statistics');
  return out as unknown as SurfaceGeometryDetail;
}

/** Restore plain JSON arrays or retain exact validated typed views. No decimal
 * round trip or full-size clone of already typed fields is performed. Metadata
 * and every derivative/support decision are checked against the real source. */
export function hydrateSurfaceGeometryDetail(value:unknown,terrain:TerrainGrid,canonicalContextId?:string,memoryBudgetBytes?:number):SurfaceGeometryDetail {
  return checkDetail(value,terrain,canonicalContextId,memoryBudgetBytes,true);
}
/** Strict typed-object boundary. JSON callers must hydrate first. */
export function validateSurfaceGeometryDetail(value:unknown,terrain:TerrainGrid,canonicalContextId?:string,memoryBudgetBytes?:number):asserts value is SurfaceGeometryDetail {
  checkDetail(value,terrain,canonicalContextId,memoryBudgetBytes,false);
}
