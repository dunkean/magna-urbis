/** Renderer-only, inferred arrangement of existing material/cover probabilities.
 * No DEM, soil, geology, hydrology or population fields are modified. */
export const SURFACE_DETAIL_DISTRIBUTION_VERSION = 'surface-detail-distribution-3';
export const DETAIL_BANDS = Object.freeze([
  Object.freeze({ metres: 12, weight: .4 }),
  Object.freeze({ metres: 1.7, weight: .35 }),
  Object.freeze({ metres: .17, weight: .25 }),
]);
const TAU = 2 * Math.PI;
const fract = (v: number) => v - Math.floor(v);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function layoutSeed(seed:number,band:number,lane:string):number {
  let h=2166136261;
  for(const byte of new TextEncoder().encode(`${SURFACE_DETAIL_DISTRIBUTION_VERSION}:${seed}:${band}:${lane}`))h=Math.imul(h^byte,16777619)>>>0;
  h=Math.imul(h^(h>>>16),73244475)>>>0;
  h=Math.imul(h^(h>>>16),73244475)>>>0;
  return(h^(h>>>16))>>>0;
}
/** Renderer seed, never a source/candidate identity. Fraction and integer carry
 * are transported together; only small modulo values enter shader float32. */
export function detailDistributionPhases(originX:number,originZ:number,seed=0):Float32Array {
  if(![originX,originZ].every(Number.isFinite)||!Number.isSafeInteger(seed))throw Error('Invalid detail world frame/seed');
  const values:number[]=[];
  DETAIL_BANDS.forEach((band,i)=>{
    const x=originX/band.metres+(layoutSeed(seed,i,'x')&0xffffff)/16777216;
    const z=originZ/band.metres+(layoutSeed(seed,i,'z')&0xffffff)/16777216;
    values.push(fract(x),fract(z),((Math.floor(x)+(layoutSeed(seed,i,'cx')&4095))%4096+4096)%4096,((Math.floor(z)+(layoutSeed(seed,i,'cz')&4095))%4096+4096)%4096);
  });
  return Float32Array.from(values);
}
/** Separate uint32 hashes per vertex/band/lane. Not a source/candidate id. */
export function detailCellHashUint(x:number,z:number,salt=0):number {
  let h=(Math.imul(x|0,1664525)+Math.imul(z|0,1013904223)+374761393+Math.imul(salt|0,668265263))>>>0;
  h=Math.imul(h^(h>>>16),2246822519)>>>0;
  h=Math.imul(h^(h>>>13),3266489917)>>>0;
  return(h^(h>>>16))>>>0;
}
const modCell=(v:number)=>((v%4096)+4096)%4096;
export function detailGaussianVertex(x:number,z:number,band=0):number {
  const ix=modCell(x),iz=modCell(z);
  const u=(detailCellHashUint(ix,iz,band*2+11)+.5)/4294967296;
  const v=(detailCellHashUint(ix,iz,band*2+12)+.5)/4294967296;
  return Math.sqrt(-2*Math.log(u))*Math.cos(TAU*v);
}
/** Normal CDF rational approximation; checked against independent quadrature.
 * The rank is uniform under the ideal independent-Gaussian SEED ENSEMBLE,
 * conditional on a point/its interpolation weights. Not exact area per patch. */
