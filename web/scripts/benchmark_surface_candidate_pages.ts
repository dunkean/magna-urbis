import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {decodeSurfaceBinary,encodeSurfaceBinary} from '../src/surface/binary';
import {generateSurfaceCandidatePages} from '../src/surface/candidatePages';
import {packCandidateColumns,unpackCandidateColumns} from '../src/surface/candidateColumns';
import {validateSurfacePacket} from '../src/surface/packet';
import type {SurfaceWorld} from '../src/surface/model';

const args=process.argv.slice(2),arg=(key:string)=>args[args.indexOf(key)+1];
if(!args.includes('--source')||!args.includes('--refinement')||!args.includes('--out'))throw new Error('Usage: --source canonical.surfacebin --refinement small-live.surfacebin --out DIR [--width 4000]');
const sourcePath=resolve(arg('--source')),refinementPath=resolve(arg('--refinement')),out=resolve(arg('--out'));
const width=args.includes('--width')?Number(arg('--width')):4000;
if(!Number.isFinite(width)||width<=0)throw new Error('Invalid width');
mkdirSync(out,{recursive:true});
const hash=(a:Uint8Array)=>createHash('sha256').update(a).digest('hex');
const sourceBytes=readFileSync(sourcePath),refinementBytes=readFileSync(refinementPath);
const original:any=decodeSurfaceBinary(sourceBytes),packet:any=decodeSurfaceBinary(refinementBytes);
validateSurfacePacket(original as unknown);validateSurfacePacket(packet as unknown);
const ctx=packet.world.canonicalContext;if(!ctx)throw new Error('Refinement must include full canonical context');
if(!Buffer.from(encodeSurfaceBinary(ctx.fields)).equals(encodeSurfaceBinary(original.world.fields)))throw new Error('Source canonical physical fields differ from retained live context');
const source=original.world as SurfaceWorld,t=source.terrain;
if(ctx.grid.width!==t.width||ctx.grid.height!==t.height||ctx.grid.originX!==t.originX||ctx.grid.originZ!==t.originZ||ctx.grid.spacingM!==t.spacingM)throw new Error('Canonical source grid differs');
// Registration binds the immutable retained raster to this live generation.
// Alias identity only in the private sampler, never in the exported packet.
const canonical:SurfaceWorld={...source,terrain:{...t,source:{...t.source,id:packet.world.terrain.source.id,version:packet.world.terrain.source.version}}};
const strip=(p:any)=>{const{candidates,candidateColumns,candidateBounds,candidatePages,...rest}=p;return rest};
const before=encodeSurfaceBinary(strip(packet)),cx=(ctx.bounds.minX+ctx.bounds.maxX)/2,cz=(ctx.bounds.minZ+ctx.bounds.maxZ)/2;
const view={minX:cx-width/2,minZ:cz-width/2,maxX:cx+width/2,maxZ:cz+width/2};
const began=performance.now(),rssBefore=process.memoryUsage().rss;
const result=generateSurfaceCandidatePages(canonical,view,{canonicalContextId:ctx.id,fineTerrain:packet.world.terrain,parentTerrain:packet.terrainParents?.[0]?.terrain});
const queryMs=performance.now()-began;
const old=packet.candidateColumns?unpackCandidateColumns(packet.candidateColumns):packet.candidates??[];
packet.candidateColumns=packCandidateColumns(result.candidates);delete packet.candidates;
packet.candidateBounds=result.candidateBounds;packet.candidatePages=result.candidatePages;
const after=encodeSurfaceBinary(strip(packet));if(!Buffer.from(before).equals(after))throw new Error('Packet outside candidate fields changed');
validateSurfacePacket(packet as unknown);
const newCandidates=unpackCandidateColumns(packet.candidateColumns),byid=new Map(newCandidates.map(c=>[c.stableId,c]));
let shared=0,yChanges=0;
for(const c of old){const next=byid.get(c.stableId);if(!next)continue;shared++;
  const{y,...a}=c,{y:nextY,...b}=next;if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Shared stable candidate changed');if(y!==nextY)yChanges++;
}
const bytes=encodeSurfaceBinary(packet),file=resolve(out,'retained-candidate-pages.surfacebin');writeFileSync(file,bytes);
const report={format:'surface-candidate-pages-cpu-benchmark',version:1,status:'passed',scope:'CPU retained/replay, not fresh generation, refinement or GPU evidence. Eligibility from exact canonical fields; Y from saved fine source inside its support, then saved actual parent/canonical heights.',
  input:{sourcePath,sourceSha256:hash(sourceBytes),refinementPath,refinementSha256:hash(refinementBytes)},output:{file,bytes:bytes.length,sha256:hash(bytes)},
  queryMs,rssBefore,rssAfter:process.memoryUsage().rss,view,candidatePages:result.candidatePages,
  invariants:{allOtherPacketBytesIdentical:true,immutablePacketSha256:hash(before),canonicalFieldsExact:true,worldId:packet.world.id,sharedStableCandidates:shared,sharedIdentitiesExact:true,sharedSupportYChanges:yChanges,oldCandidateCount:old.length,newCandidateCount:newCandidates.length},
  limits:['Complete inventory applies only to each declared family bounds; no full-world coverage claim.','Raw native RSS includes binary input/context/archive copies; it is not the page algorithm workspace alone.']};
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
