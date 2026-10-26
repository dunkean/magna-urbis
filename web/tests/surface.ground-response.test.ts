import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {compileSurfaceWorld,hydrateSurfaceWorld,retargetSurfaceWorld,sampleSurface,serializeSurfaceWorld,deserializeSurfaceWorld,estimateSurfaceCompileBytes} from '../src/surface/compiler';
import {allocateGroundResponseFields,createGroundResponse,createGroundResponseSampler,groundResponseWeights,groundResponseIdentity,hydrateGroundResponse,GROUND_RESPONSE_BYTES_PER_SAMPLE,GROUND_RESPONSE_FLOAT_FIELDS} from '../src/surface/groundResponse';
import {createMaterialIndex,dominantMaterialPair,materialColor,packMaterialMean,unpackMaterialMean} from '../src/surface/materials';
import {decodeSurfaceBinary,encodeSurfaceBinary} from '../src/surface/binary';
import type {SurfaceGridGeometry} from '../src/surface/model';
import {surfaceLayerInput} from './fixtures/surfaceLayerInput';
import {generateSurfaceCandidates} from '../src/surface/population';

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
  it('frames strings unambiguously including delimiter-looking ids, NUL and astral Unicode',()=>{
    const{response}=fixture(),identity=(id:string,version:string)=>groundResponseIdentity({...response,source:{...response.source,id,version}});
    expect(identity('a;string:b','c')).not.toBe(identity('a','b;string:c'));
    expect(identity('a\0b','c')).not.toBe(identity('a','\0bc'));
    expect(identity('é🌲\0;string:','v')).toBe(identity('é🌲\0;string:','v'));
    expect(identity('é🌲','v')).not.toBe(identity('é','🌲v'));
    const r={...response,source:{...response.source,id:'é🌲\0;string:',version:'v'}},g=r.grid,s=r.source;
    const values=['gr-sha256-1',r.version,new Float64Array([g.width,g.height,g.originX,g.originZ,g.spacingM,s.sourceLOD,s.nativeSpacingM]),s.id,s.version,s.sourceLODKnown===undefined?'unspecified':String(s.sourceLODKnown),s.provenance??'',r.environmentVersion,r.materialLibraryVersion,r.interpolation,r.quantization,...GROUND_RESPONSE_FLOAT_FIELDS.map(k=>r.fields[k]),r.fields.rockRecipe];
    const hash=createHash('sha256'),length=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);hash.update(b);};hash.update(Buffer.from([3]));length(values.length);
    for(const value of values){if(typeof value==='string'){const b=Buffer.from(value,'utf16le');hash.update(Buffer.from([1]));length(b.length);hash.update(b);}else{hash.update(Buffer.from([2,value instanceof Float64Array?1:value instanceof Float32Array?2:3]));length(value.byteLength);hash.update(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));}}
    expect(groundResponseIdentity(r)).toBe('gr-sha256-1:'+hash.digest('hex'));
  });
  it('rejects partial groups, wrong types, edited data/hash, source/frame/version mismatches and allocation over budget',()=>{
    const{world,grid,response}=fixture(),expected={grid,source:world.terrain.source,environmentVersion:world.versions.environment,materialLibraryVersion:world.versions.materialLibrary,materials:world.materials};
    const clone=()=>structuredClone(response);
    const partial=clone();delete(partial.fields as any).wind;expect(()=>hydrateGroundResponse(partial,expected)).toThrow(/group/);
    const wrongType=clone();(wrongType.fields as any).wind=new Float64Array(4);expect(()=>hydrateGroundResponse(wrongType,expected)).toThrow(/dtype/);
    const edited=clone();edited.fields.aridity[0]+=.1;expect(()=>hydrateGroundResponse(edited,expected)).toThrow(/hash/);
    const overflow=JSON.parse(JSON.stringify(response,(_,v)=>ArrayBuffer.isView(v)?Array.from(v as any):v)),infinity=clone();infinity.fields.aridity[0]=Infinity;overflow.id=groundResponseIdentity(infinity);overflow.fields.aridity[0]=1e100;
    expect(()=>hydrateGroundResponse(overflow,expected)).toThrow(/value aridity/);
    expect(()=>hydrateGroundResponse(clone(),{...expected,source:{...expected.source,version:'other'}})).toThrow(/mismatched/);
    expect(()=>hydrateGroundResponse(clone(),{...expected,grid:{...grid,originX:1e9}})).toThrow(/mismatched/);
    expect(()=>hydrateGroundResponse(clone(),{...expected,environmentVersion:'edited'})).toThrow(/mismatched/);
    expect(()=>hydrateGroundResponse(clone(),expected,GROUND_RESPONSE_BYTES_PER_SAMPLE*4-1)).toThrow(/memoryBudget/);
    expect(()=>allocateGroundResponseFields(20_000_000)).toThrow(/budget/);
    const badCatalogue=structuredClone(world.materials);delete badCatalogue[1].surfaceRole;badCatalogue[1].family='marine';
    expect(()=>hydrateGroundResponse(clone(),{...expected,materials:badCatalogue})).toThrow(/family\/role/);
    expect(()=>compileSurfaceWorld({seed:3,terrain:world.terrain},{materialLibrary:badCatalogue})).toThrow(/family\/role/);
  });
  it('keeps all original fields, physical versions, candidates and canonical knots exact while adding the versioned response',()=>{
    const input=surfaceLayerInput(),options={topographicRadiiM:[32,64,128]},base=compileSurfaceWorld(input,options),legacy=compileSurfaceWorld(input,{...options,groundResponse:false});
    expect(base.fields).toEqual(legacy.fields);expect(base.terrain).toEqual(legacy.terrain);expect(base.geology).toEqual(legacy.geology);
    expect(base.versions.environment).toBe(legacy.versions.environment);expect(base.versions.population).toBe(legacy.versions.population);expect(base.versions.hydrology).toBe(legacy.versions.hydrology);
    expect(base.id).not.toBe(legacy.id);expect(base.versions.groundResponse).toBe(base.groundResponse!.id);
    const bounds={minX:32,minZ:32,maxX:480,maxZ:480};expect(generateSurfaceCandidates(base,bounds)).toEqual(generateSurfaceCandidates(legacy,bounds));
    for(let i=0;i<input.terrain.heights.length;i++){
      const x=i%17*32,z=Math.floor(i/17)*32,value=sampleSurface(base,x,z).surfaceLayers.ground!;
      expect(value.material).toBe(base.materials[base.fields.groundMaterial![i]]);expect(value.materialBlend).toBe(base.fields.groundMaterialBlend![i]);expect(value.meanColorLinear).toEqual(unpackMaterialMean(base.fields.groundMaterialMeanColor![i]));
    }
    const oldBytes=encodeSurfaceBinary(legacy);expect(encodeSurfaceBinary(hydrateSurfaceWorld(decodeSurfaceBinary(oldBytes)))).toEqual(oldBytes);
    expect(estimateSurfaceCompileBytes(input.terrain,2,3)-estimateSurfaceCompileBytes(input.terrain,2,3,false)).toBe(26*17*17);
    expect(()=>compileSurfaceWorld(input,{...options,memoryBudgetBytes:estimateSurfaceCompileBytes(input.terrain,2,3,false)})).toThrow(/memoryBudget/);
  });
  it('resolves one fixed world response across zooms, tiles, compact binary references and JSON hydration',()=>{
    const base=compileSurfaceWorld(surfaceLayerInput(),{topographicRadiiM:[32,64,128]});
    const fine=(x:number,z:number,n:number,d:number)=>({...base.terrain,originX:x,originZ:z,width:n,height:n,spacingM:d,heights:new Float32Array(n*n).fill(130)});
    const a=retargetSurfaceWorld(base,fine(100,120,33,3)),b=retargetSurfaceWorld(a,fine(115,135,33,1));
    expect(a.groundResponse).toBeUndefined();expect(a.canonicalContext!.groundResponse).toBe(base.groundResponse);expect(b.canonicalContext!.groundResponse).toBe(base.groundResponse);
    const point=[123.123,145.55] as const,expected=sampleSurface(base,...point).surfaceLayers.ground;
    expect(sampleSurface(a,...point).surfaceLayers.ground).toEqual(expected);expect(sampleSurface(b,...point).surfaceLayers.ground).toEqual(expected);
    const full=hydrateSurfaceWorld(decodeSurfaceBinary(encodeSurfaceBinary(b)));expect(sampleSurface(full,...point).surfaceLayers.ground).toEqual(expected);
    const compact=JSON.parse(serializeSurfaceWorld(b,{includeCanonicalContext:false}));expect(compact).not.toHaveProperty('groundResponse');
    const restored=hydrateSurfaceWorld(compact,{resolveCanonicalContext:()=>a.canonicalContext});expect(sampleSurface(restored,...point).surfaceLayers.ground).toEqual(expected);
    expect(deserializeSurfaceWorld(serializeSurfaceWorld(base)).groundResponse!.id).toBe(base.groundResponse!.id);
    const invalid=JSON.parse(serializeSurfaceWorld(base));delete invalid.groundResponse.fields.gravity;expect(()=>hydrateSurfaceWorld(invalid)).toThrow(/ground response/);
  });
  it('bounds the exact-knot branch discontinuity by recorded sRGB8 half-step and Float32 parameter quantization',()=>{
    const world=compileSurfaceWorld(surfaceLayerInput(),{topographicRadiiM:[32,64,128]}),decode=(v:number)=>{const s=v/255;return s<=.04045?s/12.92:Math.pow((s+.055)/1.055,2.4);};
    let maximum=0;
    for(let i=0;i<17*17;i++){
      const x=i%17*32,z=Math.floor(i/17)*32,encoded=world.fields.groundMaterialMeanColor![i],mean=sampleSurface(world,x,z).surfaceLayers.ground!.meanColorLinear;
      const halfSteps=[encoded&255,encoded>>>8&255,encoded>>>16&255].map(b=>Math.max(decode(Math.min(255,b+.5))-decode(b),decode(b)-decode(Math.max(0,b-.5))));
      const bound=Math.hypot(...halfSteps)+0.000002; // explicit Float32-potential arithmetic allowance
      for(const[dx,dz]of [[x===512?-1e-8:1e-8,0],[0,z===512?-1e-8:1e-8],[x===512?-1e-8:1e-8,z===512?-1e-8:1e-8]]){
        const nearby=sampleSurface(world,x+dx,z+dz).surfaceLayers.ground!.meanColorLinear,delta=Math.hypot(...mean.map((v,c)=>v-nearby[c]));maximum=Math.max(maximum,delta);expect(delta).toBeLessThanOrEqual(bound);
      }
    }
    expect(maximum).toBeGreaterThan(0); // Quantized knots are deliberately not hidden by smoothing.
  });
  it('handles a saturated valid fraction when four spatial weights sum one Float64 ulp above one',()=>{
    const{world,response}=fixture();response.fields.moisturePreSaturation.fill(1);world.fields.organic.fill(1);
    const fx=2/997,fz=662/991,weights=[(1-fx)*(1-fz),fx*(1-fz),(1-fx)*fz,fx*fz];
    expect(weights.reduce((a,b)=>a+b,0)).toBeGreaterThan(1);
    const sample=createGroundResponseSampler(response,world.fields,world.materials,world.geology.units)([0,1,2,3],weights,0);
    expect(sample.mean.every(Number.isFinite)).toBe(true);
    response.fields.moisturePreSaturation.fill(1.01);expect(()=>createGroundResponseSampler(response,world.fields,world.materials,world.geology.units)([0,1,2,3],weights,0)).toThrow(/fractions/);
  });
});