export function detailNormalCdf(value:number):number {
  if(!Number.isFinite(value))throw Error('Invalid Gaussian detail value');
  const a=Math.abs(value),t=1/(1+.2316419*a);
  const tail=.3989422804014327*Math.exp(-.5*a*a)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return clamp(value>=0?1-tail:tail,0,1);
}
export function detailGaussianValue(x:number,z:number,phaseX=0,phaseZ=0,cellOriginX=0,cellOriginZ=0,band=0):number {
  if(![x,z,phaseX,phaseZ,cellOriginX,cellOriginZ].every(Number.isFinite)||!Number.isInteger(band)||band<0||band>2)throw Error('Invalid detail coordinates/band');
  const u=x+phaseX,v=z+phaseZ,ix=Math.floor(u)+cellOriginX,iz=Math.floor(v)+cellOriginZ;
  const fx=fract(u),fz=fract(v),a=fx*fx*(3-2*fx),b=fz*fz*(3-2*fz);
  const weights=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b];
  const samples=[detailGaussianVertex(ix,iz,band),detailGaussianVertex(ix+1,iz,band),detailGaussianVertex(ix,iz+1,band),detailGaussianVertex(ix+1,iz+1,band)];
  let sum=0,variance=0;
  for(let i=0;i<4;i++){sum+=weights[i]*samples[i];variance+=weights[i]*weights[i];}
  return sum/Math.sqrt(variance);
}
export function detailRank(x:number,z:number,phaseX=0,phaseZ=0,cellOriginX=0,cellOriginZ=0,band=0):number {
  return detailNormalCdf(detailGaussianValue(x,z,phaseX,phaseZ,cellOriginX,cellOriginZ,band));
}
/** Merge repeated corner/recipe slots BEFORE allocating probability intervals.
 * Splitting one recipe into alternating intervals creates artificial rings. */
export function mergeRecipeProbabilities(ids:readonly number[],weights:readonly number[]):{ids:number[];weights:number[]} {
  if(ids.length!==weights.length)throw Error('Detail recipe shape mismatch');
  const unique:number[]=[],amounts:number[]=[];
  weights.forEach((value,i)=>{if(!Number.isFinite(value)||value<0||!Number.isSafeInteger(ids[i])||ids[i]<0)throw Error('Invalid recipe slot');const j=unique.indexOf(ids[i]);if(j<0){unique.push(ids[i]);amounts.push(value);}else amounts[j]+=value;});
  const order=unique.map((id,i)=>({id,weight:amounts[i]})).sort((a,b)=>a.id-b.id);
  return {ids:order.map(v=>v.id),weights:order.map(v=>v.weight)};
}
/** Circular box convolution of one probability interval. Periodic wrapping
 * preserves its integral even for probability 0/1 or intervals crossing zero. */
export function intervalMass(rank: number, start: number, probability: number, halfWidth: number): number {
  if (![rank,start,probability,halfWidth].every(Number.isFinite) || probability < 0 || probability > 1 || halfWidth < 0) throw Error('Invalid detail probability/filter');
  if (probability === 0 || probability === 1 || halfWidth >= .5) return probability;
  const q = fract(rank - start), h = Math.max(.000001, halfWidth);
  const lo = q - h, hi = q + h;
  const overlap = (a: number, b: number) => Math.max(0, Math.min(hi, b) - Math.max(lo, a));
  return clamp((overlap(0, probability) + overlap(1, 1 + probability) + overlap(-1, probability - 1)) / (2 * h), 0, 1);
}
export function detailMass(x: number, z: number, start: number, probability: number, footprintMetres: number, phaseX = 0, phaseZ = 0): number {
  if (![footprintMetres,start,probability].every(Number.isFinite) || footprintMetres < 0 || probability < 0 || probability > 1) throw Error('Invalid detail footprint/probability');
  if (footprintMetres >= 3) return probability;
  let mass = 0;
  DETAIL_BANDS.forEach((band,i)=>{mass += band.weight * intervalMass(detailRank(x / band.metres, z / band.metres, phaseX, phaseZ,0,0,i), start, probability, 2 * footprintMetres / band.metres);});
  return mass;
}
/** One gain for ALL possible outcomes, derived only from the original target,
 * original fractions and source component colours. Never from the realised
 * noise/delta: adaptive clipping would bias the mean. */
