/** Authored CPU interoperability fixtures, not fresh Infinite Generation evidence. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {compileSurfaceWorld,retargetSurfaceWorld,sampleSurface,serializeSurfaceWorld} from '../src/surface/compiler';
import {encodeSurfaceBinary} from '../src/surface/binary';
import {surfaceLayerInput} from '../tests/fixtures/surfaceLayerInput';
const {values}=parseArgs({options:{out:{type:'string'}}});
if(!values.out)throw Error('--out NEW_FIXTURE_DIRECTORY');
const out=resolve(values.out);mkdirSync(out,{recursive:true});
const input=surfaceLayerInput();input.terrain.source.id+='-é🌲;string:';
const options={topographicRadiiM:[32,64,128]},canonical=compileSurfaceWorld(input,options);
const refined=retargetSurfaceWorld(canonical,{...input.terrain,originX:96,originZ:128,width:33,height:33,spacingM:4,heights:new Float32Array(33*33).fill(135)});
const moved=surfaceLayerInput();moved.terrain.originX+=1e9;moved.terrain.originZ-=1e9;
const rebased=compileSurfaceWorld(moved,options),legacy=compileSurfaceWorld(surfaceLayerInput(),{...options,groundResponse:false});
const points:Array<[number,number]>=[[0,0],[32,32],[112.3,215.7],[128,160],[255.5,180.25],[511.5,511.5]];
for(let i=0;i<80;i++)points.push([i*73%512+.125,i*137%512+.25]);
for(let z=0;z<17;z++)for(let x=0;x<17;x++){
  points.push([x*32,z*32]);
  const dx=x===16?-1e-8:1e-8,dz=z===16?-1e-8:1e-8;
  points.push([x*32+dx,z*32],[x*32,z*32+dz],[x*32+dx,z*32+dz]);
}
const expected:any={scope:'Authored two-substrate physical fixture; no neural generation/observed fine soils claimed',worlds:{}};
expected.framingCases=[['a;string:b','c'],['a','b;string:c'],['a\0b','c'],['a','\0bc'],['é🌲','\0;string:x']].map(values=>{
  const h=createHash('sha256'),u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);h.update(b);};h.update(Buffer.from([3]));u32(values.length);
  const stringsUtf16Bytes=values.map(s=>Buffer.from(s,'utf16le'));for(const b of stringsUtf16Bytes){h.update(Buffer.from([1]));u32(b.length);h.update(b);}
  return{stringsUtf16Bytes:stringsUtf16Bytes.map(b=>Array.from(b)),sha256:h.digest('hex')};
});
for(const[name,world]of Object.entries({canonical,refined,rebased,legacy})){
  writeFileSync(resolve(out,name+'.json'),serializeSurfaceWorld(world));writeFileSync(resolve(out,name+'.surfacebin'),encodeSurfaceBinary(world));
  expected.worlds[name]={responseId:world.groundResponse?.id??world.canonicalContext?.groundResponse?.id,canonicalVersion:world.versions.groundResponse,
    samples:points.filter(([x,z])=>name!=='refined'||x>=96&&x<=224&&z>=128&&z<=256).map(([x,z])=>{
      x+=name==='rebased'?1e9:0;z+=name==='rebased'?-1e9:0;const sample=sampleSurface(world,x,z).surfaceLayers.ground!;
      return{x,z,primary:world.materials.indexOf(sample.material),secondary:world.materials.indexOf(sample.materialSecondary),blend:sample.materialBlend,mean:sample.meanColorLinear};})};
}
writeFileSync(resolve(out,'expected.json'),JSON.stringify(expected,null,2)+'\n');console.log(JSON.stringify({out,worlds:Object.keys(expected.worlds),samples:points.length}));
