import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir,cp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTuft,accessor,ingest,sha256 } from './surface_vegetation_assets.mjs';
function fixture() {
  const bytes=Buffer.alloc(3*3*4*2+3*2*4+3*2);
  let at=0;for(const n of [2,1,3,4,1,3,2,3,3,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1]) {bytes.writeFloatLE(n,at);at+=4;}
  for(const i of [0,1,2]) {bytes.writeUInt16LE(i,at);at+=2;}
  return {bytes,doc:{nodes:[{name:'tuft',mesh:0,translation:[200,0,0]}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3}]}],
    bufferViews:[{buffer:0,byteOffset:0},{buffer:0,byteOffset:36},{buffer:0,byteOffset:72},{buffer:0,byteOffset:96}],
    accessors:[{bufferView:0,count:3,type:'VEC3',componentType:5126},{bufferView:1,count:3,type:'VEC3',componentType:5126},{bufferView:2,count:3,type:'VEC2',componentType:5126},{bufferView:3,count:3,type:'SCALAR',componentType:5123}]}};
}
test('source tuft has measured height, centered root, CW indices and unchanged normals/UVs',()=>{
  const {doc,bytes}=fixture(),before=sha256(bytes),snapshot=JSON.stringify(doc),p=prepareTuft(doc,bytes,'tuft');
  assert.deepEqual(p.indices,[0,2,1]);assert.equal(p.triangleCount,1);
  assert.deepEqual(p.normalization.pivot,[3,1,3]);assert.equal(p.normalization.uniformScale,.5);
  assert.deepEqual(p.positions,[-.5,-.5,0,.5,-.5,0,-.5,.5,0]);
  assert.deepEqual(p.normals,[0,0,1,0,0,1,0,0,1]);assert.deepEqual(p.uv,[0,0,1,0,0,1]);
  assert.equal(p.tangents.length,12);assert.equal(p.tangents[0],1);
  assert.equal(sha256(bytes),before);assert.equal(JSON.stringify(doc),snapshot);
});
test('malformed accessor/source transform rejected before preparation',()=>{
  const {doc,bytes}=fixture();doc.nodes[0].scale=[1,2,1];assert.throws(()=>prepareTuft(doc,bytes,'tuft'),/transform/);
  delete doc.nodes[0].scale;doc.accessors[0].count=10000;assert.throws(()=>accessor(doc,bytes,0),/outside/);
});
test('real pinned offline ingestion is deterministic across cache paths and rejects byte edits',async t=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)), source=path.join(root,'web/out/vegetation-assets/source');
  try{await readFile(path.join(source,'grass_medium_01.bin'));}catch {t.skip('run ingestion first for real CC0 parity test');return;}
  const temporary=await mkdtemp(path.join(tmpdir(),'mu-vegetation-'));
  try{
    const a=path.join(temporary,'a'),b=path.join(temporary,'b');await mkdir(a);await mkdir(b);
    await cp(source,path.join(a,'source'),{recursive:true});await cp(source,path.join(b,'source'),{recursive:true});
    const catalogue=path.join(root,'surface/vegetation/catalogue.json');
    const first=await ingest(catalogue,a,true),second=await ingest(catalogue,b,true);
    assert.equal(first.digest,second.digest);assert.equal(first.assets[0].product.sha256,second.assets[0].product.sha256);
    const product=JSON.parse(await readFile(path.join(a,first.assets[0].product.path),'utf8'));
    assert.deepEqual(product.variants.map(v=>v.triangleCount),[28,40,79]);
    for(const v of product.variants){assert.equal(Math.min(...v.positions.filter((_,i)=>i%3===1)),-.5);assert.equal(Math.max(...v.positions.filter((_,i)=>i%3===1)),.5);}
    const edit=path.join(a,'source/grass_medium_01.bin'),bytes=await readFile(edit);bytes[0]^=1;await writeFile(edit,bytes);
    await assert.rejects(ingest(catalogue,a,true),/edited source/);
  }finally{await rm(temporary,{recursive:true,force:true});}
});
