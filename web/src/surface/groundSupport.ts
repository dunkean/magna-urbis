import{clamp,Occupation,WaterClass,DepositOrigin,type TerrainGrid,type SurfaceFields,type GeologyInput,type ClimateInput,type ProcessInput,type MaterialRecipe,type RockUnit}from'./model';
import{createMaterialIndex,dominantMaterialPair,materialColor,organicSoilFraction,packMaterialMean}from'./materials';

/** Pure reconstruction of the same routed colluvial potential used by compilation. */
export function surfaceColluvium(t:TerrainGrid,f:SurfaceFields,units:Map<number,RockUnit>,order:Int32Array,options:{colluvialDecayLengthM?:number}={}){
  const n=t.width*t.height;
  const colluvium = new Float32Array(n), colluvialSource = new Uint16Array(n), colluvialBest = new Float32Array(n);
  // Route a source-connected gravity potential over the same downhill graph. Deposits have an actual upslope rock source.
  for (const i of order) {
    const rock = units.get(f.bedrock[i])!, steep = clamp((f.slope[i] - .38) / .6);
    const local = steep * rock.hardness * t.spacingM / 20;
    if (local > colluvialBest[i]) { colluvialBest[i] = local; colluvialSource[i] = rock.id; }
    colluvium[i] += local;
    const j = f.downstream[i];
    if (j >= 0) {
      const stepM = Math.hypot(j % t.width - i % t.width, Math.floor(j / t.width) - Math.floor(i / t.width)) * t.spacingM;
      const decayLength = (options.colluvialDecayLengthM ?? 100) * (f.slope[i] < .22 ? .2 : 1);
      const retained = t.heights[j] >= t.heights[i] ? 0 : Math.exp(-stepM / decayLength);
      colluvium[j] += colluvium[i] * retained;
      if (colluvialBest[i] * retained > colluvialBest[j]) { colluvialBest[j] = colluvialBest[i] * retained; colluvialSource[j] = colluvialSource[i]; }
    }
  }
  return{colluvium,colluvialSource};
}

export interface NaturalGroundParameters{stoniness:number;bed:RockUnit;s:number;water:number;origin:number;coastDistance:number;alluvial:number;gravity:number;wind:number;coastal:number;aridity:number;moisture:number;organic:number;occupation:number;karst?:number;volcanic?:number;geothermal?:number}
/** Shared bare support policy; occupation blocks plants but is not a paving source. */
export function naturalGroundWeights(p:NaturalGroundParameters,M:Record<string,number>):Array<[number,number]>{
  const{stoniness,bed,s,water,origin,coastDistance,alluvial,gravity,wind,coastal,aridity,moisture,organic,occupation,karst,volcanic,geothermal}=p;
  const rockCover=clamp((stoniness-.08)/.75);
  const supportRock = karst && bed.lithology==='limestone' ? M['carbonate-karst']
    : volcanic || geothermal ? M['volcanic-crust']
    : Math.abs(coastDistance)<40 && water===WaterClass.Dry && origin!==DepositOrigin.Coastal ? M['coastal-rock'] : M['fractured-bedrock'];
  const supportSediment:Array<[number,number]>=[[M['alluvial-bars'],alluvial],[M['angular-talus'],gravity],[M['wind-ripple-sand'],wind],[M['coastal-sediment'],origin===DepositOrigin.Coastal?coastal:0]];
  const supportSum=supportSediment.reduce((sum,[,v])=>sum+v,0),supportScale=Math.max(1,supportSum),soilRest=(1-rockCover)*(1-Math.min(1,supportSum));
  const dryFraction=clamp((.65-aridity)/.4),humus=organicSoilFraction(moisture,s,organic);
  const soilWeight=soilRest*(1-dryFraction);
  let groundWeights:Array<[number,number]>=[[supportRock,rockCover],[M['mineral-soil'],soilWeight*(1-humus)],[M['organic-soil'],soilWeight*humus],[M['arid-reg'],soilRest*dryFraction],...supportSediment.map(([id,v])=>[id,v/supportScale*(1-rockCover)] as [number,number])];
  // Coarse occupation is an exclusion/support constraint, not evidence of laid
  // paving. Source roads/courts/buildings carry their own vector materials;
  // preserve the local mineral/organic substrate beneath all three.
  if(occupation===Occupation.Crop)groundWeights=[[M['cultivated-soil'],1]];
  return groundWeights;
}

