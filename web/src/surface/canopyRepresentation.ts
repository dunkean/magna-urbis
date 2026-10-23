import { assertNotAborted, type Bounds, type SurfaceCandidate } from './model';

/** Shared renderer-neutral recipe. Colours are LINEAR, never sRGB source_color. */
export const CANOPY_REPRESENTATION_VERSION = 'canopy-r1';
export const CANOPY_LINEAR_RGB = [.055, .105, .036] as const;
export const CANOPY_RADIUS_CLASSES_M = [2.5, 4, 5.5, 7] as const;
export interface CanopyAtlas {
  version: typeof CANOPY_REPRESENTATION_VERSION;
  width: number; height: number; originX: number; originZ: number; spacingM: number;
  bounds: Bounds; fallbackBlendM: number;
  /** True candidate-disc union, linear coverage. Generate linear coverage mips. */
  coverage: Float32Array;
  /** Interleaved 4 classes, exact counts of SELECTED discs at each texel centre.
   * NEVER mip or interpolate counts before evaluating transmittance. */
  selectedCounts: Uint16Array;
  candidateTreeCount: number; selectedTreeCount: number;
}
const sat = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const t = sat((x-a)/(b-a)); return t*t*(3-2*t); };
export function canopyRadiusClass(radiusM: number): number {
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error('Invalid physical crown radius');
  let best = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(radiusM-CANOPY_RADIUS_CLASSES_M[i]) < Math.abs(radiusM-CANOPY_RADIUS_CLASSES_M[best])) best = i;
  return best;
}
/** Both ground and instance shaders evaluate this continuously, per pixel. */
export function canopyInstanceWeight(radiusClass: number, footprintM: number): number {
  if (!Number.isInteger(radiusClass) || radiusClass < 0 || radiusClass >= 4 || !Number.isFinite(footprintM) || footprintM <= 0) throw new Error('Invalid canopy footprint/class');
  return smooth(1.25, 3, 2*CANOPY_RADIUS_CLASSES_M[radiusClass]/footprintM);
}
export function visibleCanopyCoverage(counts: ArrayLike<number>, footprintM: number): number {
  let transmittance = 1;
  for (let b = 0; b < 4; b++) {
    const count = counts[b]; if (!Number.isInteger(count) || count < 0) throw new Error('Invalid canopy overlap count');
    if (count) transmittance *= Math.pow(1-canopyInstanceWeight(b, footprintM),count);
  }
  return 1-transmittance;
}
/** Union compositing, including overlap: V+(1-V)*G=C. Missing/budgeted-out
 * geometry contributes to C, never V, and therefore remains in the ground. */
export function residualCanopyCoverage(total: number, visible: number): number {
  if (![total,visible].every(Number.isFinite)) throw new Error('Non-finite canopy coverage');
  const c=sat(total),v=Math.min(c,sat(visible)); return v >= 1-1e-12 ? 0 : sat((c-v)/(1-v));
}
/** Keep selected geometry wholly out of the analytic-mean transition halo.
 * It remains represented in total coverage even when this prevents selection. */
