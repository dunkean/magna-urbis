import { describe, expect, it } from 'vitest';
import { buildCanopyAtlas, canopyInstanceWeight, canopyRadiusClass, canopySupportsSelection, residualCanopyCoverage, sampleCanopyAtlas,
  CANOPY_LINEAR_RGB, type CanopyAtlas } from '../src/surface/canopyRepresentation';
import { compileSurfaceWorld } from '../src/surface/compiler';
import { generateSurfaceCandidates } from '../src/surface/population';
import type { SurfaceCandidate } from '../src/surface/model';

const bounds={minX:0,minZ:0,maxX:256,maxZ:256};
function candidates(target:number) {
  const world=compileSurfaceWorld({seed:7381,terrain:{width:9,height:9,originX:-64,originZ:-64,spacingM:48,heights:new Float32Array(81),
    source:{id:'unit-canopy',version:'1',sourceLOD:0,nativeSpacingM:48}},hydrology:{version:'dry',provenance:'unit test',waterClass:new Uint8Array(81)}});
  world.fields.treeCover.fill(target);return generateSurfaceCandidates(world,bounds,{families:['tree'],includeOverhang:true});
}
const bucketCache=new WeakMap<SurfaceCandidate[],Map<string,SurfaceCandidate[]>>();
function actualVisible(trees:SurfaceCandidate[],selected:ReadonlySet<string>,x:number,z:number,footprint:number) {
  let buckets=bucketCache.get(trees);if(!buckets){buckets=new Map();for(const c of trees){const key=`${Math.floor(c.x/16)}:${Math.floor(c.z/16)}`;const bucket=buckets.get(key)??[];bucket.push(c);buckets.set(key,bucket);}bucketCache.set(trees,buckets);}
  let transmittance=1,hit=false;
  for(let cz=Math.floor(z/16)-1;cz<=Math.floor(z/16)+1;cz++)for(let cx=Math.floor(x/16)-1;cx<=Math.floor(x/16)+1;cx++)
    for(const c of buckets.get(`${cx}:${cz}`)??[])if((x-c.x)**2+(z-c.z)**2<=c.crownRadiusM!**2){hit=true;if(selected.has(c.stableId))transmittance*=1-canopyInstanceWeight(canopyRadiusClass(c.crownRadiusM!),footprint);}
  return{total:Number(hit),visible:1-transmittance};
}
describe('mass preserving shared canopy representation',()=>{
  it('complements overlapping instance alpha, including capped/thinned families, instead of adding two coverages',()=>{
    for(const c of [0,.1,.3,.7,1])for(const v of [0,.02,.1,.4,.8,1]){
      const visible=Math.min(c,v),g=residualCanopyCoverage(c,visible);expect(visible+(1-visible)*g).toBeCloseTo(c,12);
    }
    expect(CANOPY_LINEAR_RGB).toEqual([.055,.105,.036]);
  });
  it('keeps measured mean actual crown coverage within two points through zoom, selection caps and overlap',()=>{
    for(const target of [.15,.55,.9]){
      const trees=candidates(target),selected=new Set(trees.filter(c=>c.rank<.2&&canopySupportsSelection(c,bounds)).map(c=>c.stableId));
      const atlas=buildCanopyAtlas(trees,selected,bounds,{resolution:512});
      let seed=81723;const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return(seed>>>0)/4294967296;};
      const probes=Array.from({length:3000},()=>({x:24+random()*208,z:24+random()*208}));
      for(const footprint of [.1,.5,1.5,3,4,6,9,12,40]){
        let actual=0,composite=0;
        for(const p of probes){const truth=actualVisible(trees,selected,p.x,p.z,footprint),query=sampleCanopyAtlas(atlas,p.x,p.z,footprint,target);
          actual+=truth.total;composite+=truth.visible+(1-truth.visible)*query.residual;}
        expect(Math.abs(composite/probes.length-actual/probes.length),`target=${target}; footprint=${footprint}`).toBeLessThan(.02);
      }
      expect(atlas.candidateTreeCount).toBe(trees.length);expect(atlas.selectedTreeCount).toBe(selected.size);
    }
  });
  it('retains budget-excluded crowns and uses a C1 transition to the analytic mean outside the local query',()=>{
    const trees=candidates(.6),atlas=buildCanopyAtlas(trees,new Set(),bounds,{resolution:256});
    const outside=sampleCanopyAtlas(atlas,-5,120,.5,.6);expect(outside).toEqual({total:.6,visible:0,residual:.6});
    const edge=sampleCanopyAtlas(atlas,0,120,.5,.6),near=sampleCanopyAtlas(atlas,.001,120,.5,.6);
    expect(Math.abs(edge.total-near.total)).toBeLessThan(1e-7);
    expect(atlas.coverage.reduce((a,b)=>a+b,0)).toBeGreaterThan(1000);expect(atlas.selectedCounts.every(v=>v===0)).toBe(true);
    const unsafe=trees.find(c=>!canopySupportsSelection(c,bounds))!;
    expect(()=>buildCanopyAtlas(trees,new Set([unsafe.stableId]),bounds)).toThrow(/halo/);
  });
  it('interpolates visible probabilities after powers, and never interpolates overlap counts',()=>{
    const atlas:CanopyAtlas={version:'canopy-r1',width:2,height:2,originX:0,originZ:0,spacingM:1,bounds:{minX:-1,minZ:-1,maxX:2,maxZ:2},fallbackBlendM:0,
      coverage:new Float32Array([0,1,0,1]),selectedCounts:new Uint16Array([0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0]),candidateTreeCount:2,selectedTreeCount:2};
    const footprint=5/2.125,w=canopyInstanceWeight(0,footprint),sample=sampleCanopyAtlas(atlas,.5,.5,footprint,.5);
    expect(sample.visible).toBeCloseTo(.5*(1-(1-w)**2),12);
    expect(sample.visible).not.toBeCloseTo(w,3);
  });
});
