import {spawn,execFileSync} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw new Error(`Required ${k}`);return path.resolve(args[i+1]);};
const root=fileURLToPath(new URL('../../',import.meta.url)),godot=get('--godot'),world=get('--world'),assets=get('--assets'),old=get('--old-tree-assets'),fixed=get('--fixed-tree-assets'),out=get('--out');
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=execFileSync('git',['ls-files','viewer-local'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(p=>/\.(gd|gdshader|gdshaderinc|tscn)$/.test(p)||p==='viewer-local/project.godot');
files.push('viewer-local/diagnostics/tree_color_layer_probe.gd');
const snapshot=async()=>Object.fromEntries(await Promise.all([...new Set(files)].sort().map(async p=>[p,sha(await readFile(path.join(root,p)))])));
await mkdir(out,{recursive:true});
const report={format:'magna-source-albedo-artistic-ab',version:1,status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceSha256:sha(await readFile(world)),assetManifests:{old:sha(await readFile(old)),fixed:sha(await readFile(fixed))},runs:[],scope:'Same ROOT-V13 retained source with canonical ground-response, same6ef-based native consumer plus transformed support fix. Only imported high-tree color encoding changes. No new neural generation, full campaign or arbitrary-light BRDF qualification.'};
for(const width of [40,160])for(const [name,manifest] of [['old',old],['fixed',fixed]]){
 const folder=path.join(out,`${width}m-${name}`);await mkdir(folder,{recursive:true});const nativeStart=await snapshot();
 const command=['--audio-driver','Dummy','--path',path.join(root,'viewer-local'),'--rendering-method','forward_plus','--gpu-index','0','--script','diagnostics/tree_color_layer_probe.gd','--','--world',world,'--assets',assets,'--tree-assets',manifest,'--presentation','aerial','--top','--resolution','2048x1280','--width',String(width),'--x','20000','--z','20000','--top-clearance-m','32','--layers','all','--water-mode','source-levels','--water-symbol-width-px','0','--layer-report',path.join(folder,'layer-report.json'),'--layer-captures',folder,'--metrics',path.join(folder,'metrics.json')];
 const stdout=openSync(path.join(folder,'stdout.log'),'w'),stderr=openSync(path.join(folder,'stderr.log'),'w'),started=Date.now();
 const code=await new Promise((resolve,reject)=>{const c=spawn(godot,command,{cwd:root,windowsHide:true,stdio:['ignore',stdout,stderr]});c.once('error',reject);c.once('exit',resolve);});closeSync(stdout);closeSync(stderr);
 const nativeEnd=await snapshot();if(JSON.stringify(nativeStart)!==JSON.stringify(nativeEnd))throw new Error('Runtime changed during capture');
 const log=(await readFile(path.join(folder,'stdout.log'),'utf8'))+(await readFile(path.join(folder,'stderr.log'),'utf8'));
 if(code!==0||/(?:SCRIPT|SHADER) ERROR|ERROR:/.test(log))throw new Error(`Failed GPU run ${width}/${name}; keep raw logs`);
 const layers=JSON.parse(await readFile(path.join(folder,'layer-report.json'),'utf8')),metrics=JSON.parse(await readFile(path.join(folder,'metrics.json'),'utf8'));
 if(layers.status!=='complete')throw new Error('Layer proof incomplete');
 report.runs.push({widthM:width,name,command,nativeStart,nativeEnd,durationMs:Date.now()-started,adapter:metrics.adapter,backend:metrics.backend,layers,canopyView:metrics.canopyView});
 await writeFile(path.join(out,'report.partial.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({width,name,tree:metrics.canopyView.treeAssets,phase:metrics.canopyView.phase}));
}
report.comparisons=[];
for(const width of [40,160]){
 const a=report.runs.find(r=>r.widthM===width&&r.name==='old'),b=report.runs.find(r=>r.widthM===width&&r.name==='fixed');
 for(let i=0;i<a.layers.views.length;i++){
  const x=a.layers.views[i],y=b.layers.views[i];
  for(const k of ['worldId','terrainVersion','canonicalContextId','groundFieldsVersion','canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','inventoryFingerprint','groundSampleFingerprint','groundResponseFingerprint'])if(x[k]!==y[k])throw new Error('Physical/GR delta '+k);
  for(const role of ['coverageImage','countsImage','normalImage','colorImage'])if(!x.rendererCanopyComponents[role]||x.rendererCanopyComponents[role]!==y.rendererCanopyComponents[role])throw new Error('Optical image delta '+role);
  if(x.instanceBufferFingerprint!==y.instanceBufferFingerprint)throw new Error('Actual population transform changed');
  if(['no-trees','ground'].includes(x.name)&&x.centralPixelSha256!==y.centralPixelSha256)throw new Error('Disabled-tree pixels changed');
 }
 if(a.canopyView.treeAssets.highCount!==b.canopyView.treeAssets.highCount||a.canopyView.treeAssets.impostorCount!==b.canopyView.treeAssets.impostorCount)throw new Error('Geometry plan changed');
 if(width===40&&b.canopyView.treeAssets.highCount<=0)throw new Error('40m did not exercise high LOD');
 report.comparisons.push({widthM:width,physicalAndGRHashesExact:true,actualPopulationBuffersExact:true,canopyCoverageCountsNormalsColorsExact:true,disabledTreePixelsExact:true,allPixelHashChanged:a.layers.views[0].centralPixelSha256!==b.layers.views[0].centralPixelSha256});
}
if(report.assetManifests.old!==sha(await readFile(old))||report.assetManifests.fixed!==sha(await readFile(fixed))||report.sourceSha256!==sha(await readFile(world)))throw new Error('Source/asset manifest changed');
report.status='complete';await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,comparisons:report.comparisons}));
