import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../../src/gen/types';
import type { SettlementRequest } from '../../../rust/bridge/settlements';
import { defaultSettings } from '../../src/v2/settings';
import { createRoadRouter } from '../../src/v2/roadRoute';

const held=vi.hoisted(()=>({engines:[] as {requests:SettlementRequest[];dispose:ReturnType<typeof vi.fn>}[]}));
vi.mock('../../../rust/bridge/settlementEngine',()=>({createSettlementEngine:vi.fn(async()=>{
  const engine={requests:[] as SettlementRequest[],dispose:vi.fn(async()=>{}),run(request:SettlementRequest){
    engine.requests.push(request);const [a,b]=request.sites!;
    return {id:request.id,roads:{routes:1,warnings:[],unreachable:[],lengthByClass:{},lengthBySurface:{},ms:0,
      junctions:[{site:a.key,point:a.center,degree:1},{site:b.key,point:b.center,degree:1}],
      segments:[{a:0,b:1,path:[a.center,b.center],class:'local',surface:'dirt',profile:'medieval',width:4,crossings:[],length:100,grade:0,importance:300}]}};
  }};
  held.engines.push(engine);return engine;
})}));
vi.mock('../../src/v2/region',()=>({resampleRegionalRaster:(r:object,n:number)=>({...r,n})}));
vi.mock('../../src/v2/rustUrban',()=>({rustSettlementRaster:()=>({width:6400,n:64})}));

const points=[{x:1000,y:1000},{x:2000,y:2000}];
const world=():World=>({terrain:{},mapSize:6400,stats:{},seed:'context'} as World);
beforeEach(()=>{held.engines.length=0;});

describe('retained editor road terrain',()=>{
  it('varies the seed and terrain cost trade-off while preserving hard slope limits and reusing terrain',async()=>{
    const router=createRoadRouter(),settings=defaultSettings(),w=world();settings.region={resolution:64,roads:{gradeWeight:8,maxGrade:.12,wobble:.4}};
    const first=await router.route(w,settings,points,'local','terrain',1),second=await router.route(w,settings,points,'local','terrain',2);
    expect(first.routingVariant).toBe(1);expect(second.routingVariant).toBe(2);
    expect(held.engines).toHaveLength(1);const [a,b]=held.engines[0].requests;
    expect(a.seed).not.toBe(b.seed);expect(a.roads?.gradeWeight).not.toBe(b.roads?.gradeWeight);
    expect(a.roads?.maxGrade).toBe(.12);expect(b.roads?.maxGrade).toBe(.12);expect(b.roads?.gradeWeight).toBeLessThanOrEqual(10);
    expect(b.raster).toBeUndefined();await router.dispose();
  });
  it('reuses the engine and sends the raster once for successive routes and cloned worlds with the same token',async()=>{
    const router=createRoadRouter(),settings=defaultSettings(),w=world();settings.region={resolution:64};
    await router.route(w,settings,points,'local','terrain-1');
    await router.route(structuredClone(w),settings,[...points,{x:3000,y:1000}],'track','terrain-1');
    expect(held.engines).toHaveLength(1);expect(held.engines[0].requests).toHaveLength(3);
    expect(held.engines[0].requests.map(r=>!!r.raster)).toEqual([true,false,false]);
    await router.dispose();expect(held.engines[0].dispose).toHaveBeenCalledOnce();
  });
  it('invalidates missing-key fixtures by object identity, and explicit tokens by revision, resolution and runtime',async()=>{
    const router=createRoadRouter(),settings=defaultSettings(),w=world();settings.region={resolution:64};
    await router.route(w,settings,points);await router.route(w,settings,points);
    expect(held.engines).toHaveLength(1);
    await router.route(world(),settings,points);expect(held.engines).toHaveLength(2);
    await router.route(w,settings,points,'local','token');expect(held.engines).toHaveLength(3);
    w.stats['v2.waterEditRevision']=1;await router.route(w,settings,points,'local','token');expect(held.engines).toHaveLength(4);
    settings.region.resolution=128;await router.route(w,settings,points,'local','token');expect(held.engines).toHaveLength(5);
    settings.runtime={backend:'native',compute:'cpu',source:'procedural',localServer:'http://127.0.0.1:8791'};
    await router.route(w,settings,points,'local','token');expect(held.engines).toHaveLength(6);
    settings.runtime.localServer='http://127.0.0.1:8792';
    await router.route(w,settings,points,'local','token');expect(held.engines).toHaveLength(7);
    for(const engine of held.engines.slice(0,-1))expect(engine.dispose).toHaveBeenCalledOnce();
    await router.dispose();await expect(router.route(w,settings,points)).rejects.toMatchObject({name:'AbortError'});
  });
});
