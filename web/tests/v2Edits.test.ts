import { describe, expect, it } from 'vitest';
import { applyBuildingEdits, buildingAt, buildingSignature, validateBuildingPatch, type BuildingEdit } from '../src/v2/edits';
import type { World, UrbanBuilding } from '../src/gen/types';
import {pointInRing} from '../src/gen/geo/poly';

const house:UrbanBuilding={poly:[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20}],kind:'house',storeys:1,roof:'gable'};
function fixture():World{return {urban:{buildings:[structuredClone(house)]},settlements:[{key:'main',main:true},{key:'village:0',urban:{buildings:[{...structuredClone(house),poly:house.poly.map(p=>({x:p.x+100,y:p.y}))}]}}]} as unknown as World;}
describe('V2 local edits',()=>{
  it('picks the actual building footprint in main and secondary settlements',()=>{
    const w=fixture();expect(buildingAt(w,{x:15,y:15})?.settlement).toBe('main');expect(buildingAt(w,{x:115,y:15})?.settlement).toBe('village:0');expect(buildingAt(w,{x:45,y:45})).toBeNull();
  });
  it('applies overrides without mutating the canonical world or neighbouring town',()=>{
    const w=fixture(),edit:BuildingEdit={type:'building',settlement:'main',index:0,signature:buildingSignature(house),patch:{storeys:4,roof:'hip'}};
    const result=applyBuildingEdits(w,[edit]);expect(result.applied).toBe(1);expect(result.world.urban!.buildings[0].storeys).toBe(4);expect(w.urban!.buildings[0].storeys).toBe(1);expect(result.world.settlements![1].urban).toEqual(w.settlements![1].urban);
  });
  it('does not move an override onto a different regenerated building with the same index',()=>{
    const w=fixture(),edit:BuildingEdit={type:'building',settlement:'main',index:0,signature:'old footprint',patch:{storeys:9}};
    const result=applyBuildingEdits(w,[edit]);expect(result.skipped).toBe(1);expect(result.world.urban!.buildings[0].storeys).toBe(1);
  });
  it('keeps terrain by reference and follows native identity when projection order changes',()=>{
    const w=fixture();Object.assign(w.urban!.buildings[0],{nativeId:'stable-house'});w.urban!.buildings.unshift({...structuredClone(house),poly:house.poly.map(p=>({x:p.x+30,y:p.y}))});
    const result=applyBuildingEdits(w,[{type:'building',settlement:'main',index:0,nativeId:'stable-house',signature:buildingSignature(house),patch:{storeys:4}}]);
    expect(result.world.terrain).toBe(w.terrain);expect(result.world.urban!.buildings[1].storeys).toBe(4);expect(result.world.urban!.buildings[0].storeys).toBe(1);
  });
  it('rejects invalid heights and invalid imported geometry before rendering',()=>{
    expect(()=>validateBuildingPatch({height:Infinity})).toThrow();expect(()=>validateBuildingPatch({poly:[{x:NaN,y:2}]})).toThrow();expect(()=>validateBuildingPatch({roof:'invented'})).toThrow();
  });
  it('indexes dense scenes without changing overlap, hole or boundary picking',()=>{
    const buildings=Array.from({length:400},(_,i)=>({...house,poly:house.poly.map(p=>({x:p.x+(i%20)*30+99999.00001,y:p.y+Math.floor(i/20)*30}))}));
    buildings.push({...buildings[15],courtyards:[buildings[15].poly.map(p=>({x:(p.x+buildings[15].poly[0].x+10)/2,y:(p.y+buildings[15].poly[0].y+10)/2}))]});
    const w={urban:{buildings}}as unknown as World;
    let state=8127;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
    for(let i=0;i<500;i++){
      const p={x:99990+random()*630,y:random()*630};let expected=-1;
      for(let k=buildings.length-1;k>=0;k--)if(pointInRing(buildings[k].poly,p)&&!buildings[k].courtyards?.some(h=>pointInRing(h,p))){expected=k;break;}
      expect(buildingAt(w,p)?.index??-1).toBe(expected);
    }
    for(const p of buildings[15].poly){let expected=-1;for(let k=buildings.length-1;k>=0;k--)if(pointInRing(buildings[k].poly,p)&&!buildings[k].courtyards?.some(h=>pointInRing(h,p))){expected=k;break;}expect(buildingAt(w,p)?.index??-1).toBe(expected);}
  });
  it('rebuilds the picker for a new edited geometry snapshot and preserves the old one',()=>{
    const buildings=Array.from({length:150},(_,i)=>({...house,poly:house.poly.map(p=>({x:p.x+i*30,y:p.y}))}));
    const w={urban:{buildings}}as unknown as World;expect(buildingAt(w,{x:15,y:15})?.index).toBe(0);
    const edited=applyBuildingEdits(w,[{type:'building',settlement:'main',index:0,signature:buildingSignature(buildings[0]),patch:{poly:buildings[0].poly.map(p=>({x:p.x,y:p.y+100}))}}]).world;
    expect(buildingAt(edited,{x:15,y:15})).toBeNull();expect(buildingAt(edited,{x:15,y:115})?.index).toBe(0);expect(buildingAt(w,{x:15,y:15})?.index).toBe(0);
  });
});
