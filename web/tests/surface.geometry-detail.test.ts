import { describe,expect,it } from 'vitest';
import { deriveSurfaceGeometryDetail,sampleSurfaceGeometryDetail } from '../src/surface/geometryDetail';
import { compileSurfaceWorld,retargetSurfaceWorld } from '../src/surface/compiler';
import { generateSurfaceCandidates } from '../src/surface/population';
import { createTiltedStrataScenario,geologyFromScenario } from '../src/surface/geologyScenario';
import type { SurfaceCandidate,TerrainGrid } from '../src/surface/model';

function grid(n:number,spacingM:number,originX:number,originZ:number,height:(x:number,z:number)=>number):TerrainGrid {
  return {width:n,height:n,originX,originZ,spacingM,heights:Float32Array.from({length:n*n},(_,i)=>height(originX+i%n*spacingM,originZ+Math.floor(i/n)*spacingM)),
    source:{id:'explicit-unit-height-source',version:'v1',sourceLOD:-4,nativeSpacingM:spacingM}};
}
describe('local geometry detail separated from environmental context',()=>{
  it('recovers physical plane slope, downslope aspect and unit normal including one-sided source edges',()=>{
    const t=grid(17,.5,0,0,(x,z)=>100+.3*x-.4*z),bytes=new Uint8Array(t.heights.buffer).slice(),detail=deriveSurfaceGeometryDetail(t);
    for(let i=0;i<t.heights.length;i++){
      expect(detail.slopeRadians[i]).toBeCloseTo(Math.atan(.5),4);
      expect(detail.normalXYZ[i*3]).toBeCloseTo(-.3/Math.sqrt(1.25),4);expect(detail.normalXYZ[i*3+1]).toBeCloseTo(1/Math.sqrt(1.25),4);
    }
    const point=sampleSurfaceGeometryDetail(detail,3.25,3.75);
    expect(point.aspectRadians).toBeCloseTo(Math.atan2(.4,-.3),5);expect(point.edgeConfidence).toBe(1);expect(detail.edgeConfidence[0]).toBe(0);
    expect(new Uint8Array(t.heights.buffer)).toEqual(bytes);expect(detail.statistics.minimumHeightM).toBeCloseTo(96.8,4);
  });
  it('responds to genuine fine geometry while canonical soil, cover, material classes and candidate marks remain fixed',()=>{
    const canonical=grid(9,1,0,0,()=>100),world=compileSurfaceWorld({seed:91,terrain:canonical}),before=world.fields.sand.slice();
    const fine=grid(65,.125,0,0,x=>100+.25*Math.sin(2*Math.PI*x));fine.source.nativeSpacingM=.25;
    const patch=retargetSurfaceWorld(world,fine),detail=deriveSurfaceGeometryDetail(fine,{canonicalContextId:world.id});
    const i=16*65+16;expect(patch.fields.slope[i]).toBeCloseTo(0);expect(detail.slopeRadians[i]).toBeCloseTo(Math.PI/4,4);
    expect(detail.rockExposurePotential[i]).toBeGreaterThan(.5);expect(world.fields.sand).toEqual(before);
    const bounds={minX:1,minZ:1,maxX:7,maxZ:7},marks=(c:SurfaceCandidate)=>({id:c.stableId,x:c.x,z:c.z,rank:c.rank,variant:c.variant});
    expect(generateSurfaceCandidates(patch,bounds).map(marks)).toEqual(generateSurfaceCandidates(world,bounds).map(marks));
    expect(detail.canonicalContextId).toBe(world.id);expect(detail.limitations.some(v=>v.includes('not observed bedrock'))).toBe(true);
  });
  it('matches padded overlapping tiles and a translation by 20Mm without using FP32 absolute positions',()=>{
    const f=(x:number,z:number)=>20+.2*x+.1*z+Math.sin(x/3),a=grid(33,.5,0,0,f),b=grid(25,.5,4,2,f);
    const da=deriveSurfaceGeometryDetail(a,{supportM:1}),db=deriveSurfaceGeometryDetail(b,{supportM:1});
    for(let z=4;z<=10;z++)for(let x=6;x<=12;x++){
      const aa=sampleSurfaceGeometryDetail(da,x,z),bb=sampleSurfaceGeometryDetail(db,x,z);
      expect(aa.normalXYZ).toEqual(bb.normalXYZ);expect(aa.rockExposurePotential).toEqual(bb.rockExposurePotential);
    }
    const moved={...a,originX:20000000,originZ:-10000000};
    expect(deriveSurfaceGeometryDetail(moved,{supportM:1}).normalXYZ).toEqual(da.normalXYZ);
  });
  it('keeps source kernel/support/version explicit and rejects undersupported, nonfinite or oversized input',()=>{
    const t=grid(17,1,0,0,(x,z)=>x*x+z),cubic={...t,reconstruction:'cubic-bspline-controls' as const};
    const detail=deriveSurfaceGeometryDetail(cubic,{supportM:1});expect(detail.reconstruction).toBe('cubic-bspline-controls');
    expect(detail.fullSupportBounds?.minX).toBe(3);expect(sampleSurfaceGeometryDetail(detail,5,5).slopeRadians).toBeCloseTo(Math.atan(Math.hypot(10,1)),5);
    t.source.nativeSpacingM=2;expect(()=>deriveSurfaceGeometryDetail(t,{supportM:1})).toThrow(/nativeSpacingM/);
    expect(()=>deriveSurfaceGeometryDetail(t,{memoryBudgetBytes:1})).toThrow(/before allocation/);
    const before=deriveSurfaceGeometryDetail(t).id;t.source.version='v2';expect(deriveSurfaceGeometryDetail(t).id).not.toBe(before);
    expect(()=>sampleSurfaceGeometryDetail(detail,-1,1)).toThrow(/actual sample support/);
    const controller=new AbortController();controller.abort();expect(()=>deriveSurfaceGeometryDetail(t,{signal:controller.signal})).toThrow(/abort/i);
    t.heights[5]=NaN;expect(()=>deriveSurfaceGeometryDetail(t)).toThrow(/Non-finite/);
  });
  it('vetoes only fully supported extreme cliffs and leaves uncertain edges and candidate inventory alone',()=>{
    const t=grid(9,1,0,0,x=>3*x),detail=deriveSurfaceGeometryDetail(t);
    expect(detail.treeSupport[4*9+4]).toBe(0);expect(detail.treeSupport[4*9]).toBe(1);
    expect(detail.bedrockExposure[4*9+4]).toBe(1);expect(detail.bedrockExposure[4*9]).toBe(0);
    expect(sampleSurfaceGeometryDetail(detail,4,4).treeSupport).toBe(false);
    expect(sampleSurfaceGeometryDetail(detail,.25,4).treeSupport).toBe(true);
    expect(deriveSurfaceGeometryDetail(grid(9,1,0,0,x=>2*x)).treeSupport[4*9+4]).toBe(1); // 63.4deg
  });
  it('evaluates local bedrock only from an explicit retained scenario and actual source height',()=>{
    const t=grid(9,1,0,0,(x,z)=>x-z),scenario=createTiltedStrataScenario({originX:4,originZ:4,basalContactElevationM:0,dipRadians:0});
    expect(deriveSurfaceGeometryDetail(t).localBedrockUnitId).toBeUndefined();
    const detail=deriveSurfaceGeometryDetail(t,{geologyScenario:scenario});
    expect(detail.localBedrockUnitId).toEqual(geologyFromScenario(t,scenario).bedrock);expect(detail.geologyScenario).toEqual(scenario);
    expect(sampleSurfaceGeometryDetail(detail,2,4).localBedrockUnitId).toBe(1);expect(sampleSurfaceGeometryDetail(detail,6,4).localBedrockUnitId).toBe(3);
  });
});
