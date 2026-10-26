/** Authored homogeneous process witnesses; no retained source is edited. */
import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';import{resolve,join}from'node:path';import{parseArgs}from'node:util';import{createHash}from'node:crypto';
import{compileSurfaceWorld}from'../src/surface/compiler';import{generateSurfaceCandidates}from'../src/surface/population';import{treeAcceptanceForCover,expectedTreeCover}from'../src/surface/treeCanopy';
const{values}=parseArgs({options:{out:{type:'string'}}});if(!values.out)throw Error('--out NEW_DIRECTORY');const out=resolve(values.out);if(existsSync(join(out,'generator.json')))throw Error('Preserve previous proof');mkdirSync(out,{recursive:true});
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex'),seeds=[0,1,17,6422,2307,4294967295,2147483647,-9712],covers=[0,.005,.02,.05,.1,.2,.35,.5,.7,.85,.95,1];
const rows=(c:ReturnType<typeof generateSurfaceCandidates>)=>Float64Array.from(c.flatMap(v=>[v.x,v.z,v.size,v.crownRadiusM!,v.orientation,v.rank,v.variant]));
const result:any={format:'actual-tree-process-witnesses',version:1,scope:'Authored flat homogeneous diagnostic; canonical candidate generator unchanged. No IG/source/retained candidate mutation.',seedList:seeds,cellM:20,slots:32,cellsMin:-26,cellsMax:25,bounds:{minX:-520,minZ:-520,maxX:520,maxZ:520},recordColumns:['x','z','size','crownRadiusM','orientation','rank','variant'],
 sourceHashes:Object.fromEntries(['population.ts','treeCanopy.ts'].map(name=>[name,hash(readFileSync(resolve('src/surface',name)))])),densities:covers.map(cover=>{const actualCover=Math.fround(cover),p=treeAcceptanceForCover(actualCover);return{requestedCover:cover,actualCover,acceptance:p,expectedEnvelope:expectedTreeCover(p)};}),seeds:[]};
for(const seed of seeds){
 const world=compileSurfaceWorld({seed,terrain:{width:2,height:2,originX:-520,originZ:-520,spacingM:1040,heights:new Float32Array(4),source:{id:'authored-process-witness',version:'1',sourceLOD:0,sourceLODKnown:true,nativeSpacingM:1040}}});
 world.fields.slope.fill(0);world.fields.waterClass.fill(0);world.fields.occupation.fill(0);world.fields.treeCover.fill(1);
 const options={families:['tree']as const,maxCandidates:100000,maxCheckedSlots:100000},full=generateSurfaceCandidates(world,world.bounds,{...options,families:[...options.families]}),binary=rows(full),file='seed-'+seed+'.f64';writeFileSync(join(out,file),new Uint8Array(binary.buffer));
 const record:any={seed,file,count:full.length,sha256:hash(new Uint8Array(binary.buffer)),idsSha256:hash(full.map(v=>v.stableId).join('\n')),witnesses:[]};
 if(seed===0||seed===6422)for(const density of result.densities){world.fields.treeCover.fill(density.actualCover);const candidates=generateSurfaceCandidates(world,world.bounds,{...options,families:[...options.families]});record.witnesses.push({...density,count:candidates.length,idsSha256:hash(candidates.map(v=>v.stableId).join('\n')),recordsSha256:hash(new Uint8Array(rows(candidates).buffer))});}
 result.seeds.push(record);console.log(JSON.stringify({seed,count:record.count,witnesses:record.witnesses.length}));
}
writeFileSync(join(out,'generator.json'),JSON.stringify(result,null,2)+'\n');