export function reanchorDetailMean(target:readonly number[], probabilities:readonly number[], colors:readonly (readonly number[])[], local:readonly number[], upperBound=.95):number[] {
  if(target.length!==3||colors.length!==probabilities.length||local.length!==probabilities.length||!Number.isFinite(upperBound)||upperBound<=0||upperBound>1)throw Error('Invalid detail mean shape');
  if(target.some(v=>!Number.isFinite(v)||v<0||v>1)||probabilities.some(v=>!Number.isFinite(v)||v<0)||local.some(v=>!Number.isFinite(v)||v<0)||colors.some(c=>c.length!==3||c.some(v=>!Number.isFinite(v)||v<0||v>1)))throw Error('Invalid detail mean values');
  if(Math.abs(probabilities.reduce((a,b)=>a+b,0)-1)>1e-9||Math.abs(local.reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('Detail colours need conditional probability measures');
  const mean=[0,0,0],minimum=[1,1,1],maximum=[0,0,0];
  probabilities.forEach((p,i)=>{for(let c=0;c<3;c++){mean[c]+=p*colors[i][c];if(p>0){minimum[c]=Math.min(minimum[c],colors[i][c]);maximum[c]=Math.max(maximum[c],colors[i][c]);}}});
  let gain=1;
  for(let c=0;c<3;c++){
    const negative=mean[c]-minimum[c],positive=maximum[c]-mean[c];
    if(negative>1e-8)gain=Math.min(gain,target[c]/negative);
    if(positive>1e-8)gain=Math.min(gain,(upperBound-target[c])/positive);
  }
  gain=clamp(gain,0,1);
  return target.map((v,c)=>v+gain*probabilities.reduce((delta,p,i)=>delta+(local[i]-p)*colors[i][c],0));
}
/** Existing fractions may sum below one: the remainder is uncovered support.
 * It is deliberately not renormalised, so ground and low cover are not one
 * artificial global partition with the canopy. */
function redistributeWithRanks(weights:readonly number[],ranks:readonly number[],footprintMetres:number):number[] {
  let start=0;
  return weights.map(probability=>{
    let mass=0;DETAIL_BANDS.forEach((band,i)=>{mass+=band.weight*intervalMass(ranks[i],start,probability,2*footprintMetres/band.metres);});
    start+=probability;return mass;
  });
}
function validateDetailProbabilities(weights:readonly number[],footprint:number):void {
  if(!Number.isFinite(footprint)||footprint<0)throw Error('Invalid detail footprint');
  let total=0;for(const p of weights)if(!Number.isFinite(p)||p<0||p>1||(total+=p)>1+1e-9)throw Error('Invalid existing material probabilities');
}
export function redistributeDetail(weights: readonly number[], x: number, z: number, footprintMetres: number, phaseX = 0, phaseZ = 0): number[] {
  validateDetailProbabilities(weights,footprintMetres);
  if(footprintMetres>=3)return [...weights];
  const ranks=DETAIL_BANDS.map((band,i)=>2*footprintMetres/band.metres>=.5?0:detailRank(x/band.metres,z/band.metres,phaseX,phaseZ,0,0,i));
  return redistributeWithRanks(weights,ranks,footprintMetres);
}
/** CPU renderer reference using the SAME world-seed/origin uniforms as native.
 * Each returned sampler keeps a single immutable48-byte phase block. */
export function createDetailDistributionSampler(seed=0,originX=0,originZ=0,layerPhaseX=0,layerPhaseZ=0):(weights:readonly number[],localX:number,localZ:number,footprintMetres:number)=>number[] {
  const phases=detailDistributionPhases(originX,originZ,seed);
  return (weights,x,z,footprint)=>{
    validateDetailProbabilities(weights,footprint);
    if(footprint>=3)return [...weights];
    const ranks=DETAIL_BANDS.map((band,i)=>2*footprint/band.metres>=.5?0:detailRank(x/band.metres,z/band.metres,phases[i*4]+layerPhaseX,phases[i*4+1]+layerPhaseZ,phases[i*4+2],phases[i*4+3],i));
    return redistributeWithRanks(weights,ranks,footprint);
  };
}
