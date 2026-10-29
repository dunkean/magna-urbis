import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import init,{GenerationNoisePlan} from '../../rust/pkg/wasm/magna_urbis_wasm.js';
import {configureProceduralPlan} from '../../rust/bridge/terrainGenerationRecipe';
import type {TerrainSettings} from '../../rust/bridge/terrain';
await init({module_or_path:await readFile(new URL('../../rust/pkg/wasm/magna_urbis_wasm_bg.wasm',import.meta.url))});
const origin=process.env.MAGNA_NATIVE_STAGE_URL??'http://127.0.0.1:8795',session=crypto.randomUUID();
const settings:TerrainSettings={source:'procedural',seed:'native-stages',width:5000,motifSize:3000,relief:'mountains',mountainMix:.5,erosion:1,resolution:512,procedural:{regionalN:64,surfaceN:64,erosionTuning:{iterations:3},biome:true,enabled:{surface:false}}};
const plan=GenerationNoisePlan.erosion(settings.seed,settings.width,settings.relief,settings.erosion,settings.motifSize,settings.mountainMix),p=plan.parameters(),s=p.slice(24,32);plan.free();configureProceduralPlan(p,s,settings,false);
const call=async(input:object)=>{const r=await fetch(origin+'/terrain/stage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...input})});if(!r.ok)throw new Error(await r.text());return r;};
try{
 await call({command:'start',seed:settings.seed,parameters:Array.from(p),surface:Array.from(s),flags:[0,1,1,1,1,0,1,1,1,0,0]});
 const stages=[];
 for(let stage=0;stage<8;stage++){const h=new Float32Array(await(await call({command:'advance',stage,preview:true})).arrayBuffer());assert.equal(h.length,1024*1024);assert(h.every(Number.isFinite));let lo=Infinity,hi=-Infinity;for(const v of h){lo=Math.min(lo,v);hi=Math.max(hi,v);}stages.push({stage,min:lo,max:hi});}
 assert(stages[1].max>stages[0].max);assert(stages[7].min>=.3-1e-7);
 await mkdir('out/procedural-stages',{recursive:true});await writeFile('out/procedural-stages/native-pipeline-report.json',JSON.stringify({origin,stages},null,2));console.log(JSON.stringify({origin,finite:true,stages:stages.length}));
}finally{await call({command:'cancel'});}
