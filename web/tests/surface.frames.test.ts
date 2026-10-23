import { describe,expect,it,vi } from 'vitest';
import type { Decor } from '../src/ui/decor';
import { cropTerrain } from '../src/ui/benchTerrainTransfer';
import { compileFromDecor,exportSurfacePacket } from '../src/surface/adapters/export';
import { resolveSurfaceFrame,assertSurfaceLiveFrame } from '../src/surface/adapters/frame';
import { createTiltedStrataScenario } from '../src/surface/geologyScenario';
import { withSurfaceGeologyQuery } from '../src/surface/adapters/geology';
import { prepareSurfaceDecorWorkerSource } from '../src/ui/surfaceWorkerSource';
import { decodeSurfaceBinary } from '../src/surface/binary';
import { registrationFieldFingerprint } from '../src/surface/registrationBinding';
function source():Decor {
 const scenario=createTiltedStrataScenario({basalContactElevationM:5,dipRadians:0.2});
 return {meta:{id:'full-native-source',seed:'source-seed',created:'2026-10-23',label:'Original',query:withSurfaceGeologyQuery('width=80&style=atlas',scenario),
  width:80,tags:{relief:'flat'},stats:{},settlements:[],waterSvg:'',regeneration:{query:'width=80',crops:[]}},
  raster:{n:8,width:80,height:Float32Array.from({length:64},(_,i)=>i%8*25+Math.floor(i/8)*2),water:new Uint8Array(64),waterLevel:new Float32Array(64),riverWidth:new Float32Array(64),riverIds:new Int32Array(64),
  geometry:{land:[],water:[[[{x:20,y:10},{x:50,y:10},{x:50,y:40},{x:20,y:40}]]]}}} as unknown as Decor;
}
describe('source crop and coordinate-frame export contract',()=>{
 it('restores UI crop coordinates and keeps physical contacts under a common frame translation',()=>{
  const full=source(),snapshot=structuredClone(full),crop=cropTerrain(full,20,10,40);
  const original=compileFromDecor(full),cropped=exportSurfacePacket(crop,undefined,{encoding:'binary',candidateLimit:10000});
  const translated=exportSurfacePacket(crop,undefined,{encoding:'binary',candidateLimit:10000,originX:1000,originZ:-2000});
  expect([cropped.world.terrain.originX,cropped.world.terrain.originZ]).toEqual([25,15]);
  expect([translated.world.terrain.originX,translated.world.terrain.originZ]).toEqual([1025,-1985]);
  expect(translated.world.geology.bedrock).toEqual(cropped.world.geology.bedrock);
  for(let z=0;z<4;z++)for(let x=0;x<4;x++)expect(cropped.world.geology.bedrock[z*4+x]).toBe(original.geology.bedrock[(z+1)*8+x+2]);
  expect((translated.world.geology as any).scenario.originX).toBe((cropped.world.geology as any).scenario.originX+1000);
  expect((translated.world.geology as any).scenario.originZ).toBe((cropped.world.geology as any).scenario.originZ-2000);
  expect(cropped.source.sourceToWorldTranslation).toEqual({x:20,z:10});
  expect(translated.source.sourceToWorldTranslation).toEqual({x:1020,z:-1990});
  expect(cropped.source.frame.fullSource).toMatchObject({id:'full-native-source',widthM:80});
  expect(cropped.source.frame.liveCompatible).toBe(false);
  expect(cropped.source.retainedField.fingerprint).toBe(registrationFieldFingerprint({n:crop.raster.n,width:crop.raster.width,data:crop.raster.height}));
  expect(full).toEqual(snapshot);
 });
 it('keeps cumulative source origin through repeated UI crops',()=>{
  const full=source(),once=cropTerrain(full,20,10,40),twice=cropTerrain(once,10,10,20);
  expect(resolveSurfaceFrame(twice).terrainSourceOrigin).toEqual({x:30,z:20});
  expect(resolveSurfaceFrame(twice).geometrySourceOrigin).toEqual({x:30,z:20});
  expect(resolveSurfaceFrame(twice).fullSource.widthM).toBe(80);
  expect([...twice.raster.height]).toEqual([full.raster.height[19],full.raster.height[20],full.raster.height[27],full.raster.height[28]]);
 });
 it('distinguishes CLI global vectors and rejects live crop initialization before registration',()=>{
  const full=source(),cropped=cropTerrain(full,20,10,40);
  const cli={...cropped,meta:{...cropped.meta,pipeline:{...cropped.meta.pipeline,crop:{...cropped.meta.pipeline!.crop!,coordinateFrame:'source-global'}}},raster:{...cropped.raster,geometry:full.raster.geometry}} as Decor;
  expect(resolveSurfaceFrame(cli).geometrySourceOrigin).toEqual({x:0,z:0});
  expect(resolveSurfaceFrame(cli).terrainSourceOrigin).toEqual({x:20,z:10});
  expect(()=>assertSurfaceLiveFrame(full)).not.toThrow();
  expect(()=>assertSurfaceLiveFrame(cropped)).toThrow('full un-cropped');
  expect(()=>prepareSurfaceDecorWorkerSource({decor:cropped,providerId:'source'})).toThrow('full un-cropped');
  expect(resolveSurfaceFrame(full,{originX:1}).liveCompatible).toBe(false);
 });
 it('runs the actual export worker with crop origin, descriptor and retained field identity',async()=>{
  const crop=cropTerrain(source(),20,10,40),replies:any[]=[];
  const scope={onmessage:undefined as any,postMessage:(value:any)=>replies.push(value)};vi.stubGlobal('self',scope);
  try {
   await import('../src/ui/surfaceExport.worker');scope.onmessage({data:{decor:crop}});
   expect(replies[0].error).toBeUndefined();
   const packet:any=decodeSurfaceBinary(new Uint8Array(replies[0].binary));
   expect([packet.world.terrain.originX,packet.world.terrain.originZ]).toEqual([25,15]);
   expect(packet.source.frame.liveCompatible).toBe(false);
   expect([packet.source.water.cornerX,packet.source.water.cornerZ]).toEqual([20,10]);
   expect(packet.source.retainedField.n).toBe(4);
  } finally {vi.unstubAllGlobals();}
 });
});
