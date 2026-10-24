import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {convertProgram,std140} from './export_render_original_shaders.ts';

test('std140 scalar, vec3 tail packing, arrays and column-major matrices match fixed byte examples',()=>{
  assert.deepEqual(std140('float'),{alignment:4,stride:4,byteLength:4});
  assert.deepEqual(std140('vec3'),{alignment:16,stride:12,byteLength:12});
  assert.deepEqual(std140('float',3,true),{alignment:16,stride:16,byteLength:48});
  assert.deepEqual(std140('vec2',1,true),{alignment:16,stride:16,byteLength:16});
  assert.deepEqual(std140('vec3',8,true),{alignment:16,stride:16,byteLength:128});
  assert.deepEqual(std140('mat3'),{alignment:16,stride:48,byteLength:48,matrixStride:16});
  assert.deepEqual(std140('mat2x3',2,true),{alignment:16,stride:32,byteLength:64,matrixStride:16});
  assert.throws(()=>std140('double'),/Unsupported/);
});
const fixture={
  vertex:`#version 300 es
precision highp float;
uniform vec3 uVector; uniform float uScalar;
out vec2 vUV; flat out ivec2 vCode;
const float ROT[2] = float[2](0.3, 1.1);
void main() { vUV=vec2(gl_VertexID & 1, gl_VertexID >> 1); vCode=ivec2(1); gl_Position=vec4(vUV, 0., 1.); }
`,
  fragment:`#version 300 es
precision highp float; precision highp int;
uniform vec2 uCanvas; uniform float uValues[3];
uniform sampler2D uImage;
flat in ivec2 vCode; in vec2 vUV;
out vec4 outColor;
float unchanged(float x, out float result) { result=x*x; return result; }
void main() { vec2 px=vec2(gl_FragCoord.x, uCanvas.y-gl_FragCoord.y); outColor=vec4(vUV+px, 0., 1.); }
`,
};
test('union UBO uses the same layout in both stages, without altering original function bytes',()=>{
  const r=convertProgram('fixture',fixture);
  assert.equal(r.layout.uniformByteLength,80);
  assert.deepEqual(r.layout.uniforms.map(v=>[v.name,v.offset,v.stride]),[['uVector',0,12],['uScalar',12,4],['uCanvas',16,8],['uValues',32,16]]);
  for(const stage of ['vertex','fragment']){
    assert.ok(r[stage].startsWith('#version 450\n'));
    assert.ok(r[stage].includes('layout(offset = 12) float uScalar;'));
    assert.ok(!r[stage].includes('precision highp'));
    assert.equal(r.layout.stages[stage].functionCount,stage==='vertex'?1:2);
  }
  assert.ok(r.vertex.includes('const float ROT[2] = float[2](0.3, 1.1);'));
  assert.ok(r.vertex.includes('gl_Position=vec4(vUV, 0., 1.);'));
  assert.ok(r.fragment.includes('vec2 px=vec2(gl_FragCoord.x, uCanvas.y-gl_FragCoord.y);'));
  assert.ok(r.fragment.includes('float unchanged(float x, out float result) { result=x*x; return result; }'));
  assert.equal(r.layout.samplers[0].binding,1);
});
test('flat varying locations follow vertex outputs despite a different fragment declaration order',()=>{
  const r=convertProgram('fixture',fixture);
  assert.deepEqual(r.layout.varyings.map(v=>[v.name,v.location,v.qualifier]),[['vUV',0,''],['vCode',1,'flat']]);
  assert.ok(r.vertex.includes('layout(location = 1) flat out ivec2 vCode;'));
  assert.ok(r.fragment.includes('layout(location = 1) flat in ivec2 vCode;'));
  assert.throws(()=>convertProgram('fixture',{...fixture,fragment:fixture.fragment.replace('flat in ivec2','flat in ivec3')}),/varying mismatch/);
});
test('comments and function out parameters are not mistaken for global shader declarations',()=>{
  const source={...fixture,fragment:fixture.fragment.replace('float unchanged','// uniform vec4 fake; out vec4 wrong;\nfloat unchanged')};
  const r=convertProgram('fixture',source);
  assert.equal(r.layout.uniforms.length,4);
  assert.equal(r.layout.varyings.length,2);
  assert.ok(r.fragment.includes('// uniform vec4 fake; out vec4 wrong;'));
});
test('conflicting uniforms and a V2 source are refused before producing an unrelated renderer',()=>{
  assert.throws(()=>convertProgram('fixture',{...fixture,fragment:fixture.fragment.replace('uniform vec2 uCanvas;','uniform vec4 uVector;')}),/Conflicting uniform/);
  assert.throws(()=>convertProgram('fixture',{...fixture,fragment:fixture.fragment+'\nuniform int uRenderV2;'}),/RenderV2/);
});
const ref=process.env.RENDER_ORIGINAL_REFERENCE_ROOT;
test('all eight real shader stages regenerate exactly and river instances use the nine-float SSBO',{skip:!ref},async()=>{
  const api=await import(pathToFileURL(join(ref,'web/src/ui/terrainGl.ts')).href);
  const sources=api.renderOriginalShaderSources();
  const output=resolve('../godot-render/shaders'),saved=JSON.parse(readFileSync(join(output,'shader_layout.json'),'utf8'));
  for(const name of ['terrain','river','composite','renderWater']){
    const r=convertProgram(name,sources[name]);assert.deepEqual(r.layout,saved.programs[name]);
    for(const stage of ['vertex','fragment'])assert.equal(r[stage],readFileSync(join(output,r.layout[stage]),'utf8'));
  }
  const river=saved.programs.river;
  assert.deepEqual(river.buffers,[{name:'RiverInstances',binding:3,type:'storage',strideBytes:36,scalarType:'float',scalarsPerInstance:9,stages:['vertex']}]);
  const vertex=readFileSync(join(output,river.vertex),'utf8');
  assert.ok(vertex.includes('int riverOffset = gl_InstanceIndex * 9;'));
  for(let i=1;i<9;i++)assert.ok(vertex.includes(`riverOffset+${i}`));
  assert.ok(!/layout\(location = \d+\) in /.test(vertex));
  assert.deepEqual(river.varyings.map(v=>[v.name,v.location,v.qualifier]),[['vP',0,''],['vSeg',1,'flat'],['vHalf',2,'flat'],['vColor',3,'flat']]);
});
