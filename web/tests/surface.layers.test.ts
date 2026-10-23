import {describe,it,expect} from 'vitest';
import {compileSurfaceWorld,deserializeSurfaceWorld,estimateSurfaceCompileBytes,hydrateSurfaceWorld,retargetSurfaceWorld,sampleSurface,serializeSurfaceWorld} from '../src/surface/compiler';
import {decodeSurfaceBinary,encodeSurfaceBinary} from '../src/surface/binary';
import {generateSurfaceCandidates} from '../src/surface/population';
import {fingerprint} from '../src/surface/hash';
import {Occupation,WaterClass,type SurfaceWorld} from '../src/surface/model';
import {hasExplicitSurfaceLayers,LEGACY_SURFACE_LAYERS_WARNING,selectSurfaceLayerView,SURFACE_LAYER_FIELDS} from '../src/surface/surfaceLayers';
import {surfaceLayerInput} from './fixtures/surfaceLayerInput';
import baseline from './fixtures/surface-layer-legacy-baseline.json';
import {packMaterialMean,unpackMaterialMean}from'../src/surface/materials';

const compile=()=>compileSurfaceWorld(surfaceLayerInput(),{topographicRadiiM:[32,64,128]});
const bounds={minX:32,minZ:32,maxX:480,maxZ:480};
function fine(originX=96,originZ=96){const t=surfaceLayerInput().terrain;return{...t,width:33,height:33,spacingM:4,originX,originZ,
  heights:Float32Array.from({length:33*33},(_,i)=>130+Math.sin(i%33)*.02),source:{...t.source,nativeSpacingM:4,sourceLOD:-1}};}

