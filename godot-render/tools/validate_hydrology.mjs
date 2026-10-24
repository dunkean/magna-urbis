import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../tiles/',import.meta.url));
const catalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(catalog.tiles.length,42);
let totalRivers=0,totalLakes=0;
for(const entry of catalog.tiles){
 const dir=path.join(root,entry.id),meta=JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8')),h=meta.hydrology;
 assert.equal(h.engine,'vector');assert.equal(h.riverMode,'vector');assert.equal(h.balance,true);assert.equal(h.layers.length,5);
 assert.equal(h.sourceHeightSha256,meta.heightSha256);
 assert.deepEqual(entry.hydrology,h);
 const raw=await readFile(path.join(dir,meta.height)),surface=await readFile(path.join(dir,h.surface)),map=await readFile(path.join(dir,meta.map));
 assert.equal(sha(raw),meta.heightSha256);assert.equal(sha(surface),h.surfaceSha256);assert.equal(sha(map),h.mapSha256);
 assert.equal(raw.length,1334**2*4);assert.equal(surface.length,raw.length);
 const svg=await readFile(path.join(dir,h.svg),'utf8');assert(svg.includes('<path'));assert(!svg.includes('<image'));
 const network=JSON.parse(await readFile(path.join(dir,h.network),'utf8'));
 assert.equal(network.rivers.rivers.length,h.rivers);assert(h.rivers>0);
 for(const line of [...network.rivers.rivers,...network.rivers.braids,...network.rivers.distributaries,...network.rivers.oxbows]){
  assert.equal(line.points.length,line.area.length*2);assert.equal(line.level.length,line.area.length);
  assert(line.points.every(Number.isFinite));assert(line.level.every(Number.isFinite));
 }
 const grids=gunzipSync(await readFile(path.join(dir,h.grids.file))),count=meta.n**2;
 let bytes=0;
 for(const field of Object.values(h.grids.fields)){assert.equal(field.offset,bytes);bytes+=field.bytes}
 assert.equal(grids.length,bytes);
 const fields=h.grids.fields;let lakeCells=0;
 for(let c=0;c<count;c++){
  const r=grids.readInt32LE(fields.receiver.offset+c*4);assert(r>=-1&&r<count);
  const accumulation=grids.readFloatLE(fields.accumulation.offset+c*4);assert(Number.isFinite(accumulation)&&accumulation>=0);
  const wet=grids[fields.lake.offset+c];let expected=raw.readFloatLE(c*4);
  if(wet){lakeCells++;expected=Math.max(expected,grids.readFloatLE(fields.lakeLevel.offset+c*4))}
  assert(Number.isFinite(expected));assert.equal(surface.readFloatLE(c*4),expected);
 }
 assert.equal(lakeCells,h.wetCells);
 for(const layer of h.layers){
  const png=await readFile(path.join(dir,layer.file));assert.equal(png.toString('ascii',1,4),'PNG');
  assert.equal(png.readUInt32BE(16),meta.n);assert.equal(png.readUInt32BE(20),meta.n);assert(layer.legend);
 }
 totalRivers+=h.rivers;totalLakes+=h.lakes;
 console.log('VALID '+meta.id);
}
const checks=catalog.families.map(f=>{
 const dry=catalog.tiles.find(t=>t.id===f.id+'--arid').hydrology,wet=catalog.tiles.find(t=>t.id===f.id+'--tropical').hydrology;
 assert(dry.rivers<wet.rivers&&dry.riverKm<wet.riverKm,'Arid/tropical density: '+f.id);
 return {family:f.id,aridRivers:dry.rivers,tropicalRivers:wet.rivers,aridKm:dry.riverKm,tropicalKm:wet.riverKm};
});
const report={status:'passed',tiles:42,layers:210,totalRivers,totalLakes,climateChecks:checks,checkedAt:new Date().toISOString()};
await writeFile(path.join(root,'validation-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
