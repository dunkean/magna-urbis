import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detailRank,intervalMass,redistributeDetail,homotheticSquareRank,mergeRecipeProbabilities,reanchorDetailMean,detailDistributionPhases,DETAIL_BANDS} from '../src/surface/detailDistribution.ts';
const near=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} versus ${b}`);
test('homothetic area rank is calibrated independently of hashed centre; inverse-warp cell histograms',()=>{
  const n=256,probabilities=[.01,.1,.3,.7,.99];
  for(const [cx,cz]of[[.25,.75],[.5,.5],[.73,.31]]){
    const inside=probabilities.map(()=>0);
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){
      const rank=homotheticSquareRank((x+.5)/n,(z+.5)/n,cx,cz);
      probabilities.forEach((p,i)=>inside[i]+=rank<=p?1:0);
    }
    inside.forEach((count,i)=>near(count/n**2,probabilities[i],.008));
  }
  for(const [ix,iz]of[[0,0],[7,-13],[-19,27],[4095,4095]]){
    const bins=new Array(10).fill(0);
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){
      // Independent inverse of the three unit-Jacobian shears. Uniform samples
      // of EACH warped cell have exact area measure, unlike arbitrary RGB noise.
      const u=ix+(x+.5)/n,v=iz+(z+.5)/n;
      const u0=u-.16*Math.sin(2*Math.PI*v);
      const v0=v-.22*Math.sin(2*Math.PI*u0);
      const x0=u0-.22*Math.sin(2*Math.PI*v0);
      bins[Math.min(9,Math.floor(detailRank(x0,v0)*10))]++;
    }
    bins.forEach(count=>near(count/n**2,.1,.008));
  }
  assert.notEqual(detailRank(.33,.61),detailRank(1.33,.61),'adjacent cells must not repeat the same patch');
});
test('corner duplicates merge into one physical recipe interval, not alternating rings',()=>{
  const ids=Object.freeze([13,18,13,18,13,18,13,18]);
  const weights=Object.freeze([.12,.08,.18,.07,.12,.08,.18,.17]);
  assert.deepEqual(mergeRecipeProbabilities(ids,weights),{ids:[13,18],weights:[.6,.4]});
  assert.deepEqual(mergeRecipeProbabilities([18,13,18,13],[.2,.3,.2,.3]),{ids:[13,18],weights:[.6,.4]},'same physical mixture despite another first raster-corner primary id');
  assert.throws(()=>mergeRecipeProbabilities([1],[NaN]));
});
test('hashed patch layout is not the rejected one-cell periodic pattern and stays continuous across cell edges',()=>{
  let a=0,b=0,aa=0,bb=0,ab=0,n=0;
  for(let z=0;z<64;z++)for(let x=0;x<64;x++){
    const p=detailRank((x+.37)/8,(z+.61)/8),q=detailRank((x+.37)/8+1,(z+.61)/8);
    a+=p;b+=q;aa+=p*p;bb+=q*q;ab+=p*q;n++;
  }
  const correlation=(ab-a*b/n)/Math.sqrt((aa-a*a/n)*(bb-b*b/n));
  assert.ok(correlation<.8,`Rejected periodic field would have correlation1, got${correlation}`);
  for(const u of [0,1,7,-13])for(const v of [.13,.51,.87]){
    const inverse=(u,v)=>{const a=u-.16*Math.sin(2*Math.PI*v);const b=v-.22*Math.sin(2*Math.PI*a);return[a-.22*Math.sin(2*Math.PI*b),b]};
    const left=inverse(u-1e-7,v),right=inverse(u+1e-7,v);
    near(detailRank(...left),detailRank(...right),1e-5);
  }
  console.log(JSON.stringify({test:'adjacent-cell-layout',correlation}));
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
      rng=(Math.imul(rng,1664525)+1013904223)>>>0;const x=rng/2**32*96;
      rng=(Math.imul(rng,1664525)+1013904223)>>>0;const z=rng/2**32*96;
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
  console.log(JSON.stringify({test:'per-recipe-calibration',worstAbsoluteFractionError:worst,phaseOffsets:4,filters:4,samplesPerConfiguration:12000}));
});
test('zoom/tile/rebase changes no phase or fractions; unresolved means equal input probabilities',()=>{
  const weights=Object.freeze([.2,.3,.5]);
  for(const offset of [0,1e9+.125,-1e9-.125])for(const band of DETAIL_BANDS){
    const x=offset+13.375,z=-offset+7.625;
    const direct=detailRank(x/band.metres,z/band.metres);
    const ox=offset,oz=-offset,fract=v=>v-Math.floor(v);
    const rebased=detailRank((x-ox)/band.metres,(z-oz)/band.metres,fract(ox/band.metres),fract(oz/band.metres),((Math.floor(ox/band.metres)%4096)+4096)%4096,((Math.floor(oz/band.metres)%4096)+4096)%4096);
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
test('one original-parameter gamut gain preserves the SAME target, including100k extreme draws',()=>{
  const probabilities=Object.freeze([.5,.5]),symmetric=Object.freeze([Object.freeze([.1,.1,.1]),Object.freeze([.9,.9,.9])]);
  const target=Object.freeze([.2,.2,.2]);
  const negative=reanchorDetailMean(target,probabilities,symmetric,[1,0]);
  const positive=reanchorDetailMean(target,probabilities,symmetric,[0,1]);
  negative.forEach((v,i)=>near((v+positive[i])/2,target[i],1e-15));
  near(negative[0],0,1e-15);near(positive[0],.4,1e-15);
  const colors=Object.freeze([Object.freeze([0,.15,.95]),Object.freeze([1,.95,.05])]);
  const targets=[[0,.95,.5],[.04,.86,.3],[.93,.01,.92],[.25,.17,.105]];
  const sums=targets.map(()=>[0,0,0]);let rng=31871;const n=100000;
  for(let i=0;i<n;i++){
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;
    const mass=intervalMass(rng/2**32,0,.5,.02),local=[mass,1-mass];
    targets.forEach((expected,k)=>reanchorDetailMean(expected,probabilities,colors,local).forEach((v,c)=>{assert.ok(v>=-1e-14&&v<=.95+1e-14);sums[k][c]+=v/n;}));
  }
  let worst=0;
  sums.forEach((mean,k)=>mean.forEach((v,c)=>{worst=Math.max(worst,Math.abs(v-targets[k][c]));near(v,targets[k][c],.002);}));
  for(const expected of targets){
    const horizon=redistributeDetail(probabilities,13.171,-72.381,3);
    const actual=reanchorDetailMean(expected,probabilities,colors,horizon);
    actual.forEach((v,c)=>assert.ok(Object.is(v,expected[c]),'horizon must retain target bits'));
  }
  console.log(JSON.stringify({test:'common-gamut-gain',samples:n,targets:targets.length,worstMeanError:worst,sourceTargetPreserved:true}));
});
test('world seed and floating origin transport the same shader cells, with exact cross-language phase bytes',()=>{
  const fixtures=JSON.parse(readFileSync(new URL('../../viewer-local/tests/fixtures/detail_distribution_phases.json',import.meta.url),'utf8'));
  for(const fixture of fixtures.cases){
    assert.deepEqual(Array.from(detailDistributionPhases(fixture.x,fixture.z,fixture.seed)),fixture.expected);
    const zero=detailDistributionPhases(0,0,fixture.seed),shifted=detailDistributionPhases(fixture.x,fixture.z,fixture.seed);
    for(let band=0;band<3;band++){
      const scale=DETAIL_BANDS[band].metres,k=band*4,x=fixture.x+13.375,z=fixture.z+7.625;
      const direct=detailRank(x/scale,z/scale,zero[k],zero[k+1],zero[k+2],zero[k+3]);
      const rebased=detailRank((x-fixture.x)/scale,(z-fixture.z)/scale,shifted[k],shifted[k+1],shifted[k+2],shifted[k+3]);
      near(direct,rebased,2e-4);
    }
  }
});
