import {afterAll,describe,it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {compileSurfaceWorld,hydrateSurfaceWorld,retargetSurfaceWorld,sampleSurface,serializeSurfaceWorld} from '../src/surface/compiler';
import {hydrateGroundResponse,groundResponseIdentity} from '../src/surface/groundResponse';
import {decodeSurfaceBinary,encodeSurfaceBinary} from '../src/surface/binary';
import {unpackMaterialMean} from '../src/surface/materials';
import {surfaceLayerInput} from './fixtures/surfaceLayerInput';

const base=compileSurfaceWorld(surfaceLayerInput(),{topographicRadiiM:[32,64,128]});
const response=base.groundResponse!;
const expected={grid:response.grid,source:response.source,environmentVersion:response.environmentVersion,materialLibraryVersion:response.materialLibraryVersion,materials:base.materials};
const metrics={scope:'Independent CPU contract audit; no GPU or artistic acceptance',canonicalKnots:0,nearKnotSamples:0,maximumNearKnotQuantizationDeltaLinear:0};
afterAll(()=>{if(process.env.SURFACE_GROUND_AUDIT_REPORT)writeFileSync(process.env.SURFACE_GROUND_AUDIT_REPORT,JSON.stringify(metrics,null,2));});

describe('independent GroundResponse boundary and physical compatibility',()=>{
  it('rejects a legacy catalogue whose rock recipe belongs to marine family',()=>{
    const materialLibrary=structuredClone(base.materials),id=response.fields.rockRecipe[0];
    materialLibrary[id].family='marine';delete materialLibrary[id].surfaceRole;
    expect(()=>{const world=compileSurfaceWorld(surfaceLayerInput(),{materialLibrary});hydrateSurfaceWorld(decodeSurfaceBinary(encodeSurfaceBinary(world)));}).toThrow();
  });
  it('rejects finite JSON values that become nonfinite Float32 after conversion',()=>{
    const corrupted=structuredClone(response);corrupted.fields.aridity[0]=Infinity;corrupted.id=groundResponseIdentity(corrupted);
    const json=JSON.parse(JSON.stringify(corrupted,(_,v)=>ArrayBuffer.isView(v)?Array.from(v as any):v));json.fields.aridity[0]=1e100;
    expect(()=>hydrateGroundResponse(json,expected)).toThrow();
  });
  it('rejects missing, partial, unknown columns, strings and wrong constructors',()=>{
    expect(()=>hydrateGroundResponse(undefined,expected)).toThrow();
    for(const key of Object.keys(response.fields)){
      const value:any=structuredClone(response);delete value.fields[key];expect(()=>hydrateGroundResponse(value,expected)).toThrow();
    }
    const extra:any=structuredClone(response);extra.fields.invented=new Float32Array(289);expect(()=>hydrateGroundResponse(extra,expected)).toThrow();
    for(const wrong of [new Float64Array(289),new Uint16Array(289),Array(289).fill('0')]){
      const value:any=structuredClone(response);value.fields.alluvial=wrong;expect(()=>hydrateGroundResponse(value,expected)).toThrow();
    }
  });
  it('rejects stale hash, frame, source generation, environment and material identities',()=>{
    for(const mutate of [
      (r:any)=>r.fields.alluvial[0]+=.1,(r:any)=>r.grid.originX+=1e9,(r:any)=>r.grid.originZ-=1e9,(r:any)=>r.grid.spacingM/=2,
      (r:any)=>r.source.id+='other',(r:any)=>r.source.version+='new',(r:any)=>r.source.sourceLODKnown='true',
      (r:any)=>r.environmentVersion+='other',(r:any)=>r.materialLibraryVersion+='other',
    ]){const value=structuredClone(response);mutate(value);expect(()=>hydrateGroundResponse(value,expected)).toThrow();}
  });
  it('enforces exact response allocation budget and rejects invalid values',()=>{
    expect(hydrateGroundResponse(structuredClone(response),expected,26*289).id).toBe(response.id);
    for(const budget of [26*289-1,0,-1,NaN,Infinity])expect(()=>hydrateGroundResponse(structuredClone(response),expected,budget)).toThrow();
    for(const key of ['alluvial','gravity','wind','coastal','moisturePreSaturation'] as const){
      for(const value of [-1,1.01,NaN,Infinity]){const r=structuredClone(response);r.fields[key][0]=value;expect(()=>hydrateGroundResponse(r,expected)).toThrow();}
    }
    const arid=structuredClone(response);arid.fields.aridity.fill(12);arid.id=groundResponseIdentity(arid);expect(hydrateGroundResponse(arid,expected).fields.aridity[0]).toBe(12);
  });
  it('keeps all recorded canonical node values exactly and bounds near-knot quantization',()=>{
    for(let z=0;z<17;z++)for(let x=0;x<17;x++){
      const i=z*17+x,node=sampleSurface(base,x*32,z*32).surfaceLayers.ground!;
      expect(node.meanColorLinear).toEqual(unpackMaterialMean(base.fields.groundMaterialMeanColor![i]));
      expect(node.materialBlend).toBe(base.fields.groundMaterialBlend![i]);metrics.canonicalKnots++;
      if(x===16||z===16)continue;
      for(const [dx,dz]of [[1e-7,0],[0,1e-7],[1e-7,1e-7]]){
        const near=sampleSurface(base,(x+dx)*32,(z+dz)*32).surfaceLayers.ground!;
        const delta=Math.max(...near.meanColorLinear.map((v,c)=>Math.abs(v-node.meanColorLinear[c])));
        metrics.maximumNearKnotQuantizationDeltaLinear=Math.max(metrics.maximumNearKnotQuantizationDeltaLinear,delta);metrics.nearKnotSamples++;
        expect(delta).toBeLessThan(.0046);
      }
    }
  });
  it('preserves ground samples under a common large coordinate frame translation',()=>{
    const input=surfaceLayerInput();input.terrain.originX=1e9;input.terrain.originZ=-1e9;
    const shifted=compileSurfaceWorld(input,{topographicRadiiM:[32,64,128]});
    expect(shifted.fields).toEqual(base.fields);
    for(const [x,z]of [[50.25,80.5],[300.125,320.25],[511,400]]){
      const a=sampleSurface(base,x,z).surfaceLayers.ground!,b=sampleSurface(shifted,1e9+x,-1e9+z).surfaceLayers.ground!;
      expect(b.meanColorLinear).toEqual(a.meanColorLinear);expect(b.materialBlend).toBe(a.materialBlend);
    }
  });
  it('resolves exact canonical data across adjacent retarget tiles and rejects a wrong known context',()=>{
    const tile=(x:number)=>({...base.terrain,originX:x,originZ:100,width:33,height:33,spacingM:2,heights:new Float32Array(1089).fill(150)});
    const a=retargetSurfaceWorld(base,tile(100)),b=retargetSurfaceWorld(a,tile(130));
    const expectedSample=sampleSurface(base,150.125,140.25).surfaceLayers.ground;
    expect(sampleSurface(a,150.125,140.25).surfaceLayers.ground).toEqual(expectedSample);expect(sampleSurface(b,150.125,140.25).surfaceLayers.ground).toEqual(expectedSample);
    const compact=JSON.parse(serializeSurfaceWorld(b,{includeCanonicalContext:false}));
    const valid=hydrateSurfaceWorld(structuredClone(compact),{resolveCanonicalContext:()=>a.canonicalContext});expect(sampleSurface(valid,150.125,140.25).surfaceLayers.ground).toEqual(expectedSample);
    const wrong=structuredClone(a.canonicalContext!);wrong.versions.groundResponse='wrong';
    expect(()=>hydrateSurfaceWorld(structuredClone(compact),{resolveCanonicalContext:()=>wrong})).toThrow();
    const noResponse=structuredClone(a.canonicalContext!);delete noResponse.groundResponse;
    expect(()=>hydrateSurfaceWorld(structuredClone(compact),{resolveCanonicalContext:()=>noResponse})).toThrow();
  });
  it('keeps legacy group absence and original byte serialization without inventing response data',()=>{
    const legacy=compileSurfaceWorld(surfaceLayerInput(),{topographicRadiiM:[32,64,128],groundResponse:false}),bytes=encodeSurfaceBinary(legacy);
    const hydrated=hydrateSurfaceWorld(decodeSurfaceBinary(bytes));
    expect(hydrated.groundResponse).toBeUndefined();expect(hydrated.versions.groundResponse).toBeUndefined();expect(encodeSurfaceBinary(hydrated)).toEqual(bytes);
    const partial:any=decodeSurfaceBinary(bytes);partial.groundResponse=response;
    expect(()=>hydrateSurfaceWorld(partial)).toThrow();
    expect(legacy.fields).toEqual(base.fields);expect(legacy.terrain).toEqual(base.terrain);
    for(const key of ['environment','population','occupation','hydrology','geology','terrain','surfaceLayers'] as const)expect(legacy.versions[key]).toBe(base.versions[key]);
  });
});
