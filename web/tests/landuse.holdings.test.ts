import {describe,expect,it} from 'vitest';
import {partitionRegion,type FieldNet} from '../src/gen/landuse/fields';
import {Rng} from '../src/gen/core/rng';
import {Noise2D} from '../src/gen/core/noise';
import {polygonArea,bbox} from '../src/gen/core/geom';
import {intersectionS,unionS,mpArea} from '../src/gen/geo/bool';
import type {Polygon} from '../src/gen/types';
const box=(x:number,y:number,w:number,h=w):Polygon=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const net=():FieldNet=>({furlongs:[],ways:[],headlands:[]});
const ctx=(seed:string)=>{const rng=new Rng(seed);return{dirAt:(x:number,y:number)=>.9*Math.sin((x-450)/150)+.6*Math.sin((y-450)/200),slopeAt:()=>0,closeAt:()=>false,noise:new Noise2D(rng.fork('noise')),rng,regular:true};};
const corners=(p:Polygon)=>p.filter((b,i)=>{const a=p[(i+p.length-1)%p.length],c=p[(i+1)%p.length];return Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))>1e-6;}).length;
describe('compact agricultural holdings',()=>{
 it('uses quadrilaterals on flat ground despite a varying direction field and shares minor boundaries without paths',()=>{
  const result=net();partitionRegion(box(0,0,900),[],ctx('flat-holdings'),result);
  expect(result.furlongs.length).toBeGreaterThan(20);
  let total=0,quadrilaterals=0;
  for(const f of result.furlongs){const a=Math.abs(polygonArea(f.outer)),b=bbox(f.outer),w=b.maxX-b.minX,h=b.maxY-b.minY;total+=a;if(corners(f.outer)===4)quadrilaterals+=a;
   expect(Math.min(w,h)).toBeGreaterThanOrEqual(18-1e-6);expect(Math.max(w,h)/Math.min(w,h)).toBeLessThan(3.3);expect(f.strips).toBeUndefined();}
  expect(quadrilaterals/total).toBeGreaterThan(.95);
  expect(total).toBeCloseTo(810000,3);expect(result.headlands).toHaveLength(0);expect(result.ways.length).toBeLessThanOrEqual(2);
 });
 it('keeps thin leftovers as grassy margins rather than ribbon-shaped fields',()=>{
  const result=net();partitionRegion(box(0,0,320,10),[],{...ctx('thin'),dirAt:()=>0},result);
  expect(result.furlongs).toHaveLength(0);expect(result.margins).toHaveLength(1);expect(mpArea(result.margins!)).toBeCloseTo(3200,4);
 });
 it('preserves holes and the complete source area without overlapping holdings',()=>{
  const result=net(),outer=box(0,0,900),hole=box(300,280,65,85);partitionRegion(outer,[hole],{...ctx('hole'),dirAt:()=>0},result);
  const all=[...result.furlongs.map(f=>({outer:f.outer,holes:f.holes})),...(result.margins??[])];
  expect(mpArea(intersectionS(all,hole))).toBeLessThan(.001);
  expect(mpArea(all)).toBeCloseTo(mpArea(unionS(all)),3);expect(mpArea(all)).toBeCloseTo(810000-65*85,3);
 });
});
