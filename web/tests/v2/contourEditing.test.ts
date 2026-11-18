import {describe,it,expect} from 'vitest';
import {copyContour,contourProblem,insertContourPoint,translateContour,removeContourSelection,splitContour} from '../../src/v2/contourGeometry';
import {settingsForContourEdit,contourAt,controlledContour,type ContourTarget} from '../../src/v2/contourEdits';
import {defaultSettings} from '../../src/v2/settings';
import {mpArea} from '../../src/gen/geo/bool';
import type {Shape} from '../../../rust/bridge/urban';
const p=(x:number,y:number)=>({x,y});
const square:Shape={outer:[p(0,0),p(100,0),p(100,100),p(0,100)],holes:[]};
const target=(kind:ContourTarget['kind']):ContourTarget=>({kind,id:'0',index:0,town:'main',shape:square,layout:{key:'main'} as any,name:'Main'});

describe('common contour operations',()=>{
  it('inserts a control on the chosen edge without changing the area',()=>{
    const next=insertContourPoint(square,p(50,1));expect(next.shape.outer).toHaveLength(5);expect(next.shape.outer[1]).toEqual(p(50,0));
    expect(next.selection).toEqual({kind:'point',ring:0,index:1});expect(mpArea([next.shape])).toBe(mpArea([square]));expect(square.outer).toHaveLength(4);
    expect(insertContourPoint(square,p(0,0)).shape).toBe(square);
  });
  it('keeps an inserted collinear control independently of native polygon simplification',()=>{
    const controls=insertContourPoint(square,p(50,0)).shape;
    expect(controlledContour(square,controls).outer).toHaveLength(5);
    const clipped=translateContour(square,{kind:'point',ring:0,index:0},20,20);
    expect(controlledContour(clipped,controls)).toBe(clipped);
  });
  it('moves both ends of the closing segment and keeps the ring closed',()=>{
    const next=translateContour(square,{kind:'segment',ring:0,index:3},10,20);
    expect(next.outer).toEqual([p(10,20),p(100,0),p(100,100),p(10,120)]);expect(contourProblem(next)).toBeUndefined();
  });
  it('moves an entire contour together with its courtyards',()=>{
    const shape={...square,holes:[[p(10,10),p(20,10),p(20,20),p(10,20)]]};
    const next=translateContour(shape,{kind:'line'},10,15);expect(next.outer[0]).toEqual(p(10,15));expect(next.holes[0][0]).toEqual(p(20,25));expect(shape.holes[0][0]).toEqual(p(10,10));
  });
  it('retensions a removed point, and propagates deletion of an undersized ring',()=>{
    const trimmed=removeContourSelection(square,{kind:'point',ring:0,index:0})!;expect(trimmed.outer).toHaveLength(3);expect(contourProblem(trimmed)).toBeUndefined();
    expect(removeContourSelection(trimmed,{kind:'point',ring:0,index:0})).toBeUndefined();expect(removeContourSelection(square,{kind:'line'})).toBeUndefined();
  });
  it('splits between non-adjacent boundary points into two valid closed surfaces without losing land',()=>{
    const halves=splitContour(square,0,2);expect(halves.map(h=>h.outer.length)).toEqual([3,3]);expect(halves.every(h=>!contourProblem(h))).toBe(true);
    expect(mpArea(halves)).toBe(mpArea([square]));expect(()=>splitContour(square,0,1)).toThrow(/non-adjacent/);
  });
  it('preserves a courtyard on its half and refuses a cut through it',()=>{
    const shape={...square,holes:[[p(10,50),p(20,50),p(20,60),p(10,60)]]};
    const halves=splitContour(shape,0,2);expect(halves.flatMap(h=>h.holes)).toEqual(shape.holes);expect(mpArea(halves)).toBe(mpArea([shape]));
    shape.holes=[[p(40,40),p(60,40),p(60,60),p(40,60)]];expect(()=>splitContour(shape,0,2)).toThrow(/courtyard/);
  });
  it('rejects invalid preview geometry instead of applying it',()=>{
    const shape=copyContour(square);shape.outer=[p(0,0),p(100,100),p(100,0),p(0,100)];expect(contourProblem(shape)).toMatch(/intersection/);
  });
  it('retains native sub-square-metre holes without blocking outer controls',()=>{
    const shape={...square,holes:[[p(10,10),p(10.01,10),p(10.01,10.01),p(10,10.01)]]};
    const inserted=insertContourPoint(shape,p(50,0));expect(contourProblem(inserted.shape)).toBeUndefined();expect(inserted.shape.holes).toEqual(shape.holes);
  });
});
describe('native contour edit recipes',()=>{
  it.each(['quarter','block','parcel'] as const)('keeps independent settings when changing a %s outline',kind=>{
    const s=defaultSettings();s.urban={backend:'rust',local:{main:kind==='quarter'?{layout:{overrides:{quarters:{'0':{role:'market',salt:3}}}}}:{parcels:{overrides:kind==='block'?{blocks:{'0':{role:'market',salt:3}}}:{parcels:{'0':{role:'market',salt:3}}}}}}};
    const original=structuredClone(s),next=settingsForContourEdit(s,{target:target(kind),shape:square}),local=next.urban!.local!.main;
    const patch=kind==='quarter'?local.layout!.overrides!.quarters!['0']:kind==='block'?local.parcels!.overrides!.blocks!['0']:local.parcels!.overrides!.parcels!['0'];
    expect(patch).toMatchObject({role:'market',salt:3,shape:square});expect(s).toEqual(original);
  });
  it('prefers a boundary hit and then the smallest containing area',()=>{
    const outer=target('parcel'),inner={...outer,id:'1',shape:{outer:[p(10,10),p(20,10),p(20,20),p(10,20)],holes:[]}};
    expect(contourAt([outer,inner],p(15,15),1)).toBe(inner);expect(contourAt([outer,inner],p(0,50),1)).toBe(outer);
  });
  it.each(['quarter','block','parcel'] as const)('keeps siblings when editing or splitting an existing %s part',kind=>{
    const halves=splitContour(square,0,2),s=defaultSettings(),t={...target(kind),sourceId:'0',part:0};
    const first=settingsForContourEdit(s,{target:t,parts:halves});
    const changed=translateContour(halves[0],{kind:'point',ring:0,index:1},-1,1);
    const next=settingsForContourEdit(first,{target:t,shape:changed}),local=next.urban!.local!.main;
    const entries=kind==='quarter'?local.layout!.overrides!.quarters!:kind==='block'?local.parcels!.overrides!.blocks!:local.parcels!.overrides!.parcels!;
    expect(entries['0']).toMatchObject({parts:[changed,halves[1]]});expect(entries['0'].shape).toBeUndefined();
    const deleted=settingsForContourEdit(first,{target:t}),d=deleted.urban!.local!.main;
    const patch=kind==='quarter'?d.layout!.overrides!.quarters!['0']:kind==='block'?d.parcels!.overrides!.blocks!['0']:d.parcels!.overrides!.parcels!['0'];
    expect(patch.parts).toEqual(halves);expect(kind==='parcel'?patch.deleted:(patch as any).deletedParts).toEqual(kind==='parcel'?'merge':[0]);
  });
});
