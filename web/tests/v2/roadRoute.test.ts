import { describe, expect, it } from 'vitest';
import { runRoadRoute, runRoadWaypoints, selectRoutedRoad } from '../../src/v2/roadRoute';
import type { RoadOutput, SettlementRaster } from '../../../rust/bridge/settlements';
import type { SettlementEngine } from '../../../rust/bridge/settlementEngine';
const output: RoadOutput = { routes: 1, warnings: [], unreachable: [], lengthByClass: {}, lengthBySurface: {}, ms: 0,
  junctions: [{site:'v2-route-start',point:{x:1,y:1},degree:1},{site:null,point:{x:4,y:5},degree:2},{site:'v2-route-end',point:{x:8,y:1},degree:1}],
  segments: [
    {a:1,b:0,path:[{x:4,y:5},{x:1,y:1}],class:'local',surface:'dirt',profile:'medieval',width:4,crossings:[],length:5,grade:0,importance:1},
    {a:1,b:2,path:[{x:4,y:5},{x:8,y:1}],class:'local',surface:'dirt',profile:'medieval',width:4,crossings:[],length:5,grade:0,importance:1},
  ] };
const roads = {level:'rural' as const,surface:'auto' as const,culture:'auto',density:.7,gradeWeight:4,maxGrade:.2,crossingCost:3,wobble:.5,sharing:.9,exits:{highway:0,main:2,local:2,track:0}};
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
    expect(request?.roads).toMatchObject({density:0,exits:{highway:0,main:0,local:0,track:0},activityAccess:false,networkNodes:false,gradeWeight:4,maxGrade:.2,crossingCost:3,wobble:.5,sharing:.9});
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
  it('routes consecutive waypoints in order, reuses the terrain and retains the exact border coordinates',async()=>{
    const requests:Parameters<SettlementEngine['run']>[0][]=[],points=[{x:0,y:2},{x:4,y:6},{x:10,y:8}];
    const engine:SettlementEngine={run(r){
      requests.push(r);const [a,b]=r.sites!;
      return {id:r.id,roads:{...output,unreachable:[],junctions:[{site:a.key,point:a.center,degree:1},{site:b.key,point:b.center,degree:1}],
        segments:[{...output.segments[0],a:0,b:1,path:[a.center,{x:(a.center.x+b.center.x)/2,y:(a.center.y+b.center.y)/2+1},b.center]}]}};
    }};
    const result=await runRoadWaypoints(engine,raster,roads,'seed','european-organic',points,runtime,'track');
    expect(requests).toHaveLength(2);expect(requests[0].raster).toBe(raster);expect(requests[1].raster).toBeUndefined();
    expect(requests[0].sites?.map(s=>s.center)).toEqual(points.slice(0,2));
    expect(requests[1].sites?.[0].center).toEqual(points[1]);expect(requests[1].sites![1].center.x).toBeLessThan(10);
    expect(requests.every(r=>r.sites?.every(s=>s.population===40))).toBe(true);
    expect(result.controls).toEqual(points);expect(result.controlIndices).toEqual([0,2,4]);
    expect(result.controlIndices.map(i=>result.path[i])).toEqual(points);
  });
  it('rejects the entire waypoint operation if a later leg cannot be routed',async()=>{
    let calls=0;
    const engine:SettlementEngine={run(r){if(calls++)return {id:r.id,error:'blocked leg'};return {id:r.id,roads:output};}};
    await expect(runRoadWaypoints(engine,raster,roads,'seed','european-organic',[{x:1,y:1},{x:8,y:1},{x:9,y:9}],runtime)).rejects.toThrow('blocked leg');
  });
});
