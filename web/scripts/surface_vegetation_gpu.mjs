import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './surface_vegetation_assets.mjs';
const args=process.argv.slice(2),value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.resolve(value('--out',path.join(root,'web/out/vegetation-gpu')));
const widths=value('--widths','160,10').split(',').map(Number);
if(widths.some(w=>!Number.isFinite(w)||w<=0))throw new Error('Invalid widths');
const required=key=>{const result=value(key);if(!result)throw new Error(`Required ${key}`);return path.resolve(result);};
const godot=required('--godot'),world=required('--world'),assets=required('--assets'),vegetation=required('--vegetation-assets');
const report={format:'magna-grass-asset-gpu-ab',version:1,status:'running',sourceSha256:sha256(await readFile(world)),vegetationManifestSha256:sha256(await readFile(vegetation)),runs:[],comparisons:[],scope:'Offline retained source A/B; no new neural generation, no source/IDs change, no frame-rate or final artistic claim'};
for(const width of widths)for(const profile of ['baseline','cc0-grass']){
  const folder=path.join(out,`${width}m-${profile}`);await mkdir(folder,{recursive:true});
  const command=['--audio-driver','Dummy','--path',path.join(root,'viewer-local'),'--rendering-method','forward_plus','--gpu-index','0','--script','diagnostics/layer_probe.gd','--','--world',world,'--assets',assets,'--presentation','aerial',args.includes('--oblique')?'--oblique':'--top','--resolution','1600x1000','--width',String(width),'--x',value('--x','20000'),'--z',value('--z','20000'),'--layers','all','--layer-report',path.join(folder,'layer-report.json'),'--layer-captures',folder,'--metrics',path.join(folder,'metrics.json')];
  if(profile==='cc0-grass')command.push('--vegetation-assets',vegetation);
  const stdout=openSync(path.join(folder,'stdout.log'),'w'),stderr=openSync(path.join(folder,'stderr.log'),'w'),started=Date.now();
  const code=await new Promise((resolve,reject)=>{const child=spawn(godot,command,{cwd:root,windowsHide:true,stdio:['ignore',stdout,stderr]});child.once('error',reject);child.once('exit',resolve);});
  closeSync(stdout);closeSync(stderr);
  const log=(await readFile(path.join(folder,'stdout.log'),'utf8'))+(await readFile(path.join(folder,'stderr.log'),'utf8'));
  if(code!==0||/(?:SCRIPT|SHADER) ERROR|ERROR:/.test(log))throw new Error(`GPU run failed ${width}/${profile}; preserve logs in ${folder}`);
  const layers=JSON.parse(await readFile(path.join(folder,'layer-report.json'),'utf8')),metrics=JSON.parse(await readFile(path.join(folder,'metrics.json'),'utf8'));
  if(layers.status!=='complete')throw new Error('Layer proof incomplete');
  report.runs.push({width,profile,folder,durationMs:Date.now()-started,layers,renderSourceVersion:metrics.renderSourceVersion});
}
for(const width of widths){
  const a=report.runs.find(r=>r.width===width&&r.profile==='baseline'),b=report.runs.find(r=>r.width===width&&r.profile==='cc0-grass');
  const comparisons={width,physicalHashesExact:true,instanceCountsExact:true,groundPixelsExact:true};
  for(let i=0;i<a.layers.views.length;i++){
    const av=a.layers.views[i],bv=b.layers.views[i];
    for(const key of ['worldId','terrainVersion','canonicalContextId','groundFieldsVersion','canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','inventoryFingerprint','groundSampleFingerprint'])if(av[key]!==bv[key])throw new Error(`Source delta ${width}/${key}`);
    if(JSON.stringify(av.populationInstances)!==JSON.stringify(bv.populationInstances))throw new Error('Population counts changed');
    if(['ground','no-low-cover'].includes(av.name)&&av.centralPixelSha256!==bv.centralPixelSha256)throw new Error('Hidden grass changed pixels');
  }
  comparisons.groundPixelsExact=a.layers.bareGroundMean.groundSampleFingerprint===b.layers.bareGroundMean.groundSampleFingerprint;
  report.comparisons.push(comparisons);
}
report.status='complete';await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,comparisons:report.comparisons,report:path.join(out,'report.json')}));
