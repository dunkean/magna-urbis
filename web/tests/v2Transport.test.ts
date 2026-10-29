import {describe,it,expect} from 'vitest';
import {WorkerWorld,generationWorldInput} from '../src/v2/workerWorld';
import {renderProjection,arrayBufferBytes} from '../src/v2/renderProjection';
import {sameDisplay} from '../src/v2/displayState';
import {defaultSettings} from '../src/v2/settings';
import {generateTerrain} from '../src/v2/engine';
import {renderSvg} from '../src/render/svg';
import type {World} from '../src/gen/types';
import {parseProjectInput,serializeProject} from '../src/v2/project';

describe('V2 bounded worker state and render transport',()=>{
  it('omits unused inputs for new worlds and reuses only the exact canonical snapshot',()=>{
    const world={} as World,other={}as World,retained={id:7,world};
    expect(generationWorldInput('all',world,retained)).toEqual({});expect(generationWorldInput('terrain',world,retained)).toEqual({});
    expect(generationWorldInput('town',world,retained)).toEqual({retainedWorldId:7});
    expect(generationWorldInput('town',other,retained)).toEqual({world:other});expect(generationWorldInput('town',world)).toEqual({world});
  });
  it('retains one source, keeps failed requests from replacing it, and releases imported sources',()=>{
    const state=new WorkerWorld(),first={}as World,second={}as World;state.retain(1,first);
    expect(state.resolve(1,undefined)).toBe(first);expect(state.resolve(undefined,second)).toBe(second);expect(state.resolve(1,undefined)).toBe(first);
    expect(()=>state.resolve(99,undefined)).toThrow(/expired/);state.retain(2,second);expect(()=>state.resolve(1,undefined)).toThrow();
    state.clear();expect(()=>state.resolve(2,undefined)).toThrow();expect(state.resolve(undefined,undefined)).toBeUndefined();
  });
  it('keeps every SVG geometry and label while omitting native archives and input buffers',async()=>{
    const settings=defaultSettings();settings.runtime={backend:'typescript',compute:'cpu',source:'procedural'};settings.extent=600;settings.options.coast='none';settings.options.river='none';
    const world=await generateTerrain(settings);const buffer=new Float32Array(1024*1024);
    Object.assign(world.terrain,{v2NativeTerrain:{height:buffer},v2ForestField:{rgba:new Uint8Array(1024*1024)},v2NaturalForest:buffer});
    world.options.importedHeight={w:1024,h:1024,rgba:new Uint8Array(0),elevations:buffer};world.debug={v2RustCities:{main:{plan_archives:{test:'native evidence'}}}};
    const rendered=renderProjection(world);expect(rendered.terrain.height).toBe(world.terrain.height);expect(rendered.debug).toBeUndefined();expect(rendered.options.importedHeight).toBeUndefined();
    expect(rendered.terrain).not.toHaveProperty('v2NativeTerrain');expect(world.terrain).toHaveProperty('v2NativeTerrain');expect(buffer.byteLength).toBe(4*1024*1024);
    expect(arrayBufferBytes(rendered)).toBeLessThan(arrayBufferBytes(world));
    for(const style of ['parchment','atlas','topographic']as const){const options={width:80,style,raster:false,contours:true,landuse:true,legend:false,cartouche:false};expect(renderSvg(rendered,options)).toBe(renderSvg(world,options));}
  });
  it('counts aliased views once and detects real layer/display changes',()=>{
    const bytes=new ArrayBuffer(100),value={a:new Uint8Array(bytes),b:new Float32Array(bytes),c:bytes};expect(arrayBufferBytes(value)).toBe(100);
    expect(sameDisplay({style:'atlas',layers:{city:true,roads:false}},{style:'atlas',layers:{roads:false,city:true}})).toBe(true);
    expect(sameDisplay({style:'atlas',contours:true},{style:'atlas',contours:false})).toBe(false);expect(sameDisplay({style:'atlas',layers:{city:true}},{style:'atlas',layers:{city:false}})).toBe(false);
  });
  it('accepts seed JSON whitespace and escapes without a second project parse',()=>{
    const text=' '.repeat(12000)+'{"format":"magna\\u002durbis-v2-seed","version":1,"seed":"a <world> & b"}';
    const seed=parseProjectInput(text);expect(seed.settings.options.seed).toBe('a <world> & b');expect(seed.world).toBeUndefined();expect(seed.mods).toEqual([]);
    const settings=defaultSettings();expect(parseProjectInput(serializeProject(settings)).settings).toEqual(settings);
    expect(()=>parseProjectInput('{"format":"magna-urbis-v2-seed","version":2,"seed":"test"}')).toThrow();
  });
});
