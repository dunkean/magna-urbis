import {describe,expect,it} from 'vitest';
import type {World,UrbanLayer} from '../../src/gen/types';
import type {Layout} from '../../../rust/bridge/urban';
import {roadAffectedTowns,roadTownNeedsChoice,rebuildTownRoadAccesses} from '../../src/v2/roadTownAccess';
import {defaultSettings} from '../../src/v2/settings';

const p=(x:number,y:number)=>({x,y});
function fixture():World{
  const shape={outer:[p(100,100),p(300,100),p(300,300),p(100,300)],holes:[]};
  const inner={path:[p(100,200),p(200,200),p(300,200)],widths:[5,5,5],rank:1,role:'street'};
  const approach={path:[p(300,200),p(450,200),p(600,200)],widths:[5,5,5],rank:1,role:'approach'};
  const layout={key:'main',center:p(200,200),culture:'european-organic',quarters:[{shape,phase:0}],streets:[inner,approach],blocks:[],warnings:[]} as Layout;
  const urban={streets:[],buildings:[{kept:true}],parcels:[{kept:true}],quarters:[{poly:shape,phase:0}]} as unknown as UrbanLayer;
  const grid={w:100,h:100,cell:10,data:new Float32Array(10000).fill(20)};
  return {seed:'access',mapSize:1000,options:{},stats:{},urban,settlements:[{key:'main',main:true,population:100,culture:'european-organic',center:p(200,200),radius:120,extent:shape.outer,urban},
    {key:'far',population:100,culture:'european-organic',center:p(900,900),radius:20,extent:[p(880,880),p(920,920)],urban}],
    roads:[{kind:'major',width:5,path:[p(200,200),p(700,200)]}],bridges:[],
    terrain:{height:grid,slope:grid,flow:grid,filled:grid.data,water:new Uint8Array(10000),rivers:[],lakes:[],coastline:[],seaLevel:0},
    debug:{v2RustCities:{main:{backend:'rust-wasm-cpu',stage:'buildings',layouts:[layout],scene:{buildings:[{kept:true}]},buildingIds:['house'],layoutKey:'original',warnings:[]}}}} as unknown as World;
}
describe('town updates after a road edit',()=>{
  it('does not ask to rebuild a town for a distant change on a road sharing its endpoint',()=>{
    const before=fixture();before.roads![0].path=[p(200,200),p(500,200),p(700,200)];
    const next={...before,roads:[{...before.roads![0],path:[p(200,200),p(500,200),p(700,400)]}]};
    expect(roadAffectedTowns(before,next)).toEqual([]);
  });
  it('asks for hamlets and larger places, and never for farms or isolated buildings',()=>{
    const w=fixture();expect(roadTownNeedsChoice(w,'main')).toBe(true);
    w.settlements![0].population=10;expect(roadTownNeedsChoice(w,'main')).toBe(false);
    w.settlements![0].population=100;w.settlements![0].detail='farmstead';expect(roadTownNeedsChoice(w,'main')).toBe(false);
  });
  it('only selects nearby built towns affected by changed road geometry',()=>{
    const before=fixture();expect(roadAffectedTowns(before,{...before})).toEqual([]);
    const next={...before,roads:[{...before.roads![0],path:[p(200,200),p(700,400)]}]};
    expect(roadAffectedTowns(before,next)).toEqual(['main']);
  });
  it('routes an approach onto the new network while retaining houses, parcels, inner streets and the other town',async()=>{
    const before=fixture(),next={...before,roads:[{...before.roads![0],path:[p(200,200),p(700,400)]}]};
    const original=structuredClone(before),requests:{points:unknown}[]=[];
    const result=await rebuildTownRoadAccesses(next,defaultSettings(),['main'],async(w,_s,points)=>{
      requests.push({points});expect(w.terrain.water[15*100+15]).toBe(1);
      return [points[0],p(420,210),points[1]];
    });
    const old=(before.debug!.v2RustCities as any).main,snapshot=(result.debug!.v2RustCities as any).main;
    expect(requests).toHaveLength(1);expect(snapshot.layouts[0].streets[0]).toBe(old.layouts[0].streets[0]);
    expect(snapshot.layouts[0].streets[1].path.at(-1).y).toBeGreaterThan(200);
    expect(snapshot.scene).toBe(old.scene);expect(result.urban!.buildings).toBe(before.urban!.buildings);expect(result.urban!.parcels).toBe(before.urban!.parcels);
    expect(result.settlements![1]).toBe(before.settlements![1]);expect(result.terrain).toBe(before.terrain);expect(before).toEqual(original);
  });
  it('removes the external approach when its network is deleted, without inventing an access',async()=>{
    const w=fixture(),result=await rebuildTownRoadAccesses({...w,roads:[]},defaultSettings(),['main'],async()=>{throw new Error('no route');});
    expect((result.debug!.v2RustCities as any).main.layouts[0].streets.map((s:any)=>s.role)).toEqual(['street']);
    expect(result.urban!.buildings).toBe(w.urban!.buildings);
  });
  it('replaces only the crossing belonging to a rerouted external access',async()=>{
    const w=fixture(),old={path:[p(400,200),p(420,200)],widths:[5,5],role:'bridge',rank:1};
    (w.debug!.v2RustCities as any).main.layouts[0].streets.push(old);
    w.debug!.v2TownBridges={main:[{a:old.path[0],b:old.path[1],width:5}]};w.debug!.v2BaseBridges=[];
    const next={...w,roads:[{...w.roads![0],path:[p(200,200),p(700,400)]}]};
    const crossing={kind:'bridge' as const,path:[p(410,220),p(440,225)],river:0};
    const result=await rebuildTownRoadAccesses(next,defaultSettings(),['main'],async(_w,_s,points)=>({path:[points[0],p(420,230),points[1]],crossings:[crossing] as any}));
    const streets=(result.debug!.v2RustCities as any).main.layouts[0].streets;
    expect(streets.filter((s:any)=>s.role==='bridge').map((s:any)=>s.path)).toEqual([crossing.path]);
    expect(result.bridges).toEqual([{a:crossing.path[0],b:crossing.path[1],width:5}]);
  });
});
