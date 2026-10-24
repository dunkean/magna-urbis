import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha256} from './surface_vegetation_assets.mjs';
const args=process.argv.slice(2),value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.resolve(value('--out',path.join(root,'web/out/tree-gpu')));
const required=key=>{const result=value(key);if(!result)throw new Error(`Required ${key}`);return path.resolve(result);};
const godot=required('--godot'),world=required('--world'),assets=required('--assets'),trees=required('--tree-assets');
const tracked=execFileSync('git',['ls-files','viewer-local'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(p=>/\.(?:gd|gdshader|gdshaderinc|tscn)$/.test(p)||p==='viewer-local/project.godot');
const runtimeSnapshot=async()=>Object.fromEntries(await Promise.all(tracked.map(async p=>[p,sha256(await readFile(path.join(root,p)))])));
const runtimeAtStart=await runtimeSnapshot();
const widths=value('--widths','160,10,640').split(',').map(Number);
if(widths.some(w=>!Number.isFinite(w)||w<=0))throw new Error('Invalid widths');
const report={format:'magna-experimental-tree-gpu-ab',version:1,status:'running',sourceSha256:sha256(await readFile(world)),treeManifestSha256:sha256(await readFile(trees)),runtimeAtStart,runs:[],comparisons:[],scope:'Retained V12 replay, same source and candidate page. Technical render/isolation evidence only; no new generation or artistic acceptance.'};
await mkdir(out,{recursive:true});
for(const width of widths)for(const profile of ['baseline','cc0-tree']){
  const folder=path.join(out,`${width}m-${profile}`);await mkdir(folder,{recursive:true});
  const command=['--audio-driver','Dummy','--path',path.join(root,'viewer-local'),'--rendering-method','forward_plus','--gpu-index','0','--script','diagnostics/layer_probe.gd','--','--world',world,'--assets',assets,'--presentation',value('--presentation','aerial'),args.includes('--oblique')?'--oblique':'--top','--resolution',value('--resolution','1600x1000'),'--width',String(width),'--x',value('--x','20006.76562328823'),'--z',value('--z','19995.02898969222'),'--layers','all','--water-mode','source-levels','--water-symbol-width-px','0','--layer-report',path.join(folder,'layer-report.json'),'--layer-captures',folder,'--metrics',path.join(folder,'metrics.json')];
  if(value('--style'))command.push('--style',value('--style'),'--style-catalogue',required('--style-catalogue'));
  command.push('--top-clearance-m','32');
  if(profile==='cc0-tree')command.push('--tree-assets',trees);
  const stdout=openSync(path.join(folder,'stdout.log'),'w'),stderr=openSync(path.join(folder,'stderr.log'),'w'),started=Date.now();
  const code=await new Promise((resolve,reject)=>{const child=spawn(godot,command,{cwd:root,windowsHide:true,stdio:['ignore',stdout,stderr]});child.once('error',reject);child.once('exit',resolve);});
  closeSync(stdout);closeSync(stderr);
  const log=(await readFile(path.join(folder,'stdout.log'),'utf8'))+(await readFile(path.join(folder,'stderr.log'),'utf8'));
  if(code!==0||/(?:SCRIPT|SHADER) ERROR|ERROR:/.test(log))throw new Error(`GPU run failed ${width}/${profile}; preserve logs in ${folder}`);
  const layers=JSON.parse(await readFile(path.join(folder,'layer-report.json'),'utf8')),metrics=JSON.parse(await readFile(path.join(folder,'metrics.json'),'utf8'));
  if(layers.status!=='complete')throw new Error('Layer proof incomplete');
  report.runs.push({width,profile,folder,durationMs:Date.now()-started,layers,canopyView:metrics.canopyView,adapter:metrics.adapter,backend:metrics.backend,videoMemoryBytes:metrics.videoMemoryBytes,textureMemoryBytes:metrics.textureMemoryBytes});
  await writeFile(path.join(out,'report.partial.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({completed:`${width}/${profile}`,durationMs:Date.now()-started,adapter:metrics.adapter,tree:metrics.canopyView.treeAssets,phase:metrics.canopyView.phase}));
}
for(const width of widths){
  const a=report.runs.find(r=>r.width===width&&r.profile==='baseline'),b=report.runs.find(r=>r.width===width&&r.profile==='cc0-tree');
  for(let i=0;i<a.layers.views.length;i++){
    const av=a.layers.views[i],bv=b.layers.views[i];
    for(const key of ['worldId','terrainVersion','canonicalContextId','groundFieldsVersion','canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','inventoryFingerprint','groundSampleFingerprint'])if(av[key]!==bv[key])throw new Error(`Source delta ${width}/${key}`);
    if(['ground','no-trees'].includes(av.name)&&av.centralPixelSha256!==bv.centralPixelSha256)throw new Error(`Disabled tree changed central pixels ${width}/${av.name}`);
  }
  if(a.layers.bareGroundMean.centralPixelSha256!==b.layers.bareGroundMean.centralPixelSha256&&a.layers.bareGroundMean.centralPixelSha256!==undefined)throw new Error('Unlit support pixels changed');
  if(value('--presentation','aerial')==='cartographic')for(let i=0;i<a.layers.views.length;i++)if(a.layers.views[i].centralPixelSha256!==b.layers.views[i].centralPixelSha256)throw new Error('Asset flag altered cartographic pixels');
  report.comparisons.push({width,physicalHashesExact:true,noTreesAndGroundPixelsExact:true,cartographicPixelsExact:value('--presentation','aerial')==='cartographic'});
}
report.runtimeAtEnd=await runtimeSnapshot();
if(JSON.stringify(report.runtimeAtStart)!==JSON.stringify(report.runtimeAtEnd))throw new Error('Runtime changed during the A/B sequence');
report.status='complete';await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,comparisons:report.comparisons,report:path.join(out,'report.json')}));
