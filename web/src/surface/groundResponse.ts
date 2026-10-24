import { clamp, Occupation, type SurfaceFields, type SurfaceGridGeometry, type SourceIdentity, type MaterialRecipe, type RockUnit } from './model';
import { createMaterialIndex, dominantMaterialPair, materialColor, organicSoilFraction, unpackMaterialMean, type MaterialComposition } from './materials';
import { fingerprint } from './hash';

export const GROUND_RESPONSE_VERSION = 'surface-ground-response-1' as const;
export const GROUND_RESPONSE_FLOAT_FIELDS = ['alluvial','gravity','wind','coastal','aridity','moisturePreSaturation'] as const;
export const GROUND_RESPONSE_BYTES_PER_SAMPLE = 26;
export interface GroundResponseFields {
  alluvial: Float32Array; gravity: Float32Array; wind: Float32Array; coastal: Float32Array;
  aridity: Float32Array; moisturePreSaturation: Float32Array; rockRecipe: Uint16Array;
}
/** Inferred regional support potentials, not newly observed fine soil data.
 * The continuous world function evaluates physical parameters BEFORE recipes.
 * Existing physical context, hydrology, populations and substrate contacts stay fixed. */
export interface SurfaceGroundResponse {
  version: typeof GROUND_RESPONSE_VERSION; id: string;
  grid: SurfaceGridGeometry; source: SourceIdentity;
  environmentVersion: string; materialLibraryVersion: string;
  interpolation: 'bilinear-physical-before-recipe';
  quantization: 'float32-potentials; uint16-recipe; stored-srgb8-at-canonical-knots';
  fields: GroundResponseFields;
}
export interface GroundResponseParameters {
  stoniness: number; slopeRadians: number; organic: number; rockRecipe: number; occupation: number;
  alluvial: number; gravity: number; wind: number; coastal: number; aridity: number; moisturePreSaturation: number;
}

/** Shared operation order with naturalGroundWeights. Coastal is the effective
 * declared sediment potential, already gated by the source process at each knot. */
export function groundResponseWeights(p: GroundResponseParameters, M: Record<string, number>): Array<[number, number]> {
  const rockCover = clamp((p.stoniness-.08)/.75);
  const sediment: Array<[number, number]> = [[M['alluvial-bars'],p.alluvial],[M['angular-talus'],p.gravity],[M['wind-ripple-sand'],p.wind],[M['coastal-sediment'],p.coastal]];
  const sum = sediment.reduce((s,[,v])=>s+v,0),scale=Math.max(1,sum),soilRest=(1-rockCover)*(1-Math.min(1,sum));
  const dry=clamp((.65-p.aridity)/.4),humus=organicSoilFraction(p.moisturePreSaturation,p.slopeRadians,p.organic),soil=soilRest*(1-dry);
  if(p.occupation===Occupation.Crop)return [[M['cultivated-soil'],1]];
  return [[p.rockRecipe,rockCover],[M['mineral-soil'],soil*(1-humus)],[M['organic-soil'],soil*humus],[M['arid-reg'],soilRest*dry],...sediment.map(([id,v])=>[id,v/scale*(1-rockCover)] as [number,number])];
}

export function allocateGroundResponseFields(n: number): GroundResponseFields {
  if(!Number.isSafeInteger(n)||n<4||n>16_777_216||n*GROUND_RESPONSE_BYTES_PER_SAMPLE>512*1024*1024)throw new Error('Ground response allocation exceeds the bounded sample budget');
  return {...Object.fromEntries(GROUND_RESPONSE_FLOAT_FIELDS.map(key=>[key,new Float32Array(n)])),rockRecipe:new Uint16Array(n)} as GroundResponseFields;
}
export function groundResponseIdentity(response: Omit<SurfaceGroundResponse,'id'>): string {
  return fingerprint(['ground-response-1',response.version,response.grid,response.source,response.environmentVersion,response.materialLibraryVersion,response.interpolation,response.quantization,response.fields]);
}
export function createGroundResponse(grid: SurfaceGridGeometry, source: SourceIdentity, environmentVersion: string, materialLibraryVersion: string, fields: GroundResponseFields): SurfaceGroundResponse {
  const value:Omit<SurfaceGroundResponse,'id'>={version:GROUND_RESPONSE_VERSION,grid:{...grid},source:{...source},environmentVersion,materialLibraryVersion,
    interpolation:'bilinear-physical-before-recipe',quantization:'float32-potentials; uint16-recipe; stored-srgb8-at-canonical-knots',fields};
  return {...value,id:groundResponseIdentity(value)};
}

/** Typed binary values are borrowed after validation; JSON arrays restore exact
 * constructors. An absent group is handled by the caller; partial groups fail. */
