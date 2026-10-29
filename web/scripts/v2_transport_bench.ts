/** Real retained project, lossless worker/render transport comparison. No app build required. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {parseProject} from '../src/v2/project';
import {renderProjection,arrayBufferBytes} from '../src/v2/renderProjection';
import {generationWorldInput} from '../src/v2/workerWorld';
import {renderSvg} from '../src/render/svg';
import assert from 'node:assert/strict';

const input=process.argv[2]??'out/v2-rust-browser/01-layout.json';
const sourceBytes=await readFile(input),sourceText=input.endsWith('.gz')?gunzipSync(sourceBytes).toString('utf8'):sourceBytes.toString('utf8');const project=parseProject(sourceText),world=project.world!;assert(world);
const projected=renderProjection(world),before={id:2,action:'town',settings:project.settings,world,key:'main'},after={id:2,action:'town',settings:project.settings,...generationWorldInput('town',world,{id:1,world}),key:'main'};
const bench=(value:unknown)=>{const times:number[]=[];for(let i=0;i<9;i++){global.gc?.();const t=performance.now();const cloned=structuredClone(value);times.push(performance.now()-t);assert(cloned);}times.sort((a,b)=>a-b);return Number(times[4].toFixed(3));};
const flags={width:200,raster:false,contours:true,landuse:true,labels:true,cartouche:false,legend:false};
const originalSvg=renderSvg(world,flags),projectedSvg=renderSvg(projected,flags);assert.equal(projectedSvg,originalSvg);
const result={time:new Date().toISOString(),source:input,sourceBytes:Buffer.byteLength(sourceText),sourceSha256:createHash('sha256').update(sourceText).digest('hex'),terrainResolution:world.terrain.height.w,checks:{svgByteIdentical:true,svgSha256:createHash('sha256').update(originalSvg).digest('hex'),sourceBufferStillAttached:world.terrain.height.data.byteLength>0},render:{beforeBytes:arrayBufferBytes(world),afterBytes:arrayBufferBytes(projected),beforeCloneMedianMs:bench(world),afterCloneMedianMs:bench(projected)},repeatedGenerationInput:{beforeBytes:arrayBufferBytes(before),afterBytes:arrayBufferBytes(after),beforeCloneMedianMs:bench(before),afterCloneMedianMs:bench(after)},limitations:['Node structuredClone measures copying, not browser scheduling or total generation time.','A single canonical generation snapshot stays in the worker; imported projects explicitly release the previous snapshot.','Main-thread scientific/project data remains complete. No source buffer is transferred or detached.']};
await mkdir('out/v2-optimization',{recursive:true});await writeFile('out/v2-optimization/transport-input.project.json.gz',gzipSync(sourceText,{level:3}));Object.assign(result,{retainedInput:'out/v2-optimization/transport-input.project.json.gz'});await writeFile('out/v2-optimization/transport.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
