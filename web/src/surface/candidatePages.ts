import { generateSurfaceCandidates, PopulationBudgetError } from './population';
import { sampleTerrainHeight } from './heightSampling';
import { SURFACE_MAX_CANDIDATES } from './limits';
import { assertNotAborted, type Bounds, type SurfaceCandidate, type SurfaceWorld, type TerrainGrid } from './model';
import type { CandidateColumns } from './candidateColumns';

export interface CandidatePage {
  bounds: Bounds; requestedBounds: Bounds; count: number;
  /** Complete accepted inventory intersecting bounds (including crown overhang), not rank thinning. */
  complete: true; includeOverhang: true; retention: 1;
  limitedBy: 'none' | 'candidate-budget' | 'slot-budget';
}
export interface SurfaceCandidatePages {
  version: 'surface-candidate-pages-1';
  tree: CandidatePage; shrub: CandidatePage; boulder: CandidatePage; grass: CandidatePage; debris: CandidatePage;
  support: {
    policy: 'fine-inside-centres-otherwise-parent-or-canonical';
    canonicalSource: CandidateHeightSource; fineSource?: CandidateHeightSource; parentSource?: CandidateHeightSource;
    canonicalContextId: string; fineBounds?: Bounds; parentBounds?: Bounds; fineSampleCount: number; parentSampleCount: number; canonicalSampleCount: number;
  };
}
interface CandidateHeightSource {id:string;version:string;nativeSpacingM:number;reconstruction:'bilinear-samples'|'cubic-bspline-controls'}
export interface CandidatePageOptions {
  fineTerrain?: TerrainGrid; parentTerrain?: TerrainGrid; canonicalContextId: string;
  maxCandidates?: number; maxCheckedSlots?: number; signal?: AbortSignal;
}
const LOCAL = ['shrub', 'boulder', 'grass', 'debris'] as const;
const FAMILIES=['tree',...LOCAL] as const;
export function terrainSampleBounds(t: TerrainGrid): Bounds {
  return { minX:t.originX,minZ:t.originZ,maxX:t.originX+(t.width-1)*t.spacingM,maxZ:t.originZ+(t.height-1)*t.spacingM };
}
function contains(b:Bounds,x:number,z:number) { return x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ; }
function heightSource(t:TerrainGrid):CandidateHeightSource{return{id:t.source.id,version:t.source.version,nativeSpacingM:t.source.nativeSpacingM,reconstruction:t.reconstruction??'bilinear-samples'};}
function windowAt(domain:Bounds,cx:number,cz:number,width:number):Bounds {
  return {minX:Math.max(domain.minX,cx-width/2),minZ:Math.max(domain.minZ,cz-width/2),maxX:Math.min(domain.maxX,cx+width/2),maxZ:Math.min(domain.maxZ,cz+width/2)};
}

/** Eligibility, IDs, ranks and sizes always come from the full canonical world.
 * Geometry only changes Y, strictly inside the selected source sample support.
 * A reduced page remains COMPLETE for its declared bounds; it does not claim view coverage. */
export function generateSurfaceCandidatePages(canonical:SurfaceWorld,view:Bounds,options:CandidatePageOptions) {
  assertNotAborted(options.signal);
  if(canonical.canonicalContextRef)throw new Error('Candidate pages require the full canonical source world');
  for(const t of [options.fineTerrain,options.parentTerrain])if(t&&(t.source.id!==canonical.terrain.source.id||t.source.version!==canonical.terrain.source.version))throw new Error('Candidate support source identity/version mismatch');
  if (![view.minX,view.minZ,view.maxX,view.maxZ].every(Number.isFinite)||view.minX>view.maxX||view.minZ>view.maxZ)throw new Error('Invalid candidate view bounds');
  const max=options.maxCandidates??SURFACE_MAX_CANDIDATES,slots=options.maxCheckedSlots??2_000_000;
  if(!Number.isInteger(max)||max<1||max>SURFACE_MAX_CANDIDATES)throw new Error('Invalid candidate page total budget');
  if(!Number.isInteger(slots)||slots<1)throw new Error('Invalid candidate page slot budget');
  const cx=Math.max(canonical.bounds.minX,Math.min(canonical.bounds.maxX,(view.minX+view.maxX)/2));
  const cz=Math.max(canonical.bounds.minZ,Math.min(canonical.bounds.maxZ,(view.minZ+view.maxZ)/2));
  const extent=Math.max(view.maxX-view.minX,view.maxZ-view.minZ);
  const query=(families:SurfaceCandidate['family'][],target:number,budget:number)=>{
    const requestedBounds=windowAt(canonical.bounds,cx,cz,target);
    let width=target,limitedBy:CandidatePage['limitedBy']='none';
    for(let attempt=0;attempt<20;attempt++) {
      assertNotAborted(options.signal);
      const bounds=windowAt(canonical.bounds,cx,cz,width);
      try { const candidates=generateSurfaceCandidates(canonical,bounds,{families,maxCandidates:budget,maxCheckedSlots:slots,includeOverhang:true,signal:options.signal});
        return {candidates,page:{bounds,requestedBounds,count:candidates.length,complete:true as const,includeOverhang:true as const,retention:1 as const,limitedBy}};
      }catch(error){if(!(error instanceof PopulationBudgetError))throw error;
        limitedBy=error.budget==='slots'?'slot-budget':'candidate-budget';width=attempt===18?0:width/2;
      }
    }
    throw new Error('Candidate budget cannot hold a complete inventory at the focus');
  };
  // Reserve room for trees; under ordinary density the local page needs <25k items.
  const local=query([...LOCAL],Math.min(480,Math.max(0,extent)),Math.floor(max/4));
  const tree=query(['tree'],Math.min(4000,Math.max(480,extent)),max-local.candidates.length);
  const candidates=[...tree.candidates,...local.candidates];
  const fine=options.fineTerrain,parent=options.parentTerrain;
  const fineBounds=fine?terrainSampleBounds(fine):undefined,parentBounds=parent?terrainSampleBounds(parent):undefined;
  const support:SurfaceCandidatePages['support']={policy:'fine-inside-centres-otherwise-parent-or-canonical',canonicalSource:heightSource(canonical.terrain),canonicalContextId:options.canonicalContextId,
    ...(fine?{fineSource:heightSource(fine),fineBounds}:{}),...(parent?{parentSource:heightSource(parent),parentBounds}:{}),fineSampleCount:0,parentSampleCount:0,canonicalSampleCount:0};
  for(const candidate of candidates){
    if(fine&&fineBounds&&contains(fineBounds,candidate.x,candidate.z)){candidate.y=sampleTerrainHeight(fine,candidate.x,candidate.z);support.fineSampleCount++;}
    else if(parent&&parentBounds&&contains(parentBounds,candidate.x,candidate.z)){candidate.y=sampleTerrainHeight(parent,candidate.x,candidate.z);support.parentSampleCount++;}
    else support.canonicalSampleCount++;
    if(!Number.isFinite(candidate.y))throw new Error('Candidate support height is non-finite');
  }
  const pages:SurfaceCandidatePages={version:'surface-candidate-pages-1',tree:tree.page,support,
    ...Object.fromEntries(LOCAL.map(family=>[family,{...local.page,count:local.candidates.filter(c=>c.family===family).length}])) as Record<typeof LOCAL[number],CandidatePage>};
  return {candidates,candidatePages:pages,candidateBounds:local.page.bounds};
}

