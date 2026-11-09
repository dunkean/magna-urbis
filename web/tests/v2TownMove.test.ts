import { describe,it,expect } from 'vitest';
import { moveTown } from '../src/v2/townMove';
import type { World } from '../src/gen/types';
const poly=[{x:100,y:100},{x:200,y:100},{x:200,y:200},{x:100,y:200}];
function fixture():World{
  const grid={w:20,h:20,cell:50,data:new Float32Array(400).fill(10)};
  const urban={footprint:[poly],quarters:[{poly:{outer:poly,holes:[]}}],buildings:[{poly,orientation:1,kind:'house'}],walls:[{gateInfo:[{p:{x:150,y:100},dir:{x:1,y:0}}]}]};
  return {mapSize:1000,terrain:{height:grid,water:new Uint8Array(400),rivers:[]},urban,
    settlements:[{key:'main',main:true,center:{x:150,y:150},radius:60,extent:poly,region:poly,urban},{key:'other',center:{x:850,y:850},radius:20,extent:poly}],
    roads:[{path:[{x:150,y:150},{x:500,y:400}],kind:'minor',width:4}],stats:{},
    names:{entries:[{id:'town',kind:'town',text:'Town',anchor:{x:150,y:150}},{id:'quarter',kind:'quarter',text:'Quarter',anchor:{x:125,y:125}},{id:'river',kind:'river',text:'River',anchor:{x:125,y:125}}]},
  } as unknown as World;
}
describe('direct town movement',()=>{
  it('moves the built plan, attached road end and local names, preserving terrain, vectors and other cities',()=>{
    const source=fixture(),next=moveTown(source,'main',{x:350,y:350});
    expect(next.settlements![0].center).toEqual({x:350,y:350});
    expect(next.urban!.buildings[0].poly[0]).toEqual({x:300,y:300});
    expect(next.urban!.walls![0].gateInfo![0].dir).toEqual({x:1,y:0});
    expect(next.roads![0].path).toEqual([{x:350,y:350},{x:500,y:400}]);
    expect(next.names!.entries[1].anchor).toEqual({x:325,y:325});
    expect(next.names!.entries[2].anchor).toEqual({x:125,y:125});
    expect(next.terrain).toBe(source.terrain);expect(next.settlements![1]).toBe(source.settlements![1]);
    expect(source.urban!.buildings[0].poly[0]).toEqual({x:100,y:100});
  });
  it('translates native cadastral geometry without altering local axes or opaque house plans',()=>{
    const source=fixture(),resolved={format:'compact-plan-1',localPoint:{x:1,y:2}};
    const b={id:'house',transform:{origin:{x:150,y:150}},footprint:[{outer:poly,holes:[]}],roof_footprint:[],courtyards:[],circulation:[],entrance:{x:150,y:150},volumes:[],structural_features:[],resolved};
    source.debug={v2RustCities:{main:{layouts:[{center:{x:150,y:150},quarters:[]}],partitions:[{parcels:[{axis:{x:1,y:0},shape:{outer:poly,holes:[]}}]}],scene:{buildings:[b],open_spaces:[]}}}};
    const next=moveTown(source,'main',{x:350,y:350}),city=(next.debug!.v2RustCities as any).main;
    expect(city.layouts[0].center).toEqual({x:350,y:350});
    expect(city.partitions[0].parcels[0].axis).toEqual({x:1,y:0});
    expect(city.scene.buildings[0].transform.origin).toEqual({x:350,y:350});
    expect(city.scene.buildings[0].resolved).toBe(resolved);
  });
});
