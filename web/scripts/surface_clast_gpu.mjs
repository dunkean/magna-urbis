import {spawn,execFileSync} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw new Error('Required '+k);return path.resolve(args[i+1]);};
const before=get('--before'),after=get('--after'),world=get('--world'),assets=get('--assets'),godot=get('--godot'),batch=get('--height-batch'),out=get('--out'),palettes=get('--style-catalogue');
const sha=b=>createHash('sha256').update(b).digest('hex');
const snapshot=async root=>{
 const files=execFileSync('git',['ls-files','viewer-local'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(p=>/\.(gd|gdshader|gdshaderinc|tscn)$/.test(p)||p==='viewer-local/project.godot');files.push('viewer-local/diagnostics/clast_layer_probe.gd');
 return Object.fromEntries(await Promise.all([...new Set(files)].sort().map(async p=>[p,sha(await readFile(path.join(root,p)))])));
};
await mkdir(out,{recursive:true});await copyFile(path.join(after,'viewer-local/diagnostics/clast_layer_probe.gd'),path.join(before,'viewer-local/diagnostics/clast_layer_probe.gd'));
const report={format:'source-clast-gpu-ab',version:1,status:'running',sourceSha256:sha(await readFile(world)),terrainAssetManifestSha256:sha(await readFile(assets)),heightBatchSha256:sha(await readFile(batch)),runs:[],scope:'Same retained V13 source; existing sourceRock4 mudstone boulder, no new scatter or observed rock shape. Baseline1eee versus authored clasts with shared PBR.'};
if(report.heightBatchSha256!=='1d2c1652ff6711c1a6c78677d3c6158bd497c93e1fad5a5609c952aef7a4f6ec')throw new Error('Pinned height sampler differs');
for(const pose of ['top','oblique','cartographic'])for(const [name,root] of [['baseline',before],['clasts',after]]){
 const folder=path.join(out,pose+'-'+name);await mkdir(folder,{recursive:true});const start=await snapshot(root);
 const command=['--audio-driver','Dummy','--path',path.join(root,'viewer-local'),'--rendering-method','forward_plus','--gpu-index','0','--script','diagnostics/clast_layer_probe.gd','--','--world',world,'--assets',assets,'--height-batch',batch,'--presentation',pose==='cartographic'?'cartographic':'aerial',pose==='oblique'?'--oblique':'--top','--resolution','1600x1000','--width','8','--x','20014.029683487024','--z','19983.486032686196','--top-clearance-m','32','--layers','all','--frames','99999999','--water-mode','source-levels','--water-symbol-width-px','0','--clast-report',path.join(folder,'probe.json'),'--clast-captures',folder,'--metrics',path.join(folder,'metrics.json')];
 if(pose==='cartographic')command.push('--style','blueprint','--style-catalogue',palettes);
 const stdout=openSync(path.join(folder,'stdout.log'),'w'),stderr=openSync(path.join(folder,'stderr.log'),'w'),began=Date.now();
 const code=await new Promise((resolve,reject)=>{const c=spawn(godot,command,{cwd:root,windowsHide:true,stdio:['ignore',stdout,stderr]});c.once('error',reject);c.once('exit',resolve);});closeSync(stdout);closeSync(stderr);
 const end=await snapshot(root);if(JSON.stringify(start)!==JSON.stringify(end))throw new Error('Runtime changed '+pose+'/'+name);
 const log=(await readFile(path.join(folder,'stdout.log'),'utf8'))+(await readFile(path.join(folder,'stderr.log'),'utf8'));if(code!==0||/(?:SCRIPT|SHADER) ERROR|ERROR:/.test(log))throw new Error('GPU run failed; preserve '+folder);
 const probe=JSON.parse(await readFile(path.join(folder,'probe.json'),'utf8')),metrics=JSON.parse(await readFile(path.join(folder,'metrics.json'),'utf8'));
 report.runs.push({pose,name,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),command,start,end,probe,populationInstances:metrics.populationInstances,adapter:metrics.adapter,backend:metrics.backend,durationMs:Date.now()-began,folder});
 await writeFile(path.join(out,'report.partial.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pose,name,clasts:metrics.populationInstances.clasts,durationMs:Date.now()-began}));
}
report.comparisons=[];
for(const pose of ['top','oblique','cartographic']){
 const a=report.runs.find(r=>r.pose===pose&&r.name==='baseline'),b=report.runs.find(r=>r.pose===pose&&r.name==='clasts');
 for(let i=0;i<a.probe.views.length;i++){
  const x=a.probe.views[i],y=b.probe.views[i];for(const k of ['worldId','terrainVersion','canonicalContextId','groundFieldsVersion','canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','inventoryFingerprint','groundSampleFingerprint','groundResponseFingerprint','nonBoulderBufferFingerprint'])if(x[k]!==y[k])throw new Error('Source/non-boulder delta '+pose+'/'+k);
  if(x.name==='no-boulders'&&x.fullPixelSha256!==y.fullPixelSha256)throw new Error('Terrain pixels changed with both boulders/casting hidden '+pose);
  if(pose==='cartographic'&&x.fullPixelSha256!==y.fullPixelSha256)throw new Error('Cartographic glyph pixels changed');
  for(const f of ['tree','trunk','grass','shrub','debris','boulder'])if(x.populationInstances.families[f].submitted!==y.populationInstances.families[f].submitted)throw new Error('Population count changed '+f);
 }
 report.comparisons.push({pose,sourceAndNonBoulderBuffersExact:true,noBouldersTerrainFullPixelsExact:true,cartographicFullPixelsExact:pose==='cartographic',allPixelChange:a.probe.views[0].fullPixelSha256!==b.probe.views[0].fullPixelSha256});
}
if(report.sourceSha256!==sha(await readFile(world))||report.heightBatchSha256!==sha(await readFile(batch))||report.terrainAssetManifestSha256!==sha(await readFile(assets)))throw new Error('Source, assets or sampler changed');
report.status='complete';await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,comparisons:report.comparisons}));