/** Shape and count verification at packet ingress; completeness is a producer guarantee. */
export function validateSurfaceCandidatePages(value:unknown,columns?:CandidateColumns,candidates?:readonly SurfaceCandidate[],world?:SurfaceWorld):asserts value is SurfaceCandidatePages {
  const p=value as SurfaceCandidatePages;
  const bounds=(b:Bounds)=>b&&[b.minX,b.minZ,b.maxX,b.maxZ].every(Number.isFinite)&&b.minX<=b.maxX&&b.minZ<=b.maxZ;
  if(!p||p.version!=='surface-candidate-pages-1'||!p.support||p.support.policy!=='fine-inside-centres-otherwise-parent-or-canonical'||typeof p.support.canonicalContextId!=='string')throw new Error('Invalid candidate page provenance');
  let total=0;
  for(const family of FAMILIES){const page=p[family];
    if(!page||!bounds(page.bounds)||!bounds(page.requestedBounds)||page.complete!==true||page.retention!==1||page.includeOverhang!==true
      ||!['none','candidate-budget','slot-budget'].includes(page.limitedBy)||!Number.isInteger(page.count)||page.count<0
      ||page.bounds.minX<page.requestedBounds.minX||page.bounds.minZ<page.requestedBounds.minZ||page.bounds.maxX>page.requestedBounds.maxX||page.bounds.maxZ>page.requestedBounds.maxZ)throw new Error('Invalid candidate page '+family);
    const count=columns?columns.family.reduce((s,code)=>s+Number(columns.families[code]===family),0):candidates?.filter(c=>c.family===family).length??0;
    if(count!==page.count)throw new Error('Candidate page count mismatch '+family);total+=count;
  }
  const s=p.support;
  const source=(d:CandidateHeightSource)=>d&&typeof d.id==='string'&&typeof d.version==='string'&&Number.isFinite(d.nativeSpacingM)&&d.nativeSpacingM>0&&['bilinear-samples','cubic-bspline-controls'].includes(d.reconstruction);
  if(!source(s.canonicalSource)||s.fineSource!==undefined&&!source(s.fineSource)||s.parentSource!==undefined&&!source(s.parentSource)
    ||[s.fineSampleCount,s.parentSampleCount,s.canonicalSampleCount].some(v=>!Number.isInteger(v)||v<0)
    ||s.fineSampleCount+s.parentSampleCount+s.canonicalSampleCount!==total||s.fineBounds!==undefined&&!bounds(s.fineBounds)||s.parentBounds!==undefined&&!bounds(s.parentBounds)
    ||s.fineSampleCount>0&&!s.fineSource||s.parentSampleCount>0&&!s.parentSource||total>SURFACE_MAX_CANDIDATES)throw new Error('Invalid candidate support provenance');
  if(world){
    const expected=world.canonicalContextRef?.id;
    if(expected&&s.canonicalContextId!==expected||s.canonicalSource.id!==world.terrain.source.id||s.canonicalSource.version!==world.terrain.source.version)throw new Error('Candidate page context/source mismatch');
    if(s.fineSource&&(s.fineSource.id!==world.terrain.source.id||s.fineSource.version!==world.terrain.source.version||!s.fineBounds||Object.entries(terrainSampleBounds(world.terrain)).some(([key,v])=>s.fineBounds![key as keyof Bounds]!==v)))throw new Error('Candidate fine support mismatch');
    if(s.parentSource&&(s.parentSource.id!==world.terrain.source.id||s.parentSource.version!==world.terrain.source.version||!s.parentBounds))throw new Error('Candidate parent source mismatch');
  }
}