/** Rebuild derived bare-ground arrays from retained physical context, never legacy composite.
 * Original climate/process parameters and physical samples must be supplied explicitly.
 * Other source fields are read-only; no drainage/terrain/occupation field is replaced. */
export function deriveNaturalGroundFields(t:TerrainGrid,f:SurfaceFields,geology:GeologyInput,climate:ClimateInput,materials:MaterialRecipe[],options:{processes?:ProcessInput;floodplainWidthM?:number;colluvialDecayLengthM?:number}={}){
  const n=t.width*t.height,units=new Map(geology.units.map(u=>[u.id,u])),M=createMaterialIndex(materials);
  if(f.slope.length!==n||f.downstream.length!==n||f.bedrock.length!==n)throw Error('Ground reconstruction requires aligned retained physical context');
  const incoming=new Uint32Array(n),order=new Int32Array(n);let tail=0;
  for(let i=0;i<n;i++){const j=f.downstream[i];if(j>=n||j< -1||j===i)throw Error('Invalid retained ground routing');if(j>=0)incoming[j]++;}
  for(let i=0;i<n;i++)if(!incoming[i])order[tail++]=i;
  for(let k=0;k<tail;k++){const j=f.downstream[order[k]];if(j>=0&&!--incoming[j])order[tail++]=j;}
  if(tail!==n)throw Error('Retained ground routing contains a cycle');
  const{colluvium}=surfaceColluvium(t,f,units,order,options);
  const out={groundMaterial:new Uint16Array(n),groundMaterialSecondary:new Uint16Array(n),groundMaterialBlend:new Float32Array(n),groundMaterialMeanColor:new Uint32Array(n)};
  for(let i=0;i<n;i++){
    const bed=units.get(f.bedrock[i]),source=units.get(f.sourceRock[i]);if(!bed||!source)throw Error('Unknown retained ground lithology');
    const s=f.slope[i],flat=1-clamp(s/.7),hand=f.handM[i],distance=f.distanceToWaterM[i];
    const alluvial=(hand>=0?Math.exp(-hand/7):0)*Math.exp(-distance/(options.floodplainWidthM??150))*flat;
    const gravity=clamp(colluvium[i]*.35)*clamp((.8-s)/.6),wind=clamp(options.processes?.aeolianSupply?.[i]??0)*flat;
    const coastDistance=options.processes?.coastDistanceM?.[i]??Infinity,coastal=Math.exp(-Math.abs(coastDistance)/35)*flat;
    const temp=(climate.temperatureC?.[i]??climate.meanAnnualTempC)-(climate.elevationCorrected?0:(t.heights[i]-(climate.referenceElevationM??0))*(climate.lapseRateCPerKm??6.5)/1000);
    const aridity=f.precipitationMm[i]/Math.max(180,450+Math.max(0,temp)*30);
    const moisture=clamp(aridity*.45+clamp((f.twi[i]-5)/14)*.23+alluvial*.28+f.clay[i]*.18-f.sand[i]*.12-s*.2);
    const weights=naturalGroundWeights({stoniness:f.stoniness[i],bed,s,water:f.waterClass[i],origin:f.depositOrigin[i],coastDistance,alluvial,gravity,wind,coastal,aridity,moisture,organic:f.organic[i],occupation:f.occupation[i],karst:options.processes?.karst?.[i],volcanic:options.processes?.volcanic?.[i],geothermal:options.processes?.geothermal?.[i]},M);
    const pair=dominantMaterialPair(weights);out.groundMaterial[i]=pair.primary;out.groundMaterialSecondary[i]=pair.secondary;out.groundMaterialBlend[i]=pair.blend;
    const total=weights.reduce((sum,[,v])=>sum+v,0),mean=[0,0,0];
    for(const[id,v]of weights){const recipe=materials[id],color=materialColor(recipe,recipe.family!=='gravity'?bed:source);for(let c=0;c<3;c++)mean[c]+=color[c]*v/total;}
    out.groundMaterialMeanColor[i]=packMaterialMean(mean);
  }
  return out;
}

