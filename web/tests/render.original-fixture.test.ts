import{describe,it,expect,vi}from'vitest';
import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';
import{TerrainGl,renderOriginalShaderSources}from'../src/ui/terrainGl';
import{copyUpload,textureDescriptor}from'../src/ui/renderOriginalFixture';
describe('original Render reference boundary',()=>{
 it('keeps all original GLSL literal bodies byte-identical',()=>{
  const before=execFileSync('git',['show','f2298841d9fe09729df02f8ecc92e7ffbefa6505:web/src/ui/terrainGl.ts'],{encoding:'utf8'});
  // ECMAScript template literals normalize checkout CRLF to LF at runtime.
  const after=readFileSync(new URL('../src/ui/terrainGl.ts',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  for(const name of ['TERRAIN_VS','TERRAIN_FS','RIVER_VS','RIVER_FS','COMPOSITE_VS','COMPOSITE_FS']){
   const expression=new RegExp('const '+name+' = `([\\s\\S]*?)`;');
   expect(after.match(expression)?.[1],name).toBe(before.match(expression)?.[1]);
  }
  const shaders=renderOriginalShaderSources();expect(Object.keys(shaders)).toEqual(['terrain','river','composite','renderWater']);
  expect(shaders.terrain.fragment.length).toBe(73415);expect(shaders.renderWater.fragment.length).toBe(4157);
 });
 it('copies the exact view slice and describes every mip byte',()=>{
  const source=new Float32Array([1,2,3,4,5,6]);const view=source.subarray(1,5);const copy=copyUpload(view);source[1]=99;
  expect(Array.from(new Float32Array(copy.buffer))).toEqual([2,3,4,5]);
  const descriptor=textureDescriptor({key:'height',width:2,height:2,format:'RF',glFormat:'R32F',levels:[copy,new Uint8Array(4)],sampler:{min:'NEAREST_MIPMAP_NEAREST',mag:'NEAREST',wrapS:'CLAMP_TO_EDGE',wrapT:'CLAMP_TO_EDGE'}});
  expect(descriptor.mips).toEqual([{width:2,height:2,byteOffset:0,byteLength:16},{width:1,height:1,byteOffset:16,byteLength:4}]);
 });
 it('captures fixed-DPR 2D without mesh3d/look mutation and flips only reference rows',()=>{
  const fake=Object.create(TerrainGl.prototype) as any;
  const sourceLook={style:'render',mesh3d:false};const previous={view:{cx:3,cy:4,scale:1},width:2,height:2};
  let drawn=0;const frames:any[]=[];const pixels:any[]=[];
  Object.assign(fake,{base:{layer:{}},look:sourceLook,view:previous,details:[],enhanced:[],canvas:{width:2,height:2},originalPendingClears:new Set(),originalTextures:new Map(),originalRivers:new Float32Array(),originalWaterSvg:'',originalWaterWidth:0});
  fake.gl={isContextLost:()=>false,FRAMEBUFFER:1,RGBA:2,UNSIGNED_BYTE:3,bindFramebuffer:()=>{},readPixels:(_x:any,_y:any,_w:any,_h:any,_f:any,_t:any,out:Uint8Array)=>out.set([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255])};
  fake.renderTarget=()=>({framebuffer:{},texture:{}});
  fake.draw=()=>{drawn++;frames.push({look:fake.look,view:fake.view});if(fake.originalRecording)fake.originalRecording.push({program:'terrain',uniforms:{uEnhanced3d:0},textures:{},target:'screen',primitive:'TRIANGLE_STRIP',instances:1,blend:{},viewport:[0,0,2,2]})};
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({putImageData:(v:any)=>pixels.push(v)})})});
  vi.stubGlobal('ImageData',class{constructor(public data:any,public width:number,public height:number){}});
  try{
   const capture=fake.captureExact2D({width:2,height:2,view:{cx:5,cy:6,scale:2}});
   expect(capture.rgba).toEqual(new Uint8Array([7,8,9,255,10,11,12,255,1,2,3,255,4,5,6,255]));
   expect(fake.look).toBe(sourceLook);expect(fake.view).toBe(previous);expect(drawn).toBe(2);
   expect(frames.every(f=>f.look===sourceLook)).toBe(true);expect(capture.fixture.draws[0].uniforms.uEnhanced3d).toBe(0);
   expect(capture.fixture.outputTarget).toBe('screen');expect(pixels).toHaveLength(1);
  }finally{vi.unstubAllGlobals()}
 });
});
