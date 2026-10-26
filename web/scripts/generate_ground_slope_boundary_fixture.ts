/** Authored numeric edge fixture, never a fresh IG or current-provider claim. */
import{mkdirSync,writeFileSync}from'node:fs';import{resolve}from'node:path';import{parseArgs}from'node:util';import{createHash}from'node:crypto';import assert from'node:assert/strict';
import{compileSurfaceWorld,serializeSurfaceWorld,deserializeSurfaceWorld}from'../src/surface/compiler';
const{values}=parseArgs({options:{out:{type:'string'}}});if(!values.out)throw Error('--out required');const out=resolve(values.out);mkdirSync(out,{recursive:true});const rows=[];
for(const c of [{name:'ordinary-finite-cliff',rise:1000,spacing:.25},{name:'near-vertical-microscopic-horizontal',rise:20,spacing:1e-7}]){
 const width=3,heights=Float32Array.from({length:9},(_,i)=>i%width*c.rise),before=new Uint8Array(heights.buffer.slice(0));
 const world=compileSurfaceWorld({seed:3,terrain:{width,height:width,originX:0,originZ:0,spacingM:c.spacing,heights,source:{id:'authored-slope-boundary-'+c.name,version:'1',sourceLOD:0,sourceLODKnown:true,nativeSpacingM:c.spacing}},climate:{version:'fixed-elevation-corrected',meanAnnualTempC:14,annualPrecipMm:1000,elevationCorrected:true}},{topographicRadiiM:[1,2]});
 const text=serializeSurfaceWorld(world),roundtrip=deserializeSurfaceWorld(text);assert.deepEqual(new Uint8Array(heights.buffer),before);assert.deepEqual(world.fields,roundtrip.fields);assert.deepEqual(world.terrain,roundtrip.terrain);assert.deepEqual(world.versions,roundtrip.versions);writeFileSync(resolve(out,c.name+'.json'),text);
 rows.push({...c,compiled:true,tsRoundtrip:true,maximumSlope:Math.max(...world.fields.slope),mathematicalPiHalf:Math.PI/2,float32PiHalf:Math.fround(Math.PI/2),aboveMathematicalBound:world.fields.slope.some(v=>v>Math.PI/2),allPhysicalAndTerrainRoundtripExact:true,sourceHeightsUnchanged:true,worldId:world.id,groundResponseId:world.groundResponse!.id,worldJsonSha256:createHash('sha256').update(text).digest('hex')});
}
writeFileSync(resolve(out,'ts-report.json'),JSON.stringify({scope:'Unmodified finite compilation, no edited fields/hash. Microscopic near-vertical case is not current IG output.',rows},null,2)+'\n');console.log(JSON.stringify(rows));
