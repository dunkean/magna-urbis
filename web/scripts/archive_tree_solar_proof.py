"""Archive already captured, explicitly pre-ledger controls. Does not render."""
import hashlib,json,pathlib,shutil,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/surface/evidence/forest-solar-phase7'
OUT.mkdir(parents=True,exist_ok=True)
def sha(data):return hashlib.sha256(data).hexdigest()
def load(path):return json.loads(path.read_text(encoding='utf8'))
def pin(path):return {'path':str(path),'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())}
historical=load(ROOT/'web/out/solar-retained-ab/report.partial.json')
oblique=load(ROOT/'web/out/solar-oblique-controlled/report.json')
carto=load(ROOT/'web/out/solar-carto-control/report.json')
microscope=load(ROOT/'web/out/solar-probe-depth/report.json')
trunk=load(ROOT/'web/out/trunk-albedo/report.json')
report={'version':1,'status':'PRE-LEDGER-GPU-CONTROLS; FINAL-INTEGRATED-BUDGET-GPU-PENDING',
 'scope':'Retained V12 source with explicitly refreshed complete4km tree page, no new NN/register. GPU controls precede final source/support/budget hardening. Neither a fresh campaign nor production acceptance.',
 'sourceSha256':historical['sourceSha256'],'treeManifestSha256':historical['treeManifestSha256'],'heightExecutableSha256':historical['heightExecutableSha256'],
 'cpu':{'solarChecks':442,'visibilityPlanChecks':888,'result':'PASS','mainParser':'PASS'},'runs':[],'comparisons':[],'images':[],
 'nativeSourceSnapshots':{},'microGpu':microscope,'trunkGpu':trunk,
 'unrun':['explicit wholly-offscreen-caster GPU boundary control','final source/support/memory-ledger integrated GPU rerun','fresh navigation/QoS campaign','general oblique C/V/lighting/parallax qualification'],
 'repositoryScope':'Only recorded tracked native file maps were compared per run. Initial git clean flags are preserved; continuous whole-worktree cleanliness was not attested. Unused diagnostic files were prepared separately during the sequence.'}
def append_run(run,label):
 assert run['before']==run['after']
 encoded=json.dumps(run['before'],sort_keys=True,separators=(',',':')).encode()
 key=sha(encoded);report['nativeSourceSnapshots'][key]=run['before']
 metrics=load(pathlib.Path(run['command'][run['command'].index('--metrics')+1]))
 report['runs'].append({'label':label,'widthM':run['width'],'view':run['view'],'mode':run['mode'],'command':run['command'],'durationMs':run['durationMs'],'nativeSnapshotSha256':key,'nativeStartEqualsEnd':True,'treeSolar':run['treeSolar'],'canopyPhase':run['canopy']['phase'],'mapProjection':metrics['mapProjection'],'pbrAssetDigest':metrics['renderSourceVersion']['assetDigest']})
def compare(a,b,label,cartographic=False):
 for x,y in zip(a['layers']['views'],b['layers']['views']):
  for key in ['worldId','terrainVersion','canonicalContextId','groundFieldsVersion','canonicalContextFingerprint','parentTerrainFingerprint','projectedGroundFieldsVersion','geometryDetailFingerprint','inventoryFingerprint','groundSampleFingerprint','groundResponseFingerprint','instanceBufferFingerprint']:
   assert x[key]==y[key],(label,key)
  assert x['rendererCanopyComponents']==y['rendererCanopyComponents']
  if x['name'] in ['no-trees','ground'] or cartographic:assert pathlib.Path(x['capturePath']).read_bytes()==pathlib.Path(y['capturePath']).read_bytes()
 am=load(pathlib.Path(a['command'][a['command'].index('--metrics')+1]));bm=load(pathlib.Path(b['command'][b['command'].index('--metrics')+1]))
 assert am['mapProjection']==bm['mapProjection']
 report['comparisons'].append({'view':label,'physicalFieldsExact':True,'colourInstanceBuffersExact':True,'canopyCoverageCountsNormalsColoursExact':True,'disabledTreesFullPngExact':True,'actualNativeCameraProjectionExact':True,'cartographicAllFourFullPngExact':cartographic,'nativeCasterCount':b['layers']['views'][0]['treeSolarShadows']['completeInventoryCount']})
 for mode,run in [('before',a),('after',b)]:
  source=pathlib.Path(run['layers']['views'][0]['capturePath']);destination=OUT/(label+'-'+mode+'.png');shutil.copyfile(source,destination);report['images'].append(pin(destination))
for width in [160,640]:
 a=next(r for r in historical['runs'] if r['width']==width and r['view']=='top' and r['mode']=='optical')
 b=next(r for r in historical['runs'] if r['width']==width and r['view']=='top' and r['mode']=='native-solar')
 append_run(a,f'top{width}-before');append_run(b,f'top{width}-after');compare(a,b,f'top{width}')
 assert b['layers']['views'][0]['treeSolarShadows']['weight']==1
append_run(oblique['runs'][0],'oblique-controlled-before');append_run(oblique['runs'][1],'oblique-controlled-after');compare(*oblique['runs'],'oblique160')
for run in carto['runs']:append_run(run,'cartographic-'+run['mode'])
compare(*carto['runs'],'blueprint160',cartographic=True)
negative=historical['runs'][-1]
report['preservedObliqueNegative']={'focus':negative['layers']['views'][0]['focus'],'phase':negative['canopy']['phase'],'reason':negative['canopy']['reason'],'shadow':negative['treeSolar'],'harnessGate':'FAILED as intended: no actual native shadow activity at that unsafe reference-plane view'}
for source,name in [(ROOT/'web/out/solar-probe-depth/3-high-shadow.png','raised-reference.png'),(ROOT/'web/out/solar-probe-depth/3-solar-depth.png','raised-solar-depth.png'),(ROOT/'web/out/solar-probe-depth/3-solar-planar-negative.png','raised-planar-negative.png'),(ROOT/'web/out/trunk-albedo/trunk-0.png','trunk-before.png'),(ROOT/'web/out/trunk-albedo/trunk-1.png','trunk-after.png')]:
 destination=OUT/name;shutil.copyfile(source,destination);report['images'].append(pin(destination))
report['trunkGpu']['importedTextureHashEncoding']='SHA256 of lowercase hex-encoded image bytes, as calculated by this diagnostic; not a raw image-byte SHA'
report['trunkGpu']['historicalOverrideCause']='Unrecovered: no start/end runtime snapshot exists for the old trunk white/brown microprobe pair. New strict current-shader source-product comparison is pixel-identical; no production trunk bug established.'
report['sourceControlHeads']={'topAndNegativeOblique':historical['head'],'positiveOblique':oblique['head'],'cartographic':carto['head'],'initialCleanFlags':[historical['clean'],oblique['clean'],carto['clean']]}
report['finalCpuOnlyHead']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
(OUT/'proof.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
print(json.dumps({'status':report['status'],'runs':len(report['runs']),'comparisons':len(report['comparisons']),'images':len(report['images'])}))
