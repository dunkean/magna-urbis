import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root='D:/workspace/self/_worktrees/magna-urbis-surface-world-2026-10-23/web/';
const [{decodeSurfaceBinary},{generateSurfaceCandidates},{sampleSurface},{treeAcceptanceForCover}]=await Promise.all([
 import(pathToFileURL(root+'src/surface/binary.ts').href),import(pathToFileURL(root+'src/surface/population.ts').href),
 import(pathToFileURL(root+'src/surface/compiler.ts').href),import(pathToFileURL(root+'src/surface/treeCanopy.ts').href)]);
const source='D:/workspace/self/_worktrees/magna-urbis-surface-world-2026-10-23/web/out/surface/native-e2e-40km-v4/fresh-source.surfacebin';
const packet:any=decodeSurfaceBinary(new Uint8Array(await readFile(source))),world=packet.world,rows=[];
for(const span of [320,480,512]){
 const bounds={minX:20000-span/2,maxX:20000+span/2,minZ:20000-span/2,maxZ:20000+span/2};
 const trees=generateSurfaceCandidates(world,bounds,{families:['tree'],maxCandidates:100000});
 const bins=new Map<string,any[]>();for(const tree of trees){const key=Math.floor(tree.x/20)+':'+Math.floor(tree.z/20);if(!bins.has(key))bins.set(key,[]);bins.get(key)!.push(tree);}
 let hit=0,target=0,acceptance=0;const n=256;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const px=bounds.minX+(x+.5)*span/n,pz=bounds.minZ+(z+.5)*span/n,context=sampleSurface(world,px,pz);target+=context.treeCover;acceptance+=treeAcceptanceForCover(context.treeCover);
  let covered=false;for(let j=-1;j<=1&&!covered;j++)for(let i=-1;i<=1&&!covered;i++)for(const t of bins.get((Math.floor(px/20)+i)+':'+(Math.floor(pz/20)+j))??[]){if((px-t.x)**2+(pz-t.z)**2<=t.crownRadiusM**2){covered=true;break;}}
  if(covered)hit++;
 }
 const discs=trees.reduce((s:any,t:any)=>s+Math.PI*t.crownRadiusM**2,0);
 rows.push({spanM:span,bounds,treeCount:trees.length,expectedCountFromAcceptanceIntegral:acceptance/n**2*.08*span**2,meanCanonicalTreeCover:target/n**2,measuredCrownUnionGridCoverage:hit/n**2,absoluteCoverageDifferencePP:(hit-target)/n**2*100,discAreaSumM2:discs,discAreaSumOverBBox:discs/span**2,
 minX:Math.min(...trees.map((t:any)=>t.x)),maxX:Math.max(...trees.map((t:any)=>t.x)),minZ:Math.min(...trees.map((t:any)=>t.z)),maxZ:Math.max(...trees.map((t:any)=>t.z))});
}
const result={source,CPUOnly:true,sourceFieldsUnchanged:true,queryMethod:'actual production generateSurfaceCandidates, tree-only query, no source generation',coverageMethod:'256x256 deterministic world probes; physical crown discs radius0.42size; area union, not disc sum',rows};
await writeFile('out/surface/forest-v4-diagnostic/candidates.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
