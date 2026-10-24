import {describe,it,expect}from'vitest';
import{compileSurfaceWorld,serializeSurfaceWorld,deserializeSurfaceWorld}from'../src/surface/compiler';
import{Occupation}from'../src/surface/model';
import{surfaceLayerInput}from'./fixtures/surfaceLayerInput';
import{fingerprint}from'../src/surface/hash';
import baseline from './fixtures/surface-layer-legacy-baseline.json';
import{SURFACE_LAYER_FIELDS}from'../src/surface/surfaceLayers';

describe('natural ground beneath source infrastructure',()=>{
  it('keeps mapped soil/rock under coarse Built/Road/Yard exclusions rather than inventing paving',()=>{
    const input=surfaceLayerInput(),n=input.terrain.heights.length;
    const natural=compileSurfaceWorld({...input,occupation:{version:'natural',classes:new Uint8Array(n)}});
    for(const occupation of[Occupation.Built,Occupation.Road,Occupation.Yard]){
      const world=compileSurfaceWorld({...input,occupation:{version:'occupied',classes:new Uint8Array(n).fill(occupation)}}),f=world.fields;
      for(const key of['groundMaterial','groundMaterialSecondary','groundMaterialBlend','groundMaterialMeanColor']as const)expect(f[key]).toEqual(natural.fields[key]);
      expect(new Set(f.groundMaterialMeanColor).size).toBeGreaterThan(10);
      for(const key of['groundMaterial','groundMaterialSecondary']as const)for(const id of f[key]!)expect(['built-foundation','compacted-road','snow-ice','inland-water']).not.toContain(world.materials[id].id);
      expect(f.lowCoverOpacity!.every(v=>v===0)).toBe(true);expect(f.treeCover.every(v=>v===0)).toBe(true);
      expect(f.occupation.every(v=>v===occupation)).toBe(true);expect(world.terrain.heights).toEqual(input.terrain.heights);
      // Legacy composition remains a compatibility output, including its original artificial overrides.
      const dry=f.waterClass.findIndex(v=>v===0);expect(world.materials[f.material[dry]].id).toBe(occupation===Occupation.Built?'built-foundation':'compacted-road');
      expect(deserializeSurfaceWorld(serializeSurfaceWorld(world)).fields.groundMaterialMeanColor).toEqual(f.groundMaterialMeanColor);
    }
  });
  it('retains explicit cultivation and versions only the changed derived layer, not physical candidate lineage',()=>{
    const input=surfaceLayerInput(),world=compileSurfaceWorld(input,{topographicRadiiM:[32,64,128]}),crop=input.occupation!.classes.findIndex(v=>v===Occupation.Crop);
    expect(world.materials[world.fields.groundMaterial![crop]].id).toBe('cultivated-soil');
    expect(world.compilerVersion).toBe('surface-1.6.0');expect(world.diagnostics.assumptions.some(v=>v.includes('natural-under-infrastructure-1'))).toBe(true);
    const original={...world.fields};for(const key of SURFACE_LAYER_FIELDS)delete original[key];
    expect(fingerprint(original)).toBe(baseline.fieldsFingerprint);
  });
});
