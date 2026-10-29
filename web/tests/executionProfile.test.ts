import {describe,it,expect} from 'vitest';
import {applyExecutionProfile} from '../src/ui/executionProfile';
describe('execution profile changes',()=>{
  it('preserves a browser CPU recipe when selecting Web',()=>{
    const url=new URL('http://127.0.0.1/terrainbench.html?profile=local&source=procedural&compute=wasm&generation=cpu&seed=same&localServer=http://127.0.0.1:8795');
    applyExecutionProfile(url,{profile:'web',server:'http://127.0.0.1:8795'});
    expect(Object.fromEntries(url.searchParams)).toEqual({profile:'web',source:'procedural',compute:'wasm',generation:'cpu',seed:'same'});
  });
  it('preserves a deliberate GPU selection in either execution location',()=>{
    const url=new URL('http://127.0.0.1/terrainbench.html?profile=web&source=procedural&compute=gpu-f32&generation=gpu-erosion');
    applyExecutionProfile(url,{profile:'local',server:'http://127.0.0.1:8795'});
    applyExecutionProfile(url,{profile:'web',server:'http://127.0.0.1:8795'});
    expect(url.searchParams.get('compute')).toBe('gpu-f32');expect(url.searchParams.get('generation')).toBe('gpu-erosion');expect(url.searchParams.get('source')).toBe('procedural');
  });
  it('translates the native service to browser CPU without switching the terrain method',()=>{
    const url=new URL('http://127.0.0.1/terrainbench.html?profile=local&source=procedural&compute=wasm&generation=native');
    applyExecutionProfile(url,{profile:'web',server:'http://127.0.0.1:8795'});
    expect(url.searchParams.get('generation')).toBe('cpu');expect(url.searchParams.get('compute')).toBe('wasm');expect(url.searchParams.get('source')).toBe('procedural');
  });
});