export function hydrateGroundResponse(value: unknown, expected: {grid:SurfaceGridGeometry;source:SourceIdentity;environmentVersion:string;materialLibraryVersion:string;materials:MaterialRecipe[]}, memoryBudgetBytes=512*1024*1024): SurfaceGroundResponse {
  const r=value as SurfaceGroundResponse,n=expected.grid.width*expected.grid.height;
  if(!Number.isFinite(memoryBudgetBytes)||memoryBudgetBytes<=0||n*GROUND_RESPONSE_BYTES_PER_SAMPLE>memoryBudgetBytes)throw new Error('Ground response exceeds memoryBudgetBytes');
  if(!r||typeof r!=='object'||r.version!==GROUND_RESPONSE_VERSION||r.interpolation!=='bilinear-physical-before-recipe'||r.quantization!=='float32-potentials; uint16-recipe; stored-srgb8-at-canonical-knots'
    ||fingerprint(r.grid)!==fingerprint(expected.grid)||fingerprint(r.source)!==fingerprint(expected.source)||r.environmentVersion!==expected.environmentVersion||r.materialLibraryVersion!==expected.materialLibraryVersion
    ||!r.fields||Object.keys(r.fields).sort().join(',')!==[...GROUND_RESPONSE_FLOAT_FIELDS,'rockRecipe'].sort().join(','))throw new Error('Malformed or mismatched ground response group');
  for(const key of [...GROUND_RESPONSE_FLOAT_FIELDS,'rockRecipe'] as const){
    const a=r.fields[key],Constructor=key==='rockRecipe'?Uint16Array:Float32Array;
    if(!Array.isArray(a)&&!(a instanceof Constructor)||a.length!==n)throw new Error('Invalid ground response dtype/shape '+key);
    for(const v of a)if(!Number.isFinite(v)||v<0||key==='rockRecipe'&&(!Number.isInteger(v)||v>=expected.materials.length)||key!=='rockRecipe'&&key!=='aridity'&&v>1)throw new Error('Invalid ground response value '+key);
    if(!(a instanceof Constructor))(r.fields as any)[key]=new Constructor(a);
  }
  for(const id of r.fields.rockRecipe){const recipe=expected.materials[id];if(recipe.surfaceRole&&recipe.surfaceRole!=='ground'||['forest-litter','vegetation-litter','inland-water','marine-water','snow-ice'].includes(recipe.id))throw new Error('Ground response recipe has an incompatible role');}
  if(typeof r.id!=='string'||r.id!==groundResponseIdentity(r))throw new Error('Ground response version/hash mismatch');
  return r;
}

export interface GroundResponseSample extends MaterialComposition {mean:[number,number,number]}
/** Prepare once per projection; no material-index rebuild per cell. Coordinates
 * are represented by the caller's canonical four-corner sampler, including its
 * existing nearest-category convention and source padding policy. */
export function createGroundResponseSampler(response: SurfaceGroundResponse, physical: SurfaceFields, materials: MaterialRecipe[], units: RockUnit[]) {
  const M=createMaterialIndex(materials),rocks=new Map(units.map(r=>[r.id,r])),g=response.fields;
  return (indices:readonly number[],weights:readonly number[],nearest:number):GroundResponseSample=>{
    // Preserve existing recorded ids/means at exact canonical knots. The stored
    // sRGB8 quantisation is evidence, not extra response detail to invent.
    for(let c=0;c<4;c++)if(weights[c]===1){const i=indices[c];return {primary:physical.groundMaterial![i],secondary:physical.groundMaterialSecondary![i],blend:physical.groundMaterialBlend![i],mean:unpackMaterialMean(physical.groundMaterialMeanColor![i])};}
    const continuous=(a:ArrayLike<number>)=>weights.reduce((sum,w,c)=>sum+a[indices[c]]*w,0);
    const p:GroundResponseParameters={stoniness:continuous(physical.stoniness),slopeRadians:continuous(physical.slope),organic:continuous(physical.organic),rockRecipe:g.rockRecipe[nearest],occupation:physical.occupation[nearest],
      alluvial:continuous(g.alluvial),gravity:continuous(g.gravity),wind:continuous(g.wind),coastal:continuous(g.coastal),aridity:continuous(g.aridity),moisturePreSaturation:continuous(g.moisturePreSaturation)};
    const bed=rocks.get(physical.bedrock[nearest]),source=rocks.get(physical.sourceRock[nearest]);if(!bed||!source)throw new Error('Unknown ground response substrate/source');
    const amounts=groundResponseWeights(p,M),total=amounts.reduce((sum,[,v])=>sum+v,0),mean:[number,number,number]=[0,0,0];
    for(const[id,v]of amounts){const recipe=materials[id],color=materialColor(recipe,recipe.family!=='gravity'?bed:source);for(let c=0;c<3;c++)mean[c]+=color[c]*v/total;}
    return {...dominantMaterialPair(amounts),mean};
  };
}
