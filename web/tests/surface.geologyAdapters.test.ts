import { describe, expect, it } from 'vitest';
import { applySurfaceGeology, copySurfaceGeologyQuery, surfaceGeologyScenario, withSurfaceGeologyQuery } from '../src/surface/adapters/geology';
import { createTiltedStrataScenario, rockUnitAtScenario } from '../src/surface/geologyScenario';
import { decorToSurfaceInput, worldToSurfaceInput } from '../src/surface/adapters/magna';
import { magnaSurfacePresentation } from '../src/surface/presentation';
import { PALETTES } from '../src/render/styles';
import { compileFromDecor, exportSurfaceInputPacket, exportSurfacePacket } from '../src/surface/adapters/export';
import { prepareSurfaceDecorWorkerSource } from '../src/ui/surfaceWorkerSource';
import type { Decor } from '../src/ui/decor';

function decor(query = ''): Decor {
  return { meta: { id: 'actual-source-id', seed: 'original-seed', created: '2026-10-23', query },
    raster: { n: 8, width: 80, height: Float32Array.from({ length: 64 }, (_, i) => (i % 8) * 30 + Math.floor(i / 8) * 5 - 40),
      water: new Uint8Array(64), waterLevel: new Float32Array(64), riverWidth: new Float32Array(64), riverIds: new Int32Array(64) } } as Decor;
}
function crop(source: Decor, x: number, z: number, n: number): Decor {
  const r = source.raster, cut = (values: any) => { const out = new values.constructor(n*n); for (let j=0;j<n;j++) out.set(values.subarray((z+j)*r.n+x,(z+j)*r.n+x+n),j*n); return out; };
  return { meta: structuredClone(source.meta), raster: { ...r, n, width:n*r.width/r.n, height:cut(r.height), water:cut(r.water), waterLevel:cut(r.waterLevel), riverWidth:cut(r.riverWidth), riverIds:cut(r.riverIds) } };
}