export function canopySupportsSelection(candidate: SurfaceCandidate,bounds:Bounds,blendM=16):boolean {
  const radius=candidate.crownRadiusM??0;
  return Math.min(candidate.x-bounds.minX,bounds.maxX-candidate.x,candidate.z-bounds.minZ,bounds.maxZ-candidate.z)>=blendM+radius;
}
export function buildCanopyAtlas(candidates: readonly SurfaceCandidate[], selectedIds: ReadonlySet<string>, bounds: Bounds,
  options: { resolution?: number; fallbackBlendM?: number; signal?: AbortSignal; memoryBudgetBytes?: number } = {}): CanopyAtlas {
  assertNotAborted(options.signal);
  const extent=Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ), resolution=options.resolution??1024;
  if (![bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ].every(Number.isFinite) || extent<=0 || bounds.maxX<=bounds.minX || bounds.maxZ<=bounds.minZ || !Number.isInteger(resolution) || resolution<2 || resolution>4096) throw new Error('Invalid canopy atlas bounds/resolution');
  const spacingM=extent/resolution,width=Math.ceil((bounds.maxX-bounds.minX)/spacingM),height=Math.ceil((bounds.maxZ-bounds.minZ)/spacingM),n=width*height;
  if (n*12>(options.memoryBudgetBytes??64*1024*1024)) throw new Error('Canopy atlas exceeds memory budget before allocation');
  const atlas: CanopyAtlas={version:CANOPY_REPRESENTATION_VERSION,width,height,originX:bounds.minX+spacingM/2,originZ:bounds.minZ+spacingM/2,spacingM,
    bounds:{...bounds},fallbackBlendM:options.fallbackBlendM??16,coverage:new Float32Array(n),selectedCounts:new Uint16Array(n*4),candidateTreeCount:0,selectedTreeCount:0};
  if (!Number.isFinite(atlas.fallbackBlendM)||atlas.fallbackBlendM<0) throw new Error('Invalid canopy halo');
  for(let index=0;index<candidates.length;index++) {
    if(!(index%256)) assertNotAborted(options.signal);
    const candidate=candidates[index]; if(candidate.family!=='tree')continue;
    const radius=candidate.crownRadiusM;
    if(!Number.isFinite(candidate.x)||!Number.isFinite(candidate.z)||radius===undefined)throw new Error('Canopy requires finite candidate positions and explicit physical crownRadiusM');
    const bin=canopyRadiusClass(radius), selected=selectedIds.has(candidate.stableId);atlas.candidateTreeCount++;if(selected){
      if(!canopySupportsSelection(candidate,bounds,atlas.fallbackBlendM))throw new Error('Selected crown intersects the analytic canopy fallback halo');
      atlas.selectedTreeCount++;
    }
    const minZ=Math.max(0,Math.ceil((candidate.z-radius-atlas.originZ)/spacingM)),maxZ=Math.min(height-1,Math.floor((candidate.z+radius-atlas.originZ)/spacingM));
    for(let z=minZ;z<=maxZ;z++) {
      const dz=atlas.originZ+z*spacingM-candidate.z,half=Math.sqrt(Math.max(0,radius*radius-dz*dz));
      const minX=Math.max(0,Math.ceil((candidate.x-half-atlas.originX)/spacingM)),maxX=Math.min(width-1,Math.floor((candidate.x+half-atlas.originX)/spacingM));
      for(let x=minX;x<=maxX;x++) { const i=z*width+x;atlas.coverage[i]=1;if(selected){const at=i*4+bin;if(atlas.selectedCounts[at]===65535)throw new Error('Canopy overlap exceeds u16 count capacity');atlas.selectedCounts[at]++;} }
    }
  }
  return atlas;
}
/** Reference bilinear shader query. It interpolates transmittances AFTER powers,
 * preserving union means; interpolated counts would visibly inflate crowns. */
export function sampleCanopyAtlas(atlas: CanopyAtlas,x:number,z:number,footprintM:number,meanCover:number):{total:number;visible:number;residual:number} {
  const gx=Math.max(0,Math.min(atlas.width-1,(x-atlas.originX)/atlas.spacingM)),gz=Math.max(0,Math.min(atlas.height-1,(z-atlas.originZ)/atlas.spacingM));
  const ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz;
  let c=0,v=0;
  for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++) {
    const i=Math.min(atlas.height-1,iz+dz)*atlas.width+Math.min(atlas.width-1,ix+dx),w=(dx?fx:1-fx)*(dz?fz:1-fz);
    c+=atlas.coverage[i]*w;v+=visibleCanopyCoverage(atlas.selectedCounts.subarray(i*4,i*4+4),footprintM)*w;
  }
  const edge=Math.min(x-atlas.bounds.minX,atlas.bounds.maxX-x,z-atlas.bounds.minZ,atlas.bounds.maxZ-z);
  const local=atlas.fallbackBlendM>0?smooth(0,atlas.fallbackBlendM,edge):Number(edge>=0);
  c=sat(meanCover)*(1-local)+c*local;v=Math.min(c,v*local);
  return {total:c,visible:v,residual:residualCanopyCoverage(c,v)};
}
