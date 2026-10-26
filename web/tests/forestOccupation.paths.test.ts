import {describe,expect,it} from 'vitest';
import {forestOccupation} from '../src/ui/forestOccupation';
import type {LandUseLayer} from '../src/gen/types';
const layer:LandUseLayer={areas:[{kind:'forest',poly:[{x:0,y:0},{x:400,y:0},{x:400,y:400},{x:0,y:400}]}],reserve:[],farmsteads:[],ways:[[{x:40,y:203},{x:360,y:203}]]};
describe('agricultural lanes in the Render3D occupation',()=>{
 it.each([32,128])('keeps every crossed lane texel free of canopy at resolution %i', maxN=>{
  const texture=forestOccupation(layer,maxN,2)!;
  const sample=(x:number,y:number)=>{const i=Math.floor((x-texture.x)/texture.width*texture.n),j=Math.floor((y-texture.y)/texture.width*texture.n);return texture.rgba.slice((j*texture.n+i)*4,(j*texture.n+i)*4+4);};
  for(let x=50;x<355;x+=5){const pixel=sample(x,203);expect(pixel[2]).toBe(9);expect(pixel[0]).toBeGreaterThan(128);expect(pixel[1]).toBeLessThan(128);expect(pixel[3]).toBe(255);}
  expect(sample(200,100)[1]).toBeGreaterThan(128);
 });
});
