import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detailRank,intervalMass,redistributeDetail,detailNormalCdf,detailGaussianValue,detailGaussianVertex,createDetailDistributionSampler,mergeRecipeProbabilities,reanchorDetailMean,detailDistributionPhases,DETAIL_BANDS} from '../src/surface/detailDistribution.ts';
const near=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} versus ${b}`);
test('normal CDF agrees with independent Simpson integration; Gaussian vertex moments/bands',()=>{
  for(const value of [-6,-3,-1,0,.4,1,2,5]){
    const a=Math.abs(value),n=4096,h=a/n;let sum=1+Math.exp(-a*a/2);
    for(let i=1;i<n;i++)sum+=(i%2?4:2)*Math.exp(-((i*h)**2)/2);
    const integral=sum*h/(3*Math.sqrt(2*Math.PI));
    near(detailNormalCdf(value),.5+(value>=0?integral:-integral),1e-6);
  }
  let maxMean=0,maxVarianceError=0,maxCorrelation=0;const n=32768;
  const sums=[0,0,0],squares=[0,0,0],cross=[0,0,0];
  for(let i=0;i<n;i++){
    const g=[0,1,2].map(b=>detailGaussianVertex(i%256,Math.floor(i/256),b));
    g.forEach((v,b)=>{assert.ok(Number.isFinite(v));sums[b]+=v;squares[b]+=v*v;});
    cross[0]+=g[0]*g[1];cross[1]+=g[0]*g[2];cross[2]+=g[1]*g[2];
  }
  for(let b=0;b<3;b++){maxMean=Math.max(maxMean,Math.abs(sums[b]/n));maxVarianceError=Math.max(maxVarianceError,Math.abs(squares[b]/n-(sums[b]/n)**2-1));}
  maxCorrelation=Math.max(...cross.map(v=>Math.abs(v/n)));
  assert.ok(maxMean<.025&&maxVarianceError<.04&&maxCorrelation<.04);
  console.log(JSON.stringify({test:'gaussian-vertices',n,maxMean,maxVarianceError,maxCrossMoment:maxCorrelation}));
});
test('variance-normalised Gaussian Phi has conditional uniform seed-ensemble CDF with explicit DKW bound',()=>{
  const points=[[0,0],[.5,.5],[.13,.87]],n=32768;
  const samples=Array.from({length:9},()=>[]);let rng=91823;
  for(let i=0;i<n;i++){
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;const phases=detailDistributionPhases(0,0,rng);
    for(let band=0;band<3;band++)for(let p=0;p<points.length;p++){
      const k=band*4;samples[band*3+p].push(detailRank(points[p][0],points[p][1],phases[k],phases[k+1],phases[k+2],phases[k+3],band));
    }
  }
  const dkw95=Math.sqrt(Math.log(40)/(2*n));let maximumEmpiricalError=0;
  for(const values of samples){values.sort((a,b)=>a-b);for(let i=0;i<n;i++)maximumEmpiricalError=Math.max(maximumEmpiricalError,Math.abs(values[i]-i/n),Math.abs((i+1)/n-values[i]));}
  const uncertaintyBound=maximumEmpiricalError+dkw95;
  assert.ok(uncertaintyBound<.02,`Pointwise95% DKW assumption bound ${uncertaintyBound}; not an exact-area claim`);
  console.log(JSON.stringify({test:'conditional-seed-ensemble',seeds:n,points:3,bands:3,maximumEmpiricalCdfError:maximumEmpiricalError,dkw95HalfWidth:dkw95,maximumErrorPlusDkw95:uncertaintyBound,assumption:'independent ideal seeds; actual hash is deterministic pseudorandom; pointwise not simultaneous across all profiles'}));
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
  for(const u of [0,1,7,-13])for(const v of [.13,.51,.87])near(detailRank(u-1e-7,v),detailRank(u+1e-7,v),1e-5);
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
test('per-recipe fractions and low-cover void converge over64seed blocks, not exact mass per realised patch',()=>{
  const weights=Object.freeze([.0001,.0199,.2,.34,.44]),lowWeights=Object.freeze([.215,.285,.08]);
  const seeds=64,positions=512;let worstError=0,worstErrorPlus95=0;const realised=[];
  for(const footprint of [.002,.08,1.25,6]){
    const blocks=Array.from({length:8},()=>[]);let sourceRng=17317;
    for(let seed=0;seed<seeds;seed++){
      sourceRng=(Math.imul(sourceRng,1664525)+1013904223)>>>0;
      const sample=createDetailDistributionSampler(sourceRng),sampleLow=createDetailDistributionSampler(sourceRng,0,0,.371,.619);
      const means=new Array(8).fill(0);let rng=731;
      for(let i=0;i<positions;i++){
        rng=(Math.imul(rng,1664525)+1013904223)>>>0;const x=rng/2**32*96;
        rng=(Math.imul(rng,1664525)+1013904223)>>>0;const z=rng/2**32*96;
        const ground=sample(weights,x,z,footprint),low=sampleLow(lowWeights,x,z,footprint);
        near(ground.reduce((a,b)=>a+b,0),1,1e-9);assert.ok(low.reduce((a,b)=>a+b,0)<=1+1e-9);
        [...ground,...low].forEach((v,k)=>{assert.ok(v>=0&&v<=1);means[k]+=v/positions;});
      }
      means.forEach((v,k)=>blocks[k].push(v));
    }
    const expected=[...weights,...lowWeights];
    blocks.forEach((values,k)=>{
      const mean=values.reduce((a,b)=>a+b,0)/seeds;
      const sem=Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/(seeds-1)/seeds);
      const error=Math.abs(mean-expected[k]),bound=error+1.96*sem;
      worstError=Math.max(worstError,error);worstErrorPlus95=Math.max(worstErrorPlus95,bound);
      assert.ok(bound<.02,`Seed-block mean/95%SEM bound ${bound}`);
      realised.push({footprint,recipe:k,mean,target:expected[k],sem95:1.96*sem,realisedMinimum:Math.min(...values),realisedMaximum:Math.max(...values)});
    });
  }
  console.log(JSON.stringify({test:'per-recipe-seed-ensemble',seeds,positionsPerSeed:positions,filters:4,worstMeanError:worstError,worstErrorPlusBlock95:worstErrorPlus95,scope:'CI across seed blocks; spatial positions are NOT counted as independent. Realised cell/viewport mass is not asserted exact.',profiles:realised}));
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
      const direct=detailRank(x/scale,z/scale,zero[k],zero[k+1],zero[k+2],zero[k+3],band);
      const rebased=detailRank((x-fixture.x)/scale,(z-fixture.z)/scale,shifted[k],shifted[k+1],shifted[k+2],shifted[k+3],band);
      near(direct,rebased,2e-4);
    }
  }
});
