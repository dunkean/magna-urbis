import test from 'node:test';
import assert from 'node:assert/strict';
import {createDetailRaceSampler,detailGaussianC2,reanchorDetailMean} from '../src/surface/detailDistribution.ts';
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} versus ${b}`);
test('positive C2 field is finite and value/derivative continuous across lattice boundaries',()=>{
  for(const field of [17,20,68,199])for(const x of [-13,0,1,173])for(const z of [.17,.5,.93]){
    const f=v=>detailGaussianC2(v,z,0,0,0,0,field),h=1e-5;
    near(f(x-h),f(x+h),.0001);
    near((f(x)-f(x-h))/h,(f(x+h)-f(x))/h,.0001);
    assert.ok(Number.isFinite(f(x)));
  }
});
test('hard races retain empty/full/bare support, exact unresolved fractions and input arrays',()=>{
  const sample=createDetailRaceSampler(1905266606),p=Object.freeze([.21862031280994412,.7813796871900559]);
  assert.deepEqual(sample([0,0],3,7,.01),[0,0]);
  assert.deepEqual(sample([0,1,0],3,7,.01),[0,1,0]);
  assert.deepEqual(sample(p,3,7,3),p);
  assert.deepEqual(sample([.2,.3],3,7,3),[.2,.3]);
  for(const fp of [0,.01,.1,.3,1.4,3]){
    const a=sample(p,3,7,fp);near(a.reduce((x,y)=>x+y,0),1,1e-14);
    const low=sample([.2,.21],3,7,fp);assert.ok(low.every(v=>v>=0)&&low.reduce((x,y)=>x+y,0)<=1+1e-14);
  }
  assert.throws(()=>sample([.8,.5],0,0,0));assert.throws(()=>sample([NaN],0,0,0));
  assert.throws(()=>sample([.5],NaN,0,0));assert.throws(()=>sample([.5],0,0,-1));
});
test('recipe-specific independent channels and void preserve conditional fractions over seeds',()=>{
  const configurations=[
    {name:'retained-ground40m',p:[.21862031280994412,.7813796871900559],channels:[0,1]},
    {name:'authored-low-cover41percent',p:[.19,.2212052395939827],channels:[45,50]},
    {name:'authored8recipe-extreme',p:[.0001,.0199,.2,.34,.215,.08,.1,.045],channels:[0,1,2,3,4,5,6,7]},
  ];
  const n=8192,fp=.02,stats=configurations.map(c=>({...c,sum:c.p.map(()=>0),square:c.p.map(()=>0)}));let seed=716512;
  for(let k=0;k<n;k++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const sampler=createDetailRaceSampler(seed);
    for(const c of stats){const out=sampler(c.p,.371,.619,fp,c.channels);out.forEach((v,i)=>{c.sum[i]+=v;c.square[i]+=v*v;});}
  }
  for(const c of stats){
    const rows=c.p.map((target,i)=>{const mean=c.sum[i]/n,error=Math.abs(mean-target),sem95=1.96*Math.sqrt(Math.max(0,c.square[i]/n-mean*mean)/n);assert.ok(error<.02);return{target,mean,error,sem95};});
    console.log(JSON.stringify({test:'C2-hard-race-conditional-ensemble',name:c.name,n,footprintM:fp,maximumError:Math.max(...rows.map(v=>v.error)),maximumErrorPlusPointwise95:Math.max(...rows.map(v=>v.error+v.sem95)),rows,assumption:'ideal independent Gaussian field/seed ensemble; measured deterministic hashes, not exact mass in realised cells'}));
  }
});
test('floating-origin reconstruction remains stable, with explicit hard-boundary float precision scope',()=>{
  const p=[.2,.5,.3],zero=createDetailRaceSampler(1905266606),shift=createDetailRaceSampler(1905266606,1e9,-1e9);let differing=0;
  for(let i=0;i<256;i++){
    const x=1e9+((i*73)%256)*.071,z=-1e9+((i*47)%256)*.093;
    const a=zero(p,x,z,.02),b=shift(p,x-1e9,z+1e9,.02);
    if(a.some((v,k)=>Math.abs(v-b[k])>1e-12))differing++;
  }
  assert.ok(differing<=2,`hard boundaries changed at ${differing}/256 probes under F32 phase transport`);
  console.log(JSON.stringify({test:'race-origin-1e9',probes:256,differing,scope:'finite float32 phase transport; discontinuous categorical boundaries can move within quantisation, no claim of exact arbitrary-pixel continuity'}));
});
test('original source target/gamut gain survives race outcomes and exact horizon',()=>{
  const sampler=createDetailRaceSampler(3),p=[.2,.8],colors=[[.95,.01,.8],[.02,.9,.1]],target=[.18,.25,.3];
  for(let i=0;i<256;i++){
    const mass=sampler(p,i*.71,i*.53,.02),value=reanchorDetailMean(target,p,colors,mass);
    assert.ok(value.every(v=>v>=-1e-14&&v<=.95+1e-14));
  }
  assert.deepEqual(reanchorDetailMean(target,p,colors,sampler(p,12,19,3)),target);
});
