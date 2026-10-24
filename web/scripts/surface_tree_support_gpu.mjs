import {spawn,execFileSync} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw new Error(`Required ${k}`);return path.resolve(args[i+1]);};
const godot=get('--godot'),world=get('--world'),assets=get('--assets'),tree=get('--tree-assets'),before=get('--before'),after=get('--after'),out=get('--out');
const number=(key,fallback)=>{const i=args.indexOf(key),result=i<0?fallback:Number(args[i+1]);if(!Number.isFinite(result))throw new Error('Invalid '+key);return result;};
const focus={x:number('--x',20000),z:number('--z',20000)};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const snapshot=async root=>{
 const files=execFileSync('git',['ls-files','viewer-local'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(p=>/\.(gd|gdshader|gdshaderinc|tscn)$/.test(p)||p==='viewer-local/project.godot');
 return Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(path.join(root,p)))])));
};
await mkdir(out,{recursive:true});
const report={format:'magna-tree-support-culling-gpu-ab',version:1,status:'running',focus,sourceSha256:sha(await readFile(world)),assetManifestSha256:sha(await readFile(tree)),runs:[],scope:'Retained V12 same-source TOP10 control; only transformed support culling and custom bounds changed. No new generation, full campaign, GPU occlusion or artistic acceptance.'};
for(const [name,root] of [['centre-baseline',before],['support-corrected',after]]){
 const folder=path.join(out,name);await mkdir(folder,{recursive:true});
 const nativeStart=await snapshot(root),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const command=['--audio-driver','Dummy','--path',path.join(root,'viewer-local'),'--rendering-method','forward_plus','--gpu-index','0','--script','diagnostics/layer_probe.gd','--','--world',world,'--assets',assets,'--tree-assets',tree,'--presentation','aerial','--top','--resolution','1600x1000','--width','10','--x',String(focus.x),'--z',String(focus.z),'--top-clearance-m','32','--layers','all','--water-mode','source-levels','--water-symbol-width-px','0','--layer-report',path.join(folder,'layer-report.json'),'--layer-captures',folder,'--metrics',path.join(folder,'metrics.json')];
 const stdout=openSync(path.join(folder,'stdout.log'),'w'),stderr=openSync(path.join(folder,'stderr.log'),'w');const began=Date.now();
 const code=await new Promise((resolve,reject)=>{const p=spawn(godot,command,{cwd:root,windowsHide:true,stdio:['ignore',stdout,stderr]});p.once('error',reject);p.once('exit',resolve);});closeSync(stdout);closeSync(stderr);
 const nativeEnd=await snapshot(root);if(JSON.stringify(nativeStart)!==JSON.stringify(nativeEnd))throw new Error('Runtime changed during '+name);
 const log=(await readFile(path.join(folder,'stdout.log'),'utf8'))+(await readFile(path.join(folder,'stderr.log'),'utf8'));
 if(code!==0||/(?:SCRIPT|SHADER) ERROR|ERROR:/.test(log))throw new Error('GPU control failed; retain logs in '+folder);
 const metrics=JSON.parse(await readFile(path.join(folder,'metrics.json'),'utf8')),layers=JSON.parse(await readFile(path.join(folder,'layer-report.json'),'utf8'));
 report.runs.push({name,head,command,nativeStart,nativeEnd,adapter:metrics.adapter,backend:metrics.backend,durationMs:Date.now()-began,canopyView:metrics.canopyView,populationInstances:metrics.populationInstances,layers,folder});
 await writeFile(path.join(out,'report.partial.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({name,head,tree:metrics.canopyView.treeAssets}));
}
const [a,b]=report.runs,ta=a.canopyView.treeAssets,tb=b.canopyView.treeAssets;
if(!(ta.highCount===0&&tb.highCount>0&&tb.highCentresInFrustum===0&&tb.highCentresOutsideFrustum===tb.highCount))throw new Error('Offscreen-centre high-support case not exercised');
if(tb.highTriangles>2000000||tb.droppedCount!==0||ta.retainedCount!==tb.retainedCount)throw new Error('Tree budget/retention changed');
if(a.canopyView.activeAtlasHash!==b.canopyView.activeAtlasHash)throw new Error('Source C/count atlas changed');
for(let i=0;i<a.layers.views.length;i++){
 const x=a.layers.views[i],y=b.layers.views[i];
 for(const k of ['worldId','terrainVersion','canonicalContextId','groundFieldsVersion','canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','inventoryFingerprint','groundSampleFingerprint'])if(x[k]!==y[k])throw new Error('Physical source changed '+k);
 if(['no-trees','ground'].includes(x.name)&&x.centralPixelSha256!==y.centralPixelSha256)throw new Error('Disabled-tree pixels changed');
 if(x.populationInstances.families.tree.submitted!==y.populationInstances.families.tree.submitted)throw new Error('Retained tree allocation changed');
}
report.status='complete';report.checks={highSelectedWithAllCentresOutside:true,sourceAtlasIdentical:true,physicalHashesExact:true,disabledTreeCentralPixelsExact:true,retainedTreeCountsExact:true};
report.visibleGeometryPixelChange=a.layers.views[0].centralPixelSha256!==b.layers.views[0].centralPixelSha256;
if(args.includes('--require-visible-change')&&!report.visibleGeometryPixelChange)throw new Error('Support selected but no visible raster change; not an artistic correction proof');
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks}));
