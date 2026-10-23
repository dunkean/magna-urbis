import {describe,it,expect} from 'vitest';
import {compileSurfaceWorld} from '../src/surface/compiler';
import {encodeSurfaceBinary} from '../src/surface/binary';
import {generateSurfaceCandidates} from '../src/surface/population';
import {generateSurfaceCandidatePages,validateSurfaceCandidatePages,terrainSampleBounds} from '../src/surface/candidatePages';
import {packCandidateColumns} from '../src/surface/candidateColumns';
import type {SurfaceWorld,TerrainGrid} from '../src/surface/model';

function fixture():SurfaceWorld {
  const n=81,spacingM=50;
  const w=compileSurfaceWorld({seed:114,terrain:{width:n,height:n,spacingM,originX:0,originZ:0,
    heights:Float32Array.from({length:n*n},(_,i)=>100+(i%n)*5+Math.floor(i/n)),source:{id:'actual-heightfield',version:'generation1',nativeSpacingM:50,sourceLOD:0}}});
  // Authored diagnostic forest potential, independent of the source geometry.
  w.fields.treeCover.fill(.35);w.fields.grassCover.fill(.2);w.fields.shrubCover.fill(.1);w.fields.litter.fill(.2);
  return w;
}
const view={minX:1800,minZ:1800,maxX:2200,maxZ:2200};
const identity=(c:any)=>{const{y,...rest}=c;return rest};
describe('complete canonical family pages',()=>{
  it('preserves intersecting legacy identities and canonical fields, and declares independent family extents',()=>{
    const w=fixture(),before=encodeSurfaceBinary({terrain:w.terrain,fields:w.fields});
    const old=generateSurfaceCandidates(w,view,{includeOverhang:true});
    const result=generateSurfaceCandidatePages(w,view,{canonicalContextId:'context'});
    const byid=new Map(result.candidates.map(c=>[c.stableId,c]));
    for(const c of old)expect(byid.get(c.stableId)).toEqual(c);
    expect(Buffer.from(encodeSurfaceBinary({terrain:w.terrain,fields:w.fields})).equals(before)).toBe(true);
    expect(result.candidatePages.tree.bounds).toEqual({minX:1760,minZ:1760,maxX:2240,maxZ:2240});
    expect(result.candidatePages.grass.bounds).toEqual(view);
    expect(result.candidatePages.tree).toMatchObject({complete:true,retention:1,limitedBy:'none',includeOverhang:true});
    validateSurfaceCandidatePages(result.candidatePages,packCandidateColumns(result.candidates));
    result.candidatePages.tree.count++;
    expect(()=>validateSurfaceCandidatePages(result.candidatePages,packCandidateColumns(result.candidates))).toThrow(/count/);
  });
  it('never clamps an outside-tree height to a tiny fine tile, and samples the real parent when available',()=>{
    const w=fixture(),fine:TerrainGrid={...w.terrain,width:5,height:5,originX:1990,originZ:1990,spacingM:5,heights:new Float32Array(25).fill(900)};
    const parent={...w.terrain,heights:Float32Array.from(w.terrain.heights,v=>v+10)};
    const result=generateSurfaceCandidatePages(w,view,{canonicalContextId:'context',fineTerrain:fine,parentTerrain:parent});
    const baseline=generateSurfaceCandidatePages(w,view,{canonicalContextId:'context'}),byid=new Map(baseline.candidates.map(c=>[c.stableId,c]));
    const b=terrainSampleBounds(fine);let outside=0,inside=0;
    for(const c of result.candidates){expect(identity(c)).toEqual(identity(byid.get(c.stableId)));
      if(c.x>=b.minX&&c.x<=b.maxX&&c.z>=b.minZ&&c.z<=b.maxZ){expect(c.y).toBe(900);inside++;}
      else{expect(c.y).toBeCloseTo(byid.get(c.stableId)!.y+10,8);outside++;}
    }
    expect(outside).toBeGreaterThan(100);expect(inside).toBeGreaterThan(0);
    expect(result.candidatePages.support).toMatchObject({fineSampleCount:inside,parentSampleCount:outside,canonicalSampleCount:0});
  });
  it('reduces the declared dense page until its ENTIRE accepted inventory fits the total budget',()=>{
    const w=fixture();w.fields.treeCover.fill(.99);
    const result=generateSurfaceCandidatePages(w,{minX:0,minZ:0,maxX:4000,maxZ:4000},{canonicalContextId:'context',maxCandidates:400,maxCheckedSlots:10000});
    expect(result.candidates.length).toBeLessThanOrEqual(400);
    expect(result.candidatePages.tree.limitedBy).not.toBe('none');
    expect(result.candidatePages.tree.bounds.maxX-result.candidatePages.tree.bounds.minX).toBeLessThan(4000);
    const exact=generateSurfaceCandidates(w,result.candidatePages.tree.bounds,{families:['tree'],includeOverhang:true,maxCandidates:100000,maxCheckedSlots:10000});
    expect(result.candidates.filter(c=>c.family==='tree')).toEqual(exact);
    expect(result.candidatePages.tree.count).toBe(exact.length);
  });
  it('honours cancellation and rejects support from a different source generation',()=>{
    const w=fixture(),signal=AbortSignal.abort();
    expect(()=>generateSurfaceCandidatePages(w,view,{canonicalContextId:'ctx',signal})).toThrow(/abort/i);
    expect(()=>generateSurfaceCandidatePages(w,view,{canonicalContextId:'ctx',fineTerrain:{...w.terrain,source:{...w.terrain.source,version:'other'}}})).toThrow(/source identity/);
  });
  it('rejects a false complete-page count and a stale support generation at the boundary',()=>{
    const w=fixture(),r=generateSurfaceCandidatePages(w,view,{canonicalContextId:'ctx',fineTerrain:w.terrain});
    const columns=packCandidateColumns(r.candidates);validateSurfaceCandidatePages(r.candidatePages,columns,undefined,w);
    r.candidatePages.support.fineBounds!.maxX++;
    expect(()=>validateSurfaceCandidatePages(r.candidatePages,columns,undefined,w)).toThrow(/fine support/);
    r.candidatePages.support.fineBounds!.maxX--;
    r.candidatePages.support.canonicalSource.version='stale';
    expect(()=>validateSurfaceCandidatePages(r.candidatePages,columns,undefined,w)).toThrow(/source mismatch/);
  });
});
