/** Renderer-only, inferred arrangement of existing material/cover probabilities.
 * No DEM, soil, geology, hydrology or population fields are modified. */
export const SURFACE_DETAIL_DISTRIBUTION_VERSION = 'surface-detail-distribution-2';
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
  return h;
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
/** Nested copies of a square about ANY interior point have area t². This
 * gives an exact area rank in each cell, without normalising RGB or guessing
 * the probability distribution of value noise. */
export function homotheticSquareRank(x:number,z:number,cx:number,cz:number):number {
  if(![x,z,cx,cz].every(Number.isFinite)||x<0||x>1||z<0||z>1||cx<=0||cx>=1||cz<=0||cz>=1)throw Error('Invalid calibrated detail cell');
  const u=x>=cx?(x-cx)/(1-cx):(cx-x)/cx;
  const v=z>=cz?(z-cz)/(1-cz):(cz-z)/cz;
  return Math.max(u,v)**2;
}
export function detailCellHash(x:number,z:number):number {
  let h=(Math.imul(x|0,1664525)+Math.imul(z|0,1013904223)+374761393)>>>0;
  h=Math.imul(h^(h>>>16),2246822519)>>>0;
  h=Math.imul(h^(h>>>13),3266489917)>>>0;h=(h^(h>>>16))>>>0;
  return (h&0x00ffffff)/16777216;
}
const modCell=(v:number)=>((v%4096)+4096)%4096;
/** Unit-Jacobian shears curve cell boundaries. Integer hashes choose only the
 * interior patch centre. Rank=1 on every shared edge, independent of that hash,
 * giving continuous nonrepeating arrangement over the useful world extent.
 * Four origin values transport the same cells through a float32 render frame. */
export function detailRank(x:number,z:number,phaseX=0,phaseZ=0,cellOriginX=0,cellOriginZ=0):number {
  if(![x,z,phaseX,phaseZ,cellOriginX,cellOriginZ].every(Number.isFinite))throw Error('Invalid detail coordinates');
  let u=x+phaseX,v=z+phaseZ;
  u+=.22*Math.sin(TAU*fract(v));
  v+=.22*Math.sin(TAU*fract(u));
  u+=.16*Math.sin(TAU*fract(v));
  const ix=modCell(Math.floor(u)+cellOriginX),iz=modCell(Math.floor(v)+cellOriginZ);
  const subdivision=detailCellHash(ix+137,iz+91)<.5?1:2;
  const su=fract(u)*subdivision,sv=fract(v)*subdivision;
  const hx=ix*2+Math.floor(su),hz=iz*2+Math.floor(sv);
  const cx=.25+.5*detailCellHash(hx,hz),cz=.25+.5*detailCellHash(hx+72,hz+31);
  return homotheticSquareRank(fract(su),fract(sv),cx,cz);
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
  for (const band of DETAIL_BANDS) mass += band.weight * intervalMass(detailRank(x / band.metres, z / band.metres, phaseX, phaseZ), start, probability, 2 * footprintMetres / band.metres);
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
export function redistributeDetail(weights: readonly number[], x: number, z: number, footprintMetres: number, phaseX = 0, phaseZ = 0): number[] {
  let start = 0;
  return weights.map(probability => {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1 || start + probability > 1 + 1e-9) throw Error('Invalid existing material probabilities');
    const result = detailMass(x,z,start,probability,footprintMetres,phaseX,phaseZ);
    start += probability;
    return result;
  });
}