describe('explicit soil, low-cover and tree layers',()=>{
  it('premultiplies translucent low cover so arbitrary transparent litter cannot tint grass in sampling or retargeting',()=>{
    const source=surfaceLayerInput().terrain,world=compileSurfaceWorld({seed:2,terrain:{...source,width:2,height:2,heights:new Float32Array(4).fill(100)}});
    const f=world.fields;if(!hasExplicitSurfaceLayers(f))throw Error();
    const grass=world.materials.findIndex(m=>m.id==='vegetation-litter'),litter=world.materials.findIndex(m=>m.id==='forest-litter');
    const green=packMaterialMean([.1,.3,.04]),brown=packMaterialMean([.3,.08,.02]);
    f.lowCoverMaterial.fill(litter);f.lowCoverMaterialSecondary.fill(litter);f.lowCoverMaterialBlend.fill(0);f.lowCoverMaterialMeanColor.fill(packMaterialMean([1,0,1]));
    f.lowCoverOpacity.fill(0);f.lowCoverOpacity[0]=1;f.lowCoverMaterial[0]=grass;f.lowCoverMaterialSecondary[0]=grass;f.lowCoverMaterialMeanColor[0]=green;
    const a=sampleSurface(world,16,16).surfaceLayers.lowCover!;expect(a.opacity).toBe(.25);expect(a.material.id).toBe('vegetation-litter');expect(a.materialSecondary.id).toBe('vegetation-litter');expect(a.meanColorLinear).toEqual(unpackMaterialMean(green));
    f.lowCoverMaterialMeanColor[1]=packMaterialMean([0,0,1]);f.lowCoverMaterialMeanColor[2]=0;
    expect(sampleSurface(world,16,16).surfaceLayers.lowCover).toEqual(a);
    f.lowCoverOpacity[0]=.2;f.lowCoverOpacity[1]=.8;f.lowCoverMaterialMeanColor[1]=brown;
    const sample=sampleSurface(world,16,16).surfaceLayers.lowCover!,alpha=(f.lowCoverOpacity[0]+f.lowCoverOpacity[1])*.25;
    expect(sample.opacity).toBe(alpha);expect(sample.material.id).toBe('forest-litter');expect(sample.materialSecondary.id).toBe('vegetation-litter');expect(sample.materialBlend).toBeCloseTo(.2,6);
    const expected=unpackMaterialMean(green).map((v,c)=>(v*f.lowCoverOpacity[0]+unpackMaterialMean(brown)[c]*f.lowCoverOpacity[1])/(alpha*4));
    sample.meanColorLinear.forEach((value,c)=>expect(value).toBeCloseTo(expected[c],12));
    const refined=retargetSurfaceWorld(world,{...world.terrain,originX:16,originZ:16,spacingM:1,heights:new Float32Array(4).fill(100),source:{...world.terrain.source,nativeSpacingM:1}});
    expect(refined.fields.lowCoverMaterial![0]).toBe(litter);expect(refined.fields.lowCoverMaterialBlend![0]).toBeCloseTo(.2,6);expect(refined.fields.lowCoverOpacity![0]).toBeCloseTo(alpha,6);
    expect(refined.fields.lowCoverMaterialMeanColor![0]).toBe(packMaterialMean(expected));
    f.lowCoverOpacity.fill(0);expect(sampleSurface(world,16,16).surfaceLayers.lowCover!.meanColorLinear).toEqual([0,0,0]);
  });
  it('preserves all pre-layer physical fields, legacy composition, source geometry and exact candidate acceptance/IDs',()=>{
    const world=compile(),originalFields={...world.fields};for(const key of SURFACE_LAYER_FIELDS)delete originalFields[key];
    expect(fingerprint(originalFields)).toBe(baseline.fieldsFingerprint);
    expect(world.geometryDetail?.id).toBe(baseline.geometryId);
    const candidates=generateSurfaceCandidates(world,bounds);expect(candidates).toHaveLength(baseline.candidateCount);
    expect(fingerprint(candidates)).toBe(baseline.candidateFingerprint);
    expect(world.terrain.heights).toEqual(surfaceLayerInput().terrain.heights);
  });
  it('exposes bare substrate/soil under herbs and litter, including mapped rock rather than a uniform mineral replacement',()=>{
    const world=compile(),f=world.fields;expect(hasExplicitSurfaceLayers(f)).toBe(true);if(!hasExplicitSurfaceLayers(f))throw Error();
    expect(world.surfaceLayers?.groundAvailability).toBe('explicit');
    const green=f.grassCover.findIndex((v,i)=>v>.1&&f.lowCoverOpacity[i]>.2);expect(green).toBeGreaterThanOrEqual(0);
    for(const id of [...f.groundMaterial,...f.groundMaterialSecondary])expect(world.materials[id].surfaceRole).toBe('ground');
    for(const id of [...f.lowCoverMaterial,...f.lowCoverMaterialSecondary])expect(world.materials[id].surfaceRole).toBe('low-cover');
    expect(new Set(f.groundMaterial)).toContain(world.materials.findIndex(m=>m.id==='fractured-bedrock'));
    const west=sampleSurface(world,96,256).surfaceLayers.ground!,east=sampleSurface(world,448,256).surfaceLayers.ground!;
    expect(west.meanColorLinear).not.toEqual(east.meanColorLinear);
    expect(west.material.surfaceRole).toBe('ground');expect(east.material.surfaceRole).toBe('ground');
  });
  it('partitions only low support, respects rock/water/construction and permits crowns above that same ground',()=>{
    const world=compile(),f=world.fields;if(!hasExplicitSurfaceLayers(f))throw Error();
    for(let i=0;i<f.lowCoverOpacity.length;i++){
      const rock=Math.max(0,Math.min(1,(f.stoniness[i]-.08)/.75));
      expect(f.lowCoverOpacity[i]).toBeGreaterThanOrEqual(0);expect(f.lowCoverOpacity[i]).toBeLessThanOrEqual(1-rock+1e-6);
      if(f.waterClass[i]!==WaterClass.Dry||[Occupation.Road,Occupation.Yard,Occupation.Built].includes(f.occupation[i]))expect(f.lowCoverOpacity[i]).toBe(0);
    }
    expect(f.treeCover.some((v,i)=>v+f.lowCoverOpacity[i]>1)).toBe(true);
    const lake=17+1;expect(world.materials[f.groundMaterial[lake]].surfaceRole).toBe('ground');expect(world.materials[f.material[lake]].surfaceRole).toBe('water');
  });
  it('turns herbs/trees on and off as optical selection without changing ground, fields, heights or stable inventory',()=>{
    const world=compile(),before=fingerprint(world.fields),height=fingerprint(world.terrain),candidates=fingerprint(generateSurfaceCandidates(world,bounds));
    const physical=sampleSurface(world,96,256).surfaceLayers;expect(physical.lowCover!.opacity).toBeGreaterThan(0);expect(physical.trees.crownCover).toBeGreaterThan(0);
    for(const lowCover of [false,true])for(const trees of [false,true]){
      const view=selectSurfaceLayerView(physical,{lowCover,trees});expect(view.ground).toBe(physical.ground);
      expect(view.lowCover?.opacity).toBe(lowCover?physical.lowCover?.opacity:0);expect(view.trees.crownCover).toBe(trees?physical.trees.crownCover:0);
    }
    expect(fingerprint(world.fields)).toBe(before);expect(fingerprint(world.terrain)).toBe(height);
    expect(fingerprint(generateSurfaceCandidates(world,bounds))).toBe(candidates);
  });
  it('keeps the layers and bare-soil mean independent from seasonal optical wetness/snow state',()=>{
    const input=surfaceLayerInput(),a=compileSurfaceWorld(input),b=compileSurfaceWorld({...input,state:{version:'snow-day',dayOfYear:5,snowWaterEquivalentM:.3,surfaceWetness:.8}});
    for(const key of SURFACE_LAYER_FIELDS)expect(b.fields[key]).toEqual(a.fields[key]);
    expect(b.fields.snow).not.toEqual(a.fields.snow);expect(b.fields.wetness).not.toEqual(a.fields.wetness);
  });
  it('retargets semantic layer mixtures continuously while exact fixed-coordinate samples and candidate identity stay canonical',()=>{
    const world=compile(),a=retargetSurfaceWorld(world,fine()),b=retargetSurfaceWorld(world,fine(100,100));
    expect(a.versions.surfaceLayers).toBe(world.versions.surfaceLayers);expect(b.versions.surfaceLayers).toBe(world.versions.surfaceLayers);
    expect(a.surfaceLayers?.fieldsVersion).not.toBe(world.surfaceLayers?.fieldsVersion);
    for(const[x,z]of[[112.1,130.3],[160,192],[217.9,201.2]]){
      const expected=sampleSurface(world,x,z).surfaceLayers;expect(sampleSurface(a,x,z).surfaceLayers).toEqual(expected);expect(sampleSurface(b,x,z).surfaceLayers).toEqual(expected);
    }
    const patch={minX:104,minZ:104,maxX:216,maxZ:216};
    expect(generateSurfaceCandidates(a,patch).map(({y,...c})=>c)).toEqual(generateSurfaceCandidates(world,patch).map(({y,...c})=>c));
    const restored=deserializeSurfaceWorld(serializeSurfaceWorld(a));expect(restored.surfaceLayers).toEqual(a.surfaceLayers);
  });
  it('preserves exact typed fields in binary hydration and restores JSON with explicit semantic metadata',()=>{
    const world=compile(),decoded=decodeSurfaceBinary<{world:SurfaceWorld}>(encodeSurfaceBinary({world})).world;
    const original=Object.fromEntries(SURFACE_LAYER_FIELDS.map(key=>[key,decoded.fields[key]]));const hydrated=hydrateSurfaceWorld(decoded);
    for(const key of SURFACE_LAYER_FIELDS){expect(hydrated.fields[key]).toBe(original[key]);expect(hydrated.fields[key]).toEqual(world.fields[key]);}
    const json=deserializeSurfaceWorld(serializeSurfaceWorld(world));expect(json.surfaceLayers).toEqual(world.surfaceLayers);
    expect(sampleSurface(json,112.3,215.7).surfaceLayers).toEqual(sampleSurface(world,112.3,215.7).surfaceLayers);
    expect(estimateSurfaceCompileBytes(world.terrain,2,3)-baseline.compileBytes).toBe(28*world.terrain.heights.length);
    expect(()=>compileSurfaceWorld(surfaceLayerInput(),{topographicRadiiM:[32,64,128],memoryBudgetBytes:baseline.compileBytes})).toThrow(/memoryBudget/);
  });
  it('rejects partial, truncated, wrong-type, wrong-role, unbounded or edited layer fields and metadata',()=>{
    const world=compile();
    for(const alter of [(w:any)=>delete w.fields.groundMaterial,(w:any)=>w.fields.lowCoverOpacity.pop(),(w:any)=>w.fields.lowCoverOpacity[0]=1.01,
      (w:any)=>w.fields.groundMaterialBlend[0]=null,(w:any)=>w.fields.groundMaterialMeanColor[0]^=1,
      (w:any)=>w.surfaceLayers.fieldsVersion='edited',(w:any)=>w.surfaceLayers.groundAvailability='legacy-composite-unavailable',
      (w:any)=>w.fields.groundMaterial[0]=w.materials.findIndex((m:any)=>m.id==='vegetation-litter')]){
      const value=JSON.parse(serializeSurfaceWorld(world));alter(value);expect(()=>hydrateSurfaceWorld(value)).toThrow();
    }
    const typed=structuredClone(world);typed.fields.groundMaterial=new Uint32Array(world.fields.groundMaterial!) as any;expect(()=>hydrateSurfaceWorld(typed)).toThrow();
  });
  it('announces legacy mixed-only input rather than inventing bare ground, including refined packets',()=>{
    const value=JSON.parse(serializeSurfaceWorld(compile()));for(const key of SURFACE_LAYER_FIELDS)delete value.fields[key];
    delete value.surfaceLayers;delete value.versions.surfaceLayers;value.compilerVersion='surface-1.4.0';
    value.id=fingerprint([value.versions.environment,value.versions.occupation,value.versions.population,value.versions.materialLibrary,value.versions.surfaceState,value.seed].join(':'));
    const legacy=hydrateSurfaceWorld(value);expect(legacy.surfaceLayers?.groundAvailability).toBe('legacy-composite-unavailable');
    expect(legacy.diagnostics.warnings).toContain(LEGACY_SURFACE_LAYERS_WARNING);expect(sampleSurface(legacy,128,128).surfaceLayers.ground).toBeUndefined();
    const refined=retargetSurfaceWorld(legacy,fine());expect(refined.fields.groundMaterial).toBeUndefined();
    expect(deserializeSurfaceWorld(serializeSurfaceWorld(refined)).surfaceLayers?.lowCoverAvailability).toBe('legacy-composite-unavailable');
    const forged=JSON.parse(serializeSurfaceWorld(legacy));forged.surfaceLayers.groundAvailability='explicit';expect(()=>hydrateSurfaceWorld(forged)).toThrow(/claims/);
  });
});
