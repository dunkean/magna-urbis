// Check display headwater masks without changing any hydrology or tile metadata.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {HEADWATER_PROFILE} from './river_headwaters.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tiles');
const sha=b=>createHash('sha256').update(b).digest('hex');
const catalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
let count=0;
for(const tile of catalog.tiles){
 const dir=path.join(root,path.dirname(tile.file));
 const meta=JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8'));
 const footprint=JSON.parse(await readFile(path.join(dir,'surface-river-footprint.json'),'utf8'));
 const networkBytes=await readFile(path.join(dir,meta.hydrology.network)),network=JSON.parse(networkBytes);
 assert.deepEqual(footprint.profile,HEADWATER_PROFILE);
 assert.equal(footprint.sourceNetworkSha256,sha(networkBytes));
 assert.equal(footprint.sha256,sha(await readFile(path.join(dir,'surface-river-footprint.png'))));
 assert.equal(meta.groundSurface.sources.riverMask,footprint.sha256);
 const ids=new Set();
 for(const source of footprint.sources){
  const line=network.rivers.rivers.find(l=>l.id===source.id&&l.points[0]===source.x&&l.points[1]===source.y);
  assert(line,'Retained source exists');
  assert(!ids.has(source.id),'One taper per original source');ids.add(source.id);
  assert(line.area[0]<=network.settings.riverArea*1e6*2);
  assert(source.reachMetres>0&&source.reachMetres<=HEADWATER_PROFILE.maximumReachMetres);
  assert(source.visibleSourceWidthMetres<=HEADWATER_PROFILE.minimumWidthMetres);
  assert(source.visibleSourceWidthMetres<=source.initialWidthMetres);
  count++;
 }
}
assert.equal(catalog.tiles.length,42);
console.log(JSON.stringify({status:'passed',tiles:42,taperedHeadwaters:count}));
