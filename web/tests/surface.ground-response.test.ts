import {describe,it,expect} from 'vitest';
import {compileSurfaceWorld} from '../src/surface/compiler';
import {allocateGroundResponseFields,createGroundResponse,createGroundResponseSampler,groundResponseWeights,hydrateGroundResponse,GROUND_RESPONSE_BYTES_PER_SAMPLE} from '../src/surface/groundResponse';
import {createMaterialIndex,dominantMaterialPair,materialColor,packMaterialMean,unpackMaterialMean} from '../src/surface/materials';
import {decodeSurfaceBinary,encodeSurfaceBinary} from '../src/surface/binary';
import type {SurfaceGridGeometry} from '../src/surface/model';

function fixture(){
  const world=compileSurfaceWorld({seed:3,terrain:{width:2,height:2,originX:0,originZ:0,spacingM:32,heights:new Float32Array(4).fill(100),source:{id:'authored-response-terrain',version:'1',sourceLOD:0,nativeSpacingM:32}}});
  const grid:SurfaceGridGeometry={width:2,height:2,originX:0,originZ:0,spacingM:32},g=allocateGroundResponseFields(4),f=world.fields,M=createMaterialIndex(world.materials);
  for(let i=0;i<4;i++){
    f.slope[i]=i%2?.34:.02;f.stoniness[i]=i%2?.34:.1;f.organic[i]=i%2?.08:.25;
    g.moisturePreSaturation[i]=i%2?.76:.9;g.aridity[i]=2;g.rockRecipe[i]=M['fractured-bedrock'];
    const weights=groundResponseWeights({stoniness:f.stoniness[i],slopeRadians:f.slope[i],organic:f.organic[i],rockRecipe:g.rockRecipe[i],occupation:0,alluvial:0,gravity:0,wind:0,coastal:0,aridity:g.aridity[i],moisturePreSaturation:g.moisturePreSaturation[i]},M),pair=dominantMaterialPair(weights),sum=weights.reduce((s,[,v])=>s+v,0),mean=[0,0,0];
    for(const[id,v]of weights){const color=materialColor(world.materials[id],world.geology.units[0]);for(let c=0;c<3;c++)mean[c]+=color[c]*v/sum;}
    f.groundMaterial![i]=pair.primary;f.groundMaterialSecondary![i]=pair.secondary;f.groundMaterialBlend![i]=pair.blend;f.groundMaterialMeanColor![i]=packMaterialMean(mean);
  }
  return{world,grid,g,response:createGroundResponse(grid,world.terrain.source,world.versions.environment,world.versions.materialLibrary,g)};
}
describe('physical parameters before ground recipe response',()=>{
  it('preserves recorded node ids/blends/quantized means and evaluates the nonlinear law between them',()=>{
    const{world,g,response}=fixture(),f=world.fields,sample=createGroundResponseSampler(response,f,world.materials,world.geology.units);
    for(let i=0;i<4;i++){
      const weights=[0,0,0,0];weights[i]=1;const value=sample([0,1,2,3],weights,i);
      expect(value).toEqual({primary:f.groundMaterial![i],secondary:f.groundMaterialSecondary![i],blend:f.groundMaterialBlend![i],mean:unpackMaterialMean(f.groundMaterialMeanColor![i])});
    }
    const before=sample([0,1,2,3],[.25,.25,.25,.25],0),after=sample([0,1,2,3],[.25,.25,.25,.25],0);
    expect(after).toEqual(before);
    const baked=unpackMaterialMean(f.groundMaterialMeanColor![0]).map((v,c)=>v*.5+unpackMaterialMean(f.groundMaterialMeanColor![1])[c]*.5);
    expect(Math.hypot(...before.mean.map((v,c)=>v-baked[c]))).toBeGreaterThan(.005);
    const original=before.mean;
    f.treeCover.fill(1);f.grassCover.fill(0);f.litter.fill(1);expect(sample([0,1,2,3],[.25,.25,.25,.25],0).mean).toEqual(original);
    expect(g.alluvial.every(v=>v===0)).toBe(true);
  });
  it('restores all seven typed columns from JSON and borrows validated binary arrays',()=>{
    const{world,grid,response}=fixture(),expected={grid,source:world.terrain.source,environmentVersion:world.versions.environment,materialLibraryVersion:world.versions.materialLibrary,materials:world.materials};
    const bytes=encodeSurfaceBinary(response),decoded=decodeSurfaceBinary<any>(bytes),borrowed=decoded.fields.alluvial;
    expect(hydrateGroundResponse(decoded,expected).fields.alluvial).toBe(borrowed);
    const json=JSON.parse(JSON.stringify(response,(_,v)=>ArrayBuffer.isView(v)?Array.from(v as any):v)),restored=hydrateGroundResponse(json,expected);
    expect(restored.fields.rockRecipe).toBeInstanceOf(Uint16Array);expect(restored.fields.gravity).toBeInstanceOf(Float32Array);expect(encodeSurfaceBinary(restored)).toEqual(bytes);
  });
  it('rejects partial groups, wrong types, edited data/hash, source/frame/version mismatches and allocation over budget',()=>{
    const{world,grid,response}=fixture(),expected={grid,source:world.terrain.source,environmentVersion:world.versions.environment,materialLibraryVersion:world.versions.materialLibrary,materials:world.materials};
    const clone=()=>structuredClone(response);
    const partial=clone();delete(partial.fields as any).wind;expect(()=>hydrateGroundResponse(partial,expected)).toThrow(/group/);
    const wrongType=clone();(wrongType.fields as any).wind=new Float64Array(4);expect(()=>hydrateGroundResponse(wrongType,expected)).toThrow(/dtype/);
    const edited=clone();edited.fields.aridity[0]+=.1;expect(()=>hydrateGroundResponse(edited,expected)).toThrow(/hash/);
    expect(()=>hydrateGroundResponse(clone(),{...expected,source:{...expected.source,version:'other'}})).toThrow(/mismatched/);
    expect(()=>hydrateGroundResponse(clone(),{...expected,grid:{...grid,originX:1e9}})).toThrow(/mismatched/);
    expect(()=>hydrateGroundResponse(clone(),{...expected,environmentVersion:'edited'})).toThrow(/mismatched/);
    expect(()=>hydrateGroundResponse(clone(),expected,GROUND_RESPONSE_BYTES_PER_SAMPLE*4-1)).toThrow(/memoryBudget/);
    expect(()=>allocateGroundResponseFields(20_000_000)).toThrow(/budget/);
  });
});
