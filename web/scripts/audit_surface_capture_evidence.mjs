/** CPU replay of retained native logs. Does not launch or qualify a renderer. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {verifyTreeAssetCapture} from './surface_tree_evidence.mjs';
import {verifyNativeLogMode} from './surface_native_log_evidence.mjs';
const args=process.argv.slice(2),arg=k=>{const v=args[args.indexOf(k)+1];if(!args.includes(k)||!v)throw Error('Required '+k);return path.resolve(v);};
const root=arg('--root'),vegetation=arg('--vegetation'),out=arg('--out');
const inputs=[];
async function load(file,json=true){const bytes=await readFile(file);inputs.push({path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});return json?JSON.parse(bytes):bytes.toString('utf8');}
const treePath=path.join(vegetation,'web/out/tree-gpu-first/160m-cc0-tree');
const manifest=await load(path.join(vegetation,'web/out/vegetation-tree/prepared-root-pivot-1024/resolved.json'));
const metrics=await load(path.join(treePath,'metrics.json'));
const report=await load(path.join(treePath,'layer-report.json'));
const captures=(await load(path.join(treePath,'stdout.log'),false)).split(/\r?\n/).flatMap(line=>{try{const e=JSON.parse(line);return e.event==='capture'?[e]:[];}catch{return[];}});
const baselineSource=execFileSync('git',['show','c7dbb5c:web/scripts/surface_tree_evidence.mjs'],{encoding:'utf8'});
const baseline=(await import('data:text/javascript;base64,'+Buffer.from(baselineSource).toString('base64'))).verifyTreeAssetCapture;
const replay=[];
for(const view of [...report.views,report.bareGroundMean]){
  const event=captures.find(e=>e.path.replaceAll('\\','/')===view.capturePath.replaceAll('\\','/'));assert.ok(event);
  const requireGeometry=view.widthM<=160&&view.visibility.trees;
  assert.deepEqual(verifyTreeAssetCapture(event,manifest,{requireGeometry}),baseline(event,manifest,{requireGeometry}));
  replay.push({name:view.name??'ground-mean-unlit',visibility:view.visibility,requireGeometry,tree:event.populationInstances.families.tree,enabled:event.canopyView.treeAssets.enabled,phase:event.canopyView.phase});
}
assert.equal(verifyTreeAssetCapture(metrics,manifest,{requireGeometry:true}).retainedCount,394);
const negative=[];
for(const [key,value] of [['alphaPositiveInFrustum',undefined],['geometryFilterMaximumRatio',undefined],['geometryFilterCompatible','true']]){
  const altered=structuredClone(metrics);
  if(key==='alphaPositiveInFrustum')altered.populationInstances.families.tree[key]=value;else altered.canopyView[key]=value;
  baseline(altered,manifest,{requireGeometry:true});assert.throws(()=>verifyTreeAssetCapture(altered,manifest,{requireGeometry:true}));
  negative.push({mutation:key,value:value??'missing',before:'incorrectly accepted',after:'rejected'});
}
const logging=[];
for(const mode of ['synchronous','threaded']){
  const folder=path.join(root,'web/out/surface/native-log-modes-v13/native-navigation-'+mode);
  const data=await load(path.join(folder,'metrics.json'));
  const log=await load(path.join(folder,'stdout.log'),false),stderr=await load(path.join(folder,'stderr.log'),false);
  const timing=verifyNativeLogMode(data,mode);
  const events=log.split(/\r?\n/).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
  const application=events.filter(e=>e.event!=='navigation-proof');
  if(mode==='threaded'){
    assert.equal(application.length,timing.writer.accepted+1);
    assert.deepEqual(application.slice(0,timing.writer.accepted).map(e=>e.event),timing.writer.recent.map(e=>e.event));
  }
  logging.push({mode,timingVersion:timing.version,applicationEvents:application.length,
    accepted:timing.writer?.accepted??null,written:timing.writer?.written??null,pending:timing.writer?.pending??null,
    excludedOwnMetricsLine:mode==='threaded'?1:null,rejected:timing.writer?.rejected??null,
    modeGate:'passed',strictPhase:'FAILED',preservedScriptError:stderr.includes("Invalid operands 'float' and 'String'")});
  assert.equal(logging.at(-1).preservedScriptError,true);
}
const helperSource=await readFile(new URL('./surface_tree_evidence.mjs',import.meta.url),'utf8');
const helperHash=source=>createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
const proof={helperSources:{normalization:'LF',baselineSha256:helperHash(baselineSource),patchedSha256:helperHash(helperSource)},format:'surface-capture-helper-independent-audit',version:1,baseline:'c7dbb5c',scope:'CPU replay of retained metrics and logs, not a new GPU run or global campaign qualification',inputs,
 tree:{replay,negative,filterRatio:metrics.canopyView.geometryFilterRatio,filterMaximum:metrics.canopyView.geometryFilterMaximumRatio,
 assetDigest:manifest.digest,cartographic:'Driver invokes this aerial-only helper only for aerial phases; ignored assets must reject, not be claimed as applied.',
 emptyNearFrame:'requireGeometry remains false except tour 160m and tree-enabled near layer-probe views; zero visible trees alone does not reject capability.'},logging};
await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({out,treeViews:replay.length,negativeCases:negative.length,logging}));
