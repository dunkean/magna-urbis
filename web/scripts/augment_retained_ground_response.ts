/** Explicit diagnostic replay, not an automatic legacy migration. Retains every
 * existing array/record and refuses any mismatch with the declared process law. */
import{readFileSync,writeFileSync,mkdirSync,existsSync,statSync}from'node:fs';
import{resolve,join}from'node:path';
import{parseArgs}from'node:util';
import{createHash}from'node:crypto';
import{strict as assert}from'node:assert';
import{decodeSurfaceBinary,encodeSurfaceBinary}from'../src/surface/binary';
import{hydrateSurfaceWorld,getCanonicalSurfaceContext,fingerprint}from'../src/surface/compiler';
import{deriveNaturalGroundFields}from'../src/surface/groundSupport';
import{createGroundResponse}from'../src/surface/groundResponse';
import{validateSurfacePacket}from'../src/surface/packet';
import type{SurfaceWorld}from'../src/surface/model';
const{values}=parseArgs({options:{source:{type:'string'},out:{type:'string'},'processes-none':{type:'boolean'},'floodplain-width-m':{type:'string',default:'150'},'colluvial-decay-m':{type:'string',default:'100'}}});
if(!values.source||!values.out||!values['processes-none'])throw Error('--source ORIGINAL_CANONICAL_PACKET --out NEW_DIRECTORY --processes-none (explicit declaration required)');
const out=resolve(values.out),source=resolve(values.source);if(existsSync(join(out,'packet.surfacebin')))throw Error('Output exists; preserve previous evidence');
if(statSync(source).size>512*1024*1024)throw Error('Input exceeds the512MiB packet limit');
const originalBytes=readFileSync(source),packet=decodeSurfaceBinary<any>(originalBytes),world=hydrateSurfaceWorld(packet.world as SurfaceWorld);
if(world.canonicalContextRef||world.groundResponse)throw Error('This bounded replay requires an original canonical world without response; refined/cropped sources need their explicit canonical compile input');
const immutable=fingerprint(packet),oldContextId=getCanonicalSurfaceContext(world).id;
const declared={externalProcessMasks:'explicit-none',floodplainWidthM:Number(values['floodplain-width-m']),colluvialDecayLengthM:Number(values['colluvial-decay-m'])};
if(!Number.isFinite(declared.floodplainWidthM)||declared.floodplainWidthM<=0||!Number.isFinite(declared.colluvialDecayLengthM)||declared.colluvialDecayLengthM<=0)throw Error('Positive physical lengths required');
const derived=deriveNaturalGroundFields(world.terrain,world.fields,world.geology,world.climate,world.materials,{floodplainWidthM:declared.floodplainWidthM,colluvialDecayLengthM:declared.colluvialDecayLengthM,groundResponse:true});
for(const key of ['groundMaterial','groundMaterialSecondary','groundMaterialBlend','groundMaterialMeanColor']as const){const a=derived[key],b=world.fields[key]!;assert.ok(Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength)),'Declared process law does not reproduce original node array '+key+'; refusing guessed inputs');}
const t=world.terrain,response=createGroundResponse({width:t.width,height:t.height,originX:t.originX,originZ:t.originZ,spacingM:t.spacingM},t.source,world.versions.environment,world.versions.materialLibrary,derived.responseFields!);
const upgraded:SurfaceWorld={...world,compilerVersion:'surface-1.6.0',groundResponse:response,versions:{...world.versions,groundResponse:response.id},
  diagnostics:{...world.diagnostics,estimatedBytes:world.diagnostics.estimatedBytes+26*t.width*t.height,assumptions:[...world.diagnostics.assumptions,'Explicit retained diagnostic augmentation: declared process inputs reproduced all original bare-ground node arrays; continuous response adds no observed fine soils or new source heights.']}};
upgraded.id=fingerprint([upgraded.versions.environment,upgraded.versions.occupation,upgraded.versions.population,upgraded.versions.materialLibrary,upgraded.versions.surfaceState,upgraded.seed,upgraded.versions.surfaceLayers,response.id].join(':'));
const newContextId=getCanonicalSurfaceContext(upgraded).id,bindings:string[]=[];
const result={...packet,world:upgraded,candidatePages:packet.candidatePages?{...packet.candidatePages,support:{...packet.candidatePages.support,canonicalContextId:newContextId}}:undefined};
if(packet.candidatePages){assert.equal(packet.candidatePages.support.canonicalContextId,oldContextId);bindings.push('candidatePages.support.canonicalContextId');}
if(packet.terrainParents?.length)throw Error('Canonical replay unexpectedly contains external parents; use explicit canonical input, do not guess lineage');
validateSurfacePacket(result);hydrateSurfaceWorld(decodeSurfaceBinary<SurfaceWorld>(encodeSurfaceBinary(upgraded)));
assert.equal(fingerprint(packet),immutable,'Original packet mutated');
const unchangedFieldNames=Object.keys(world.fields);for(const key of unchangedFieldNames)assert.equal(fingerprint((world.fields as any)[key]),fingerprint((upgraded.fields as any)[key]));
const unchangedVersionNames=Object.keys(world.versions);for(const key of unchangedVersionNames)assert.equal((world.versions as any)[key],(upgraded.versions as any)[key]);
assert.equal(fingerprint(world.terrain),fingerprint(upgraded.terrain));assert.equal(fingerprint(packet.source),fingerprint(result.source));assert.equal(fingerprint(packet.urban),fingerprint(result.urban));
const bytes=encodeSurfaceBinary(result),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
mkdirSync(out,{recursive:true});writeFileSync(join(out,'packet.surfacebin'),bytes);
writeFileSync(join(out,'report.json'),JSON.stringify({format:'explicit-retained-ground-response-replay',version:1,status:'PASS',source,sourceSha256:sha(originalBytes),output:join(out,'packet.surfacebin'),outputSha256:sha(bytes),outputBytes:bytes.length,declaredInputs:declared,responseId:response.id,oldContextId,newContextId,changedBindings:bindings,
  allOriginalArrayBytesAndRecordsUnchanged:true,unchangedFieldNames,unchangedVersionNames,groundNodesExact:true,sourceHeightsUnchanged:true,originalPacketUnchanged:true,
  parameterProvenance:{alluvial:'retained HAND/distance-to-water/slope; original physical decay law',gravity:'retained downhill routing/source slopes/lithology; original colluvial decay law',wind:'zero: explicitly absent external aeolianSupply mask',coastal:'zero: explicitly absent external coastDistanceM mask',aridity:'retained precipitation/climate/lapse law and actual source heights',moisturePreSaturation:'retained TWI/soil fractions/slope plus reconstructed original alluvial/aridity',rockRecipe:'retained substrate/source fields and explicit absent external karst/volcanic/geothermal masks'},
  scope:'Declared retained diagnostic replay only. Original canonical input byte stream is not claimed reconstructed. Node agreement is a required guard, not proof of unknown process absence. No generation, registration, source refinement, population regeneration or observed fine-soil claim.'},null,2)+'\n');
console.log(JSON.stringify({output:join(out,'packet.surfacebin'),bytes:bytes.length,sha256:sha(bytes),responseId:response.id}));
