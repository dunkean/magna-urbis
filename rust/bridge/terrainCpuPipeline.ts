import { GenerationNoisePlan, TerrainPipeline } from './wasmRuntime';
import { configureCompactPlan, applyPhasorCpu } from './terrainPhasor';
import { configureProceduralPlan, isCompactProcedural, stageEnabled, type GenerationControl, type GenerationStage } from './terrainGenerationRecipe';
import { nativeRequest, nativeSession } from './nativeEngine';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import type { TerrainSettings } from './terrain';

const stages:GenerationStage[]=['initialize','regional','regionalFinish','reconstruct','amplitude','ridged','surface','normalize'];
const nativeSessions=new Map<string,string>();
/** The same retained Rust phases drive grouped generation and interactive stepping. */
export async function generateCpuTerrain(settings:TerrainSettings,control?:GenerationControl,runtime?:ExecutionRuntime,noise?:()=>Promise<{coarse:Float32Array;fine:Float32Array}>):Promise<Float32Array>{
  control?.backend?.(runtime ? 'native' : 'cpu');
  const compact=isCompactProcedural(settings),plan=GenerationNoisePlan.erosion(settings.seed,settings.width,settings.relief,settings.erosion,settings.motifSize,settings.mountainMix);
  const original=plan.parameters();plan.free();
  const configured=compact?configureCompactPlan(original,settings):{parameters:original,surface:original.slice(24,32)};
  const {parameters:p,surface:s}=configured;configureProceduralPlan(p,s,settings,compact);
  if(compact&&stageEnabled(settings,'ridged',false)&&settings.erosionTuning?.detail===undefined&&settings.procedural?.erosionTuning?.detail===undefined)p[16]=original[16];
  const enabled=(id:GenerationStage,fallback=true)=>Number(stageEnabled(settings,id,fallback));
  const flags=Uint32Array.from([Number(compact),enabled('regional'),enabled('regionalFinish'),enabled('amplitude'),enabled('ridged',!compact),enabled('surface',!compact||settings.relief==='canyon'),enabled('normalize'),Number(settings.procedural?.regionalThermal!==false),Number(settings.procedural?.regionalDiffusion!==false),settings.procedural?.reconstruction==='cubic'?1:settings.procedural?.reconstruction==='bspline'?2:0,Number(settings.relief==='canyon')]);
  if(runtime&&!nativeSessions.has(runtime.server))nativeSessions.set(runtime.server,nativeSession());
  const session=runtime?nativeSessions.get(runtime.server):undefined;let pipeline:TerrainPipeline|undefined,height:Float32Array|undefined;
  const native=(input:object)=>nativeRequest(runtime!,'/terrain/stage',JSON.stringify({session,...input}));
  try{
    await control?.before('grids',`Rust ${runtime?'natif':'WASM'} · régional ${p[2]}² · surface ${s[0]}²`);
    if(runtime)await native({command:'start',seed:settings.seed,parameters:Array.from(p),surface:Array.from(s),flags:Array.from(flags)}).catch(error=>{throw new Error(`Le service Rust natif (${runtime.server}) ne fournit pas le pipeline par étapes : ${error instanceof Error?error.message:String(error)}. Utilisez un service reconstruit avec cette version.`);});
    else pipeline=new TerrainPipeline(settings.seed,p,s,flags);
    await control?.after('grids');
    for(const [index,stage] of stages.entries()){
      await control?.before(stage);
      if(runtime){const response=await native({command:'advance',stage:index,preview:control?.previews!==false&&!!control});const bytes=await response.arrayBuffer();if(bytes.byteLength)height=new Float32Array(bytes);}
      else{if(index===0&&noise){const values=await noise();pipeline!.set_noise(values.coarse,values.fine);}pipeline!.advance(index);
        // The final field moves out of Rust (one copy into JS); previews copy the retained one.
        if(index===7)height=typeof pipeline!.take_height==='function'?pipeline!.take_height():pipeline!.height();else if(control&&control.previews!==false)height=pipeline!.height();}
      await control?.after(stage,control?.previews===false?undefined:height);
    }
    await control?.before('phasor');
    if(stageEnabled(settings,'phasor',compact))height=applyPhasorCpu(height!,settings);
    await control?.after('phasor',control?.previews===false?undefined:height,`Rust ${runtime?'natif':'WASM'} · Phasor CPU`);
    return height!;
  }finally{pipeline?.free();if(runtime)await native({command:'cancel'}).catch(()=>undefined);}
}
