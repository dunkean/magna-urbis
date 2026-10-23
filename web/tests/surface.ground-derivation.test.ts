import{describe,it,expect}from'vitest';import{compileSurfaceWorld}from'../src/surface/compiler';import{deriveNaturalGroundFields}from'../src/surface/groundSupport';import{surfaceLayerInput}from'./fixtures/surfaceLayerInput';import{fingerprint}from'../src/surface/hash';
describe('bare-ground derivation from retained physical context',()=>{
 it('is byte-exact with compiler including custom process masks, climate arrays and routed deposits',()=>{
  for(const custom of[false,true]){
   const input=surfaceLayerInput(),n=input.terrain.heights.length;
   if(custom){input.processes={aeolianSupply:Float32Array.from({length:n},(_,i)=>(i%9)/8),coastDistanceM:Float32Array.from({length:n},(_,i)=>1000+(i%17)*7),volcanic:Uint8Array.from({length:n},(_,i)=>Number(i%13===0))};input.climate={...input.climate!,temperatureC:Float32Array.from({length:n},(_,i)=>13.321+i*.0023),precipitationMm:Float32Array.from({length:n},(_,i)=>801.123+i*.47)};}
   const world=compileSurfaceWorld(input),before=fingerprint(world.fields),rebuilt=deriveNaturalGroundFields(world.terrain,world.fields,world.geology,world.climate,world.materials,{processes:input.processes});
   for(const key of Object.keys(rebuilt)as(keyof typeof rebuilt)[])expect(rebuilt[key]).toEqual(world.fields[key]);expect(fingerprint(world.fields)).toBe(before);
  }
 });
 it('rejects missing aligned support and invalid source routing without editing the source',()=>{
  const world=compileSurfaceWorld(surfaceLayerInput()),before=fingerprint(world.fields);
  expect(()=>deriveNaturalGroundFields({...world.terrain,width:99},world.fields,world.geology,world.climate,world.materials)).toThrow(/aligned/);
  const f={...world.fields,downstream:world.fields.downstream.slice()};f.downstream[0]=0;
  expect(()=>deriveNaturalGroundFields(world.terrain,f,world.geology,world.climate,world.materials)).toThrow(/routing/);expect(fingerprint(world.fields)).toBe(before);
 });
});
