import test from 'node:test';
import assert from 'node:assert/strict';
import {detailRank,intervalMass,redistributeDetail,squareRadiusCdf,DETAIL_BANDS} from '../src/surface/detailDistribution.ts';
const near=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} versus ${b}`);
test('square-radius area CDF agrees with independent square raster; calibrated warped ranks',()=>{
  const n=192,bins=new Array(10).fill(0),radii=[.05,.2,.4,.5,.6,.7];
  const inside=radii.map(()=>0);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const u=(x+.5)/n,v=(z+.5)/n,r=Math.hypot(u-.5,v-.5);
    radii.forEach((radius,i)=>inside[i]+=r<=radius?1:0);
    bins[Math.min(9,Math.floor(detailRank(u,v)*10))]++;
  }
  inside.forEach((count,i)=>near(count/n**2,squareRadiusCdf(radii[i]),.002));
  bins.forEach(count=>near(count/n**2,.1,.002));
});
test('circular filtering conserves even tiny/wrapped probabilities and exact empty/full/horizon',()=>{
  for(const probability of [0,.0001,.01,.12,.5,.97,1])for(const h of [0,.002,.04,.24,.5])for(const start of [0,.33,.98]){
    let sum=0;const n=8192;
    for(let i=0;i<n;i++)sum+=intervalMass((i+.5)/n,start,probability,h);
    near(sum/n,probability,2/n);
    if(h===.5)near(intervalMass(.473,start,probability,h),probability,0);
  }
});
test('per-recipe fractions and low-cover void are conserved over four phases and four LOD filters',()=>{
  const weights=Object.freeze([.0001,.0199,.2,.34,.44]);
  let worst=0;
  for(const seed of [0,.127,.371,.873])for(const footprint of [.002,.08,1.25,6]){
    const means=weights.map(()=>0),lowMeans=[0,0,0],n=12000;let rng=17317;
    for(let i=0;i<n;i++){
      rng=(Math.imul(rng,1664525)+1013904223)>>>0;const x=rng/2**32*12;
      rng=(Math.imul(rng,1664525)+1013904223)>>>0;const z=rng/2**32*12;
      const local=redistributeDetail(weights,x,z,footprint,seed,seed*.71);
      near(local.reduce((a,b)=>a+b,0),1,1e-9);
      local.forEach((mass,k)=>{assert.ok(mass>=0&&mass<=1);means[k]+=mass/n;});
      const low=redistributeDetail([.215,.285,.08],x,z,footprint,seed+.371,seed+.619);
      assert.ok(low.reduce((a,b)=>a+b,0)<=1+1e-9);
      low.forEach((mass,k)=>lowMeans[k]+=mass/n);
    }
    means.forEach((mean,k)=>{worst=Math.max(worst,Math.abs(mean-weights[k]));near(mean,weights[k],.015);});
    lowMeans.forEach((mean,k)=>{const wanted=[.215,.285,.08][k];worst=Math.max(worst,Math.abs(mean-wanted));near(mean,wanted,.015);});
  }
  assert.deepEqual(weights,[.0001,.0199,.2,.34,.44]);
  console.log(JSON.stringify({test:'per-recipe-calibration',worstAbsoluteFractionError:worst,seeds:4,filters:4,samplesPerConfiguration:12000}));
});
test('zoom/tile/rebase changes no phase or fractions; unresolved means equal input probabilities',()=>{
  const weights=Object.freeze([.2,.3,.5]);
  for(const offset of [0,1e9+.125,-1e9-.125])for(const band of DETAIL_BANDS){
    const x=offset+13.375,z=-offset+7.625;
    const direct=detailRank(x/band.metres,z/band.metres);
    const ox=offset,oz=-offset,fract=v=>v-Math.floor(v);
    const rebased=detailRank((x-ox)/band.metres,(z-oz)/band.metres,fract(ox/band.metres),fract(oz/band.metres));
    near(direct,rebased,2e-5);
  }
  for(const x of [-120.31,0,122.77]){
    const a=redistributeDetail(weights,x,19.77,0);
    assert.deepEqual(a,redistributeDetail(weights,x,19.77,0));
    const horizon=redistributeDetail(weights,x,19.77,6);
    horizon.forEach((value,i)=>near(value,weights[i],1e-15));
  }
  assert.throws(()=>redistributeDetail([.8,.5],0,0,0));
  assert.throws(()=>redistributeDetail([NaN],0,0,0));
  assert.throws(()=>redistributeDetail([.5],0,0,-1));
});
