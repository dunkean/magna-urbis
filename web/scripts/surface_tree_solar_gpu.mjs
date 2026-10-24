import{spawn,execFileSync}from'node:child_process';
import{openSync,closeSync}from'node:fs';
import{readFile,mkdir,writeFile}from'node:fs/promises';
import path from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
const get=k=>{let i=args.indexOf(k);if(i<0)throw Error('Required '+k);return path.resolve(args[i+1]);};
const godot=get('--godot'),world=get('--world'),assets=get('--assets'),trees=get('--tree-assets'),height=get('--height-batch'),out=get('--out');
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=execFileSync('git',['ls-files','viewer-local'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(p=>/\.(gd|gdshader|gdshaderinc|tscn)$/.test(p)||p.endsWith('project.godot'));
const snapshot=async()=>Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,sha(await readFile(path.join(root,p)))])));
await mkdir(out,{recursive:true});
let report={version:1,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),clean:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()==='',sourceSha256:sha(await readFile(world)),treeManifestSha256:sha(await readFile(trees)),heightExecutableSha256:sha(await readFile(height)),runs:[],scope:'Retained source replay, paired same source/camera/colour assets. Native shadow-only inventory differs; physical source and actual colour buffers must not.'};
const cases=args.includes('--only-carto')?[[160,'cartographic']]:args.includes('--only-oblique')?[[160,'oblique']]:[[160,'top'],[640,'top'],[160,'oblique']];
for(let [width,view]of cases)for(let mode of['optical','native-solar']){
 const folder=path.join(out,`${width}-${view}-${mode}`);await mkdir(folder,{recursive:true});let before=await snapshot();
 let command=['--audio-driver','Dummy','--path',path.join(root,'viewer-local'),'--rendering-method','forward_plus','--gpu-index','0','--script','diagnostics/tree_solar_layer_probe.gd','--','--world',world,'--assets',assets,'--tree-assets',trees,'--height-batch',height,'--tree-shadow-mode',mode,'--native-log-mode','threaded','--presentation',view==='cartographic'?'cartographic':'aerial','--'+(view==='oblique'?'oblique':'top'),'--resolution','1600x1000','--width',String(width),'--x',view==='oblique'?'20006.7656233':'20000','--z',view==='oblique'?'19995.0289897':'20000','--water-mode','source-levels','--water-symbol-width-px','0','--layers','all','--layer-report',path.join(folder,'layer-report.json'),'--layer-captures',folder,'--metrics',path.join(folder,'metrics.json')];
 if(view==='cartographic')command.push('--style','blueprint','--style-catalogue',path.join(root,'surface/presentation/palettes.json'));
 let stdout=openSync(path.join(folder,'stdout.log'),'w'),stderr=openSync(path.join(folder,'stderr.log'),'w'),start=Date.now();
 let code=await new Promise((resolve,reject)=>{let child=spawn(godot,command,{cwd:root,windowsHide:true,stdio:['ignore',stdout,stderr]});child.on('error',reject);child.on('exit',resolve);});closeSync(stdout);closeSync(stderr);
 let after=await snapshot();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Native runtime mutated');
 let logs=(await readFile(path.join(folder,'stderr.log'),'utf8'))+(await readFile(path.join(folder,'stdout.log'),'utf8'));
 if(code!==0||/(?:SCRIPT|SHADER) ERROR|ERROR:/.test(logs))throw Error('Native run failed, preserve raw '+folder);
 let layers=JSON.parse(await readFile(path.join(folder,'layer-report.json'),'utf8')),metrics=JSON.parse(await readFile(path.join(folder,'metrics.json'),'utf8'));
 if(layers.status!=='complete')throw Error('Layer proof incomplete');
 report.runs.push({width,view,mode,command,durationMs:Date.now()-start,before,after,layers,treeSolar:metrics.treeSolarShadows,canopy:metrics.canopyView});
 await writeFile(path.join(out,'report.partial.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({width,view,mode,solar:metrics.treeSolarShadows}));
}
report.comparisons=[];
for(let[width,view]of cases){
 let a=report.runs.find(r=>r.width===width&&r.view===view&&r.mode==='optical'),b=report.runs.find(r=>r.width===width&&r.view===view&&r.mode==='native-solar');
 for(let i=0;i<a.layers.views.length;i++){
  let x=a.layers.views[i],y=b.layers.views[i];
  for(let key of['worldId','terrainVersion','canonicalContextId','groundFieldsVersion','canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','inventoryFingerprint','groundSampleFingerprint','groundResponseFingerprint','instanceBufferFingerprint'])if(x[key]!==y[key])throw Error('Source/colour buffer delta '+key);
  for(let role of['coverageImage','countsImage','normalImage','colorImage'])if(x.rendererCanopyComponents[role]!==y.rendererCanopyComponents[role])throw Error('C/V delta '+role);
  if(['no-trees','ground'].includes(x.name)&&sha(await readFile(x.capturePath))!==sha(await readFile(y.capturePath)))throw Error('Disabled tree fullPNG changed');
 }
 let solar=b.layers.views[0].treeSolarShadows;
 if(view==='cartographic'){
  if(solar.weight!==0||solar.completeInventoryCount!==0||Object.keys(solar.bake).length)throw Error('Cartographic glyphs contaminated by solar product');
  for(let i=0;i<a.layers.views.length;i++)if(sha(await readFile(a.layers.views[i].capturePath))!==sha(await readFile(b.layers.views[i].capturePath)))throw Error('Cartographic fullPNG changed');
 }else if(solar.weight!==1||solar.opticalFallbackWeight!==0||solar.completeInventoryCount<=10000)throw Error('Complete source native shadows not actually active');
 report.comparisons.push({width,view,physicalAndColourBuffersExact:true,sourceCanopyComponentsExact:true,disabledTreesFullPngExact:true,nativeCount:solar.completeInventoryCount,nativeTriangles:solar.submittedTriangles});
}
if(report.sourceSha256!==sha(await readFile(world))||report.treeManifestSha256!==sha(await readFile(trees))||report.heightExecutableSha256!==sha(await readFile(height)))throw Error('Pinned input changed');
report.status='complete';await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,comparisons:report.comparisons}));
