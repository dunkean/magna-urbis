import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isHeadwater,headwaterGeometry,riverBankPath} from './river_headwaters.mjs';
const line=(points,area=5e6)=>({points,area:Array(points.length/2).fill(area),level:Array(points.length/2).fill(10)});
const hydro=()=>({width:1000,n:100,sea:new Uint8Array(10000),lake:new Uint8Array(10000)});
test('Small isolated channel emerges smoothly and recovers downstream width',()=>{
 const l=line([100,100,100,200,100,400,100,600]),widths=[20,20,25,30];
 assert.equal(isHeadwater(l,{rivers:[l]},hydro(),5e6),true);
 const g=headwaterGeometry(l,widths,true);
 assert.equal(g.widths[0],.6);assert.equal(g.reach,200);
 assert.equal(g.widths.at(-1),30);
 assert(g.widths.every((w,i)=>!i||w>=g.widths[i-1]));
 assert(g.widths.length>widths.length);
 assert.deepEqual(g.points.slice(-2),l.points.slice(-2));
 assert.deepEqual(g.levels,Array(g.widths.length).fill(10));
 const path=riverBankPath(g,()=>'<banks>');
 assert(path.includes('a0.300,0.300'));
});
test('Boundary inflows, lake outlets, large sources and confluences keep their widths',()=>{
 let l=line([5,100,100,200]);assert.equal(isHeadwater(l,{rivers:[l]},hydro(),5e6),false);
 l=line([100,100,100,200]);const h=hydro();h.lake[10*100+10]=1;
 assert.equal(isHeadwater(l,{rivers:[l]},h,5e6),false);
 l=line([100,100,100,200],20e6);assert.equal(isHeadwater(l,{rivers:[l]},hydro(),5e6),false);
 l=line([100,100,100,200]);const incoming=line([50,50,100,100]);
 assert.equal(isHeadwater(l,{rivers:[l,incoming]},hydro(),5e6),false);
 const widths=[20,30],g=headwaterGeometry(l,widths,false);
 assert.equal(g.widths,widths);assert.equal(g.points,l.points);
});
test('Short streams regain full width before their junction',()=>{
 const l=line([100,100,100,140,100,180]);const g=headwaterGeometry(l,[20,20,20],true);
 assert.equal(g.reach,48);assert.equal(g.widths.at(-1),20);
 assert(g.widths.every(w=>w<=20));
});