describe('explicit shared source geology', () => {
  it('keeps missing geology uniform and explicitly unobserved, without opting in from terrain or climate', () => {
    const d=decor('climate=arid&relief=mountain');
    expect(surfaceGeologyScenario(d.meta.query)).toBeUndefined();
    expect(decorToSurfaceInput(d).geology).toBeUndefined();
    const world=compileFromDecor(d);
    expect((world.geology as any).scenario).toBeUndefined();
    expect(new Set(world.geology.bedrock).size).toBe(1);
    expect(world.geology.provenance).toContain('not inferred');
  });
  it('evaluates the same fixed descriptor only after source crop and common frame offsets', () => {
    const scenario=createTiltedStrataScenario({ originX:0,originZ:0,basalContactElevationM:15 });
    const d=decor(withSurfaceGeologyQuery('style=atlas',scenario)), original=structuredClone(d);
    const full=compileFromDecor(d,{originX:1000,originZ:-2000});
    const partial=compileFromDecor(crop(d,2,1,4),{terrainOriginX:20,terrainOriginZ:10,originX:1000,originZ:-2000});
    for(let z=0;z<4;z++)for(let x=0;x<4;x++)expect(partial.geology.bedrock[z*4+x]).toBe(full.geology.bedrock[(z+1)*8+x+2]);
    for(let i=0;i<64;i++)expect(full.geology.bedrock[i]).toBe(rockUnitAtScenario(scenario,5+i%8*10,5+Math.floor(i/8)*10,d.raster.height[i]));
    expect(d).toEqual(original);
  });
  it('shares full descriptors and rejects malformed or ambiguous opt-ins', () => {
    const s=createTiltedStrataScenario(), source=withSurfaceGeologyQuery('style=atlas&seed=unchanged',s), target=new URLSearchParams('style=ink');
    copySurfaceGeologyQuery(target,source);
    expect(target.get('style')).toBe('ink'); expect(surfaceGeologyScenario(target)).toEqual(s);
    expect(surfaceGeologyScenario('surface_geology=tilted-strata-v1')).toEqual(s);
    for(const query of ['surface_geology=imagined-rocks','surface_geology_descriptor=%7B%7D','surface_geology=tilted-strata-v1&surface_geology_descriptor=bad','surface_geology=tilted-strata-v1&surface_geology_descriptor=%7B%7D'])expect(()=>surfaceGeologyScenario(query)).toThrow();
    expect(()=>surfaceGeologyScenario('',{...s,dipRadians:Math.PI})).toThrow();
    copySurfaceGeologyQuery(target,''); expect(target.has('surface_geology')).toBe(false);
  });
  it('uses common offline, input-packet and live worker producers and retains shareable overrides', () => {
    const s=createTiltedStrataScenario(), d=decor(withSurfaceGeologyQuery('style=atlas',s));
    const input=decorToSurfaceInput(d), prepared=prepareSurfaceDecorWorkerSource({decor:d,providerId:'retained-source'});
    expect(prepared.input.geology).toEqual(input.geology);
    const packet=exportSurfacePacket(d,undefined,{encoding:'binary',candidateLimit:10000});
    expect(packet.world.geology.bedrock).toEqual(input.geology!.bedrock);
    const override=exportSurfaceInputPacket(decorToSurfaceInput(decor()),undefined,{meta:{query:'style=atlas'}},{encoding:'binary',candidateLimit:10000,geologyScenario:s});
    expect(override.world.geology.bedrock).toEqual(input.geology!.bedrock);
    expect(surfaceGeologyScenario((override.source.meta as any).query)).toEqual(s);
    expect(applySurfaceGeology(input,'')).toBe(input);
  });
  it('retains source 2D routing and flow exactly while allowing the same explicit scenario', () => {
    const receiver=new Int32Array([-1,0,0,1]), flow=new Float32Array([1,2,3,4]), heights=new Float32Array([0,10,20,30]);
    const world={seed:'source-seed',terrain:{height:{w:2,h:2,cell:10,data:heights},receiver,flow:{data:flow},water:new Uint8Array([0,1,2,3])}} as any;
    const identity={id:'source-native-world',version:'generation-v1',sourceLOD:7,nativeSpacingM:10};
    const input=worldToSurfaceInput(world,identity,undefined,{query:'surface_geology=tilted-strata-v1'});
    expect(input.hydrology!.downstream).toEqual(receiver);
    expect(input.hydrology!.contributingAreaM2).toEqual(new Float32Array([100,200,300,400]));
    expect(input.hydrology!.waterClass).toEqual(new Uint8Array([0,3,2,1]));
    expect(input.geology!.version).toContain('tilted-strata-v1:');
    input.hydrology!.downstream![0]=3; expect(receiver[0]).toBe(-1);
    expect(heights).toEqual(new Float32Array([0,10,20,30]));
  });
  it('keeps every existing mapper palette independent of the authored geology opt-in', () => {
    const scenario=createTiltedStrataScenario();
    for(const style of Object.keys(PALETTES)) {
      const query=new URLSearchParams({style}).toString();
      const before=magnaSurfacePresentation(query), after=magnaSurfacePresentation(withSurfaceGeologyQuery(query,scenario));
      expect(after.palette).toEqual(before.palette); expect(after.mapStyle).toBe(before.mapStyle);
      expect(after.policy.materialAssignments).toBe('preserved');
    }
  });
  it('preserves Magna water network identity, levels, class encoding and source geometry across producers', () => {
    const d=decor(); d.raster.height.fill(0); d.raster.water.set([1,2,3]); d.raster.waterLevel.fill(4); d.raster.riverIds.fill(731); d.raster.riverWidth.fill(2);
    d.raster.geometry={rivers:[{id:'source-river-731',points:[[5,5],[15,5]]}]} as any;
    const original=structuredClone(d), input=decorToSurfaceInput(d), packet=exportSurfacePacket(d,undefined,{encoding:'binary',candidateLimit:10000});
    expect([...input.hydrology!.waterClass!].slice(0,3)).toEqual([3,2,1]);
    expect(packet.world.fields.waterClass).toEqual(input.hydrology!.waterClass);
    expect(packet.source.geometry).toEqual(d.raster.geometry);
    expect(packet.source.water.classes).toEqual(d.raster.water); expect(packet.source.water.levelM).toEqual(d.raster.waterLevel); expect(packet.source.water.riverIds).toEqual(d.raster.riverIds);
    expect(packet.source.hydrology.derivedRoutingRole).toContain('never a replacement');
    expect(prepareSurfaceDecorWorkerSource({decor:d,providerId:'retained'}).sourceMetadata?.hydrology).toEqual(packet.source.hydrology);
    expect(d).toEqual(original);
  });
});

