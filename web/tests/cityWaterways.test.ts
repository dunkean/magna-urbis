import { describe,it,expect } from 'vitest';
import type { Layout,Shape } from '../../rust/bridge/urban';
import { city3dWaterways } from '../src/render/city3dQuays';

describe('retained lagoon water',()=>{
  it('retains the channel footprint and seats crossings above its water',()=>{
    const shape:Shape={outer:[{x:0,y:0},{x:30,y:0},{x:30,y:4},{x:0,y:4}],holes:[]};
    const crossing:Shape={outer:[{x:10,y:-1},{x:12,y:-1},{x:12,y:5},{x:10,y:5}],holes:[]};
    const layouts=[{culture:'venetian-lagoon',structure:{waterways:[{shape,levelM:3,crossings:[crossing]}]}}] as unknown as Layout[];
    const [water,bridge]=city3dWaterways(layouts);
    expect(water.footprint).toEqual([shape]);expect(bridge.footprint).toEqual([crossing]);
    expect(water.volumes[0].roof_mesh.faces.every(f=>f.material==='city3d:water@8aaeb8')).toBe(true);
    expect(Math.min(...bridge.volumes[0].roof_mesh.vertices.map(p=>p.z))).toBeGreaterThan(Math.max(...water.volumes[0].roof_mesh.vertices.map(p=>p.z)));
  });
});
