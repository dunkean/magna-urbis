import { describe, expect, it } from 'vitest';
import { runRoadRoute, selectRoutedRoad } from '../../src/v2/roadRoute';
import type { RoadOutput, SettlementRaster } from '../../../rust/bridge/settlements';
import type { SettlementEngine } from '../../../rust/bridge/settlementEngine';
const output: RoadOutput = { routes: 1, warnings: [], unreachable: [], lengthByClass: {}, lengthBySurface: {}, ms: 0,
  junctions: [{site:'v2-route-start',point:{x:1,y:1},degree:1},{site:null,point:{x:4,y:5},degree:2},{site:'v2-route-end',point:{x:8,y:1},degree:1}],
  segments: [
    {a:1,b:0,path:[{x:4,y:5},{x:1,y:1}],class:'local',surface:'dirt',profile:'medieval',width:4,crossings:[],length:5,grade:0,importance:1},
    {a:1,b:2,path:[{x:4,y:5},{x:8,y:1}],class:'local',surface:'dirt',profile:'medieval',width:4,crossings:[],length:5,grade:0,importance:1},
  ] };
const roads = {level:'rural' as const,surface:'auto' as const,culture:'auto',density:.7,gradeWeight:4,maxGrade:.2,crossingCost:3,wobble:.5,sharing:.9,exits:4};
const raster = { width:10 } as SettlementRaster;
const runtime = { profile:'web' as const,server:'' };
describe('two-point road routing',()=>{
  it('requests just the two endpoints while preserving terrain cost options',async()=>{
    let request: Parameters<SettlementEngine['run']>[0] | undefined;
    const engine: SettlementEngine={run(r){request=r;return {id:r.id,roads:output};}};
    const result=await runRoadRoute(engine,raster,roads,'seed','european-organic',{x:1,y:1},{x:8,y:1},runtime);
    expect(result.path).toEqual([{x:1,y:1},{x:4,y:5},{x:8,y:1}]);
    expect(request?.sites?.map(s=>s.key)).toEqual(['v2-route-start','v2-route-end']);
    expect(request?.sites?.every(s=>s.radius>0 && s.radius<1)).toBe(true);
    expect(request?.roads).toMatchObject({density:0,exits:0,activityAccess:false,networkNodes:false,gradeWeight:4,maxGrade:.2,crossingCost:3,wobble:.5,sharing:.9});
    expect(request?.raster).toBe(raster);
  });
  it('rejects unreachable or disconnected results instead of inventing a line',()=>{
    expect(()=>selectRoutedRoad({...output,unreachable:['v2-route-end']})).toThrow(/No road route/);
    expect(()=>selectRoutedRoad({...output,segments:[output.segments[0]]})).toThrow(/No road route/);
  });
  it('rejects outside and identical endpoints before calling the engine',async()=>{
    const engine: SettlementEngine={run(){throw new Error('should not run');}};
    await expect(runRoadRoute(engine,raster,roads,'seed','european-organic',{x:-1,y:1},{x:8,y:1},runtime)).rejects.toThrow(/inside/);
    await expect(runRoadRoute(engine,raster,roads,'seed','european-organic',{x:1,y:1},{x:1,y:1},runtime)).rejects.toThrow(/different/);
  });
});
