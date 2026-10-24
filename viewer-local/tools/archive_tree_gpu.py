"""Archive existing tree GPU results without running Godot or changing images."""
import hashlib,json,pathlib,subprocess,shutil
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'docs/surface/evidence/vegetation-tree-v13'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf8'))
def record(path):return {'path':str(path),'sha256':sha(path),'bytes':path.stat().st_size}
def canonical_revision(revision):
    names=subprocess.check_output(['git','ls-tree','-r','--name-only',revision,'viewer-local'],cwd=root,text=True).splitlines()
    return {name:hashlib.sha256(subprocess.check_output(['git','show',revision+':'+name],cwd=root)).hexdigest() for name in names if name.endswith(('.gd','.gdshader','.gdshaderinc','.tscn')) or name=='viewer-local/project.godot'}
groups=[('tree-gpu-first','4a1b6c2','Initial TOP160, solar floor only; negative shadow appearance retained.'),('tree-gpu-top','4a1b6c2','Initial TOP10 had phase0 because camera20m was below envelope32m; not a high-LOD test. TOP640 reached phase2.'),('tree-gpu-reconstruction',None,'WIP camera32m + two-texel shadow reconstruction. Capture runs succeeded, strict comparison failed at10m because baseline camera20m differed. Not relabelled passing.'),('tree-gpu-camera-matched','a7e44ab','Final shadow/camera source, explicit diagnostic TOP clearance32m in BOTH profiles. TOP10/160 physical hashes and disabled-tree pixels match.'),('tree-gpu-oblique','a7e44ab','Phase0 in BOTH profiles: broad loaded height envelope did not fit atlas/resident ROI. No visible native/impostor geometry claim.'),('tree-gpu-carto','a7e44ab','Blueprint160, flag enabled in loader but excluded from rendering. Four central visibility-state pixel hashes identical.')]
result={'format':'magna-experimental-tree-gpu-evidence','version':1,'status':'bounded-top-technical-controls-pass-artistic-and-oblique-not-qualified','runtimeRevisions':{r:{'canonicalLfSourceSha256':canonical_revision(r)} for r in ['4a1b6c2','a7e44ab']},'runtimeHashTiming':'Revision hashes are canonical Git LF code, distinct from native bytes. These historical runs did not capture start/end runtime hashes. Current actual native bytes were collected AFTER completion; no retrospective start/end observation is claimed. Reproduction runner now enforces snapshots.','actualNativeRuntimeCollectedAfterCompletion':{},'runs':[],'sourcePacketSha256':'e9646f0aadfc2d69cac78e64977389201ff8ef87360ff2f52f72bc37cb079d2c','sourceScope':'Retained V12 replay with4km tree page; no new neural generation or source/IDs mutation. Original fine40m grid stays local and real parent remains authoritative elsewhere.'}
for name in result['runtimeRevisions']['a7e44ab']['canonicalLfSourceSha256']:
    p=root/name
    if p.exists():result['actualNativeRuntimeCollectedAfterCompletion'][name]=sha(p)
for folder,revision,scope in groups:
    base=root/'web/out'/folder
    if not base.exists():continue
    report=read(base/('report.json' if (base/'report.json').exists() else 'report.partial.json'))
    rows=[]
    for run in report['runs']:
        location=pathlib.Path(run['folder']);metrics=read(location/'metrics.json')
        rows.append({'widthM':run['width'],'profile':run['profile'],'processDurationMs':run['durationMs'],'adapter':run.get('adapter'),'backend':run.get('backend'),'canopyView':metrics['canopyView'],'populationInstances':metrics['populationInstances'],'memorySnapshot':{'videoMemoryBytes':metrics.get('videoMemoryBytes'),'textureMemoryBytes':metrics.get('textureMemoryBytes'),'scope':'Single end-of-run engine counters; not peak RAM/VRAM or FPS.'},'layerPhysicalSnapshots':run['layers'],'artifacts':[record(p) for p in sorted(location.iterdir()) if p.suffix in ['.png','.json','.log']]})
    result['runs'].append({'name':folder,'sourceEquivalentRevision':revision,'scope':scope,'rawReportStatus':report['status'],'sourceSha256':report['sourceSha256'],'treeManifestSha256':report['treeManifestSha256'],'comparisons':report.get('comparisons',[]),'captures':rows})
coverage=root/'web/out/tree-gpu-coverage-r2'
result['coverage']=read(coverage/'report.json');result['coverage']['artifacts']=[record(p) for p in sorted(coverage.iterdir())]
result['negativeProbeLog']=record(root/'web/out/tree-gpu-coverage.log')
before=root/'web/out/tree-gpu-first/160m-cc0-tree';after=root/'web/out/tree-gpu-camera-matched/160m-cc0-tree'
old=read(before/'metrics.json');new=read(after/'metrics.json')
result['shadowReconstructionComparison']={'widthM':160,'old':'solar penumbra only','new':'max(pixel, solar penumbra, two active atlas texels)','atlasHashIdentical':old['canopyView']['activeAtlasHash']==new['canopyView']['activeAtlasHash'],'instanceCountsIdentical':old['populationInstances']==new['populationInstances'],'noTreesFullPngSha256Identical':sha(before/'no-trees.png')==sha(after/'no-trees.png'),'oldImage':record(before/'all.png'),'newImage':record(after/'all.png'),'scope':'Controlled160m response comparison; reconstruction bandwidth is renderer-only and visibility C/V unchanged. No physical solar-energy claim.'}
result['coverageNotes']='Actual MultiMesh high/impostor production vertex, cutout and alpha code; unshaded/white ALBEDO substitutions only for coverage readback. C target from production Canopy.prepare and surface_canopy_target at matching transforms. Error normalized by visible crown envelope, not the mostly empty full160m frame. TOP controls are not oblique or physically exact3D C/V.'
result['limitations']=['No full fresh navigation/campaign qualification for this experimental flag.','High/impostor common-camera lit BRDF or normal-direction parity was NOT measured. Darker high foliage versus brighter mid imagery remains a possible LOD appearance issue; different-camera images do not isolate its cause.','Oblique source view was whole-view meso phase0, so no native/impostor visibility or parallax qualification.','Five-view impostor has planar depth and discrete view changes.','TOP640 was captured before the final shadow reconstruction floor; visibility C/V is unchanged but final shadow appearance640 is not independently recaptured here.','Default renderer remains legacy; tree asset use is explicit. Shrubs/rocks/debris remain stylized.','Historical negative cases/logs are preserved. No start/end hash observations are invented.']
out.mkdir(parents=True,exist_ok=True)
(out/'gpu.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
selected={'top10-high.png':root/'web/out/tree-gpu-camera-matched/10m-cc0-tree/all.png','top160-impostor.png':root/'web/out/tree-gpu-camera-matched/160m-cc0-tree/all.png','top640-impostor-prior-shadow.png':root/'web/out/tree-gpu-top/640m-cc0-tree/all.png','blueprint-flag.png':root/'web/out/tree-gpu-carto/160m-cc0-tree/all.png','shadow160-negative.png':root/'web/out/tree-gpu-first/160m-cc0-tree/all.png'}
for name,source in selected.items():shutil.copyfile(source,out/name)
print(json.dumps({'evidence':str(out/'gpu.json'),'groups':len(result['runs']),'pngCopies':len(selected),'coveragePassed':result['coverage']['passed']}))
